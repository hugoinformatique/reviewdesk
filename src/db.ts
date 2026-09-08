import { PGlite } from '@electric-sql/pglite';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export async function createDatabase(pathname: string) {
  if (pathname !== 'memory://' && !pathname.startsWith('idb://')) await mkdir(path.dirname(path.resolve(pathname)), { recursive: true });
  const db = new PGlite(pathname);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS projects (id text PRIMARY KEY, name text NOT NULL, client_label text NOT NULL, origins jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS review_links (id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE, token_hash text UNIQUE NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS admin_sessions (token_hash text PRIMARY KEY, expires_at timestamptz NOT NULL);
    CREATE TABLE IF NOT EXISTS tickets (id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE, text text NOT NULL, response text NOT NULL DEFAULT '', status text NOT NULL CHECK(status IN ('TODO','IN_PROGRESS','REVIEW','DONE')), page_url text NOT NULL, anchor jsonb NOT NULL, viewport_width integer NOT NULL DEFAULT 1024, diagnostics jsonb NOT NULL DEFAULT '{}', screenshot_id text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS viewport_width integer NOT NULL DEFAULT 1024;
    CREATE TABLE IF NOT EXISTS uploads (id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE, filename text NOT NULL, mime text NOT NULL, size_bytes integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS rate_limits (key text PRIMARY KEY, window_start timestamptz NOT NULL, count integer NOT NULL);
    CREATE INDEX IF NOT EXISTS tickets_project_status ON tickets(project_id,status,created_at DESC);
  `);
  return db;
}
