import { ApiError, loginErrorMessage } from './errors.js';

type Project = { id: string; name: string; clientLabel: string; origins: string[] };
type Ticket = {
  id: string;
  projectId: string;
  projectName: string;
  clientLabel: string;
  text: string;
  response: string;
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
function projectButton(id: string, name: string, secondary: string) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `project ${selectedProject === id ? 'active' : ''}`;
  button.setAttribute('aria-label', name);
  button.title = secondary ? `${name} — ${secondary}` : name;

  const stack = document.createElement('span');
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
  button.onclick = () => chooseProject(id);
  return button;
}

function renderProjects() {
  const nav = $('#projects');
  nav.replaceChildren();
  nav.append(projectButton('', 'Tous les projets', `${projects.length} projet${projects.length === 1 ? '' : 's'}`));
  for (const project of projects) {
    nav.append(projectButton(project.id, project.name, project.clientLabel));
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

async function loadTickets() {
  const params = new URLSearchParams();
  if (selectedProject) params.set('projectId', selectedProject);
  for (const key of ['status', 'client', 'format'] as const) {
    const value = $<HTMLSelectElement>(`#${key}`).value;
    if (value) params.set(key, value);
  }
  const page = $<HTMLInputElement>('#page-filter').value.trim();
  if (page) params.set('page', page);
  tickets = (await api(`/api/tickets?${params}`)).tickets;
  renderTickets();
  $('#count').textContent = `${tickets.length} retour${tickets.length === 1 ? '' : 's'}`;
  if (!selectedTicket) clearDetail();
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

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn btn-primary';
  save.textContent = 'Enregistrer';
  save.onclick = async () => {
    save.disabled = true;
    try {
      await api(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: select.value, response: textarea.value }),
      });
      await loadTickets();
      openTicket(ticket.id);
    } finally {
      save.disabled = false;
    }
  };

  const diagnostics = document.createElement('pre');
  diagnostics.className = 'diag';
  diagnostics.textContent = JSON.stringify(ticket.diagnostics, null, 2);

  const diagnosticsTitle = document.createElement('div');
  diagnosticsTitle.className = 'eyebrow';
  diagnosticsTitle.textContent = 'Diagnostics consentis';

  detail.append(
    close,
    eyebrow,
    heading,
    meta,
    labelled('Statut', select),
    labelled('Réponse interne', textarea),
    save,
    diagnosticsTitle,
    diagnostics,
  );

  if (ticket.screenshotId) {
    const link = document.createElement('a');
    link.href = `/api/uploads/${ticket.screenshotId}`;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.append(icon('i-image'), document.createTextNode('Voir la capture privée'));
    detail.append(link);
  }
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
      `Installation dans la preview :\n` +
      `<script src="${location.origin}/widget.js"></script>\n` +
      `<script>ReviewDesk.init({api:'${location.origin}',projectId:'${selectedProject}',token:'${link.token}'})</script>`;
    await renderReviewLinks();
  } finally {
    button.disabled = false;
  }
});

// ------------------------------------------------------------------ wiring

for (const id of ['status', 'client', 'format']) $(`#${id}`).addEventListener('change', loadTickets);
$('#page-filter').addEventListener('input', loadTickets);
$('#new-project').addEventListener('click', () => $<HTMLDialogElement>('#project-dialog').showModal());

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

$('#project-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const fields = new FormData(form);
  const output = form.querySelector('output')!;
  try {
    const created = await api('/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        name: fields.get('name'),
        clientLabel: fields.get('clientLabel'),
        origins: String(fields.get('origins')).split(/\s+/).filter(Boolean),
      }),
    });
    $<HTMLDialogElement>('#project-dialog').close();
    form.reset();
    output.textContent = '';
    projects = await api('/api/projects');
    await chooseProject(created.id);
  } catch {
    output.textContent = 'Vérifiez le nom, le client et les origines (http(s) uniquement, une par ligne).';
  }
});

$('#logout').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  showLogin();
});

load().catch(showLogin);
