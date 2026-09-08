import pg from 'pg';
import type { DatabaseConfig } from '../config.js';
import type { Db, Rows } from './index.js';
import { SUPABASE_ROOT_CA_2021 } from './supabase-ca.js';

type PostgresConfig = Extract<DatabaseConfig, { driver: 'postgres' }>;

/**
 * Serverless connection discipline: a Pool is created once per process and
 * cached on `globalThis`, so warm invocations reuse the socket instead of
 * dialling PostgreSQL on every request. `poolMax` defaults to 1 (see config),
 * which keeps the fan-out bounded by concurrent invocations rather than by
 * concurrent invocations times pool size. Point DATABASE_URL at a pooler
 * (Neon pooled endpoint, Supabase :6543, PgBouncer) for anything beyond a
 * handful of concurrent functions.
 */
const POOL_CACHE = Symbol.for('reviewdesk.pg.pools');

type PoolCache = Map<string, pg.Pool>;

function poolCache(): PoolCache {
  const holder = globalThis as unknown as Record<symbol, PoolCache | undefined>;
  const existing = holder[POOL_CACHE];
  if (existing) return existing;
  const created: PoolCache = new Map();
  holder[POOL_CACHE] = created;
  return created;
}

function cacheKey(config: PostgresConfig): string {
  return `${config.url}|max=${config.poolMax}|ssl=${config.ssl}|timeout=${config.statementTimeoutMs}`;
}

type PgSsl = NonNullable<pg.PoolConfig['ssl']>;

/** Keep URL TLS flags from overriding the explicit verified TLS policy. */
export function postgresTransport(config: PostgresConfig): { connectionString: string; ssl: PgSsl } {
  if (!config.ssl) return { connectionString: config.url, ssl: false };
  const parsed = new URL(config.url);
  for (const parameter of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) parsed.searchParams.delete(parameter);
  const supabase = parsed.hostname.endsWith('.pooler.supabase.com') || parsed.hostname.endsWith('.supabase.co');
  return {
    connectionString: parsed.toString(),
    ssl: { rejectUnauthorized: true, ...(supabase ? { ca: SUPABASE_ROOT_CA_2021 } : {}) },
  };
}

export function getPool(config: PostgresConfig): pg.Pool {
  const cache = poolCache();
  const key = cacheKey(config);
  const existing = cache.get(key);
  if (existing) return existing;
  const transport = postgresTransport(config);
  const pool = new pg.Pool({
    connectionString: transport.connectionString,
    max: config.poolMax,
    // Short idle timeout so a scaled-down function does not pin connections,
    // and allowExitOnIdle so `node` can exit without an explicit close.
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
    statement_timeout: config.statementTimeoutMs,
    ssl: transport.ssl,
  });
  // Without a listener, a backend-initiated socket error crashes the process.
  pool.on('error', () => {});
  cache.set(key, pool);
  return pool;
}

function wrapClient(client: pg.PoolClient): Db {
  return {
    async query<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<Rows<T>> {
      const result = await client.query(sql, params as unknown[]);
      return { rows: result.rows as T[] };
    },
    async exec(sql: string): Promise<void> {
      await client.query(sql);
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      // Already inside a transaction: run inline rather than nesting BEGIN.
      return fn(wrapClient(client));
    },
    async close(): Promise<void> {},
  };
}

export function createPostgresDb(config: PostgresConfig): Db {
  const pool = getPool(config);
  return {
    async query<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<Rows<T>> {
      const result = await pool.query(sql, params as unknown[]);
      return { rows: result.rows as T[] };
    },
    async exec(sql: string): Promise<void> {
      await pool.query(sql);
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(wrapClient(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* the connection is already gone; releasing below discards it */
        }
        throw error;
      } finally {
        client.release();
      }
    },
    async close(): Promise<void> {
      // Several Db handles can share one cached pool; only the first close ends it.
      if (poolCache().delete(cacheKey(config))) await pool.end();
    },
  };
}
