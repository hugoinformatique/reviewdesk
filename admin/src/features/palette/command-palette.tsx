/**
 * Command palette (⌘K / Ctrl+K): one field that reaches every view, project,
 * recent ticket and action without leaving the keyboard. Built on cmdk through
 * the project's command primitives (structure after 21st.dev « Command
 * Palette » #2075); the search is accent- and case-insensitive and every word
 * must be found in label + hint + keywords + group, as in the legacy palette.
 * Ticket text is reviewer input: it only ever reaches the DOM as a React text node.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useQueryClient, useQuery, type InfiniteData } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import {
  BotIcon,
  ClipboardCopyIcon,
  CodeXmlIcon,
  InboxIcon,
  LayoutGridIcon,
  LogOutIcon,
  MoonIcon,
  PaletteIcon,
  PlusIcon,
  SunIcon,
  TrendingUpIcon,
} from 'lucide-react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useSession } from '@/features/auth/session';
import { projectHue } from '@/lib/format';
import { projectsQuery } from '@/lib/queries';
import { useTheme } from '@/lib/theme';
import { STATUS_LABELS, type TicketPage } from '@/lib/types';
import { closeOverlay, openOverlay } from '@/lib/ui-store';
import { cn } from '@/lib/utils';
import { projectParam } from '@/router';

const HUE_BG = ['bg-[var(--hue-0)]', 'bg-[var(--hue-1)]', 'bg-[var(--hue-2)]', 'bg-[var(--hue-3)]', 'bg-[var(--hue-4)]', 'bg-[var(--hue-5)]'];

/** Case- and accent-insensitive, so "reglages" finds "Réglages". */
const fold = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** cmdk filter: 1 when every typed word appears in the item's folded text, else 0. */
function filter(_value: string, search: string, keywords?: string[]) {
  const words = fold(search.trim()).split(/\s+/).filter(Boolean);
  const haystack = fold((keywords ?? []).join(' '));
  return words.every((word) => haystack.includes(word)) ? 1 : 0;
}

type Entry = {
  id: string;
  group: 'Navigation' | 'Projets' | 'Retours' | 'Actions';
  label: string;
  hint?: string;
  keywords?: string;
  leading: ReactNode;
  run: () => void;
};

const tile = (icon: ReactNode) => (
  <span className="grid size-6 shrink-0 place-items-center rounded-md border border-border bg-background text-muted-foreground [&_svg]:size-3.5">{icon}</span>
);

function Avatar({ id, name }: { id: string; name: string }) {
  if (!id) return tile(<LayoutGridIcon aria-hidden="true" />);
  return (
    <span
      aria-hidden="true"
      className={cn('grid size-6 shrink-0 place-items-center rounded-md text-[11px] font-semibold text-white', HUE_BG[projectHue(id)])}
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

export function CommandPalette() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const session = useSession();
  const theme = useTheme();
  const params = useParams({ strict: false }) as { projectId?: string };
  const current = params.projectId && params.projectId !== 'all' ? params.projectId : '';
  const projectsData = useQuery(projectsQuery).data;
  const [search, setSearch] = useState('');

  // The list is rebuilt each time the palette opens (it mounts open), from the
  // tickets the board already loaded: nothing is fetched for it.
  const tickets = useMemo(() => {
    const seen = new Map<string, TicketPage['tickets'][number]>();
    for (const [, data] of client.getQueriesData<InfiniteData<TicketPage>>({ queryKey: ['tickets', 'column'] })) {
      for (const page of data?.pages ?? []) for (const ticket of page.tickets) seen.set(ticket.id, ticket);
    }
    return [...seen.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30);
  }, [client]);

  const entries = useMemo<Entry[]>(() => {
    const projects = projectsData ?? [];
    // Close first, then act: the palette is an overlay of its own.
    const go = (to: () => void) => () => {
      closeOverlay();
      to();
    };
    const items: Entry[] = [
      {
        id: 'nav-dashboard',
        group: 'Navigation',
        label: 'Tableau de bord',
        keywords: 'accueil home mes projets',
        leading: tile(<LayoutGridIcon aria-hidden="true" />),
        run: go(() => void navigate({ to: '/projets' })),
      },
      {
        id: 'nav-overview',
        group: 'Navigation',
        label: 'Vue d’ensemble',
        keywords: 'statistiques tableau de bord',
        leading: tile(<TrendingUpIcon aria-hidden="true" />),
        run: go(() => void navigate({ to: '/p/$projectId/stats', params: { projectId: projectParam(current) } })),
      },
      {
        id: 'nav-tickets',
        group: 'Navigation',
        label: 'Retours',
        keywords: 'tickets liste inbox',
        leading: tile(<InboxIcon aria-hidden="true" />),
        run: go(() => void navigate({ to: '/p/$projectId', params: { projectId: projectParam(current) } })),
      },
      {
        id: 'project-all',
        group: 'Projets',
        label: 'Tous les projets',
        hint: `${projects.length} projet${projects.length === 1 ? '' : 's'}`,
        leading: <Avatar id="" name="" />,
        run: go(() => void navigate({ to: '/p/$projectId', params: { projectId: 'all' } })),
      },
      ...projects.map<Entry>((project) => ({
        id: `project-${project.id}`,
        group: 'Projets',
        label: project.name,
        hint: project.clientLabel,
        leading: <Avatar id={project.id} name={project.name} />,
        run: go(() => void navigate({ to: '/p/$projectId', params: { projectId: project.id } })),
      })),
      ...tickets.map<Entry>((ticket) => ({
        id: `ticket-${ticket.id}`,
        group: 'Retours',
        label: ticket.text,
        hint: STATUS_LABELS[ticket.status] ?? ticket.status,
        keywords: `${ticket.projectName} ${ticket.pageUrl}`,
        leading: <Avatar id={ticket.projectId} name={ticket.projectName} />,
        run: go(() => void navigate({ to: '/p/$projectId/t/$ticketId', params: { projectId: ticket.projectId, ticketId: ticket.id } })),
      })),
      {
        id: 'action-project',
        group: 'Actions',
        label: 'Nouveau projet',
        keywords: 'creer ajouter',
        leading: tile(<PlusIcon aria-hidden="true" />),
        run: go(() => openOverlay({ kind: 'guide' })),
      },
    ];
    if (current) {
      items.push({
        id: 'action-install',
        group: 'Actions',
        label: 'Installer le widget et liens reviewer',
        keywords: 'integration script snippet partager',
        leading: tile(<CodeXmlIcon aria-hidden="true" />),
        run: go(() => openOverlay({ kind: 'install', projectId: current })),
      });
    }
    items.push({
      id: 'action-agents',
      group: 'Actions',
      label: 'Agents IA (MCP et API)',
      keywords: 'acces agents claude cursor mcp ia',
      leading: tile(<BotIcon aria-hidden="true" />),
      run: go(() => openOverlay({ kind: 'agents', projectId: current || undefined })),
    });
    if (current) {
      items.push({
        id: 'action-export',
        group: 'Actions',
        label: 'Exporter pour Claude Code',
        keywords: 'prompt markdown',
        leading: tile(<ClipboardCopyIcon aria-hidden="true" />),
        run: go(() => openOverlay({ kind: 'export', filters: { projectId: current, page: '', format: '', client: '' } })),
      });
    }
    items.push(
      {
        id: 'action-branding',
        group: 'Actions',
        label: 'Personnalisation de l’instance',
        keywords: 'marque blanche logo couleur branding',
        leading: tile(<PaletteIcon aria-hidden="true" />),
        run: go(() => openOverlay({ kind: 'branding' })),
      },
      {
        id: 'action-theme',
        group: 'Actions',
        label: 'Basculer le thème clair / sombre',
        keywords: 'dark mode nuit',
        leading: tile(theme.resolved === 'dark' ? <SunIcon aria-hidden="true" /> : <MoonIcon aria-hidden="true" />),
        run: go(theme.toggle),
      },
      {
        id: 'action-logout',
        group: 'Actions',
        label: 'Se déconnecter',
        keywords: 'logout quitter',
        leading: tile(<LogOutIcon aria-hidden="true" />),
        run: go(() => void session.logout()),
      },
    );
    return items;
  }, [current, navigate, projectsData, session, theme, tickets]);

  const groups = (['Navigation', 'Projets', 'Retours', 'Actions'] as const).map((name) => ({
    name,
    items: entries.filter((entry) => entry.group === name),
  }));

  return (
    <Dialog open onOpenChange={(open) => !open && closeOverlay()}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-xl" showCloseButton={false}>
        <DialogHeader className="sr-only">
          <DialogTitle>Palette de commandes</DialogTitle>
          <DialogDescription>Rechercher une vue, un projet, un retour ou une action</DialogDescription>
        </DialogHeader>
        <Command
          filter={filter}
          loop
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]]:px-1 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-1.5"
        >
          <CommandInput value={search} onValueChange={setSearch} placeholder="Rechercher un projet, un retour, une action…" />
          <CommandList className="max-h-[min(24rem,60dvh)]">
            <CommandEmpty>Aucun résultat.</CommandEmpty>
            {groups.map(
              (group) =>
                group.items.length > 0 && (
                  <CommandGroup key={group.name} heading={group.name}>
                    {group.items.map((entry) => (
                      <CommandItem
                        key={entry.id}
                        value={entry.id}
                        keywords={[entry.label, entry.hint ?? '', entry.keywords ?? '', entry.group]}
                        onSelect={entry.run}
                      >
                        {entry.leading}
                        <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                        {entry.hint && <span className="shrink-0 text-xs text-muted-foreground">{entry.hint}</span>}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ),
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
