import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 min-w-5 items-center justify-center gap-1 rounded-sm border border-border-strong bg-sunken px-1.5 font-mono text-[11px] font-medium text-muted-foreground shadow-edge select-none [&_svg:not([class*='size-'])]:size-3",
        className
      )}
      {...props}
    />
  );
}

function KbdGroup({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="kbd-group" className={cn('inline-flex items-center gap-1', className)} {...props} />;
}

export { Kbd, KbdGroup };
