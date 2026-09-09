import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { PNG_1X1, anchor, testEnv } from '../helpers/harness.js';

/**
 * Exercises the Vercel entry point exactly as the platform drives it: a raw
 * `IncomingMessage` handed straight to the exported handler over a real socket.
 *
 * This is the part of the Vercel path that can be verified locally. What it
 * proves: the handler boots the app from the environment, streams a multipart
 * upload without anything reading `req.body` first, keeps cookies working, and
 * reuses one warm instance across invocations.
 */
Object.assign(process.env, testEnv());

const { default: handler } = await import('../../api/index.js');
const { getApp } = await import('../../src/serverless.js');

const server = http.createServer((req, res) => {
  void handler(req, res);
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

test.after(async () => {
  await (await getApp()).close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test('the Vercel handler serves the whole reviewer-to-admin path over a socket', async () => {
  const app = await getApp();
  await app.reviewdesk.db.exec('TRUNCATE projects, admin_sessions, rate_limits RESTART IDENTITY CASCADE');

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: process.env.ADMIN_PASSWORD }),
  });
  const loginBody = await login.text();
  assert.equal(login.status, 200, loginBody);
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  const csrfToken = (JSON.parse(loginBody) as { csrfToken: string }).csrfToken;
  const adminWrite = { cookie, 'x-csrf-token': csrfToken, 'content-type': 'application/json' };

  const project = (await (
    await fetch(`${base}/api/projects`, {
      method: 'POST',
      headers: adminWrite,
      body: JSON.stringify({ name: 'DEMO Vercel', clientLabel: 'Client', origins: ['https://preview.test'] }),
    })
  ).json()) as { id: string };
  assert.ok(project.id);

  const link = (await (
    await fetch(`${base}/api/projects/${project.id}/review-links`, {
      method: 'POST',
      headers: adminWrite,
      body: '{}',
    })
  ).json()) as { token: string };

  // The real reason this test exists: a streamed multipart body must survive the
  // raw handler, which it only does if nothing consumed the request stream.
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(PNG_1X1)], { type: 'image/png' }), 'capture.png');
  const upload = await fetch(`${base}/api/uploads?projectId=${project.id}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${link.token}`, origin: 'https://preview.test' },
    body: form,
  });
  const uploadBody = await upload.text();
  assert.equal(upload.status, 201, uploadBody);
  const screenshotId = (JSON.parse(uploadBody) as { id: string }).id;

  const feedback = await fetch(`${base}/api/feedback`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${link.token}`,
      origin: 'https://preview.test',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      projectId: project.id,
      text: 'Retour envoyé via le handler serverless',
      pageUrl: 'https://preview.test/accueil',
      anchor,
      screenshotId,
    }),
  });
  assert.equal(feedback.status, 201, await feedback.text());
  assert.equal(feedback.headers.get('access-control-allow-origin'), 'https://preview.test');


  const tickets = (await (await fetch(`${base}/api/tickets`, { headers: { cookie } })).json()) as {
    tickets: { text: string; screenshotId: string }[];
  };
  assert.equal(tickets.tickets.length, 1);
  assert.equal(tickets.tickets[0]!.text, 'Retour envoyé via le handler serverless');

  const capture = await fetch(`${base}/api/uploads/${screenshotId}`, { headers: { cookie } });
  assert.equal(capture.status, 200);
  assert.deepEqual(Buffer.from(await capture.arrayBuffer()), PNG_1X1);
});

test('the instance is built once and reused by later invocations', async () => {
  const first = await getApp();
  const second = await getApp();
  assert.equal(first, second, 'a warm invocation must not rebuild the app or re-open the pool');

  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  assert.equal(((await health.json()) as { ok: boolean }).ok, true);
});

test('static assets are not served by the function when the CDN owns them', async () => {
  const response = await fetch(`${base}/index.html`);
  assert.equal(response.status, 404, 'SERVE_STATIC=0 leaves public/ to the platform');
});
