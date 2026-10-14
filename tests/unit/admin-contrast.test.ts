import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contrastRatio, parseHex } from '../../src/brand-tokens.js';

/**
 * The admin palette is ink on paper with three greys of text. These tests read
 * the stylesheet itself, so a token edited by eye cannot quietly drop a line of
 * text below WCAG AA, or let the two copies of the dark theme drift apart.
 */
const css = readFileSync(new URL('../../admin/src/styles.css', import.meta.url), 'utf8');

function block(pattern: RegExp, name: string): Map<string, string> {
  const body = pattern.exec(css)?.[1];
  assert.ok(body, `${name} token block not found in admin/src/styles.css`);
  const tokens = new Map<string, string>();
  for (const match of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    if (match[1] && match[2]) tokens.set(match[1], match[2].toLowerCase());
  }
  return tokens;
}

const light = block(/^:root \{([\s\S]*?)\n\}/m, 'light');
const dark = block(/^:root\[data-theme='dark'\] \{([\s\S]*?)\n\}/m, 'explicit dark');
const systemDark = block(/^ {2}:root:not\(\[data-theme='light'\]\) \{([\s\S]*?)\n {2}\}/m, 'system dark');

const TEXTS = ['foreground', 'subtle-foreground', 'muted-foreground'];
const BACKGROUNDS = ['background', 'sunken', 'card', 'muted', 'accent', 'sidebar'];

function ratio(tokens: Map<string, string>, fg: string, bg: string): number {
  const a = parseHex(tokens.get(fg) ?? '');
  const b = parseHex(tokens.get(bg) ?? '');
  if (!a || !b) throw new Error(`missing --${fg} or --${bg}`);
  return contrastRatio(a, b);
}

for (const [name, tokens] of [
  ['light', light],
  ['dark', dark],
] as const) {
  test(`every text grey clears 4.5:1 on every ${name} surface`, () => {
    for (const fg of TEXTS) {
      for (const bg of BACKGROUNDS) {
        const value = ratio(tokens, fg, bg);
        assert.ok(value >= 4.5, `--${fg} on --${bg} (${name}) is ${value.toFixed(2)}:1`);
      }
    }
  });
}

test('the system dark theme and the explicit dark theme declare the same colours', () => {
  assert.ok(dark.size > 10, 'dark block parsed');
  assert.deepEqual(Object.fromEntries(systemDark), Object.fromEntries(dark));
});

/**
 * An undeclared custom property does not fail loudly: the whole declaration is
 * dropped. The screenshot card lost its hover state that way.
 */
test('every custom property the stylesheet reads is declared', () => {
  const declared = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]));
  // Set at runtime with style.setProperty by the white-label setup.
  // Tailwind's own, and the preview's (set with style.setProperty).
  const runtime = new Set(['--swatch', '--tw-ring-color']);
  const missing = [...new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]))].filter(
    (name) => name && !declared.has(name) && !runtime.has(name),
  );
  assert.deepEqual(missing, []);
});
