import { z } from 'zod';
import type { Db } from './db/index.js';
import { normaliseHex } from './brand-tokens.js';

/**
 * White-label identity for one self-hosted instance.
 *
 * The product is single-tenant by design — one `ADMIN_PASSWORD`, no users
 * table — so branding is a property of the deployment, not of a row somebody
 * owns. It lives in `instance_settings` under a single key rather than in env
 * vars because the agency reselling the tool configures it through the setup
 * wizard, not by redeploying.
 */
export type Branding = {
  /** Replaces every occurrence of "ReviewDesk" in the UI, snippets and exports. */
  productName: string;
  /** One line under the logo on the sign-in screen. */
  tagline: string;
  /** A data URI (svg/png/jpeg/webp), or null to keep the built-in mark. */
  logoDataUri: string | null;
  /** Brand colour, `#rrggbb`. Every other accent token is derived from it. */
  accent: string;
  /** Public origin of this instance; used in generated install snippets. */
  publicUrl: string;
  /** Sender identity for transactional email. See `EMAIL_DELIVERY_NOTE`. */
  emailFromName: string;
  emailFromAddress: string;
  emailReplyTo: string;
  /** Null until the wizard is completed; drives whether it opens on sign-in. */
  setupCompletedAt: string | null;
};

/**
 * There is no mailer in this codebase: the only outbound notification is the
 * per-project webhook. These fields are stored so the wizard can collect them
 * once and a future mailer can read them, and the wizard says as much on screen
 * rather than implying mail is being sent.
 */
export const EMAIL_DELIVERY_NOTE =
  'Aucun email n’est envoyé pour le moment : cette instance notifie par webhook. Ces informations seront utilisées dès qu’un service d’envoi sera branché.';

export const DEFAULT_BRANDING: Branding = {
  productName: 'ReviewDesk',
  tagline: 'Le retour visuel de vos clients, épinglé au bon endroit de la page.',
  logoDataUri: null,
  accent: '#18181b',
  publicUrl: '',
  emailFromName: '',
  emailFromAddress: '',
  emailReplyTo: '',
  setupCompletedAt: null,
};

/** Big enough for a detailed SVG or a 2x PNG wordmark, small enough to inline. */
export const MAX_LOGO_BYTES = 96 * 1024;

const LOGO_MIMES = ['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp'] as const;

/**
 * A logo is rendered through `<img src=…>` and `<link rel=icon>`, never injected
 * into the DOM as markup. That is what makes an SVG here safe: scripts and
 * external fetches inside an SVG are inert in an image context. The validation
 * below therefore only has to prove the string really is an image data URI.
 */
const logoDataUri = z
  .string()
  .max(Math.ceil(MAX_LOGO_BYTES * 1.4))
  .refine((value) => {
    const match = /^data:([a-z+/-]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match) return false;
    if (!(LOGO_MIMES as readonly string[]).includes(match[1]!)) return false;
    // Decoded length from the base64 length, without allocating the buffer.
    const payload = match[2]!;
    const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
    return (payload.length / 4) * 3 - padding <= MAX_LOGO_BYTES;
  }, 'not an accepted image data URI');

const publicUrl = z
  .string()
  .trim()
  .max(255)
  .refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'not an http(s) URL');

const email = z
  .string()
  .trim()
  .max(180)
  .refine((value) => !value || z.string().email().safeParse(value).success, 'not an email address');

export const brandingInput = z.object({
  productName: z.string().trim().min(1).max(40),
  tagline: z.string().trim().max(200),
  logoDataUri: logoDataUri.nullable(),
  accent: z.string().trim().max(9),
  publicUrl,
  emailFromName: z.string().trim().max(80),
  emailFromAddress: email,
  emailReplyTo: email,
  /** The wizard sends this on its final step; re-opening it never unsets it. */
  completeSetup: z.boolean().optional(),
});

export type BrandingInput = z.infer<typeof brandingInput>;

const SETTINGS_KEY = 'branding';

/** Coerces whatever is in the jsonb column into a complete, valid `Branding`. */
export function normaliseBranding(stored: unknown): Branding {
  const raw = (stored ?? {}) as Partial<Record<keyof Branding, unknown>>;
  const pick = (key: keyof Branding, fallback: string) =>
    typeof raw[key] === 'string' && raw[key] ? (raw[key] as string) : fallback;
  return {
    productName: pick('productName', DEFAULT_BRANDING.productName).slice(0, 40),
    tagline: pick('tagline', DEFAULT_BRANDING.tagline).slice(0, 200),
    logoDataUri: logoDataUri.safeParse(raw.logoDataUri).success ? (raw.logoDataUri as string) : null,
    accent: normaliseHex(pick('accent', DEFAULT_BRANDING.accent)) ?? DEFAULT_BRANDING.accent,
    publicUrl: publicUrl.safeParse(raw.publicUrl ?? '').success ? String(raw.publicUrl ?? '') : '',
    emailFromName: pick('emailFromName', ''),
    emailFromAddress: email.safeParse(raw.emailFromAddress ?? '').success ? String(raw.emailFromAddress ?? '') : '',
    emailReplyTo: email.safeParse(raw.emailReplyTo ?? '').success ? String(raw.emailReplyTo ?? '') : '',
    setupCompletedAt: typeof raw.setupCompletedAt === 'string' ? raw.setupCompletedAt : null,
  };
}

export async function readBranding(db: Db): Promise<Branding> {
  const rows = await db.query<{ value: unknown }>('SELECT value FROM instance_settings WHERE key = $1', [SETTINGS_KEY]);
  return normaliseBranding(rows.rows[0]?.value);
}

/**
 * Applies a wizard submission on top of what is stored. `setupCompletedAt` is
 * write-once: the wizard can be reopened to change colours without the instance
 * pretending it was never configured.
 */
export async function writeBranding(db: Db, input: BrandingInput): Promise<Branding> {
  const current = await readBranding(db);
  const next: Branding = {
    productName: input.productName,
    tagline: input.tagline,
    logoDataUri: input.logoDataUri,
    accent: normaliseHex(input.accent) ?? DEFAULT_BRANDING.accent,
    publicUrl: input.publicUrl,
    emailFromName: input.emailFromName,
    emailFromAddress: input.emailFromAddress,
    emailReplyTo: input.emailReplyTo,
    setupCompletedAt: current.setupCompletedAt ?? (input.completeSetup ? new Date().toISOString() : null),
  };
  await db.query(
    `INSERT INTO instance_settings(key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [SETTINGS_KEY, JSON.stringify(next)],
  );
  return next;
}
