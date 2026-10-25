/**
 * The signed-in frame: a left rail (brand, search, navigation, projects,
 * account) and a top bar (drawer button, breadcrumb carrying the page's h1).
 * Under 900 px the rail becomes a sheet. Pages render in <main> through the
 * router's <Outlet/>; overlays through <OverlayHost/>.
 */
import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { Bot, ChevronsUpDown, Inbox, LayoutDashboard, LogOut, Menu, Monitor, Moon, Palette, Plus, Search, Sun } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Kbd } from '@/components/ui/kbd';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useSession } from '@/features/auth/session';
import { useBranding } from '@/features/branding/branding-provider';
import { projectHue } from '@/lib/format';
import { projectsQuery } from '@/lib/queries';
import { useTheme, type ThemeChoice } from '@/lib/theme';
import { openOverlay } from '@/lib/ui-store';
import { cn, modKey } from '@/lib/utils';
import { projectParam } from '@/router';
import { BrandMark, Wordmark } from './brand-mark';
import { OverlayHost } from './overlay-host';
import { VersionNote } from './version-note';

const HUE_CLASS = ['bg-[var(--hue-0)]', 'bg-[var(--hue-1)]', 'bg-[var(--hue-2)]', 'bg-[var(--hue-3)]', 'bg-[var(--hue-4)]', 'bg-[var(--hue-5)]'];

type Route = { kind: 'home' } | { kind: 'project'; projectId: string; stats: boolean } | { kind: 'other' };

function parseRoute(pathname: string): Route {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] === 'p' && parts[1]) return { kind: 'project', projectId: decodeURIComponent(parts[1]), stats: parts[2] === 'stats' };
  if (parts[0] === 'projets') return { kind: 'home' };
  return { kind: 'other' };
}

const itemClass =
  'group flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-[13.5px] font-medium text-sidebar-foreground/80 transition-colors outline-none hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-[3px] focus-visible:ring-ring data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground data-[active=true]:[&_svg]:text-sidebar-foreground';

function Count({ value }: { value: number }) {
  if (value <= 0) return null;
  return (
    <span className="ml-auto min-w-5 rounded-full bg-background px-1.5 text-center text-[11px] leading-5 font-medium text-muted-foreground tabular-nums shadow-1 ring-1 ring-border">
      {value}
    </span>
  );
}

const THEMES: { value: ThemeChoice; label: string; icon: ReactNode }[] = [
  { value: 'light', label: 'Clair', icon: <Sun /> },
  { value: 'dark', label: 'Sombre', icon: <Moon /> },
  { value: 'system', label: 'Auto', icon: <Monitor /> },
];

function AccountMenu() {
  const { logout } = useSession();
  const { choice, setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Menu du compte"
          className="flex h-11 w-full items-center gap-2.5 rounded-md px-2 text-left outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-ring data-[state=open]:bg-sidebar-accent"
        >
          <Avatar className="size-7">
            <AvatarFallback className="bg-primary text-[11px] text-primary-foreground">A</AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] leading-tight font-medium">Administrateur</span>
            <span className="block truncate text-[11.5px] leading-tight text-muted-foreground">Compte</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-64">
        <DropdownMenuItem onSelect={() => openOverlay({ kind: 'palette' })}>
          <Search />
          Palette de commandes
          <DropdownMenuShortcut className="whitespace-nowrap">{modKey} K</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Thème</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={choice} onValueChange={(value) => setTheme(value as ThemeChoice)}>
          {THEMES.map((theme) => (
            // The menu stays open so the themes can be compared.
            <DropdownMenuRadioItem key={theme.value} value={theme.value} onSelect={(event) => event.preventDefault()}>
              {theme.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void logout().catch(() => undefined)}>
          <LogOut />
          Se déconnecter
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SidebarNav({ route, onNavigate }: { route: Route; onNavigate: () => void }) {
  const { data: projects, isPending, isError } = useQuery(projectsQuery);
  const todoTotal = (projects ?? []).reduce((sum, project) => sum + project.todoCount, 0);
  const currentProject = route.kind === 'project' && route.projectId !== 'all' ? route.projectId : undefined;
  const act = (run: () => void) => () => {
    onNavigate();
    run();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
        <BrandMark />
        <Wordmark />
      </div>

      <div className="px-3">
        <button
          type="button"
          onClick={act(() => openOverlay({ kind: 'palette' }))}
          className="flex h-8 w-full items-center gap-2 rounded-md border border-border-strong bg-background px-2.5 text-[13px] text-muted-foreground shadow-1 outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring"
        >
          <Search className="size-3.5" />
          <span>Rechercher…</span>
          <Kbd className="ml-auto">{modKey} K</Kbd>
        </button>
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
        <nav aria-label="Navigation principale" className="flex flex-col gap-0.5 px-3 pb-3">
          <Link to="/projets" className={itemClass} data-active={route.kind === 'home'} onClick={onNavigate}>
            <LayoutDashboard />
            Tableau de bord
          </Link>
          <Link
            to="/p/$projectId"
            params={{ projectId: 'all' }}
            className={itemClass}
            data-active={route.kind === 'project' && route.projectId === 'all'}
            onClick={onNavigate}
          >
            <Inbox />
            Tous les retours
            <Count value={todoTotal} />
          </Link>
          <button type="button" className={itemClass} onClick={act(() => openOverlay({ kind: 'agents', projectId: currentProject }))}>
            <Bot />
            Agents IA
          </button>
          <button type="button" className={itemClass} onClick={act(() => openOverlay({ kind: 'branding' }))}>
            <Palette />
            Personnalisation
          </button>

          <div className="mt-5 mb-1 flex items-center justify-between pr-0.5 pl-2">
            <span className="text-[11.5px] font-medium tracking-wide text-muted-foreground uppercase">Projets</span>
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-6 text-muted-foreground"
              aria-label="＋ Nouveau projet"
              title="Nouveau projet"
              onClick={act(() => openOverlay({ kind: 'guide' }))}
            >
              <Plus />
            </Button>
          </div>

          {isPending && (
            <div className="flex flex-col gap-1.5 px-2 py-1" aria-busy="true">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-4/5" />
              <Skeleton className="h-5 w-3/5" />
            </div>
          )}
          {isError && <p className="px-2 py-1 text-[12.5px] text-muted-foreground">Projets indisponibles.</p>}
          {projects?.length === 0 && <p className="px-2 py-1 text-[12.5px] text-muted-foreground">Aucun projet pour l’instant.</p>}
          {projects?.map((project) => (
            <Link
              key={project.id}
              to="/p/$projectId"
              params={{ projectId: projectParam(project.id) }}
              className={itemClass}
              data-active={route.kind === 'project' && route.projectId === project.id}
              aria-label={project.name}
              title={`${project.name} — ${project.clientLabel} · ${project.todoCount} à traiter`}
              onClick={onNavigate}
            >
              <span aria-hidden className={cn('size-2.5 shrink-0 rounded-full', HUE_CLASS[projectHue(project.id)])} />
              <span className="truncate">{project.name}</span>
              <Count value={project.todoCount} />
            </Link>
          ))}
        </nav>
      </div>

      <div className="shrink-0 border-t border-sidebar-border p-3">
        <AccountMenu />
        <VersionNote />
      </div>
    </div>
  );
}

function Crumbs({ route }: { route: Route }) {
  const { productName } = useBranding();
  const { data: projects } = useQuery(projectsQuery);
  let title = productName;
  if (route.kind === 'home') title = 'Bonjour';
  else if (route.kind === 'project') {
    title = route.projectId === 'all' ? 'Tous les retours' : (projects?.find((project) => project.id === route.projectId)?.name ?? 'Projet');
  }
  const isHome = route.kind === 'home';
  return (
    <nav aria-label="Fil d’Ariane" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-[13.5px]">
        {!isHome && (
          <>
            <li className="hidden shrink-0 sm:block">
              <Link to="/projets" className="rounded-sm text-muted-foreground transition-colors hover:text-foreground">
                Accueil
              </Link>
            </li>
            <li aria-hidden className="hidden text-muted-foreground/60 sm:block">
              /
            </li>
          </>
        )}
        <li className="min-w-0">
          <h1 className="truncate text-[14px] font-semibold tracking-tight" aria-current="page">
            {title}
          </h1>
        </li>
      </ol>
    </nav>
  );
}

export function AppShell() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const route = parseRoute(pathname);
  const [drawer, setDrawer] = useState(false);

  // Escape closes the drawer (Radix does it while open); a wider window drops it.
  useEffect(() => {
    const media = matchMedia('(min-width: 900px)');
    const onChange = () => media.matches && setDrawer(false);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  // ⌘/Ctrl+K opens the palette, unless some other dialog is already up.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      openOverlay({ kind: 'palette' });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-full bg-background">
      <a
        href="#main-content"
        className="sr-only z-[60] rounded-md bg-primary px-3 py-2 text-[13px] font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Aller au contenu
      </a>

      <aside className="hidden w-64 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground min-[900px]:block">
        <SidebarNav route={route} onNavigate={() => undefined} />
      </aside>

      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="left" showCloseButton={false} className="w-72 max-w-[85vw] gap-0 border-sidebar-border bg-sidebar p-0 min-[900px]:hidden">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Projets et réglages</SheetDescription>
          <SidebarNav route={route} onNavigate={() => setDrawer(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:px-6">
          <Button variant="ghost" size="icon" className="-ml-2 min-[900px]:hidden" aria-label="Ouvrir la navigation" onClick={() => setDrawer(true)}>
            <Menu />
          </Button>
          <Crumbs route={route} />
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto min-[900px]:hidden"
            aria-label="Rechercher"
            onClick={() => openOverlay({ kind: 'palette' })}
          >
            <Search />
          </Button>
        </header>
        <main id="main-content" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none">
          <Outlet />
        </main>
      </div>

      <OverlayHost />
    </div>
  );
}

