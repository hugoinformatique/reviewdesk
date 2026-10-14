/**
 * The one door to the API. Same-origin fetch: the httpOnly session cookie
 * rides along by itself; every write carries the CSRF token bound to that
 * session (returned by login, or by GET /api/auth/session after a reload).
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
  ) {
    super(code ? `HTTP ${status} ${code}` : `HTTP ${status}`);
  }
}

let csrfToken = '';
const unauthorizedListeners = new Set<() => void>();

export function setCsrfToken(token: string) {
  csrfToken = token;
}

/** Called on any 401: the session is gone, the app goes back to the login. */
export function onUnauthorized(listener: () => void) {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

type Options = { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; signal?: AbortSignal };

export async function api<T = unknown>(url: string, { method = 'GET', body, signal }: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
  // Fastify rejects a JSON content type with an empty body: always send one.
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (method !== 'GET' && method !== 'DELETE') {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body ?? {});
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const response = await fetch(url, { method, headers, body: payload, signal, credentials: 'same-origin' });
  if (response.status === 401) {
    csrfToken = '';
    for (const listener of unauthorizedListeners) listener();
  }
  if (!response.ok) {
    let code: string | undefined;
    try {
      code = ((await response.json()) as { error?: string }).error;
    } catch {
      // Not JSON: the status says enough.
    }
    throw new ApiError(response.status, code);
  }
  if (response.status === 204) return null as T;
  return (await response.json()) as T;
}

export function loginErrorMessage(error: unknown): string {
  const status = error instanceof ApiError ? error.status : 0;
  if (status === 401) return 'Identifiants invalides.';
  if (status === 429) return 'Trop de tentatives. Réessayez dans une minute.';
  return 'Service momentanément indisponible. Réessayez plus tard.';
}

/** Query string from a record, dropping empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}
