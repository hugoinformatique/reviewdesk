/**
 * Board data lives in TanStack Query's cache (one infinite query per status
 * and filter set). These helpers read and patch it so a drag, a status select
 * and the ticket sheet all see the same thing without a global store.
 */
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type { Status, Ticket, TicketPage } from '@/lib/types';

type Data = InfiniteData<TicketPage, string>;
const COLUMN_KEY = ['tickets', 'column'] as const;

function entries(client: QueryClient) {
  return client.getQueriesData<Data>({ queryKey: COLUMN_KEY });
}

/** Any ticket of any loaded column, whatever the filters that loaded it. */
export function findTicketInCache(client: QueryClient, ticketId: string): Ticket | undefined {
  for (const [, data] of entries(client)) {
    for (const page of data?.pages ?? []) {
      const found = page.tickets.find((ticket) => ticket.id === ticketId);
      if (found) return found;
    }
  }
  return undefined;
}

const hasTicket = (data: Data | undefined, ticketId: string) =>
  Boolean(data?.pages.some((page) => page.tickets.some((ticket) => ticket.id === ticketId)));

/**
 * Moves a ticket to the head of another column in every filter set that
 * currently shows it, and fixes both totals. Returns a function restoring the
 * previous state (for a refused move).
 */
export function moveTicketInCache(client: QueryClient, ticket: Ticket, to: Status): () => void {
  const snapshot = entries(client);
  const groups = new Map<string, { from?: Data; fromKey?: readonly unknown[]; toKey?: readonly unknown[]; toData?: Data }>();
  for (const [key, data] of snapshot) {
    const filters = JSON.stringify(key[2]);
    const status = key[3] as Status;
    const group = groups.get(filters) ?? {};
    if (status === ticket.status && hasTicket(data, ticket.id)) {
      group.from = data;
      group.fromKey = key;
    }
    if (status === to) {
      group.toKey = key;
      group.toData = data;
    }
    groups.set(filters, group);
  }
  for (const group of groups.values()) {
    if (!group.from || !group.fromKey || !group.toKey || !group.toData) continue;
    const moved: Ticket = { ...ticket, status: to, fixRequestedAt: to === 'REVIEW' || to === 'DONE' ? null : ticket.fixRequestedAt };
    client.setQueryData<Data>(group.fromKey, {
      ...group.from,
      pages: group.from.pages.map((page, index) => ({
        ...page,
        total: index === 0 ? Math.max(0, page.total - 1) : page.total,
        tickets: page.tickets.filter((candidate) => candidate.id !== ticket.id),
      })),
    });
    client.setQueryData<Data>(group.toKey, {
      ...group.toData,
      pages: group.toData.pages.map((page, index) =>
        index === 0 ? { ...page, total: page.total + 1, tickets: [moved, ...page.tickets] } : page,
      ),
    });
  }
  return () => {
    for (const [key, data] of snapshot) client.setQueryData(key, data);
  };
}
