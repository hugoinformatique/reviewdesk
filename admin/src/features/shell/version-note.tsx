/**
 * Installed version, and a quiet line when a newer release exists. The server
 * does the GitHub lookup (the CSP forbids the browser from contacting anyone
 * else); nothing is shown while loading, on error, or when the check is off.
 */
import { useQuery } from '@tanstack/react-query';
import { versionQuery } from '@/lib/queries';

export function VersionNote() {
  const { data } = useQuery(versionQuery);
  if (!data) return null;
  return (
    <div className="px-2 pb-2 text-[11.5px] leading-snug text-muted-foreground">
      <p data-testid="app-version">v{data.current}</p>
      {data.updateAvailable && data.latest && (
        <p data-testid="update-available">
          {data.releaseUrl ? (
            <a
              href={data.releaseUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-sm underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring"
            >
              Version {data.latest} disponible
            </a>
          ) : (
            <>Version {data.latest} disponible</>
          )}
        </p>
      )}
    </div>
  );
}
