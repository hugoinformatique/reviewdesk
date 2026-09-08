import type { StorageConfig } from '../config.js';
import { StorageError, type ObjectStore, type StoredObject } from './index.js';

type SupabaseStorageConfig = Extract<StorageConfig, { driver: 'supabase' }>;
type Fetch = typeof fetch;
const REQUEST_TIMEOUT_MS = 20_000;

function encodePath(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/');
}

export function createSupabaseStore(config: SupabaseStorageConfig, fetchImpl: Fetch = fetch): ObjectStore {
  const endpoint = config.endpoint.replace(/\/+$/, '');
  const prefixed = (key: string) => (config.keyPrefix ? `${config.keyPrefix}/${key}` : key);
  const objectUrl = (key: string) =>
    `${endpoint}/storage/v1/object/${encodeURIComponent(config.bucket)}/${encodePath(prefixed(key))}`;

  async function send(method: 'GET' | 'POST' | 'DELETE', key: string, body?: Buffer, contentType?: string): Promise<Response> {
    const headers: Record<string, string> = {
      apikey: config.serviceRoleKey,
      authorization: `Bearer ${config.serviceRoleKey}`,
    };
    if (contentType) headers['content-type'] = contentType;
    if (method === 'POST') headers['x-upsert'] = 'true';
    try {
      return await fetchImpl(objectUrl(key), {
        method,
        headers,
        body: body ? new Uint8Array(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (cause) {
      throw new StorageError(`object store request failed: ${method} ${key}`, undefined, { cause } as ErrorOptions);
    }
  }

  return {
    description: `supabase ${config.bucket} @ ${new URL(config.endpoint).host}`,
    async put(key, body, contentType) {
      const response = await send('POST', key, body, contentType);
      if (!response.ok) throw new StorageError(`object store rejected PUT (${response.status})`, response.status);
      await response.arrayBuffer();
    },
    async get(key): Promise<StoredObject | null> {
      const response = await send('GET', key);
      if (response.status === 404) return null;
      if (!response.ok) throw new StorageError(`object store rejected GET (${response.status})`, response.status);
      return {
        body: Buffer.from(await response.arrayBuffer()),
        contentType: response.headers.get('content-type') ?? undefined,
      };
    },
    async delete(key) {
      const response = await send('DELETE', key);
      if (!response.ok && response.status !== 404) {
        throw new StorageError(`object store rejected DELETE (${response.status})`, response.status);
      }
      await response.arrayBuffer();
    },
  };
}
