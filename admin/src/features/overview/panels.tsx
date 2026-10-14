import type { ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Bot, UserRound } from 'lucide-react';
import { formatAge, hostOf, pagePath, plural, projectHue } from '@/lib/format';
import { STATUS_LABELS, STATUSES, type Stats, type Status } from '@/lib/types';
import { cn } from '@/lib/utils';

export const STATUS_BG: Record<Status, string> = {
  TODO: 'bg-st-todo',
  IN_PROGRESS: 'bg-st-progress',
  REVIEW: 'bg-st-review',
  DONE: 'bg-st-done',
};
export const HUE_BG = ['bg-[var(--hue-0)]', 'bg-[var(--hue-1)]', 'bg-[var(--hue-2)]', 'bg-[var(--hue-3)]', 'bg-[var(--hue-4)]', 'bg-[var(--hue-5)]'];

export function Panel({ title, subtitle, className, children }: { title: string; subtitle?: string; className?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className={cn('min-w-0 rounded-lg border border-border bg-card p-5 shadow-1', className)}>
      <div className="mb-4">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[13px] text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

/** One stacked bar across the statuses. Segments are widths in %, the rest is the track. */
export function StackedBar({ counts, total, className }: { counts: Record<Status, number>; total: number; className?: string }) {
  return (
    <div
      role="img"
      aria-label={STATUSES.map((s) => `${STATUS_LABELS[s]} ${counts[s]}`).join(', ')}
      className={cn('flex h-2 w-full gap-px overflow-hidden rounded-full bg-muted', className)}
    >
      {total > 0 &&
        STATUSES.map((status) =>
          counts[status] > 0 ? <span key={status} className={STATUS_BG[status]} style={{ width: `${(counts[status] / total) * 100}%` }} /> : null
        )}
    </div>
  );
}

export function ProjectsPanel({ stats }: { stats: Stats }) {
  const navigate = useNavigate();
  return (
    <Panel title="Par projet" className="overflow-hidden">
      <div className="-mx-5 overflow-x-auto px-5">
        <table className="w-full min-w-[460px] text-[13px]">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-2 font-medium">Projet</th>
              <th className="pb-2 pr-4 font-medium">Avancement</th>
              {STATUSES.map((s) => (
                <th key={s} className="w-12 pb-2 text-right font-medium" title={STATUS_LABELS[s]}>
                  <span className={cn('mr-1 inline-block size-1.5 rounded-full align-middle', STATUS_BG[s])} aria-hidden />
                  <span className="sr-only">{STATUS_LABELS[s]}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stats.projects.map((project) => {
              const go = () => void navigate({ to: '/p/$projectId', params: { projectId: project.id } });
              return (
                <tr
                  key={project.id}
                  tabIndex={0}
                  onClick={go}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') go();
                  }}
                  className="cursor-pointer border-t border-border outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring"
                >
                  <td className="py-2.5 pr-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={cn('size-2 shrink-0 rounded-full', HUE_BG[projectHue(project.id)])} aria-hidden />
                      <span className="truncate font-medium">{project.name}</span>
                    </span>
                    {project.clientLabel && <span className="ml-4 block truncate text-xs text-muted-foreground">{project.clientLabel}</span>}
                  </td>
                  <td className="w-[28%] py-2.5 pr-4">
                    <StackedBar
                      counts={{ TODO: project.todo, IN_PROGRESS: project.inProgress, REVIEW: project.review, DONE: project.done }}
                      total={project.total}
                    />
                  </td>
                  {[project.todo, project.inProgress, project.review, project.done].map((n, i) => (
                    <td key={i} className={cn('py-2.5 text-right tabular-nums', n === 0 && 'text-muted-foreground/60')}>
                      {n}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export function PagesPanel({ stats }: { stats: Stats }) {
  const max = Math.max(1, ...stats.pages.map((p) => p.count));
  return (
    <Panel title="Pages les plus signalées">
      {stats.pages.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Aucune page signalée sur la période.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {stats.pages.map((page) => (
            <li key={page.pageUrl} title={page.pageUrl}>
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="truncate font-medium">{pagePath(page.pageUrl)}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {page.count} · {plural(page.open, 'ouvert')}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-chart-1" style={{ width: `${(page.count / max) * 100}%` }} />
              </div>
              <span className="sr-only">{hostOf(page.pageUrl)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function BreakdownPanel({ stats }: { stats: Stats }) {
  const total = STATUSES.reduce((sum, s) => sum + stats.byStatus[s], 0);
  const open = total - stats.byStatus.DONE;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  return (
    <Panel title="Répartition">
      <StackedBar counts={stats.byStatus} total={total} className="h-3" />
      <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2">
        {STATUSES.map((s) => (
          <li key={s} className="flex items-center justify-between gap-2 text-[13px]">
            <span className="flex items-center gap-2">
              <span className={cn('size-2 rounded-sm', STATUS_BG[s])} aria-hidden />
              {STATUS_LABELS[s]}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {stats.byStatus[s]} · {pct(stats.byStatus[s])} %
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[13px] text-muted-foreground">
        {plural(open, 'retour encore ouvert', 'retours encore ouverts')}, soit {pct(open)} % de tout ce qui a été reçu.
      </p>
    </Panel>
  );
}

export function FeedPanel({ stats, projectId }: { stats: Stats; projectId: string }) {
  return (
    <Panel title="Derniers mouvements">
      {stats.activity.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Rien de nouveau</p>
      ) : (
        <ol className="flex flex-col">
          {stats.activity.map((item) => {
            const name = item.authorLabel || (item.author === 'agent' ? 'Agent' : 'Équipe');
            const move =
              item.statusTo && item.statusFrom
                ? `${STATUS_LABELS[item.statusFrom]} → ${STATUS_LABELS[item.statusTo]}`
                : item.statusTo
                  ? `→ ${STATUS_LABELS[item.statusTo]}`
                  : 'a commenté';
            return (
              <li key={item.id}>
                <Link
                  to="/p/$projectId/t/$ticketId"
                  params={{ projectId: projectId || 'all', ticketId: item.ticketId }}
                  className="-mx-2 flex items-start gap-3 rounded-md px-2 py-2 outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring"
                >
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-sunken text-muted-foreground">
                    {item.author === 'agent' ? <Bot className="size-3.5" aria-hidden /> : <UserRound className="size-3.5" aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{item.ticketText}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {name} · {move}
                    </span>
                  </span>
                  <time dateTime={item.createdAt} className="shrink-0 text-xs text-muted-foreground">
                    {formatAge(item.createdAt)}
                  </time>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
