import { ApiError, loginErrorMessage } from './errors.js';

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
}

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

  button.append(stack);
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
  await loadTickets();
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

async function loadTickets() {
  const params = filterParams();
  const payload = await api(`/api/tickets?${params}`);
  tickets = payload.tickets;
  nextCursor = payload.nextCursor;
  totalTickets = payload.total;
  renderTickets();
  renderCount();
  if (!selectedTicket) clearDetail();
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
    list.append(
      emptyState(
        'i-inbox',
        'Aucun retour',
        'Rien ne correspond à ces filtres. Élargissez la recherche, ou partagez un lien reviewer pour recevoir les premiers retours.',
      ),
    );
    return;
  }
  for (const ticket of tickets) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `ticket ${selectedTicket === ticket.id ? 'active' : ''}`;
    const status = document.createElement('span');
    status.className = `status ${ticket.status}`;
    status.textContent = STATUS_LABELS[ticket.status] ?? ticket.status;
    const summary = document.createElement('span');
    summary.className = 'summary';
    const title = document.createElement('strong');
    // textContent, never innerHTML: reviewer text is stored verbatim.
    title.textContent = ticket.text;
    const context = document.createElement('small');
    const format = ticket.viewportWidth < 768 ? 'Mobile' : 'Desktop';
    context.textContent = `${ticket.projectName} · ${new URL(ticket.pageUrl).pathname} · ${format}`;
    summary.append(title, context);
    const date = document.createElement('span');
    date.className = 'date';
    date.textContent = formatAge(ticket.createdAt);
    date.title = formatDate(ticket.createdAt);
    row.append(status, summary, date);
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

function labelled(text: string, control: HTMLElement): HTMLLabelElement {
  const label = document.createElement('label');
  label.textContent = text;
  label.append(control);
  return label;
}

function openTicket(id: string) {
  selectedTicket = id;
  renderTickets();
  const ticket = tickets.find((candidate) => candidate.id === id)!;
  const detail = $('#detail');
  detail.className = 'detail';
  detail.replaceChildren();

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'quiet';
  close.append(icon('i-back'), document.createTextNode('Liste'));
  close.onclick = () => {
    selectedTicket = '';
    clearDetail();
    renderTickets();
  };
  const eyebrow = document.createElement('div');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = `${ticket.clientLabel} · ${ticket.projectName}`;
  const heading = document.createElement('h2');
  heading.textContent = ticket.text;
  const meta = document.createElement('div');
  meta.className = 'meta';
  const { selector, relative, viewport } = ticket.anchor;
  meta.textContent =
    `${ticket.pageUrl}\n${selector} @ ${Math.round(relative.x * 100)}%, ${Math.round(relative.y * 100)}%` +
    ` · ${viewport.width}×${viewport.height}`;

  const select = document.createElement('select');
  for (const [value, label] of Object.entries(STATUS_LABELS)) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.selected = value === ticket.status;
    select.append(option);
  }
  const textarea = document.createElement('textarea');
  textarea.value = ticket.response;
  textarea.maxLength = 4000;

  const reply = document.createElement('textarea');
  reply.value = ticket.replyText;
  reply.maxLength = 4000;
  reply.placeholder = 'Ce texte apparaît dans le widget, côté reviewer.';

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn btn-primary';
  save.textContent = 'Enregistrer';
  save.onclick = async () => {
    save.disabled = true;
    try {
      await api(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: select.value, response: textarea.value, replyText: reply.value }),
      });
      // The sidebar badges count open tickets, so a status change moves them.
      projects = await api('/api/projects');
      renderProjects();
      await loadTickets();
      openTicket(ticket.id);
      toast('Retour enregistré.');
    } catch {
      toast('Enregistrement impossible.', 'error');
    } finally {
      save.disabled = false;
    }
  };

  const diagnostics = document.createElement('pre');
  diagnostics.className = 'diag';
  // A reviewer who declined still yields `{os:'Unknown', browser:'Unknown'}`,
  // which reads like data when it is the absence of it. Say so in words.
  const informative = Object.values(ticket.diagnostics).some(
    (value) => value !== 'Unknown' && value !== null && value !== undefined && !(Array.isArray(value) && !value.length),
  );
  if (informative) {
    diagnostics.textContent = JSON.stringify(ticket.diagnostics, null, 2);
  } else {
    diagnostics.classList.add('diag-empty');
    diagnostics.textContent = 'Aucun diagnostic transmis. Le reviewer ne les a pas joints.';
  }

  const diagnosticsTitle = document.createElement('div');
  diagnosticsTitle.className = 'eyebrow';
  diagnosticsTitle.textContent = 'Diagnostics consentis';

  // The whole point of a visual feedback tool: go and look at the spot rather
  // than decode a CSS selector by hand.
  const openAnchor = document.createElement('a');
  openAnchor.className = 'btn btn-ghost anchor-link';
  openAnchor.href = anchorUrl(ticket);
  openAnchor.target = '_blank';
  openAnchor.rel = 'noreferrer';
  openAnchor.append(icon('i-target'), document.createTextNode('Ouvrir au point d’ancrage'));

  // Three regions rather than one flat column: on a wide screen "act" (status
  // and replies) and "context" (where, diagnostics, capture) sit side by side
  // instead of stretching one column across a 21:9 display.
  const head = document.createElement('div');
  head.className = 'detail-head';
  head.append(close, eyebrow, heading);

  const main = document.createElement('div');
  main.className = 'detail-main';
  main.append(
    labelled('Statut', select),
    labelled('Réponse visible par le reviewer', reply),
    labelled('Réponse interne', textarea),
    save,
  );

  const side = document.createElement('div');
  side.className = 'detail-side';
  side.append(meta, openAnchor, diagnosticsTitle, diagnostics);

  if (ticket.screenshotId) {
    const link = document.createElement('a');
    link.href = `/api/uploads/${ticket.screenshotId}`;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.append(icon('i-image'), document.createTextNode('Voir la capture privée'));
    side.append(link);
  }

  detail.append(head, main, side);
}

// ------------------------------------------------------------- review links

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
      };
      row.append(revoke);
    }
    container.append(row);
  }
}

// Opening the dialog only reads. Minting a secret is a separate, deliberate
// action, so revoking a link never requires creating another one first.
$('#review-link').addEventListener('click', async () => {
  const output = $<HTMLTextAreaElement>('#link-output');
  output.value = '';
  $<HTMLButtonElement>('#new-link').disabled = !selectedProject;
  $('#link-list').replaceChildren();
  if (!selectedProject) {
    output.value = 'Sélectionnez d’abord un projet dans la colonne de gauche.';
  } else {
    await renderReviewLinks();
  }
  $<HTMLDialogElement>('#link-dialog').showModal();
});

$('#new-link').addEventListener('click', async () => {
  if (!selectedProject) return;
  const button = $<HTMLButtonElement>('#new-link');
  button.disabled = true;
  try {
    const link = await api(`/api/projects/${selectedProject}/review-links`, { method: 'POST', body: '{}' });
    const origin = projects.find((project) => project.id === selectedProject)!.origins[0];
    $<HTMLTextAreaElement>('#link-output').value =
      `URL reviewer DEMO : ${origin}/${link.fragment}\n\n` +
      `Installation dans la preview — une seule ligne à coller avant </body> :\n` +
      `<script src="${location.origin}/widget.js" data-api="${location.origin}" ` +
      `data-project="${selectedProject}" data-token="${link.token}"></script>`;
    await renderReviewLinks();
  } finally {
    button.disabled = false;
  }
});

// ------------------------------------------------------------------ wiring

for (const id of ['status', 'client', 'format']) $(`#${id}`).addEventListener('change', () => void loadTickets());
$('#page-filter').addEventListener('input', scheduleReload);
$('#new-project').addEventListener('click', () => openProjectDialog(null));

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
  if (selectedTicket && innerWidth <= 900) {
    selectedTicket = '';
    clearDetail();
    renderTickets();
  }
});
for (const button of document.querySelectorAll('.close')) {
  button.addEventListener('click', () => button.closest('dialog')?.close());
}

function openProjectDialog(project: Project | null) {
  editingProject = project;
  const form = $<HTMLFormElement>('#project-form');
  form.reset();
  form.querySelector('output')!.textContent = '';
  $('#project-dialog-title').textContent = project ? 'Modifier le projet' : 'Nouveau projet';
  // Distinct from the detail pane's "Enregistrer" so neither button can be
  // mistaken for the other, by a person or by a test.
  $('#project-submit').textContent = project ? 'Mettre à jour' : 'Créer';
  if (project) {
    (form.elements.namedItem('name') as HTMLInputElement).value = project.name;
    (form.elements.namedItem('clientLabel') as HTMLInputElement).value = project.clientLabel;
    (form.elements.namedItem('origins') as HTMLInputElement).value = project.origins.join('\n');
    (form.elements.namedItem('webhookUrl') as HTMLInputElement).value = project.webhookUrl;
  }
  $<HTMLDialogElement>('#project-dialog').showModal();
}

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
    toast(target ? 'Projet mis à jour.' : 'Projet créé.');
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
