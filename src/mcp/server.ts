/**
 * ReviewDesk as an MCP server: a coding agent connects here and reads the
 * client's feedback, works on it, then writes back what it did and moves the
 * status. It is a thin, stateless adapter over the agent HTTP API — the server
 * stays the only place that holds the database, the object store and the rules.
 *
 * Configuration is two environment variables, nothing else:
 *   REVIEWDESK_URL   the instance origin, e.g. https://reviewdesk.example
 *   REVIEWDESK_TOKEN an agent token minted in the admin ("Accès agents")
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const STATUS_LABELS: Record<string, string> = {
  TODO: 'à traiter',
  IN_PROGRESS: 'en cours',
  REVIEW: 'à valider',
  DONE: 'traité',
};

type Anchor = { selector: string; relative: { x: number; y: number }; viewport: { width: number; height: number } };
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
  anchor: Anchor;
  viewportWidth: number;
  diagnostics: Record<string, unknown>;
  screenshotId?: string | null;
  createdAt: string;
  commentCount?: number;
};
type Comment = {
  author: string;
  authorLabel: string;
  body: string;
  visibility: string;
  statusFrom: string | null;
  statusTo: string | null;
  createdAt: string;
};

class ReviewDeskError extends Error {}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ReviewDeskError(`${name} is required`);
  return value;
}

const baseUrl = requiredEnv('REVIEWDESK_URL').replace(/\/+$/, '');
const token = requiredEnv('REVIEWDESK_TOKEN');

/**
 * Error bodies are surfaced as the tool's own failure text rather than thrown as
 * transport errors: an agent can act on "READ_ONLY_TOKEN" or "NOT_FOUND", and a
 * dropped connection is not the same thing as a refused write.
 */
async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  } catch (error) {
    throw new ReviewDeskError(`ReviewDesk est injoignable sur ${baseUrl} (${(error as Error).message}).`);
  }
  if (response.status === 401) throw new ReviewDeskError('Jeton agent invalide ou révoqué (401).');
  if (response.status === 403) throw new ReviewDeskError('Ce jeton est en lecture seule ou hors de son projet (403).');
  if (response.status === 429) throw new ReviewDeskError('Trop de requêtes (429) : ralentir et réessayer.');
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ReviewDeskError(`ReviewDesk a répondu ${response.status}. ${body.slice(0, 200)}`);
  }
  return (await response.json()) as T;
}

const short = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);
const date = (value: string) => new Date(value).toISOString().replace('T', ' ').slice(0, 16);

function ticketLine(ticket: Ticket): string {
  const format = ticket.viewportWidth < 768 ? 'mobile' : 'desktop';
  const path = (() => {
    try {
      return new URL(ticket.pageUrl).pathname;
    } catch {
      return ticket.pageUrl;
    }
  })();
  return (
    `- ${ticket.id} [${STATUS_LABELS[ticket.status] ?? ticket.status}] ${short(ticket.text.replace(/\s+/g, ' '), 90)}\n` +
    `    ${ticket.projectName} · ${path} · ${format} · ${date(ticket.createdAt)}`
  );
}

function diagnosticsLine(diagnostics: Record<string, unknown>): string {
  const parts = Object.entries(diagnostics ?? {})
    .filter(([, value]) => value !== 'Unknown' && value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key} ${Array.isArray(value) ? value.join(', ') : String(value)}`);
  return parts.length ? parts.join(' · ') : 'non transmis';
}

/**
 * The full brief for one ticket. It carries what is needed to act without a
 * second round trip: where, on what element, on which screen, and what has
 * already been said about it.
 */
function ticketDetail(ticket: Ticket & { comments?: Comment[] }): string {
  const { selector, relative, viewport } = ticket.anchor;
  const lines = [
    `# ${ticket.text}`,
    '',
    `- Ticket : ${ticket.id} (${STATUS_LABELS[ticket.status] ?? ticket.status})`,
    `- Projet : ${ticket.projectName} (${ticket.clientLabel})`,
    `- Page : ${ticket.pageUrl}`,
    `- Élément visé : ${selector} — clic à ${Math.round(relative.x * 100)} %, ${Math.round(relative.y * 100)} % de l'élément`,
    `- Écran du reviewer : ${viewport.width}×${viewport.height} (${ticket.viewportWidth < 768 ? 'mobile' : 'desktop'})`,
    `- Environnement : ${diagnosticsLine(ticket.diagnostics)}`,
    `- Reçu le ${date(ticket.createdAt)}`,
    `- Capture : ${ticket.screenshotId ? `oui — get_screenshot("${ticket.id}")` : 'aucune'}`,
    `- Réponse actuellement visible par le client : ${ticket.replyText || '(aucune)'}`,
    `- Note interne : ${ticket.response || '(aucune)'}`,
  ];
  const comments = ticket.comments ?? [];
  if (comments.length) {
    lines.push('', '## Journal');
    for (const comment of comments) {
      const move = comment.statusTo && comment.statusFrom !== comment.statusTo
        ? ` · ${STATUS_LABELS[comment.statusFrom ?? ''] ?? comment.statusFrom} → ${STATUS_LABELS[comment.statusTo] ?? comment.statusTo}`
        : '';
      const visibility = comment.visibility === 'reviewer' ? 'visible par le client' : 'interne';
      lines.push(`- ${date(comment.createdAt)} · ${comment.authorLabel || comment.author} · ${visibility}${move}`);
      lines.push(`  ${comment.body.replace(/\n/g, '\n  ')}`);
    }
  }
  return lines.join('\n');
}

const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] });

const server = new McpServer(
  { name: 'reviewdesk', version: '2.0.0' },
  {
    instructions:
      'ReviewDesk collecte les retours visuels des clients sur une préproduction. ' +
      'Chaque ticket est ancré à un élément précis du DOM. Flux de travail : list_tickets ' +
      '(status "TODO") pour voir ce qui reste, get_ticket pour le détail et le journal, ' +
      'get_screenshot si une capture existe, puis update_ticket pour déplacer le statut en ' +
      'décrivant ce qui a été fait. Une réponse destinée au client se publie avec ' +
      'visibility "reviewer" : elle apparaît dans le widget, côté client. Sinon le commentaire ' +
      'reste interne.',
  },
);

server.registerTool(
  'list_projects',
  {
    title: 'Lister les projets',
    description:
      'Les projets visibles par ce jeton, avec le nombre de retours par statut. ' +
      'Utile pour savoir où il reste du travail avant de lister les tickets.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    const context = await call<{
      token: { label: string; scope: string; projectId: string | null };
      projects: { id: string; name: string; clientLabel: string; todo: number; inProgress: number; review: number; done: number }[];
    }>('/api/agent/context');
    if (!context.projects.length) return text('Aucun projet visible par ce jeton.');
    const scope = context.token.projectId ? 'limité à un projet' : 'tous les projets';
    const lines = context.projects.map(
      (project) =>
        `- ${project.name} (${project.clientLabel}) — id ${project.id}\n` +
        `    à traiter ${project.todo} · en cours ${project.inProgress} · à valider ${project.review} · traités ${project.done}`,
    );
    return text(`Jeton « ${context.token.label || 'sans libellé'} » (${context.token.scope}, ${scope})\n\n${lines.join('\n')}`);
  },
);

server.registerTool(
  'list_tickets',
  {
    title: 'Lister les retours',
    description:
      'Les retours clients, filtrables. Par défaut les retours à traiter (status TODO), ' +
      'du plus récent au plus ancien. Renvoie une ligne par ticket avec son identifiant.',
    inputSchema: {
      status: z.enum(['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE']).optional()
        .describe('Statut recherché. Par défaut TODO. Omettre explicitement avec "all" n\'existe pas : passer un statut ou rien.'),
      projectId: z.string().uuid().optional().describe('Restreindre à un projet.'),
      page: z.string().max(120).optional().describe('Sous-chaîne de l\'URL de la page concernée.'),
      format: z.enum(['mobile', 'desktop']).optional().describe('Format d\'écran du reviewer.'),
      limit: z.number().int().min(1).max(200).optional().describe('Nombre de tickets, 60 par défaut.'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ status, projectId, page, format, limit }) => {
    const params = new URLSearchParams({ status: status ?? 'TODO' });
    if (projectId) params.set('projectId', projectId);
    if (page) params.set('page', page);
    if (format) params.set('format', format);
    if (limit) params.set('limit', String(limit));
    const payload = await call<{ tickets: Ticket[]; total: number; nextCursor: string | null }>(
      `/api/agent/tickets?${params}`,
    );
    if (!payload.tickets.length) return text('Aucun retour ne correspond à ces filtres.');
    const more = payload.tickets.length < payload.total ? `\n\n(${payload.tickets.length} sur ${payload.total})` : '';
    return text(`${payload.total} retour(s) :\n\n${payload.tickets.map(ticketLine).join('\n')}${more}`);
  },
);

server.registerTool(
  'get_ticket',
  {
    title: 'Lire un retour',
    description:
      'Le détail complet d\'un retour : élément visé, page, écran, diagnostics, ' +
      'réponse déjà publiée et journal des commentaires.',
    inputSchema: { ticketId: z.string().uuid().describe('Identifiant du ticket.') },
    annotations: { readOnlyHint: true },
  },
  async ({ ticketId }) => text(ticketDetail(await call<Ticket & { comments: Comment[] }>(`/api/agent/tickets/${ticketId}`))),
);

server.registerTool(
  'get_screenshot',
  {
    title: 'Voir la capture',
    description: 'La capture jointe par le client, s\'il y en a une, renvoyée comme image.',
    inputSchema: { ticketId: z.string().uuid().describe('Identifiant du ticket.') },
    annotations: { readOnlyHint: true },
  },
  async ({ ticketId }) => {
    const ticket = await call<Ticket>(`/api/agent/tickets/${ticketId}`);
    if (!ticket.screenshotId) return text('Ce retour n\'a pas de capture.');
    const response = await fetch(`${baseUrl}/api/agent/uploads/${ticket.screenshotId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new ReviewDeskError(`Capture indisponible (${response.status}).`);
    const mimeType = response.headers.get('content-type') ?? 'image/png';
    const data = Buffer.from(await response.arrayBuffer()).toString('base64');
    return { content: [{ type: 'image' as const, data, mimeType }] };
  },
);

server.registerTool(
  'comment_ticket',
  {
    title: 'Commenter un retour',
    description:
      'Ajoute un commentaire au journal du ticket, sans changer son statut. ' +
      'visibility "internal" (défaut) reste côté équipe ; "reviewer" publie le texte ' +
      'dans le widget du client et remplace la réponse précédente.',
    inputSchema: {
      ticketId: z.string().uuid().describe('Identifiant du ticket.'),
      body: z.string().min(1).max(4_000).describe('Le commentaire.'),
      visibility: z.enum(['internal', 'reviewer']).optional().describe('internal (défaut) ou reviewer.'),
    },
  },
  async ({ ticketId, body, visibility }) => {
    await call(`/api/agent/tickets/${ticketId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body, visibility: visibility ?? 'internal' }),
    });
    return text(
      visibility === 'reviewer'
        ? 'Commentaire publié : le client le verra dans son widget.'
        : 'Commentaire interne ajouté au journal.',
    );
  },
);

server.registerTool(
  'update_ticket',
  {
    title: 'Traiter un retour',
    description:
      'Déplace le statut d\'un retour et journalise ce qui a été fait, en un seul appel. ' +
      'Statuts : TODO (à traiter), IN_PROGRESS (en cours), REVIEW (à valider), DONE (traité). ' +
      'Toujours accompagner le changement d\'un commentaire décrivant la correction.',
    inputSchema: {
      ticketId: z.string().uuid().describe('Identifiant du ticket.'),
      status: z.enum(['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE']).optional().describe('Nouveau statut.'),
      comment: z.string().max(4_000).optional().describe('Ce qui a été fait.'),
      visibility: z.enum(['internal', 'reviewer']).optional()
        .describe('Portée du commentaire : internal (défaut) ou reviewer pour l\'afficher au client.'),
    },
  },
  async ({ ticketId, status, comment, visibility }) => {
    const result = await call<{ status: string; previousStatus: string }>(`/api/agent/tickets/${ticketId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, comment, visibility: visibility ?? 'internal' }),
    });
    const moved =
      result.status === result.previousStatus
        ? `Statut inchangé (${STATUS_LABELS[result.status] ?? result.status})`
        : `Statut : ${STATUS_LABELS[result.previousStatus] ?? result.previousStatus} → ${STATUS_LABELS[result.status] ?? result.status}`;
    return text(`${moved}${comment ? ', commentaire enregistré.' : '.'}`);
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
