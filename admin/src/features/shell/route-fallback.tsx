import { Skeleton } from '@/components/ui/skeleton';

/** Discreet placeholder while a route chunk loads. */
export function RouteFallback() {
  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6" aria-busy="true" aria-label="Chargement">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-9 w-full max-w-md" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
