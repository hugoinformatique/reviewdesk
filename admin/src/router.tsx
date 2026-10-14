/**
 * Routes. Hash history, so the addresses stay those of the legacy admin
 * (#/projets, #/p/<id|all>, #/p/<id>/stats, #/p/<id>/t/<ticket>) and the
 * server needs no fallback route: links already shared keep working.
 */
import { createHashHistory, createRootRoute, createRoute, createRouter, lazyRouteComponent, redirect } from '@tanstack/react-router';
import { AppShell } from '@/features/shell/app-shell';
import { RouteFallback } from '@/features/shell/route-fallback';

const rootRoute = createRootRoute({ component: AppShell });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/projets', replace: true });
  },
});

export const dashboardRoute = createRoute({ getParentRoute: () => rootRoute, path: '/projets', component: lazyRouteComponent(() => import('@/features/dashboard/dashboard-page'), 'DashboardPage'), pendingComponent: RouteFallback });

/** `projectId` is a project's id, or `all` for every project. */
export const boardRoute = createRoute({ getParentRoute: () => rootRoute, path: '/p/$projectId', component: lazyRouteComponent(() => import('@/features/board/board-page'), 'BoardPage'), pendingComponent: RouteFallback });

export const ticketRoute = createRoute({ getParentRoute: () => boardRoute, path: 't/$ticketId', component: lazyRouteComponent(() => import('@/features/ticket/ticket-sheet'), 'TicketSheet') });

export const overviewRoute = createRoute({ getParentRoute: () => rootRoute, path: '/p/$projectId/stats', component: lazyRouteComponent(() => import('@/features/overview/overview-page'), 'OverviewPage'), pendingComponent: RouteFallback });

const routeTree = rootRoute.addChildren([indexRoute, dashboardRoute, boardRoute.addChildren([ticketRoute]), overviewRoute]);

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: false,
  defaultPendingMs: 150,
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
