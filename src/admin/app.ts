import { initPalette, type PaletteItem } from './palette.js';
import { ApiError, loginErrorMessage } from './errors.js';
import { applyBranding, fetchPublicBranding, refreshBrandingForTheme, type PublicBranding } from './branding.js';
import { openSetup, type BrandingDraft } from './setup.js';

type Project = {
  id: string;
  name: string;
  clientLabel: string;
  origins: string[];
  webhookUrl: string;
  openCount: number;
};
type Ticket = {
  id: string;
  projectId: string;
  projectName: string;
  clientLabel: string;
  text: string;
  response: string;
  replyText: string;
  status: string;
  pageUrl: string;
  anchor: { selector: string; relative: { x: number; y: number }; viewport: { width: number; height: number } };
  viewportWidth: number;
  diagnostics: Record<string, unknown>;
  screenshotId?: string;
  createdAt: string;
};
type ReviewLink = { id: string; label: string; createdAt: string; revokedAt: string | null; lastUsedAt: string | null };
type Comment = {
  id: string;
  author: 'admin' | 'agent';
  authorLabel: string;
  body: string;
  visibility: 'internal' | 'reviewer';
  statusFrom: string | null;
  statusTo: string | null;
  createdAt: string;
};
type AgentToken = {
  id: string;
  label: string;
  scope: 'read' | 'write';
  projectId: string | null;
  projectName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

const $ = <T extends Element>(selector: string) => document.querySelector(selector) as T;

const STATUS_LABELS: Record<string, string> = {
  TODO: 'À traiter',
  IN_PROGRESS: 'En cours',
  REVIEW: 'À valider',
  DONE: 'Traité',
};

let projects: Project[] = [];
let tickets: Ticket[] = [];
let selectedProject = '';
let selectedTicket = '';
/** Keyset cursor for the next page; null once the list is exhausted. */
let nextCursor: string | null = null;
let totalTickets = 0;
/** Set while a project dialog is editing rather than creating. */
let editingProject: Project | null = null;
/** Bound to the current session by the server; required on every write. */
let csrfToken = '';

async function api(url: string, options: RequestInit = {}) {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = { ...((options.headers as Record<string, string>) ?? {}) };
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && method !== 'HEAD') headers['X-CSRF-Token'] = csrfToken;
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) {
    showLogin();
    throw new ApiError(401);
  }
  if (!response.ok) throw new ApiError(response.status);
  return response.status === 204 ? null : response.json();
}

function showLogin() {
  csrfToken = '';
  $<HTMLElement>('#login').hidden = false;
  $<HTMLElement>('#app').hidden = true;
}

function showApp() {
  $<HTMLElement>('#login').hidden = true;
  $<HTMLElement>('#app').hidden = false;
}

const formatDate = (value: string) =>
  new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(
    new Date(value),
  );

/** A calendar day, without the hour nobody reads on a chart axis. */
const formatDay = (value: string) =>
  new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(new Date(value));

const relative = new Intl.RelativeTimeFormat('fr-FR', { numeric: 'auto' });

/** Scannable age for list rows; the exact timestamp stays in the `title`. */
function formatAge(value: string) {
  const seconds = (new Date(value).getTime() - Date.now()) / 1000;
  const age = Math.abs(seconds);
  if (age < 60) return 'à l’instant';
  if (age < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (age < 86_400) return relative.format(Math.round(seconds / 3600), 'hour');
  if (age < 604_800) return relative.format(Math.round(seconds / 86_400), 'day');
  return formatDate(value);
}

/** <use> needs the SVG namespace; createElement would silently render nothing. */
function icon(id: string, className = 'icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

/** A stable hue per project, so it wears the same colour in every list. */
function projectHue(id: string) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return String(hash % 6);
}

/** The project's initial on its hue; "all projects" gets a neutral grid. */
function projectAvatar(id: string, name: string) {
  const avatar = document.createElement('span');
  avatar.className = id ? 'proj' : 'proj all';
  avatar.setAttribute('aria-hidden', 'true');
  if (id) {
    avatar.dataset.hue = projectHue(id);
    avatar.textContent = (name.trim()[0] ?? '?').toUpperCase();
  } else {
    avatar.append(icon('i-grid'));
  }
  return avatar;
}

/**
 * Deep-links the reviewer's preview page back to the exact spot. The anchor
 * rides in the fragment: browsers never send it to the client's server, and it
 * stays out of their access logs and Referer headers.
 */
function anchorUrl(ticket: Ticket): string {
  const payload = JSON.stringify({ selector: ticket.anchor.selector, relative: ticket.anchor.relative });
  return `${ticket.pageUrl}#rd-anchor=${encodeURIComponent(payload)}`;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

function toast(message: string, tone: 'ok' | 'error' = 'ok') {
  const host = $<HTMLElement>('#toast');
  host.className = `toast ${tone}`;
  host.textContent = message;
  host.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    host.hidden = true;
  }, 3200);
}

let promptTimer: ReturnType<typeof setTimeout> | undefined;

function showOnboardingPrompt(projectName: string) {
  const host = $<HTMLElement>('#onboarding-prompt');
  $('#prompt-title').textContent = `Projet « ${projectName} » créé !`;
  $('#prompt-desc').textContent = 'Voulez-vous configurer l’installation du widget sur votre site dès maintenant ?';
  host.hidden = false;
  clearTimeout(promptTimer);
  promptTimer = setTimeout(() => {
    host.hidden = true;
  }, 16_000);
}

function hideOnboardingPrompt() {
  const host = document.querySelector<HTMLElement>('#onboarding-prompt');
  if (host) host.hidden = true;
  clearTimeout(promptTimer);
}

$('#prompt-dismiss').addEventListener('click', hideOnboardingPrompt);
$('#prompt-close').addEventListener('click', hideOnboardingPrompt);
$('#prompt-install').addEventListener('click', () => {
  hideOnboardingPrompt();
  $<HTMLButtonElement>('#review-link').click();
});

function emptyState(iconId: string, title: string, hint: string) {
  const box = document.createElement('div');
  box.className = 'empty-state';
  const strong = document.createElement('strong');
  strong.textContent = title;
  const span = document.createElement('span');
  span.textContent = hint;
  box.append(icon(iconId), strong, span);
  return box;
}

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const fields = new FormData(event.currentTarget as HTMLFormElement);
  try {
    const session = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(fields)) });
    csrfToken = session.csrfToken;
    await load();
  } catch (error) {
    $('output').textContent = loginErrorMessage(error instanceof ApiError ? error.status : 0);
  }
});

async function load() {
  // Restores the CSRF token after a page reload, when only the cookie survives.
  if (!csrfToken) csrfToken = (await api('/api/auth/session')).csrfToken;
  projects = await api('/api/projects');
  showApp();
  renderProjects();
  await loadTickets();
  await refreshOnboarding();
  // A fresh instance has nothing to triage and everything to set up: start on
  // the overview, where the checklist is.
  if (onboarding && onboarding.tickets === 0 && onboarding.connectedAgents === 0) await showOverview();
  await maybeOpenSetup();
}

// ------------------------------------------------------------ white-label

type BrandingSettings = BrandingDraft & {
  setupCompletedAt: string | null;
  emailDeliveryNote: string;
};

/**
 * Opens the wizard. `first-run` is the takeover shown once, right after the
 * very first sign-in; `settings` is the same flow reopened deliberately.
 */
async function openBrandingWizard(mode: 'first-run' | 'settings') {
  const settings: BrandingSettings = await api('/api/branding/settings');
  openSetup({
    mode,
    emailDeliveryNote: settings.emailDeliveryNote,
    draft: {
      productName: settings.productName,
      tagline: settings.tagline,
      logoDataUri: settings.logoDataUri,
      accent: settings.accent,
      publicUrl: settings.publicUrl,
      emailFromName: settings.emailFromName,
      emailFromAddress: settings.emailFromAddress,
      emailReplyTo: settings.emailReplyTo,
    },
    save: (draft, completeSetup) =>
      api('/api/branding', {
        method: 'PUT',
        body: JSON.stringify({ ...draft, completeSetup }),
      }) as Promise<PublicBranding>,
    onClose: (branding) => {
      if (branding) toast('Personnalisation appliquée.');
      // « Configurer plus tard » means later, not on every reload: the takeover
      // steps aside for good in this browser. Personnalisation (and ⌘K) still
      // reopen it at any time.
      else if (mode === 'first-run') rememberSetupPostponed();
    },
  });
}

const SETUP_POSTPONED_KEY = 'reviewdesk-setup-postponed';

function setupPostponed() {
  try {
    return localStorage.getItem(SETUP_POSTPONED_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberSetupPostponed() {
  try {
    localStorage.setItem(SETUP_POSTPONED_KEY, '1');
  } catch {
    // Private mode or blocked storage: the wizard comes back next load.
  }
}

/**
 * The takeover only fires while the instance has never been configured, and
 * only until it has been postponed once.
 */
async function maybeOpenSetup() {
  try {
    const branding = await fetchPublicBranding();
    applyBranding(branding);
    if (!branding.setupComplete && !setupPostponed()) await openBrandingWizard('first-run');
  } catch {
    // Branding is decoration: a failure here must never block the dashboard.
  }
}

$('#branding').addEventListener('click', () => {
  openBrandingWizard('settings').catch(() => toast('Personnalisation indisponible.', 'error'));
});

// The sign-in screen is branded before anyone has signed in, so this runs
// outside the authenticated boot path.
fetchPublicBranding()
  .then(applyBranding)
  .catch(() => {});

/**
 * The accessible name is pinned to `name` alone via aria-label: the secondary
 * client line is decoration, and tests (plus screen-reader users scanning the
 * nav) want the project's own name, not "Name Client" run together.
 */
function projectButton(id: string, name: string, secondary: string, openCount = 0) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `project ${selectedProject === id ? 'active' : ''}`;
  button.setAttribute('aria-label', name);
  button.title = secondary ? `${name} — ${secondary}` : name;

  const stack = document.createElement('span');
  stack.className = 'stack';
  stack.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = 'name';
  label.textContent = name;
  stack.append(label);
  if (secondary) {
    const client = document.createElement('span');
    client.className = 'client';
    client.textContent = secondary;
    stack.append(client);
  }

  button.append(projectAvatar(id, name), stack);
  if (openCount > 0) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.setAttribute('aria-hidden', 'true');
    badge.textContent = String(openCount);
    button.append(badge);
  }
  button.onclick = () => chooseProject(id);
  return button;
}

function renderProjects() {
  const nav = $('#projects');
  nav.replaceChildren();
  const open = projects.reduce((sum, project) => sum + project.openCount, 0);
  nav.append(
    projectButton('', 'Tous les projets', `${projects.length} projet${projects.length === 1 ? '' : 's'}`, open),
  );
  for (const project of projects) {
    nav.append(projectButton(project.id, project.name, project.clientLabel, project.openCount));
  }
  const client = $<HTMLSelectElement>('#client');
  const previous = client.value;
  client.replaceChildren(new Option('Tous les clients', ''));
  for (const label of [...new Set(projects.map((project) => project.clientLabel))].sort()) {
    client.append(new Option(label, label));
  }
  client.value = previous;
}

async function chooseProject(id: string) {
  selectedProject = id;
  selectedTicket = '';
  const project = projects.find((candidate) => candidate.id === id);
  $('#project-title').textContent = project?.name ?? 'Tous les retours';
  $('#client-label').textContent = (project?.clientLabel ?? 'TOUS LES CLIENTS').toUpperCase();
  $('#app').classList.remove('nav-open');
  renderProjects();
  // Both views are scoped by the project, so whichever is on screen reloads.
  await (view === 'overview' ? loadStats() : loadTickets());
}

function filterParams() {
  const params = new URLSearchParams();
  if (selectedProject) params.set('projectId', selectedProject);
  for (const key of ['status', 'client', 'format'] as const) {
    const value = $<HTMLSelectElement>(`#${key}`).value;
    if (value) params.set(key, value);
  }
  const page = $<HTMLInputElement>('#page-filter').value.trim();
  if (page) params.set('page', page);
  return params;
}

/** Debounced so typing in the page filter does not fire a request per keystroke. */
let filterTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleReload() {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => void loadTickets(), 180);
}

/**
 * Failures land in the list rather than escaping: a refused filter request
 * used to be an unhandled rejection, and a failed first load sent the admin
 * back to the login screen although the session was fine. A 401 has already
 * shown the login screen inside api(), so it needs nothing more here.
 */
async function loadTickets() {
  const list = $('#tickets');
  list.setAttribute('aria-busy', 'true');
  // Placeholders only when there is nothing to keep on screen: a refresh of a
  // populated list leaves the rows in place until the answer lands.
  if (!tickets.length) renderTicketSkeleton();
  try {
    const payload = await api(`/api/tickets?${filterParams()}`);
    tickets = payload.tickets;
    nextCursor = payload.nextCursor;
    totalTickets = payload.total;
    renderTickets();
    renderCount();
    if (!selectedTicket) clearDetail();
    return true;
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) renderTicketsError();
    return false;
  } finally {
    list.removeAttribute('aria-busy');
  }
}

function renderTicketSkeleton() {
  const rows: HTMLDivElement[] = [];
  for (let index = 0; index < 6; index++) {
    const row = el('div', 'skeleton-ticket');
    row.setAttribute('aria-hidden', 'true');
    row.append(el('span', 'skeleton'), el('span', 'skeleton'), el('span', 'skeleton'));
    rows.push(row);
  }
  $('#tickets').replaceChildren(...rows);
}

function renderTicketsError() {
  const box = emptyState('i-inbox', 'Retours indisponibles', 'Le chargement a échoué. Vérifiez la connexion, puis réessayez.');
  box.setAttribute('role', 'alert');
  const retry = el('button', 'btn btn-ghost', 'Réessayer');
  retry.type = 'button';
  retry.onclick = () => void loadTickets();
  box.append(retry);
  $('#tickets').replaceChildren(box);
  $('#count').textContent = '';
}

async function loadMore() {
  if (!nextCursor) return;
  const params = filterParams();
  params.set('cursor', nextCursor);
  const payload = await api(`/api/tickets?${params}`);
  tickets = [...tickets, ...payload.tickets];
  nextCursor = payload.nextCursor;
  totalTickets = payload.total;
  renderTickets();
  renderCount();
}

function renderCount() {
  const plural = totalTickets === 1 ? '' : 's';
  // Say what is loaded as well as what matches: a page that shows 60 of 340
  // must not read as though 60 were the whole story.
  $('#count').textContent =
    tickets.length < totalTickets
      ? `${tickets.length} affichés sur ${totalTickets} retour${plural}`
      : `${totalTickets} retour${plural}`;
}

function renderTickets() {
  const list = $('#tickets');
  list.replaceChildren();
  if (!tickets.length) {
    const statusVal = $<HTMLSelectElement>('#status').value;
    const clientVal = $<HTMLSelectElement>('#client').value;
    const formatVal = $<HTMLSelectElement>('#format').value;
    const searchVal = $<HTMLInputElement>('#page-filter').value.trim();
    const hasFilter = Boolean(statusVal || clientVal || formatVal || searchVal);

    if (selectedProject && !hasFilter) {
      const card = el('div', 'empty-onboarding-card');
      card.append(
        icon('i-code'),
        el('h3', '', 'Bienvenue sur votre espace de retours'),
        el(
          'p',
          '',
          'Votre projet est prêt. Suivez ces étapes simples pour lancer la phase de retours avec vos clients :',
        ),
      );

      const stepsList = el('div', 'empty-steps-list');

      // Step 1: Install or share link
      const step1 = el('div', 'empty-step-row');
      const s1Num = el('span', 'empty-step-num', '1');
      const s1Body = el('div', 'empty-step-body');
      s1Body.append(
        el('strong', '', 'Installer le widget ou partager un lien direct'),
        el('p', '', 'Ajoutez le script sur votre site (HTML, React, Webflow...) ou envoyez le lien direct.'),
      );
      const s1Btn = el('button', 'btn btn-primary', 'Configurer l’installation →');
      s1Btn.type = 'button';
      s1Btn.onclick = () => $<HTMLButtonElement>('#review-link').click();
      step1.append(s1Num, s1Body, s1Btn);

      // Step 2: Test live
      const step2 = el('div', 'empty-step-row');
      const s2Num = el('span', 'empty-step-num', '2');
      const s2Body = el('div', 'empty-step-body');
      s2Body.append(
        el('strong', '', 'Tester l’expérience de review'),
        el('p', '', 'Le client clique sur « Faire un retour », pointe un élément et écrit son retour avec tags et captures.'),
      );
      step2.append(s2Num, s2Body);

      // Step 3: Connect AI agent
      const step3 = el('div', 'empty-step-row');
      const s3Num = el('span', 'empty-step-num', '3');
      const s3Body = el('div', 'empty-step-body');
      s3Body.append(
        el('strong', '', 'Automatiser avec un agent IA (optionnel)'),
        el('p', '', 'Branchez Claude Code, Cursor ou votre agent personnalisé pour traiter les retours.'),
      );
      const s3Btn = el('button', 'btn btn-secondary', 'Accès agents →');
      s3Btn.type = 'button';
      s3Btn.onclick = () => $<HTMLButtonElement>('#agent-access').click();
      step3.append(s3Num, s3Body, s3Btn);

      stepsList.append(step1, step2, step3);
      card.append(stepsList);
      list.append(card);
    } else {
      list.append(
        emptyState(
          'i-inbox',
          'Aucun retour',
          'Rien ne correspond à ces filtres. Élargissez la recherche, ou partagez un lien reviewer pour recevoir les premiers retours.',
        ),
      );
    }
    return;
  }
  for (const ticket of tickets) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `ticket ${selectedTicket === ticket.id ? 'active' : ''}`;
    row.dataset.ticketId = ticket.id;
    // The lifted row says "open" to the eye; aria-current says it to a reader.
    if (selectedTicket === ticket.id) row.setAttribute('aria-current', 'true');
    const status = document.createElement('span');
    status.className = `status ${ticket.status}`;
    // The glyph is a disc that empties as the work advances; the label always
    // rides with it, so nothing depends on reading the shape alone.
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.setAttribute('aria-hidden', 'true');
    status.append(dot, document.createTextNode(STATUS_LABELS[ticket.status] ?? ticket.status));
    const summary = document.createElement('span');
    summary.className = 'summary';
    const title = document.createElement('strong');
    // textContent, never innerHTML: reviewer text is stored verbatim.
    title.textContent = ticket.text;
    const context = document.createElement('small');
    const mobile = ticket.viewportWidth < 768;
    // Drawn icons, not emoji: systems without an emoji font draw empty boxes.
    const where = document.createElement('span');
    where.textContent = `${ticket.projectName} · ${new URL(ticket.pageUrl).pathname}`;
    const device = document.createElement('span');
    device.append(icon(mobile ? 'i-phone' : 'i-monitor'), document.createTextNode(mobile ? 'Mobile' : 'Desktop'));
    context.append(where, device);
    if (ticket.screenshotId) {
      const shot = document.createElement('span');
      shot.append(icon('i-camera'), document.createTextNode('Capture'));
      context.append(shot);
    }
    summary.append(title, context);
    const date = document.createElement('span');
    date.className = 'date';
    date.textContent = formatAge(ticket.createdAt);
    date.title = formatDate(ticket.createdAt);
    row.append(projectAvatar(ticket.projectId, ticket.projectName), status, summary, date);
    row.onclick = () => openTicket(ticket.id);
    list.append(row);
  }
  if (nextCursor) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'quiet load-more';
    more.textContent = `Charger plus (${totalTickets - tickets.length} restants)`;
    more.onclick = async () => {
      more.disabled = true;
      more.textContent = 'Chargement…';
      try {
        await loadMore();
      } catch {
        toast('Chargement impossible.', 'error');
        more.disabled = false;
      }
    };
    list.append(more);
  }
}

function clearDetail() {
  const detail = $('#detail');
  detail.className = 'detail empty';
  detail.replaceChildren(
    emptyState('i-image', 'Aucun retour sélectionné', 'Choisissez un retour dans la liste pour voir son ancrage, ses diagnostics et y répondre.'),
  );
}

function showScreenshotModal(ticket: Ticket) {
  if (!ticket.screenshotId) return;
  const dialog = $<HTMLDialogElement>('#screenshot-dialog');
  const img = $<HTMLImageElement>('#screenshot-dialog-img');
  const openLink = $<HTMLAnchorElement>('#screenshot-dialog-open');
  const downloadLink = $<HTMLAnchorElement>('#screenshot-dialog-download');
  const label = $('#screenshot-dialog-label');
  const meta = $('#screenshot-dialog-meta');

  const uploadUrl = `/api/uploads/${ticket.screenshotId}`;
  img.src = uploadUrl;
  openLink.href = uploadUrl;
  downloadLink.href = uploadUrl;
  downloadLink.download = `capture-${ticket.id}.webp`;
  label.textContent = ticket.text;
  const format = ticket.viewportWidth < 768 ? 'Mobile' : 'Desktop';
  meta.textContent = `${ticket.projectName} · ${format} (${ticket.anchor.viewport.width}×${ticket.anchor.viewport.height}) · ${ticket.pageUrl}`;

  dialog.showModal();
}

/** Below this width the detail pane covers the list instead of sitting beside it. */
const DETAIL_OVERLAY = matchMedia('(max-width: 900px)');

function focusTicketRow(id: string) {
  $('#tickets').querySelector<HTMLElement>(`.ticket[data-ticket-id="${CSS.escape(id)}"]`)?.focus();
}

/** Back to the list, handing focus to the row that was open so the keyboard resumes where it left. */
function closeDetail() {
  const id = selectedTicket;
  selectedTicket = '';
  clearDetail();
  renderTickets();
  if (id) focusTicketRow(id);
}

function openTicket(id: string) {
  // renderTickets() rebuilds the rows, which drops focus to <body>; remember
  // whether it was in the list so it can be put back on the new active row.
  const listHadFocus = $('#tickets').contains(document.activeElement);
  selectedTicket = id;
  renderTickets();
  const ticket = tickets.find((candidate) => candidate.id === id)!;
  const detail = $('#detail');
  detail.className = 'detail';
  detail.replaceChildren();

  const index = tickets.findIndex((candidate) => candidate.id === id);
  const mobile = ticket.viewportWidth < 768;
  const { selector, relative, viewport } = ticket.anchor;

  // ------------------------------------------------------------ action bar
  // Everything that acts on the ticket as a whole stays in one sticky bar:
  // where it sits in the list, its status, and the way to go and look at it.

  const back = el('button', 'quiet detail-back');
  back.type = 'button';
  back.append(icon('i-back'), document.createTextNode('Liste'));
  back.onclick = closeDetail;

  const stepper = el('div', 'detail-stepper');
  const prev = el('button', 'icon-btn');
  prev.type = 'button';
  prev.setAttribute('aria-label', 'Retour précédent');
  prev.title = 'Précédent (K)';
  prev.append(icon('i-chevron-up'));
  prev.disabled = index <= 0;
  prev.onclick = () => moveSelection(-1);
  const next = el('button', 'icon-btn');
  next.type = 'button';
  next.setAttribute('aria-label', 'Retour suivant');
  next.title = 'Suivant (J)';
  next.append(icon('i-chevron-down'));
  next.disabled = index >= tickets.length - 1;
  next.onclick = () => moveSelection(1);
  stepper.append(prev, next, el('span', 'detail-position', `${index + 1} sur ${totalTickets || tickets.length}`));

  const select = document.createElement('select');
  // Identified because the pane holds other fields; named for screen readers.
  select.id = 'ticket-status';
  select.setAttribute('aria-label', 'Statut');
  for (const [value, label] of Object.entries(STATUS_LABELS)) {
    const option = new Option(label, value, false, value === ticket.status);
    select.append(option);
  }
  // The control wears the colour of its status, and saves as soon as it moves:
  // a status is a decision, not a draft.
  const statusField = el('span', `status-field ${ticket.status}`);
  const statusDot = el('span', 'dot');
  statusDot.setAttribute('aria-hidden', 'true');
  statusField.append(statusDot, select);
  select.onchange = async () => {
    const previous = ticket.status;
    const chosen = select.value;
    statusField.className = `status-field ${chosen}`;
    select.disabled = true;
    try {
      await api(`/api/tickets/${ticket.id}`, { method: 'PATCH', body: JSON.stringify({ status: chosen }) });
      ticket.status = chosen;
      toast(`Statut : ${STATUS_LABELS[chosen] ?? chosen}.`);
    } catch {
      select.value = previous;
      statusField.className = `status-field ${previous}`;
      toast('Statut non enregistré.', 'error');
      return;
    } finally {
      select.disabled = false;
    }
    // The sidebar badges count open tickets, so a status change moves them.
    try {
      projects = await api('/api/projects');
      renderProjects();
    } catch {
      // Badges catch up on the next refresh.
    }
    await loadTickets();
  };

  // The whole point of a visual feedback tool: go and look at the spot rather
  // than decode a CSS selector by hand.
  const openAnchor = el('a', 'btn btn-primary anchor-link');
  openAnchor.href = anchorUrl(ticket);
  openAnchor.target = '_blank';
  openAnchor.rel = 'noreferrer';
  openAnchor.title = 'Rouvre la page avec l’épingle reposée sur l’élément';
  // Named here too: on a phone the visible label folds away to the icon.
  openAnchor.setAttribute('aria-label', 'Ouvrir au point d’ancrage');
  openAnchor.append(icon('i-target'), el('span', '', 'Ouvrir au point d’ancrage'));

  const bar = el('div', 'detail-bar');
  bar.append(back, stepper, el('span', 'detail-bar-spacer'), statusField, openAnchor);

  // ------------------------------------------------------------ main column

  const eyebrow = el('div', 'eyebrow');
  eyebrow.append(
    projectAvatar(ticket.projectId, ticket.projectName),
    document.createTextNode(`${ticket.clientLabel} · ${ticket.projectName}`),
  );
  const heading = el('h2', '', ticket.text);
  const byline = el('p', 'detail-byline');
  const received = el('time', '', formatAge(ticket.createdAt));
  received.dateTime = ticket.createdAt;
  received.title = formatDate(ticket.createdAt);
  byline.append(
    document.createTextNode('Envoyé par le client '),
    received,
    document.createTextNode(` · ${new URL(ticket.pageUrl).pathname} · ${mobile ? 'mobile' : 'ordinateur'}`),
  );
  const head = el('header', 'detail-head');
  head.append(eyebrow, heading, byline);

  // The column scrolls on its own; the composer sits under it, outside the
  // scroll, so nothing ever slides beneath it.
  const scroller = el('div', 'detail-scroll');
  scroller.append(head, screenshotFigure(ticket));
  const main = el('div', 'detail-main');

  const conversation = el('section', 'conversation');
  conversation.setAttribute('aria-label', 'Échanges');
  void renderConversation(ticket, conversation);

  // ------------------------------------------------------------ side rail

  const replyPreview = el('p', 'reply-preview');
  const showReply = (text: string) => {
    replyPreview.classList.toggle('empty', !text);
    replyPreview.textContent = text || 'Pas encore de réponse.';
  };
  showReply(ticket.replyText);
  const replyCard = el('section', 'rail-card');
  replyCard.append(railTitle('i-eye', 'Ce que voit le client'), replyPreview);

  scroller.append(conversation);
  main.append(scroller, composer(ticket, conversation, showReply));

  const note = document.createElement('textarea');
  note.id = 'ticket-note';
  note.value = ticket.response;
  note.maxLength = 4000;
  note.placeholder = 'Un mémo pour l’équipe et les agents, jamais montré au client.';
  const noteLabel = el('label', 'rail-title');
  noteLabel.htmlFor = 'ticket-note';
  noteLabel.append(icon('i-lock'), document.createTextNode('Note interne'));
  const saveNote = el('button', 'btn btn-secondary', 'Enregistrer la note');
  saveNote.type = 'button';
  saveNote.disabled = true;
  note.oninput = () => {
    saveNote.disabled = note.value === ticket.response;
  };
  saveNote.onclick = async () => {
    saveNote.disabled = true;
    try {
      await api(`/api/tickets/${ticket.id}`, { method: 'PATCH', body: JSON.stringify({ response: note.value }) });
      ticket.response = note.value;
    } catch {
      toast('Note non enregistrée.', 'error');
      saveNote.disabled = false;
      return;
    }
    // The note is saved either way; a failed list refresh must not undo it.
    if (await loadTickets()) toast('Note enregistrée.');
    else toast('Note enregistrée, mais actualisation indisponible.', 'error');
  };
  const noteCard = el('section', 'rail-card');
  noteCard.append(noteLabel, note, saveNote);

  const facts = el('dl', 'facts');
  const fact = (term: string, value: Node | string) => {
    const description = el('dd');
    description.append(value);
    facts.append(el('dt', '', term), description);
  };
  const page = el('a', '', new URL(ticket.pageUrl).pathname);
  page.href = ticket.pageUrl;
  page.target = '_blank';
  page.rel = 'noreferrer';
  page.title = ticket.pageUrl;
  fact('Page', page);
  fact('Écran', `${mobile ? 'Mobile' : 'Ordinateur'} · ${viewport.width}×${viewport.height}`);
  const browser = ticket.diagnostics.browser;
  const os = ticket.diagnostics.os;
  if (typeof browser === 'string' && browser !== 'Unknown') fact('Navigateur', browser);
  if (typeof os === 'string' && os !== 'Unknown') fact('Système', os);
  fact('Reçu', formatDate(ticket.createdAt));
  fact('Projet', ticket.projectName);
  const contextCard = el('section', 'rail-card');
  contextCard.append(railTitle('i-file', 'Contexte'), facts);

  // Selectors and raw diagnostics are for whoever fixes the bug, not for
  // triage: folded away until asked for.
  const technical = el('details', 'rail-card technical');
  const summary = el('summary', 'rail-title');
  summary.append(icon('i-code'), document.createTextNode('Détails techniques'));
  technical.append(
    summary,
    el('div', 'eyebrow', 'Élément pointé'),
    el('code', 'anchor-selector', `${selector} @ ${Math.round(relative.x * 100)}%, ${Math.round(relative.y * 100)}%`),
    el('div', 'eyebrow', 'Diagnostics consentis'),
    diagnosticsList(ticket),
  );

  const rail = el('aside', 'detail-rail');
  rail.setAttribute('aria-label', 'Informations du retour');
  rail.append(replyCard, noteCard, contextCard, technical);

  const body = el('div', 'detail-body');
  body.append(main, rail);
  detail.append(bar, body);

  // Where focus goes depends on the layout: over the list, the pane is the
  // whole screen and a reader must land in it; beside the list, focus stays
  // on the row so arrow keys and Tab keep triaging.
  if (DETAIL_OVERLAY.matches) {
    heading.tabIndex = -1;
    heading.focus();
  } else if (listHadFocus) {
    focusTicketRow(id);
  }
}

function railTitle(iconId: string, text: string) {
  const title = el('div', 'rail-title');
  title.append(icon(iconId), document.createTextNode(text));
  return title;
}

/** What the client was looking at, as large as the column allows. */
function screenshotFigure(ticket: Ticket) {
  const mobile = ticket.viewportWidth < 768;
  const { viewport } = ticket.anchor;
  if (!ticket.screenshotId) {
    const empty = el('div', 'ticket-screenshot-card empty');
    empty.append(icon('i-camera'), document.createTextNode('Aucune capture d’écran jointe à ce retour'));
    return empty;
  }
  const card = el('figure', 'ticket-screenshot-card');

  // A phone capture is shown at phone width, not stretched across the column.
  const wrap = el('div', mobile ? 'ticket-screenshot-wrap mobile' : 'ticket-screenshot-wrap');
  wrap.title = 'Cliquer pour agrandir la capture';
  const img = el('img', 'ticket-screenshot-preview');
  img.src = `/api/uploads/${ticket.screenshotId}`;
  img.alt = `Capture d’écran pour ${ticket.text}`;
  img.loading = 'lazy';
  const hint = el('div', 'ticket-screenshot-hint');
  hint.append(icon('i-zoom'), document.createTextNode('Agrandir'));
  wrap.append(img, hint);
  wrap.onclick = () => showScreenshotModal(ticket);

  const caption = el('figcaption', 'ticket-screenshot-head');
  const title = el('span', 'ticket-screenshot-title');
  title.append(
    icon(mobile ? 'i-phone' : 'i-monitor'),
    document.createTextNode(`Capture · ${mobile ? 'mobile' : 'ordinateur'} · ${viewport.width}×${viewport.height}`),
  );
  const actions = el('span', 'ticket-screenshot-actions');
  const zoom = el('button', 'btn-zoom-screenshot');
  zoom.type = 'button';
  zoom.title = 'Agrandir en plein écran';
  zoom.append(icon('i-zoom'), document.createTextNode('Agrandir'));
  zoom.onclick = () => showScreenshotModal(ticket);
  const link = el('a', 'screenshot-tab-link');
  link.href = `/api/uploads/${ticket.screenshotId}`;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.append(icon('i-external'), document.createTextNode('Voir la capture privée'));
  actions.append(zoom, link);
  caption.append(title, actions);

  card.append(wrap, caption);
  return card;
}

/** Key and value on one line each, like a property sheet, not a JSON dump. */
function diagnosticsList(ticket: Ticket) {
  // A reviewer who declined still yields `{os:'Unknown', browser:'Unknown'}`,
  // which reads like data when it is the absence of it. Say so in words.
  const informative = Object.values(ticket.diagnostics).some(
    (value) => value !== 'Unknown' && value !== null && value !== undefined && !(Array.isArray(value) && !value.length),
  );
  if (!informative) return el('p', 'diag diag-empty', 'Aucun diagnostic transmis. Le reviewer ne les a pas joints.');
  const list = el('dl', 'diag');
  for (const [key, value] of Object.entries(ticket.diagnostics)) {
    if (value === null || value === undefined || value === '') continue;
    list.append(el('dt', '', key), el('dd', '', typeof value === 'object' ? JSON.stringify(value) : String(value)));
  }
  return list;
}

/**
 * One composer, two audiences. Replying to the client publishes a comment
 * the server also copies into the reply shown in the widget; an internal
 * message stays in the team's thread.
 */
function composer(ticket: Ticket, conversation: HTMLElement, showReply: (text: string) => void) {
  let audience: 'reviewer' | 'internal' = 'reviewer';
  const box = el('div', 'composer');

  const tabs = el('div', 'composer-tabs');
  tabs.setAttribute('role', 'group');
  tabs.setAttribute('aria-label', 'Destinataire');
  const toClient = el('button', 'composer-tab');
  toClient.type = 'button';
  toClient.append(icon('i-message'), document.createTextNode('Répondre au client'));
  const toTeam = el('button', 'composer-tab');
  toTeam.type = 'button';
  toTeam.append(icon('i-lock'), document.createTextNode('Message interne'));
  tabs.append(toClient, toTeam);

  const draft = el('textarea', 'comment-draft');
  draft.maxLength = 4000;
  const hint = el('span', 'composer-hint');
  const send = el('button', 'btn btn-primary composer-send');
  send.type = 'button';
  const sendLabel = el('span');
  send.append(icon('i-send'), sendLabel);

  const apply = () => {
    const client = audience === 'reviewer';
    box.classList.toggle('internal', !client);
    toClient.setAttribute('aria-pressed', String(client));
    toTeam.setAttribute('aria-pressed', String(!client));
    draft.setAttribute('aria-label', client ? 'Réponse au client' : 'Message pour l’équipe');
    draft.placeholder = client
      ? 'Écrivez la réponse que le client lira dans son widget…'
      : 'Écrivez un message pour l’équipe et les agents…';
    hint.textContent = client ? 'Le client la verra dans « Mes retours ».' : 'Jamais montré au client.';
    sendLabel.textContent = client ? 'Envoyer au client' : 'Ajouter au fil';
  };
  toClient.onclick = () => {
    audience = 'reviewer';
    apply();
    draft.focus();
  };
  toTeam.onclick = () => {
    audience = 'internal';
    apply();
    draft.focus();
  };
  apply();

  const submit = async () => {
    const body = draft.value.trim();
    if (!body || send.disabled) return;
    send.disabled = true;
    try {
      await api(`/api/tickets/${ticket.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body, visibility: audience }),
      });
    } catch {
      toast('Envoi impossible.', 'error');
      send.disabled = false;
      return;
    }
    draft.value = '';
    send.disabled = false;
    if (audience === 'reviewer') {
      ticket.replyText = body;
      showReply(body);
      toast('Réponse envoyée au client.');
    } else {
      toast('Message ajouté.');
    }
    await renderConversation(ticket, conversation);
    // The newest entry is at the bottom, right above the composer.
    conversation.closest('.detail-scroll')?.scrollTo({ top: conversation.scrollHeight * 10, behavior: 'smooth' });
    void loadTickets();
  };
  send.onclick = () => void submit();
  draft.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  });

  const kbd = el('kbd', '', /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘↵' : 'Ctrl ↵');
  kbd.setAttribute('aria-hidden', 'true');
  const foot = el('div', 'composer-foot');
  foot.append(hint, el('span', 'detail-bar-spacer'), kbd, send);
  box.append(tabs, draft, foot);
  return box;
}

// -------------------------------------------------------------- overview

type Stats = {
  days: number;
  byStatus: Record<string, number>;
  total: number;
  received: number;
  receivedPrevious: number;
  resolved: number;
  resolvedPrevious: number;
  resolutionSeconds: number | null;
  stale: number;
  oldestTodo: string | null;
  daily: { received: Record<string, number>; resolved: Record<string, number> };
  projects: { id: string; name: string; clientLabel: string; todo: number; inProgress: number; review: number; done: number; total: number }[];
  pages: { pageUrl: string; count: number; open: number }[];
  activity: {
    id: string;
    author: 'admin' | 'agent';
    authorLabel: string;
    statusFrom: string | null;
    statusTo: string | null;
    createdAt: string;
    ticketId: string;
    ticketText: string;
  }[];
};

/** Terse element builder; the overview is mostly structure, not logic. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A duration a human reads without converting: « 3 h 20 », « 2 j ». */
function humanDuration(seconds: number): string {
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`;
  if (seconds < 86_400) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    return minutes ? `${hours} h ${String(minutes).padStart(2, '0')}` : `${hours} h`;
  }
  const days = seconds / 86_400;
  return days < 10 ? `${days.toFixed(1).replace('.', ',')} j` : `${Math.round(days)} j`;
}

/**
 * A KPI tile: the figure, what it counts, and one line of context underneath —
 * either a comparison with the previous period of the same length, or the
 * detail that makes the number actionable.
 */
function kpi(label: string, value: string, note: string, tone: 'plain' | 'up' | 'down' = 'plain') {
  const card = el('div', 'kpi');
  card.append(el('span', 'kpi-label', label), el('strong', 'kpi-value', value), el('span', `kpi-note ${tone}`, note));
  return card;
}

function deltaNote(current: number, previous: number, days: number): { text: string; tone: 'plain' | 'up' | 'down' } {
  const period = `vs ${days} j précédents`;
  if (!previous && !current) return { text: `aucun, ${period}`, tone: 'plain' };
  if (!previous) return { text: `aucun sur les ${days} j précédents`, tone: 'plain' };
  const change = Math.round(((current - previous) / previous) * 100);
  if (change === 0) return { text: `stable, ${period}`, tone: 'plain' };
  return { text: `${change > 0 ? '+' : '−'}${Math.abs(change)} % ${period}`, tone: change > 0 ? 'up' : 'down' };
}

/**
 * Received against resolved, one pair of bars per day. Drawn as inline SVG
 * rather than pulled from a chart library: the admin ships no third-party
 * script, and its CSP would refuse one anyway.
 */
function activityChart(stats: Stats) {
  const days: string[] = [];
  for (let index = stats.days - 1; index >= 0; index--) {
    days.push(new Date(Date.now() - index * 86_400_000).toISOString().slice(0, 10));
  }
  const received = days.map((day) => stats.daily.received[day] ?? 0);
  const resolved = days.map((day) => stats.daily.resolved[day] ?? 0);
  const peak = Math.max(1, ...received, ...resolved);

  const slot = 10;
  const width = days.length * slot;
  const height = 72;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'chart');
  svg.setAttribute('role', 'img');
  svg.setAttribute(
    'aria-label',
    `${received.reduce((sum, count) => sum + count, 0)} retours reçus et ${resolved.reduce((sum, count) => sum + count, 0)} traités sur ${stats.days} jours`,
  );

  days.forEach((day, index) => {
    const pairs: [number, string][] = [
      [received[index]!, 'bar-received'],
      [resolved[index]!, 'bar-resolved'],
    ];
    pairs.forEach(([value, className], side) => {
      if (!value) return;
      const barHeight = Math.max(1.5, (value / peak) * (height - 6));
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', String(index * slot + 1 + side * 4));
      rect.setAttribute('y', String(height - barHeight));
      rect.setAttribute('width', '3.4');
      rect.setAttribute('height', String(barHeight));
      rect.setAttribute('class', className);
      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = `${day} — ${value} ${className === 'bar-received' ? 'reçu(s)' : 'traité(s)'}`;
      rect.append(title);
      svg.append(rect);
    });
  });

  // Two hairlines at a third and two thirds of the peak: enough to read a
  // height off the chart, faint enough not to compete with the bars.
  for (const ratio of [1 / 3, 2 / 3]) {
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', '0');
    line.setAttribute('x2', String(width));
    line.setAttribute('y1', String(height - ratio * (height - 6)));
    line.setAttribute('y2', String(height - ratio * (height - 6)));
    line.setAttribute('class', 'chart-grid');
    svg.prepend(line);
  }

  const frame = el('div', 'chart-frame');
  const scale = el('div', 'chart-scale');
  scale.append(el('span', '', String(peak)), el('span', '', '0'));
  frame.append(scale, svg);

  const axis = el('div', 'chart-axis');
  axis.append(el('span', '', formatDay(`${days[0]}T12:00:00Z`)), el('span', '', 'aujourd’hui'));

  // Without a key, two shades of grey are just two shades of grey.
  const legend = el('div', 'chart-legend');
  for (const [className, label, total] of [
    ['key-received', 'reçus', received.reduce((sum, count) => sum + count, 0)],
    ['key-resolved', 'traités', resolved.reduce((sum, count) => sum + count, 0)],
  ] as const) {
    const item = el('span', 'chart-key');
    item.append(el('span', `key-swatch ${className}`), document.createTextNode(`${label} · ${total}`));
    legend.append(item);
  }

  const block = el('div', 'chart-block');
  block.append(frame, axis, legend);
  return block;
}

/** One horizontal bar per status, in the same ink-to-grey ramp as the list. */
function statusBreakdown(stats: Stats) {
  const list = el('div', 'breakdown');
  const peak = Math.max(1, ...Object.values(stats.byStatus));
  for (const [status, label] of Object.entries(STATUS_LABELS)) {
    const count = stats.byStatus[status] ?? 0;
    const row = el('div', 'breakdown-row');
    const name = el('span', `status ${status}`);
    const dot = el('span', 'dot');
    dot.setAttribute('aria-hidden', 'true');
    name.append(dot, document.createTextNode(label));
    const track = el('span', 'breakdown-track');
    const fill = el('span', `breakdown-fill ${status}`);
    fill.style.width = `${(count / peak) * 100}%`;
    track.append(fill);
    const value = el('span', 'breakdown-value', String(count));
    row.append(name, track, value);
    list.append(row);
  }
  const open = (stats.byStatus.TODO ?? 0) + (stats.byStatus.IN_PROGRESS ?? 0) + (stats.byStatus.REVIEW ?? 0);
  const share = stats.total ? Math.round((open / stats.total) * 100) : 0;
  const footer = el('p', 'breakdown-note');
  footer.textContent = stats.total
    ? `${open} retour${open === 1 ? '' : 's'} encore ouvert${open === 1 ? '' : 's'}, soit ${share} % de tout ce qui a été reçu.`
    : 'Aucun retour reçu pour l’instant.';
  list.append(footer);
  return list;
}

function projectTable(stats: Stats) {
  const table = el('table', 'stat-table');
  const head = el('thead');
  const headRow = el('tr');
  for (const [label, className] of [
    ['Projet', ''],
    ['À traiter', 'num'],
    ['En cours', 'num'],
    ['À valider', 'num'],
    ['Traité', 'num'],
  ] as const) {
    headRow.append(el('th', className, label));
  }
  head.append(headRow);
  const body = el('tbody');
  for (const project of stats.projects) {
    const row = el('tr');
    const cell = el('td');
    cell.append(el('strong', '', project.name), el('span', 'muted', project.clientLabel));
    row.append(cell);
    for (const count of [project.todo, project.inProgress, project.review, project.done]) {
      row.append(el('td', 'num', String(count)));
    }
    // Clicking a line is the obvious move once the numbers say where the work is.
    row.onclick = () => {
      void chooseProject(project.id);
    };
    body.append(row);
  }
  table.append(head, body);
  const scroll = el('div', 'table-scroll');
  scroll.append(table);
  return scroll;
}

function activityFeed(stats: Stats) {
  const list = el('div', 'feed');
  if (!stats.activity.length) {
    list.append(el('p', 'thread-empty', 'Aucun mouvement. Les agents connectés et l’équipe écrivent ici.'));
    return list;
  }
  for (const entry of stats.activity) {
    const item = el('div', `feed-row ${entry.author}`);
    const head = el('div', 'feed-head');
    head.append(el('strong', '', entry.authorLabel || (entry.author === 'agent' ? 'Agent' : 'Équipe')));
    if (entry.statusTo && entry.statusTo !== entry.statusFrom) {
      head.append(
        el(
          'span',
          'tag move',
          `${STATUS_LABELS[entry.statusFrom ?? ''] ?? entry.statusFrom} → ${STATUS_LABELS[entry.statusTo] ?? entry.statusTo}`,
        ),
      );
    }
    const when = el('span', 'feed-when', formatAge(entry.createdAt));
    when.title = formatDate(entry.createdAt);
    head.append(when);
    const subject = el('button', 'feed-subject', entry.ticketText);
    subject.type = 'button';
    subject.onclick = async () => {
      await showTickets();
      const known = tickets.find((ticket) => ticket.id === entry.ticketId);
      if (known) openTicket(known.id);
      else toast('Ce retour est hors des filtres actuels.', 'error');
    };
    item.append(head, subject);
    list.append(item);
  }
  return list;
}

function panel(title: string, hint: string, body: HTMLElement, variant: string) {
  const section = el('section', `panel panel-${variant}`);
  const head = el('div', 'panel-head');
  head.append(el('h2', '', title), el('span', 'panel-hint', hint));
  section.append(head, body);
  return section;
}

function renderOverview(stats: Stats) {
  const host = $('#overview');
  host.replaceChildren();

  const open = stats.byStatus.TODO! + stats.byStatus.IN_PROGRESS! + stats.byStatus.REVIEW!;
  const kpis = el('div', 'kpi-row');
  kpis.append(
    kpi(
      'À traiter',
      String(stats.byStatus.TODO ?? 0),
      stats.oldestTodo ? `le plus ancien : ${formatAge(stats.oldestTodo)}` : 'rien en attente',
      stats.stale > 0 ? 'up' : 'plain',
    ),
    kpi('Ouverts', String(open), `dont ${stats.stale} depuis plus de 7 jours`, stats.stale > 0 ? 'up' : 'plain'),
    (() => {
      const delta = deltaNote(stats.received, stats.receivedPrevious, stats.days);
      return kpi(`Reçus · ${stats.days} j`, String(stats.received), delta.text, delta.tone);
    })(),
    (() => {
      const delta = deltaNote(stats.resolved, stats.resolvedPrevious, stats.days);
      return kpi(`Traités · ${stats.days} j`, String(stats.resolved), delta.text, delta.tone);
    })(),
    kpi(
      'Délai moyen',
      stats.resolutionSeconds === null ? '—' : humanDuration(stats.resolutionSeconds),
      stats.resolutionSeconds === null ? 'aucun retour traité sur la période' : 'du dépôt au statut « traité »',
    ),
  );

  const grid = el('div', 'panel-grid');
  // The checklist sits above everything until the instance is genuinely set up,
  // then vanishes without leaving a trace of itself.
  if (onboarding && onboarding.connectedAgents === 0) grid.append(onboardingPanel(onboarding));
  // Nothing has happened yet: a wall of zeros teaches less than the checklist.
  if (onboarding && onboarding.tickets === 0) {
    host.append(grid);
    return;
  }
  grid.append(
    panel('Activité', `reçus et traités, ${stats.days} derniers jours`, activityChart(stats), 'chart'),
    panel('Répartition', `${stats.total} retour${stats.total === 1 ? '' : 's'} au total`, statusBreakdown(stats), 'breakdown'),
    panel('Par projet', 'cliquez une ligne pour filtrer', projectTable(stats), 'projects'),
    panel(
      'Pages les plus signalées',
      `sur ${stats.days} jours`,
      (() => {
        const list = el('div', 'page-list');
        if (!stats.pages.length) list.append(el('p', 'thread-empty', 'Aucun retour sur la période.'));
        for (const page of stats.pages) {
          const row = el('div', 'page-row');
          let label = page.pageUrl;
          try {
            label = new URL(page.pageUrl).pathname || '/';
          } catch {
            // A stored URL that no longer parses stays readable as written.
          }
          const name = el('span', 'page-name', label);
          name.title = page.pageUrl;
          row.append(name, el('span', 'page-count', `${page.count} · ${page.open} ouvert${page.open === 1 ? '' : 's'}`));
          list.append(row);
        }
        return list;
      })(),
      'pages',
    ),
    panel('Derniers mouvements', 'journal, tous retours confondus', activityFeed(stats), 'feed'),
  );

  host.append(kpis, grid);
}

/** The shape of the answer, drawn while the answer is on its way. */
function renderStatsSkeleton() {
  const host = $('#overview');
  if (host.querySelector('.kpi-row')) return;
  const kpis = el('div', 'kpi-row');
  for (let index = 0; index < 5; index++) kpis.append(el('div', 'skeleton skeleton-kpi'));
  const grid = el('div', 'panel-grid');
  for (const variant of ['chart', 'breakdown', 'projects', 'pages', 'feed']) {
    grid.append(el('div', `skeleton skeleton-panel panel-${variant}`));
  }
  host.replaceChildren(kpis, grid);
}

async function loadStats() {
  const params = new URLSearchParams({ days: $<HTMLSelectElement>('#period').value });
  if (selectedProject) params.set('projectId', selectedProject);
  const scope = $('#stats-scope');
  renderStatsSkeleton();
  try {
    const stats = (await api(`/api/stats?${params}`)) as Stats;
    scope.textContent = selectedProject ? 'Projet sélectionné' : 'Tous les projets';
    renderOverview(stats);
  } catch {
    scope.textContent = '';
    $('#overview').replaceChildren(
      emptyState('i-chart', 'Statistiques indisponibles', 'Le serveur n’a pas répondu. Réessayez dans un instant.'),
    );
  }
}

/** Which half of the workspace is on screen; the nav tabs own this. */
let view: 'tickets' | 'overview' = 'tickets';

function applyView() {
  const overview = view === 'overview';
  $<HTMLElement>('#overview').hidden = !overview;
  $<HTMLElement>('#config-overview').hidden = !overview;
  $<HTMLElement>('#tickets-view').hidden = overview;
  $<HTMLElement>('#config-tickets').hidden = overview;
  $('#tab-overview').setAttribute('aria-current', String(overview));
  $('#tab-tickets').setAttribute('aria-current', String(!overview));
}

async function showOverview() {
  view = 'overview';
  applyView();
  await loadStats();
}

async function showTickets() {
  const wasOverview = view === 'overview';
  view = 'tickets';
  applyView();
  if (wasOverview) await loadTickets();
}

$('#tab-overview').addEventListener('click', () => void showOverview());

// ------------------------------------------------------------ command palette

function paletteIcon(id: string) {
  return () => {
    const tile = document.createElement('span');
    tile.className = 'palette-icon';
    tile.append(icon(id));
    return tile;
  };
}

function paletteItems(): PaletteItem[] {
  const click = (selector: string) => () => $<HTMLButtonElement>(selector).click();
  const items: PaletteItem[] = [
    { group: 'Navigation', label: 'Vue d’ensemble', keywords: 'statistiques tableau de bord', leading: paletteIcon('i-chart'), run: () => void showOverview() },
    { group: 'Navigation', label: 'Retours', keywords: 'tickets liste inbox', leading: paletteIcon('i-inbox'), run: () => void showTickets() },
    { group: 'Projets', label: 'Tous les projets', hint: `${projects.length} projet${projects.length === 1 ? '' : 's'}`, leading: () => projectAvatar('', ''), run: () => void chooseProject('') },
  ];
  for (const project of projects) {
    items.push({
      group: 'Projets',
      label: project.name,
      hint: project.clientLabel,
      leading: () => projectAvatar(project.id, project.name),
      run: () => void chooseProject(project.id),
    });
  }
  for (const ticket of tickets.slice(0, 30)) {
    items.push({
      group: 'Retours',
      label: ticket.text,
      hint: STATUS_LABELS[ticket.status] ?? ticket.status,
      keywords: `${ticket.projectName} ${ticket.pageUrl}`,
      leading: () => projectAvatar(ticket.projectId, ticket.projectName),
      run: () => {
        void showTickets().then(() => {
          if (tickets.some((candidate) => candidate.id === ticket.id)) openTicket(ticket.id);
        });
      },
    });
  }
  items.push(
    { group: 'Actions', label: 'Nouveau projet', keywords: 'creer ajouter', leading: paletteIcon('i-plus'), run: click('#new-project') },
    { group: 'Actions', label: 'Installer le widget et liens reviewer', keywords: 'integration script snippet partager', leading: paletteIcon('i-code'), run: click('#review-link') },
    { group: 'Actions', label: 'Copier le lien client', keywords: 'partager url', leading: paletteIcon('i-copy'), run: click('#copy-quick-link') },
    { group: 'Actions', label: 'Accès agents', keywords: 'claude cursor mcp ia', leading: paletteIcon('i-robot'), run: click('#agent-access') },
    { group: 'Actions', label: 'Exporter pour Claude Code', keywords: 'prompt markdown', leading: paletteIcon('i-copy'), run: click('#export-prompt') },
    { group: 'Actions', label: 'Personnalisation de l’instance', keywords: 'marque blanche logo couleur branding', leading: paletteIcon('i-image'), run: click('#branding') },
    { group: 'Actions', label: 'Basculer le thème clair / sombre', keywords: 'dark mode nuit', leading: paletteIcon('i-moon'), run: click('#theme') },
    { group: 'Actions', label: 'Se déconnecter', keywords: 'logout quitter', leading: paletteIcon('i-logout'), run: click('#logout') },
  );
  return items;
}

const palette = initPalette(paletteItems);
$('#palette-open').addEventListener('click', () => {
  toggleNav(false);
  palette.open();
});
$('#tab-tickets').addEventListener('click', () => void showTickets());
$('#period').addEventListener('change', () => void loadStats());

// --------------------------------------------------------------- work log

/**
 * One ticket's history: every comment left by the team or by a connected agent,
 * with the status move that came with it. This is where an operator reads what
 * an AI agent did without opening the code.
 */
/**
 * The ticket's history as a conversation: the client's request first, then
 * every reply, internal message, agent report and status move, oldest first.
 */
async function renderConversation(ticket: Ticket, host: HTMLElement) {
  const opened = el('div', 'event');
  const when = el('time', '', formatAge(ticket.createdAt));
  when.dateTime = ticket.createdAt;
  when.title = formatDate(ticket.createdAt);
  opened.append(icon('i-inbox'), el('span', '', 'Retour reçu du client'), when);

  let comments: Comment[] = [];
  try {
    comments = ((await api(`/api/tickets/${ticket.id}/comments`)) as { comments: Comment[] }).comments;
  } catch {
    host.replaceChildren(opened, el('p', 'thread-empty', 'Échanges indisponibles.'));
    return;
  }

  const entries: HTMLElement[] = [opened];
  for (const comment of comments) {
    const entry = el('article', `comment ${comment.author} ${comment.visibility}`);
    const meta = el('div', 'comment-meta');
    const name = comment.authorLabel || (comment.author === 'agent' ? 'Agent' : 'Équipe');
    const avatar = el('span', 'comment-avatar', (name.trim()[0] ?? '?').toUpperCase());
    avatar.setAttribute('aria-hidden', 'true');
    const time = el('time', '', formatAge(comment.createdAt));
    time.dateTime = comment.createdAt;
    time.title = formatDate(comment.createdAt);
    meta.append(avatar, el('strong', '', name));
    meta.append(el('span', `tag ${comment.visibility}`, comment.visibility === 'reviewer' ? 'Envoyé au client' : 'Interne'));
    if (comment.statusTo && comment.statusTo !== comment.statusFrom) {
      const from = STATUS_LABELS[comment.statusFrom ?? ''] ?? comment.statusFrom;
      const to = STATUS_LABELS[comment.statusTo] ?? comment.statusTo;
      meta.append(el('span', 'tag move', `${from} → ${to}`));
    }
    meta.append(time);
    // textContent, never innerHTML: an agent writes this text.
    entry.append(meta, el('p', '', comment.body));
    entries.push(entry);
  }
  if (!comments.length) {
    entries.push(el('p', 'thread-empty', 'Aucun échange pour l’instant. Répondez au client ou laissez un message à l’équipe.'));
  }
  host.replaceChildren(...entries);
}

// ------------------------------------------------------------ prompt export

/** The API caps a page at 200 rows, and an export must not stop at the first. */
const EXPORT_PAGE = 200;
/** A prompt past this many tickets stops being pasteable; say so rather than truncate silently. */
const EXPORT_MAX = 400;

/**
 * Every ticket still to triage, under the filters currently on screen — the
 * status filter excepted, which the export forces to TODO: the point is to hand
 * over the untreated backlog, not whatever the operator was last looking at.
 */
async function fetchPendingTickets(): Promise<{ tickets: Ticket[]; truncated: boolean }> {
  const params = filterParams();
  params.set('status', 'TODO');
  params.set('limit', String(EXPORT_PAGE));
  const collected: Ticket[] = [];
  let cursor: string | null = null;
  do {
    if (cursor) params.set('cursor', cursor);
    const payload = await api(`/api/tickets?${params}`);
    collected.push(...payload.tickets);
    cursor = payload.nextCursor;
  } while (cursor && collected.length < EXPORT_MAX);
  // The list arrives newest first; a worklist reads better oldest first.
  return { tickets: collected.slice(0, EXPORT_MAX).reverse(), truncated: Boolean(cursor) };
}

/** Human-readable recap of the filters in force, so the prompt says what it covers. */
function activeFilterLabels(): string[] {
  const labels: string[] = [];
  const project = projects.find((candidate) => candidate.id === selectedProject);
  if (project) labels.push(`projet « ${project.name} » (${project.clientLabel})`);
  const client = $<HTMLSelectElement>('#client').value;
  if (client && !project) labels.push(`client « ${client} »`);
  const page = $<HTMLInputElement>('#page-filter').value.trim();
  if (page) labels.push(`pages contenant « ${page} »`);
  const format = $<HTMLSelectElement>('#format').value;
  if (format) labels.push(format === 'mobile' ? 'format mobile' : 'format desktop');
  return labels;
}

function diagnosticsLine(diagnostics: Record<string, unknown>): string {
  const parts = Object.entries(diagnostics)
    .filter(([, value]) => value !== 'Unknown' && value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key} ${Array.isArray(value) ? value.join(', ') : String(value)}`);
  return parts.length ? parts.join(' · ') : 'non transmis';
}

function ticketBlock(ticket: Ticket, index: number): string {
  const { selector, relative: point, viewport } = ticket.anchor;
  const format = ticket.viewportWidth < 768 ? 'Mobile' : 'Desktop';
  const lines = [
    `## ${index}. « ${ticket.text.trim()} »`,
    '',
    // Repeated on every ticket, not only in the header: an export across
    // projects is unreadable otherwise, and the block stays quotable alone.
    `- Projet : ${ticket.projectName} (${ticket.clientLabel})`,
    `- Page : ${ticket.pageUrl}`,
    `- Élément visé : \`${selector}\` — clic à ${Math.round(point.x * 100)} %, ${Math.round(point.y * 100)} % de l’élément`,
    `- Écran du reviewer : ${viewport.width}×${viewport.height} (${format})`,
    `- Environnement : ${diagnosticsLine(ticket.diagnostics)}`,
    `- Reçu le ${formatDate(ticket.createdAt)} · ticket ${ticket.id}`,
    `- Rouvrir à l’ancrage : ${anchorUrl(ticket)}`,
  ];
  // Absolute: the prompt is read outside this page, where a /api/… path means nothing.
  if (ticket.screenshotId) lines.push(`- Capture (accès admin requis) : ${location.origin}/api/uploads/${ticket.screenshotId}`);
  if (ticket.response.trim()) lines.push(`- Note interne : ${ticket.response.trim()}`);
  return lines.join('\n');
}

function buildPrompt(tickets: Ticket[], truncated: boolean): string {
  const filters = activeFilterLabels();
  const head = [
    `# ${tickets.length} retour${tickets.length === 1 ? '' : 's'} client à traiter`,
    '',
    filters.length ? `Périmètre : ${filters.join(', ')}.` : 'Périmètre : tous les projets.',
    `Export ReviewDesk du ${formatDate(new Date().toISOString())}.`,
    '',
    'Chaque retour ci-dessous vient d’un client qui a cliqué un élément précis de la page :',
    'le sélecteur CSS désigne cet élément, les pourcentages situent le point cliqué à',
    'l’intérieur de celui-ci. Traite-les un par un, en commençant par ceux qui touchent',
    'la même page ou le même composant, et dis pour chacun ce que tu as changé.',
  ];
  if (truncated) {
    head.push('', `_Seuls les ${EXPORT_MAX} plus anciens retours sont inclus : filtrez par projet pour le reste._`);
  }
  return [head.join('\n'), ...tickets.map((ticket, index) => ticketBlock(ticket, index + 1))].join('\n\n---\n\n') + '\n';
}

$('#export-prompt').addEventListener('click', async () => {
  const button = $<HTMLButtonElement>('#export-prompt');
  const output = $<HTMLTextAreaElement>('#export-output');
  const summary = $<HTMLElement>('#export-summary');
  const copy = $<HTMLButtonElement>('#export-copy');
  button.disabled = true;
  try {
    const { tickets: pending, truncated } = await fetchPendingTickets();
    copy.disabled = !pending.length;
    if (!pending.length) {
      output.value = '';
      summary.textContent = 'Aucun retour « À traiter » sous ces filtres. Rien à exporter.';
    } else {
      output.value = buildPrompt(pending, truncated);
      summary.textContent =
        `${pending.length} retour${pending.length === 1 ? '' : 's'} « À traiter »` +
        `${truncated ? ` (limité à ${EXPORT_MAX})` : ''} — collez ce bloc tel quel dans Claude Code.`;
    }
    $<HTMLDialogElement>('#export-dialog').showModal();
  } catch {
    toast('Export impossible.', 'error');
  } finally {
    button.disabled = false;
  }
});

$('#export-copy').addEventListener('click', async () => {
  const output = $<HTMLTextAreaElement>('#export-output');
  try {
    await navigator.clipboard.writeText(output.value);
    toast('Prompt copié.');
  } catch {
    // No clipboard permission (or an insecure origin): select it so Ctrl+C works.
    output.focus();
    output.select();
    toast('Copie automatique refusée : le texte est sélectionné, faites Ctrl+C.', 'error');
  }
});

// ------------------------------------------------------------- code utilities

/** Copy with a confirmation on the button itself, not in a toast far away. */
async function copyButton(label: string, value: () => string) {
  const button = el('button', 'btn btn-ghost copy');
  button.type = 'button';
  button.append(icon('i-copy'), document.createTextNode(label));
  button.onclick = async () => {
    try {
      await navigator.clipboard.writeText(value());
      button.classList.add('copied');
      button.replaceChildren(icon('i-check'), document.createTextNode('Copié'));
      setTimeout(() => {
        button.classList.remove('copied');
        button.replaceChildren(icon('i-copy'), document.createTextNode(label));
      }, 1600);
    } catch {
      toast('Copie refusée par le navigateur. Sélectionnez le texte.', 'error');
    }
  };
  return button;
}

/**
 * Just enough colour to read a snippet at a glance: comments, tags, attribute
 * names and quoted values. Built from text nodes, so nothing is ever parsed.
 */
const CODE_TOKEN = /(<!--[\s\S]*?-->)|("[^"\n]*"|'[^'\n]*'|`[^`\n]*`)|(<\/?[\w.-]+|\/?>)|([\w-]+)(?==)/g;
const CODE_CLASSES = ['tk-comment', 'tk-string', 'tk-tag', 'tk-attr'];

function highlight(pre: HTMLElement, text: string) {
  let last = 0;
  for (const match of text.matchAll(CODE_TOKEN)) {
    const start = match.index;
    if (start > last) pre.append(text.slice(last, start));
    const group = match.slice(1).findIndex((part) => part !== undefined);
    pre.append(el('span', CODE_CLASSES[group] ?? '', match[0]));
    last = start + match[0].length;
  }
  if (last < text.length) pre.append(text.slice(last));
}

function codeBlock(text: string, copyLabel = 'Copier') {
  const block = el('div', 'code-block');
  const pre = el('pre', 'code');
  highlight(pre, text);
  block.append(pre);
  void copyButton(copyLabel, () => text).then((button) => block.append(button));
  return block;
}

// ------------------------------------------------------------- review links & widget onboarding

type WidgetPlatform = {
  id: string;
  name: string;
  hint: string;
  badge: string;
  badgeHighlight?: boolean;
  mark: string;
  where: string;
  generate: (ctx: {
    origin: string;
    projectId: string;
    token: string;
    previewOrigin: string;
    position: string;
    theme: string;
    label: string;
  }) => string;
};

const WIDGET_PLATFORMS: WidgetPlatform[] = [
  {
    id: 'html',
    name: 'HTML / Statique',
    hint: 'Balise <script>',
    badge: 'Universel',
    mark: 'i-html5',
    where: 'À coller juste avant la fermeture de </body> sur vos pages de test.',
    generate: ({ origin, projectId, token, position, theme, label }) => {
      const attrs = [
        `src="${origin}/widget.js"`,
        `data-api="${origin}"`,
        `data-project="${projectId}"`,
        `data-token="${token}"`,
      ];
      if (position !== 'bottom-right') attrs.push(`data-position="${position}"`);
      if (theme !== 'auto') attrs.push(`data-theme="${theme}"`);
      if (label.trim()) attrs.push(`data-label="${label.trim()}"`);
      return `<!-- ReviewDesk — Widget de retour visuel -->\n<script\n  ${attrs.join('\n  ')}\n  defer>\n</script>`;
    },
  },
  {
    id: 'nextjs',
    name: 'Next.js & React',
    hint: 'app/layout.tsx',
    badge: 'Recommandé',
    badgeHighlight: true,
    mark: 'i-react',
    where: 'Dans app/layout.tsx (Next.js App Router) ou pages/_app.tsx. Hors production uniquement.',
    generate: ({ origin, projectId, token, position, theme, label }) => {
      const extra = [];
      if (position !== 'bottom-right') extra.push(`            data-position="${position}"`);
      if (theme !== 'auto') extra.push(`            data-theme="${theme}"`);
      if (label.trim()) extra.push(`            data-label="${label.trim()}"`);
      const extraStr = extra.length ? '\n' + extra.join('\n') : '';
      return (
        `import Script from 'next/script';\n\n` +
        `export default function RootLayout({ children }: { children: React.ReactNode }) {\n` +
        `  return (\n` +
        `    <html lang="fr">\n` +
        `      <body>\n` +
        `        {children}\n` +
        `        {process.env.NODE_ENV !== 'production' && (\n` +
        `          <Script\n` +
        `            src="${origin}/widget.js"\n` +
        `            data-api="${origin}"\n` +
        `            data-project="${projectId}"\n` +
        `            data-token="${token}"${extraStr}\n` +
        `            strategy="afterInteractive"\n` +
        `          />\n` +
        `        )}\n` +
        `      </body>\n` +
        `    </html>\n` +
        `  );\n` +
        `}`
      );
    },
  },
  {
    id: 'cms',
    name: 'Webflow / WordPress',
    hint: 'Custom Code / Footer',
    badge: 'No-Code',
    mark: 'i-webflow',
    where: 'Dans les réglages de votre CMS > Code personnalisé (Footer / avant </body>).',
    generate: ({ origin, projectId, token, position, theme, label }) => {
      const attrs = [
        `src="${origin}/widget.js"`,
        `data-api="${origin}"`,
        `data-project="${projectId}"`,
        `data-token="${token}"`,
      ];
      if (position !== 'bottom-right') attrs.push(`data-position="${position}"`);
      if (theme !== 'auto') attrs.push(`data-theme="${theme}"`);
      if (label.trim()) attrs.push(`data-label="${label.trim()}"`);
      return `<!-- ReviewDesk (Footer Code) -->\n<script\n  ${attrs.join('\n  ')}>\n</script>`;
    },
  },
  {
    id: 'direct',
    name: 'Lien direct (sans code)',
    hint: 'Zéro code dans le site',
    badge: 'Zéro code',
    mark: 'i-share-direct',
    where: 'Partagez cette URL au client. Le token voyage dans le fragment d’URL sans toucher au code du site.',
    generate: ({ previewOrigin, projectId, token }) =>
      `${previewOrigin}/#project=${projectId}&review=${token}`,
  },
];

let installWizardStep = 1;
let currentPlatform: WidgetPlatform = WIDGET_PLATFORMS[0]!;
let activeProjectToken = '';
let activeProjectTokenId = '';
let widgetOptPosition = 'bottom-right';
let widgetOptTheme = 'auto';
let widgetOptLabel = '';
let widgetConnectionTimer: ReturnType<typeof setTimeout> | undefined;

function applyInstallWizardStep() {
  for (const section of document.querySelectorAll<HTMLElement>('.link-wizard-step')) {
    section.hidden = Number(section.dataset.step) !== installWizardStep;
  }
  for (const item of document.querySelectorAll<HTMLElement>('#link-wizard-steps li')) {
    const step = Number(item.dataset.step);
    item.classList.toggle('done', step < installWizardStep);
    item.classList.toggle('current', step === installWizardStep);
  }
  $<HTMLElement>('#link-wizard-back').hidden = installWizardStep === 1;
  const next = $<HTMLButtonElement>('#link-wizard-next');
  next.textContent = installWizardStep === 3 ? 'Terminé' : 'Continuer';
  $('#link-dialog-title').textContent =
    installWizardStep === 1
      ? 'Installer le widget'
      : installWizardStep === 2
        ? `Intégration — ${currentPlatform.name}`
        : 'Vérification de l’installation';
}

function renderPlatformPicker() {
  const host = $('#widget-platform-picker');
  host.replaceChildren();
  for (const platform of WIDGET_PLATFORMS) {
    const card = el('button', `platform-card ${currentPlatform.id === platform.id ? 'active' : ''}`);
    card.type = 'button';
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', String(currentPlatform.id === platform.id));

    const head = el('div', 'platform-card-head');
    const glyph = el('span', 'platform-glyph');
    const logoSvg = icon(platform.mark);
    logoSvg.classList.add('logo');
    glyph.append(logoSvg);

    const badge = el('span', `platform-badge ${platform.badgeHighlight ? 'highlight' : ''}`, platform.badge);
    head.append(glyph, badge);

    card.append(head, el('strong', '', platform.name), el('span', 'platform-hint', platform.hint));
    card.onclick = () => {
      currentPlatform = platform;
      renderPlatformPicker();
      if (activeProjectToken) renderWidgetSnippet();
      updateWidgetPreview();
    };
    host.append(card);
  }
}

function renderWidgetSnippet() {
  const container = $('#widget-snippet-container');
  container.replaceChildren();
  const project = projects.find((p) => p.id === selectedProject);
  const origin = location.origin;
  const previewOrigin = project?.origins[0] || origin;
  const token = activeProjectToken || 'VOTRE_JETON_REVIEWER';

  $('#link-step-desc').textContent = currentPlatform.where;

  const codeText = currentPlatform.generate({
    origin,
    projectId: selectedProject,
    token,
    previewOrigin,
    position: widgetOptPosition,
    theme: widgetOptTheme,
    label: widgetOptLabel,
  });

  container.append(codeBlock(codeText, 'Copier le code'));
  const mobileNotice = el('p', 'note wizard-mobile-notice');
  mobileNotice.append(
    icon('i-phone'),
    document.createTextNode('Sur mobile, le panneau s’ouvre en tiroir depuis le bas de l’écran, avec capture tactile.'),
  );
  container.append(mobileNotice);
  updateWidgetPreview();

  // Update preview links for step 3
  $('#test-preview-target').textContent = `Préproduction : ${previewOrigin}`;
  const testPreviewUrl = `${previewOrigin}/#api=${encodeURIComponent(origin)}&project=${selectedProject}&review=${token}`;
  const testDemoUrl = `/demo.html#api=${encodeURIComponent(origin)}&project=${selectedProject}&review=${token}`;
  $<HTMLAnchorElement>('#test-preview-link').href = testPreviewUrl;
  $<HTMLAnchorElement>('#test-demo-link').href = testDemoUrl;

  // Keep #link-output updated for Playwright tests and legacy callers
  $<HTMLTextAreaElement>('#link-output').value =
    `URL reviewer DEMO : ${previewOrigin}/#project=${selectedProject}&review=${token}\n\n` +
    `Installation dans la preview — une seule ligne à coller avant </body> :\n` +
    `<script src="${origin}/widget.js" data-api="${origin}" ` +
    `data-project="${selectedProject}" data-token="${token}"></script>`;
}

function watchWidgetConnection(status: HTMLElement) {
  clearTimeout(widgetConnectionTimer);
  const started = Date.now();
  const poll = async () => {
    if (!$<HTMLDialogElement>('#link-dialog').open) return;
    let connected = false;
    try {
      const { links } = (await api(`/api/projects/${selectedProject}/review-links`)) as { links: ReviewLink[] };
      const mine = activeProjectTokenId
        ? links.find((l) => l.id === activeProjectTokenId)
        : links.find((l) => !l.revokedAt && l.lastUsedAt);
      connected = Boolean(mine?.lastUsedAt);
      if (connected) {
        status.className = 'widget-connection connected';
        status.replaceChildren(
          icon('i-check'),
          el('strong', '', 'Widget connecté et actif'),
          el('span', '', `première interaction ${formatAge(mine!.lastUsedAt!)}`),
        );
        await refreshOnboarding();
        return;
      }
    } catch {
      // Keep waiting quietly
    }
    if (Date.now() - started > 120_000) {
      status.className = 'widget-connection idle';
      status.replaceChildren(
        el('strong', '', 'Toujours pas de requête'),
        el('span', '', 'Le widget répondra dès qu’un reviewer ouvrira votre site de préproduction.'),
      );
      return;
    }
    widgetConnectionTimer = setTimeout(() => void poll(), 2_500);
  };
  widgetConnectionTimer = setTimeout(() => void poll(), 1_500);
}

async function renderReviewLinks() {
  const container = $('#link-list');
  container.replaceChildren();
  if (!selectedProject) return;
  const { links } = (await api(`/api/projects/${selectedProject}/review-links`)) as { links: ReviewLink[] };
  if (!links.length) {
    const empty = document.createElement('p');
    empty.textContent = 'Aucun lien pour ce projet.';
    container.append(empty);
    return;
  }
  for (const link of links) {
    const row = document.createElement('div');
    row.className = 'link-row';
    const description = document.createElement('span');
    const used = link.lastUsedAt ? `utilisé ${formatDate(link.lastUsedAt)}` : 'jamais utilisé';
    description.textContent = link.revokedAt
      ? `Révoqué ${formatDate(link.revokedAt)} · créé ${formatDate(link.createdAt)}`
      : `Actif · créé ${formatDate(link.createdAt)} · ${used}`;
    row.append(description);
    if (!link.revokedAt) {
      const revoke = document.createElement('button');
      revoke.type = 'button';
      revoke.className = 'btn btn-danger';
      revoke.textContent = 'Révoquer';
      revoke.onclick = async () => {
        revoke.disabled = true;
        await api(`/api/projects/${selectedProject}/review-links/${link.id}/revoke`, { method: 'POST' });
        await renderReviewLinks();
        await refreshOnboarding();
      };
      row.append(revoke);
    }
    container.append(row);
  }
}

$('#copy-quick-link').addEventListener('click', async () => {
  hideOnboardingPrompt();
  if (!selectedProject) {
    toast('Sélectionnez d’abord un projet dans la colonne de gauche.', 'error');
    return;
  }
  const button = $<HTMLButtonElement>('#copy-quick-link');
  button.disabled = true;
  try {
    let token = activeProjectToken;
    if (!token) {
      const link = (await api(`/api/projects/${selectedProject}/review-links`, { method: 'POST', body: '{}' })) as {
        id: string;
        token: string;
        fragment: string;
      };
      token = link.token;
      activeProjectToken = token;
      activeProjectTokenId = link.id;
      await refreshOnboarding();
    }
    const origin = projects.find((p) => p.id === selectedProject)?.origins[0] || location.origin;
    const directUrl = `${origin}/#project=${selectedProject}&review=${token}`;
    await navigator.clipboard.writeText(directUrl);
    toast('Lien reviewer copié dans le presse-papiers !');
  } catch {
    toast('Impossible de copier le lien reviewer.', 'error');
  } finally {
    button.disabled = false;
  }
});

// Opening the dialog only reads. Minting a secret is a separate, deliberate
// action, so revoking a link never requires creating another one first.
$('#review-link').addEventListener('click', async () => {
  hideOnboardingPrompt();
  if (!selectedProject) {
    toast('Sélectionnez d’abord un projet dans la colonne de gauche.', 'error');
    return;
  }
  const project = projects.find((p) => p.id === selectedProject);
  $('#link-project-badge').textContent = project?.name ?? 'Projet';
  installWizardStep = 1;
  applyInstallWizardStep();
  renderPlatformPicker();
  await renderReviewLinks();
  $<HTMLDialogElement>('#link-dialog').showModal();
});

$('#new-link').addEventListener('click', async () => {
  if (!selectedProject) return;
  const button = $<HTMLButtonElement>('#new-link');
  button.disabled = true;
  try {
    const link = (await api(`/api/projects/${selectedProject}/review-links`, { method: 'POST', body: '{}' })) as {
      id: string;
      token: string;
      fragment: string;
    };
    activeProjectToken = link.token;
    activeProjectTokenId = link.id;
    const origin = projects.find((project) => project.id === selectedProject)?.origins[0] || location.origin;
    $<HTMLTextAreaElement>('#link-output').value =
      `URL reviewer DEMO : ${origin}/${link.fragment}\n\n` +
      `Installation dans la preview — une seule ligne à coller avant </body> :\n` +
      `<script src="${location.origin}/widget.js" data-api="${location.origin}" ` +
      `data-project="${selectedProject}" data-token="${link.token}"></script>`;
    await renderReviewLinks();
    await refreshOnboarding();
    installWizardStep = 2;
    applyInstallWizardStep();
    renderWidgetSnippet();
  } finally {
    button.disabled = false;
  }
});

$('#link-wizard-back').addEventListener('click', () => {
  installWizardStep = Math.max(1, installWizardStep - 1);
  applyInstallWizardStep();
});

$('#link-wizard-next').addEventListener('click', async () => {
  if (installWizardStep === 3) {
    $<HTMLDialogElement>('#link-dialog').close();
    return;
  }
  if (installWizardStep === 1) {
    if (!activeProjectToken) {
      $<HTMLButtonElement>('#new-link').click();
      return;
    }
    installWizardStep = 2;
    applyInstallWizardStep();
    renderWidgetSnippet();
    return;
  }
  if (installWizardStep === 2) {
    installWizardStep = 3;
    applyInstallWizardStep();
    const status = $<HTMLElement>('#widget-connection-status');
    watchWidgetConnection(status);
    return;
  }
});

$('#link-dialog').addEventListener('close', () => {
  clearTimeout(widgetConnectionTimer);
});

// ------------------------------------------------------------ agent access

/**
 * Every client the wizard knows how to configure. `install` returns the block a
 * person pastes, and `where` says what to paste it into — the two questions
 * someone actually has when connecting a tool for the first time.
 */
type AgentTarget = {
  id: string;
  name: string;
  hint: string;
  /** Symbol id of the tool's own logo, drawn from the sprite sheet. */
  mark: string;
  where: string;
  language: string;
  install: (context: { token: string; origin: string; server: string }) => string;
};

const MCP_JSON = (key: string) => (context: { token: string; origin: string; server: string }) =>
  JSON.stringify(
    {
      [key]: {
        reviewdesk: {
          command: 'node',
          args: [context.server],
          env: { REVIEWDESK_URL: context.origin, REVIEWDESK_TOKEN: context.token },
        },
      },
    },
    null,
    2,
  );

const AGENT_TARGETS: AgentTarget[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    hint: 'CLI, une commande',
    mark: 'i-claude',
    where: 'À lancer dans un terminal, depuis le dépôt de votre site.',
    language: 'bash',
    install: ({ token, origin, server }) =>
      `claude mcp add reviewdesk \\\n  --env REVIEWDESK_URL=${origin} \\\n  --env REVIEWDESK_TOKEN=${token} \\\n  -- node ${server}`,
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    hint: '~/.codex/config.toml',
    mark: 'i-openai',
    where: 'À ajouter à la fin de ~/.codex/config.toml.',
    language: 'toml',
    install: ({ token, origin, server }) =>
      `[mcp_servers.reviewdesk]\ncommand = "node"\nargs = ["${server}"]\nenv = { REVIEWDESK_URL = "${origin}", REVIEWDESK_TOKEN = "${token}" }`,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    hint: '.cursor/mcp.json',
    mark: 'i-cursor',
    where: 'À créer à la racine du projet, dans .cursor/mcp.json.',
    language: 'json',
    install: MCP_JSON('mcpServers'),
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    hint: 'claude_desktop_config.json',
    mark: 'i-claude',
    where: 'Réglages → Développeur → Modifier la configuration, puis redémarrer l’application.',
    language: 'json',
    install: MCP_JSON('mcpServers'),
  },
  {
    id: 'vscode',
    name: 'VS Code',
    hint: '.vscode/mcp.json',
    mark: 'i-vscode',
    where: 'À créer à la racine du projet, dans .vscode/mcp.json.',
    language: 'json',
    install: MCP_JSON('servers'),
  },
  {
    id: 'api',
    name: 'Autre outil',
    hint: 'API HTTP, script, n8n…',
    mark: 'i-plug',
    where: 'N’importe quel client HTTP. Le jeton part en en-tête Authorization.',
    language: 'bash',
    install: ({ token, origin }) =>
      `# Les retours à traiter\ncurl -H "Authorization: Bearer ${token}" \\\n  "${origin}/api/agent/tickets?status=TODO"\n\n` +
      `# Traiter un retour et rendre compte\ncurl -X PATCH "${origin}/api/agent/tickets/UUID" \\\n  -H "Authorization: Bearer ${token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"status":"DONE","comment":"Contraste corrigé.","visibility":"reviewer"}'`,
  },
];

/** The prompt someone pastes into the agent once it is connected. */
const STARTER_PROMPT =
  'Tu es connecté à ReviewDesk (MCP). Liste les retours à traiter, ouvre-les un par un pour ' +
  'voir l’élément visé et la capture, corrige-les dans le code, puis passe chaque ticket à ' +
  '« À valider » en expliquant ce que tu as changé. Si la réponse intéresse le client, publie ' +
  'le commentaire en visibility "reviewer".';

const SERVER_PATH_KEY = 'reviewdesk-mcp-path';
const DEFAULT_SERVER_PATH = '/chemin/vers/reviewdesk/dist/mcp.js';

let wizardStep = 1;
let wizardTarget: AgentTarget = AGENT_TARGETS[0]!;
let wizardToken = '';
let wizardTokenId = '';
let connectionTimer: ReturnType<typeof setTimeout> | undefined;

function serverPath(): string {
  try {
    return localStorage.getItem(SERVER_PATH_KEY) || DEFAULT_SERVER_PATH;
  } catch {
    return DEFAULT_SERVER_PATH;
  }
}

function renderAgentPicker() {
  const host = $('#agent-picker');
  host.replaceChildren();
  for (const target of AGENT_TARGETS) {
    const card = el('button', `agent-card ${wizardTarget.id === target.id ? 'active' : ''}`);
    card.type = 'button';
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', String(wizardTarget.id === target.id));
    const glyph = el('span', 'agent-glyph');
    glyph.append(icon(target.mark, 'logo'));
    card.append(glyph, el('strong', '', target.name), el('span', 'agent-hint', target.hint));
    card.onclick = () => {
      wizardTarget = target;
      renderAgentPicker();
    };
    host.append(card);
  }
}

async function renderAgentTokens() {
  const container = $('#agent-existing');
  container.replaceChildren();
  const { tokens } = (await api('/api/agent-tokens')) as { tokens: AgentToken[] };
  const live = tokens.filter((token) => !token.revokedAt);
  if (!live.length) return;

  const title = el('h3', '', 'Agents déjà connectés');
  container.append(title);
  for (const token of live) {
    const row = el('div', 'link-row');
    const description = el('span');
    const scope = token.scope === 'read' ? 'lecture seule' : 'lecture/écriture';
    const where = token.projectName ?? 'tous les projets';
    const used = token.lastUsedAt ? `actif ${formatAge(token.lastUsedAt)}` : 'jamais utilisé';
    description.append(el('strong', '', token.label || 'Sans libellé'), el('span', 'muted', `${scope} · ${where} · ${used}`));
    const revoke = el('button', 'btn btn-danger', 'Révoquer');
    revoke.type = 'button';
    revoke.onclick = async () => {
      revoke.disabled = true;
      await api(`/api/agent-tokens/${token.id}/revoke`, { method: 'POST' });
      await renderAgentTokens();
      await refreshOnboarding();
    };
    row.append(description, revoke);
    container.append(row);
  }
}

/**
 * The moment that makes the whole thing believable: the page waits for the
 * agent's very first call and says so when it lands. Polling stops as soon as
 * it connects, when the dialog closes, or after two minutes.
 */
function watchConnection(status: HTMLElement) {
  const started = Date.now();
  const poll = async () => {
    if (!$<HTMLDialogElement>('#agent-dialog').open) return;
    let connected = false;
    try {
      const { tokens } = (await api('/api/agent-tokens')) as { tokens: AgentToken[] };
      const mine = tokens.find((token) => token.id === wizardTokenId);
      connected = Boolean(mine?.lastUsedAt);
      if (connected) {
        status.className = 'connection connected';
        status.replaceChildren(
          icon('i-check'),
          el('strong', '', 'Agent connecté'),
          el('span', '', `première requête ${formatAge(mine!.lastUsedAt!)}`),
        );
        await refreshOnboarding();
        return;
      }
    } catch {
      // A failed poll is not a failed connection; keep waiting quietly.
    }
    if (Date.now() - started > 120_000) {
      status.className = 'connection idle';
      status.replaceChildren(
        el('strong', '', 'Toujours pas de requête'),
        el('span', '', 'La configuration reste valable : relancez votre agent, il apparaîtra ici.'),
      );
      return;
    }
    connectionTimer = setTimeout(() => void poll(), 2_500);
  };
  connectionTimer = setTimeout(() => void poll(), 1_500);
}

function renderAgentResult() {
  const host = $('#agent-result');
  host.replaceChildren();
  const origin = location.origin;
  const target = wizardTarget;

  const secret = el('div', 'secret');
  secret.append(el('span', 'secret-label', 'Jeton — affiché une seule fois'));
  const field = el('div', 'secret-field');
  field.append(el('code', '', wizardToken));
  secret.append(field);
  void copyButton('Copier le jeton', () => wizardToken).then((button) => secret.append(button));
  host.append(secret);

  // Only the local clients need a path, and the person is the only one who
  // knows it — so they type it once and every snippet follows.
  if (target.id !== 'api') {
    const pathLabel = el('label', 'path-field');
    pathLabel.append(document.createTextNode('Chemin du serveur MCP sur votre machine'));
    const input = document.createElement('input');
    input.value = serverPath();
    input.spellcheck = false;
    pathLabel.append(input);
    const small = el('small', '', 'Le dépôt ReviewDesk après « npm run build ». Mémorisé pour la prochaine fois.');
    pathLabel.append(small);
    input.oninput = () => {
      try {
        localStorage.setItem(SERVER_PATH_KEY, input.value.trim() || DEFAULT_SERVER_PATH);
      } catch {
        // Private mode: the value simply lasts for this dialog.
      }
      renderSnippet();
    };
    host.append(pathLabel);
  }

  const where = el('p', 'note', target.where);
  host.append(where);
  const snippetHost = el('div', 'snippet');
  host.append(snippetHost);

  function renderSnippet() {
    const text = target.install({ token: wizardToken, origin, server: serverPath() });
    snippetHost.replaceChildren(codeBlock(text, 'Copier la configuration'));
  }
  renderSnippet();

  const status = el('div', 'connection waiting');
  status.append(
    el('span', 'pulse'),
    el('strong', '', 'En attente de votre agent…'),
    el('span', '', 'Cette fenêtre le détecte dès sa première requête.'),
  );
  host.append(status);
  watchConnection(status);

  const promptTitle = el('h3', '', 'Puis, dans votre agent');
  host.append(promptTitle, codeBlock(STARTER_PROMPT, 'Copier le prompt'));
}

function applyWizardStep() {
  for (const section of document.querySelectorAll<HTMLElement>('.wizard-step')) {
    section.hidden = Number(section.dataset.step) !== wizardStep;
  }
  for (const item of document.querySelectorAll<HTMLElement>('#wizard-steps li')) {
    const step = Number(item.dataset.step);
    item.classList.toggle('done', step < wizardStep);
    item.classList.toggle('current', step === wizardStep);
  }
  $<HTMLElement>('#wizard-back').hidden = wizardStep === 1 || wizardStep === 3;
  // A wizard ends on a positive action: once the token exists, "Terminé" is the
  // only button left, because closing and finishing are the same thing here.
  $<HTMLElement>('#agent-dialog .close').hidden = wizardStep === 3;
  const next = $<HTMLButtonElement>('#wizard-next');
  next.textContent = wizardStep === 3 ? 'Terminé' : wizardStep === 2 ? 'Générer le jeton' : 'Continuer';
  $('#wizard-title').textContent =
    wizardStep === 3 ? `Connecter ${wizardTarget.name}` : 'Connecter un agent IA';
}

function describeScope() {
  const form = $<HTMLFormElement>('#agent-form');
  const fields = new FormData(form);
  const projectId = String(fields.get('projectId') ?? '');
  const project = projects.find((candidate) => candidate.id === projectId);
  const readOnly = fields.get('scope') === 'read';
  $('#agent-scope-note').textContent =
    `${wizardTarget.name} verra ${project ? `les retours de « ${project.name} »` : 'les retours de tous les projets'}` +
    `${readOnly ? ', sans pouvoir rien y changer.' : ', et pourra les commenter et changer leur statut.'} ` +
    'Ce jeton n’ouvre ni l’administration, ni les projets, ni les liens reviewer, et se révoque en un clic.';
}

$('#agent-access').addEventListener('click', async () => {
  wizardStep = 1;
  wizardToken = '';
  wizardTokenId = '';
  clearTimeout(connectionTimer);
  const select = $<HTMLSelectElement>('#agent-project');
  select.replaceChildren(new Option('Tous les projets', ''));
  for (const project of projects) select.append(new Option(project.name, project.id));
  select.value = selectedProject;
  $<HTMLFormElement>('#agent-form').reset();
  select.value = selectedProject;
  renderAgentPicker();
  applyWizardStep();
  $('#agent-existing').replaceChildren();
  $<HTMLDialogElement>('#agent-dialog').showModal();
  await renderAgentTokens();
});

$('#wizard-back').addEventListener('click', () => {
  wizardStep = Math.max(1, wizardStep - 1);
  applyWizardStep();
});

$('#wizard-next').addEventListener('click', async () => {
  if (wizardStep === 3) {
    $<HTMLDialogElement>('#agent-dialog').close();
    return;
  }
  if (wizardStep === 1) {
    wizardStep = 2;
    applyWizardStep();
    describeScope();
    return;
  }
  const button = $<HTMLButtonElement>('#wizard-next');
  const fields = new FormData($<HTMLFormElement>('#agent-form'));
  const projectId = String(fields.get('projectId') ?? '');
  button.disabled = true;
  try {
    const created = (await api('/api/agent-tokens', {
      method: 'POST',
      body: JSON.stringify({
        label: String(fields.get('label') ?? '').trim() || wizardTarget.name,
        scope: fields.get('scope'),
        ...(projectId ? { projectId } : {}),
      }),
    })) as { id: string; token: string };
    wizardToken = created.token;
    wizardTokenId = created.id;
    wizardStep = 3;
    applyWizardStep();
    renderAgentResult();
    await refreshOnboarding();
  } catch {
    toast('Création du jeton impossible.', 'error');
  } finally {
    button.disabled = false;
  }
});

$('#agent-form').addEventListener('change', describeScope);
$('#agent-dialog').addEventListener('close', () => clearTimeout(connectionTimer));

// ------------------------------------------------------------- onboarding

type Onboarding = {
  projects: number;
  reviewLinks: number;
  tickets: number;
  agentTokens: number;
  connectedAgents: number;
};

let onboarding: Onboarding | null = null;

/**
 * The first-run checklist. It is derived from the data, never stored, so it
 * disappears on its own once the instance is genuinely set up — and comes back
 * honestly if someone revokes everything.
 */
function onboardingPanel(state: Onboarding) {
  const steps = [
    {
      done: state.projects > 0,
      title: 'Créer un projet',
      body: 'Un projet porte le nom du client et la liste exacte des origines autorisées.',
      action: 'Nouveau projet',
      run: () => openProjectDialog(null),
    },
    {
      done: state.reviewLinks > 0,
      title: 'Installer le widget sur la préproduction',
      body: 'Un lien reviewer, une ligne de script à coller avant </body>. Le client n’a rien à créer.',
      action: 'Générer un lien',
      run: () => $<HTMLButtonElement>('#review-link').click(),
    },
    {
      done: state.tickets > 0,
      title: 'Recevoir un premier retour',
      body: 'Le client clique l’élément qui cloche et écrit une phrase. Le ticket arrive ancré à cet élément.',
      action: 'Voir les retours',
      run: () => void showTickets(),
    },
    {
      done: state.connectedAgents > 0,
      title: 'Connecter un agent IA',
      body: 'Claude Code, Codex, Cursor… il lit les retours, les corrige et rend compte dans le journal.',
      action: state.agentTokens > 0 ? 'Terminer la connexion' : 'Connecter un agent',
      run: () => $<HTMLButtonElement>('#agent-access').click(),
    },
  ];
  const done = steps.filter((step) => step.done).length;

  const section = el('section', 'panel onboarding');
  const head = el('div', 'panel-head');
  head.append(el('h2', '', 'Démarrage'), el('span', 'panel-hint', `${done} sur ${steps.length}`));
  section.append(head);

  const track = el('div', 'onboarding-track');
  const fill = el('span', 'onboarding-fill');
  fill.style.width = `${(done / steps.length) * 100}%`;
  track.append(fill);
  section.append(track);

  const list = el('div', 'onboarding-steps');
  for (const [index, step] of steps.entries()) {
    const row = el('div', `onboarding-step ${step.done ? 'done' : ''}`);
    const mark = el('span', 'onboarding-mark');
    if (step.done) mark.append(icon('i-check'));
    else mark.textContent = String(index + 1);
    const text = el('div', 'onboarding-text');
    text.append(el('strong', '', step.title), el('span', '', step.body));
    row.append(mark, text);
    // The first unfinished step is the one that gets the button: a checklist
    // with four calls to action has none.
    if (!step.done && steps.slice(0, index).every((previous) => previous.done)) {
      const action = el('button', 'btn btn-primary', step.action);
      action.type = 'button';
      action.onclick = step.run;
      row.append(action);
    }
    list.append(row);
  }
  section.append(list);
  return section;
}

async function refreshOnboarding() {
  try {
    onboarding = (await api('/api/onboarding')) as Onboarding;
  } catch {
    onboarding = null;
  }
  if (view === 'overview') await loadStats();
}

// ------------------------------------------------------------------ wiring

for (const id of ['status', 'client', 'format']) $(`#${id}`).addEventListener('change', () => void loadTickets());
$('#page-filter').addEventListener('input', scheduleReload);
$('#new-project').addEventListener('click', () => openProjectDialog(null));

/** Mirrors the chosen options on the drawn preview, token or not. */
function updateWidgetPreview() {
  const preview = $<HTMLElement>('#widget-preview');
  preview.dataset.position = widgetOptPosition;
  preview.dataset.theme = widgetOptTheme;
  $('#wp-label').textContent = widgetOptLabel.trim() || 'Faire un retour';
  const project = projects.find((p) => p.id === selectedProject);
  const origin = project?.origins[0];
  $('#wp-url').textContent = origin ? origin.replace(/^https?:\/\//, '') : 'preprod.votre-client.fr';
}

function wireWidgetOptions() {
  document.querySelectorAll<HTMLButtonElement>('#opt-position .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#opt-position .seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      widgetOptPosition = btn.dataset.val ?? 'bottom-right';
      if (activeProjectToken) renderWidgetSnippet();
      updateWidgetPreview();
    });
  });

  document.querySelectorAll<HTMLButtonElement>('#opt-theme .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#opt-theme .seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      widgetOptTheme = btn.dataset.val ?? 'auto';
      if (activeProjectToken) renderWidgetSnippet();
      updateWidgetPreview();
    });
  });

  $<HTMLInputElement>('#opt-label-input')?.addEventListener('input', (event) => {
    widgetOptLabel = (event.target as HTMLInputElement).value;
    if (activeProjectToken) renderWidgetSnippet();
    updateWidgetPreview();
  });

  document.querySelectorAll<HTMLButtonElement>('#project-origin-helpers .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const textarea = $<HTMLTextAreaElement>('#project-form [name="origins"]');
      const val = chip.dataset.origin === 'current' ? location.origin : chip.dataset.origin!;
      const current = textarea.value.trim();
      if (!current.includes(val)) {
        textarea.value = current ? `${current}\n${val}` : val;
      }
    });
  });
}

wireWidgetOptions();

// -------------------------------------------------------------- keyboard nav

/** Triage is a scanning job, so the list is drivable without leaving the keys. */
function moveSelection(step: number) {
  if (!tickets.length) return;
  const current = tickets.findIndex((ticket) => ticket.id === selectedTicket);
  const next = current === -1 ? (step > 0 ? 0 : tickets.length - 1) : current + step;
  const ticket = tickets[Math.max(0, Math.min(tickets.length - 1, next))];
  if (!ticket) return;
  openTicket(ticket.id);
  $(`.ticket.active`)?.scrollIntoView({ block: 'nearest' });
}

addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement | null;
  // Never steal a key from a field, and never from a browser shortcut.
  const typing = target?.closest('input, textarea, select') !== null;
  if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
  if ($<HTMLElement>('#app').hidden || document.querySelector('dialog[open]')) return;
  if (event.key === 'j' || event.key === 'ArrowDown') {
    event.preventDefault();
    moveSelection(1);
  } else if (event.key === 'k' || event.key === 'ArrowUp') {
    event.preventDefault();
    moveSelection(-1);
  }
});

// ---------------------------------------------------------------- appearance

/** Explicit choice wins over the OS; no stored value means "follow the system". */
function applyTheme(theme: string | null) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

$('#theme').addEventListener('click', () => {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const current = document.documentElement.dataset.theme ?? (dark ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  // The brand accent used as text has to clear contrast against whichever
  // background is now showing, so it is re-derived rather than kept.
  refreshBrandingForTheme();
  try {
    localStorage.setItem('reviewdesk-theme', next);
  } catch {
    // Private mode or blocked storage: the choice simply lasts for this page.
  }
});

// ------------------------------------------------------------ mobile drawers

const toggleNav = (open: boolean) => $('#app').classList.toggle('nav-open', open);
$('#nav-open').addEventListener('click', () => toggleNav(true));
$('#scrim').addEventListener('click', () => toggleNav(false));

addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if ($('#app').classList.contains('nav-open')) return toggleNav(false);
  // On mobile the detail pane covers the list, so Escape is the way back out.
  if (selectedTicket && DETAIL_OVERLAY.matches) closeDetail();
});
for (const button of document.querySelectorAll('.close')) {
  button.addEventListener('click', () => button.closest('dialog')?.close());
}
const screenshotDialog = $<HTMLDialogElement>('#screenshot-dialog');
screenshotDialog?.addEventListener('click', (e) => {
  if (e.target === screenshotDialog) screenshotDialog.close();
});

function openProjectDialog(project: Project | null) {
  editingProject = project;
  const form = $<HTMLFormElement>('#project-form');
  form.reset();
  form.querySelector('output')!.textContent = '';
  $('#project-dialog-title').textContent = project ? 'Modifier le projet' : 'Nouveau projet';
  // Distinct from the detail pane's "Enregistrer" so neither button can be
  // mistaken for the other, by a person or by a test.
  $('#project-submit').textContent = project ? 'Mettre à jour' : 'Créer';

  const deleteZone = $<HTMLElement>('#project-delete-zone');
  const deletePrompt = $<HTMLElement>('#project-delete-prompt');
  const deleteConfirmBox = $<HTMLElement>('#project-delete-confirm-box');
  deleteZone.hidden = !project;
  deletePrompt.hidden = false;
  deleteConfirmBox.hidden = true;

  if (project) {
    (form.elements.namedItem('name') as HTMLInputElement).value = project.name;
    (form.elements.namedItem('clientLabel') as HTMLInputElement).value = project.clientLabel;
    (form.elements.namedItem('origins') as HTMLInputElement).value = project.origins.join('\n');
    (form.elements.namedItem('webhookUrl') as HTMLInputElement).value = project.webhookUrl;
  }
  $<HTMLDialogElement>('#project-dialog').showModal();
}

$('#project-delete-btn').addEventListener('click', () => {
  $<HTMLElement>('#project-delete-prompt').hidden = true;
  $<HTMLElement>('#project-delete-confirm-box').hidden = false;
});

$('#project-delete-cancel').addEventListener('click', () => {
  $<HTMLElement>('#project-delete-confirm-box').hidden = true;
  $<HTMLElement>('#project-delete-prompt').hidden = false;
});

$('#project-delete-confirm').addEventListener('click', async () => {
  if (!editingProject) return;
  const target = editingProject;
  const button = $<HTMLButtonElement>('#project-delete-confirm');
  button.disabled = true;
  try {
    await api(`/api/projects/${target.id}`, { method: 'DELETE' });
    $<HTMLDialogElement>('#project-dialog').close();
    editingProject = null;
    toast(`Projet « ${target.name} » supprimé.`);
    projects = await api('/api/projects');
    if (selectedProject === target.id) {
      selectedProject = projects[0]?.id ?? '';
    }
    await renderProjects();
    if (selectedProject) {
      await chooseProject(selectedProject);
    } else {
      await renderTickets();
    }
    await refreshOnboarding();
  } catch {
    toast('Échec de la suppression du projet.', 'error');
  } finally {
    button.disabled = false;
  }
});

$('#project-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const fields = new FormData(form);
  const output = form.querySelector('output')!;
  const target = editingProject;
  const body = JSON.stringify({
    name: fields.get('name'),
    clientLabel: fields.get('clientLabel'),
    origins: String(fields.get('origins')).split(/\s+/).filter(Boolean),
    webhookUrl: String(fields.get('webhookUrl') ?? '').trim(),
  });
  try {
    const saved = await api(target ? `/api/projects/${target.id}` : '/api/projects', {
      method: target ? 'PATCH' : 'POST',
      body,
    });
    $<HTMLDialogElement>('#project-dialog').close();
    form.reset();
    output.textContent = '';
    editingProject = null;
    projects = await api('/api/projects');
    await chooseProject(saved.id);
    if (target) {
      toast('Projet mis à jour.');
    } else {
      showOnboardingPrompt(saved.name);
    }
  } catch {
    output.textContent =
      'Vérifiez le nom, le client, les origines (http(s), une par ligne) et le webhook (https public).';
  }
});

$('#edit-project').addEventListener('click', () => {
  const project = projects.find((candidate) => candidate.id === selectedProject);
  if (project) openProjectDialog(project);
});

$('#logout').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  showLogin();
});

load().catch(showLogin);
