import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildApp, type App } from './app.js';
import { loadConfig } from './config.js';

/**
 * One Fastify instance per serverless container, cached on `globalThis` so a
 * warm invocation reuses the already-built app (and, through it, the pooled
 * PostgreSQL connection and the memoised migration check). A cold start pays
 * the build once; every subsequent request on that container pays nothing.
 */
const APP_CACHE = Symbol.for('reviewdesk.serverless.app');

type Cache = { app?: Promise<App> };

function cache(): Cache {
  const holder = globalThis as unknown as Record<symbol, Cache | undefined>;
  const existing = holder[APP_CACHE];
  if (existing) return existing;
  const created: Cache = {};
  holder[APP_CACHE] = created;
  return created;
}

export function getApp(): Promise<App> {
  const slot = cache();
  if (!slot.app) {
    slot.app = buildApp(loadConfig())
      .then(async (app) => {
        await app.ready();
        return app;
      })
      .catch((error) => {
        // Do not cache a failed boot: the next invocation should retry, e.g.
        // after the database wakes up from a cold managed instance.
        slot.app = undefined;
        throw error;
      });
  }
  return slot.app;
}

/**
 * Node request handler for a serverless platform. `server.emit('request', …)`
 * hands the untouched `IncomingMessage` to Fastify, which is what keeps
 * streamed multipart uploads working: nothing reads `req.body` first.
 */
export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let app: App;
  try {
    app = await getApp();
  } catch (error) {
    process.stderr.write(`reviewdesk boot failed: ${(error as Error).message}\n`);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify({ error: 'INTERNAL' }));
    return;
  }
  app.server.emit('request', req, res);
}
