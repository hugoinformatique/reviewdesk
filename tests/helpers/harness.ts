import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { buildApp, type App, type BuildOptions } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';

export const ADMIN_PASSWORD = 'grenat-fougere-litanie-8412';

/**
 * Integration tests run against whatever backends the environment points at.
 * `scripts/with-docker-backends.sh` sets TEST_DATABASE_URL / TEST_S3_* to a
 * disposable PostgreSQL 16 and MinIO; without them the suite falls back to the
 * embedded dev drivers so `npm test` still works on a machine without Docker.
 */
export const usingRealPostgres = Boolean(process.env.TEST_DATABASE_URL);
export const usingRealS3 = Boolean(process.env.TEST_S3_ENDPOINT);

export function testEnv(extra: Record<string, string> = {}): Record<string, string> {
  const scratch = path.join(os.tmpdir(), `reviewdesk-test-${randomUUID()}`);
  return {
    NODE_ENV: 'test',
    VERCEL: '',
    ADMIN_PASSWORD,
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'pglite://memory',
    SERVE_STATIC: '0',
    ...(usingRealS3
      ? {
          STORAGE_DRIVER: 's3',
          S3_ENDPOINT: process.env.TEST_S3_ENDPOINT!,
          S3_BUCKET: process.env.TEST_S3_BUCKET ?? 'reviewdesk-test',
          S3_ACCESS_KEY_ID: process.env.TEST_S3_ACCESS_KEY_ID!,
          S3_SECRET_ACCESS_KEY: process.env.TEST_S3_SECRET_ACCESS_KEY!,
          S3_REGION: process.env.TEST_S3_REGION ?? 'us-east-1',
          S3_KEY_PREFIX: `it/${randomUUID()}`,
        }
      : { STORAGE_DRIVER: 'filesystem', UPLOAD_DIR: scratch }),
    ...extra,
  };
}

export async function createTestApp(
  t: TestContext,
  extra: Record<string, string> = {},
  options: BuildOptions = {},
): Promise<App> {
  const config = loadConfig(testEnv(extra));
  const app = await buildApp(config, options);
  // A shared Docker PostgreSQL is reused across tests: start from a clean slate
  // without dropping the migration bookkeeping.
  await app.reviewdesk.db.exec('TRUNCATE projects, admin_sessions, rate_limits RESTART IDENTITY CASCADE');
  t.after(async () => {
    await app.close();
    if (config.storage.driver === 'filesystem') await rm(config.storage.directory, { recursive: true, force: true });
  });
  return app;
}

export type AdminAuth = { cookie: string; csrfToken: string; write: Record<string, string>; read: Record<string, string> };

export async function loginAdmin(app: App, password = ADMIN_PASSWORD): Promise<AdminAuth> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'admin', password },
  });
  if (response.statusCode !== 200) throw new Error(`login failed: ${response.statusCode} ${response.body}`);
  const cookie = `rd_session=${response.cookies[0]?.value}`;
  const csrfToken = response.json().csrfToken as string;
  return {
    cookie,
    csrfToken,
    read: { cookie },
    write: { cookie, 'x-csrf-token': csrfToken },
  };
}

export type Project = { id: string; name: string; clientLabel: string; origins: string[] };

export async function createProject(app: App, auth: AdminAuth, project: Omit<Project, 'id'>): Promise<Project> {
  const response = await app.inject({ method: 'POST', url: '/api/projects', headers: auth.write, payload: project });
  if (response.statusCode !== 201) throw new Error(`project creation failed: ${response.statusCode} ${response.body}`);
  return response.json() as Project;
}

export async function createReviewLink(app: App, auth: AdminAuth, projectId: string): Promise<{ id: string; token: string }> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/review-links`,
    headers: auth.write,
    payload: {},
  });
  if (response.statusCode !== 201) throw new Error(`review link creation failed: ${response.statusCode} ${response.body}`);
  return response.json() as { id: string; token: string };
}

export const anchor = {
  selector: '#hero-cta',
  relative: { x: 0.5, y: 0.25 },
  viewport: { width: 390, height: 844 },
};

/** A 1x1 PNG: valid magic bytes and a valid image. */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export function multipartBody(
  boundary: string,
  parts: { name: string; filename?: string; contentType?: string; body: Buffer }[],
): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const disposition = part.filename
      ? `form-data; name="${part.name}"; filename="${part.filename}"`
      : `form-data; name="${part.name}"`;
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: ${disposition}\r\n` +
          (part.contentType ? `Content-Type: ${part.contentType}\r\n` : '') +
          '\r\n',
      ),
      part.body,
      Buffer.from('\r\n'),
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}
