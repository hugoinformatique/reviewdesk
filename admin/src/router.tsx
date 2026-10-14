/**
 * Routes. Hash history, so the addresses stay those of the legacy admin
 * (#/projets, #/p/<id|all>, #/p/<id>/stats, #/p/<id>/t/<ticket>) and the
 * server needs no fallback route: links already shared keep working.
 */
import { createHashHistory, createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { AppShell } from '@/features/shell/app-shell';
import { DashboardPage } from '@/features/dashboard/dashboard-page';
import { BoardPage } from '@/features/board/board-page';
import { TicketSheet } from '@/features/ticket/ticket-sheet';
import { OverviewPage } from '@/features/overview/overview-page';

const rootRoute = createRootRoute({ component: AppShell });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/projets', replace: true });
  },
});

export const dashboardRoute = createRoute({ getParentRoute: () => rootRoute, path: '/projets', component: DashboardPage });

/** `projectId` is a project's id, or `all` for every project. */
export const boardRoute = createRoute({ getParentRoute: () => rootRoute, path: '/p/$projectId', component: BoardPage });

export const ticketRoute = createRoute({ getParentRoute: () => boardRoute, path: 't/$ticketId', component: TicketSheet });

export const overviewRoute = createRoute({ getParentRoute: () => rootRoute, path: '/p/$projectId/stats', component: OverviewPage });

const routeTree = rootRoute.addChildren([indexRoute, dashboardRoute, boardRoute.addChildren([ticketRoute]), overviewRoute]);

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: false,
  // Anything unknown goes home, as the legacy router did.
  notFoundMode: 'root',
  defaultNotFoundComponent: () => {
    throw redirect({ to: '/projets', replace: true });
  },
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

/** Project id of a route param: '' for every project. */
export const projectIdOf = (param: string) => (param === 'all' ? '' : param);
export const projectParam = (projectId: string) => projectId || 'all';
