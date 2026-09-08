import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { createDatabase } from './db.js';
import { cleanUrl, normalizeDiagnostics } from './privacy.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const safeEqual = (a: string, b: string) => { const x = Buffer.from(hash(a)); const y = Buffer.from(hash(b)); return timingSafeEqual(x, y); };
const projectInput = z.object({ name: z.string().min(2).max(80), clientLabel: z.string().min(2).max(80), origins: z.array(z.string().url()).min(1).max(20) });
const anchorSchema = z.object({ selector: z.string().min(1).max(500), relative: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }), viewport: z.object({ width: z.number().int().positive().max(10000), height: z.number().int().positive().max(10000) }) });
const feedbackInput = z.object({ projectId: z.string().uuid(), text: z.string().trim().min(2).max(4000), pageUrl: z.string().url().max(2000), anchor: anchorSchema, diagnostics: z.record(z.string(), z.unknown()).optional(), screenshotId: z.string().uuid().optional() });
const ticketPatch = z.object({ status: z.enum(['TODO','IN_PROGRESS','REVIEW','DONE']).optional(), response: z.string().max(4000).optional() }).refine(v => v.status !== undefined || v.response !== undefined);

type Options = { database: string; adminPassword: string; uploadDir: string };
export async function buildApp(options: Options) {
  if (options.adminPassword.length < 12) throw new Error('ADMIN_PASSWORD must contain at least 12 characters');
  const db = await createDatabase(options.database);
  await mkdir(options.uploadDir, { recursive: true });
  const app = Fastify({ logger: false, bodyLimit: 1_000_000 });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 5_000_000, files: 1, fields: 3 } });
  const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
  await app.register(staticPlugin, { root: publicDir, prefix: '/' });
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer').header('X-Frame-Options', 'DENY').header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    return payload;
  });
  const admin = async (req: FastifyRequest, reply: any) => {
    const token = req.cookies.rd_session;
    if (!token) return reply.code(401).send({ error: 'UNAUTHORIZED' });
    const rows = await db.query<{ ok: number }>('SELECT 1 AS ok FROM admin_sessions WHERE token_hash=$1 AND expires_at > now()', [hash(token)]);
    if (!rows.rows.length) return reply.code(401).send({ error: 'UNAUTHORIZED' });
  };
  async function reviewer(req: FastifyRequest, projectId: string) {
    const auth = req.headers.authorization;
    const origin = req.headers.origin;
    if (!auth?.startsWith('Bearer ') || !origin) return false;
    const rows = await db.query<{ project_id: string; origins: string[] }>(`SELECT l.project_id,p.origins FROM review_links l JOIN projects p ON p.id=l.project_id WHERE l.token_hash=$1 AND l.revoked_at IS NULL`, [hash(auth.slice(7))]);
    const row = rows.rows[0];
    return Boolean(row && row.project_id === projectId && row.origins.includes(origin));
  }
  app.options('/api/*', async (req, reply) => {
    const origin = req.headers.origin;
    if (!origin) return reply.code(403).send();
    reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin').header('Access-Control-Allow-Headers', 'Authorization, Content-Type').header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    return reply.code(204).send();
  });
  app.get('/health', async () => ({ ok: true, database: 'postgresql-pglite' }));
  app.post('/api/auth/login', async (req, reply) => {
    const parsed = z.object({ username: z.literal('admin'), password: z.string() }).safeParse(req.body);
    if (!parsed.success || !safeEqual(parsed.data.password, options.adminPassword)) return reply.code(401).send({ error: 'INVALID_CREDENTIALS' });
    const token = randomBytes(32).toString('base64url');
    await db.query('INSERT INTO admin_sessions(token_hash,expires_at) VALUES($1,now()+interval \'8 hours\')', [hash(token)]);
    reply.setCookie('rd_session', token, { path: '/', httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 28800 });
    return reply.code(204).send();
  });
  app.post('/api/auth/logout', { preHandler: admin }, async (req, reply) => {
    await db.query('DELETE FROM admin_sessions WHERE token_hash=$1', [hash(req.cookies.rd_session!)]);
    reply.clearCookie('rd_session', { path: '/' }); return reply.code(204).send();
  });
  app.get('/api/projects', { preHandler: admin }, async () => (await db.query('SELECT id,name,client_label AS "clientLabel",origins,created_at AS "createdAt" FROM projects ORDER BY created_at')).rows);
  app.post('/api/projects', { preHandler: admin }, async (req, reply) => {
    const parsed = projectInput.safeParse(req.body); if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    const origins = parsed.data.origins.map(o => new URL(o).origin);
    if (new Set(origins).size !== origins.length) return reply.code(400).send({ error: 'DUPLICATE_ORIGIN' });
    const id = randomUUID(); await db.query('INSERT INTO projects(id,name,client_label,origins) VALUES($1,$2,$3,$4)', [id, parsed.data.name, parsed.data.clientLabel, JSON.stringify(origins)]);
    return reply.code(201).send({ id, ...parsed.data, origins });
  });
  app.post('/api/projects/:id/review-links', { preHandler: admin }, async (req, reply) => {
    const id = (req.params as any).id; const exists = await db.query('SELECT 1 FROM projects WHERE id=$1', [id]); if (!exists.rows.length) return reply.code(404).send({ error: 'NOT_FOUND' });
    const token = randomBytes(32).toString('base64url'); const linkId = randomUUID(); await db.query('INSERT INTO review_links(id,project_id,token_hash) VALUES($1,$2,$3)', [linkId,id,hash(token)]);
    return reply.code(201).send({ id: linkId, token, fragment: `#project=${id}&review=${token}` });
  });
  app.delete('/api/review-links/:id', { preHandler: admin }, async (req, reply) => { await db.query('UPDATE review_links SET revoked_at=now() WHERE id=$1', [(req.params as any).id]); return reply.code(204).send(); });
  app.post('/api/feedback', async (req, reply) => {
    const parsed = feedbackInput.safeParse(req.body); if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT' });
    if (!(await reviewer(req, parsed.data.projectId))) return reply.code(403).send({ error: 'FORBIDDEN' });
    const rateKey = hash(req.headers.authorization!); const rate = await db.query<{ count: number }>(`INSERT INTO rate_limits(key,window_start,count) VALUES($1,date_trunc('minute',now()),1) ON CONFLICT(key) DO UPDATE SET window_start=CASE WHEN rate_limits.window_start < date_trunc('minute',now()) THEN date_trunc('minute',now()) ELSE rate_limits.window_start END,count=CASE WHEN rate_limits.window_start < date_trunc('minute',now()) THEN 1 ELSE rate_limits.count+1 END RETURNING count`, [rateKey]);
    if ((rate.rows[0]?.count ?? 99) > 20) return reply.code(429).send({ error: 'RATE_LIMITED' });
    if (parsed.data.screenshotId) { const owned = await db.query('SELECT 1 FROM uploads WHERE id=$1 AND project_id=$2', [parsed.data.screenshotId, parsed.data.projectId]); if (!owned.rows.length) return reply.code(400).send({ error: 'INVALID_SCREENSHOT' }); }
    const id = randomUUID(); const pageUrl = cleanUrl(parsed.data.pageUrl); const diagnostics = normalizeDiagnostics(parsed.data.diagnostics ?? {});
    await db.query('INSERT INTO tickets(id,project_id,text,status,page_url,anchor,diagnostics,screenshot_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [id,parsed.data.projectId,parsed.data.text,'TODO',pageUrl,JSON.stringify(parsed.data.anchor),JSON.stringify(diagnostics),parsed.data.screenshotId ?? null]);
    reply.header('Access-Control-Allow-Origin', req.headers.origin!).header('Vary','Origin'); return reply.code(201).send({ id });
  });
  app.post('/api/uploads', async (req, reply) => {
    const projectId = (req.query as any).projectId; if (typeof projectId !== 'string' || !(await reviewer(req, projectId))) return reply.code(403).send({ error: 'FORBIDDEN' });
    const file = await req.file(); if (!file) return reply.code(400).send({ error: 'FILE_REQUIRED' });
    const allowed: Record<string,string> = { 'image/png':'.png', 'image/jpeg':'.jpg', 'image/webp':'.webp' }; const ext = allowed[file.mimetype]; if (!ext) return reply.code(415).send({ error: 'UNSUPPORTED_MEDIA_TYPE' });
    const data = await file.toBuffer(); if (data.length > 5_000_000) return reply.code(413).send({ error: 'FILE_TOO_LARGE' });
    const signatures = file.mimetype === 'image/png' ? data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : file.mimetype === 'image/jpeg' ? data[0]===255 && data[1]===216 : data.subarray(0,4).toString()==='RIFF' && data.subarray(8,12).toString()==='WEBP';
    if (!signatures) return reply.code(415).send({ error: 'INVALID_IMAGE' });
    const id=randomUUID(); const filename=id+ext; await writeFile(path.join(options.uploadDir,filename),data,{ flag:'wx' }); await db.query('INSERT INTO uploads(id,project_id,filename,mime,size_bytes) VALUES($1,$2,$3,$4,$5)',[id,projectId,filename,file.mimetype,data.length]);
    reply.header('Access-Control-Allow-Origin', req.headers.origin!).header('Vary','Origin'); return reply.code(201).send({ id });
  });
  app.get('/api/uploads/:id', { preHandler: admin }, async (req, reply) => { const rows=await db.query<{filename:string;mime:string}>('SELECT filename,mime FROM uploads WHERE id=$1',[(req.params as any).id]); const row=rows.rows[0]; if(!row)return reply.code(404).send(); reply.type(row.mime).header('Cache-Control','private, no-store'); return reply.send(await readFile(path.join(options.uploadDir,row.filename))); });
  app.get('/api/tickets', { preHandler: admin }, async (req) => { const q=req.query as any; const clauses:string[]=[]; const values:string[]=[]; if(q.projectId){values.push(q.projectId);clauses.push(`t.project_id=$${values.length}`);} if(q.status){values.push(q.status);clauses.push(`t.status=$${values.length}`);} const where=clauses.length?'WHERE '+clauses.join(' AND '):''; const rows=await db.query(`SELECT t.id,t.project_id AS "projectId",p.name AS "projectName",p.client_label AS "clientLabel",t.text,t.response,t.status,t.page_url AS "pageUrl",t.anchor,t.diagnostics,t.screenshot_id AS "screenshotId",t.created_at AS "createdAt",t.updated_at AS "updatedAt" FROM tickets t JOIN projects p ON p.id=t.project_id ${where} ORDER BY t.created_at DESC`,values); return {tickets:rows.rows}; });
  app.patch('/api/tickets/:id', { preHandler: admin }, async (req,reply) => { const parsed=ticketPatch.safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:'INVALID_INPUT'});const id=(req.params as any).id;const current=await db.query<any>('SELECT status,response FROM tickets WHERE id=$1',[id]);if(!current.rows.length)return reply.code(404).send({error:'NOT_FOUND'});const status=parsed.data.status??current.rows[0].status;const response=parsed.data.response??current.rows[0].response;await db.query('UPDATE tickets SET status=$1,response=$2,updated_at=now() WHERE id=$3',[status,response,id]);return {id,status,response}; });
  app.addHook('onClose', async () => { await db.close(); });
  return app;
}
