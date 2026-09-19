/**
 * Accent derivation, shared verbatim by the server, the admin bundle and the
 * widget bundle. Deliberately dependency-free: the widget pays for every byte
 * it imports, and this file is the one piece of branding logic it needs.
 *
 * A white-label instance lets a stranger pick one colour. Everything else — the
 * hover state, the text that sits on top of it, the focus ring, the tinted
 * surface — has to be derived from that single value, because an agency that
 * picks a pale yellow must not end up with white text on it.
 */

export type AccentTokens = {
  /** The chosen colour, normalised to #rrggbb. */
  accent: string;
  /** Pressed / hovered: pushed away from the mid-point so it reads as a change. */
  accentHover: string;
  /** Text and icons drawn on top of `accent`. Black or white, whichever wins. */
  accentFg: string;
  /** A tinted surface: the accent at low alpha, so it works on light and dark. */
  accentSoft: string;
  /** Focus ring, same trick as `accentSoft` at a slightly higher alpha. */
  ring: string;
  /** The accent used as *text* on the page background, clamped to stay legible. */
  accentOnLight: string;
  /** Same, for the dark theme. */
  accentOnDark: string;
};

type Rgb = { r: number; g: number; b: number };
type Hsl = { h: number; s: number; l: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Parses `#rgb` / `#rrggbb`, with or without the hash. Returns null if it isn't one. */
export function parseHex(value: string): Rgb | null {
  const raw = value.trim().replace(/^#/, '');
  const full = raw.length === 3 ? raw.replace(/./g, (char) => char + char) : raw;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

const toHex = ({ r, g, b }: Rgb) =>
  `#${[r, g, b].map((channel) => Math.round(clamp(channel, 0, 255)).toString(16).padStart(2, '0')).join('')}`;

/** Normalises any accepted form to `#rrggbb`, or returns null. */
export function normaliseHex(value: string): string | null {
  const rgb = parseHex(value);
  return rgb && toHex(rgb);
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const l = (max + min) / 2;
  const delta = max - min;
  if (!delta) return { h: 0, s: 0, l };
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h: number;
  if (max === red) h = ((green - blue) / delta + (green < blue ? 6 : 0)) / 6;
  else if (max === green) h = ((blue - red) / delta + 2) / 6;
  else h = ((red - green) / delta + 4) / 6;
  return { h, s, l };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  if (!s) {
    const grey = l * 255;
    return { r: grey, g: grey, b: grey };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (offset: number) => {
    let t = h + offset;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: channel(1 / 3) * 255, g: channel(0) * 255, b: channel(-1 / 3) * 255 };
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(rgb: Rgb): number {
  const channel = (value: number) => {
    const ratio = value / 255;
    return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** WCAG contrast ratio between two colours, 1 to 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const light = Math.max(luminance(a), luminance(b));
  const dark = Math.min(luminance(a), luminance(b));
  return (light + 0.05) / (dark + 0.05);
}

const INK: Rgb = { r: 9, g: 9, b: 11 };
const PAPER: Rgb = { r: 255, g: 255, b: 255 };

/**
 * Black or white on top of `background`, whichever has the higher contrast.
 * Not a threshold on lightness: a saturated mid-green and a mid-blue have the
 * same HSL lightness and opposite answers.
 */
export function foregroundFor(background: Rgb): string {
  return contrastRatio(background, INK) >= contrastRatio(background, PAPER) ? '#09090b' : '#ffffff';
}

/**
 * Walks the lightness until the colour clears `target` contrast against the
 * given page background, so an accent stays legible when used as text. Gives up
 * at pure black / white rather than looping.
 */
function legibleAgainst(hsl: Hsl, background: Rgb, target: number): string {
  const darken = luminance(background) > 0.5;
  for (let step = 0; step <= 100; step += 2) {
    const candidate = {
      ...hsl,
      l: clamp(darken ? hsl.l - step / 100 : hsl.l + step / 100, 0, 1),
    };
    const rgb = hslToRgb(candidate);
    if (contrastRatio(rgb, background) >= target) return toHex(rgb);
  }
  return darken ? '#09090b' : '#ffffff';
}

const alpha = (rgb: Rgb, hexAlpha: string) => `${toHex(rgb)}${hexAlpha}`;

/**
 * The full set derived from one accent. `fallback` is used when the input is
 * not a colour at all, which keeps a corrupt stored value from blanking the UI.
 */
export function accentTokens(value: string, fallback = '#18181b'): AccentTokens {
  const rgb = parseHex(value) ?? parseHex(fallback) ?? INK;
  const hsl = rgbToHsl(rgb);
  // Hover moves away from the mid-point: a dark accent gets darker, a light one
  // lighter. Moving one fixed direction makes half of all accents invert on hover.
  const hoverL = hsl.l > 0.5 ? clamp(hsl.l + 0.07, 0, 1) : clamp(hsl.l - 0.07, 0, 1);
  return {
    accent: toHex(rgb),
    accentHover: toHex(hslToRgb({ ...hsl, l: hoverL })),
    accentFg: foregroundFor(rgb),
    accentSoft: alpha(rgb, '14'),
    ring: alpha(rgb, '38'),
    accentOnLight: legibleAgainst(hsl, PAPER, 4.5),
    accentOnDark: legibleAgainst(hsl, { r: 11, g: 11, b: 12 }, 4.5),
  };
}
