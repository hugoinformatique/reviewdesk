import type { ComponentProps } from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md text-[13.5px] font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out-strong outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive active:scale-[0.98] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-1 hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/70',
        outline: 'border border-border-strong bg-background text-foreground shadow-1 hover:bg-accent',
        ghost: 'text-foreground hover:bg-accent',
        destructive: 'bg-destructive text-white shadow-1 hover:bg-destructive/90',
        link: 'text-foreground underline-offset-4 hover:underline active:scale-100',
      },
      size: {
        default: 'h-[34px] px-3.5',
        sm: 'h-[30px] gap-1.5 px-3 text-[13px]',
        lg: 'h-10 px-5 text-sm',
        icon: 'size-[34px]',
        'icon-sm': 'size-[30px]',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
);

type ButtonProps = ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
export type { ButtonProps };
