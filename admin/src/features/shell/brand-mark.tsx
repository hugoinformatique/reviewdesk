/**
 * The instance's logo, or the ReviewDesk mark: a speech bubble whose one
 * visible content is the point being talked about. Same path as
 * public/favicon.svg and the widget's launcher.
 */
import { cn } from '@/lib/utils';
import { splitWordmark, useBranding } from '@/features/branding/branding-provider';

export function BrandMark({ className }: { className?: string }) {
  const { logoDataUri } = useBranding();
  if (logoDataUri) return <img src={logoDataUri} alt="" className={cn('size-7 shrink-0 rounded-md object-contain', className)} />;
  return (
    <svg
      aria-hidden
      viewBox="0 0 32 32"
      className={cn('size-7 shrink-0 rounded-md text-primary shadow-1', className)}
    >
      <rect width="32" height="32" rx="7.5" fill="currentColor" />
      <path
        className="fill-primary-foreground"
        fillRule="evenodd"
        d="M10.5 7h11a4.5 4.5 0 0 1 4.5 4.5v6a4.5 4.5 0 0 1-4.5 4.5h-5.1l-4.9 4.28A.8.8 0 0 1 10.2 25.7V22h-.2a4.5 4.5 0 0 1-4.5-4.5v-6A4.5 4.5 0 0 1 10.5 7Zm5.5 4.35a3.15 3.15 0 1 0 0 6.3 3.15 3.15 0 0 0 0-6.3Z"
      />
    </svg>
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
