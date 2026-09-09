import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleRequest } from '../src/serverless.js';

/**
 * Vercel Serverless Function entry point. `vercel.json` rewrites `/api/*` and
 * `/health` here; every other path is answered from `public/` by the CDN before
 * this function is ever invoked.
 */
export default function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return handleRequest(req, res);
}
