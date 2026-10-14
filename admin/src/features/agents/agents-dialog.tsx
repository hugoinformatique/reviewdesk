/**
 * « Connecter un agent IA » — three steps: pick the tool, choose what the agent
 * may see and do, then copy the token and the configuration for that tool.
 * Layout adapted from 21st.dev « Wizard Steps » (#23576, progress rail) and
 * « API Key Manager » (#27018, one-time secret reveal); markup rewritten on the
 * project's primitives.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { ArrowLeftIcon, CheckIcon, LoaderCircleIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { formatAge } from '@/lib/format';
import { agentTokensQuery, keys, projectsQuery, useCreateAgentToken, useRevokeAgentToken } from '@/lib/queries';
import type { AgentToken } from '@/lib/types';
import { closeOverlay } from '@/lib/ui-store';
import { cn } from '@/lib/utils';
import { AGENT_TARGETS, STARTER_PROMPT, readServerPath, writeServerPath, type AgentTarget } from './agent-targets';
import { CodeBlock, CopyButton } from './copy';

const ALL = 'all';
const GIVE_UP_AFTER_MS = 120_000;
const STEPS = ['Outil', 'Portée', 'Connexion'] as const;

type Created = { id: string; token: string };

export function AgentsDialog({ projectId }: { projectId?: string }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [target, setTarget] = useState<AgentTarget>(AGENT_TARGETS[0]!);
  const [label, setLabel] = useState('');
  const [project, setProject] = useState(projectId || ALL);
  const [scope, setScope] = useState<AgentToken['scope']>('write');
  const [created, setCreated] = useState<Created | null>(null);
  const create = useCreateAgentToken();
  const projects = useQuery(projectsQuery);

  const submit = () => {
    create.mutate(
      { label: label.trim() || target.name, scope, ...(project !== ALL ? { projectId: project } : {}) },
      {
        onSuccess: (result) => {
          setCreated(result);
          setStep(3);
        },
        onError: () => toast.error('Création du jeton impossible.'),
      },
    );
  };

  const next = () => {
    if (step === 1) setStep(2);
    else if (step === 2) submit();
    else closeOverlay();
  };

  const nextLabel = step === 3 ? 'Terminé' : step === 2 ? 'Générer le jeton' : 'Continuer';

  return (
    <Dialog open onOpenChange={(open) => !open && closeOverlay()}>
      <DialogContent
        className="gap-5 sm:max-w-2xl"
        showCloseButton={step !== 3}
        // The token is shown once: a stray click outside must not throw it away.
        onInteractOutside={(event) => step === 3 && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{step === 3 ? `Connecter ${target.name}` : 'Connecter un agent IA'}</DialogTitle>
          <DialogDescription>
            {step === 1 && 'Choisissez l’outil à brancher sur ReviewDesk.'}
            {step === 2 && 'Un jeton dédié, limité à ce que vous autorisez, révocable à tout moment.'}
            {step === 3 && 'Copiez le jeton et la configuration, puis relancez votre outil.'}
          </DialogDescription>
        </DialogHeader>

        <ol className="flex items-center gap-2 text-xs" aria-label="Étapes">
          {STEPS.map((name, index) => {
            const number = index + 1;
            const done = number < step;
            const current = number === step;
            return (
              <li key={name} className="flex flex-1 items-center gap-2" aria-current={current ? 'step' : undefined}>
                <span
                  className={cn(
                    'grid size-5 shrink-0 place-items-center rounded-full border text-[11px] font-medium transition-colors',
                    current && 'border-primary bg-primary text-primary-foreground',
                    done && 'border-primary text-primary',
                    !current && !done && 'border-border-strong text-muted-foreground',
                  )}
                >
                  {done ? <CheckIcon className="size-3" aria-hidden="true" /> : number}
                </span>
                <span className={cn('hidden sm:inline', current ? 'font-medium text-foreground' : 'text-muted-foreground')}>{name}</span>
                {number < STEPS.length && <span className={cn('h-px flex-1', done ? 'bg-primary' : 'bg-border')} aria-hidden="true" />}
              </li>
            );
          })}
        </ol>

        {step === 1 && <PickerStep target={target} onTarget={setTarget} />}
        {step === 2 && (
          <ScopeStep
            target={target}
            label={label}
            onLabel={setLabel}
            project={project}
            onProject={setProject}
            scope={scope}
            onScope={setScope}
            projects={projects.data ?? []}
            onSubmit={submit}
          />
        )}
        {step === 3 && created && <ResultStep target={target} created={created} />}

        <DialogFooter className="items-center sm:justify-between">
          <div>
            {step === 2 && (
              <Button type="button" variant="ghost" onClick={() => setStep(1)}>
                <ArrowLeftIcon aria-hidden="true" />
                Retour
              </Button>
            )}
          </div>
          <Button type="button" onClick={next} disabled={create.isPending}>
            {create.isPending && <LoaderCircleIcon className="animate-spin" aria-hidden="true" />}
            {nextLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ step 1

function PickerStep({ target, onTarget }: { target: AgentTarget; onTarget: (target: AgentTarget) => void }) {
  return (
    <div className="grid gap-5">
      <RadioGroupPrimitive.Root
        value={target.id}
        onValueChange={(id) => onTarget(AGENT_TARGETS.find((candidate) => candidate.id === id) ?? target)}
        aria-label="Outil à connecter"
        className="grid grid-cols-2 gap-2 sm:grid-cols-3"
      >
        {AGENT_TARGETS.map((candidate) => (
          <RadioGroupPrimitive.Item
            key={candidate.id}
            value={candidate.id}
            className={cn(
              'group flex cursor-pointer flex-col items-start gap-2 rounded-lg border bg-card p-3 text-left shadow-1 transition-[border-color,box-shadow,background-color] duration-150 outline-none',
              'hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring',
              'data-[state=checked]:border-primary data-[state=checked]:ring-1 data-[state=checked]:ring-primary',
              'data-[state=unchecked]:border-border',
            )}
          >
            <span className="grid size-8 place-items-center rounded-md border border-border bg-background">
              <candidate.Logo className="size-4.5" />
            </span>
            <span className="grid gap-0.5">
              <strong className="text-[13.5px] font-medium">{candidate.id === 'api' ? 'Autre outil (API HTTP)' : candidate.name}</strong>
              <span className="text-xs break-all text-muted-foreground">{candidate.hint}</span>
            </span>
          </RadioGroupPrimitive.Item>
        ))}
      </RadioGroupPrimitive.Root>
      <ExistingTokens />
    </div>
  );
}

function ExistingTokens() {
  const tokens = useQuery(agentTokensQuery);
  const revoke = useRevokeAgentToken();
  if (tokens.isPending) return <Skeleton className="h-12 w-full" />;
  const live = (tokens.data ?? []).filter((token) => !token.revokedAt);
  if (!live.length) return null;
  return (
    <section aria-labelledby="agents-existing" className="grid gap-2">
      <h3 id="agents-existing" className="text-[13px] font-medium">
        Agents déjà connectés
      </h3>
      <ul className="grid max-h-44 gap-1.5 overflow-y-auto">
        {live.map((token) => (
          <li key={token.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
            <span className="grid min-w-0 gap-0.5">
              <strong className="truncate text-[13px] font-medium">{token.label || 'Sans libellé'}</strong>
              <span className="text-xs text-muted-foreground">
                {token.scope === 'read' ? 'lecture seule' : 'lecture/écriture'} · {token.projectName ?? 'tous les projets'} ·{' '}
                {token.lastUsedAt ? `actif ${formatAge(token.lastUsedAt)}` : 'jamais utilisé'}
              </span>
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-destructive"
              disabled={revoke.isPending && revoke.variables === token.id}
              onClick={() => revoke.mutate(token.id, { onError: () => toast.error('Révocation impossible.') })}
            >
              Révoquer
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------ step 2

function ScopeStep(props: {
  target: AgentTarget;
  label: string;
  onLabel: (value: string) => void;
  project: string;
  onProject: (value: string) => void;
  scope: AgentToken['scope'];
  onScope: (value: AgentToken['scope']) => void;
  projects: { id: string; name: string }[];
  onSubmit: () => void;
}) {
  const { target, project, scope, projects } = props;
  const selected = projects.find((candidate) => candidate.id === project);
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="agent-label">Libellé du jeton</Label>
        <Input
          id="agent-label"
          name="label"
          maxLength={80}
          value={props.label}
          placeholder={target.name}
          autoComplete="off"
          onChange={(event) => props.onLabel(event.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="agent-project">Ce que l’agent voit</Label>
        <Select value={project} onValueChange={props.onProject}>
          <SelectTrigger id="agent-project" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tous les projets</SelectItem>
            {projects.map((candidate) => (
              <SelectItem key={candidate.id} value={candidate.id}>
                {candidate.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 text-[13px] leading-none font-medium">Ce que l’agent peut faire</legend>
        <RadioGroupPrimitive.Root value={scope} onValueChange={(value) => props.onScope(value as AgentToken['scope'])} className="grid gap-2 sm:grid-cols-2" aria-label="Ce que l’agent peut faire">
          {(
            [
              ['write', 'Lire, commenter et changer les statuts'],
              ['read', 'Lire seulement'],
            ] as const
          ).map(([value, text]) => (
            <RadioGroupPrimitive.Item
              key={value}
              value={value}
              className="flex cursor-pointer items-center gap-2.5 rounded-md border border-border bg-card px-3 py-2.5 text-left text-[13px] outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring data-[state=checked]:border-primary data-[state=checked]:ring-1 data-[state=checked]:ring-primary"
            >
              <span className="grid size-4 shrink-0 place-items-center rounded-full border border-border-strong group-data-[state=checked]:border-primary">
                <RadioGroupPrimitive.Indicator className="size-2 rounded-full bg-primary" />
              </span>
              {text}
            </RadioGroupPrimitive.Item>
          ))}
        </RadioGroupPrimitive.Root>
      </fieldset>
      <p className="rounded-md bg-sunken px-3 py-2.5 text-[13px] text-subtle-foreground" aria-live="polite">
        {target.name} verra {selected ? `les retours de « ${selected.name} »` : 'les retours de tous les projets'}
        {scope === 'read' ? ', sans pouvoir rien y changer.' : ', et pourra les commenter et changer leur statut.'} Ce jeton
        n’ouvre ni l’administration, ni les projets, ni les liens reviewer, et se révoque en un clic.
      </p>
      <button type="submit" hidden />
    </form>
  );
}

// ------------------------------------------------------------------ step 3

function ResultStep({ target, created }: { target: AgentTarget; created: Created }) {
  const origin = location.origin;
  const [serverPath, setServerPath] = useState(readServerPath);
  const snippet = useMemo(
    () => target.install({ token: created.token, origin, server: serverPath }),
    [target, created.token, origin, serverPath],
  );
  return (
    <div className="grid gap-4">
      <section className="grid gap-1.5 rounded-lg border border-border bg-sunken p-3" aria-label="Jeton">
        <span className="text-xs font-medium text-muted-foreground">Jeton — affiché une seule fois</span>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs break-all select-all" data-testid="agent-token">
            {created.token}
          </code>
          <CopyButton label="Copier le jeton" value={created.token} />
        </div>
      </section>

      {target.id !== 'api' && (
        <div className="grid gap-1.5">
          <Label htmlFor="agent-server-path">Chemin du serveur MCP sur votre machine</Label>
          <Input
            id="agent-server-path"
            value={serverPath}
            spellCheck={false}
            className="font-mono text-xs"
            onChange={(event) => {
              setServerPath(event.target.value);
              writeServerPath(event.target.value);
            }}
          />
          <small className="text-xs text-muted-foreground">Le dépôt ReviewDesk après « npm run build ». Mémorisé pour la prochaine fois.</small>
        </div>
      )}

      <div className="grid gap-2">
        <p className="text-[13px] text-subtle-foreground">{target.where}</p>
        <CodeBlock text={snippet} copyLabel="Copier la configuration" />
      </div>

      <ConnectionStatus tokenId={created.id} />

      <div className="grid gap-2">
        <h3 className="text-[13px] font-medium">Puis, dans votre agent</h3>
        <CodeBlock text={STARTER_PROMPT} copyLabel="Copier le prompt" wrap />
      </div>
    </div>
  );
}

/**
 * The moment that makes the whole thing believable: the dialog waits for the
 * agent's very first call and says so when it lands. Polls every 2,5 s and
 * stops when it connects, when the dialog closes (unmount), or after two minutes.
 */
function ConnectionStatus({ tokenId }: { tokenId: string }) {
  const client = useQueryClient();
  const [gaveUp, setGaveUp] = useState(false);
  const connectedRef = useRef(false);
  const tokens = useQuery({
    ...agentTokensQuery,
    refetchInterval: (query) => {
      const mine = query.state.data?.find((token) => token.id === tokenId);
      return gaveUp || mine?.lastUsedAt ? false : 2_500;
    },
  });
  const mine = tokens.data?.find((token) => token.id === tokenId);
  const connected = Boolean(mine?.lastUsedAt);

  useEffect(() => {
    const timer = setTimeout(() => setGaveUp(true), GIVE_UP_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (connected && !connectedRef.current) {
      connectedRef.current = true;
      void client.invalidateQueries({ queryKey: keys.onboarding });
    }
  }, [connected, client]);

  if (connected && mine?.lastUsedAt) {
    return (
      <div role="status" className="flex items-center gap-3 rounded-lg border border-[color:var(--st-done)] bg-[color:var(--st-done-soft)] px-3 py-2.5 text-[13px]">
        <CheckIcon className="size-4 shrink-0 text-[color:var(--st-done)]" aria-hidden="true" />
        <strong className="font-medium">Agent connecté</strong>
        <span className="text-subtle-foreground">première requête {formatAge(mine.lastUsedAt)}</span>
      </div>
    );
  }
  if (gaveUp) {
    return (
      <div role="status" className="grid gap-0.5 rounded-lg border border-border px-3 py-2.5 text-[13px]">
        <strong className="font-medium">Toujours pas de requête</strong>
        <span className="text-subtle-foreground">La configuration reste valable : relancez votre agent, il apparaîtra ici.</span>
      </div>
    );
  }
  return (
    <div role="status" className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-[13px]">
      <span className="relative flex size-2 shrink-0" aria-hidden="true">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-muted-foreground/50 motion-reduce:animate-none" />
        <span className="relative inline-flex size-2 rounded-full bg-muted-foreground" />
      </span>
      <strong className="font-medium">En attente de votre agent…</strong>
      <span className="text-subtle-foreground">Cette fenêtre le détecte dès sa première requête.</span>
    </div>
  );
}
