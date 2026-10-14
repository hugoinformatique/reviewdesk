/**
 * The guide: how a project comes to life — create, install, connect an agent —
 * in one full-screen flow with a stepper. Stepper adapted from 21st.dev
 * "Basic Stepper" (id 29925) and "Onboarding Stepper Progress" (id 19143),
 * cards from "Radio Group" cards (id 748); recoloured with the Paper & Ink tokens.
 */
import { useId, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { ArrowRightIcon, CheckIcon, ExternalLinkIcon, Loader2Icon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiError } from '@/lib/api';
import { toOrigin } from '@/lib/format';
import { projectsQuery, useCreateReviewLink, useSaveProject } from '@/lib/queries';
import { closeOverlay, openOverlay } from '@/lib/ui-store';
import { cn } from '@/lib/utils';
import { useBranding } from '@/features/branding/branding-provider';
import { useWidgetConnection } from '@/features/install/connection';
import { PlatformInstructions } from '@/features/install/platform-instructions';
import { PlatformLogo } from '@/features/install/platform-logos';
import { demoUrl, WIDGET_PLATFORMS, widgetContext } from '@/features/install/platforms';
import { rememberToken } from '@/features/install/session-tokens';
import { WidgetStatus } from '@/features/install/widget-status';
import { AGENT_TARGETS } from '@/features/agents/agent-targets';

type Created = { id: string; name: string; origins: string[]; token: string; tokenId: string };

const STEPS = ['Projet', 'Installer', 'Agent IA'] as const;

export function Guide() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [created, setCreated] = useState<Created | null>(null);
  const navigate = useNavigate();
  const { productName } = useBranding();

  function goToProject(projectId: string) {
    void navigate({ to: '/p/$projectId', params: { projectId } });
  }
  function close() {
    closeOverlay();
    if (created) goToProject(created.id);
    else void navigate({ to: '/projets' });
  }

  return (
    <MotionConfig reducedMotion="user">
      <DialogPrimitive.Root open onOpenChange={(open) => !open && close()}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background text-foreground outline-none data-[state=open]:animate-in-fade"
          >
            <header className="sticky top-0 z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-border bg-background/90 px-4 py-3 backdrop-blur sm:px-6">
              <span className="truncate text-sm font-semibold tracking-tight">{productName}</span>
              <Stepper step={step} />
              <div className="flex justify-end">
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Fermer le guide" onClick={close}>
                  <XIcon aria-hidden="true" />
                </Button>
              </div>
            </header>

            <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:py-14">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={step}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                >
                  {step === 1 && (
                    <ProjectStep
                      onCreated={(value) => {
                        setCreated(value);
                        setStep(2);
                      }}
                    />
                  )}
                  {step === 2 && created && <InstallStep created={created} onNext={() => setStep(3)} />}
                  {step === 3 && created && (
                    <AgentStep
                      created={created}
                      onPick={() => {
                        goToProject(created.id);
                        openOverlay({ kind: 'agents', projectId: created.id });
                      }}
                      onOpen={() => {
                        closeOverlay();
                        goToProject(created.id);
                      }}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </main>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </MotionConfig>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-1.5 sm:gap-2">
      {STEPS.map((label, index) => {
        const n = index + 1;
        const done = n < step;
        const current = n === step;
        return (
          <li key={label} className="flex items-center gap-1.5 sm:gap-2" aria-current={current ? 'step' : undefined}>
            <span
              className={cn(
                'flex size-6 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums transition-colors duration-200',
                done && 'border-primary bg-primary text-primary-foreground',
                current && 'border-primary text-foreground',
                !done && !current && 'border-border-strong text-muted-foreground',
              )}
            >
              {done ? <CheckIcon className="size-3.5" aria-hidden="true" /> : n}
            </span>
            <span className={cn('hidden text-[13px] sm:inline', current ? 'font-medium' : 'text-muted-foreground')}>
              {label}
              {done && <span className="sr-only"> (terminé)</span>}
            </span>
            {n < STEPS.length && <span className={cn('h-px w-4 sm:w-8', done ? 'bg-primary' : 'bg-border-strong')} aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

function Heading({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return (
    <div className="mb-7 grid gap-2">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{eyebrow}</span>
      <DialogPrimitive.Title className="text-2xl font-semibold tracking-tight text-balance sm:text-[28px]">{title}</DialogPrimitive.Title>
      <p className="text-[14.5px] text-muted-foreground">{text}</p>
    </div>
  );
}

/* ---------------------------------------------------------------- step 1 */

function ProjectStep({ onCreated }: { onCreated: (created: Created) => void }) {
  const uid = useId();
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [site, setSite] = useState('');
  const [withDemo, setWithDemo] = useState(true);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  // If the project exists but its link failed, a retry must not create a twin.
  const [partial, setPartial] = useState<{ id: string; name: string; origins: string[] } | null>(null);
  const projects = useQuery(projectsQuery);
  const save = useSaveProject();
  const createLink = useCreateReviewLink();
  const clients = [...new Set((projects.data ?? []).map((project) => project.clientLabel))].sort();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const origin = toOrigin(site);
    if (!origin) {
      setError('Cette adresse n’est pas une adresse web. Exemple : https://preprod.client.fr');
      document.getElementById(`${uid}-site`)?.focus();
      return;
    }
    const origins = withDemo && origin !== location.origin ? [origin, location.origin] : [origin];
    setPending(true);
    setError('');
    try {
      let project = partial;
      if (!project) {
        const saved = await save.mutateAsync({ input: { name: name.trim(), clientLabel: client.trim(), origins, webhookUrl: '' } });
        project = { id: saved.id, name: saved.name, origins };
        setPartial(project);
      }
      const link = await createLink.mutateAsync({ projectId: project.id, label: 'Installation' });
      rememberToken(project.id, link);
      onCreated({ ...project, token: link.token, tokenId: link.id });
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 400
          ? 'Vérifiez les champs : nom et client de 2 caractères au moins, adresse en http ou https.'
          : 'Création impossible pour le moment. Réessayez.',
      );
      setPending(false);
    }
  }

  return (
    <>
      <Heading eyebrow="Étape 1 sur 3" title="Quel site voulez-vous faire relire ?" text="Trois informations, et le projet est prêt." />
      <form onSubmit={(event) => void submit(event)} className="grid gap-5" noValidate>
        <div className="grid gap-1.5">
          <Label htmlFor={`${uid}-name`}>Nom du site</Label>
          <Input
            id={`${uid}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Site vitrine, boutique, application…"
            autoComplete="off"
            required
            autoFocus
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${uid}-client`}>Client</Label>
          <Input
            id={`${uid}-client`}
            value={client}
            onChange={(event) => setClient(event.target.value)}
            placeholder="Nom de votre client"
            autoComplete="off"
            list={`${uid}-clients`}
            required
          />
          <datalist id={`${uid}-clients`}>
            {clients.map((label) => (
              <option key={label} value={label} />
            ))}
          </datalist>
          <p className="text-xs text-muted-foreground">Les projets d’un même client sont regroupés.</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${uid}-site`}>Adresse du site à faire relire</Label>
          <Input
            id={`${uid}-site`}
            value={site}
            onChange={(event) => {
              setSite(event.target.value);
              setError('');
            }}
            inputMode="url"
            placeholder="https://preprod.client.fr"
            autoComplete="off"
            required
            aria-invalid={error.startsWith('Cette adresse') || undefined}
          />
          <p className="text-xs text-muted-foreground">Préproduction ou recette. Seule cette adresse pourra envoyer des retours.</p>
        </div>
        <div className="flex items-start gap-2.5">
          <Checkbox id={`${uid}-demo`} checked={withDemo} onCheckedChange={(value) => setWithDemo(value === true)} className="mt-0.5" />
          <div className="grid gap-0.5">
            <Label htmlFor={`${uid}-demo`}>Autoriser aussi la page de démonstration</Label>
            <p className="text-xs text-muted-foreground">Pour tester tout de suite, sans toucher au site.</p>
          </div>
        </div>
        <p role="alert" className="min-h-0 text-[13px] text-destructive empty:hidden">
          {error}
        </p>
        <div className="flex justify-end">
          <Button type="submit" size="lg" disabled={pending}>
            {pending && <Loader2Icon className="animate-spin" aria-hidden="true" />}
            Créer le projet
          </Button>
        </div>
      </form>
    </>
  );
}

/* ---------------------------------------------------------------- step 2 */

function InstallStep({ created, onNext }: { created: Created; onNext: () => void }) {
  const [platformId, setPlatformId] = useState<string>(WIDGET_PLATFORMS[0]?.id ?? 'wordpress');
  const platform = WIDGET_PLATFORMS.find((candidate) => candidate.id === platformId) ?? WIDGET_PLATFORMS[0];
  const { connected } = useWidgetConnection(created.id, created.tokenId);
  if (!platform) return null;
  const ctx = widgetContext({ projectId: created.id, token: created.token, previewOrigin: created.origins[0] });

  return (
    <>
      <Heading
        eyebrow="Étape 2 sur 3"
        title={`Installez le widget sur ${created.name}`}
        text="Choisissez l’outil du site : une ligne à coller, ou un simple lien à envoyer au client."
      />
      <Tabs value={platform.id} onValueChange={setPlatformId} className="gap-4">
        <div className="-mx-4 overflow-x-auto px-4 pb-1">
          <TabsList className="h-auto w-max gap-1 sm:w-full sm:flex-wrap">
            {WIDGET_PLATFORMS.map((candidate) => (
              <TabsTrigger key={candidate.id} value={candidate.id} className="h-8 flex-none gap-2 px-2.5">
                <PlatformLogo mark={candidate.mark} className="size-4" />
                {candidate.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>
      <p className="mt-4 mb-5 text-[13.5px] text-muted-foreground">{platform.where}</p>
      <PlatformInstructions platform={platform} ctx={ctx} />
      <div className="mt-6">
        <WidgetStatus
          state={connected ? 'connected' : 'waiting'}
          connectedTitle="Widget connecté"
          connectedText="Les retours arrivent."
          waitingText="Ouvrez le site, ou la page de démonstration."
        />
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="outline">
          <a href={demoUrl(ctx)} target="_blank" rel="noopener noreferrer">
            <ExternalLinkIcon aria-hidden="true" />
            Tester sur la page de démo
          </a>
        </Button>
        <Button type="button" size="lg" onClick={onNext}>
          Continuer
          <ArrowRightIcon aria-hidden="true" />
        </Button>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- step 3 */

function AgentStep({ created, onPick, onOpen }: { created: Created; onPick: () => void; onOpen: () => void }) {
  return (
    <>
      <Heading
        eyebrow="Étape 3 sur 3 · facultatif"
        title="Confiez les corrections à un agent IA"
        text="Branchez votre agent en MCP ou par l’API : sur chaque retour, « Lancer la correction » le lui confie."
      />
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label={`Agents pour ${created.name}`}>
        {AGENT_TARGETS.map((target) => (
          <li key={target.id}>
            <button
              type="button"
              onClick={onPick}
              className="group flex h-full w-full cursor-pointer flex-col items-start gap-3 rounded-lg border border-border bg-card p-4 text-left shadow-1 transition-[border-color,box-shadow,transform] duration-150 outline-none hover:border-border-strong hover:shadow-2 focus-visible:ring-[3px] focus-visible:ring-ring active:scale-[0.98]"
            >
              <target.Logo className="size-6" />
              <span className="grid gap-0.5">
                <strong className="text-[14px] font-medium">{target.shortName}</strong>
                <span className="text-xs text-muted-foreground">{target.kind === 'api' ? 'API HTTP' : 'MCP'}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">Facultatif : vous pourrez le faire plus tard depuis « Agents IA ».</p>
        <Button type="button" size="lg" onClick={onOpen}>
          Ouvrir le projet
        </Button>
      </div>
    </>
  );
}
