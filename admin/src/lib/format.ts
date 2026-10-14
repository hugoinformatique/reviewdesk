/** Formatting shared by every screen: French, the way the legacy admin read. */
import type { Stats, Ticket } from './types';

const dateFormat = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const relative = new Intl.RelativeTimeFormat('fr-FR', { numeric: 'auto' });

export const formatDate = (value: string) => dateFormat.format(new Date(value));
/** A calendar day, without the hour nobody reads on a chart axis. */
export const formatDay = (value: string) => dayFormat.format(new Date(value));

/** Scannable age for list rows; keep the exact timestamp in a `title`. */
export function formatAge(value: string, now = Date.now()) {
  const seconds = (new Date(value).getTime() - now) / 1000;
  const age = Math.abs(seconds);
  if (age < 60) return 'à l’instant';
  if (age < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (age < 86_400) return relative.format(Math.round(seconds / 3600), 'hour');
  if (age < 604_800) return relative.format(Math.round(seconds / 86_400), 'day');
  return formatDate(value);
}

/** A duration read without converting: « 3 h 20 », « 2,5 j ». */
export function humanDuration(seconds: number): string {
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`;
  if (seconds < 86_400) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    return minutes ? `${hours} h ${String(minutes).padStart(2, '0')}` : `${hours} h`;
  }
  const days = seconds / 86_400;
  return days < 10 ? `${days.toFixed(1).replace('.', ',')} j` : `${Math.round(days)} j`;
}

/** « 1 retour », « 3 retours ». */
export function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

export function deltaNote(current: number, previous: number, days: number): { text: string; tone: 'plain' | 'up' | 'down' } {
  const period = `vs ${days} j précédents`;
  if (!previous && !current) return { text: `aucun, ${period}`, tone: 'plain' };
  if (!previous) return { text: `aucun sur les ${days} j précédents`, tone: 'plain' };
  const change = Math.round(((current - previous) / previous) * 100);
  if (change === 0) return { text: `stable, ${period}`, tone: 'plain' };
  return { text: `${change > 0 ? '+' : '−'}${Math.abs(change)} % ${period}`, tone: change > 0 ? 'up' : 'down' };
}

/** The period's days as the server keys them: UTC, YYYY-MM-DD, oldest first. */
export function periodDays(stats: Pick<Stats, 'days'>, now = Date.now()) {
  const days: string[] = [];
  for (let index = stats.days - 1; index >= 0; index--) days.push(new Date(now - index * 86_400_000).toISOString().slice(0, 10));
  return days;
}

/** A stable hue (0-5) per project, so it wears the same colour everywhere. */
export function projectHue(id: string) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 6;
}

/** Path of a page URL; a malformed URL (reviewer input) falls back to itself. */
export function pagePath(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.pathname || "/";
  } catch {
    return url;
  }
}

export function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export const isMobileViewport = (ticket: Pick<Ticket, 'viewportWidth'>) => ticket.viewportWidth < 768;

/**
 * Deep link back to the exact spot. The anchor rides in the fragment: never
 * sent to the client's server, out of its logs and Referer headers. No
 * reviewer token, ever.
 */
export function anchorUrl(ticket: Pick<Ticket, 'pageUrl' | 'anchor'>) {
  const payload = JSON.stringify({ selector: ticket.anchor.selector, relative: ticket.anchor.relative });
  return `${ticket.pageUrl}#rd-anchor=${encodeURIComponent(payload)}`;
}

/**
 * Normalises what someone types as a site address to its origin. Without a
 * scheme, a local address means http and anything else https; a bare word is
 * a typo, not a site.
 */
export function toOrigin(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const explicit = /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
  try {
    const local = /^(localhost|127\.|\[?::1|\d+\.\d+\.\d+\.\d+)/i.test(value);
    const url = new URL(explicit ? value : `${local ? 'http' : 'https'}://${value}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!explicit && !url.hostname.includes('.') && url.hostname !== 'localhost') return null;
    return url.origin;
  } catch {
    return null;
  }
}
