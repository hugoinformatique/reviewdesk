import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { BarChart3, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { deltaNote, formatAge, humanDuration, periodDays } from '@/lib/format';
import { agentTokensQuery, connectedAgentLabels, onboardingQuery, projectsQuery, requestedCountQuery, statsQuery } from '@/lib/queries';
import type { Stats } from '@/lib/types';
import { projectIdOf } from '@/router';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/features/shell/page-header';
import { ProjectTabs } from '@/features/shell/project-tabs';
import { ActivityChart } from './activity-chart';
import { AiCard } from './ai-card';
import { Kpi } from './kpi';
import { OnboardingPanel } from './onboarding-panel';
import { BreakdownPanel, FeedPanel, PagesPanel, Panel, ProjectsPanel } from './panels';

type Period = 7 | 30 | 90;
const PERIODS: Period[] = [7, 30, 90];

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className={cn('h-[104px] rounded-lg', i === 4 && 'col-span-2 lg:col-span-1')} />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-[330px] rounded-lg" />
        <Skeleton className="h-[330px] rounded-lg" />
        <Skeleton className="h-[260px] rounded-lg" />
        <Skeleton className="h-[260px] rounded-lg" />
      </div>
    </div>
  );
}

function Kpis({ stats }: { stats: Stats }) {
  const days = periodDays(stats);
  const open = stats.byStatus.TODO + stats.byStatus.IN_PROGRESS + stats.byStatus.REVIEW;
  const received = deltaNote(stats.received, stats.receivedPrevious, stats.days);
  const resolved = deltaNote(stats.resolved, stats.resolvedPrevious, stats.days);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Kpi
        label="À traiter"
        value={String(stats.byStatus.TODO)}
        note={stats.oldestTodo ? `le plus ancien : ${formatAge(stats.oldestTodo)}` : 'rien en attente'}
        accent="var(--st-todo)"
      />
      <Kpi label="Ouverts" value={String(open)} note={stats.stale ? `dont ${stats.stale} depuis plus de 7 jours` : 'aucun en retard'} />
      <Kpi
        label={`Reçus · ${stats.days} j`}
        value={String(stats.received)}
        note={received.text}
        tone={received.tone}
        spark={days.map((d) => stats.daily.received[d] ?? 0)}
        accent="var(--chart-2)"
      />
      <Kpi
        label={`Traités · ${stats.days} j`}
        value={String(stats.resolved)}
        note={resolved.text}
        tone={resolved.tone}
        spark={days.map((d) => stats.daily.resolved[d] ?? 0)}
        accent="var(--st-done)"
      />
      <Kpi
        label="Délai moyen"
        value={stats.resolutionSeconds == null ? '—' : humanDuration(stats.resolutionSeconds)}
        note={stats.resolutionSeconds == null ? 'aucun retour traité' : 'du retour au traitement'}
      />
    </div>
  );
}

export function OverviewPage() {
  const { projectId: param } = useParams({ strict: false }) as { projectId: string };
  const projectId = projectIdOf(param);
  const [days, setDays] = useState<Period>(30);

  const stats = useQuery({ ...statsQuery(days, projectId), placeholderData: keepPreviousData });
  const agents = useQuery(agentTokensQuery);
  const requested = useQuery(requestedCountQuery(projectId));
  const onboarding = useQuery(onboardingQuery);
  const projects = useQuery(projectsQuery);

  const connected = connectedAgentLabels(agents.data);
  const title = projectId ? (projects.data?.find((p) => p.id === projectId)?.name ?? 'Projet') : 'Tous les retours';
  const noTickets = onboarding.data?.tickets === 0;

  const controls = (
    <div className="flex flex-wrap items-center gap-3">
      <span className="rounded-md border border-border bg-sunken px-2 py-1 text-xs text-muted-foreground">
        {projectId ? 'Projet sélectionné' : 'Tous les projets'}
      </span>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={String(days)}
        onValueChange={(value) => value && setDays(Number(value) as Period)}
        aria-label="Période"
      >
        {PERIODS.map((p) => (
          <ToggleGroupItem key={p} value={String(p)} aria-label={`${p} jours`}>
            {p} j
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-5 px-4 py-5 sm:px-6">
      <PageHeader title={title} actions={controls} tabs={<ProjectTabs param={param} />} />

      {onboarding.data && onboarding.data.connectedAgents === 0 && <OnboardingPanel onboarding={onboarding.data} projectId={projectId} />}
      {(agents.data || agents.isError) && <AiCard agents={connected} requested={requested.data ?? 0} projectId={projectId} />}

      {noTickets ? null : stats.isError && !stats.data ? (
        <EmptyState
          icon={<TriangleAlert />}
          title="Statistiques indisponibles"
          description="Le serveur n’a pas répondu. Réessayez dans un instant."
          action={<Button variant="outline" onClick={() => void stats.refetch()}>Réessayer</Button>}
        />
      ) : !stats.data ? (
        <OverviewSkeleton />
      ) : (
        <div className={cn('flex flex-col gap-4 transition-opacity duration-150', stats.isPlaceholderData && 'opacity-60')} aria-busy={stats.isPlaceholderData}>
          <Kpis stats={stats.data} />
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title={`Activité · ${stats.data.days} derniers jours`} subtitle="Retours reçus et traités, par jour">
              <ActivityChart stats={stats.data} />
            </Panel>
            <ProjectsPanel stats={stats.data} />
            <PagesPanel stats={stats.data} />
            <BreakdownPanel stats={stats.data} />
            <FeedPanel stats={stats.data} projectId={projectId} />
          </div>
        </div>
      )}
      {noTickets && (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <BarChart3 className="size-4" aria-hidden /> Les statistiques apparaîtront dès le premier retour.
        </p>
      )}
    </div>
  );
}
