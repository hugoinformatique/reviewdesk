import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { toast } from 'sonner';
import { ArrowLeft, Bot, ChevronDown, ChevronUp, ExternalLink, Sparkles, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { anchorUrl, formatAge, formatDate, isMobileViewport, pagePath, projectHue } from '@/lib/format';
import { useCancelFix } from '@/lib/queries';
import { openOverlay, useOverlay } from '@/lib/ui-store';
import { STATUSES, STATUS_LABELS, type Status, type Ticket } from '@/lib/types';
import { useBoard } from '@/features/board/board-context';
import { isFromCard, markFromCard } from '@/features/board/ticket-nav';
import { STATUS_DOT } from '@/features/board/ticket-card';
import { useMoveTicket } from '@/features/board/use-move-ticket';
import { Composer } from './composer';
import { Conversation } from './conversation';
import { InfoRail } from './info-rail';
import { Screenshot } from './screenshot';
import { safeHttpUrl } from './safe-url';

const HUES = ['bg-[var(--hue-0)]', 'bg-[var(--hue-1)]', 'bg-[var(--hue-2)]', 'bg-[var(--hue-3)]', 'bg-[var(--hue-4)]', 'bg-[var(--hue-5)]'];

/** The sheet of one feedback: a child route drawn over the board. */
export function TicketSheet() {
  const { projectId: param = 'all', ticketId = '' } = useParams({ strict: false }) as { projectId?: string; ticketId?: string };
  const board = useBoard();
  const navigate = useNavigate();
  const overlay = useOverlay();
  const [zoomed, setZoomed] = useState(false);
  const warned = useRef(false);

  const ticket = useMemo(() => {
    for (const status of STATUSES) {
      const found = board?.columns[status].find((candidate) => candidate.id === ticketId);
      if (found) return found;
    }
    return undefined;
  }, [board, ticketId]);

  // Closing returns to where the person came from: back when they clicked a card, else replace.
  const backToBoard = () => {
    if (isFromCard()) {
      markFromCard(false);
      window.history.back();
    } else void navigate({ to: '/p/$projectId', params: { projectId: param }, replace: true });
  };
  useEffect(() => () => markFromCard(false), []);
  const openTicket = (id: string) => void navigate({ to: '/p/$projectId/t/$ticketId', params: { projectId: param, ticketId: id }, replace: true });

  // A link to a ticket this board does not show (old link, or a treated one past the first page).
  const missing = Boolean(board?.settled) && !ticket;
  useEffect(() => {
    if (!missing || warned.current) return;
    warned.current = true;
    toast.error("Ce retour n'est pas affiché sur ce tableau.");
    void navigate({ to: '/p/$projectId', params: { projectId: param }, replace: true });
  }, [missing, navigate, param]);

  const siblings = ticket ? (board?.columns[ticket.status] ?? []) : [];
  const index = ticket ? siblings.findIndex((candidate) => candidate.id === ticket.id) : -1;
  const previous = index > 0 ? siblings[index - 1] : undefined;
  const next = index >= 0 ? siblings[index + 1] : undefined;

  // J / K step through the column of the open ticket, unless someone is typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || zoomed || overlay) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="combobox"], [role="listbox"]')) return;
      const to = event.key === 'j' ? next : event.key === 'k' ? previous : undefined;
      if (!to) return;
      event.preventDefault();
      openTicket(to.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <Dialog open onOpenChange={(open) => !open && backToBoard()}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          document.getElementById('ticket-sheet-title')?.focus();
        }}
        className="flex h-[calc(100dvh-1.5rem)] max-h-none flex-col gap-0 overflow-hidden p-0 sm:h-[calc(100dvh-3rem)] sm:max-w-[min(72rem,calc(100%-3rem))]"
      >
        {ticket ? (
          <SheetBody
            key={ticket.id}
            ticket={ticket}
            position={index >= 0 ? { index, total: siblings.length } : undefined}
            onClose={backToBoard}
            onPrevious={previous ? () => openTicket(previous.id) : undefined}
            onNext={next ? () => openTicket(next.id) : undefined}
            onZoomChange={setZoomed}
          />
        ) : (
          <>
            <DialogTitle className="sr-only">Retour</DialogTitle>
            <div className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground" aria-busy="true">
              Chargement du retour…
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SheetBody({
  ticket,
  position,
  onClose,
  onPrevious,
  onNext,
  onZoomChange,
}: {
  ticket: Ticket;
  position?: { index: number; total: number };
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onZoomChange: (open: boolean) => void;
}) {
  const move = useMoveTicket({ done: (to) => `Statut : ${STATUS_LABELS[to]}.`, failed: 'Statut non enregistré.' });
  const cancelFix = useCancelFix();
  const endRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const mobile = isMobileViewport(ticket);
  const anchor = safeHttpUrl(ticket.pageUrl) ? anchorUrl(ticket) : undefined;

  useEffect(() => titleRef.current?.focus({ preventScroll: true }), []);

  const scrollToEnd = () => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => endRef.current?.scrollIntoView({ block: 'end', behavior: reduced ? 'auto' : 'smooth' }), 120);
  };

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-2 border-b border-border px-3 py-2.5 sm:px-4">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <ArrowLeft />
          Tableau
        </Button>
        <div className="flex items-center gap-1" role="group" aria-label="Navigation dans la colonne">
          <Button variant="ghost" size="icon-sm" disabled={!onPrevious} onClick={onPrevious} aria-label="Précédent" title="Précédent (K)">
            <ChevronUp />
          </Button>
          <Button variant="ghost" size="icon-sm" disabled={!onNext} onClick={onNext} aria-label="Suivant" title="Suivant (J)">
            <ChevronDown />
          </Button>
          {position && (
            <span className="hidden px-1 text-xs text-muted-foreground tabular-nums sm:inline">
              {position.index + 1} sur {position.total} · {STATUS_LABELS[ticket.status]}
            </span>
          )}
          <Kbd className="hidden lg:inline-flex">J</Kbd>
          <Kbd className="hidden lg:inline-flex">K</Kbd>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {ticket.fixRequestedAt && (
            <span className="fix-pending inline-flex items-center gap-1 rounded-md bg-st-progress-soft py-0.5 pr-0.5 pl-2 text-xs font-medium text-st-progress" title={`Demandée ${formatAge(ticket.fixRequestedAt)}`}>
              <Bot aria-hidden="true" className="size-3.5" />
              Correction demandée{ticket.fixRequestedFor ? ` à ${ticket.fixRequestedFor}` : ''}
              <button
                type="button"
                aria-label="Annuler la demande de correction"
                disabled={cancelFix.isPending}
                onClick={() =>
                  cancelFix.mutate(ticket.id, {
                    onSuccess: () => toast.success('Demande de correction annulée.'),
                    onError: () => toast.error('Annulation impossible.'),
                  })
                }
                className="inline-flex size-5 items-center justify-center rounded outline-none hover:bg-black/10 focus-visible:ring-[3px] focus-visible:ring-ring dark:hover:bg-white/10"
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            </span>
          )}
          <Select value={ticket.status} onValueChange={(value) => move(ticket, value as Status)}>
            <SelectTrigger size="sm" aria-label="Statut" className="w-[9.5rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  <span aria-hidden="true" className={cn('mr-1.5 inline-block size-2 rounded-full', STATUS_DOT[status])} />
                  {STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {anchor && (
            <Button asChild variant="outline" size="sm">
              <a href={anchor} target="_blank" rel="noreferrer">
                <ExternalLink />
                <span className="hidden sm:inline">Ouvrir au point d'ancrage</span>
                <span className="sr-only sm:hidden">Ouvrir au point d'ancrage</span>
              </a>
            </Button>
          )}
          <Button size="sm" onClick={() => openOverlay({ kind: 'fix', ticketId: ticket.id })}>
            <Sparkles />
            {ticket.fixRequestedAt ? 'Relancer' : 'Lancer la correction'}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Fermer">
            <X />
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_19rem] lg:overflow-hidden">
        <div className="flex min-w-0 flex-col lg:min-h-0 lg:overflow-y-auto">
          <div className="flex flex-col gap-6 px-4 pt-5 pb-4 sm:px-7 sm:pt-6">
            <header className="flex flex-col gap-2">
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span aria-hidden="true" className={cn('size-2 rounded-full', HUES[projectHue(ticket.projectId)])} />
                <span className="font-medium text-subtle-foreground">
                  {ticket.clientLabel} · {ticket.projectName}
                </span>
                <Badge status={ticket.status}>{STATUS_LABELS[ticket.status]}</Badge>
              </p>
              <DialogTitle id="ticket-sheet-title" ref={titleRef} tabIndex={-1} className="text-xl leading-snug font-semibold tracking-tight break-words whitespace-pre-wrap outline-none">
                {ticket.text}
              </DialogTitle>
              <DialogDescription>
                Envoyé par le client <time dateTime={ticket.createdAt} title={formatDate(ticket.createdAt)}>{formatAge(ticket.createdAt)}</time> · {pagePath(ticket.pageUrl)} · {mobile ? 'mobile' : 'ordinateur'}
              </DialogDescription>
            </header>

            <Screenshot ticket={ticket} onZoomChange={onZoomChange} />
            <Conversation ticket={ticket} />
            <div ref={endRef} />
          </div>
          <div className="mt-auto bg-gradient-to-t from-popover from-70% to-transparent px-3 pt-4 pb-3 lg:sticky lg:bottom-0 sm:px-6 sm:pb-4">
            <Composer ticket={ticket} onSent={scrollToEnd} />
          </div>
        </div>
        <aside aria-label="Informations" className="border-t border-border bg-sunken/60 p-4 lg:min-h-0 lg:overflow-y-auto lg:border-t-0 lg:border-l">
          <InfoRail ticket={ticket} />
        </aside>
      </div>
    </>
  );
}
