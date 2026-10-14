import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type EmptyStateProps = Omit<ComponentProps<'div'>, 'title'> & {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
};

function EmptyState({ icon, title, description, action, className, ...props }: EmptyStateProps) {
  return (
    <div
      data-slot="empty"
      className={cn(
        'flex min-w-0 flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border-strong p-8 text-center text-balance',
        className
      )}
      {...props}
    >
      {icon && (
        <div
          data-slot="empty-icon"
          className="flex size-10 items-center justify-center rounded-lg border border-border bg-sunken text-muted-foreground shadow-edge [&_svg]:size-5"
        >
          {icon}
        </div>
      )}
      <div className="flex max-w-sm flex-col items-center gap-1">
        <div data-slot="empty-title" className="text-[15px] font-semibold tracking-tight">
          {title}
        </div>
        {description && (
          <div data-slot="empty-description" className="text-[13.5px] text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      {action && (
        <div data-slot="empty-action" className="mt-1 flex items-center gap-2">
          {action}
        </div>
      )}
    </div>
  );
}

export { EmptyState };
export type { EmptyStateProps };
