/** Shapes returned by the ReviewDesk API (src/app.ts). */

export type Status = 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE';
export const STATUSES: Status[] = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'];
export const STATUS_LABELS: Record<Status, string> = {
  TODO: 'À traiter',
  IN_PROGRESS: 'En cours',
  REVIEW: 'À valider',
  DONE: 'Traité',
};

export type Project = {
  id: string;
  name: string;
  clientLabel: string;
  origins: string[];
  webhookUrl: string;
  openCount: number;
  todoCount: number;
  inProgressCount: number;
  reviewCount: number;
  fixRequestedCount: number;
  lastTicketAt: string | null;
  /** Last time a review link of this project was used: the widget is live. */
  widgetSeenAt: string | null;
  previewShotId: string | null;
};

export type ProjectInput = { name: string; clientLabel: string; origins: string[]; webhookUrl: string };

export type Anchor = {
  selector: string;
  relative: { x: number; y: number };
  viewport: { width: number; height: number };
};

export type Ticket = {
  id: string;
  projectId: string;
  projectName: string;
  clientLabel: string;
  text: string;
  /** Legacy internal note, shown pinned in the conversation. */
  response: string;
  /** What the reviewer currently reads in the widget. */
  replyText: string;
  status: Status;
  pageUrl: string;
  anchor: Anchor;
  viewportWidth: number;
  diagnostics: Record<string, unknown>;
  screenshotId?: string | null;
  createdAt: string;
  fixRequestedAt?: string | null;
  fixRequestedFor?: string;
  commentCount?: number;
};

export type TicketPage = { tickets: Ticket[]; total: number; nextCursor: string | null };

export type ReviewLink = { id: string; label: string; createdAt: string; revokedAt: string | null; lastUsedAt: string | null };
export type NewReviewLink = { id: string; token: string; fragment: string };

export type Comment = {
  id: string;
  author: 'admin' | 'agent';
  authorLabel: string;
  body: string;
  visibility: 'internal' | 'reviewer';
  statusFrom: Status | null;
  statusTo: Status | null;
  createdAt: string;
};

export type AgentToken = {
  id: string;
  label: string;
  scope: 'read' | 'write';
  projectId: string | null;
  projectName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type Stats = {
  days: number;
  byStatus: Record<Status, number>;
  total: number;
  received: number;
  receivedPrevious: number;
  resolved: number;
  resolvedPrevious: number;
  resolutionSeconds: number | null;
  stale: number;
  oldestTodo: string | null;
  /** Keyed by UTC day, YYYY-MM-DD. */
  daily: { received: Record<string, number>; resolved: Record<string, number> };
  projects: { id: string; name: string; clientLabel: string; todo: number; inProgress: number; review: number; done: number; total: number }[];
  pages: { pageUrl: string; count: number; open: number }[];
  activity: {
    id: string;
    author: 'admin' | 'agent';
    authorLabel: string;
    statusFrom: Status | null;
    statusTo: Status | null;
    createdAt: string;
    ticketId: string;
    ticketText: string;
  }[];
};

export type Onboarding = { projects: number; reviewLinks: number; tickets: number; agentTokens: number; connectedAgents: number };
