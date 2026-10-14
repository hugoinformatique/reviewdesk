import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { cn } from '@/lib/utils';

export type KpiProps = {
  label: string;
  value: string;
  note: string;
  tone?: 'plain' | 'up' | 'down';
  spark?: number[];
  accent?: string;
};

/** KPI card: label, big tabular value, trend note, optional sparkline (21st.dev 33507 / 34512, adapted). */
export function Kpi({ label, value, note, tone = 'plain', spark, accent = 'var(--chart-1)' }: KpiProps) {
  const showSpark = spark && spark.some((point) => point > 0);
  return (
    <div role="group" aria-label={label} className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-card p-4 shadow-1">
      <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
      <div className="flex items-end justify-between gap-2">
        <span className="text-[28px] font-semibold leading-9 tracking-tight tabular-nums">{value}</span>
        {showSpark && (
          <div className="h-8 w-20 shrink-0" aria-hidden>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <AreaChart data={spark.map((point, index) => ({ index, point }))} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
                <Area type="monotone" dataKey="point" stroke={accent} strokeWidth={1.5} fill={accent} fillOpacity={0.12} isAnimationActive={false} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      <span
        className={cn(
          'flex items-start gap-1 text-xs text-muted-foreground',
          tone === 'up' && 'text-st-done',
          tone === 'down' && 'text-destructive'
        )}
      >
        {tone === 'up' && <ArrowUpRight className="size-3.5 shrink-0" aria-hidden />}
        {tone === 'down' && <ArrowDownRight className="size-3.5 shrink-0" aria-hidden />}
        <span className="line-clamp-2" title={note}>{note}</span>
      </span>
    </div>
  );
}
