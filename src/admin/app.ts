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
  // Identified because the pane now holds a second select (the comment's scope).
  select.id = 'ticket-status';
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

  // The work log: what the team and the connected agents have done on this
  // ticket. Loaded after the pane paints, so opening a ticket stays instant.
  const thread = document.createElement('div');
  thread.className = 'thread';
  void renderThread(ticket.id, thread);

  const main = document.createElement('div');
  main.className = 'detail-main';
  main.append(
    labelled('Statut', select),
    labelled('Réponse visible par le reviewer', reply),
    labelled('Réponse interne', textarea),
    save,
    thread,
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
$('#tab-tickets').addEventListener('click', () => void showTickets());
$('#period').addEventListener('change', () => void loadStats());

// --------------------------------------------------------------- work log

/**
 * One ticket's history: every comment left by the team or by a connected agent,
 * with the status move that came with it. This is where an operator reads what
 * an AI agent did without opening the code.
 */
async function renderThread(ticketId: string, host: HTMLElement) {
  const title = document.createElement('div');
  title.className = 'eyebrow';
  title.textContent = 'Journal';
  host.replaceChildren(title);

  let comments: Comment[] = [];
  try {
    comments = ((await api(`/api/tickets/${ticketId}/comments`)) as { comments: Comment[] }).comments;
  } catch {
    const failed = document.createElement('p');
    failed.className = 'thread-empty';
    failed.textContent = 'Journal indisponible.';
    host.append(failed);
    return;
  }

  if (!comments.length) {
    const empty = document.createElement('p');
    empty.className = 'thread-empty';
    empty.textContent = 'Rien encore. Les agents connectés écrivent ici ce qu’ils ont fait.';
    host.append(empty);
  }
  for (const comment of comments) {
    const entry = document.createElement('article');
    entry.className = `comment ${comment.author}`;
    const meta = document.createElement('div');
    meta.className = 'comment-meta';
    const who = document.createElement('strong');
    who.textContent = comment.authorLabel || (comment.author === 'agent' ? 'Agent' : 'Équipe');
    const when = document.createElement('span');
    when.textContent = formatAge(comment.createdAt);
    when.title = formatDate(comment.createdAt);
    meta.append(who, when);
    if (comment.visibility === 'reviewer') {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'Visible par le client';
      meta.append(tag);
    }
    if (comment.statusTo && comment.statusTo !== comment.statusFrom) {
      const move = document.createElement('span');
      move.className = 'tag move';
      move.textContent = `${STATUS_LABELS[comment.statusFrom ?? ''] ?? comment.statusFrom} → ${STATUS_LABELS[comment.statusTo] ?? comment.statusTo}`;
      meta.append(move);
    }
    const body = document.createElement('p');
    // textContent, never innerHTML: an agent writes this text.
    body.textContent = comment.body;
    entry.append(meta, body);
    host.append(entry);
  }

  const draft = document.createElement('textarea');
  draft.className = 'comment-draft';
  draft.maxLength = 4000;
  draft.placeholder = 'Ajouter au journal…';
  const visibility = document.createElement('select');
  visibility.append(new Option('Interne', 'internal'), new Option('Visible par le client', 'reviewer'));
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn btn-ghost';
  add.textContent = 'Ajouter';
  add.onclick = async () => {
    const body = draft.value.trim();
    if (!body) return;
    add.disabled = true;
    try {
      await api(`/api/tickets/${ticketId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body, visibility: visibility.value }),
      });
      // A published comment becomes the reviewer's reply, so the pane is rebuilt
      // from the server rather than patched in place.
      await loadTickets();
      openTicket(ticketId);
      toast('Commentaire ajouté.');
    } catch {
      toast('Commentaire impossible.', 'error');
      add.disabled = false;
    }
  };
  const actions = document.createElement('div');
  actions.className = 'comment-actions';
  actions.append(visibility, add);
  host.append(draft, actions);
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

// ------------------------------------------------------------ agent access

async function renderAgentTokens() {
  const container = $('#agent-list');
  container.replaceChildren();
  const { tokens } = (await api('/api/agent-tokens')) as { tokens: AgentToken[] };
  if (!tokens.length) {
    const empty = document.createElement('p');
    empty.textContent = 'Aucun jeton agent.';
    container.append(empty);
    return;
  }
  for (const token of tokens) {
    const row = document.createElement('div');
    row.className = 'link-row';
    const description = document.createElement('span');
    const scope = token.scope === 'read' ? 'lecture seule' : 'lecture/écriture';
    const where = token.projectName ?? 'tous les projets';
    const used = token.lastUsedAt ? `utilisé ${formatAge(token.lastUsedAt)}` : 'jamais utilisé';
    description.textContent = token.revokedAt
      ? `${token.label || 'Sans libellé'} — révoqué ${formatDate(token.revokedAt)}`
      : `${token.label || 'Sans libellé'} — ${scope} · ${where} · ${used}`;
    row.append(description);
    if (!token.revokedAt) {
      const revoke = document.createElement('button');
      revoke.type = 'button';
      revoke.className = 'btn btn-danger';
      revoke.textContent = 'Révoquer';
      revoke.onclick = async () => {
        revoke.disabled = true;
        await api(`/api/agent-tokens/${token.id}/revoke`, { method: 'POST' });
        await renderAgentTokens();
      };
      row.append(revoke);
    }
    container.append(row);
  }
}

/**
 * Paste-ready MCP configuration, so connecting an agent is copy, paste, done.
 * The server runs from a checkout of this repository (`npm run build`), which is
 * why the command is a path rather than a published package name.
 */
function mcpInstructions(token: string): string {
  const server = '/chemin/vers/reviewdesk/dist/mcp.js';
  const config = {
    mcpServers: {
      reviewdesk: {
        command: 'node',
        args: [server],
        env: { REVIEWDESK_URL: location.origin, REVIEWDESK_TOKEN: token },
      },
    },
  };
  return (
    `Jeton (affiché une seule fois) :\n${token}\n\n` +
    `Remplacez ${server} par le chemin du dépôt ReviewDesk, après un « npm run build ».\n\n` +
    `Claude Code, en une commande :\n` +
    `claude mcp add reviewdesk --env REVIEWDESK_URL=${location.origin} --env REVIEWDESK_TOKEN=${token} -- node ${server}\n\n` +
    `Ou dans .mcp.json / claude_desktop_config.json :\n${JSON.stringify(config, null, 2)}\n\n` +
    `Sans MCP, l'API directement :\n` +
    `curl -H "Authorization: Bearer ${token}" "${location.origin}/api/agent/tickets?status=TODO"`
  );
}

$('#agent-access').addEventListener('click', async () => {
  $<HTMLTextAreaElement>('#agent-output').value = '';
  const select = $<HTMLSelectElement>('#agent-project');
  select.replaceChildren(new Option('Tous les projets', ''));
  for (const project of projects) select.append(new Option(project.name, project.id));
  select.value = selectedProject;
  $('#agent-list').replaceChildren();
  await renderAgentTokens();
  $<HTMLDialogElement>('#agent-dialog').showModal();
});

$('#agent-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const button = $<HTMLButtonElement>('#new-agent-token');
  const fields = new FormData(form);
  const projectId = String(fields.get('projectId') ?? '');
  button.disabled = true;
  try {
    const created = (await api('/api/agent-tokens', {
      method: 'POST',
      body: JSON.stringify({
        label: String(fields.get('label') ?? '').trim(),
        scope: fields.get('scope'),
        ...(projectId ? { projectId } : {}),
      }),
    })) as { token: string };
    $<HTMLTextAreaElement>('#agent-output').value = mcpInstructions(created.token);
    await renderAgentTokens();
  } catch {
    toast('Création du jeton impossible.', 'error');
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
