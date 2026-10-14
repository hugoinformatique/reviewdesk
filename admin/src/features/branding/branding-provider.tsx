/**
 * The instance's identity (white label), read from the public endpoint before
 * sign-in so the login wears it too. Colours go onto <html> through the CSSOM
 * (`style.setProperty`), which `style-src 'self'` allows.
 */
import { useQuery } from '@tanstack/react-query';
import { createContext, use, useEffect, type ReactNode } from 'react';
import { accentTokens, type AccentTokens } from '../../../../src/brand-tokens';
import { useTheme } from '@/lib/theme';

export type PublicBranding = {
  productName: string;
  tagline: string;
  logoDataUri: string | null;
  accent: string;
  tokens?: AccentTokens;
  setupComplete: boolean;
};

/** Mirrors DEFAULT_BRANDING.accent: the ink that inverts by itself in dark mode. */
export const DEFAULT_ACCENT = '#18181b';

export const FALLBACK_BRANDING: PublicBranding = {
  productName: 'ReviewDesk',
  tagline: 'Le retour visuel de vos clients, épinglé au bon endroit de la page.',
  logoDataUri: null,
  accent: DEFAULT_ACCENT,
  setupComplete: false,
};

export const brandingKey = ['branding', 'public'] as const;

async function fetchBranding(): Promise<PublicBranding> {
  try {
    const response = await fetch('/api/branding');
    return response.ok ? ((await response.json()) as PublicBranding) : FALLBACK_BRANDING;
  } catch {
    // An instance that cannot reach its own API still renders a sign-in form.
    return FALLBACK_BRANDING;
  }
}

/**
 * "Acme Feedback" → Acme + **Feedback**; "PixelPost" → Pixel + **Post**; a
 * single lowercase word is all bold.
 */
export function splitWordmark(name: string): { light: string; bold: string } {
  const trimmed = name.trim();
  const space = trimmed.lastIndexOf(' ');
  if (space > 0) return { light: trimmed.slice(0, space + 1), bold: trimmed.slice(space + 1) };
  const camel = /^(.+?[a-z0-9])([A-Z].*)$/.exec(trimmed);
  if (camel) return { light: camel[1]!, bold: camel[2]! };
  return { light: '', bold: trimmed };
}

const ACCENT_VARS = ['--primary', '--primary-foreground', '--brand-soft', '--brand-text', '--ring'];

/**
 * The stock ink is left to the stylesheet, which inverts it per theme: an
 * inline property would win over the dark rule and freeze it black.
 */
function applyAccent(branding: PublicBranding, dark: boolean) {
  const root = document.documentElement.style;
  if (branding.accent.toLowerCase() === DEFAULT_ACCENT) {
    for (const name of ACCENT_VARS) root.removeProperty(name);
    return;
  }
  const tokens = branding.tokens ?? accentTokens(branding.accent);
  root.setProperty('--primary', tokens.accent);
  root.setProperty('--primary-foreground', tokens.accentFg);
  root.setProperty('--brand-soft', tokens.accentSoft);
  root.setProperty('--ring', tokens.ring);
  // Ink on the page rather than a filled surface: 4.5:1 on whichever ground.
  root.setProperty('--brand-text', dark ? tokens.accentOnDark : tokens.accentOnLight);
}

const BrandingContext = createContext<PublicBranding>(FALLBACK_BRANDING);

export function BrandingProvider({ children }: { children: ReactNode }) {
  const { data = FALLBACK_BRANDING } = useQuery({ queryKey: brandingKey, queryFn: fetchBranding, staleTime: Infinity });
  const { resolved } = useTheme();

  useEffect(() => {
    applyAccent(data, resolved === 'dark');
  }, [data, resolved]);

  useEffect(() => {
    document.title = `${data.productName} — Admin`;
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) icon.href = data.logoDataUri ?? '/favicon.svg';
  }, [data]);

  return <BrandingContext value={data}>{children}</BrandingContext>;
}

export const useBranding = () => use(BrandingContext);
