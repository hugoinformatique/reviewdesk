import { ImageIcon, MapPinIcon } from 'lucide-react';
import { accentTokens } from '../../../../src/brand-tokens';
import { splitWordmark } from './branding-provider';

type PreviewProps = { productName: string; logoDataUri: string | null; accent: string; dark: boolean };

/**
 * Live preview of the instance wearing the draft. The colours are custom
 * properties set on this element only (`--pv-*`, through the CSSOM), never on
 * :root, so the interface keeps its accent until the draft is actually saved.
 */
export function BrandingPreview({ productName, logoDataUri, accent, dark }: PreviewProps) {
  const tokens = accentTokens(accent);
  const { light, bold } = splitWordmark(productName || 'ReviewDesk');
  const vars = {
    '--pv-accent': tokens.accent,
    '--pv-accent-fg': tokens.accentFg,
    '--pv-accent-soft': tokens.accentSoft,
    '--pv-ring': tokens.ring,
    '--pv-text': dark ? tokens.accentOnDark : tokens.accentOnLight,
  } as React.CSSProperties;

  return (
    <figure className="grid gap-2" aria-label="Aperçu en direct">
      <figcaption className="text-xs font-medium text-muted-foreground">Aperçu en direct</figcaption>
      <div style={vars} className="relative overflow-hidden rounded-lg border border-border bg-background shadow-2" aria-hidden="true">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border bg-sidebar px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid size-6 shrink-0 place-items-center overflow-hidden rounded-md bg-[var(--pv-accent)] text-[var(--pv-accent-fg)]">
              {logoDataUri ? <img src={logoDataUri} alt="" className="size-full object-contain" /> : <MapPinIcon className="size-3.5" />}
            </span>
            <span className="truncate text-[13px] tracking-tight">
              {light && <span className="font-normal">{light}</span>}
              <b className="font-semibold">{bold}</b>
            </span>
          </div>
          <div className="flex gap-1 text-[11px] whitespace-nowrap">
            <span className="rounded-md bg-[var(--pv-accent-soft)] px-2 py-0.5 font-medium text-[var(--pv-text)]">Vue d’ensemble</span>
            <span className="px-2 py-0.5 text-muted-foreground">Retours</span>
          </div>
        </div>
        <div className="grid gap-3 p-3">
          <div className="flex items-end justify-between gap-2">
            <div className="grid gap-0.5">
              <span className="text-[10px] font-medium tracking-wider text-muted-foreground">TOUS LES CLIENTS</span>
              <span className="text-sm font-semibold tracking-tight">Tous les retours</span>
            </div>
            <span className="rounded-md bg-[var(--pv-accent)] px-2.5 py-1 text-[11px] font-medium text-[var(--pv-accent-fg)]">Nouveau projet</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['Retours ouverts', '12'],
                ['Délai médian', '3 h 20'],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="grid gap-0.5 rounded-md border border-border bg-card p-2">
                <span className="text-[10px] text-muted-foreground">{label}</span>
                <strong className="text-sm font-semibold tabular-nums">{value}</strong>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 rounded-md border border-border bg-card p-2">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--pv-accent-soft)] text-[var(--pv-text)]">
              <MapPinIcon className="size-3" />
            </span>
            <div className="grid min-w-0 flex-1">
              <strong className="truncate text-[11.5px] font-medium">Le bouton du panier est coupé sur mobile</strong>
              <span className="truncate text-[10.5px] text-muted-foreground">boutique.client.fr — il y a 2 h</span>
            </div>
            <span className="rounded bg-[var(--st-todo-soft)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--st-todo)]">À FAIRE</span>
          </div>
        </div>
        <div className="flex justify-end px-3 pb-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--pv-accent)] px-3 py-1.5 text-[11px] font-medium text-[var(--pv-accent-fg)] shadow-2 ring-4 ring-[var(--pv-ring)]">
            <ImageIcon className="size-3" />
            Faire un retour
          </span>
        </div>
      </div>
    </figure>
  );
}
