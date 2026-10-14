import type { ReactNode } from 'react';

/** Minimal page header; to be swapped for features/shell/page-header.tsx. */
export function BoardHeader({ title, actions, tabs }: { title: ReactNode; actions?: ReactNode; tabs?: ReactNode }) {
  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight">{title}</h1>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {tabs}
    </header>
  );
}
