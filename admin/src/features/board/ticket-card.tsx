import { Link } from '@tanstack/react-router';
import { Bot, Camera, MessageSquare, Monitor, Smartphone } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatAge, formatDate, isMobileViewport, pagePath, projectHue } from '@/lib/format';
import type { Ticket } from '@/lib/types';

const HUES = ['bg-[var(--hue-0)]', 'bg-[var(--hue-1)]', 'bg-[var(--hue-2)]', 'bg-[var(--hue-3)]', 'bg-[var(--hue-4)]', 'bg-[var(--hue-5)]'];

export const STATUS_DOT: Record<Ticket['status'], string> = {
  TODO: 'bg-st-todo',
  IN_PROGRESS: 'bg-st-progress',
  REVIEW: 'bg-st-review',
  DONE: 'bg-st-done',
};

type Props = {
  ticket: Ticket;
  projectParam: string;
  /** Show the project chip (board across all projects). */
  showProject: boolean;
  variant: 'card' | 'row';
  selected?: boolean;
  /** Props from the drag handle (ref, listeners, attributes), card variant only. */
  linkProps?: Record<string, unknown>;
  linkRef?: (node: HTMLElement | null) => void;
};

/** The card body: a link to the ticket sheet. All reviewer text is React text. */
export function TicketCard({ ticket, projectParam, showProject, variant, selected, linkProps, linkRef }: Props) {
  const mobile = isMobileViewport(ticket);
  const DeviceIcon = mobile ? Smartphone : Monitor;
  const hasShot = Boolean(ticket.screenshotId);
  return (
    <Link
      ref={linkRef}
      to="/p/$projectId/t/$ticketId"
      params={{ projectId: projectParam, ticketId: ticket.id }}
      aria-current={selected ? 'true' : undefined}
      data-ticket-id={ticket.id}
      draggable={false}
      {...linkProps}
      className={cn(
        'group/card flex gap-3 rounded-lg border border-border bg-card text-left shadow-1 transition-[border-color,box-shadow,background-color] duration-150 outline-none hover:border-border-strong hover:shadow-2 focus-visible:ring-[3px] focus-visible:ring-ring',
        variant === 'card' ? 'flex-col p-3' : 'items-start p-3 sm:items-center',
        selected && 'border-foreground/40',
      )}
    >
      {variant === 'row' && hasShot && (
        <img
          src={`/api/uploads/${ticket.screenshotId}`}
          alt=""
          loading="lazy"
          className="hidden h-12 w-20 shrink-0 rounded-md border border-border object-cover object-top sm:block"
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className={cn('text-[13.5px] leading-snug font-medium break-words text-foreground', variant === 'card' ? 'line-clamp-3' : 'line-clamp-2')}>
          {ticket.text}
        </p>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
          {showProject && (
            <span className="inline-flex max-w-[11rem] items-center gap-1.5 font-medium text-subtle-foreground" title={`${ticket.clientLabel} · ${ticket.projectName}`}>
              <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', HUES[projectHue(ticket.projectId)])} />
              <span className="truncate">{ticket.projectName}</span>
            </span>
          )}
          <span className="inline-flex min-w-0 max-w-[10rem] items-center gap-1" title={ticket.pageUrl}>
            <DeviceIcon aria-label={mobile ? 'Mobile' : 'Ordinateur'} className="size-3.5 shrink-0" />
            <span className="truncate">{pagePath(ticket.pageUrl)}</span>
          </span>
          <time dateTime={ticket.createdAt} title={formatDate(ticket.createdAt)} className="tabular-nums">
            {formatAge(ticket.createdAt)}
          </time>
          {variant === 'card' && hasShot && <span title="Capture jointe" role="img" aria-label="Capture jointe"><Camera aria-hidden="true" className="size-3.5" /></span>}
          {(ticket.commentCount ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1 tabular-nums" title="Commentaires">
              <MessageSquare aria-hidden="true" className="size-3.5" />
              <span className="sr-only">Commentaires : </span>
              {ticket.commentCount}
            </span>
          )}
          {ticket.fixRequestedAt && (
            <Badge variant="secondary" className="h-5 gap-1 px-1.5" title={`Correction demandée ${formatAge(ticket.fixRequestedAt)}`}>
              <Bot aria-hidden="true" />
              {ticket.fixRequestedFor || 'Agent'}
            </Badge>
          )}
        </div>
      </div>
    </Link>
  );
}
