import { CheckIcon } from 'lucide-react';
import { formatAge } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Live status line: waiting (pulse), connected (green), or gave up. */
export function WidgetStatus({
  state,
  connectedTitle,
  connectedText,
  waitingText,
}: {
  state: 'waiting' | 'connected' | 'idle';
  connectedTitle: string;
  connectedText: string;
  waitingText: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center gap-3 rounded-lg border px-3.5 py-3 text-[13px] transition-colors duration-200',
        state === 'connected' ? 'border-st-done/30 bg-st-done-soft text-st-done' : 'border-border bg-sunken text-muted-foreground',
      )}
    >
      {state === 'connected' ? (
        <CheckIcon className="size-4 shrink-0" aria-hidden="true" />
      ) : state === 'waiting' ? (
        <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-foreground/30 motion-reduce:hidden" />
          <span className="relative inline-flex size-2.5 rounded-full bg-foreground/50" />
        </span>
      ) : (
        <span className="size-2.5 shrink-0 rounded-full bg-border-strong" aria-hidden="true" />
      )}
      <div className="grid gap-0.5">
        <strong className={cn('font-medium', state !== 'connected' && 'text-foreground')}>
          {state === 'connected' ? connectedTitle : state === 'waiting' ? 'En attente du widget…' : 'Toujours pas de requête'}
        </strong>
        <span>{state === 'connected' ? connectedText : state === 'waiting' ? waitingText : 'Le widget répondra dès qu’un reviewer ouvrira votre site de préproduction.'}</span>
      </div>
    </div>
  );
}

export const firstSeen = (iso: string) => `première interaction ${formatAge(iso)}`;
