import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { api, qs } from '@/lib/api';
import { anchorUrl, formatDate } from '@/lib/format';
import { projectsQuery, type TicketFilters } from '@/lib/queries';
import { closeOverlay } from '@/lib/ui-store';
import type { Project, Ticket, TicketPage } from '@/lib/types';
import { copyText } from '@/lib/clipboard';

const EXPORT_PAGE = 200;
const EXPORT_MAX = 400;

/** Every ticket still to triage under the filters, oldest first, capped at 400. */
async function fetchPending(filters: TicketFilters, signal: AbortSignal) {
  const base = {
    projectId: filters.projectId,
    page: filters.page.trim().slice(0, 120),
    format: filters.format,
    client: filters.projectId ? '' : filters.client,
    status: 'TODO',
    limit: EXPORT_PAGE,
  };
  const collected: Ticket[] = [];
  let cursor: string | null = null;
  do {
    const payload: TicketPage = await api<TicketPage>(`/api/tickets${qs({ ...base, cursor })}`, { signal });
    collected.push(...payload.tickets);
    cursor = payload.nextCursor;
  } while (cursor && collected.length < EXPORT_MAX);
  // Newest first from the server; a worklist reads better oldest first.
  return { tickets: collected.slice(0, EXPORT_MAX).reverse(), truncated: Boolean(cursor) };
}

function filterLabels(filters: TicketFilters, projects: Project[] | undefined) {
  const labels: string[] = [];
  const project = projects?.find((candidate) => candidate.id === filters.projectId);
  if (project) labels.push(`projet « ${project.name} » (${project.clientLabel})`);
  if (filters.client && !filters.projectId) labels.push(`client « ${filters.client} »`);
  if (filters.page.trim()) labels.push(`pages contenant « ${filters.page.trim()} »`);
  if (filters.format) labels.push(filters.format === 'mobile' ? 'format mobile' : 'format desktop');
  return labels;
}

function diagnosticsLine(diagnostics: Record<string, unknown>) {
  const parts = Object.entries(diagnostics)
    .filter(([, value]) => value !== 'Unknown' && value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${key} ${Array.isArray(value) ? value.join(', ') : String(value)}`);
  return parts.length ? parts.join(' · ') : 'non transmis';
}

function ticketBlock(ticket: Ticket, index: number) {
  const { selector, relative: point, viewport } = ticket.anchor;
  const format = ticket.viewportWidth < 768 ? 'Mobile' : 'Desktop';
  const lines = [
    `## ${index}. « ${ticket.text.trim()} »`,
    '',
    `- Projet : ${ticket.projectName} (${ticket.clientLabel})`,
    `- Page : ${ticket.pageUrl}`,
    `- Élément visé : \`${selector}\` — clic à ${Math.round(point.x * 100)} %, ${Math.round(point.y * 100)} % de l’élément`,
    `- Écran du reviewer : ${viewport.width}×${viewport.height} (${format})`,
    `- Environnement : ${diagnosticsLine(ticket.diagnostics)}`,
    `- Reçu le ${formatDate(ticket.createdAt)} · ticket ${ticket.id}`,
    // Never a reviewer token: the anchor rides in the fragment.
    `- Rouvrir à l’ancrage : ${anchorUrl(ticket)}`,
  ];
  // Absolute: the prompt is read outside this page, where a /api/… path means nothing.
  if (ticket.screenshotId) lines.push(`- Capture (accès admin requis) : ${location.origin}/api/uploads/${ticket.screenshotId}`);
  if (ticket.response.trim()) lines.push(`- Note interne : ${ticket.response.trim()}`);
  return lines.join('\n');
}

function buildPrompt(tickets: Ticket[], truncated: boolean, filters: string[]) {
  const head = [
    `# ${tickets.length} retour${tickets.length === 1 ? '' : 's'} client à traiter`,
    '',
    filters.length ? `Périmètre : ${filters.join(', ')}.` : 'Périmètre : tous les projets.',
    `Export ReviewDesk du ${formatDate(new Date().toISOString())}.`,
    '',
    'Chaque retour ci-dessous vient d’un client qui a cliqué un élément précis de la page :',
    'le sélecteur CSS désigne cet élément, les pourcentages situent le point cliqué à',
    'l’intérieur de celui-ci. Traite-les un par un, en commençant par ceux qui touchent',
    'la même page ou le même composant, et dis pour chacun ce que tu as changé.',
  ];
  if (truncated) head.push('', `_Seuls les ${EXPORT_MAX} plus anciens retours sont inclus : filtrez par projet pour le reste._`);
  return [head.join('\n'), ...tickets.map((ticket, index) => ticketBlock(ticket, index + 1))].join('\n\n---\n\n') + '\n';
}

export function ExportDialog({ filters }: { filters: TicketFilters }) {
  const projects = useQuery(projectsQuery);
  const pending = useQuery({
    queryKey: ['export', filters],
    queryFn: ({ signal }) => fetchPending(filters, signal),
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!pending.isError) return;
    toast.error('Export impossible.');
    closeOverlay();
  }, [pending.isError]);

  const result = pending.data;
  const text = result && result.tickets.length ? buildPrompt(result.tickets, result.truncated, filterLabels(filters, projects.data)) : '';

  const copy = async () => {
    if (await copyText(text)) {
      toast.success('Prompt copié.');
    } else {
      area.current?.focus();
      area.current?.select();
      toast.error('Copie automatique refusée : le texte est sélectionné, faites Ctrl+C.');
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && closeOverlay()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Exporter pour Claude Code</DialogTitle>
          <DialogDescription aria-live="polite">
            {pending.isPending
              ? 'Préparation de l’export…'
              : !result || result.tickets.length === 0
                ? 'Aucun retour « À traiter » sous ces filtres. Rien à exporter.'
                : `${result.tickets.length} retour${result.tickets.length === 1 ? '' : 's'} « À traiter »${result.truncated ? ` (limité à ${EXPORT_MAX})` : ''} — collez ce bloc tel quel dans Claude Code.`}
          </DialogDescription>
        </DialogHeader>
        {pending.isPending ? (
          <Skeleton className="h-72 w-full" />
        ) : (
          <Textarea
            ref={area}
            readOnly
            aria-label="Prompt à copier"
            value={text}
            className="h-72 resize-none font-mono text-xs leading-relaxed"
            onFocus={(event) => event.currentTarget.select()}
          />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={closeOverlay}>
            Fermer
          </Button>
          <Button disabled={!text} onClick={() => void copy()}>
            <Copy />
            Copier le prompt
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
