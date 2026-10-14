/**
 * Light, dark, or the system's. An explicit choice sets data-theme on <html>
 * and persists under the key public/theme.js reads before first paint.
 */
import { useSyncExternalStore } from 'react';
import { readStored, writeStored } from './utils';

export type ThemeChoice = 'light' | 'dark' | 'system';
const KEY = 'reviewdesk-theme';
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
const listeners = new Set<() => void>();

function readChoice(): ThemeChoice {
  const stored = readStored(KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

let choice = readChoice();

function snapshot() {
  const resolved: 'light' | 'dark' = choice === 'system' ? (media?.matches ? 'dark' : 'light') : choice;
  return `${choice}:${resolved}`;
}

media?.addEventListener('change', () => {
  for (const listener of listeners) listener();
});

export function setTheme(next: ThemeChoice) {
  choice = next;
  if (next === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = next;
  writeStored(KEY, next === 'system' ? null : next);
  for (const listener of listeners) listener();
}

export function useTheme() {
  const value = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot,
  );
  const [current, resolved] = value.split(':') as [ThemeChoice, 'light' | 'dark'];
  return {
    choice: current,
    resolved,
    setTheme,
    toggle: () => setTheme(resolved === 'dark' ? 'light' : 'dark'),
  };
}
