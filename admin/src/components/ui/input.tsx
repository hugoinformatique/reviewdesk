import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-[34px] w-full min-w-0 rounded-md border border-input bg-background px-3 text-[13.5px] text-foreground shadow-1 transition-[color,box-shadow,border-color] duration-150 outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:border-border-strong focus-visible:ring-[3px] focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive',
        className
      )}
      {...props}
    />
  );
}

export { Input };
