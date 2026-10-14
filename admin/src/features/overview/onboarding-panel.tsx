import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { openOverlay } from '@/lib/ui-store';
import type { Onboarding } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Four steps derived from data, never stored: it comes back by itself if everything is revoked. */
export function OnboardingPanel({ onboarding, projectId }: { onboarding: Onboarding; projectId: string }) {
  const steps = [
    { label: 'Créer un projet', done: onboarding.projects > 0, action: 'Créer un projet', run: () => openOverlay({ kind: 'guide' }) },
    {
      label: 'Installer le widget',
      done: onboarding.reviewLinks > 0,
      action: 'Installer le widget',
      // Without a project in scope the install dialog has nothing to target: the guide creates one.
      run: () => (projectId ? openOverlay({ kind: 'install', projectId }) : openOverlay({ kind: 'guide' })),
    },
    { label: 'Recevoir un premier retour', done: onboarding.tickets > 0 },
    { label: 'Connecter un agent IA', done: onboarding.connectedAgents > 0, action: 'Connecter un agent', run: () => openOverlay({ kind: 'agents', projectId: projectId || undefined }) },
  ];
  const doneCount = steps.filter((step) => step.done).length;
  const next = steps.findIndex((step) => !step.done);
  return (
    <section aria-label="Mise en route" className="rounded-lg border border-border bg-card p-5 shadow-1">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold tracking-tight">Mise en route</h2>
        <span className="text-[13px] tabular-nums text-muted-foreground" aria-live="polite">
          {doneCount} sur 4
        </span>
      </div>
      <div className="mt-3 flex gap-1" role="progressbar" aria-valuemin={0} aria-valuemax={4} aria-valuenow={doneCount} aria-label="Progression">
        {steps.map((step, index) => (
          <span key={index} className={cn('h-1 flex-1 rounded-full transition-colors duration-200', step.done ? 'bg-primary' : 'bg-muted')} />
        ))}
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, index) => (
          <li
            key={step.label}
            className={cn('flex min-h-[84px] flex-col justify-between gap-3 rounded-md border border-border p-3', step.done ? 'bg-sunken' : 'bg-card')}
          >
            <div className="flex items-start gap-2.5">
              <span
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium',
                  step.done ? 'border-transparent bg-primary text-primary-foreground' : 'border-border-strong text-muted-foreground'
                )}
              >
                {step.done ? <Check className="size-3" aria-label="Fait" /> : index + 1}
              </span>
              <span className={cn('text-[13.5px] font-medium leading-5', step.done && 'text-muted-foreground line-through decoration-border-strong')}>
                {step.label}
              </span>
            </div>
            {index === next && step.action && step.run && (
              <Button size="sm" className="self-start" onClick={step.run}>
                {step.action}
              </Button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
