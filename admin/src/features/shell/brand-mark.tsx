/** The instance's logo, or an ink tile with the product's initial. */
import { cn } from '@/lib/utils';
import { splitWordmark, useBranding } from '@/features/branding/branding-provider';

export function BrandMark({ className }: { className?: string }) {
  const { logoDataUri, productName } = useBranding();
  if (logoDataUri) return <img src={logoDataUri} alt="" className={cn('size-7 shrink-0 rounded-md object-contain', className)} />;
  return (
    <span
      aria-hidden
      className={cn('flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-[13px] font-semibold text-primary-foreground shadow-1', className)}
    >
      {productName.trim().charAt(0).toUpperCase() || 'R'}
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  const { productName } = useBranding();
  const { light, bold } = splitWordmark(productName);
  return (
    <span className={cn('truncate text-[15px] tracking-tight', className)}>
      <span className="font-normal text-subtle-foreground">{light}</span>
      <span className="font-semibold">{bold}</span>
    </span>
  );
}
