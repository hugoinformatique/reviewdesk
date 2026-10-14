import { Link } from '@tanstack/react-router';
import { Bot, Cable } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { plural } from '@/lib/format';
import { openOverlay } from '@/lib/ui-store';

const TOOLS = ['Claude Code', 'Codex', 'Cursor', 'VS Code', 'API'];

/** « Agents IA » card, two variants: nobody connected yet / agents at work. */
export function AiCard({ agents, requested, projectId }: { agents: string[]; requested: number; projectId: string }) {
  const connected = agents.length > 0;
  return (
    <section
      aria-label="Agents IA"
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5 shadow-1 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-sunken text-foreground shadow-edge">
          <Bot className="size-5" aria-hidden />
        </div>
        <div className="min-w-0">
          {connected ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[15px] font-semibold tracking-tight">Votre agent corrige les retours</h2>
                <Badge status="DONE">{plural(agents.length, 'agent connecté', 'agents connectés')}</Badge>
              </div>
              <p className="mt-1 text-[13.5px] text-muted-foreground">
                Connecté : <span className="text-foreground">{agents.join(', ')}</span>
                {' · '}
                {plural(requested, 'correction en attente', 'corrections en attente')}
              </p>
            </>
          ) : (
            <>
              <h2 className="text-[15px] font-semibold tracking-tight">Faites corriger les retours par votre agent IA</h2>
              <p className="mt-1 max-w-xl text-[13.5px] text-muted-foreground">
                Donnez un accès à votre agent : il lit les retours, corrige le code et les marque comme traités.
              </p>
              <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Outils compatibles">
                {TOOLS.map((tool) => (
                  <li key={tool} className="rounded-md border border-border bg-sunken px-2 py-0.5 text-xs text-subtle-foreground">
                    {tool}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {connected ? (
          <>
            <Button variant="outline" asChild>
              <Link to="/p/$projectId" params={{ projectId: projectId || 'all' }}>
                Voir les retours
              </Link>
            </Button>
            <Button onClick={() => openOverlay({ kind: 'agents', projectId: projectId || undefined })}>
              <Cable aria-hidden /> Gérer les agents
            </Button>
          </>
        ) : (
          <Button onClick={() => openOverlay({ kind: 'agents', projectId: projectId || undefined })}>
            <Cable aria-hidden /> Connecter un agent
          </Button>
        )}
      </div>
    </section>
  );
}
