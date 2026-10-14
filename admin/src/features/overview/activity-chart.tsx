import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDay, periodDays, plural } from '@/lib/format';
import type { Stats } from '@/lib/types';

/** Paired bars per day: received (grey) / resolved (ink). Recharts, colours from the chart tokens. */
export function ActivityChart({ stats }: { stats: Stats }) {
  const days = periodDays(stats);
  const data = days.map((day) => ({
    day,
    received: stats.daily.received[day] ?? 0,
    resolved: stats.daily.resolved[day] ?? 0,
  }));
  const peak = Math.max(4, ...data.map((d) => Math.max(d.received, d.resolved)));
  const top = Math.ceil(peak / 4) * 4;
  const receivedTotal = data.reduce((sum, d) => sum + d.received, 0);
  const resolvedTotal = data.reduce((sum, d) => sum + d.resolved, 0);
  const label = `${plural(receivedTotal, 'retour reçu', 'retours reçus')} et ${resolvedTotal} traité${resolvedTotal > 1 ? 's' : ''} sur ${stats.days} jours`;
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-chart-2" /> reçus · {receivedTotal}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-chart-1" /> traités · {resolvedTotal}
        </span>
      </div>
      <div role="img" aria-label={label} className="h-[220px] w-full">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <BarChart data={data} barGap={1} barCategoryGap="22%" margin={{ top: 4, right: 0, bottom: 0, left: -24 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={32}
              tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
              tickFormatter={(day: string) => (day === days[days.length - 1] ? 'aujourd’hui' : formatDay(`${day}T12:00:00Z`))}
            />
            <YAxis allowDecimals={false} domain={[0, top]} tickCount={5} tickLine={false} axisLine={false} width={40} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
            <Tooltip
              cursor={{ fill: 'var(--accent)' }}
              isAnimationActive={false}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as (typeof data)[number] | undefined;
                if (!active || !row) return null;
                return (
                  <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-2">
                    <div className="mb-0.5 font-medium">{formatDay(`${row.day}T12:00:00Z`)}</div>
                    <div className="text-muted-foreground">{plural(row.received, 'reçu')}</div>
                    <div className="text-muted-foreground">{plural(row.resolved, 'traité')}</div>
                  </div>
                );
              }}
            />
            <Bar dataKey="received" fill="var(--chart-2)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="resolved" fill="var(--chart-1)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
