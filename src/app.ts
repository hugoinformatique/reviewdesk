import Fastify, { LogController, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { AppConfig } from './config.js';
import { createDb, type Db } from './db/index.js';
import { ensureMigrated } from './db/migrate.js';
import { createObjectStore, StorageError, type ObjectStore } from './storage/index.js';
import { cleanUrl, normalizeDiagnostics } from './privacy.js';
import {
  ADMIN_CONTENT_SECURITY_POLICY,
  IMAGE_EXTENSIONS,
  UPLOAD_CONTENT_SECURITY_POLICY,
  detectImageMime,
  escapeLikePattern,
  hashToken,
  isCrossSiteWrite,
  originAllowed,
  secretsMatch,
  securityHeaders,
} from './security.js';

const STATUSES = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'] as const;
const uuid = z.string().uuid();
/** `new URL()` happily accepts javascript: and data:; only the web schemes are pages. */
const httpUrl = z.string().url().refine((value) => /^https?:\/\//i.test(value), 'not an http(s) URL');

const projectInput = z.object({
  name: z.string().trim().min(2).max(80),
  clientLabel: z.string().trim().min(2).max(80),
  origins: z.array(httpUrl).min(1).max(20),
});
const reviewLinkInput = z.object({ label: z.string().trim().max(80).optional() });
const anchorSchema = z.object({
  selector: z.string().min(1).max(500),
  relative: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  viewport: z.object({
    width: z.number().int().positive().max(10_000),
    height: z.number().int().positive().max(10_000),
  }),
});
const feedbackInput = z.object({
  projectId: uuid,
  text: z.string().trim().min(2).max(4_000),
  pageUrl: httpUrl.max(2_000),
  anchor: anchorSchema,
  diagnostics: z.record(z.string(), z.unknown()).optional(),
  screenshotId: uuid.optional(),
});
const ticketPatch = z
  .object({ status: z.enum(STATUSES).optional(), response: z.string().max(4_000).optional() })
  .refine((value) => value.status !== undefined || value.response !== undefined, 'empty patch');

type AdminSession = { tokenHash: string; csrfToken: string };
type ReviewerGrant = { projectId: string; origin: string; tokenHash: string };

declare module 'fastify' {
  interface FastifyRequest {
    adminSession?: AdminSession;
  }
}

/**
 * Every shape a credential-bearing header can reach the logger in. `req.headers`
 * is the obvious one; the wildcard covers plugins that log the raw headers under
 * their own key, which @fastify/multipart does at trace level under
 * `busboyOptions.headers`. Hyphenated names need pino's bracket accessor.
 */
export const CREDENTIAL_REDACT_PATHS = ['authorization', 'cookie', 'set-cookie', 'x-csrf-token'].flatMap((header) => {
  const accessor = header.includes('-') ? `["${header}"]` : `.${header}`;
  return [`req.headers${accessor}`, `headers${accessor}`, `*.headers${accessor}`];
});

export type App = FastifyInstance & { reviewdesk: { db: Db; store: ObjectStore; config: AppConfig } };

/** `logStream` exists so tests can assert what does and does not reach the logs. */
export type BuildOptions = { logStream?: NodeJS.WritableStream };

export async function buildApp(config: AppConfig, options: BuildOptions = {}): Promise<App> {
  const db = await createDb(config.database);
  const store = await createObjectStore(config.storage);
  if (config.runMigrationsOnBoot) await ensureMigrated(db);

  const app = Fastify({
    logger: {
      level: config.logLevel,
      // Credential-bearing headers are stripped from every shape they can reach
      // the logger in. `req.headers` is the obvious one; the wildcard covers
      // plugins that log the raw headers under their own key, which
      // @fastify/multipart does at trace level under `busboyOptions.headers`.
      redact: { paths: CREDENTIAL_REDACT_PATHS, remove: true },
      ...(options.logStream ? { stream: options.logStream } : {}),
    },
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 1_000_000,
    trustProxy: config.production,
  }) as unknown as App;
  app.reviewdesk = { db, store, config };

  await app.register(cookie);
  await app.register(multipart, {
    limits: { fileSize: config.uploadMaxBytes, files: 1, fields: 4, fieldSize: 200 },
  });
  if (config.serveStatic) {
    const staticPlugin = (await import('@fastify/static')).default;
    const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
    await app.register(staticPlugin, { root: publicDir, prefix: '/' });
  }

  app.addHook('onSend', async (req, reply, payload) => {
    const https = req.protocol === 'https';
    const isUpload = req.url.startsWith('/api/uploads/');
    const headers = securityHeaders({
      https,
      contentSecurityPolicy: isUpload ? UPLOAD_CONTENT_SECURITY_POLICY : ADMIN_CONTENT_SECURITY_POLICY,
    });
    for (const [name, value] of Object.entries(headers)) {
      if (!reply.hasHeader(name)) reply.header(name, value);
    }
    if (req.url.startsWith('/api/') && !reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: 'NOT_FOUND' }));

  app.setErrorHandler((error: { code?: string; statusCode?: number }, req, reply) => {
    const code = error.code;
    if (code === 'FST_REQ_FILE_TOO_LARGE' || code === 'FST_PARTS_LIMIT' || code === 'FST_FILES_LIMIT') {
      return reply.code(413).send({ error: 'FILE_TOO_LARGE' });
    }
    if (code === 'FST_INVALID_MULTIPART_CONTENT_TYPE') return reply.code(415).send({ error: 'UNSUPPORTED_MEDIA_TYPE' });
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: 'INVALID_REQUEST' });
    }
    // The message may embed request data; keep it server-side only.
    req.log.error({ err: error, route: req.routeOptions?.url }, 'request failed');
    return reply.code(500).send({ error: 'INTERNAL' });
  });

  // ---------------------------------------------------------------- rate limit

  /** Fixed one-minute window kept in PostgreSQL so it survives cold starts. */
  async function overLimit(key: string, max: number): Promise<boolean> {
    const result = await db.query<{ count: number }>(
      `INSERT INTO rate_limits(key, window_start, count)
       VALUES ($1, date_trunc('minute', now()), 1)
       ON CONFLICT (key) DO UPDATE SET
         window_start = CASE WHEN rate_limits.window_start < date_trunc('minute', now())
                             THEN date_trunc('minute', now()) ELSE rate_limits.window_start END,
         count = CASE WHEN rate_limits.window_start < date_trunc('minute', now())
                      THEN 1 ELSE rate_limits.count + 1 END
       RETURNING count`,
      [key],
    );
    return Number(result.rows[0]?.count ?? max + 1) > max;
  }

  // --------------------------------------------------------------- admin auth

  async function loadAdminSession(req: FastifyRequest): Promise<AdminSession | null> {
    const token = req.cookies.rd_session;
    if (!token || token.length > 200) return null;
    const tokenHash = hashToken(token);
    // Single round trip: validates, refreshes last_seen and returns the CSRF secret.
    const rows = await db.query<{ csrf_token: string }>(
      `UPDATE admin_sessions SET last_seen_at = now()
       WHERE token_hash = $1 AND expires_at > now()
       RETURNING csrf_token`,
      [tokenHash],
    );
    const row = rows.rows[0];
    return row ? { tokenHash, csrfToken: row.csrf_token } : null;
  }

  async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const session = await loadAdminSession(req);
    if (!session) return reply.code(401).send({ error: 'UNAUTHORIZED' });
    req.adminSession = session;
  }

  /**
   * Admin writes need three independent things to line up: the SameSite=Strict
   * session cookie, a same-site request per Sec-Fetch-Site/Origin, and a CSRF
   * token bound to that exact session. The cookie alone is never enough.
   */
  async function requireAdminWrite(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (isCrossSiteWrite(req.headers)) return reply.code(403).send({ error: 'CROSS_SITE_REQUEST' });
    await requireAdmin(req, reply);
    if (reply.sent) return;
    const presented = req.headers['x-csrf-token'];
    const expected = req.adminSession!.csrfToken;
    if (typeof presented !== 'string' || presented.length !== expected.length || !secretsMatch(presented, expected)) {
      return reply.code(403).send({ error: 'CSRF_TOKEN_INVALID' });
    }
  }

  // ------------------------------------------------------------ reviewer auth

  /**
   * A reviewer request is authorised by the bearer secret alone; the Origin is
   * an additional constraint, never the credential. Both the link and the origin
   * must belong to the project named in the request, which is what keeps two
   * projects isolated from each other.
   */
  async function authoriseReviewer(req: FastifyRequest, projectId: string): Promise<ReviewerGrant | null> {
    const authorization = req.headers.authorization;
    const origin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
    if (!authorization?.startsWith('Bearer ') || !origin) return null;
    const token = authorization.slice('Bearer '.length).trim();
    if (!token || token.length > 200 || !uuid.safeParse(projectId).success) return null;
    const tokenHash = hashToken(token);
    const rows = await db.query<{ project_id: string; origins: string[] }>(
      `UPDATE review_links l SET last_used_at = now()
       FROM projects p
       WHERE p.id = l.project_id AND l.token_hash = $1 AND l.revoked_at IS NULL AND l.project_id = $2
       RETURNING l.project_id, p.origins`,
      [tokenHash, projectId],
    );
    const row = rows.rows[0];
    if (!row || !originAllowed(row.origins, origin)) return null;
    return { projectId: row.project_id, origin, tokenHash };
  }

  const allowOrigin = (reply: FastifyReply, origin: string) =>
    reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin');

  // ----------------------------------------------------------------- routes

  app.get('/health', async () => {
    await db.query('SELECT 1');
    return { ok: true, database: 'postgresql', storage: store.description };
  });

  app.options('/api/*', async (req, reply) => {
    const origin = req.headers.origin;
    const projectId = new URL(req.url, 'http://reviewdesk.invalid').searchParams.get('projectId');
    if (!origin || !projectId || !uuid.safeParse(projectId).success) return reply.code(403).send();
    const rows = await db.query<{ origins: string[] }>('SELECT origins FROM projects WHERE id = $1', [projectId]);
    const origins = rows.rows[0]?.origins;
    // Identical answer for "no such project" and "origin not allowed".
    if (!origins || !originAllowed(origins, origin)) return reply.code(403).send();
    allowOrigin(reply, origin)
      .header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      .header('Access-Control-Allow-Methods', 'POST, OPTIONS')
      .header('Access-Control-Max-Age', '600');
    return reply.code(204).send();
  });

  app.post('/api/auth/login', async (req, reply) => {
    if (isCrossSiteWrite(req.headers)) return reply.code(403).send({ error: 'CROSS_SITE_REQUEST' });
    const parsed = z.object({ username: z.literal('admin'), password: z.string().max(400) }).safeParse(req.body);
    const clientKey = hashToken(`login:${req.ip}`);
    if ((await overLimit(clientKey, config.loginAttemptsPerMinute)) || (await overLimit('login:global', config.loginAttemptsPerMinute * 10))) {
      return reply.code(429).send({ error: 'RATE_LIMITED' });
    }
    if (!parsed.success || !secretsMatch(parsed.data.password, config.adminPassword)) {
      return reply.code(401).send({ error: 'INVALID_CREDENTIALS' });
    }
    await db.query('DELETE FROM admin_sessions WHERE expires_at < now()');
    const sessionToken = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    await db.query(
      `INSERT INTO admin_sessions(token_hash, expires_at, csrf_token)
       VALUES ($1, now() + make_interval(secs => $2), $3)`,
      [hashToken(sessionToken), config.sessionTtlSeconds, csrfToken],
    );
    reply.setCookie('rd_session', sessionToken, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: config.secureCookies,
      maxAge: config.sessionTtlSeconds,
    });
    return reply.code(200).send({ csrfToken });
  });

  app.get('/api/auth/session', { preHandler: requireAdmin }, async (req) => ({
    csrfToken: req.adminSession!.csrfToken,
  }));

  app.post('/api/auth/logout', { preHandler: requireAdminWrite }, async (req, reply) => {
    await db.query('DELETE FROM admin_sessions WHERE token_hash = $1', [req.adminSession!.tokenHash]);
    reply.clearCookie('rd_session', { path: '/' });
    return reply.code(204).send();
  });

  app.get('/api/projects', { preHandler: requireAdmin }, async () => {
    const rows = await db.query(
      `SELECT id, name, client_label AS "clientLabel", origins, created_at AS "createdAt"
       FROM projects ORDER BY created_at`,
    );
    return rows.rows;
  });

  app.post('/api/projects', { preHandler: requireAdminWrite }, async (req, reply) => {
    const parsed = projectInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    let origins: string[];
    try {
      origins = parsed.data.origins.map((value) => {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('scheme');
        return url.origin;
      });
    } catch {
      return reply.code(400).send({ error: 'INVALID_ORIGIN' });
    }
    if (origins.some((origin) => origin === 'null')) return reply.code(400).send({ error: 'INVALID_ORIGIN' });
    if (new Set(origins).size !== origins.length) return reply.code(400).send({ error: 'DUPLICATE_ORIGIN' });
    const id = randomUUID();
    await db.query('INSERT INTO projects(id, name, client_label, origins) VALUES ($1, $2, $3, $4)', [
      id,
      parsed.data.name,
      parsed.data.clientLabel,
      JSON.stringify(origins),
    ]);
    return reply.code(201).send({ id, name: parsed.data.name, clientLabel: parsed.data.clientLabel, origins });
  });

  app.get('/api/projects/:id/review-links', { preHandler: requireAdmin }, async (req, reply) => {
    const projectId = (req.params as { id: string }).id;
    if (!uuid.safeParse(projectId).success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const rows = await db.query(
      `SELECT id, label, created_at AS "createdAt", revoked_at AS "revokedAt", last_used_at AS "lastUsedAt"
       FROM review_links WHERE project_id = $1 ORDER BY created_at DESC`,
      [projectId],
    );
    return { links: rows.rows };
  });

  app.post('/api/projects/:id/review-links', { preHandler: requireAdminWrite }, async (req, reply) => {
    const projectId = (req.params as { id: string }).id;
    const parsed = reviewLinkInput.safeParse(req.body ?? {});
    if (!uuid.safeParse(projectId).success || !parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const project = await db.query('SELECT 1 FROM projects WHERE id = $1', [projectId]);
    if (!project.rows.length) return reply.code(404).send({ error: 'NOT_FOUND' });
    // Only the SHA-256 digest is stored; the secret below is shown exactly once.
    const token = randomBytes(32).toString('base64url');
    const id = randomUUID();
    await db.query('INSERT INTO review_links(id, project_id, token_hash, label) VALUES ($1, $2, $3, $4)', [
      id,
      projectId,
      hashToken(token),
      parsed.data.label ?? '',
    ]);
    return reply.code(201).send({ id, token, fragment: `#project=${projectId}&review=${token}` });
  });

  // Scoped under the project on purpose: a link id belonging to another project
  // must not be revocable (or probe-able) through this project's path.
  app.post(
    '/api/projects/:projectId/review-links/:linkId/revoke',
    { preHandler: requireAdminWrite },
    async (req, reply) => {
      const { projectId, linkId } = req.params as { projectId: string; linkId: string };
      if (!uuid.safeParse(projectId).success || !uuid.safeParse(linkId).success) {
        return reply.code(400).send({ error: 'INVALID_INPUT' });
      }
      const rows = await db.query<{ id: string }>(
        `UPDATE review_links SET revoked_at = COALESCE(revoked_at, now())
         WHERE id = $1 AND project_id = $2 RETURNING id`,
        [linkId, projectId],
      );
      if (!rows.rows.length) return reply.code(404).send({ error: 'NOT_FOUND' });
      return reply.code(204).send();
    },
  );

  app.post('/api/feedback', async (req, reply) => {
    const parsed = feedbackInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const grant = await authoriseReviewer(req, parsed.data.projectId);
    if (!grant) return reply.code(403).send({ error: 'FORBIDDEN' });
    if (await overLimit(`feedback:${grant.tokenHash}`, config.submissionsPerMinute)) {
      return allowOrigin(reply, grant.origin).code(429).send({ error: 'RATE_LIMITED' });
    }
    if (parsed.data.screenshotId) {
      const owned = await db.query('SELECT 1 FROM uploads WHERE id = $1 AND project_id = $2', [
        parsed.data.screenshotId,
        grant.projectId,
      ]);
      if (!owned.rows.length) return allowOrigin(reply, grant.origin).code(400).send({ error: 'INVALID_SCREENSHOT' });
    }
    const id = randomUUID();
    await db.query(
      `INSERT INTO tickets(id, project_id, text, status, page_url, anchor, viewport_width, diagnostics, screenshot_id)
       VALUES ($1, $2, $3, 'TODO', $4, $5, $6, $7, $8)`,
      [
        id,
        grant.projectId,
        parsed.data.text,
        cleanUrl(parsed.data.pageUrl),
        JSON.stringify(parsed.data.anchor),
        parsed.data.anchor.viewport.width,
        JSON.stringify(normalizeDiagnostics(parsed.data.diagnostics ?? {})),
        parsed.data.screenshotId ?? null,
      ],
    );
    return allowOrigin(reply, grant.origin).code(201).send({ id });
  });

  app.post('/api/uploads', async (req, reply) => {
    const projectId = (req.query as { projectId?: unknown }).projectId;
    if (typeof projectId !== 'string') return reply.code(403).send({ error: 'FORBIDDEN' });
    const grant = await authoriseReviewer(req, projectId);
    if (!grant) return reply.code(403).send({ error: 'FORBIDDEN' });
    if (await overLimit(`upload:${grant.tokenHash}`, config.submissionsPerMinute)) {
      return allowOrigin(reply, grant.origin).code(429).send({ error: 'RATE_LIMITED' });
    }
    const part = await req.file();
    if (!part) return allowOrigin(reply, grant.origin).code(400).send({ error: 'FILE_REQUIRED' });
    const data = await part.toBuffer();
    if (part.file.truncated || data.length > config.uploadMaxBytes) {
      return allowOrigin(reply, grant.origin).code(413).send({ error: 'FILE_TOO_LARGE' });
    }
    // The stored MIME comes from the bytes, and the declared type must agree.
    const detected = detectImageMime(data);
    if (!detected || detected !== part.mimetype) {
      return allowOrigin(reply, grant.origin).code(415).send({ error: 'UNSUPPORTED_MEDIA_TYPE' });
    }
    const id = randomUUID();
    const storageKey = `${grant.projectId}/${id}${IMAGE_EXTENSIONS[detected]}`;
    await store.put(storageKey, data, detected);
    try {
      await db.query(
        `INSERT INTO uploads(id, project_id, filename, mime, size_bytes, storage_key)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, grant.projectId, `${id}${IMAGE_EXTENSIONS[detected]}`, detected, data.length, storageKey],
      );
    } catch (error) {
      // Never leave an object nobody can reach or delete.
      await store.delete(storageKey).catch(() => {});
      throw error;
    }
    return allowOrigin(reply, grant.origin).code(201).send({ id });
  });

  app.get('/api/uploads/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!uuid.safeParse(id).success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const rows = await db.query<{ storage_key: string; mime: string }>(
      'SELECT storage_key, mime FROM uploads WHERE id = $1',
      [id],
    );
    const row = rows.rows[0];
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND' });
    let object;
    try {
      object = await store.get(row.storage_key);
    } catch (error) {
      req.log.error({ err: error }, 'upload fetch failed');
      return reply.code(502).send({ error: 'STORAGE_UNAVAILABLE' });
    }
    if (!object) return reply.code(404).send({ error: 'NOT_FOUND' });
    // Bytes are streamed through this authenticated route; the object store
    // itself stays private and is never linked to or presigned for a browser.
    return reply
      .type(row.mime)
      .header('Cache-Control', 'private, no-store')
      .header('Content-Disposition', `inline; filename="${id}"`)
      .send(object.body);
  });

  app.get('/api/tickets', { preHandler: requireAdmin }, async (req, reply) => {
    const query = req.query as Record<string, unknown>;
    const clauses: string[] = [];
    const values: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      values.push(value);
      clauses.push(sql.replace('?', `$${values.length}`));
    };
    const text = (key: string, max: number): string | undefined | null => {
      const value = query[key];
      if (value === undefined || value === '') return undefined;
      if (typeof value !== 'string' || value.length > max) return null;
      return value;
    };

    const projectId = text('projectId', 40);
    if (projectId === null || (projectId && !uuid.safeParse(projectId).success)) {
      return reply.code(400).send({ error: 'INVALID_FILTER' });
    }
    if (projectId) add('t.project_id = ?', projectId);

    const status = text('status', 20);
    if (status === null || (status && !STATUSES.includes(status as (typeof STATUSES)[number]))) {
      return reply.code(400).send({ error: 'INVALID_FILTER' });
    }
    if (status) add('t.status = ?', status);

    const client = text('client', 80);
    if (client === null) return reply.code(400).send({ error: 'INVALID_FILTER' });
    if (client) add('p.client_label = ?', client);

    const page = text('page', 120);
    if (page === null) return reply.code(400).send({ error: 'INVALID_FILTER' });
    if (page) add("t.page_url ILIKE '%' || ? || '%' ESCAPE '\\'", escapeLikePattern(page));

    const format = text('format', 10);
    if (format === null || (format && format !== 'mobile' && format !== 'desktop')) {
      return reply.code(400).send({ error: 'INVALID_FILTER' });
    }
    if (format === 'mobile') clauses.push('t.viewport_width < 768');
    if (format === 'desktop') clauses.push('t.viewport_width >= 768');

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = await db.query(
      `SELECT t.id, t.project_id AS "projectId", p.name AS "projectName", p.client_label AS "clientLabel",
              t.text, t.response, t.status, t.page_url AS "pageUrl", t.anchor,
              t.viewport_width AS "viewportWidth", t.diagnostics, t.screenshot_id AS "screenshotId",
              t.created_at AS "createdAt", t.updated_at AS "updatedAt"
       FROM tickets t JOIN projects p ON p.id = t.project_id
       ${where}
       ORDER BY t.created_at DESC
       LIMIT 500`,
      values,
    );
    return { tickets: rows.rows };
  });

  app.patch('/api/tickets/:id', { preHandler: requireAdminWrite }, async (req, reply) => {
    const parsed = ticketPatch.safeParse(req.body);
    const id = (req.params as { id: string }).id;
    if (!parsed.success || !uuid.safeParse(id).success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const rows = await db.query<{ status: string; response: string }>(
      `UPDATE tickets
       SET status = COALESCE($2, status), response = COALESCE($3, response), updated_at = now()
       WHERE id = $1
       RETURNING status, response`,
      [id, parsed.data.status ?? null, parsed.data.response ?? null],
    );
    const row = rows.rows[0];
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND' });
    return { id, status: row.status, response: row.response };
  });

  app.addHook('onClose', async () => {
    await db.close();
  });

  return app;
}

export { StorageError };
