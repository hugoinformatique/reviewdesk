/**
 * Personnalisation de l'instance (marque blanche), en mode réglages : cinq
 * étapes (Accueil, Identité, Couleur, Diffusion, Terminé) et un aperçu en
 * direct à côté. Stepper inspiré de 21st.dev « Wizard Steps » (#23576).
 */
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckIcon, ImageIcon, LinkIcon, LoaderCircleIcon, PlugIcon, TargetIcon } from 'lucide-react';
import { toast } from 'sonner';
import { contrastRatio, accentTokens, normaliseHex, parseHex } from '../../../../src/brand-tokens';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { keys } from '@/lib/queries';
import { useTheme } from '@/lib/theme';
import { closeOverlay } from '@/lib/ui-store';
import { cn } from '@/lib/utils';
import { BrandingPreview } from './branding-preview';
import { brandingKey } from './branding-provider';

const MAX_LOGO_BYTES = 96 * 1024;
const LOGO_MIMES = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp'];

type Draft = {
  productName: string;
  tagline: string;
  logoDataUri: string | null;
  accent: string;
  publicUrl: string;
  emailFromName: string;
  emailFromAddress: string;
  emailReplyTo: string;
};
type Settings = Draft & { setupCompletedAt: string | null; emailDeliveryNote: string };

/** A well-drawn SVG logo weighs a few hundred bytes; « 0 Ko » reads as a failure. */
const fileSize = (bytes: number) => (bytes < 1024 ? `${bytes} o` : `${Math.round(bytes / 1024)} Ko`);

/**
 * Presets exist so nobody has to type a hex to get a defensible result. The
 * first one is the stock ink, which is the only value that keeps the interface
 * monochrome and inverts by itself between light and dark.
 */
const PRESETS = [
  { value: '#18181b', label: 'Encre (par défaut)' },
  { value: '#2563eb', label: 'Bleu' },
  { value: '#4f46e5', label: 'Indigo' },
  { value: '#7c3aed', label: 'Violet' },
  { value: '#0d9488', label: 'Sarcelle' },
  { value: '#059669', label: 'Émeraude' },
  { value: '#ea580c', label: 'Orange' },
  { value: '#e11d48', label: 'Rose' },
];

type StepDef = { id: string; short: string; eyebrow: string; title: string; intro: string; validate?: (draft: Draft) => string | null };

const STEPS: StepDef[] = [
  {
    id: 'welcome',
    short: 'Accueil',
    eyebrow: 'MISE EN ROUTE',
    title: 'Cette instance est la vôtre',
    intro: 'Quatre écrans pour la mettre à vos couleurs. Vos clients ne verront jamais un autre nom que le vôtre.',
  },
  {
    id: 'identity',
    short: 'Identité',
    eyebrow: 'ÉTAPE 1',
    title: 'Nom et logo',
    intro: 'Ce que vos clients lisent en arrivant, et ce qui signe les extraits que vous leur livrez.',
    validate: (draft) => (draft.productName.trim() ? null : 'Donnez un nom à votre produit.'),
  },
  {
    id: 'accent',
    short: 'Couleur',
    eyebrow: 'ÉTAPE 2',
    title: 'Votre couleur',
    intro: 'Choisissez une teinte : les variations et le contraste du texte en sont déduits automatiquement.',
    validate: (draft) => (normaliseHex(draft.accent) ? null : 'Cette couleur n’est pas un code hexadécimal valide.'),
  },
  {
    id: 'reach',
    short: 'Diffusion',
    eyebrow: 'ÉTAPE 3',
    title: 'Domaine et expéditeur',
    intro: 'L’adresse où vit cette instance, et l’identité sous laquelle elle écrira à vos clients.',
    validate: (draft) => {
      if (draft.publicUrl && !/^https?:\/\/.+/i.test(draft.publicUrl)) return 'L’adresse publique doit commencer par http:// ou https://.';
      const valid = (value: string) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
      if (!valid(draft.emailFromAddress) || !valid(draft.emailReplyTo)) return 'Vérifiez les adresses email.';
      return null;
    },
  },
  {
    id: 'done',
    short: 'Terminé',
    eyebrow: 'ÉTAPE 4',
    title: 'Tout est prêt',
    intro: 'Relisez, puis appliquez. Le tableau de bord s’ouvre à vos couleurs.',
  },
];

export function BrandingWizard() {
  const settings = useQuery({
    queryKey: keys.brandingSettings,
    queryFn: () => api<Settings>('/api/branding/settings'),
    // The draft is edited from what the server holds right now.
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  useEffect(() => {
    if (settings.isError) {
      toast.error('Personnalisation indisponible.');
      closeOverlay();
    }
  }, [settings.isError]);

  return (
    <Dialog open onOpenChange={(open) => !open && closeOverlay()}>
      <DialogContent className="gap-0 p-0 sm:max-w-4xl">
        <DialogTitle className="sr-only">Personnalisation de l'instance</DialogTitle>
        {settings.data ? (
          <Wizard settings={settings.data} />
        ) : (
          <div className="grid gap-3 p-6" aria-busy="true">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Wizard({ settings }: { settings: Settings }) {
  const client = useQueryClient();
  const { resolved } = useTheme();
  const [draft, setDraft] = useState<Draft>({
    productName: settings.productName,
    tagline: settings.tagline,
    logoDataUri: settings.logoDataUri,
    accent: settings.accent,
    publicUrl: settings.publicUrl,
    emailFromName: settings.emailFromName,
    emailFromAddress: settings.emailFromAddress,
    emailReplyTo: settings.emailReplyTo,
  });
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const titleRef = useRef<HTMLHeadingElement>(null);
  const patch = (partial: Partial<Draft>) => setDraft((current) => ({ ...current, ...partial }));
  const step = STEPS[index]!;
  const isLast = index === STEPS.length - 1;

  const save = useMutation({
    mutationFn: () => api('/api/branding', { method: 'PUT', body: { ...draft, completeSetup: true } }),
    onSuccess: async () => {
      // The provider re-reads the public branding and repaints the interface.
      await client.invalidateQueries({ queryKey: brandingKey });
      toast.success('Personnalisation appliquée.');
      closeOverlay();
    },
    onError: () => setError('Enregistrement impossible. Vérifiez votre connexion, puis réessayez.'),
  });

  // Moving between steps re-announces the heading rather than dumping focus
  // at the top of the document.
  useEffect(() => titleRef.current?.focus({ preventScroll: true }), [index]);

  const go = (target: number) => {
    setError('');
    setIndex(target);
  };

  const next = () => {
    const message = step.validate?.(draft) ?? null;
    if (message) return setError(message);
    if (isLast) {
      setError('');
      return save.mutate();
    }
    go(index + 1);
  };

  return (
    <form
      className="grid lg:grid-cols-[minmax(0,1fr)_20rem]"
      onSubmit={(event) => {
        event.preventDefault();
        next();
      }}
    >
      <section className="grid content-start gap-5 p-6">
        <ol className="flex items-center gap-1.5 pr-8" aria-label="Étapes">
          {STEPS.map((item, position) => (
            <li key={item.id} className="flex flex-1 flex-col gap-1.5" aria-current={position === index ? 'step' : undefined}>
              <span className={cn('h-1 rounded-full transition-colors', position <= index ? 'bg-primary' : 'bg-border')} />
              <span className={cn('hidden text-[11px] sm:block', position === index ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                {item.short}
              </span>
            </li>
          ))}
        </ol>

        <header className="grid gap-1.5">
          <span className="text-[11px] font-medium tracking-wider text-muted-foreground">{step.eyebrow}</span>
          <h2 ref={titleRef} tabIndex={-1} className="text-xl font-semibold tracking-tight outline-none">
            {step.title}
          </h2>
          <DialogDescription className="text-[13.5px]">{step.intro}</DialogDescription>
        </header>

        <div className="min-h-56">
          {step.id === 'welcome' && <WelcomeStep />}
          {step.id === 'identity' && <IdentityStep draft={draft} patch={patch} />}
          {step.id === 'accent' && <AccentStep draft={draft} patch={patch} />}
          {step.id === 'reach' && <ReachStep draft={draft} patch={patch} note={settings.emailDeliveryNote} />}
          {step.id === 'done' && <DoneStep draft={draft} />}
        </div>

        <p role="alert" className="min-h-5 text-[13px] text-destructive">
          {error}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {index > 0 && (
            <Button type="button" variant="ghost" onClick={() => go(index - 1)}>
              Retour
            </Button>
          )}
          <div className="flex-1" />
          {!save.isPending && (
            <Button type="button" variant="ghost" onClick={closeOverlay}>
              Fermer
            </Button>
          )}
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <LoaderCircleIcon className="animate-spin" aria-hidden="true" />}
            {save.isPending ? 'Application…' : isLast ? 'Appliquer et ouvrir' : 'Continuer'}
          </Button>
        </div>
      </section>

      <aside className="border-t border-border bg-sunken p-6 lg:border-t-0 lg:border-l">
        <BrandingPreview productName={draft.productName} logoDataUri={draft.logoDataUri} accent={draft.accent} dark={resolved === 'dark'} />
      </aside>
    </form>
  );
}

// ------------------------------------------------------------------- fields

function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

type StepProps = { draft: Draft; patch: (partial: Partial<Draft>) => void };

function WelcomeStep() {
  const points = [
    [ImageIcon, 'Votre logo et votre nom', 'Sur l’écran de connexion, dans le tableau de bord, et jusque dans les extraits d’installation remis à vos clients.'],
    [TargetIcon, 'Votre couleur', 'Une seule teinte à choisir : les états survolés, le texte posé dessus et l’anneau de focus en sont déduits, avec un contraste garanti.'],
    [LinkIcon, 'Votre domaine', 'L’adresse publique de cette instance, utilisée dans le code que vous livrez.'],
  ] as const;
  return (
    <ul className="grid gap-4">
      {points.map(([Icon, title, body]) => (
        <li key={title} className="flex gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-background text-muted-foreground">
            <Icon className="size-4" aria-hidden="true" />
          </span>
          <div className="grid gap-0.5">
            <strong className="text-[13.5px] font-medium">{title}</strong>
            <p className="text-[13px] text-subtle-foreground">{body}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function IdentityStep({ draft, patch }: StepProps) {
  return (
    <div className="grid gap-4">
      <Field label="Nom du produit" hint="Remplace « ReviewDesk » partout dans l’interface." htmlFor="setup-name">
        <Input id="setup-name" value={draft.productName} maxLength={40} placeholder="Acme Feedback" autoComplete="off" onChange={(event) => patch({ productName: event.target.value })} />
      </Field>
      <Field label="Baseline" hint="Une phrase sous le logo, sur l’écran de connexion." htmlFor="setup-tagline">
        <Input id="setup-tagline" value={draft.tagline} maxLength={200} placeholder="Ce que vos clients lisent en se connectant" autoComplete="off" onChange={(event) => patch({ tagline: event.target.value })} />
      </Field>
      <LogoPicker logo={draft.logoDataUri} onLogo={(logoDataUri) => patch({ logoDataUri })} />
    </div>
  );
}

function LogoPicker({ logo, onLogo }: { logo: string | null; onLogo: (value: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [status, setStatus] = useState('');

  const accept = (file: File | undefined) => {
    if (!file) return;
    if (!LOGO_MIMES.includes(file.type)) return setStatus('Format non pris en charge : utilisez un SVG, un PNG, un JPEG ou un WebP.');
    if (file.size > MAX_LOGO_BYTES) return setStatus(`Fichier trop lourd (${fileSize(file.size)}) : la limite est de ${fileSize(MAX_LOGO_BYTES)}.`);
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      onLogo(String(reader.result));
      setStatus(`${file.name} — ${fileSize(file.size)}`);
    });
    reader.addEventListener('error', () => setStatus('Lecture du fichier impossible.'));
    reader.readAsDataURL(file);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    accept(event.dataTransfer.files[0]);
  };

  return (
    <Field label="Logo" hint={`SVG, PNG, JPEG ou WebP — ${Math.round(MAX_LOGO_BYTES / 1024)} Ko maximum.`}>
      <div
        role="button"
        tabIndex={0}
        aria-label={logo ? 'Remplacer le logo' : 'Choisir un fichier ou le déposer ici'}
        onClick={() => input.current?.click()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            input.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          'flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border-strong bg-background p-3 text-[13px] transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring',
          over && 'border-primary bg-accent',
        )}
      >
        <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-sunken text-muted-foreground">
          {logo ? <img src={logo} alt="Logo de l’instance" className="size-full object-contain" /> : <ImageIcon className="size-5" aria-hidden="true" />}
        </span>
        <span className="flex-1 text-subtle-foreground">{logo ? 'Remplacer le logo' : 'Choisir un fichier ou le déposer ici'}</span>
        {logo && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              onLogo(null);
              setStatus('');
              if (input.current) input.current.value = '';
            }}
          >
            Retirer
          </Button>
        )}
        <input ref={input} type="file" accept={LOGO_MIMES.join(',')} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => accept(event.target.files?.[0])} />
      </div>
      <p className="min-h-4 text-xs text-muted-foreground" role="status">
        {status}
      </p>
    </Field>
  );
}

function AccentStep({ draft, patch }: StepProps) {
  // The field keeps what is typed, even half-typed; the draft only takes valid values.
  const [typed, setTyped] = useState(draft.accent);
  const set = (value: string) => {
    setTyped(value);
    const normalised = normaliseHex(value);
    if (normalised) patch({ accent: normalised });
  };
  const tokens = accentTokens(draft.accent);
  const background = parseHex(tokens.accent);
  const foreground = parseHex(tokens.accentFg);
  const ratio = background && foreground ? contrastRatio(background, foreground) : null;
  const onWhite = tokens.accentFg === '#ffffff';

  return (
    <div className="grid gap-4">
      <Field label="Couleur de marque" hint="Une teinte suffit : tout le reste en est déduit.">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Couleurs prédéfinies">
          {PRESETS.map((preset) => {
            const pressed = preset.value === draft.accent;
            return (
              <button
                key={preset.value}
                type="button"
                title={preset.label}
                aria-label={preset.label}
                aria-pressed={pressed}
                onClick={() => set(preset.value)}
                style={{ backgroundColor: preset.value }}
                className="grid size-8 cursor-pointer place-items-center rounded-full border border-black/10 text-white shadow-1 transition-transform outline-none hover:scale-105 focus-visible:ring-[3px] focus-visible:ring-ring aria-pressed:ring-2 aria-pressed:ring-foreground aria-pressed:ring-offset-2 aria-pressed:ring-offset-background"
              >
                {pressed && <CheckIcon className="size-4" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </Field>
      <Field label="Valeur exacte" htmlFor="setup-accent">
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label="Sélecteur de couleur"
            value={draft.accent}
            onChange={(event) => set(event.target.value)}
            className="h-[34px] w-10 cursor-pointer rounded-md border border-input bg-background p-1"
          />
          <Input id="setup-accent" value={typed} maxLength={7} spellCheck={false} placeholder="#2563eb" className="w-32 font-mono" onChange={(event) => set(event.target.value)} />
        </div>
      </Field>
      {ratio !== null && (
        <p
          role="status"
          className={cn('rounded-md px-3 py-2 text-[13px]', ratio >= 4.5 ? 'bg-[var(--st-done-soft)] text-[var(--st-done)]' : 'bg-[var(--st-progress-soft)] text-[var(--st-progress)]')}
        >
          {`Texte ${onWhite ? 'blanc' : 'noir'} sur cette couleur : contraste ${ratio.toFixed(1)}:1 — ` +
            (ratio >= 4.5 ? 'conforme AA.' : 'sous le seuil AA de 4,5:1, à éviter pour les boutons pleins.')}
        </p>
      )}
    </div>
  );
}

function ReachStep({ draft, patch, note }: StepProps & { note: string }) {
  return (
    <div className="grid gap-4">
      <Field label="Adresse publique de l’instance" hint="Reprise dans les extraits d’installation que vous remettez à vos clients." htmlFor="setup-url">
        <Input id="setup-url" inputMode="url" value={draft.publicUrl} placeholder="https://retours.mon-agence.fr" autoComplete="off" onChange={(event) => patch({ publicUrl: event.target.value.trim() })} />
      </Field>
      <hr className="border-border" />
      <Field label="Nom de l’expéditeur" htmlFor="setup-from-name">
        <Input id="setup-from-name" value={draft.emailFromName} maxLength={80} placeholder="Support Acme" autoComplete="off" onChange={(event) => patch({ emailFromName: event.target.value })} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Adresse d’expédition" htmlFor="setup-from-address">
          <Input id="setup-from-address" type="email" value={draft.emailFromAddress} placeholder="support@mon-agence.fr" autoComplete="off" onChange={(event) => patch({ emailFromAddress: event.target.value.trim() })} />
        </Field>
        <Field label="Adresse de réponse" hint="Facultative : où arrivent les réponses de vos clients." htmlFor="setup-reply-to">
          <Input id="setup-reply-to" type="email" value={draft.emailReplyTo} placeholder="equipe@mon-agence.fr" autoComplete="off" onChange={(event) => patch({ emailReplyTo: event.target.value.trim() })} />
        </Field>
      </div>
      <div className="flex gap-2.5 rounded-md bg-sunken px-3 py-2.5 text-[13px] text-subtle-foreground">
        <PlugIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>{note}</p>
      </div>
    </div>
  );
}

function DoneStep({ draft }: { draft: Draft }) {
  const rows: [string, string, boolean?][] = [
    ['Nom', draft.productName],
    ['Logo', draft.logoDataUri ? 'Personnalisé' : 'Marque par défaut'],
    ['Couleur', draft.accent, true],
    ['Adresse publique', draft.publicUrl || 'Non renseignée'],
    ['Expéditeur', draft.emailFromAddress || 'Non renseigné'],
  ];
  return (
    <div className="grid gap-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-lg border border-border bg-card p-4 text-[13.5px]">
        {rows.map(([label, value, mono]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className={cn('min-w-0 break-words', mono && 'font-mono')}>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">Tout reste modifiable plus tard depuis Personnalisation.</p>
    </div>
  );
}
