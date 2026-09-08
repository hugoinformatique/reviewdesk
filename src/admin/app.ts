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
    throw new Error('UNAUTHORIZED');
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

function renderProjects() {
  const nav = $('#projects');
  nav.replaceChildren();
  const all = document.createElement('button');
  all.className = `project ${selectedProject ? '' : 'active'}`;
  all.textContent = 'Tous les projets';
  all.onclick = () => chooseProject('');
  nav.append(all);
  for (const project of projects) {
    const button = document.createElement('button');
    button.className = `project ${selectedProject === project.id ? 'active' : ''}`;
    button.textContent = project.name;
    button.onclick = () => chooseProject(project.id);
    nav.append(button);
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
  if (!selectedTicket) $('#detail').className = 'detail empty';
}

function renderTickets() {
  const list = $('#tickets');
  list.replaceChildren();
  for (const ticket of tickets) {
    const row = document.createElement('button');
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
    date.textContent = formatDate(ticket.createdAt);
    row.append(status, summary, date);
    row.onclick = () => openTicket(ticket.id);
    list.append(row);
  }
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
  close.className = 'quiet';
  close.textContent = '← Liste';
  close.onclick = () => {
    detail.className = 'detail empty';
    selectedTicket = '';
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

  detail.append(
    close,
    eyebrow,
    heading,
    meta,
    labelled('Statut', select),
    labelled('Réponse interne', textarea),
    save,
    labelled('Diagnostics consentis', document.createElement('span')),
    diagnostics,
  );

  if (ticket.screenshotId) {
    const link = document.createElement('a');
    link.href = `/api/uploads/${ticket.screenshotId}`;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = 'Voir la capture privée';
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
      revoke.className = 'quiet';
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
