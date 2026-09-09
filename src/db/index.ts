import type { DatabaseConfig } from '../config.js';

export type Rows<T> = { rows: T[] };

export interface Db {
  /** Parameterised single statement (extended protocol). */
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<Rows<T>>;
  /** Multi-statement DDL without parameters (simple protocol). Migrations only. */
  exec(sql: string): Promise<void>;
  /** Runs `fn` inside a single transaction on a single connection. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function createDb(config: DatabaseConfig): Promise<Db> {
  if (config.driver === 'postgres') {
    const { createPostgresDb } = await import('./postgres.js');
    return createPostgresDb(config);
  }
  const { createPgliteDb } = await import('./pglite.js');
  return createPgliteDb(config);
}
