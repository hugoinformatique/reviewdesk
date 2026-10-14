import { closeOverlay } from '@/lib/ui-store';
import type { TicketFilters } from '@/lib/queries';
/** Placeholder until the feature lands. */
export function ExportDialog(_props: { filters: TicketFilters }) {
  return <button type="button" onClick={closeOverlay}>ExportDialog</button>;
}
