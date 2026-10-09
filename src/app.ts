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
import { accentTokens, normaliseHex } from './brand-tokens.js';
import { EMAIL_DELIVERY_NOTE, brandingInput, readBranding, writeBranding } from './branding.js';
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

/**
 * Outgoing notifications are https-only. The URL is admin-supplied and the
 * server fetches it, so this is a deliberate, narrow SSRF surface: requiring TLS
 * and refusing loopback / link-local literals rules out the easy cases. A
 * hostname that resolves to a private address still gets through, which is
 * acceptable while the only person who can set it is the instance's own admin.
 */
const PRIVATE_HOSTS = /^(localhost|127\.|0\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/i;
const webhookUrl = z
  .string()
  .trim()
  .max(500)
  .refine((value) => {
    if (value === '') return true;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !PRIVATE_HOSTS.test(url.hostname);
    } catch {
      return false;
    }
  }, 'not a public https URL');

const projectInput = z.object({
  name: z.string().trim().min(2).max(80),
  clientLabel: z.string().trim().min(2).max(80),
  origins: z.array(httpUrl).min(1).max(20),
  webhookUrl: webhookUrl.optional(),
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
  .object({
    status: z.enum(STATUSES).optional(),
    response: z.string().max(4_000).optional(),
    replyText: z.string().max(4_000).optional(),
  })
  .refine(
    (value) => value.status !== undefined || value.response !== undefined || value.replyText !== undefined,
    'empty patch',
  );

const commentInput = z.object({
  body: z.string().trim().min(1).max(4_000),
  visibility: z.enum(['internal', 'reviewer']).optional(),
});
/** An agent may change the status and log what it did in a single call. */
const agentTicketPatch = z
  .object({
    status: z.enum(STATUSES).optional(),
    comment: z.string().trim().max(4_000).optional(),
    visibility: z.enum(['internal', 'reviewer']).optional(),
  })
  .refine((value) => value.status !== undefined || (value.comment ?? '') !== '', 'empty patch');
const fixRequestInput = z.object({ agent: z.string().trim().max(80).optional() });
const agentTokenInput = z.object({
  label: z.string().trim().max(80).optional(),
  projectId: uuid.optional(),
  scope: z.enum(['read', 'write']).optional(),
});

/** A ticket row as both the admin list and the agent API return it. */
type TicketRow = { id: string; createdAt: string; commentCount?: number | string; [key: string]: unknown };

type AdminSession = { tokenHash: string; csrfToken: string };
type ReviewerGrant = { projectId: string; origin: string; tokenHash: string };
/** `projectId: null` means the token sees every project on the instance. */
type AgentGrant = { id: string; projectId: string | null; scope: 'read' | 'write'; label: string; tokenHash: string };

declare module 'fastify' {
  interface FastifyRequest {
    adminSession?: AdminSession;
    agentGrant?: AgentGrant;
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

  // --------------------------------------------------------------- webhooks

  /**
   * Awaited on purpose, with a short timeout. A serverless instance is frozen
   * the moment it answers, so a detached promise would usually never run; the
   * reviewer pays a bounded delay instead of the notification silently never
   * arriving. A failing webhook must never fail the submission it reports, so
   * everything here is swallowed and logged.
   */
  async function notify(req: FastifyRequest, projectId: string, ticket: Record<string, unknown>): Promise<void> {
    const rows = await db.query<{ webhook_url: string; name: string; client_label: string }>(
      'SELECT webhook_url, name, client_label FROM projects WHERE id = $1',
      [projectId],
    );
    const project = rows.rows[0];
    if (!project?.webhook_url) return;
    try {
      const response = await fetch(project.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'ReviewDesk' },
        body: JSON.stringify({
          event: (ticket.event as string) || 'feedback.created',
          project: { id: projectId, name: project.name, clientLabel: project.client_label },
          ticket,
        }),
        signal: AbortSignal.timeout(config.webhookTimeoutMs),
        redirect: 'error',
      });
      if (!response.ok) req.log.warn({ status: response.status, projectId }, 'webhook rejected');
    } catch (error) {
      // The URL is admin-supplied; log the failure, never the response body.
      req.log.warn({ err: error, projectId }, 'webhook failed');
    }
  }

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
      .header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
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

  // ------------------------------------------------------------ white-label

  /**
   * Unauthenticated on purpose: the sign-in screen has to be branded before
   * anyone has signed in, and the widget reads the same endpoint. Only the
   * parts already visible on that screen are exposed — the configured email
   * identity stays behind `requireAdmin`, because a logged-out visitor has no
   * business enumerating the operator's addresses.
   */
  app.get('/api/branding', async (req, reply) => {
    const branding = await readBranding(db);
    reply.header('Cache-Control', 'no-store');
    return {
      productName: branding.productName,
      tagline: branding.tagline,
      logoDataUri: branding.logoDataUri,
      accent: branding.accent,
      tokens: accentTokens(branding.accent),
      setupComplete: branding.setupCompletedAt !== null,
    };
  });

  app.get('/api/branding/settings', { preHandler: requireAdmin }, async () => {
    const branding = await readBranding(db);
    return { ...branding, tokens: accentTokens(branding.accent), emailDeliveryNote: EMAIL_DELIVERY_NOTE };
  });

  app.put('/api/branding', { preHandler: requireAdminWrite }, async (req, reply) => {
    const parsed = brandingInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    if (!normaliseHex(parsed.data.accent)) return reply.code(400).send({ error: 'INVALID_ACCENT' });
    const branding = await writeBranding(db, parsed.data);
    return { ...branding, tokens: accentTokens(branding.accent), emailDeliveryNote: EMAIL_DELIVERY_NOTE };
  });

  app.get('/api/projects', { preHandler: requireAdmin }, async () => {
    // openCount is what the sidebar badges show. It counts every ticket that is
    // not DONE, independently of the filters in force, so the badge means the
    // same thing whatever the operator is currently looking at.
    // The project cards of the home screen read the rest: what waits in each
    // status, when the last ticket came in, and whether the widget has ever
    // called home (a review link used at least once).
    const rows = await db.query(
      `SELECT p.id, p.name, p.client_label AS "clientLabel", p.origins, p.webhook_url AS "webhookUrl",
              p.created_at AS "createdAt",
              COUNT(t.id) FILTER (WHERE t.status <> 'DONE') AS "openCount",
              COUNT(t.id) FILTER (WHERE t.status = 'TODO') AS "todoCount",
              COUNT(t.id) FILTER (WHERE t.status = 'IN_PROGRESS') AS "inProgressCount",
              COUNT(t.id) FILTER (WHERE t.status = 'REVIEW') AS "reviewCount",
              COUNT(t.id) FILTER (WHERE t.fix_requested_at IS NOT NULL) AS "fixRequestedCount",
              MAX(t.created_at) AS "lastTicketAt",
              (SELECT MAX(l.last_used_at) FROM review_links l WHERE l.project_id = p.id) AS "widgetSeenAt",
              -- The latest capture stands in for a preview of the site on its card.
              (SELECT s.screenshot_id FROM tickets s WHERE s.project_id = p.id AND s.screenshot_id IS NOT NULL
               ORDER BY s.created_at DESC LIMIT 1) AS "previewShotId"
       FROM projects p LEFT JOIN tickets t ON t.project_id = p.id
       GROUP BY p.id
       ORDER BY p.created_at`,
    );
    const counts = ['openCount', 'todoCount', 'inProgressCount', 'reviewCount', 'fixRequestedCount'];
    return rows.rows.map((row) => {
      const project = { ...(row as Record<string, unknown>) };
      for (const key of counts) project[key] = Number(project[key] ?? 0);
      return project;
    });
  });

  /** Returns the canonical origins, or an error code the caller should send back. */
  function normaliseOrigins(input: string[]): { origins: string[] } | { error: string } {
    let origins: string[];
    try {
      origins = input.map((value) => {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('scheme');
        return url.origin;
      });
    } catch {
      return { error: 'INVALID_ORIGIN' };
    }
    if (origins.some((origin) => origin === 'null')) return { error: 'INVALID_ORIGIN' };
    if (new Set(origins).size !== origins.length) return { error: 'DUPLICATE_ORIGIN' };
    return { origins };
  }

  app.post('/api/projects', { preHandler: requireAdminWrite }, async (req, reply) => {
    const parsed = projectInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const normalised = normaliseOrigins(parsed.data.origins);
    if ('error' in normalised) return reply.code(400).send({ error: normalised.error });
    const { origins } = normalised;
    const id = randomUUID();
    const hook = parsed.data.webhookUrl ?? '';
    await db.query('INSERT INTO projects(id, name, client_label, origins, webhook_url) VALUES ($1, $2, $3, $4, $5)', [
      id,
      parsed.data.name,
      parsed.data.clientLabel,
      JSON.stringify(origins),
      hook,
    ]);
    return reply
      .code(201)
      .send({ id, name: parsed.data.name, clientLabel: parsed.data.clientLabel, origins, webhookUrl: hook, openCount: 0 });
  });

  app.patch('/api/projects/:id', { preHandler: requireAdminWrite }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const parsed = projectInput.safeParse(req.body);
    if (!uuid.safeParse(id).success || !parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const normalised = normaliseOrigins(parsed.data.origins);
    if ('error' in normalised) return reply.code(400).send({ error: normalised.error });
    const { origins } = normalised;
    const hook = parsed.data.webhookUrl ?? '';
    const rows = await db.query<{ id: string }>(
      `UPDATE projects SET name = $2, client_label = $3, origins = $4, webhook_url = $5
       WHERE id = $1 RETURNING id`,
      [id, parsed.data.name, parsed.data.clientLabel, JSON.stringify(origins), hook],
    );
    if (!rows.rows.length) return reply.code(404).send({ error: 'NOT_FOUND' });
    return { id, name: parsed.data.name, clientLabel: parsed.data.clientLabel, origins, webhookUrl: hook };
  });

  app.delete('/api/projects/:id', { preHandler: requireAdminWrite }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!uuid.safeParse(id).success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const uploads = await db.query<{ storage_key: string }>(
      'SELECT storage_key FROM uploads WHERE project_id = $1',
      [id],
    );
    for (const u of uploads.rows) {
      if (u.storage_key) {
        await store.delete(u.storage_key).catch(() => {});
      }
    }
    const rows = await db.query<{ id: string }>(
      'DELETE FROM projects WHERE id = $1 RETURNING id',
      [id],
    );
    if (!rows.rows.length) return reply.code(404).send({ error: 'NOT_FOUND' });
    return reply.code(204).send();
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

  // ------------------------------------------------------- ticket work log

  const COMMENT_COLUMNS = `id, author, author_label AS "authorLabel", body, visibility,
                           status_from AS "statusFrom", status_to AS "statusTo", created_at AS "createdAt"`;

  async function loadComments(ticketId: string) {
    const rows = await db.query(
      `SELECT ${COMMENT_COLUMNS} FROM ticket_comments WHERE ticket_id = $1 ORDER BY created_at, id`,
      [ticketId],
    );
    return rows.rows;
  }

  /**
   * Appends one entry to a ticket's work log. A comment marked `reviewer` is
   * also written to `tickets.reply_text`, which is the single field the widget
   * reads: publishing an answer stays one deliberate act, and an internal
   * comment can never become visible after the fact.
   */
  async function addComment(input: {
    ticketId: string;
    author: 'admin' | 'agent';
    authorLabel: string;
    body: string;
    visibility: 'internal' | 'reviewer';
    statusFrom?: string | null;
    statusTo?: string | null;
  }) {
    const id = randomUUID();
    const rows = await db.query(
      `INSERT INTO ticket_comments(id, ticket_id, author, author_label, body, visibility, status_from, status_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${COMMENT_COLUMNS}`,
      [
        id,
        input.ticketId,
        input.author,
        input.authorLabel,
        input.body,
        input.visibility,
        input.statusFrom ?? null,
        input.statusTo ?? null,
      ],
    );
    if (input.visibility === 'reviewer') {
      await db.query('UPDATE tickets SET reply_text = $2, updated_at = now() WHERE id = $1', [
        input.ticketId,
        input.body,
      ]);
    }
    return rows.rows[0];
  }

  /**
   * Reclaims object storage and database space as soon as a ticket is closed (DONE).
   * Prevents storage saturation over time while preserving the ticket and its comment history.
   */
  async function cleanupTicketScreenshot(ticketId: string): Promise<void> {
    try {
      const ticketRes = await db.query<{ screenshot_id: string | null }>(
        'SELECT screenshot_id FROM tickets WHERE id = $1',
        [ticketId],
      );
      const screenshotId = ticketRes.rows[0]?.screenshot_id;
      if (!screenshotId) return;

      const uploadRes = await db.query<{ storage_key: string }>(
        'SELECT storage_key FROM uploads WHERE id = $1',
        [screenshotId],
      );
      const storageKey = uploadRes.rows[0]?.storage_key;
      if (storageKey) {
        try {
          await store.delete(storageKey);
        } catch {
          // best-effort storage cleanup
        }
      }
      await db.query('UPDATE tickets SET screenshot_id = NULL WHERE id = $1', [ticketId]);
      await db.query('DELETE FROM uploads WHERE id = $1', [screenshotId]);
    } catch {
      // best-effort cleanup
    }
  }

  const reviewerFeedbackActionInput = z.object({
    comment: z.string().max(2000).optional(),
  });

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
    await notify(req, grant.projectId, {
      id,
      text: parsed.data.text,
      pageUrl: cleanUrl(parsed.data.pageUrl),
      selector: parsed.data.anchor.selector,
      viewportWidth: parsed.data.anchor.viewport.width,
      status: 'TODO',
    });
    return allowOrigin(reply, grant.origin).code(201).send({ id });
  });

  /**
   * The reviewer's own view of a project's tickets, authorised by the same
   * bearer link used to file them. It exposes `replyText` and never `response`:
   * the internal note must not become visible by adding a read route.
   */
  app.get('/api/feedback', async (req, reply) => {
    const projectId = (req.query as { projectId?: unknown }).projectId;
    if (typeof projectId !== 'string') return reply.code(403).send({ error: 'FORBIDDEN' });
    const grant = await authoriseReviewer(req, projectId);
    if (!grant) return reply.code(403).send({ error: 'FORBIDDEN' });
    const rows = await db.query(
      `SELECT id, text, status, reply_text AS "replyText", page_url AS "pageUrl",
              anchor, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM tickets WHERE project_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [grant.projectId],
    );
    return allowOrigin(reply, grant.origin).send({ tickets: rows.rows });
  });

  app.post('/api/feedback/:id/resolve', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!uuid.safeParse(id).success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const projectId = (req.query as { projectId?: unknown }).projectId;
    if (typeof projectId !== 'string' || !uuid.safeParse(projectId).success) {
      return reply.code(403).send({ error: 'FORBIDDEN' });
    }
    const grant = await authoriseReviewer(req, projectId);
    if (!grant) return reply.code(403).send({ error: 'FORBIDDEN' });
    if (await overLimit(`feedback:${grant.tokenHash}`, config.submissionsPerMinute)) {
      return allowOrigin(reply, grant.origin).code(429).send({ error: 'RATE_LIMITED' });
    }
    const parsed = reviewerFeedbackActionInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      return allowOrigin(reply, grant.origin).code(400).send({ error: 'INVALID_INPUT' });
    }
    const ticketRows = await db.query<{ id: string; status: string; page_url: string; text: string }>(
      'SELECT id, status, page_url, text FROM tickets WHERE id = $1 AND project_id = $2',
      [id, grant.projectId],
    );
    const ticket = ticketRows.rows[0];
    if (!ticket) return allowOrigin(reply, grant.origin).code(404).send({ error: 'NOT_FOUND' });

    await db.query('UPDATE tickets SET status = $2, updated_at = now() WHERE id = $1', [id, 'DONE']);
    await cleanupTicketScreenshot(id);
    const commentBody = parsed.data.comment?.trim() || 'Validation confirmée par le client.';
    const comment = await addComment({
      ticketId: id,
      author: 'admin',
      authorLabel: 'Client (Reviewer)',
      body: commentBody,
      visibility: 'reviewer',
      statusFrom: ticket.status,
      statusTo: 'DONE',
    });

    await notify(req, grant.projectId, {
      id,
      text: ticket.text,
      pageUrl: ticket.page_url,
      status: 'DONE',
      event: 'feedback.resolved',
    });

    return allowOrigin(reply, grant.origin).code(200).send({ id, status: 'DONE', comment });
  });

  app.post('/api/feedback/:id/reopen', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!uuid.safeParse(id).success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const projectId = (req.query as { projectId?: unknown }).projectId;
    if (typeof projectId !== 'string' || !uuid.safeParse(projectId).success) {
      return reply.code(403).send({ error: 'FORBIDDEN' });
    }
    const grant = await authoriseReviewer(req, projectId);
    if (!grant) return reply.code(403).send({ error: 'FORBIDDEN' });
    if (await overLimit(`feedback:${grant.tokenHash}`, config.submissionsPerMinute)) {
      return allowOrigin(reply, grant.origin).code(429).send({ error: 'RATE_LIMITED' });
    }
    const parsed = reviewerFeedbackActionInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      return allowOrigin(reply, grant.origin).code(400).send({ error: 'INVALID_INPUT' });
    }
    const ticketRows = await db.query<{ id: string; status: string; page_url: string; text: string }>(
      'SELECT id, status, page_url, text FROM tickets WHERE id = $1 AND project_id = $2',
      [id, grant.projectId],
    );
    const ticket = ticketRows.rows[0];
    if (!ticket) return allowOrigin(reply, grant.origin).code(404).send({ error: 'NOT_FOUND' });

    await db.query('UPDATE tickets SET status = $2, updated_at = now() WHERE id = $1', [id, 'TODO']);
    const commentBody = parsed.data.comment?.trim() || 'Ajustement demandé par le client.';
    const comment = await addComment({
      ticketId: id,
      author: 'admin',
      authorLabel: 'Client (Reviewer)',
      body: commentBody,
      visibility: 'reviewer',
      statusFrom: ticket.status,
      statusTo: 'TODO',
    });

    await notify(req, grant.projectId, {
      id,
      text: ticket.text,
      pageUrl: ticket.page_url,
      status: 'TODO',
      event: 'feedback.reopened',
    });

    return allowOrigin(reply, grant.origin).code(200).send({ id, status: 'TODO', comment });
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

  /**
   * One filtered, keyset-paginated page of tickets. Shared by the admin list and
   * by the agent API so both answer the same filters with the same semantics;
   * `restrictProjectId` is the caller's own scope and is never overridable by a
   * query parameter.
   */
  async function ticketPage(
    query: Record<string, unknown>,
    restrictProjectId: string | null,
  ): Promise<{ error: string } | { tickets: TicketRow[]; total: number; nextCursor: string | null }> {
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

    // The caller's own scope first: a project-scoped agent token cannot widen
    // itself by passing a projectId of its choosing.
    if (restrictProjectId) add('t.project_id = ?', restrictProjectId);
    const projectId = text('projectId', 40);
    if (projectId === null || (projectId && !uuid.safeParse(projectId).success)) return { error: 'INVALID_FILTER' };
    if (projectId && projectId !== restrictProjectId) {
      if (restrictProjectId) return { error: 'FORBIDDEN_PROJECT' };
      add('t.project_id = ?', projectId);
    }

    const status = text('status', 20);
    if (status === null || (status && !STATUSES.includes(status as (typeof STATUSES)[number]))) {
      return { error: 'INVALID_FILTER' };
    }
    if (status) add('t.status = ?', status);

    const client = text('client', 80);
    if (client === null) return { error: 'INVALID_FILTER' };
    if (client) add('p.client_label = ?', client);

    const page = text('page', 120);
    if (page === null) return { error: 'INVALID_FILTER' };
    if (page) add("t.page_url ILIKE '%' || ? || '%' ESCAPE '\\'", escapeLikePattern(page));

    const format = text('format', 10);
    if (format === null || (format && format !== 'mobile' && format !== 'desktop')) return { error: 'INVALID_FILTER' };
    if (format === 'mobile') clauses.push('t.viewport_width < 768');
    if (format === 'desktop') clauses.push('t.viewport_width >= 768');

    // Tickets the team asked an agent to fix.
    const requested = text('requested', 5);
    if (requested === null || (requested && requested !== '1' && requested !== 'true')) return { error: 'INVALID_FILTER' };
    if (requested) clauses.push('t.fix_requested_at IS NOT NULL');

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    // `total` is counted before paging so the header can state how many tickets
    // match, rather than how many happen to be loaded. The previous LIMIT 500
    // truncated silently once a project crossed it.
    const totals = await db.query<{ total: string }>(
      `SELECT COUNT(*) AS total FROM tickets t JOIN projects p ON p.id = t.project_id ${where}`,
      values,
    );

    const limit = Math.min(200, Math.max(1, Number(text('limit', 4) ?? 60) || 60));
    // Keyset rather than OFFSET: a ticket filed while the operator pages must
    // not shift the window and hide a row.
    const cursor = text('cursor', 80);
    if (cursor === null) return { error: 'INVALID_FILTER' };
    const paged = [...clauses];
    if (cursor) {
      const [createdAt, id] = cursor.split('|');
      if (!createdAt || !id || Number.isNaN(Date.parse(createdAt)) || !uuid.safeParse(id).success) {
        return { error: 'INVALID_FILTER' };
      }
      values.push(createdAt, id);
      paged.push(`(t.created_at, t.id) < ($${values.length - 1}::timestamptz, $${values.length})`);
    }

    values.push(limit + 1);
    const rows = await db.query<TicketRow>(
      `SELECT t.id, t.project_id AS "projectId", p.name AS "projectName", p.client_label AS "clientLabel",
              t.text, t.response, t.reply_text AS "replyText", t.status, t.page_url AS "pageUrl", t.anchor,
              t.viewport_width AS "viewportWidth", t.diagnostics, t.screenshot_id AS "screenshotId",
              t.created_at AS "createdAt", t.updated_at AS "updatedAt",
              t.fix_requested_at AS "fixRequestedAt", t.fix_requested_for AS "fixRequestedFor",
              (SELECT COUNT(*) FROM ticket_comments c WHERE c.ticket_id = t.id) AS "commentCount"
       FROM tickets t JOIN projects p ON p.id = t.project_id
       ${paged.length ? `WHERE ${paged.join(' AND ')}` : ''}
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT $${values.length}`,
      values,
    );

    // One row over the limit is fetched purely to know whether more exist.
    const hasMore = rows.rows.length > limit;
    const tickets = (hasMore ? rows.rows.slice(0, limit) : rows.rows).map((row) => ({
      ...row,
      commentCount: Number(row.commentCount ?? 0),
    }));
    const last = tickets[tickets.length - 1];
    return {
      tickets,
      total: Number(totals.rows[0]?.total ?? tickets.length),
      nextCursor: hasMore && last ? `${new Date(last.createdAt).toISOString()}|${last.id}` : null,
    };
  }

  app.get('/api/tickets', { preHandler: requireAdmin }, async (req, reply) => {
    const page = await ticketPage(req.query as Record<string, unknown>, null);
    if ('error' in page) return reply.code(400).send({ error: page.error });
    return page;
  });

  app.patch('/api/tickets/:id', { preHandler: requireAdminWrite }, async (req, reply) => {
    const parsed = ticketPatch.safeParse(req.body);
    const id = (req.params as { id: string }).id;
    if (!parsed.success || !uuid.safeParse(id).success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const rows = await db.query<{ status: string; response: string; replyText: string }>(
      `UPDATE tickets
       SET status = COALESCE($2, status), response = COALESCE($3, response),
           reply_text = COALESCE($4, reply_text), updated_at = now(),
           -- A fix request is answered once the ticket reaches review or done.
           fix_requested_at = CASE WHEN COALESCE($2, status) IN ('REVIEW', 'DONE') THEN NULL ELSE fix_requested_at END
       WHERE id = $1
       RETURNING status, response, reply_text AS "replyText"`,
      [id, parsed.data.status ?? null, parsed.data.response ?? null, parsed.data.replyText ?? null],
    );
    const row = rows.rows[0];
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND' });
    if (row.status === 'DONE') {
      await cleanupTicketScreenshot(id);
    }
    return { id, status: row.status, response: row.response, replyText: row.replyText };
  });

  /**
   * « Lancer la correction »: queues the ticket for an agent. MCP cannot wake a
   * local agent, so this is a request the agent collects (`requested=1` on the
   * agent API, `next_fix_request` over MCP), traced in the work log.
   */
  app.post('/api/tickets/:id/fix-request', { preHandler: requireAdminWrite }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const parsed = fixRequestInput.safeParse(req.body ?? {});
    if (!parsed.success || !uuid.safeParse(id).success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const before = await loadTicket(id, null);
    if (!before) return reply.code(404).send({ error: 'NOT_FOUND' });
    // Work starts now: a ticket still waiting moves to « en cours ».
    const status = before.status === 'TODO' ? 'IN_PROGRESS' : before.status;
    const agent = parsed.data.agent ?? '';
    const rows = await db.query<{ fixRequestedAt: string }>(
      `UPDATE tickets SET fix_requested_at = now(), fix_requested_for = $2, status = $3, updated_at = now()
       WHERE id = $1 RETURNING fix_requested_at AS "fixRequestedAt"`,
      [id, agent, status],
    );
    await addComment({
      ticketId: id,
      author: 'admin',
      authorLabel: 'Équipe',
      body: agent ? `Correction demandée à ${agent}.` : 'Correction demandée à un agent.',
      visibility: 'internal',
      statusFrom: before.status,
      statusTo: status,
    });
    return reply.code(201).send({ id, status, fixRequestedAt: rows.rows[0]?.fixRequestedAt, fixRequestedFor: agent });
  });

  app.delete('/api/tickets/:id/fix-request', { preHandler: requireAdminWrite }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!uuid.safeParse(id).success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const rows = await db.query(
      `UPDATE tickets SET fix_requested_at = NULL, fix_requested_for = '', updated_at = now() WHERE id = $1 RETURNING id`,
      [id],
    );
    if (!rows.rows.length) return reply.code(404).send({ error: 'NOT_FOUND' });
    return { id, fixRequestedAt: null };
  });

  // ------------------------------------------------------------ onboarding

  /**
   * How far this instance is from being set up, in one cheap request. Derived
   * entirely from what already exists — nothing is stored about progress, so a
   * reset instance tells the truth and a finished one never nags.
   */
  app.get('/api/onboarding', { preHandler: requireAdmin }, async () => {
    const rows = await db.query<Record<string, string>>(
      `SELECT
         (SELECT COUNT(*) FROM projects) AS projects,
         (SELECT COUNT(*) FROM review_links WHERE revoked_at IS NULL) AS "reviewLinks",
         (SELECT COUNT(*) FROM tickets) AS tickets,
         (SELECT COUNT(*) FROM agent_tokens WHERE revoked_at IS NULL) AS "agentTokens",
         (SELECT COUNT(*) FROM agent_tokens WHERE revoked_at IS NULL AND last_used_at IS NOT NULL) AS "connectedAgents"`,
    );
    const row = rows.rows[0] ?? {};
    const count = (key: string) => Number(row[key] ?? 0);
    return {
      projects: count('projects'),
      reviewLinks: count('reviewLinks'),
      tickets: count('tickets'),
      agentTokens: count('agentTokens'),
      connectedAgents: count('connectedAgents'),
    };
  });

  // ----------------------------------------------------------------- stats

  /**
   * Everything the overview draws, in one request. Scoped to a project when the
   * operator has one selected, so the numbers always describe what the rest of
   * the screen is about. `days` bounds the period; the same length immediately
   * before it is measured too, which is what makes a delta meaningful.
   */
  app.get('/api/stats', { preHandler: requireAdmin }, async (req, reply) => {
    const query = req.query as Record<string, unknown>;
    const projectId = typeof query.projectId === 'string' && query.projectId ? query.projectId : null;
    if (projectId && !uuid.safeParse(projectId).success) return reply.code(400).send({ error: 'INVALID_FILTER' });
    const days = Number(query.days ?? 30);
    if (![7, 30, 90].includes(days)) return reply.code(400).send({ error: 'INVALID_FILTER' });

    const since = new Date(Date.now() - days * 86_400_000);
    const previousSince = new Date(Date.now() - 2 * days * 86_400_000);
    // One scope clause, reused: `$1 IS NULL` keeps a single SQL shape for both
    // "all projects" and one project rather than two branches per query.
    const scope = 't.project_id = COALESCE($1, t.project_id)';
    const params = [projectId] as unknown[];

    const statuses = await db.query<{ status: string; count: string }>(
      `SELECT status, COUNT(*) AS count FROM tickets t WHERE ${scope} GROUP BY status`,
      params,
    );

    const totals = await db.query<Record<string, string | null>>(
      `SELECT
         COUNT(*) FILTER (WHERE t.created_at >= $2) AS received,
         COUNT(*) FILTER (WHERE t.created_at >= $3 AND t.created_at < $2) AS "receivedPrevious",
         COUNT(*) FILTER (WHERE t.status = 'DONE' AND t.updated_at >= $2) AS resolved,
         COUNT(*) FILTER (WHERE t.status = 'DONE' AND t.updated_at >= $3 AND t.updated_at < $2) AS "resolvedPrevious",
         AVG(EXTRACT(EPOCH FROM (t.updated_at - t.created_at)))
           FILTER (WHERE t.status = 'DONE' AND t.updated_at >= $2) AS "resolutionSeconds",
         COUNT(*) FILTER (WHERE t.status <> 'DONE' AND t.created_at < now() - interval '7 days') AS stale,
         MIN(t.created_at) FILTER (WHERE t.status = 'TODO') AS "oldestTodo"
       FROM tickets t WHERE ${scope}`,
      [...params, since, previousSince],
    );

    // Two grouped queries rather than a generate_series join: the gaps are
    // filled client-side, where the chart already knows the calendar it draws.
    const receivedDaily = await db.query<{ day: string; count: string }>(
      `SELECT to_char(t.created_at, 'YYYY-MM-DD') AS day, COUNT(*) AS count
       FROM tickets t WHERE ${scope} AND t.created_at >= $2 GROUP BY 1`,
      [...params, since],
    );
    const resolvedDaily = await db.query<{ day: string; count: string }>(
      `SELECT to_char(t.updated_at, 'YYYY-MM-DD') AS day, COUNT(*) AS count
       FROM tickets t WHERE ${scope} AND t.status = 'DONE' AND t.updated_at >= $2 GROUP BY 1`,
      [...params, since],
    );

    const projectRows = await db.query<Record<string, string>>(
      `SELECT p.id, p.name, p.client_label AS "clientLabel",
              COUNT(t.id) FILTER (WHERE t.status = 'TODO') AS "todo",
              COUNT(t.id) FILTER (WHERE t.status = 'IN_PROGRESS') AS "inProgress",
              COUNT(t.id) FILTER (WHERE t.status = 'REVIEW') AS "review",
              COUNT(t.id) FILTER (WHERE t.status = 'DONE') AS "done",
              COUNT(t.id) AS "total"
       FROM projects p LEFT JOIN tickets t ON t.project_id = p.id
       WHERE p.id = COALESCE($1, p.id)
       GROUP BY p.id ORDER BY "todo" DESC, "total" DESC, p.name`,
      params,
    );

    const pages = await db.query<{ pageUrl: string; count: string; open: string }>(
      `SELECT t.page_url AS "pageUrl", COUNT(*) AS count,
              COUNT(*) FILTER (WHERE t.status <> 'DONE') AS open
       FROM tickets t WHERE ${scope} AND t.created_at >= $2
       GROUP BY 1 ORDER BY count DESC, 1 LIMIT 6`,
      [...params, since],
    );

    const activity = await db.query(
      `SELECT c.id, c.author, c.author_label AS "authorLabel", c.visibility,
              c.status_from AS "statusFrom", c.status_to AS "statusTo", c.created_at AS "createdAt",
              t.id AS "ticketId", t.text AS "ticketText"
       FROM ticket_comments c JOIN tickets t ON t.id = c.ticket_id
       WHERE ${scope}
       ORDER BY c.created_at DESC LIMIT 8`,
      params,
    );

    const byStatus = Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<string, number>;
    for (const row of statuses.rows) byStatus[row.status] = Number(row.count);
    const row = totals.rows[0] ?? {};
    const number = (value: string | null | undefined) => Number(value ?? 0);

    return {
      days,
      projectId,
      byStatus,
      total: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
      received: number(row.received),
      receivedPrevious: number(row.receivedPrevious),
      resolved: number(row.resolved),
      resolvedPrevious: number(row.resolvedPrevious),
      // Null rather than 0 when nothing was resolved: "no data" and "instant" are
      // not the same statement, and the card says so.
      resolutionSeconds: row.resolutionSeconds === null || row.resolutionSeconds === undefined
        ? null
        : Math.round(Number(row.resolutionSeconds)),
      stale: number(row.stale),
      oldestTodo: row.oldestTodo ?? null,
      daily: {
        received: Object.fromEntries(receivedDaily.rows.map((day) => [day.day, Number(day.count)])),
        resolved: Object.fromEntries(resolvedDaily.rows.map((day) => [day.day, Number(day.count)])),
      },
      projects: projectRows.rows.map((project) => ({
        ...project,
        todo: Number(project.todo),
        inProgress: Number(project.inProgress),
        review: Number(project.review),
        done: Number(project.done),
        total: Number(project.total),
      })),
      pages: pages.rows.map((page) => ({ ...page, count: Number(page.count), open: Number(page.open) })),
      activity: activity.rows,
    };
  });

  /** The ticket as an operator or an agent reads it, or null when out of scope. */
  async function loadTicket(id: string, restrictProjectId: string | null) {
    const rows = await db.query<{ id: string; status: string }>(
      `SELECT t.id, t.project_id AS "projectId", p.name AS "projectName", p.client_label AS "clientLabel",
              t.text, t.response, t.reply_text AS "replyText", t.status, t.page_url AS "pageUrl", t.anchor,
              t.viewport_width AS "viewportWidth", t.diagnostics, t.screenshot_id AS "screenshotId",
              t.created_at AS "createdAt", t.updated_at AS "updatedAt",
              t.fix_requested_at AS "fixRequestedAt", t.fix_requested_for AS "fixRequestedFor"
       FROM tickets t JOIN projects p ON p.id = t.project_id
       WHERE t.id = $1 ${restrictProjectId ? 'AND t.project_id = $2' : ''}`,
      restrictProjectId ? [id, restrictProjectId] : [id],
    );
    return rows.rows[0] ?? null;
  }

  app.get('/api/tickets/:id/comments', { preHandler: requireAdmin }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!uuid.safeParse(id).success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    if (!(await loadTicket(id, null))) return reply.code(404).send({ error: 'NOT_FOUND' });
    return { comments: await loadComments(id) };
  });

  app.post('/api/tickets/:id/comments', { preHandler: requireAdminWrite }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const parsed = commentInput.safeParse(req.body);
    if (!parsed.success || !uuid.safeParse(id).success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    if (!(await loadTicket(id, null))) return reply.code(404).send({ error: 'NOT_FOUND' });
    const comment = await addComment({
      ticketId: id,
      author: 'admin',
      authorLabel: 'Équipe',
      body: parsed.data.body,
      visibility: parsed.data.visibility ?? 'internal',
    });
    return reply.code(201).send(comment);
  });

  // --------------------------------------------------------- agent tokens

  app.get('/api/agent-tokens', { preHandler: requireAdmin }, async () => {
    const rows = await db.query(
      `SELECT a.id, a.label, a.scope, a.project_id AS "projectId", p.name AS "projectName",
              a.created_at AS "createdAt", a.last_used_at AS "lastUsedAt", a.revoked_at AS "revokedAt"
       FROM agent_tokens a LEFT JOIN projects p ON p.id = a.project_id
       ORDER BY a.created_at DESC`,
    );
    return { tokens: rows.rows };
  });

  app.post('/api/agent-tokens', { preHandler: requireAdminWrite }, async (req, reply) => {
    const parsed = agentTokenInput.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    if (parsed.data.projectId) {
      const project = await db.query('SELECT 1 FROM projects WHERE id = $1', [parsed.data.projectId]);
      if (!project.rows.length) return reply.code(404).send({ error: 'NOT_FOUND' });
    }
    // Prefixed so the secret is recognisable in a config file and greppable in a
    // leak; only the digest is stored, and the secret is shown exactly once.
    const token = `rda_${randomBytes(32).toString('base64url')}`;
    const id = randomUUID();
    await db.query(
      'INSERT INTO agent_tokens(id, project_id, token_hash, label, scope) VALUES ($1, $2, $3, $4, $5)',
      [id, parsed.data.projectId ?? null, hashToken(token), parsed.data.label ?? '', parsed.data.scope ?? 'write'],
    );
    return reply.code(201).send({ id, token, scope: parsed.data.scope ?? 'write' });
  });

  app.post('/api/agent-tokens/:id/revoke', { preHandler: requireAdminWrite }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!uuid.safeParse(id).success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const rows = await db.query<{ id: string }>(
      'UPDATE agent_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1 RETURNING id',
      [id],
    );
    if (!rows.rows.length) return reply.code(404).send({ error: 'NOT_FOUND' });
    return reply.code(204).send();
  });

  // ------------------------------------------------------------- agent API

  /**
   * Machine callers authenticate with a bearer token and nothing else: no
   * cookie, so no CSRF surface, and no Origin requirement since an agent is not
   * a browser. A `read` token is refused on every write, and a project-scoped
   * token can only ever see its own project's tickets and uploads.
   */
  function requireAgent(need: 'read' | 'write') {
    return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const authorization = req.headers.authorization;
      if (!authorization?.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'UNAUTHORIZED' });
      }
      const token = authorization.slice('Bearer '.length).trim();
      if (!token || token.length > 200) return reply.code(401).send({ error: 'UNAUTHORIZED' });
      const tokenHash = hashToken(token);
      if (await overLimit(`agent:${tokenHash}`, config.agentRequestsPerMinute)) {
        return reply.code(429).send({ error: 'RATE_LIMITED' });
      }
      const rows = await db.query<{ id: string; project_id: string | null; scope: 'read' | 'write'; label: string }>(
        `UPDATE agent_tokens SET last_used_at = now()
         WHERE token_hash = $1 AND revoked_at IS NULL
         RETURNING id, project_id, scope, label`,
        [tokenHash],
      );
      const row = rows.rows[0];
      if (!row) return reply.code(401).send({ error: 'UNAUTHORIZED' });
      if (need === 'write' && row.scope !== 'write') return reply.code(403).send({ error: 'READ_ONLY_TOKEN' });
      req.agentGrant = { id: row.id, projectId: row.project_id, scope: row.scope, label: row.label, tokenHash };
    };
  }

  /** What this token can see: its scope, and the projects with their backlog. */
  app.get('/api/agent/context', { preHandler: requireAgent('read') }, async (req) => {
    const grant = req.agentGrant!;
    const rows = await db.query(
      `SELECT p.id, p.name, p.client_label AS "clientLabel",
              COUNT(t.id) FILTER (WHERE t.status = 'TODO') AS "todo",
              COUNT(t.id) FILTER (WHERE t.status = 'IN_PROGRESS') AS "inProgress",
              COUNT(t.id) FILTER (WHERE t.status = 'REVIEW') AS "review",
              COUNT(t.id) FILTER (WHERE t.status = 'DONE') AS "done"
       FROM projects p LEFT JOIN tickets t ON t.project_id = p.id
       ${grant.projectId ? 'WHERE p.id = $1' : ''}
       GROUP BY p.id ORDER BY p.created_at`,
      grant.projectId ? [grant.projectId] : [],
    );
    return {
      token: { label: grant.label, scope: grant.scope, projectId: grant.projectId },
      statuses: STATUSES,
      projects: rows.rows.map((row) => {
        const counts = row as Record<string, string>;
        return {
          ...row,
          todo: Number(counts.todo),
          inProgress: Number(counts.inProgress),
          review: Number(counts.review),
          done: Number(counts.done),
        };
      }),
    };
  });

  app.get('/api/agent/tickets', { preHandler: requireAgent('read') }, async (req, reply) => {
    const page = await ticketPage(req.query as Record<string, unknown>, req.agentGrant!.projectId);
    if ('error' in page) {
      return reply.code(page.error === 'FORBIDDEN_PROJECT' ? 403 : 400).send({ error: page.error });
    }
    return page;
  });

  app.get('/api/agent/tickets/:id', { preHandler: requireAgent('read') }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!uuid.safeParse(id).success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const ticket = await loadTicket(id, req.agentGrant!.projectId);
    if (!ticket) return reply.code(404).send({ error: 'NOT_FOUND' });
    return { ...ticket, comments: await loadComments(id) };
  });

  app.post('/api/agent/tickets/:id/comments', { preHandler: requireAgent('write') }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const parsed = commentInput.safeParse(req.body);
    if (!parsed.success || !uuid.safeParse(id).success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const grant = req.agentGrant!;
    if (!(await loadTicket(id, grant.projectId))) return reply.code(404).send({ error: 'NOT_FOUND' });
    const comment = await addComment({
      ticketId: id,
      author: 'agent',
      authorLabel: grant.label || 'Agent',
      body: parsed.data.body,
      visibility: parsed.data.visibility ?? 'internal',
    });
    return reply.code(201).send(comment);
  });

  /**
   * The call an agent makes when it has finished a ticket: move the status and
   * say what was done, in one request. The comment is recorded with the status
   * transition attached, so the log reads as a history rather than a pile of
   * notes.
   */
  app.patch('/api/agent/tickets/:id', { preHandler: requireAgent('write') }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const parsed = agentTicketPatch.safeParse(req.body);
    if (!parsed.success || !uuid.safeParse(id).success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const grant = req.agentGrant!;
    const before = await loadTicket(id, grant.projectId);
    if (!before) return reply.code(404).send({ error: 'NOT_FOUND' });
    const status = parsed.data.status ?? before.status;
    if (parsed.data.status && parsed.data.status !== before.status) {
      await db.query(`UPDATE tickets SET status = $2, updated_at = now(),
                fix_requested_at = CASE WHEN $2 IN ('REVIEW', 'DONE') THEN NULL ELSE fix_requested_at END
         WHERE id = $1`, [id, parsed.data.status]);
      if (parsed.data.status === 'DONE') {
        await cleanupTicketScreenshot(id);
      }
    }
    const body = parsed.data.comment?.trim();
    const comment = body
      ? await addComment({
          ticketId: id,
          author: 'agent',
          authorLabel: grant.label || 'Agent',
          body,
          visibility: parsed.data.visibility ?? 'internal',
          statusFrom: before.status,
          statusTo: status,
        })
      : null;
    return { id, status, previousStatus: before.status, comment };
  });

  app.get('/api/agent/uploads/:id', { preHandler: requireAgent('read') }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!uuid.safeParse(id).success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const grant = req.agentGrant!;
    const rows = await db.query<{ storage_key: string; mime: string }>(
      `SELECT storage_key, mime FROM uploads WHERE id = $1 ${grant.projectId ? 'AND project_id = $2' : ''}`,
      grant.projectId ? [id, grant.projectId] : [id],
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
    return reply.type(row.mime).header('Cache-Control', 'private, no-store').send(object.body);
  });

  app.addHook('onClose', async () => {
    await db.close();
  });

  return app;
}

export { StorageError };
