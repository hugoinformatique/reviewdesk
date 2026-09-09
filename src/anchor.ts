export type Anchor = { selector: string; relative: { x: number; y: number }; viewport: { width: number; height: number } };
type ElementLike = { tagName: string; id: string; classList: Iterable<string>; parentPath: string; rect: { left: number; top: number; width: number; height: number } };
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const escapeSelector = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, c => `\\${c.codePointAt(0)!.toString(16)} `);
export function buildAnchor(el: ElementLike, clientX: number, clientY: number, viewport: { width: number; height: number }): Anchor {
  const tag = el.tagName.toLowerCase();
  const classes = [...el.classList].filter((c) => /^[a-zA-Z][\w-]*$/.test(c) && !/active|hover|focus/.test(c)).slice(0, 2);
  const selector = el.id ? `#${escapeSelector(el.id)}` : `${el.parentPath}>${tag}${classes.map(c => `.${escapeSelector(c)}`).join('')}`;
  return { selector, relative: { x: clamp((clientX - el.rect.left) / Math.max(1, el.rect.width)), y: clamp((clientY - el.rect.top) / Math.max(1, el.rect.height)) }, viewport };
}
export function resolveAnchor(anchor: Anchor, lookup: (selector: string) => { getBoundingClientRect(): { left: number; top: number; width: number; height: number } } | null) {
  const el = lookup(anchor.selector);
  if (!el) return { found: false as const, reason: 'ANCHOR_MISSING' as const };
  const r = el.getBoundingClientRect();
  return { found: true as const, x: r.left + r.width * anchor.relative.x, y: r.top + r.height * anchor.relative.y };
}
