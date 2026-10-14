import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { plural } from '@/lib/format';
import { STATUSES, STATUS_LABELS, type Status, type Ticket } from '@/lib/types';
import { STATUS_DOT, TicketCard } from './ticket-card';

export type ColumnData = {
  tickets: Ticket[];
  total: number;
  hasNext: boolean;
  loadingMore: boolean;
  loadMore: () => void;
};

type Props = {
  columns: Record<Status, ColumnData>;
  projectParam: string;
  showProject: boolean;
  selectedId: string;
  onMove: (ticket: Ticket, to: Status) => void;
};

/** Pointer first (a click still opens the ticket); the keyboard hops column to column. */
const collision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length ? within : rectIntersection(args);
};

const columnHop: KeyboardCoordinateGetter = (event, { context: { active, droppableRects, collisionRect } }) => {
  const direction = event.code === 'ArrowRight' ? 1 : event.code === 'ArrowLeft' ? -1 : 0;
  if (!direction) return undefined;
  event.preventDefault();
  if (!active || !collisionRect) return undefined;
  const rects = STATUSES.map((status) => droppableRects.get(status)).filter((rect) => rect !== undefined);
  const centre = collisionRect.left + collisionRect.width / 2;
  const current = Math.max(0, rects.findIndex((rect) => centre >= rect.left && centre <= rect.left + rect.width));
  const target = rects[current + direction];
  if (!target) return undefined;
  return { x: target.left + (target.width - collisionRect.width) / 2, y: target.top + 56 };
};

export function Kanban({ columns, projectParam, showProject, selectedId, onMove }: Props) {
  const [dragging, setDragging] = useState<Ticket | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnHop, keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] } }),
  );

  const onDragStart = ({ active }: DragStartEvent) => setDragging((active.data.current?.ticket as Ticket | undefined) ?? null);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    const ticket = active.data.current?.ticket as Ticket | undefined;
    const to = over?.id as Status | undefined;
    if (ticket && to && STATUSES.includes(to) && to !== ticket.status) onMove(ticket, to);
  };

  const find = (id: string | number) => Object.values(columns).flatMap((column) => column.tickets).find((ticket) => ticket.id === id);
  const describe = (id: string | number) => `« ${find(id)?.text.slice(0, 60) ?? 'retour'} »`;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            'Pour déplacer ce retour au clavier : Espace pour le saisir, flèches gauche et droite pour changer de colonne, Espace ou Entrée pour le déposer, Échap pour annuler.',
        },
        announcements: {
          onDragStart: ({ active }) => `${describe(active.id)} saisi.`,
          onDragOver: ({ active, over }) => (over ? `${describe(active.id)} au-dessus de la colonne « ${STATUS_LABELS[over.id as Status]} ».` : undefined),
          onDragEnd: ({ active, over }) => (over ? `${describe(active.id)} déposé dans « ${STATUS_LABELS[over.id as Status]} ».` : `${describe(active.id)} reposé.`),
          onDragCancel: ({ active }) => `Déplacement annulé pour ${describe(active.id)}.`,
        },
      }}
    >
      <div className="-mx-4 flex min-h-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 lg:mx-0 lg:grid lg:snap-none lg:grid-cols-4 lg:overflow-x-visible lg:px-0">
        {STATUSES.map((status) => (
          <Column key={status} status={status} data={columns[status]} projectParam={projectParam} showProject={showProject} selectedId={selectedId} />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 160, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }}>
        {dragging ? (
          <div className="rotate-1 cursor-grabbing opacity-95 shadow-3">
            <TicketCard ticket={dragging} projectParam={projectParam} showProject={showProject} variant="card" />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({ status, data, projectParam, showProject, selectedId }: { status: Status; data: ColumnData; projectParam: string; showProject: boolean; selectedId: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const remaining = Math.max(0, data.total - data.tickets.length);
  return (
    <section
      ref={setNodeRef}
      data-column={status}
      aria-label={`${STATUS_LABELS[status]} : ${plural(data.total, 'retour')}`}
      className={cn(
        'flex min-h-[12rem] w-[85vw] max-w-[20rem] shrink-0 snap-start flex-col rounded-xl border border-border bg-sunken/70 transition-colors duration-150 lg:w-auto lg:max-w-none',
        isOver && 'border-foreground/40 bg-accent',
      )}
    >
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span aria-hidden="true" className={cn('size-2 rounded-full', STATUS_DOT[status])} />
        <h2 className="text-[13px] font-semibold tracking-tight">{STATUS_LABELS[status]}</h2>
        <span className="rounded-md bg-background px-1.5 text-xs font-medium text-muted-foreground tabular-nums shadow-edge">{data.total}</span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 lg:max-h-[calc(100dvh-17rem)]">
        {data.tickets.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border-strong px-3 py-6 text-center text-[13px] text-muted-foreground">
            {status === 'TODO' ? 'Rien à traiter.' : 'Vide'}
          </p>
        ) : (
          data.tickets.map((ticket) => (
            <DraggableCard key={ticket.id} ticket={ticket} projectParam={projectParam} showProject={showProject} selected={selectedId === ticket.id} />
          ))
        )}
        {data.hasNext && (
          <Button variant="ghost" size="sm" className="w-full" disabled={data.loadingMore} onClick={data.loadMore}>
            Afficher plus{remaining ? ` (${remaining})` : ''}
          </Button>
        )}
      </div>
    </section>
  );
}

function DraggableCard({ ticket, projectParam, showProject, selected }: { ticket: Ticket; projectParam: string; showProject: boolean; selected: boolean }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: ticket.id, data: { ticket } });
  return (
    <div ref={setNodeRef} {...listeners} className={cn('group/drag relative touch-manipulation', isDragging && 'opacity-40')}>
      <TicketCard
        ticket={ticket}
        projectParam={projectParam}
        showProject={showProject}
        variant="card"
        selected={selected}
        linkRef={setActivatorNodeRef}
        linkProps={{ ...attributes, role: undefined, 'aria-roledescription': 'retour déplaçable' }}
      />
      <GripVertical aria-hidden="true" className="pointer-events-none absolute top-3 right-2 size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover/drag:opacity-60 group-focus-within/drag:opacity-60" />
    </div>
  );
}
