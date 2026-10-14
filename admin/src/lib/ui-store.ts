/**
 * Which overlay is open. One at a time, opened from anywhere (a button, the
 * palette, a keyboard shortcut) without reaching into the DOM. The board's
 * ticket sheet is not here: it is a route (#/p/…/t/…).
 */
import { useSyncExternalStore } from 'react';
import type { TicketFilters } from './queries';

export type Overlay =
  | { kind: 'guide' }
  | { kind: 'project'; projectId?: string }
  | { kind: 'install'; projectId: string }
  | { kind: 'agents'; projectId?: string }
  | { kind: 'branding' }
  | { kind: 'fix'; ticketId: string }
  | { kind: 'export'; filters: TicketFilters }
  | { kind: 'palette' };

let current: Overlay | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function openOverlay(overlay: Overlay) {
  current = overlay;
  emit();
}

export function closeOverlay() {
  current = null;
  emit();
}

export function useOverlay() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
