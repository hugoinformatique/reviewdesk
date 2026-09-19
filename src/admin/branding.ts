import { accentTokens, type AccentTokens } from '../brand-tokens.js';

/**
 * Applies the instance's identity to a page that was already served.
 *
 * `public/index.html` is a static file on a CDN with no template engine, so the
 * branding cannot be baked in at build time — it is hydrated here, at runtime,
 * from `/api/branding`. Everything below therefore has to go through the DOM
 * APIs the admin CSP allows: `style.setProperty` for colours (`style-src 'self'`
 * forbids a `<style>` element) and `<img src="data:…">` for the logo (allowed by
 * `img-src 'self' data:`).
 */

export type PublicBranding = {
  productName: string;
  tagline: string;
  logoDataUri: string | null;
  accent: string;
  tokens?: AccentTokens;
  setupComplete: boolean;
};

/** Mirrors `DEFAULT_BRANDING.accent`: the ink that inverts by itself in dark mode. */
const DEFAULT_ACCENT = '#18181b';

export const FALLBACK_BRANDING: PublicBranding = {
  productName: 'ReviewDesk',
  tagline: 'Le retour visuel de vos clients, épinglé au bon endroit de la page.',
  logoDataUri: null,
  accent: DEFAULT_ACCENT,
  setupComplete: false,
};

let current: PublicBranding = FALLBACK_BRANDING;

export const currentBranding = () => current;

export async function fetchPublicBranding(): Promise<PublicBranding> {
  try {
    const response = await fetch('/api/branding');
    if (!response.ok) return FALLBACK_BRANDING;
    return (await response.json()) as PublicBranding;
  } catch {
    // An instance that cannot reach its own API still has to render a sign-in
    // form; falling back to the stock identity beats a blank page.
    return FALLBACK_BRANDING;
  }
}

/**
 * Splits a product name into the light half and the bold half of the wordmark.
 * "Acme Feedback" → Acme + **Feedback**; "PixelPost" → Pixel + **Post**; a
 * single lowercase word is simply all bold.
 */
export function splitWordmark(name: string): { light: string; bold: string } {
  const trimmed = name.trim();
  const space = trimmed.lastIndexOf(' ');
  if (space > 0) return { light: trimmed.slice(0, space + 1), bold: trimmed.slice(space + 1) };
  const camel = /^(.+?[a-z0-9])([A-Z].*)$/.exec(trimmed);
  if (camel) return { light: camel[1]!, bold: camel[2]! };
  return { light: '', bold: trimmed };
}

const isDark = () =>
  document.documentElement.dataset.theme === 'dark' ||
  (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);

/**
 * Pushes the derived accent onto `:root`.
 *
 * Skipped entirely while the accent is the stock ink, because the stylesheet
 * already inverts that one between themes and an inline custom property would
 * win over the dark-mode rule and freeze it black.
 */
function applyAccent(branding: PublicBranding) {
  const root = document.documentElement.style;
  const vars = ['--accent', '--accent-hover', '--accent-fg', '--accent-soft', '--accent-text', '--ring'];
  if (branding.accent.toLowerCase() === DEFAULT_ACCENT) {
    for (const name of vars) root.removeProperty(name);
    return;
  }
  const tokens = branding.tokens ?? accentTokens(branding.accent);
  root.setProperty('--accent', tokens.accent);
  root.setProperty('--accent-hover', tokens.accentHover);
  root.setProperty('--accent-fg', tokens.accentFg);
  root.setProperty('--accent-soft', tokens.accentSoft);
  root.setProperty('--ring', tokens.ring);
  // Used where the accent is ink on the page rather than a filled surface, so
  // it has to clear 4.5:1 against whichever background is showing.
  root.setProperty('--accent-text', isDark() ? tokens.accentOnDark : tokens.accentOnLight);
}

/** Re-derives only the theme-dependent token. Call after a theme toggle. */
export function refreshBrandingForTheme() {
  applyAccent(current);
}

function applyLogo(branding: PublicBranding) {
  for (const host of document.querySelectorAll<HTMLElement>('.mark, .prompt-icon')) {
    const existing = host.querySelector('img.mark-img');
    if (!branding.logoDataUri) {
      if (existing) existing.remove();
      host.classList.remove('has-logo');
      host.querySelector('svg')?.removeAttribute('hidden');
      continue;
    }
    host.classList.add('has-logo');
    host.querySelector('svg')?.setAttribute('hidden', '');
    const img = existing instanceof HTMLImageElement ? existing : document.createElement('img');
    img.className = 'mark-img';
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
    img.src = branding.logoDataUri;
    if (!existing) host.append(img);
  }
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (icon) icon.href = branding.logoDataUri ?? '/favicon.svg';
}

function applyWordmarks(branding: PublicBranding) {
  const { light, bold } = splitWordmark(branding.productName);
  for (const mark of document.querySelectorAll<HTMLElement>('.wordmark')) {
    mark.textContent = '';
    if (mark.hasAttribute('aria-label')) mark.setAttribute('aria-label', branding.productName);
    if (light) {
      const span = document.createElement('span');
      span.textContent = light;
      if (mark.hasAttribute('aria-label')) span.setAttribute('aria-hidden', 'true');
      mark.append(span);
    }
    const strong = document.createElement('b');
    strong.textContent = bold;
    if (mark.hasAttribute('aria-label')) strong.setAttribute('aria-hidden', 'true');
    mark.append(strong);
  }
}

/** Applies every branded surface of the admin shell. Safe to call repeatedly. */
export function applyBranding(branding: PublicBranding) {
  current = branding;
  document.title = `${branding.productName} — Admin`;
  applyAccent(branding);
  applyLogo(branding);
  applyWordmarks(branding);
  const tagline = document.querySelector<HTMLElement>('#login-form p');
  if (tagline) tagline.textContent = branding.tagline;
  // Anything that names the product in static copy opts in by marking itself.
  for (const slot of document.querySelectorAll<HTMLElement>('[data-brand-name]')) {
    slot.textContent = branding.productName;
  }
}
