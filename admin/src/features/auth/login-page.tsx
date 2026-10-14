/**
 * Sign-in. Split layout on wide screens: the brand and a drawn preview of
 * what a pinned remark looks like on the left, the form on the right; on a
 * phone only the form. Inspired by 21st.dev « Split Login » (id 28369,
 * hirael/login-03): split aside + calm form pane, without its decorative
 * paths, quote or GitHub-only flow. The preview is an illustration, not data.
 */
import { LoaderCircle, Eye, EyeOff, MessageSquareText } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBranding } from '@/features/branding/branding-provider';
import { BrandMark, Wordmark } from '@/features/shell/brand-mark';
import { loginErrorMessage } from '@/lib/api';
import { useSession } from './session';

function PagePreview() {
  return (
    <div aria-hidden className="relative w-full max-w-md select-none">
      <div className="overflow-hidden rounded-xl border border-border-strong bg-background shadow-3">
        <div className="flex items-center gap-1.5 border-b border-border bg-sunken px-3 py-2.5">
          <span className="size-2 rounded-full bg-border-strong" />
          <span className="size-2 rounded-full bg-border-strong" />
          <span className="size-2 rounded-full bg-border-strong" />
          <span className="ml-3 h-4 flex-1 rounded bg-border/80" />
        </div>
        <div className="relative flex flex-col gap-3 p-5">
          <div className="h-3 w-1/3 rounded bg-foreground/80" />
          <div className="h-2 w-5/6 rounded bg-border-strong" />
          <div className="h-2 w-2/3 rounded bg-border-strong" />
          <div className="mt-3 grid grid-cols-3 gap-3">
            <div className="h-16 rounded-md bg-sunken ring-1 ring-border" />
            <div className="h-16 rounded-md bg-sunken ring-1 ring-border" />
            <div className="h-16 rounded-md bg-sunken ring-1 ring-border" />
          </div>
          <div className="mt-1 flex">
            <div className="h-8 w-28 rounded-md bg-primary" />
          </div>
          {/* The pin sits on the button; the bubble reads like a client's remark. */}
          <span className="absolute bottom-[1.45rem] left-[6.4rem] flex size-6 items-center justify-center rounded-full bg-st-todo text-[11px] font-semibold text-white shadow-2 ring-4 ring-background">
            1
          </span>
        </div>
      </div>
      <div className="absolute -right-3 -bottom-10 w-60 rounded-lg border border-border-strong bg-card p-3.5 shadow-3 sm:-right-6">
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <MessageSquareText className="size-3.5" />
          Retour épinglé sur la page
        </div>
        <p className="text-[13px] leading-snug text-foreground">Ce bouton est collé au bord, on peut l’aérer ?</p>
        <div className="mt-2.5 flex items-center gap-1.5">
          <span className="rounded-md bg-st-todo-soft px-1.5 py-0.5 text-[11px] font-medium text-st-todo">À traiter</span>
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { login } = useSession();
  const { tagline, productName } = useBranding();
  const reduce = useReducedMotion();
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const ids = { user: useId(), pass: useId() };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError('');
    try {
      await login(password);
    } catch (failure) {
      setError(loginErrorMessage(failure));
      setPending(false);
    }
  }

  const enter = (delay: number) =>
    reduce ? {} : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.35, delay, ease: [0.23, 1, 0.32, 1] as const } };

  return (
    <div className="min-h-svh bg-background lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-border bg-sunken p-10 lg:flex xl:p-14">
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.55] [background-image:linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_30%_40%,#000_20%,transparent_72%)]"
        />
        <div className="relative flex items-center gap-2.5">
          <BrandMark className="size-8" />
          <Wordmark className="text-lg" />
        </div>
        <div className="relative flex flex-1 items-center justify-center py-12">
          <PagePreview />
        </div>
        <p className="relative max-w-md text-balance text-[22px] leading-snug font-medium tracking-tight text-foreground xl:text-2xl">{tagline}</p>
      </aside>

      <main className="flex min-h-svh flex-col justify-center px-6 py-10 sm:px-10 lg:min-h-0">
        <div className="mx-auto w-full max-w-sm">
          <motion.div {...enter(0)} className="mb-10 flex items-center gap-2.5 lg:hidden">
            <BrandMark className="size-8" />
            <Wordmark className="text-lg" />
          </motion.div>

          <motion.div {...enter(0.04)}>
            <h1 className="text-[28px] leading-tight font-semibold tracking-tight">Connexion</h1>
            <p className="mt-2 text-[14px] text-muted-foreground lg:hidden">{tagline}</p>
            <p className="mt-2 hidden text-[14px] text-muted-foreground lg:block">Accédez à l’espace d’administration de {productName}.</p>
          </motion.div>

          <motion.form {...enter(0.1)} onSubmit={submit} className="mt-8 flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor={ids.user}>Identifiant</Label>
              {/* The server only knows one account; kept in the form so password managers pair it. */}
              <Input id={ids.user} name="username" value="admin" readOnly autoComplete="username" className="bg-sunken text-muted-foreground" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={ids.pass}>Mot de passe</Label>
              <div className="relative">
                <Input
                  id={ids.pass}
                  name="password"
                  type={reveal ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  autoFocus
                  autoComplete="current-password"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `${ids.pass}-error` : undefined}
                  className="h-10 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setReveal((value) => !value)}
                  aria-label={reveal ? 'Masquer la saisie' : 'Afficher la saisie'}
                  aria-pressed={reveal}
                  className="absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring"
                >
                  {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <output
              id={`${ids.pass}-error`}
              aria-live="polite"
              className={error ? 'block rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-[13px] text-destructive' : 'sr-only'}
            >
              {error}
            </output>

            <Button type="submit" size="lg" disabled={pending} className="w-full">
              {pending && <LoaderCircle className="animate-spin" aria-hidden />}
              {pending ? 'Connexion…' : 'Se connecter'}
            </Button>
          </motion.form>
        </div>
      </main>
    </div>
  );
}
