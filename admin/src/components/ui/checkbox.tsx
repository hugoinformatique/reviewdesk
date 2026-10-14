import type { ComponentProps } from 'react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import { CheckIcon, MinusIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer size-4 shrink-0 cursor-pointer rounded-[4px] border border-border-strong bg-background shadow-1 transition-[color,background-color,box-shadow] duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground',
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="flex items-center justify-center text-current">
        {props.checked === 'indeterminate' ? <MinusIcon className="size-3" /> : <CheckIcon className="size-3" />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
