import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Outlet, useParams } from '@tanstack/react-router';
import { toast } from 'sonner';
import { AlertTriangle, Download, Inbox, LayoutGrid, Link2, List, Search, Settings2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { columnQuery, flattenColumn, projectsQuery, useCreateReviewLink, type TicketFilters } from '@/lib/queries';
import { copyText } from '@/lib/clipboard';
import { openOverlay } from '@/lib/ui-store';
import { PageHeader } from '@/features/shell/page-header';
import { ProjectTabs } from '@/features/shell/project-tabs';
import { knownToken, rememberToken } from '@/features/install/session-tokens';
import { STATUSES, STATUS_LABELS, type Status } from '@/lib/types';
import { cn } from '@/lib/utils';
import { BoardContext } from './board-context';
import { Kanban, type ColumnData } from './kanban';
import { ListView } from './list-view';
import { useMoveTicket } from './use-move-ticket';

type Mode = 'board' | 'list';
const MODE_KEY = 'reviewdesk-board-mode';

function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'list' ? 'list' : 'board';
  } catch {
    return 'board';
  }
}

function useColumn(filters: TicketFilters, status: Status) {
  const query = useInfiniteQuery(columnQuery(filters, status));
  const { tickets, total } = flattenColumn(query.data);
  const data: ColumnData = {
    tickets,
    total,
    hasNext: Boolean(query.hasNextPage),
    loadingMore: query.isFetchingNextPage,
    loadMore: () => {
      query.fetchNextPage().catch(() => toast.error('Chargement impossible.'));
    },
  };
  return { query, data };
}

function useDebounced<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function BoardPage() {
  const params = useParams({ strict: false }) as { projectId?: string; ticketId?: string };
  const routeParam = params.projectId ?? 'all';
  const projectId = routeParam === 'all' ? '' : routeParam;
  const isAll = !projectId;
  const projects = useQuery(projectsQuery);
  const project = projects.data?.find((candidate) => candidate.id === projectId);

  const [search, setSearch] = useState('');
  const page = useDebounced(search, 180);
  const [format, setFormat] = useState<TicketFilters['format']>('');
  const [client, setClient] = useState('');
  const [mode, setMode] = useState<Mode>(readMode);
  const changeMode = (next: Mode) => {
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // Private mode: the choice just lasts for the session.
    }
  };

  const filters = useMemo<TicketFilters>(() => ({ projectId, page, format, client: isAll ? client : '' }), [projectId, page, format, client, isAll]);

  const todo = useColumn(filters, 'TODO');
  const progress = useColumn(filters, 'IN_PROGRESS');
  const review = useColumn(filters, 'REVIEW');
  const done = useColumn(filters, 'DONE');
  const all = [todo, progress, review, done];
  const columns: Record<Status, ColumnData> = { TODO: todo.data, IN_PROGRESS: progress.data, REVIEW: review.data, DONE: done.data };

  const pending = all.some((column) => column.query.isPending);
  const failed = !pending && all.some((column) => column.query.isError && !column.query.data);
  const settled = all.every((column) => !column.query.isPending);
  const open = todo.data.total + progress.data.total + review.data.total;
  const totalAll = open + done.data.total;
  const filtered = Boolean(page.trim() || format);
  const empty = settled && !failed && totalAll === 0 && !filtered;

  const context = useMemo(
    () => ({ filters, settled, columns: { TODO: todo.data.tickets, IN_PROGRESS: progress.data.tickets, REVIEW: review.data.tickets, DONE: done.data.tickets } }),
    [filters, settled, todo.data.tickets, progress.data.tickets, review.data.tickets, done.data.tickets],
  );

  const clients = useMemo(
    () => [...new Set((projects.data ?? []).map((candidate) => candidate.clientLabel).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr')),
    [projects.data],
  );

  const move = useMoveTicket();
  const selectedId = params.ticketId ?? '';

  return (
    <BoardContext.Provider value={context}>
      <div className="flex h-full min-h-0 flex-col gap-4 p-4 sm:p-6">
        <PageHeader
          title={isAll ? 'Tous les retours' : (project?.name ?? 'Projet')}
          actions={!isAll && <ProjectActions projectId={projectId} origin={project?.origins[0]} />}
          tabs={<ProjectTabs param={routeParam} />}
          toolbar={
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <div className="relative min-w-[11rem] flex-1 sm:max-w-xs">
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Filtrer par page" placeholder="Filtrer par page" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={120} className="pl-8" />
          </div>
          <Select value={format || 'all'} onValueChange={(value) => setFormat(value === 'all' ? '' : (value as 'mobile' | 'desktop'))}>
            <SelectTrigger aria-label="Format" className="w-[9.5rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous formats</SelectItem>
              <SelectItem value="mobile">Mobile</SelectItem>
              <SelectItem value="desktop">Ordinateur</SelectItem>
            </SelectContent>
          </Select>
          {isAll && (
            <Select value={client || 'all'} onValueChange={(value) => setClient(value === 'all' ? '' : value)}>
              <SelectTrigger aria-label="Client" className="w-[10.5rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les clients</SelectItem>
                {clients.map((label) => (
                  <SelectItem key={label} value={label}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div role="group" aria-label="Affichage" className="inline-flex h-[34px] items-center rounded-md border border-border-strong bg-background p-0.5 shadow-1">
            {([['board', 'Tableau', LayoutGrid], ['list', 'Liste', List]] as const).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                aria-label={label}
                title={label}
                onClick={() => changeMode(value)}
                className={cn(
                  'inline-flex h-7 w-8 items-center justify-center rounded-[5px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring [&_svg]:size-4',
                  mode === value && 'bg-accent text-foreground',
                )}
              >
                <Icon aria-hidden="true" />
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-3">
            <p role="status" aria-live="polite" className="text-[13px] text-muted-foreground tabular-nums">
              {settled && !failed ? `${open} ouvert${open > 1 ? 's' : ''} · ${totalAll} au total` : ''}
            </p>
            <Button variant="outline" onClick={() => openOverlay({ kind: 'export', filters })}>
              <Sparkles />
              Exporter pour Claude Code
            </Button>
          </div>
        </div>
          }
        />

        <div aria-busy={pending} className="flex min-h-0 flex-1 flex-col">
          {pending ? (
            <BoardSkeleton />
          ) : failed ? (
            <div role="alert" className="flex flex-1 items-center justify-center">
              <EmptyState
                icon={<AlertTriangle />}
                title="Retours indisponibles"
                description="Le chargement a échoué. Vérifiez votre connexion, puis réessayez."
                action={
                  <Button variant="outline" onClick={() => all.forEach((column) => void column.query.refetch())}>
                    Réessayer
                  </Button>
                }
              />
            </div>
          ) : empty ? (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState
                icon={<Inbox />}
                title="Aucun retour pour l'instant"
                description="Les retours de vos clients arrivent ici dès qu'ils cliquent un élément de leur site."
                action={!isAll && <Button onClick={() => openOverlay({ kind: 'install', projectId })}>Installer le widget</Button>}
              />
            </div>
          ) : mode === 'board' ? (
            <Kanban columns={columns} projectParam={routeParam} showProject={isAll} selectedId={selectedId} onMove={move} />
          ) : (
            <ListView columns={columns} projectParam={routeParam} showProject={isAll} selectedId={selectedId} />
          )}
        </div>
      </div>
      <Outlet />
    </BoardContext.Provider>
  );
}

function BoardSkeleton() {
  return (
    <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Chargement des retours">
      {STATUSES.map((status) => (
        <div key={status} className="flex flex-col gap-2 rounded-xl border border-border bg-sunken/70 p-3">
          <Skeleton className="h-4 w-24" />
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className={cn('h-20 w-full', index === 2 && 'h-14')} />
          ))}
          <span className="sr-only">{STATUS_LABELS[status]}</span>
        </div>
      ))}
    </div>
  );
}

function ProjectActions({ projectId, origin }: { projectId: string; origin: string | undefined }) {
  const createLink = useCreateReviewLink();
  const copyLink = async () => {
    try {
      let known = knownToken(projectId);
      if (!known) {
        const link = await createLink.mutateAsync({ projectId });
        known = { id: link.id, token: link.token };
        rememberToken(projectId, known);
      }
      const token = known.token;
      const hash = new URLSearchParams({ project: projectId, token });
      if (origin && origin !== location.origin) hash.set('site', origin);
      if (await copyText(`${location.origin}/relecture.html#${hash}`)) {
        toast.success('Lien de relecture copié : le client y trouve son bouton « Faire un retour ».');
      } else {
        toast.error('Impossible de copier le lien reviewer.');
      }
    } catch {
      toast.error('Impossible de copier le lien reviewer.');
    }
  };
  return (
    <>
      <Button variant="outline" onClick={() => openOverlay({ kind: 'install', projectId })}>
        <Download />
        Installer
      </Button>
      <Button variant="outline" disabled={createLink.isPending} onClick={() => void copyLink()}>
        <Link2 />
        Copier le lien
      </Button>
      <Button variant="outline" onClick={() => openOverlay({ kind: 'project', projectId })}>
        <Settings2 />
        Réglages
      </Button>
    </>
  );
}

