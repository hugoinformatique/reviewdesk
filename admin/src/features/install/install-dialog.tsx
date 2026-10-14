/**
 * Widget install wizard: Plateforme / Intégration / Vérification.
 * Opening mints nothing: a reviewer token is created only by « Générer un
 * nouveau lien », or by « Continuer » when this project has no known token.
 * Platform cards adapted from 21st.dev radio cards (ids 748, 10156); stepper
 * from "Basic Stepper" (id 29925).
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, ExternalLinkIcon, Loader2Icon, PlusIcon, SmartphoneIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDate } from '@/lib/format';
import { keys, projectsQuery, reviewLinksQuery, useCreateReviewLink, useRevokeReviewLink } from '@/lib/queries';
import { closeOverlay } from '@/lib/ui-store';
import { cn } from '@/lib/utils';
import { useWidgetConnection } from './connection';
import { PlatformInstructions } from './platform-instructions';
import { PlatformLogo } from './platform-logos';
import { demoUrl, reviewPageUrl, WIDGET_PLATFORMS, widgetContext } from './platforms';
import { forgetToken, knownToken, rememberToken, type KnownToken } from './session-tokens';
import { firstSeen, WidgetStatus } from './widget-status';

const STEP_LABELS = ['Plateforme', 'Intégration', 'Vérification'] as const;
const PLACEHOLDER_TOKEN = 'VOTRE_JETON_REVIEWER';

export function InstallDialog({ projectId }: { projectId: string }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [platformId, setPlatformId] = useState<string>(WIDGET_PLATFORMS[0]?.id ?? 'wordpress');
  const [token, setToken] = useState<KnownToken | undefined>(() => knownToken(projectId));
  const [position, setPosition] = useState('bottom-right');
  const [theme, setTheme] = useState('auto');
  const [label, setLabel] = useState('');
  const project = useQuery(projectsQuery).data?.find((candidate) => candidate.id === projectId);
  const platform = WIDGET_PLATFORMS.find((candidate) => candidate.id === platformId) ?? WIDGET_PLATFORMS[0];
  const createLink = useCreateReviewLink();

  if (!platform) return null;
  const ctx = widgetContext({
    projectId,
    token: token?.token ?? PLACEHOLDER_TOKEN,
    previewOrigin: project?.origins[0],
    position,
    theme,
    label,
  });

  /** Mints a link for this project, remembers it, and moves on to the integration. */
  async function generate() {
    try {
      const link = await createLink.mutateAsync({ projectId });
      rememberToken(projectId, link);
      setToken({ id: link.id, token: link.token });
      setStep(2);
    } catch {
      toast.error('Création du lien impossible.');
    }
  }

  function next() {
    if (step === 3) return closeOverlay();
    if (step === 1) {
      if (!token) return void generate();
      return setStep(2);
    }
    setStep(3);
  }

  const title =
    step === 1 ? 'Installer le widget' : step === 2 ? `Intégration — ${platform.name}` : 'Vérification de l’installation';

  return (
    <Dialog open onOpenChange={(open) => !open && closeOverlay()}>
      <DialogContent showCloseButton={false} className="gap-5 sm:max-w-2xl">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="text-lg">{title}</DialogTitle>
            <Badge variant="secondary">{project?.name ?? 'Projet'}</Badge>
          </div>
          <DialogDescription>
            Intégrez ReviewDesk en une ligne de script sur votre environnement de préproduction, ou partagez un lien direct sans toucher au code.
          </DialogDescription>
        </DialogHeader>

        <ol className="flex items-center gap-2" aria-label="Étapes">
          {STEP_LABELS.map((stepLabel, index) => {
            const n = index + 1;
            const done = n < step;
            return (
              <li key={stepLabel} aria-current={n === step ? 'step' : undefined} className="flex flex-1 items-center gap-2 last:flex-none">
                <span
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-full border text-[10.5px] font-semibold tabular-nums transition-colors duration-200',
                    done && 'border-primary bg-primary text-primary-foreground',
                    n === step && 'border-primary',
                    n > step && 'border-border-strong text-muted-foreground',
                  )}
                >
                  {done ? <CheckIcon className="size-3" aria-hidden="true" /> : n}
                </span>
                <span className={cn('text-[13px]', n === step ? 'font-medium' : 'text-muted-foreground')}>{stepLabel}</span>
                {n < 3 && <span className={cn('h-px flex-1', done ? 'bg-primary' : 'bg-border')} aria-hidden="true" />}
              </li>
            );
          })}
        </ol>

        {step === 1 && (
          <StepPlatform
            projectId={projectId}
            platformId={platform.id}
            onPlatform={setPlatformId}
            tokenId={token?.id}
            onRevoked={(linkId) => {
              forgetToken(projectId, linkId);
              setToken((current) => (current?.id === linkId ? undefined : current));
            }}
            onGenerate={() => void generate()}
            generating={createLink.isPending}
          />
        )}
        {step === 2 && (
          <div className="grid gap-5">
            <p className="text-[13.5px] text-muted-foreground">{platform.where}</p>
            <WidgetOptions
              position={position}
              theme={theme}
              label={label}
              onPosition={setPosition}
              onTheme={setTheme}
              onLabel={setLabel}
              previewHost={ctx.previewOrigin.replace(/^https?:\/\//, '')}
            />
            <PlatformInstructions platform={platform} ctx={ctx} />
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <SmartphoneIcon className="size-3.5 shrink-0" aria-hidden="true" />
              Sur mobile, le panneau s’ouvre en tiroir depuis le bas de l’écran, avec capture tactile.
            </p>
          </div>
        )}
        {step === 3 && (
          <StepVerify
            projectId={projectId}
            tokenId={token?.id}
            testUrl={platform.isLink ? reviewPageUrl(ctx) : ctx.previewOrigin}
            previewOrigin={ctx.previewOrigin}
            demo={demoUrl(ctx)}
            isLink={Boolean(platform.isLink)}
          />
        )}

        <DialogFooter className="items-center sm:justify-between">
          <div>
            {step > 1 && (
              <Button type="button" variant="ghost" onClick={() => setStep((step - 1) as 1 | 2)}>
                <ArrowLeftIcon aria-hidden="true" />
                Retour
              </Button>
            )}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={closeOverlay}>
              Fermer
            </Button>
            <Button type="button" onClick={next} disabled={createLink.isPending}>
              {createLink.isPending && <Loader2Icon className="animate-spin" aria-hidden="true" />}
              {step === 3 ? 'Terminé' : 'Continuer'}
              {step < 3 && <ArrowRightIcon aria-hidden="true" />}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- step 1 */

function StepPlatform({
  projectId,
  platformId,
  onPlatform,
  tokenId,
  onRevoked,
  onGenerate,
  generating,
}: {
  projectId: string;
  platformId: string;
  onPlatform: (id: string) => void;
  tokenId: string | undefined;
  onRevoked: (linkId: string) => void;
  onGenerate: () => void;
  generating: boolean;
}) {
  const links = useQuery(reviewLinksQuery(projectId));
  const revoke = useRevokeReviewLink();

  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <p id="platform-label" className="text-[13.5px]">
          Choisissez l’environnement ou la méthode pour intégrer ReviewDesk sur votre préproduction.
        </p>
        <RadioGroupPrimitive.Root
          aria-labelledby="platform-label"
          value={platformId}
          onValueChange={onPlatform}
          className="grid grid-cols-2 gap-2 sm:grid-cols-3"
        >
          {WIDGET_PLATFORMS.map((platform) => (
            <RadioGroupPrimitive.Item
              key={platform.id}
              value={platform.id}
              className="group relative flex cursor-pointer flex-col items-start gap-2 rounded-lg border border-border bg-card p-3 text-left shadow-1 transition-[border-color,box-shadow,background-color] duration-150 outline-none hover:border-border-strong focus-visible:ring-[3px] focus-visible:ring-ring data-[state=checked]:border-primary data-[state=checked]:bg-accent"
            >
              <span className="flex w-full items-center justify-between gap-2">
                <PlatformLogo mark={platform.mark} className="size-5" />
                <span
                  className={cn(
                    'rounded-full px-1.5 py-px text-[10.5px] font-medium',
                    platform.badgeHighlight ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground',
                  )}
                >
                  {platform.badge}
                </span>
              </span>
              <span className="grid gap-0.5">
                <strong className="text-[13.5px] font-medium">{platform.name}</strong>
                <span className="text-xs text-muted-foreground">{platform.hint}</span>
              </span>
            </RadioGroupPrimitive.Item>
          ))}
        </RadioGroupPrimitive.Root>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-sunken px-3.5 py-3">
        <div className="grid gap-0.5">
          <strong className="text-[13.5px] font-medium">Jeton d’accès reviewer</strong>
          <span className="text-xs text-muted-foreground">Chaque lien génère un jeton sécurisé qui autorise les retours depuis vos origines.</span>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onGenerate} disabled={generating}>
          {generating ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <PlusIcon aria-hidden="true" />}
          Générer un nouveau lien
        </Button>
      </div>

      <section className="grid gap-2" aria-labelledby="links-title">
        <h3 id="links-title" className="text-[13.5px] font-medium">
          Liens de ce projet
        </h3>
        <p className="text-xs text-muted-foreground">
          Un secret n’est affiché qu’une seule fois, à sa création. Il reste dans le fragment de l’URL, jamais dans une query ni dans les logs HTTP.
        </p>
        {links.isPending ? (
          <p className="text-[13px] text-muted-foreground">Chargement…</p>
        ) : links.isError ? (
          <p className="text-[13px] text-destructive">Liens indisponibles.</p>
        ) : links.data.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Aucun lien pour ce projet.</p>
        ) : (
          <ul className="grid max-h-32 divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {links.data.map((link) => (
              <li key={link.id} className="link-row flex items-center justify-between gap-3 px-3 py-2 text-[13px]">
                <span className={cn(link.revokedAt && 'text-muted-foreground')}>
                  {link.revokedAt
                    ? `Révoqué ${formatDate(link.revokedAt)} · créé ${formatDate(link.createdAt)}`
                    : `Actif · créé ${formatDate(link.createdAt)} · ${link.lastUsedAt ? `utilisé ${formatDate(link.lastUsedAt)}` : 'jamais utilisé'}`}
                  {link.id === tokenId && !link.revokedAt && <span className="ml-1.5 text-xs text-muted-foreground">(créé ici)</span>}
                </span>
                {!link.revokedAt && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive-soft hover:text-destructive"
                    disabled={revoke.isPending && revoke.variables?.linkId === link.id}
                    onClick={() =>
                      revoke.mutate(
                        { projectId, linkId: link.id },
                        { onSuccess: () => onRevoked(link.id), onError: () => toast.error('Révocation impossible.') },
                      )
                    }
                  >
                    Révoquer
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------- step 2 */

function Segmented({ legend, value, options, onChange }: { legend: string; value: string; options: [string, string][]; onChange: (value: string) => void }) {
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1.5 text-[13px] font-medium">{legend}</legend>
      <div className="inline-flex w-fit rounded-lg bg-muted p-[3px]">
        {options.map(([optionValue, optionLabel]) => (
          <button
            key={optionValue}
            type="button"
            aria-pressed={value === optionValue}
            onClick={() => onChange(optionValue)}
            className={cn(
              'cursor-pointer rounded-md px-2.5 py-1 text-[13px] font-medium text-muted-foreground transition-[color,background-color,box-shadow] duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring',
              value === optionValue && 'bg-background text-foreground shadow-1',
            )}
          >
            {optionLabel}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function WidgetOptions(props: {
  position: string;
  theme: string;
  label: string;
  onPosition: (v: string) => void;
  onTheme: (v: string) => void;
  onLabel: (v: string) => void;
  previewHost: string;
}) {
  const dark = props.theme === 'dark';
  return (
    <div className="grid gap-4 sm:grid-cols-[1fr_15rem]">
      <div className="grid content-start gap-4">
        <Segmented
          legend="Position du lanceur"
          value={props.position}
          onChange={props.onPosition}
          options={[
            ['bottom-right', 'Bas-droite'],
            ['bottom-left', 'Bas-gauche'],
          ]}
        />
        <Segmented
          legend="Thème visuel"
          value={props.theme}
          onChange={props.onTheme}
          options={[
            ['auto', 'Auto'],
            ['light', 'Clair'],
            ['dark', 'Sombre'],
          ]}
        />
        <div className="grid gap-1.5">
          <Label htmlFor="widget-label">Texte du bouton</Label>
          <Input id="widget-label" value={props.label} maxLength={30} onChange={(event) => props.onLabel(event.target.value)} placeholder="Faire un retour" />
        </div>
      </div>
      <figure className="grid gap-1.5" data-position={props.position} data-theme={props.theme}>
        <div className="relative h-36 overflow-hidden rounded-lg border border-border bg-background">
          <div className="flex items-center gap-1 border-b border-border px-2 py-1.5" aria-hidden="true">
            <i className="size-1.5 rounded-full bg-border-strong" />
            <i className="size-1.5 rounded-full bg-border-strong" />
            <i className="size-1.5 rounded-full bg-border-strong" />
            <span className="ml-1 truncate text-[10px] text-muted-foreground">{props.previewHost}</span>
          </div>
          <div className="grid gap-1.5 p-3" aria-hidden="true">
            <div className="h-1.5 w-2/5 rounded bg-secondary" />
            <div className="h-3 w-3/4 rounded bg-border" />
            <div className="h-1.5 w-2/3 rounded bg-secondary" />
            <div className="h-1.5 w-1/2 rounded bg-secondary" />
          </div>
          <span
            className={cn(
              'absolute bottom-2 flex max-w-[80%] items-center gap-1 truncate rounded-full px-2.5 py-1 text-[11px] font-medium shadow-2 transition-all duration-200',
              props.position === 'bottom-left' ? 'left-2' : 'right-2',
              dark ? 'bg-zinc-900 text-white' : 'border border-border bg-white text-zinc-900',
            )}
          >
            <span className="truncate">{props.label.trim() || 'Faire un retour'}</span>
          </span>
        </div>
        <figcaption className="text-xs text-muted-foreground">Aperçu du bouton chez votre client</figcaption>
      </figure>
    </div>
  );
}

/* ---------------------------------------------------------------- step 3 */

function StepVerify({
  projectId,
  tokenId,
  testUrl,
  previewOrigin,
  demo,
  isLink,
}: {
  projectId: string;
  tokenId: string | undefined;
  testUrl: string;
  previewOrigin: string;
  demo: string;
  isLink: boolean;
}) {
  const client = useQueryClient();
  const { link, connected, gaveUp } = useWidgetConnection(projectId, tokenId, 120_000);
  useEffect(() => {
    if (connected) void client.invalidateQueries({ queryKey: keys.onboarding });
  }, [connected, client]);

  return (
    <div className="grid gap-5">
      <p className="text-[13.5px] text-muted-foreground">Préproduction : {previewOrigin}</p>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <a href={testUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLinkIcon aria-hidden="true" />
            {isLink ? 'Ouvrir le lien de relecture' : 'Tester sur la préproduction'}
          </a>
        </Button>
        <Button asChild variant="outline">
          <a href={demo} target="_blank" rel="noopener noreferrer">
            <ExternalLinkIcon aria-hidden="true" />
            Tester sur la page démo locale
          </a>
        </Button>
      </div>
      <WidgetStatus
        state={connected ? 'connected' : gaveUp ? 'idle' : 'waiting'}
        connectedTitle="Widget connecté et actif"
        connectedText={link?.lastUsedAt ? firstSeen(link.lastUsedAt) : ''}
        waitingText="Ouvrez votre site de préproduction : le statut passe au vert dès la première requête."
      />
    </div>
  );
}
