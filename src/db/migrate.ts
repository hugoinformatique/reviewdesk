import type { Db } from './index.js';

export type Migration = { id: string; sql: string };

/**
 * Migrations are append-only and each one must be safe to replay: a serverless
 * platform can boot many cold instances at once, and `RUN_MIGRATIONS_ON_BOOT`
 * lets every one of them try.
 */
export const MIGRATIONS: Migration[] = [
  {
    id: '001_initial',
    sql: `
      CREATE TABLE IF NOT EXISTS projects (
        id text PRIMARY KEY,
        name text NOT NULL,
        client_label text NOT NULL,
        origins jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS review_links (
        id text PRIMARY KEY,
        project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        token_hash text UNIQUE NOT NULL,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS admin_sessions (
        token_hash text PRIMARY KEY,
        expires_at timestamptz NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tickets (
        id text PRIMARY KEY,
        project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        text text NOT NULL,
        response text NOT NULL DEFAULT '',
        status text NOT NULL CHECK (status IN ('TODO','IN_PROGRESS','REVIEW','DONE')),
        page_url text NOT NULL,
        anchor jsonb NOT NULL,
        viewport_width integer NOT NULL DEFAULT 1024,
        diagnostics jsonb NOT NULL DEFAULT '{}',
        screenshot_id text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS uploads (
        id text PRIMARY KEY,
        project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        filename text NOT NULL,
        mime text NOT NULL,
        size_bytes integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS rate_limits (
        key text PRIMARY KEY,
        window_start timestamptz NOT NULL,
        count integer NOT NULL
      );
      CREATE INDEX IF NOT EXISTS tickets_project_status ON tickets(project_id, status, created_at DESC);
    `,
  },
  {
    id: '002_session_csrf',
    sql: `
      -- Sessions predating CSRF binding cannot present a token; drop them so the
      -- NOT NULL column below is meaningful rather than back-filled with ''.
      DELETE FROM admin_sessions;
      ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS csrf_token text NOT NULL DEFAULT '';
      ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
      ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();
      CREATE INDEX IF NOT EXISTS admin_sessions_expires ON admin_sessions(expires_at);
    `,
  },
  {
    id: '003_object_storage',
    sql: `
      -- Uploads move from a server-local path to an object-store key.
      ALTER TABLE uploads ADD COLUMN IF NOT EXISTS storage_key text;
      UPDATE uploads SET storage_key = filename WHERE storage_key IS NULL;
      ALTER TABLE uploads ALTER COLUMN storage_key SET NOT NULL;
      ALTER TABLE uploads ADD COLUMN IF NOT EXISTS checksum text NOT NULL DEFAULT '';
      CREATE INDEX IF NOT EXISTS uploads_project ON uploads(project_id, created_at DESC);
    `,
  },
  {
    id: '004_review_link_metadata',
    sql: `
      ALTER TABLE review_links ADD COLUMN IF NOT EXISTS label text NOT NULL DEFAULT '';
      ALTER TABLE review_links ADD COLUMN IF NOT EXISTS last_used_at timestamptz;
      CREATE INDEX IF NOT EXISTS review_links_project ON review_links(project_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS tickets_page_url ON tickets(page_url);
    `,
  },
  {
    id: '005_replies_and_notifications',
    sql: `
      -- reply_text is shown to the reviewer; response stays an internal note.
      -- They are separate columns rather than one field with a flag, so an
      -- internal note can never be published by flipping a boolean.
      ALTER TABLE tickets ADD COLUMN IF NOT EXISTS reply_text text NOT NULL DEFAULT '';
      ALTER TABLE projects ADD COLUMN IF NOT EXISTS webhook_url text NOT NULL DEFAULT '';
      -- Keyset pagination orders by (created_at, id); the id breaks ties so no
      -- ticket can be skipped or repeated across pages.
      CREATE INDEX IF NOT EXISTS tickets_created ON tickets(created_at DESC, id DESC);
    `,
  },
];

const BOOTSTRAP_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  );
`;

/** Arbitrary but fixed: all ReviewDesk instances serialise on this one key. */
const ADVISORY_LOCK_KEY = 4_130_915_207;

async function pendingIds(db: Db): Promise<string[]> {
  const probe = await db.query<{ table_name: string | null }>(
    "SELECT to_regclass('public.schema_migrations')::text AS table_name",
  );
  if (!probe.rows[0]?.table_name) return MIGRATIONS.map((m) => m.id);
  const applied = new Set((await db.query<{ id: string }>('SELECT id FROM schema_migrations')).rows.map((r) => r.id));
  return MIGRATIONS.filter((m) => !applied.has(m.id)).map((m) => m.id);
}

/**
 * Applies every outstanding migration. Safe to call concurrently from any number
 * of processes: the whole apply runs inside one transaction holding a
 * transaction-scoped advisory lock, which also works through PgBouncer in
 * transaction pooling mode (a session-scoped lock would not).
 *
 * Returns the ids actually applied by this call.
 */
export async function migrate(db: Db): Promise<string[]> {
  // Unlocked fast path: warm instances and already-migrated databases pay one
  // round trip instead of a lock plus a transaction.
  if ((await pendingIds(db)).length === 0) return [];
  return db.transaction(async (tx) => {
    // A migration may legitimately outlive the request statement timeout.
    await tx.exec('SET LOCAL statement_timeout = 60000');
    await tx.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_KEY]);
    await tx.exec(BOOTSTRAP_SQL);
    const applied = new Set((await tx.query<{ id: string }>('SELECT id FROM schema_migrations')).rows.map((r) => r.id));
    const done: string[] = [];
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.id)) continue;
      await tx.exec(migration.sql);
      await tx.query('INSERT INTO schema_migrations(id) VALUES($1)', [migration.id]);
      done.push(migration.id);
    }
    return done;
  });
}

const inflight = new WeakMap<Db, Promise<string[]>>();

/** Per-process memoisation so warm serverless invocations skip the probe. */
export function ensureMigrated(db: Db): Promise<string[]> {
  const existing = inflight.get(db);
  if (existing) return existing;
  const started = migrate(db).catch((error) => {
    inflight.delete(db);
    throw error;
  });
  inflight.set(db, started);
  return started;
}
