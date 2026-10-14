/**
 * Title row shared by the pages: title (and optional line under it) on the
 * left, page actions on the right, optional tabs under the title. The app
 * shell's top bar already carries the page's <h1>; this is the page's own
 * heading, so it is an <h2>.
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function PageHeader({
  title,
  description,
  actions,
  tabs,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold tracking-tight text-balance sm:text-2xl">{title}</h2>
          {description && <p className="mt-1 text-[13.5px] text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {tabs && <div className="-mb-px">{tabs}</div>}
    </div>
  );
}
