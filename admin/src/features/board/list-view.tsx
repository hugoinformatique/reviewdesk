import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { STATUSES, STATUS_LABELS, type Status } from '@/lib/types';
import type { ColumnData } from './kanban';
import { STATUS_DOT, TicketCard } from './ticket-card';

type Props = { columns: Record<Status, ColumnData>; projectParam: string; showProject: boolean; selectedId: string };

/** Full-width list: one foldable section per status, « Traité » folded to start. */
export function ListView({ columns, projectParam, showProject, selectedId }: Props) {
  const [folded, setFolded] = useState<Record<Status, boolean>>({ TODO: false, IN_PROGRESS: false, REVIEW: false, DONE: true });
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      {STATUSES.map((status) => {
        const data = columns[status];
        const open = !folded[status];
        const remaining = Math.max(0, data.total - data.tickets.length);
        return (
          <section key={status} data-column={status} aria-label={`${STATUS_LABELS[status]} : ${data.total}`}>
            <h2 className="m-0">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setFolded((state) => ({ ...state, [status]: open }))}
                className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-[13px] font-semibold tracking-tight outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring"
              >
                <ChevronRight aria-hidden="true" className={cn('size-4 text-muted-foreground transition-transform duration-150', open && 'rotate-90')} />
                <span aria-hidden="true" className={cn('size-2 rounded-full', STATUS_DOT[status])} />
                {STATUS_LABELS[status]}
                <span className="rounded-md bg-sunken px-1.5 text-xs font-medium text-muted-foreground tabular-nums">{data.total}</span>
              </button>
            </h2>
            {open && (
              <div className="mt-1.5 flex flex-col gap-1.5">
                {data.tickets.length === 0 ? (
                  <p className="px-2 py-3 text-[13px] text-muted-foreground">{status === 'TODO' ? 'Rien à traiter.' : 'Vide'}</p>
                ) : (
                  data.tickets.map((ticket) => (
                    <TicketCard key={ticket.id} ticket={ticket} projectParam={projectParam} showProject={showProject} variant="row" selected={selectedId === ticket.id} />
                  ))
                )}
                {data.hasNext && (
                  <Button variant="ghost" size="sm" className="self-start" disabled={data.loadingMore} onClick={data.loadMore}>
                    Afficher plus{remaining ? ` (${remaining})` : ''}
                  </Button>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
