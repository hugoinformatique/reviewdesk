import { createContext, useContext } from 'react';
import type { TicketFilters } from '@/lib/queries';
import type { Status, Ticket } from '@/lib/types';

/** What the ticket sheet (a child route) needs from the board around it. */
export type BoardContextValue = {
  filters: TicketFilters;
  /** Loaded tickets per column, in display order. */
  columns: Record<Status, Ticket[]>;
  /** True once every column has answered (data or error). */
  settled: boolean;
};

export const BoardContext = createContext<BoardContextValue | null>(null);

export function useBoard() {
  return useContext(BoardContext);
}
