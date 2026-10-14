/**
 * Server state, through TanStack Query. Every key lives in `keys`, so a
 * mutation invalidates exactly what it changed. Screens never call fetch().
 */
import { infiniteQueryOptions, queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, qs } from './api';
import type {
  AgentToken,
  Comment,
  NewReviewLink,
  Onboarding,
  Project,
  ProjectInput,
  ReviewLink,
  Stats,
  Status,
  Ticket,
  TicketPage,
} from './types';

/** Board filters; `projectId` empty means every project. */
export type TicketFilters = { projectId: string; page: string; format: '' | 'mobile' | 'desktop'; client: string };

/** Open columns read 60 at a time, the done column 20: it only grows. */
export const PAGE_SIZE: Record<Status, number> = { TODO: 60, IN_PROGRESS: 60, REVIEW: 60, DONE: 20 };

export const keys = {
  session: ['session'] as const,
  projects: ['projects'] as const,
  tickets: ['tickets'] as const,
  column: (filters: TicketFilters, status: Status) => ['tickets', 'column', filters, status] as const,
  requestedCount: (projectId: string) => ['tickets', 'requested', projectId] as const,
  comments: (ticketId: string) => ['comments', ticketId] as const,
  stats: (days: number, projectId: string) => ['stats', days, projectId] as const,
  reviewLinks: (projectId: string) => ['review-links', projectId] as const,
  agentTokens: ['agent-tokens'] as const,
  onboarding: ['onboarding'] as const,
  brandingSettings: ['branding', 'settings'] as const,
};

export const projectsQuery = queryOptions({
  queryKey: keys.projects,
  queryFn: () => api<Project[]>('/api/projects'),
});

function ticketParams(filters: TicketFilters) {
  return {
    projectId: filters.projectId,
    page: filters.page.trim().slice(0, 120),
    format: filters.format,
    // The client filter only means something across projects.
    client: filters.projectId ? '' : filters.client,
  };
}

export const columnQuery = (filters: TicketFilters, status: Status) =>
  infiniteQueryOptions({
    queryKey: keys.column(filters, status),
    initialPageParam: '' as string,
    queryFn: ({ pageParam, signal }) =>
      api<TicketPage>(`/api/tickets${qs({ ...ticketParams(filters), status, limit: PAGE_SIZE[status], cursor: pageParam })}`, { signal }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

/** Every ticket of a column's loaded pages, and its server-side total. */
export function flattenColumn(data: { pages: TicketPage[] } | undefined) {
  return { tickets: data?.pages.flatMap((page) => page.tickets) ?? [], total: data?.pages[0]?.total ?? 0 };
}

export const requestedCountQuery = (projectId: string) =>
  queryOptions({
    queryKey: keys.requestedCount(projectId),
    queryFn: async () => (await api<TicketPage>(`/api/tickets${qs({ projectId, requested: 1, limit: 1 })}`)).total,
  });

export const commentsQuery = (ticketId: string) =>
  queryOptions({
    queryKey: keys.comments(ticketId),
    queryFn: async () => (await api<{ comments: Comment[] }>(`/api/tickets/${ticketId}/comments`)).comments,
  });

export const statsQuery = (days: 7 | 30 | 90, projectId = '') =>
  queryOptions({
    queryKey: keys.stats(days, projectId),
    queryFn: () => api<Stats>(`/api/stats${qs({ days, projectId })}`),
  });

export const reviewLinksQuery = (projectId: string) =>
  queryOptions({
    queryKey: keys.reviewLinks(projectId),
    queryFn: async () => (await api<{ links: ReviewLink[] }>(`/api/projects/${projectId}/review-links`)).links,
    enabled: Boolean(projectId),
  });

export const agentTokensQuery = queryOptions({
  queryKey: keys.agentTokens,
  queryFn: async () => (await api<{ tokens: AgentToken[] }>('/api/agent-tokens')).tokens,
});

export const onboardingQuery = queryOptions({
  queryKey: keys.onboarding,
  queryFn: () => api<Onboarding>('/api/onboarding'),
});

/** Labels of the agent tokens that have already called in. */
export function connectedAgentLabels(tokens: AgentToken[] | undefined) {
  return (tokens ?? []).filter((token) => !token.revokedAt && token.lastUsedAt).map((token) => token.label || 'Agent');
}

/* ---------------------------------------------------------------- mutations */

/** After any write that moves counts around: lists, totals, dashboard. */
function useRefreshAll() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: keys.projects }),
      client.invalidateQueries({ queryKey: keys.tickets }),
      client.invalidateQueries({ queryKey: ['stats'] }),
      client.invalidateQueries({ queryKey: keys.onboarding }),
    ]);
}

export function useSetStatus() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: ({ ticketId, status }: { ticketId: string; status: Status }) =>
      api(`/api/tickets/${ticketId}`, { method: 'PATCH', body: { status } }),
    onSettled: refresh,
  });
}

export function useAddComment() {
  const client = useQueryClient();
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: ({ ticketId, body, visibility }: { ticketId: string; body: string; visibility: Comment['visibility'] }) =>
      api(`/api/tickets/${ticketId}/comments`, { method: 'POST', body: { body, visibility } }),
    onSuccess: (_, { ticketId }) => Promise.all([client.invalidateQueries({ queryKey: keys.comments(ticketId) }), refresh()]),
  });
}

export function useRequestFix() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: ({ ticketId, agent }: { ticketId: string; agent: string }) =>
      api(`/api/tickets/${ticketId}/fix-request`, { method: 'POST', body: { agent } }),
    onSettled: refresh,
  });
}

export function useCancelFix() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (ticketId: string) => api(`/api/tickets/${ticketId}/fix-request`, { method: 'DELETE' }),
    onSettled: refresh,
  });
}

export function useSaveProject() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: ProjectInput }) =>
      api<{ id: string; name: string }>(id ? `/api/projects/${id}` : '/api/projects', { method: id ? 'PATCH' : 'POST', body: input }),
    onSuccess: refresh,
  });
}

export function useDeleteProject() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (id: string) => api(`/api/projects/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
}

export function useCreateReviewLink() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, label }: { projectId: string; label?: string }) =>
      api<NewReviewLink>(`/api/projects/${projectId}/review-links`, { method: 'POST', body: label ? { label } : {} }),
    onSuccess: (_, { projectId }) =>
      Promise.all([
        client.invalidateQueries({ queryKey: keys.reviewLinks(projectId) }),
        client.invalidateQueries({ queryKey: keys.onboarding }),
      ]),
  });
}

export function useRevokeReviewLink() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, linkId }: { projectId: string; linkId: string }) =>
      api(`/api/projects/${projectId}/review-links/${linkId}/revoke`, { method: 'POST' }),
    onSuccess: (_, { projectId }) =>
      Promise.all([
        client.invalidateQueries({ queryKey: keys.reviewLinks(projectId) }),
        client.invalidateQueries({ queryKey: keys.onboarding }),
      ]),
  });
}

export function useCreateAgentToken() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { label: string; scope: AgentToken['scope']; projectId?: string }) =>
      api<{ id: string; token: string }>('/api/agent-tokens', { method: 'POST', body: input }),
    onSuccess: () =>
      Promise.all([client.invalidateQueries({ queryKey: keys.agentTokens }), client.invalidateQueries({ queryKey: keys.onboarding })]),
  });
}

export function useRevokeAgentToken() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/agent-tokens/${id}/revoke`, { method: 'POST' }),
    onSuccess: () =>
      Promise.all([client.invalidateQueries({ queryKey: keys.agentTokens }), client.invalidateQueries({ queryKey: keys.onboarding })]),
  });
}

export type { Ticket };
