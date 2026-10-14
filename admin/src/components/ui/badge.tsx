import type { ComponentProps } from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

type BadgeStatus = 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE';

const statusClasses: Record<BadgeStatus, string> = {
  TODO: 'border-transparent bg-st-todo-soft text-st-todo',
  IN_PROGRESS: 'border-transparent bg-st-progress-soft text-st-progress',
  REVIEW: 'border-transparent bg-st-review-soft text-st-review',
  DONE: 'border-transparent bg-st-done-soft text-st-done',
};

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:ring-[3px] focus-visible:ring-ring [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border-strong text-foreground',
        destructive: 'border-transparent bg-destructive-soft text-destructive',
        status: '',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

type BadgeProps = ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean; status?: BadgeStatus };

function Badge({ className, variant, status, asChild = false, ...props }: BadgeProps) {
  const Comp = asChild ? Slot.Root : 'span';
  const resolved = status ? 'status' : variant;
  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant: resolved }), status && statusClasses[status], className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
export type { BadgeProps, BadgeStatus };
