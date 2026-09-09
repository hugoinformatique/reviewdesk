export type DiagnosticError = { category: string; code: string; count: number; message?: string };
export type Diagnostics = {
  viewport?: { width: number; height: number };
  dpr?: number;
  orientation?: 'portrait' | 'landscape';
  locale?: string;
  timezone?: string;
  browser?: string;
  os?: string;
  path?: string;
  errors?: DiagnosticError[];
};

const bounded = (value: unknown, max = 80) => typeof value === 'string' ? value.slice(0, max) : undefined;
export function cleanUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, raw.includes(url.pathname + '/') ? '/' : '');
  } catch { return ''; }
}
function coarseBrowser(ua: string): string {
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Unknown';
}
function coarseOs(platform: string): string {
  if (/Mac/i.test(platform)) return 'macOS';
  if (/Win/i.test(platform)) return 'Windows';
  if (/Linux/i.test(platform)) return 'Linux';
  if (/iPhone|iPad/i.test(platform)) return 'iOS';
  return 'Unknown';
}
export function normalizeDiagnostics(input: Record<string, unknown>): Diagnostics {
  const out: Diagnostics = {};
  const vp = input.viewport as Record<string, unknown> | undefined;
  if (vp && Number.isFinite(vp.width) && Number.isFinite(vp.height)) out.viewport = { width: Math.round(Number(vp.width)), height: Math.round(Number(vp.height)) };
  if (Number.isFinite(input.dpr)) out.dpr = Math.min(4, Math.max(1, Number(input.dpr)));
  if (input.orientation === 'portrait' || input.orientation === 'landscape') out.orientation = input.orientation;
  out.locale = bounded(input.locale, 20);
  out.timezone = bounded(input.timezone, 50);
  const browserInput = bounded(input.browser, 16);
  const osInput = bounded(input.os, 16);
  out.browser = browserInput && ['Chrome','Firefox','Safari','Edge','Unknown'].includes(browserInput) ? browserInput : coarseBrowser(String(input.userAgent ?? ''));
  out.os = osInput && ['macOS','Windows','Linux','iOS','Android','Unknown'].includes(osInput) ? osInput : coarseOs(String(input.platform ?? ''));
  if (typeof input.path === 'string') out.path = cleanUrl(input.path);
  const allowedErrors = new Set(['widget:ANCHOR_MISSING','widget:UPLOAD_FAILED','widget:SEND_FAILED','network:TIMEOUT']);
  if (Array.isArray(input.errors)) out.errors = input.errors.slice(0, 10).flatMap((raw) => {
    const e = raw as Record<string, unknown>;
    const category = bounded(e.category, 24), code = bounded(e.code, 32);
    if (!category || !code || !allowedErrors.has(`${category}:${code}`) || !Number.isFinite(e.count)) return [];
    const rawMessage = bounded(e.message, 120);
    const message = rawMessage && /token|bearer|password|secret|cookie|[A-Za-z0-9_-]{20,}/i.test(rawMessage) ? '[redacted]' : rawMessage;
    return [{ category, code, count: Math.min(100, Math.max(1, Math.floor(Number(e.count)))), ...(message ? { message } : {}) }];
  });
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as Diagnostics;
}
