import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { DatabaseConfig } from '../config.js';
import type { Db, Rows } from './index.js';

type PgliteConfig = Extract<DatabaseConfig, { driver: 'pglite' }>;

type PgliteLike = {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
  transaction<T>(fn: (tx: PgliteLike) => Promise<T>): Promise<T | undefined>;
  close(): Promise<void>;
};

/**
 * Embedded PostgreSQL (PGlite) for local development and tests only.
 *
 * `@electric-sql/pglite` is a devDependency and is imported dynamically, so a
 * production install neither ships nor loads it. `loadConfig` already refuses
 * `pglite://` in production; this guard is the second lock on the same door.
 */
export async function createPgliteDb(config: PgliteConfig): Promise<Db> {
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL === '1') {
    throw new Error('The pglite driver is not available in production');
  }
  let PGlite: new (dataDir: string) => PgliteLike;
  try {
    ({ PGlite } = (await import('@electric-sql/pglite')) as unknown as {
      PGlite: new (dataDir: string) => PgliteLike;
    });
  } catch {
    throw new Error('DATABASE_URL uses pglite:// but @electric-sql/pglite is not installed (it is a devDependency)');
  }

  const dataDir = config.path === 'memory' ? 'memory://' : config.path;
  if (!dataDir.startsWith('memory://') && !dataDir.startsWith('idb://')) {
    await mkdir(path.dirname(path.resolve(dataDir)), { recursive: true });
  }
  const client = new PGlite(dataDir);

  const wrap = (handle: PgliteLike, nested: boolean): Db => ({
    async query<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<Rows<T>> {
      const result = await handle.query<T>(sql, params as unknown[]);
      return { rows: result.rows };
    },
    async exec(sql: string): Promise<void> {
      await handle.exec(sql);
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      if (nested) return fn(wrap(handle, true));
      let captured: { value: T } | undefined;
      await handle.transaction(async (tx) => {
        captured = { value: await fn(wrap(tx, true)) };
      });
      if (!captured) throw new Error('transaction rolled back without an error');
      return captured.value;
    },
    async close(): Promise<void> {
      if (!nested) await client.close();
    },
  });

  return wrap(client, false);
}
