import type { ComponentProps } from 'react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { CircleIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

function RadioGroup({ className, ...props }: ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return <RadioGroupPrimitive.Root data-slot="radio-group" className={cn('grid gap-2', className)} {...props} />;
}

function RadioGroupItem({ className, ...props }: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        'aspect-square size-4 shrink-0 cursor-pointer rounded-full border border-border-strong bg-background text-primary shadow-1 transition-[color,box-shadow] duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive data-[state=checked]:border-primary',
        className
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator data-slot="radio-group-indicator" className="relative flex items-center justify-center">
        <CircleIcon className="size-2 fill-primary" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
}

export { RadioGroup, RadioGroupItem };
