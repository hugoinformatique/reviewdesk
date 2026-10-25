/**
 * Optional "is a newer release out?" check, run by the server only.
 *
 * The browser never contacts GitHub (the admin CSP keeps `connect-src 'self'`).
 * The single outbound request is a public, unauthenticated GET of the latest
 * release of a GitHub repository; it carries no instance identifier, only a
 * `User-Agent: ReviewDesk/<version>` header. Results are cached in memory and
 * a failure never reaches the caller.
 */

export const DEFAULT_UPDATE_REPOSITORY = 'hugoinformatique/reviewdesk';

const TIMEOUT_MS = 3_000;
const SUCCESS_TTL_MS = 12 * 3_600_000;
const FAILURE_TTL_MS = 3_600_000;
const MAX_BODY_BYTES = 256 * 1024;
const REPOSITORY_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98})\/[A-Za-z0-9._-]{1,100}$/;
const SEMVER = /^(\d{1,9})\.(\d{1,9})\.(\d{1,9})$/;

export type FetchLike = (input: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;

export type VersionInfo = {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  checkEnabled: boolean;
};

export type UpdateCheckerOptions = {
  enabled: boolean;
  repository: string;
  currentVersion: string;
  fetch?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
};

export function isValidRepository(value: string): boolean {
  return REPOSITORY_PATTERN.test(value) && !value.includes('..');
}

/** Strict `X.Y.Z` (optional leading `v`); anything else, pre-releases included, is null. */
export function parseVersion(raw: unknown): [number, number, number] | null {
  if (typeof raw !== 'string') return null;
  const match = SEMVER.exec(raw.trim().replace(/^v/, ''));
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Positive when `a` is newer than `b`; null when either is not a strict version. */
export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i += 1) {
    const diff = left[i]! - right[i]!;
    if (diff !== 0) return diff;
  }
  return 0;
}

type Release = { latest: string; releaseUrl: string | null };

function readRelease(payload: unknown): Release | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const body = payload as Record<string, unknown>;
  if (body.draft === true || body.prerelease === true) return null;
  const parsed = parseVersion(body.tag_name);
  if (!parsed) return null;
  const url = typeof body.html_url === 'string' ? body.html_url : '';
  return { latest: parsed.join('.'), releaseUrl: url.startsWith('https://github.com/') && url.length <= 500 ? url : null };
}

export function createUpdateChecker(options: UpdateCheckerOptions) {
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const enabled = options.enabled && isValidRepository(options.repository);
  let cache: { release: Release | null; expiresAt: number } | null = null;
  let inflight: Promise<void> | null = null;

  async function query(): Promise<Release | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await doFetch(`https://api.github.com/repos/${options.repository}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': `ReviewDesk/${options.currentVersion}` },
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const text = await response.text();
      if (text.length > MAX_BODY_BYTES) return null;
      return readRelease(JSON.parse(text));
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  function refresh(): Promise<void> {
    inflight ??= (async () => {
      const release = await query();
      // A failed refresh keeps the last known release but backs off for an hour.
      cache = release
        ? { release, expiresAt: now() + SUCCESS_TTL_MS }
        : { release: cache?.release ?? null, expiresAt: now() + FAILURE_TTL_MS };
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  function view(): VersionInfo {
    const release = cache?.release ?? null;
    const diff = release ? compareVersions(release.latest, options.currentVersion) : null;
    return {
      current: options.currentVersion,
      latest: release?.latest ?? null,
      updateAvailable: diff !== null && diff > 0,
      releaseUrl: diff !== null && diff > 0 ? release!.releaseUrl : null,
      checkEnabled: true,
    };
  }

  return {
    /** Never throws. Waits at most the timeout, and only when nothing is cached yet. */
    async get(): Promise<VersionInfo> {
      if (!enabled) {
        return { current: options.currentVersion, latest: null, updateAvailable: false, releaseUrl: null, checkEnabled: false };
      }
      if (!cache) await refresh();
      else if (cache.expiresAt <= now()) void refresh();
      return view();
    },
  };
}

export type UpdateChecker = ReturnType<typeof createUpdateChecker>;
