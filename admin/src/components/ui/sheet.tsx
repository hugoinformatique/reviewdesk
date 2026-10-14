import type { ComponentProps } from 'react';
import { Dialog as SheetPrimitive } from 'radix-ui';
import { XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

function Sheet(props: ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger(props: ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose(props: ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal(props: ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({ className, ...props }: ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=closed]:animate-out-fade data-[state=open]:animate-in-fade',
        className
      )}
      {...props}
    />
  );
}

type SheetSide = 'right' | 'left' | 'bottom';

const sideClasses: Record<SheetSide, string> = {
  right:
    'inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-md data-[state=closed]:animate-out-slide-right data-[state=open]:animate-in-slide-right',
  left: 'inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-md data-[state=closed]:animate-out-slide-left data-[state=open]:animate-in-slide-left',
  bottom:
    'inset-x-0 bottom-0 h-auto max-h-[85dvh] rounded-t-lg border-t data-[state=closed]:animate-out-slide-up data-[state=open]:animate-in-slide-up',
};

function SheetContent({
  className,
  children,
  side = 'right',
  showCloseButton = true,
  ...props
}: ComponentProps<typeof SheetPrimitive.Content> & { side?: SheetSide; showCloseButton?: boolean }) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          'fixed z-50 flex flex-col gap-4 overflow-y-auto border-border bg-popover text-popover-foreground shadow-3 outline-none',
          sideClasses[side],
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            className="absolute top-4 right-4 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring [&_svg]:size-4 [&_svg]:shrink-0"
          >
            <XIcon aria-hidden="true" />
            <span className="sr-only">Fermer</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="sheet-header" className={cn('flex flex-col gap-1.5 p-5 pr-12', className)} {...props} />;
}

function SheetFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="sheet-footer" className={cn('mt-auto flex flex-col gap-2 p-5', className)} {...props} />;
}

function SheetTitle({ className, ...props }: ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('text-base leading-none font-semibold tracking-tight', className)}
      {...props}
    />
  );
}

function SheetDescription({ className, ...props }: ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-[13.5px] text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
};
export type { SheetSide };
