import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  ADMIN_PASSWORD,
  PNG_1X1,
  anchor,
  createProject,
  createReviewLink,
  createTestApp,
  loginAdmin,
  multipartBody,
} from '../helpers/harness.js';

test('every admin route fails closed without a session', async (t) => {
  const app = await createTestApp(t);
  const routes: [string, string][] = [
    ['GET', '/api/projects'],
    ['POST', '/api/projects'],
    ['DELETE', `/api/projects/${randomUUID()}`],
    ['GET', '/api/auth/session'],
    ['POST', '/api/auth/logout'],
    ['GET', '/api/tickets'],
    ['PATCH', `/api/tickets/${randomUUID()}`],
    ['GET', `/api/uploads/${randomUUID()}`],
    ['GET', `/api/projects/${randomUUID()}/review-links`],
    ['POST', `/api/projects/${randomUUID()}/review-links`],
    ['POST', `/api/projects/${randomUUID()}/review-links/${randomUUID()}/revoke`],
  ];
  for (const [method, url] of routes) {
    const response = await app.inject({ method: method as 'GET', url, payload: method === 'GET' ? undefined : {} });
    assert.equal(response.statusCode, 401, `${method} ${url}`);
  }

  for (const cookie of ['rd_session=', 'rd_session=forged', `rd_session=${'a'.repeat(300)}`]) {
    const response = await app.inject({ method: 'GET', url: '/api/projects', headers: { cookie } });
    assert.equal(response.statusCode, 401, cookie.slice(0, 30));
  }
});

test('a wrong admin password is refused and attempts are rate limited', async (t) => {
  const app = await createTestApp(t, { LOGIN_ATTEMPTS_PER_MINUTE: '3' });
  for (const payload of [
    { username: 'admin', password: 'wrong' },
    { username: 'admin', password: ADMIN_PASSWORD.slice(0, -1) },
    { username: 'root', password: ADMIN_PASSWORD },
  ]) {
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload });
    assert.equal(response.statusCode, 401, JSON.stringify(payload));
    assert.equal(response.cookies.length, 0, 'no cookie is issued on failure');
  }
  const throttled = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'admin', password: ADMIN_PASSWORD },
  });
  assert.equal(throttled.statusCode, 429, 'brute force is throttled even with the right password');
});

test('admin writes require a session-bound CSRF token and a same-site request', async (t) => {
  const app = await createTestApp(t);
  const auth = await loginAdmin(app);
  const project = { name: 'DEMO CSRF', clientLabel: 'DEMO Client', origins: ['https://preview.test'] };

  const noToken = await app.inject({ method: 'POST', url: '/api/projects', headers: auth.read, payload: project });
  assert.equal(noToken.statusCode, 403, 'the session cookie alone is not enough');
  assert.equal(noToken.json().error, 'CSRF_TOKEN_INVALID');

  const wrongToken = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: { ...auth.read, 'x-csrf-token': 'x'.repeat(auth.csrfToken.length) },
    payload: project,
  });
  assert.equal(wrongToken.statusCode, 403);

  // A token minted for a different session must not work on this one.
  const other = await loginAdmin(app);
  const foreignToken = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: { ...auth.read, 'x-csrf-token': other.csrfToken },
    payload: project,
  });
  assert.equal(foreignToken.statusCode, 403, 'CSRF tokens are bound to one session');

  const crossSiteHeaders: Record<string, string>[] = [
    { ...auth.write, origin: 'https://evil.test' },
    { ...auth.write, 'sec-fetch-site': 'cross-site' },
    { ...auth.write, 'sec-fetch-site': 'same-site' },
  ];
  for (const headers of crossSiteHeaders) {
    const response = await app.inject({ method: 'POST', url: '/api/projects', headers, payload: project });
    assert.equal(response.statusCode, 403, JSON.stringify(headers.origin ?? headers['sec-fetch-site']));
    assert.equal(response.json().error, 'CROSS_SITE_REQUEST');
  }

  const accepted = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: { ...auth.write, 'sec-fetch-site': 'same-origin' },
    payload: project,
  });
  assert.equal(accepted.statusCode, 201);

  const cookieAttributes = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: ADMIN_PASSWORD } })).cookies[0];
  assert.equal(cookieAttributes?.httpOnly, true);
  assert.equal(cookieAttributes?.sameSite, 'Strict');
});

test('logging out destroys the session server-side, not just the cookie', async (t) => {
  const app = await createTestApp(t);
  const auth = await loginAdmin(app);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: auth.write })).statusCode, 204);
  const replayed = await app.inject({ method: 'GET', url: '/api/projects', headers: auth.read });
  assert.equal(replayed.statusCode, 401, 'a captured cookie is worthless after logout');
});

test('an expired session is refused', async (t) => {
  const app = await createTestApp(t);
  const auth = await loginAdmin(app);
  await app.reviewdesk.db.query("UPDATE admin_sessions SET expires_at = now() - interval '1 second'");
  assert.equal((await app.inject({ method: 'GET', url: '/api/projects', headers: auth.read })).statusCode, 401);
});

test('a reviewer token cannot reach another project', async (t) => {
  const app = await createTestApp(t);
  const auth = await loginAdmin(app);
  const alpha = await createProject(app, auth, {
    name: 'DEMO Alpha',
    clientLabel: 'Client A',
    origins: ['https://alpha.test'],
  });
  const beta = await createProject(app, auth, {
    name: 'DEMO Beta',
    clientLabel: 'Client B',
    origins: ['https://beta.test'],
  });
  const alphaLink = await createReviewLink(app, auth, alpha.id);
  const betaLink = await createReviewLink(app, auth, beta.id);
  const alphaHeaders = { authorization: `Bearer ${alphaLink.token}`, origin: 'https://alpha.test' };

  const crossProject = await app.inject({
    method: 'POST',
    url: '/api/feedback',
    headers: alphaHeaders,
    payload: { projectId: beta.id, text: 'Cross project', pageUrl: 'https://alpha.test/', anchor },
  });
  assert.equal(crossProject.statusCode, 403, 'alpha token, beta project');

  const crossUpload = await app.inject({
    method: 'POST',
    url: `/api/uploads?projectId=${beta.id}`,
    headers: { ...alphaHeaders, 'content-type': 'multipart/form-data; boundary=b' },
    payload: multipartBody('b', [{ name: 'file', filename: 'c.png', contentType: 'image/png', body: PNG_1X1 }]),
  });
  assert.equal(crossUpload.statusCode, 403, 'alpha token cannot write into beta storage');

  // An upload owned by beta must not be attachable to an alpha ticket.
  const betaUpload = await app.inject({
    method: 'POST',
    url: `/api/uploads?projectId=${beta.id}`,
    headers: { authorization: `Bearer ${betaLink.token}`, origin: 'https://beta.test', 'content-type': 'multipart/form-data; boundary=b' },
    payload: multipartBody('b', [{ name: 'file', filename: 'c.png', contentType: 'image/png', body: PNG_1X1 }]),
  });
  assert.equal(betaUpload.statusCode, 201);
  const stolen = await app.inject({
    method: 'POST',
    url: '/api/feedback',
    headers: alphaHeaders,
    payload: {
      projectId: alpha.id,
      text: 'Stolen capture',
      pageUrl: 'https://alpha.test/',
      anchor,
      screenshotId: betaUpload.json().id,
    },
  });
  assert.equal(stolen.statusCode, 400, 'a capture belonging to another project is refused');

  const foreignRevoke = await app.inject({
    method: 'POST',
    url: `/api/projects/${alpha.id}/review-links/${betaLink.id}/revoke`,
    headers: auth.write,
  });
  assert.equal(foreignRevoke.statusCode, 404, 'a link id cannot be revoked through another project');
  const stillLive = await app.inject({
    method: 'POST',
    url: '/api/feedback',
    headers: { authorization: `Bearer ${betaLink.token}`, origin: 'https://beta.test' },
    payload: { projectId: beta.id, text: 'Toujours actif', pageUrl: 'https://beta.test/', anchor },
  });
  assert.equal(stillLive.statusCode, 201, 'and the foreign link is untouched');
});

test('the Origin is a constraint on the token, never a credential', async (t) => {
  const app = await createTestApp(t);
  const auth = await loginAdmin(app);
  const project = await createProject(app, auth, {
    name: 'DEMO Origin',
    clientLabel: 'Client',
    origins: ['https://preview.client.test'],
  });
  const link = await createReviewLink(app, auth, project.id);
  const body = { projectId: project.id, text: 'Un retour', pageUrl: 'https://preview.client.test/', anchor };

  // An allowed origin without a token proves CORS is not doing authentication.
  const originOnly = await app.inject({
    method: 'POST',
    url: '/api/feedback',
    headers: { origin: 'https://preview.client.test' },
    payload: body,
  });
  assert.equal(originOnly.statusCode, 403, 'a whitelisted origin alone authenticates nothing');

  for (const origin of [
    'https://preview.client.test.evil.test',
    'https://evil.test',
    'http://preview.client.test',
    'https://preview.client.test:8443',
    'null',
  ]) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      headers: { authorization: `Bearer ${link.token}`, origin },
      payload: body,
    });
    assert.equal(response.statusCode, 403, origin);
    assert.equal(response.headers['access-control-allow-origin'], undefined, `${origin} must not be echoed back`);

    const preflight = await app.inject({
      method: 'OPTIONS',
      url: `/api/feedback?projectId=${project.id}`,
      headers: { origin },
    });
    assert.equal(preflight.statusCode, 403, `preflight ${origin}`);
    assert.equal(preflight.headers['access-control-allow-origin'], undefined);
  }

  const unknownProjectPreflight = await app.inject({
    method: 'OPTIONS',
    url: `/api/feedback?projectId=${randomUUID()}`,
    headers: { origin: 'https://preview.client.test' },
  });
  assert.equal(unknownProjectPreflight.statusCode, 403, 'an unknown project is indistinguishable from a refused origin');

  const forgedBearer = await app.inject({
    method: 'POST',
    url: '/api/feedback',
    headers: { authorization: `Bearer ${'A'.repeat(43)}`, origin: 'https://preview.client.test' },
    payload: body,
  });
  assert.equal(forgedBearer.statusCode, 403);
});

test('a reviewer secret is never accepted from the URL', async (t) => {
  const app = await createTestApp(t);
  const auth = await loginAdmin(app);
  const project = await createProject(app, auth, {
    name: 'DEMO Query',
    clientLabel: 'Client',
    origins: ['https://preview.test'],
  });
  const link = await createReviewLink(app, auth, project.id);
  const response = await app.inject({
    method: 'POST',
    url: `/api/feedback?token=${link.token}&review=${link.token}`,
    headers: { origin: 'https://preview.test' },
    payload: { projectId: project.id, text: 'Un retour', pageUrl: 'https://preview.test/', anchor },
  });
  assert.equal(response.statusCode, 403, 'only Authorization: Bearer is read');
});

test('uploads are private, size-capped and typed from their bytes', async (t) => {
  const app = await createTestApp(t, { UPLOAD_MAX_BYTES: '20000' });
  const auth = await loginAdmin(app);
  const project = await createProject(app, auth, {
    name: 'DEMO Upload',
    clientLabel: 'Client',
    origins: ['https://preview.test'],
  });
  const link = await createReviewLink(app, auth, project.id);
  const reviewer = { authorization: `Bearer ${link.token}`, origin: 'https://preview.test' };

  const send = (body: Buffer, contentType: string, filename = 'capture') => {
    const boundary = `b-${randomUUID()}`;
    return app.inject({
      method: 'POST',
      url: `/api/uploads?projectId=${project.id}`,
      headers: { ...reviewer, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipartBody(boundary, [{ name: 'file', filename, contentType, body }]),
    });
  };

  const svg = await send(Buffer.from('<svg onload="alert(1)"></svg>'), 'image/svg+xml', 'capture.svg');
  assert.equal(svg.statusCode, 415, 'SVG is an active document, not a capture');

  const html = await send(Buffer.from('<!doctype html><script>alert(1)</script>'), 'text/html', 'x.html');
  assert.equal(html.statusCode, 415);

  const lyingType = await send(Buffer.from('<svg onload="alert(1)"></svg>'), 'image/png', 'capture.png');
  assert.equal(lyingType.statusCode, 415, 'a declared MIME that the bytes contradict is refused');

  const polyglot = await send(Buffer.concat([PNG_1X1, Buffer.from('<script>alert(1)</script>')]), 'image/webp');
  assert.equal(polyglot.statusCode, 415, 'the sniffed type must match the declared one');

  const tooLarge = await send(Buffer.concat([PNG_1X1, Buffer.alloc(30_000)]), 'image/png');
  assert.equal(tooLarge.statusCode, 413, `expected 413, got ${tooLarge.statusCode}: ${tooLarge.body}`);

  const good = await send(PNG_1X1, 'image/png');
  assert.equal(good.statusCode, 201, good.body);
  const uploadId = good.json().id as string;

  const anonymous = await app.inject({ method: 'GET', url: `/api/uploads/${uploadId}` });
  assert.equal(anonymous.statusCode, 401, 'captures are admin-only');
  const asReviewer = await app.inject({ method: 'GET', url: `/api/uploads/${uploadId}`, headers: reviewer });
  assert.equal(asReviewer.statusCode, 401, 'a reviewer token does not grant read access');

  const served = await app.inject({ method: 'GET', url: `/api/uploads/${uploadId}`, headers: auth.read });
  assert.equal(served.statusCode, 200);
  assert.equal(served.headers['x-content-type-options'], 'nosniff');
  assert.equal(served.headers['content-security-policy'], "default-src 'none'; sandbox");
  assert.equal(served.headers['cache-control'], 'private, no-store');

  const stored = await app.reviewdesk.db.query<{ storage_key: string; mime: string }>(
    'SELECT storage_key, mime FROM uploads WHERE id = $1',
    [uploadId],
  );
  assert.equal(stored.rows[0]!.mime, 'image/png');
  assert.match(stored.rows[0]!.storage_key, new RegExp(`^${project.id}/[0-9a-f-]{36}\\.png$`), 'keys are project-scoped and unguessable');
});

test('reviewer submissions are rate limited per link', async (t) => {
  const app = await createTestApp(t, { SUBMISSIONS_PER_MINUTE: '3' });
  const auth = await loginAdmin(app);
  const project = await createProject(app, auth, {
    name: 'DEMO Flood',
    clientLabel: 'Client',
    origins: ['https://preview.test'],
  });
  const first = await createReviewLink(app, auth, project.id);
  const second = await createReviewLink(app, auth, project.id);
  const post = (token: string) =>
    app.inject({
      method: 'POST',
      url: '/api/feedback',
      headers: { authorization: `Bearer ${token}`, origin: 'https://preview.test' },
      payload: { projectId: project.id, text: 'Flood', pageUrl: 'https://preview.test/', anchor },
    });

  const codes = [];
  for (let i = 0; i < 5; i += 1) codes.push((await post(first.token)).statusCode);
  assert.deepEqual(codes, [201, 201, 201, 429, 429]);
  assert.equal((await post(second.token)).statusCode, 201, 'the limit is per link, not global');
});

test('input validation refuses malformed and oversized payloads', async (t) => {
  const app = await createTestApp(t);
  const auth = await loginAdmin(app);
  const project = await createProject(app, auth, {
    name: 'DEMO Validation',
    clientLabel: 'Client',
    origins: ['https://preview.test'],
  });
  const link = await createReviewLink(app, auth, project.id);
  const reviewer = { authorization: `Bearer ${link.token}`, origin: 'https://preview.test' };
  const valid = { projectId: project.id, text: 'Un retour', pageUrl: 'https://preview.test/', anchor };

  for (const payload of [
    { ...valid, text: '' },
    { ...valid, text: 'x'.repeat(4001) },
    { ...valid, pageUrl: 'javascript:alert(1)' },
    { ...valid, anchor: { ...anchor, relative: { x: 5, y: 0 } } },
    { ...valid, anchor: { ...anchor, viewport: { width: -1, height: 10 } } },
    { ...valid, anchor: { ...anchor, selector: 'x'.repeat(501) } },
    { ...valid, projectId: 'not-a-uuid' },
    { ...valid, screenshotId: 'not-a-uuid' },
  ]) {
    const response = await app.inject({ method: 'POST', url: '/api/feedback', headers: reviewer, payload });
    assert.equal(response.statusCode, 400, JSON.stringify(payload).slice(0, 90));
  }

  for (const payload of [
    { name: 'x', clientLabel: 'Client', origins: ['https://a.test'] },
    { name: 'Projet', clientLabel: 'Client', origins: [] },
    { name: 'Projet', clientLabel: 'Client', origins: ['not-a-url'] },
    { name: 'Projet', clientLabel: 'Client', origins: ['javascript:alert(1)'] },
    { name: 'Projet', clientLabel: 'Client', origins: ['https://a.test', 'https://a.test/x'] },
  ]) {
    const response = await app.inject({ method: 'POST', url: '/api/projects', headers: auth.write, payload });
    assert.equal(response.statusCode, 400, JSON.stringify(payload));
  }

  const badPatch = await app.inject({
    method: 'PATCH',
    url: `/api/tickets/${randomUUID()}`,
    headers: auth.write,
    payload: { status: 'ARCHIVED' },
  });
  assert.equal(badPatch.statusCode, 400);
  const missingTicket = await app.inject({
    method: 'PATCH',
    url: `/api/tickets/${randomUUID()}`,
    headers: auth.write,
    payload: { status: 'DONE' },
  });
  assert.equal(missingTicket.statusCode, 404);
});

test('responses carry hardening headers and no server internals', async (t) => {
  const app = await createTestApp(t);
  const response = await app.inject({ method: 'GET', url: '/api/projects' });
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['referrer-policy'], 'no-referrer', 'no Referer means no token leak through links');
  assert.equal(response.headers['x-frame-options'], 'DENY');
  assert.equal(response.headers['cross-origin-opener-policy'], 'same-origin');
  assert.match(String(response.headers['content-security-policy']), /frame-ancestors 'none'/);
  assert.match(String(response.headers['permissions-policy']), /camera=\(\)/);
  assert.equal(response.headers['cache-control'], 'no-store');

  const overTls = await app.inject({ method: 'GET', url: '/health', headers: { 'x-forwarded-proto': 'https' } });
  assert.equal(overTls.headers['strict-transport-security'], undefined, 'HSTS needs a trusted proxy, off by default');

  const notFound = await app.inject({ method: 'GET', url: '/api/nope' });
  assert.equal(notFound.statusCode, 404);
  assert.deepEqual(notFound.json(), { error: 'NOT_FOUND' }, 'no stack trace, no framework banner');
});
