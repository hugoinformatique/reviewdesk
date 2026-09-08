import { createHash, timingSafeEqual } from 'node:crypto';

export const hashToken = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Compares two secrets in constant time by comparing their fixed-width digests. */
export function secretsMatch(a: string, b: string): boolean {
  return timingSafeEqual(Buffer.from(hashToken(a), 'hex'), Buffer.from(hashToken(b), 'hex'));
}

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

/**
 * Content sniffing from magic bytes. The declared multipart content-type is
 * attacker-controlled, so the stored MIME is derived from the bytes instead and
 * the two must agree. SVG has no magic number and is deliberately unsupported:
 * it is an active document, not a raster capture.
 */
export function detectImageMime(data: Buffer): ImageMime | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString('latin1') === 'RIFF' &&
    data.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export const IMAGE_EXTENSIONS: Record<ImageMime, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

/** Exact-origin match. Never a substring or suffix test. */
export function originAllowed(allowed: readonly string[], origin: string | undefined): origin is string {
  return typeof origin === 'string' && origin !== 'null' && allowed.includes(origin);
}

type Headers = Record<string, string | string[] | undefined>;

const single = (headers: Headers, name: string): string | undefined => {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
};

/**
 * The origin this instance is answering on, derived from the forwarding headers
 * a platform proxy sets. Used only to reject cross-site admin writes, never to
 * grant access, so a spoofed value cannot widen anything.
 */
export function selfOrigin(headers: Headers): string | undefined {
  const host = single(headers, 'x-forwarded-host') ?? single(headers, 'host');
  if (!host) return undefined;
  const proto = single(headers, 'x-forwarded-proto')?.split(',')[0]?.trim() ?? 'http';
  return `${proto}://${host}`;
}

/**
 * Cross-site request detection for admin writes, layered under the CSRF token
 * and the SameSite=Strict cookie. `Sec-Fetch-Site` is authoritative when the
 * browser sends it; otherwise `Origin` is compared to the served origin.
 */
export function isCrossSiteWrite(headers: Headers): boolean {
  const fetchSite = single(headers, 'sec-fetch-site');
  if (fetchSite) return fetchSite !== 'same-origin' && fetchSite !== 'none';
  const origin = single(headers, 'origin');
  if (!origin) return false;
  return origin !== selfOrigin(headers);
}

/** Escapes the LIKE metacharacters so a filter cannot become a wildcard scan. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export type SecurityHeaderOptions = { https: boolean; contentSecurityPolicy: string };

export const ADMIN_CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

/** `no-store` plus a policy that forbids the stored bytes from executing. */
export const UPLOAD_CONTENT_SECURITY_POLICY = "default-src 'none'; sandbox";

export function securityHeaders(options: SecurityHeaderOptions): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
    'Content-Security-Policy': options.contentSecurityPolicy,
    ...(options.https ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
  };
}
