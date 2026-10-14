import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bot, Check, Copy, Inbox, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { agentTokensQuery, connectedAgentLabels, useRequestFix } from '@/lib/queries';
import { closeOverlay, openOverlay } from '@/lib/ui-store';
import type { Ticket } from '@/lib/types';
import { findTicketInCache } from '@/features/board/cache';
import { useCopy } from '@/lib/clipboard';
import { AGENT_TARGETS, type AgentTarget } from '@/features/agents/agent-targets';

type Target = AgentTarget;

/** Typographic apostrophes, so the brief survives shell double quotes. */
const prompt = (ticket: Ticket) =>
  `Corrige le retour ReviewDesk ${ticket.id} : lis-le avec get_ticket ` +
  `(et get_screenshot s’il a une capture), corrige le code du site, ` +
  `puis passe-le à REVIEW avec update_ticket en expliquant ce que tu as changé.`;

function command(target: Target, ticket: Ticket) {
  if (target.kind === 'api') return `curl -H "Authorization: Bearer $REVIEWDESK_TOKEN" \\\n  ${location.origin}/api/agent/tickets/${ticket.id}`;
  if (target.id === 'codex') return `codex "${prompt(ticket)}"`;
  if (target.kind === 'cli') return `claude "${prompt(ticket)}"`;
  return prompt(ticket);
}

export function FixDialog({ ticketId }: { ticketId: string }) {
  const client = useQueryClient();
  const ticket = findTicketInCache(client, ticketId);
  const tokens = useQuery(agentTokensQuery);
  const connected = connectedAgentLabels(tokens.data);
  const isConnected = (target: Target) => connected.some((label) => label.toLowerCase().includes(target.shortName.toLowerCase()));
  const [chosen, setChosen] = useState<string>('');
  const target = AGENT_TARGETS.find((candidate) => candidate.id === chosen) ?? AGENT_TARGETS.find(isConnected) ?? AGENT_TARGETS[0]!;
  const request = useRequestFix();
  const { copied, copy } = useCopy();

  useEffect(() => {
    if (ticket) return;
    toast.error('Retour introuvable.');
    closeOverlay();
  }, [ticket]);
  if (!ticket) return null;

  const text = command(target, ticket);

  const copyOnly = async () => {
    if (!(await copy(text))) {
      toast.error('Copie refusée par le navigateur. Sélectionnez le texte.');
    }
  };

  const launch = async () => {
    const didCopy = await copy(text);
    try {
      await request.mutateAsync({ ticketId: ticket.id, agent: target.shortName });
    } catch {
      toast.error('Demande de correction impossible.');
      return;
    }
    if (didCopy) {
      closeOverlay();
      toast.success(`Correction demandée à ${target.shortName}. ${target.kind === 'chat' ? 'Prompt copié' : 'Commande copiée'}.`);
    } else {
      toast.success(`Correction demandée à ${target.shortName}. Copiez la ${target.kind === 'chat' ? 'consigne' : 'commande'} affichée.`);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && closeOverlay()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles aria-hidden="true" className="size-4" />
            Lancer la correction
          </DialogTitle>
          <DialogDescription className="line-clamp-2 break-words">{ticket.text}</DialogDescription>
        </DialogHeader>

        <div role="radiogroup" aria-label="Agent" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {AGENT_TARGETS.map((candidate) => {
            const active = candidate.id === target.id;
            return (
              <button
                key={candidate.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setChosen(candidate.id)}
                className={cn(
                  'relative flex h-10 items-center justify-center rounded-lg border border-border bg-card px-2 text-[13px] font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring',
                  active && 'border-foreground bg-accent',
                )}
              >
                {candidate.shortName}
                {isConnected(candidate) && <span title="Agent connecté" className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-st-done" />}
              </button>
            );
          })}
        </div>

        <p className="-mt-1 text-[13px] text-muted-foreground">{target.fixWhere}</p>

        <div className="rounded-lg border border-border bg-sunken">
          <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
            <span className="text-xs text-muted-foreground">{target.kind === 'chat' ? 'Prompt' : 'Commande'}</span>
            <Button variant="ghost" size="sm" onClick={() => void copyOnly()}>
              {copied ? <Check /> : <Copy />}
              {copied ? 'Copié' : target.kind === 'chat' ? 'Copier le prompt' : 'Copier la commande'}
            </Button>
          </div>
          <pre className="m-0 max-h-44 overflow-auto p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">{text}</pre>
        </div>

        {connected.length ? (
          <p className="flex items-start gap-2 rounded-lg bg-st-done-soft px-3 py-2 text-[13px] text-st-done">
            <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            Agent connecté : {connected.join(', ')}. Il trouvera aussi ce retour dans sa file avec next_fix_request.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-[13px]">
            <Bot aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">Aucun agent connecté pour l'instant. Connectez-en un, puis lancez la commande.</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                closeOverlay();
                openOverlay({ kind: 'agents', projectId: ticket.projectId });
              }}
            >
              Connecter un agent
            </Button>
          </div>
        )}

        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Inbox aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          Pour enchaîner toute la file : « Traite les corrections demandées ReviewDesk une par une avec next_fix_request ».
        </p>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={closeOverlay}>
            Annuler
          </Button>
          <Button disabled={request.isPending} onClick={() => void launch()}>
            <Sparkles />
            Copier et lancer avec {target.shortName}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
