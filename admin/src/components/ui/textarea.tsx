import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-[13.5px] text-foreground shadow-1 transition-[color,box-shadow,border-color] duration-150 outline-none placeholder:text-muted-foreground focus-visible:border-border-strong focus-visible:ring-[3px] focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive',
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
