/**
 * Home: four figures, the 30-day curve, projects at a glance, what just
 * happened, and the AI-agent card. Everything but the projects list comes
 * from /api/stats; the agent card degrades quietly when its call fails.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Bot, CheckCheck, Inbox, LoaderCircle, Plus, TimerReset, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/features/shell/page-header';
import { formatAge, formatDay, hostOf, humanDuration, periodDays, plural, projectHue } from '@/lib/format';
import { agentTokensQuery, connectedAgentLabels, projectsQuery, requestedCountQuery, statsQuery } from '@/lib/queries';
import { STATUS_LABELS, type Project, type Stats } from '@/lib/types';
import { openOverlay } from '@/lib/ui-store';
import { cn } from '@/lib/utils';

const DAYS = 30;
const HUE_CLASS = ['bg-[var(--hue-0)]', 'bg-[var(--hue-1)]', 'bg-[var(--hue-2)]', 'bg-[var(--hue-3)]', 'bg-[var(--hue-4)]', 'bg-[var(--hue-5)]'];

export function DashboardPage() {
  const projects = useQuery(projectsQuery);
  const stats = useQuery(statsQuery(DAYS));
  const tokens = useQuery(agentTokensQuery);

  // A fresh install has no project: the guide opens once, not on every render.
  const guideShown = useRef(false);
  useEffect(() => {
    if (projects.data && projects.data.length === 0 && !guideShown.current) {
      guideShown.current = true;
      openOverlay({ kind: 'guide' });
    }
  }, [projects.data]);

  const agents = connectedAgentLabels(tokens.data);

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 p-4 sm:p-6">
      <PageHeader title="Votre activité" description="Les 30 derniers jours, tous projets confondus." />
      {stats.isError ? (
        <EmptyState
          icon={<TriangleAlert />}
          title="Tableau de bord indisponible"
          description="Le serveur n’a pas répondu. Réessayez dans un instant."
          action={
            <Button variant="outline" size="sm" onClick={() => void stats.refetch()}>
              Réessayer
            </Button>
          }
        />
      ) : (
        <>
          <StatCards stats={stats.data} projects={projects.data} />
          <TrendCard stats={stats.data} />
          <div className="grid gap-6 lg:grid-cols-2">
            <ProjectsCard stats={stats.data} projects={projects.data} loading={projects.isPending || stats.isPending} />
            <ActivityCard stats={stats.data} />
          </div>
        </>
      )}
      <AgentsCard agents={agents} />
    </div>
  );
}

/* ------------------------------------------------------------------ stats */

function StatCards({ stats, projects }: { stats: Stats | undefined; projects: Project[] | undefined }) {
  if (!stats) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" aria-busy="true">
        {[0, 1, 2, 3].map((index) => (
          <Card key={index} className="stat-card">
            <CardHeader>
              <Skeleton className="h-4 w-20" />
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Skeleton className="h-8 w-14" />
              <Skeleton className="h-3.5 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }
  const delegated = (projects ?? []).reduce((sum, project) => sum + project.fixRequestedCount, 0);
  const cards: { label: string; value: string; note: string; icon: ReactNode; tone: string }[] = [
    {
      label: 'À traiter',
      value: String(stats.byStatus.TODO),
      note: stats.oldestTodo ? `le plus ancien ${formatAge(stats.oldestTodo)}` : 'rien en attente',
      icon: <Inbox />,
      tone: 'bg-st-todo-soft text-st-todo',
    },
    {
      label: 'En cours',
      value: String(stats.byStatus.IN_PROGRESS),
      note: delegated ? `dont ${delegated} confié${delegated > 1 ? 's' : ''} à un agent` : 'personne n’attend',
      icon: <LoaderCircle />,
      tone: 'bg-st-progress-soft text-st-progress',
    },
    {
      label: 'À valider',
      value: String(stats.byStatus.REVIEW),
      note: 'en attente de votre accord',
      icon: <CheckCheck />,
      tone: 'bg-st-review-soft text-st-review',
    },
    {
      label: 'Délai moyen',
      value: stats.resolutionSeconds === null ? '—' : humanDuration(stats.resolutionSeconds),
      note: 'entre l’arrivée et le traitement',
      icon: <TimerReset />,
      tone: 'bg-secondary text-muted-foreground',
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label} className="stat-card gap-3">
          <CardHeader>
            <CardTitle className="text-[13.5px] font-medium text-subtle-foreground">{card.label}</CardTitle>
            <CardAction>
              <span aria-hidden className={cn('flex size-8 items-center justify-center rounded-md [&_svg]:size-4', card.tone)}>
                {card.icon}
              </span>
            </CardAction>
          </CardHeader>
          <CardContent>
            <p className="text-[28px] leading-none font-semibold tracking-tight tabular-nums">{card.value}</p>
            <p className="mt-2 text-[12.5px] text-muted-foreground">{card.note}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ chart */

type Point = { day: string; received: number; resolved: number };

function TrendTooltip({ active, payload }: { active?: boolean; payload?: { payload: Point }[] }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-2">
      <p className="mb-1 font-medium">{formatDay(point.day)}</p>
      <p className="flex items-center gap-2 text-muted-foreground">
        <span aria-hidden className="h-0 w-3 border-t-2 border-dashed border-chart-2" />
        {plural(point.received, 'reçu')}
      </p>
      <p className="flex items-center gap-2 text-muted-foreground">
        <span aria-hidden className="h-0.5 w-3 bg-chart-1" />
        {plural(point.resolved, 'traité')}
      </p>
    </div>
  );
}

function TrendCard({ stats }: { stats: Stats | undefined }) {
  const days = stats ? periodDays(stats) : [];
  const data: Point[] = stats
    ? days.map((day) => ({ day, received: stats.daily.received[day] ?? 0, resolved: stats.daily.resolved[day] ?? 0 }))
    : [];
  const peak = Math.max(0, ...data.flatMap((point) => [point.received, point.resolved]));
  const top = peak <= 4 ? 4 : Math.ceil(peak / 4) * 4;
  const yTicks = [0, 1, 2, 3, 4].map((step) => (top / 4) * step);
  const last = data.length - 1;
  const xTicks = last > 0 ? [0, 1, 2, 3, 4].map((step) => data[Math.round((last * step) / 4)]!.day) : [];
  const received = data.reduce((sum, point) => sum + point.received, 0);
  const resolved = data.reduce((sum, point) => sum + point.resolved, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Retours reçus et traités</CardTitle>
        <CardDescription>Par jour, sur {DAYS} jours</CardDescription>
        <CardAction>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-0 w-3.5 border-t-2 border-dashed border-chart-2" />
              Reçus
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-3.5 bg-chart-1" />
              Traités
            </span>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        {!stats ? (
          <Skeleton className="h-60 w-full" aria-busy="true" />
        ) : (
          <div role="img" aria-label={`${plural(received, 'retour reçu', 'retours reçus')} et ${resolved} traité${resolved > 1 ? 's' : ''} sur ${DAYS} jours`} className="h-60 w-full text-xs">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }} accessibilityLayer={false}>
                <defs>
                  <linearGradient id="rd-resolved" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" style={{ stopColor: 'var(--chart-1)', stopOpacity: 0.16 }} />
                    <stop offset="100%" style={{ stopColor: 'var(--chart-1)', stopOpacity: 0.01 }} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="day"
                  ticks={xTicks}
                  interval={0}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  padding={{ left: 14, right: 34 }}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11.5 }}
                  tickFormatter={(day: string) => (day === data[last]?.day ? 'aujourd’hui' : formatDay(day))}
                />
                <YAxis
                  domain={[0, top]}
                  ticks={yTicks}
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  width={28}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11.5 }}
                />
                <Tooltip content={<TrendTooltip />} cursor={{ stroke: 'var(--border-strong)' }} />
                <Area dataKey="received" type="monotone" stroke="var(--chart-2)" strokeDasharray="4 4" fill="none" strokeWidth={1.75} dot={false} activeDot={{ r: 3.5 }} />
                <Area dataKey="resolved" type="monotone" stroke="var(--chart-1)" fill="url(#rd-resolved)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* --------------------------------------------------------------- projects */

function ProjectPill({ project, row }: { project: Project; row: Stats['projects'][number] | undefined }) {
  const todo = row?.todo ?? project.todoCount;
  const active = (row ? row.inProgress + row.review : project.inProgressCount + project.reviewCount) > 0;
  if (!project.widgetSeenAt) return <Badge variant="outline">Widget à installer</Badge>;
  if (todo > 0) return <Badge status="TODO">{todo} à traiter</Badge>;
  if (active) return <Badge status="IN_PROGRESS">En cours</Badge>;
  return <Badge status="DONE">À jour</Badge>;
}

function ProjectsCard({ stats, projects, loading }: { stats: Stats | undefined; projects: Project[] | undefined; loading: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Projets actifs</CardTitle>
        <CardDescription>Où en sont vos clients</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={() => openOverlay({ kind: 'guide' })}>
            <Plus />
            Nouveau projet
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {loading ? (
          <div className="flex flex-col gap-4" aria-busy="true">
            {[0, 1, 2].map((index) => (
              <div key={index} className="flex flex-col gap-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-1.5 w-full" />
              </div>
            ))}
          </div>
        ) : !projects?.length ? (
          <p className="py-6 text-center text-[13.5px] text-muted-foreground">Aucun projet pour l’instant.</p>
        ) : (
          projects.map((project) => {
            const row = stats?.projects.find((entry) => entry.id === project.id);
            const total = row?.total ?? 0;
            const done = row?.done ?? 0;
            const meta = [project.clientLabel, project.origins[0] ? hostOf(project.origins[0]) : ''].filter(Boolean).join(' · ');
            return (
              <Link
                key={project.id}
                to="/p/$projectId"
                params={{ projectId: project.id }}
                className="-mx-2 flex flex-col gap-2 rounded-md px-2 py-2.5 outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring"
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span aria-hidden className={cn('size-2.5 shrink-0 rounded-full', HUE_CLASS[projectHue(project.id)])} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm leading-tight font-medium">{project.name}</span>
                      {meta && <span className="block truncate text-xs text-muted-foreground">{meta}</span>}
                    </span>
                  </span>
                  <ProjectPill project={project} row={row} />
                </span>
                <span className="flex items-center gap-3">
                  <Progress value={total ? Math.round((done / total) * 100) : 0} aria-label={`${project.name} : avancement`} />
                  <span className="w-9 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{total ? `${Math.round((done / total) * 100)} %` : '—'}</span>
                </span>
                <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{total ? `${done} traité${done > 1 ? 's' : ''} sur ${total}` : 'Aucun retour reçu'}</span>
                  {project.lastTicketAt && <span>dernier retour {formatAge(project.lastTicketAt)}</span>}
                </span>
              </Link>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

/* --------------------------------------------------------------- activity */

function ActivityCard({ stats }: { stats: Stats | undefined }) {
  const entries = stats?.activity.slice(0, 8) ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Activité récente</CardTitle>
        <CardDescription>Les derniers mouvements sur vos retours</CardDescription>
      </CardHeader>
      <CardContent>
        {!stats ? (
          <div className="flex flex-col gap-4" aria-busy="true">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="flex items-start gap-3">
                <Skeleton className="size-8 rounded-full" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-3.5 w-3/4" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : entries.length === 0 ? (
          <p className="py-6 text-center text-[13.5px] text-muted-foreground">Rien de nouveau</p>
        ) : (
          <ol className="flex flex-col gap-4">
            {entries.map((entry) => {
              const name = entry.authorLabel || (entry.author === 'agent' ? 'Agent' : 'Équipe');
              return (
                <li key={entry.id} className="flex items-start gap-3">
                  <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium text-subtle-foreground">
                    {name.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] leading-snug">
                      <span className="font-medium">{name}</span>{' '}
                      <span className="text-muted-foreground">{entry.statusTo ? `a passé à « ${STATUS_LABELS[entry.statusTo]} »` : 'a commenté'}</span>
                    </p>
                    <Link
                      to="/p/$projectId/t/$ticketId"
                      params={{ projectId: 'all', ticketId: entry.ticketId }}
                      className="line-clamp-1 rounded-sm text-[13px] text-subtle-foreground underline-offset-4 hover:text-foreground hover:underline"
                    >
                      {entry.ticketText}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">{formatAge(entry.createdAt)}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

/* ----------------------------------------------------------------- agents */

const TOOLS = ['Claude Code', 'Codex', 'Cursor', 'VS Code', 'API'];

function AgentsCard({ agents }: { agents: string[] }) {
  const waiting = useQuery({ ...requestedCountQuery(''), enabled: agents.length > 0 });
  const connected = agents.length > 0;
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-sunken text-foreground shadow-edge">
            <Bot className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[15px] font-semibold tracking-tight">{connected ? 'Votre agent corrige les retours' : 'Faites corriger les retours par votre agent IA'}</h3>
              {connected && <Badge status="DONE">{plural(agents.length, 'agent connecté', 'agents connectés')}</Badge>}
            </div>
            <p className="mt-1 text-[13.5px] text-muted-foreground">
              {connected
                ? `Connecté : ${agents.join(', ')}${waiting.data ? ` · ${plural(waiting.data, 'correction')} en attente` : ''}`
                : 'Branchez Claude Code, Codex ou Cursor : il lit les retours, corrige le code et vous les remet à valider.'}
            </p>
            {!connected && (
              <ul aria-label="Outils compatibles" className="mt-3 flex flex-wrap gap-1.5">
                {TOOLS.map((tool) => (
                  <li key={tool} className="rounded-md border border-border bg-sunken px-2 py-0.5 text-xs text-subtle-foreground">
                    {tool}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {connected ? (
            <>
              <Button variant="outline" asChild>
                <Link to="/p/$projectId" params={{ projectId: 'all' }}>
                  Voir les retours
                </Link>
              </Button>
              <Button onClick={() => openOverlay({ kind: 'agents' })}>Gérer les agents</Button>
            </>
          ) : (
            <Button onClick={() => openOverlay({ kind: 'agents' })}>Connecter un agent</Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
