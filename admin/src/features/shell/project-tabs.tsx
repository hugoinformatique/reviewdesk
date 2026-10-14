import { Link } from '@tanstack/react-router';

/** « Retours » / « Vue d'ensemble » tabs, shared by the board and the overview (also for `all`). */
export function ProjectTabs({ param }: { param: string }) {
  const base =
    'relative -mb-px border-b-2 border-transparent px-1 data-[status=active]:border-foreground data-[status=active]:text-foreground pb-2 text-[13.5px] font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring';
  return (
    <nav aria-label="Sections du projet" className="flex gap-4 border-b border-border">
      <Link to="/p/$projectId" params={{ projectId: param }} className={base} activeOptions={{ exact: true }}>
        Retours
      </Link>
      <Link to="/p/$projectId/stats" params={{ projectId: param }} className={base}>
        Vue d'ensemble
      </Link>
    </nav>
  );
}
