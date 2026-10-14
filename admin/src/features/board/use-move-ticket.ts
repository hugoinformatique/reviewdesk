import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useSetStatus } from '@/lib/queries';
import { STATUS_LABELS, type Status, type Ticket } from '@/lib/types';
import { moveTicketInCache } from './cache';

/**
 * Optimistic status change: the card changes column at once, the server
 * confirms (or the card goes back and an error says so).
 */
export function useMoveTicket(messages: { done: (to: Status) => string; failed: string } = {
  done: (to) => `Déplacé vers « ${STATUS_LABELS[to]} ».`,
  failed: 'Déplacement refusé, le retour reprend sa place.',
}) {
  const client = useQueryClient();
  const setStatus = useSetStatus();
  return (ticket: Ticket, to: Status) => {
    if (ticket.status === to) return;
    const rollback = moveTicketInCache(client, ticket, to);
    setStatus.mutate(
      { ticketId: ticket.id, status: to },
      {
        onSuccess: () => toast.success(messages.done(to)),
        onError: () => {
          rollback();
          toast.error(messages.failed);
        },
      },
    );
  };
}
