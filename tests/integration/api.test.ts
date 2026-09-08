import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  PNG_1X1,
  anchor,
  createProject,
  createReviewLink,
  createTestApp,
  loginAdmin,
  multipartBody,
} from '../helpers/harness.js';

test('a reviewer ticket travels from a foreign origin to the admin list and back', async (t) => {
  const app = await createTestApp(t);
  const auth = await loginAdmin(app);

  const project = await createProject(app, auth, {
    name: 'DEMO Atelier',
    clientLabel: 'DEMO Client A',
    origins: ['https://preview.client-a.test'],
  });
  const link = await createReviewLink(app, auth, project.id);
  const reviewer = { authorization: `Bearer ${link.token}`, origin: 'https://preview.client-a.test' };

  const preflight = await app.inject({
    method: 'OPTIONS',
    url: `/api/feedback?projectId=${project.id}`,
    headers: { origin: 'https://preview.client-a.test' },
  });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], 'https://preview.client-a.test');
  assert.equal(preflight.headers.vary, 'Origin');
  assert.equal(preflight.headers['access-control-allow-credentials'], undefined, 'CORS must never carry credentials');

  const boundary = `boundary-${randomUUID()}`;
  const upload = await app.inject({
    method: 'POST',
    url: `/api/uploads?projectId=${project.id}`,
    headers: { ...reviewer, 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: multipartBody(boundary, [
      { name: 'file', filename: 'capture.png', contentType: 'image/png', body: PNG_1X1 },
    ]),
  });
  assert.equal(upload.statusCode, 201, upload.body);
  const screenshotId = upload.json().id as string;

  const submitted = await app.inject({
    method: 'POST',
    url: '/api/feedback',
    headers: reviewer,
    payload: {
      projectId: project.id,
      text: '<img src=x onerror=alert(1)> Rendre ce bouton plus visible sur mobile',
      pageUrl: 'https://preview.client-a.test/collection?token=leak#anchor',
      anchor,
      diagnostics: { locale: 'fr-FR', timezone: 'Europe/Paris', cookies: 'secret', console: ['private'] },
      screenshotId,
    },
  });
  assert.equal(submitted.statusCode, 201, submitted.body);
  assert.equal(submitted.headers['access-control-allow-origin'], 'https://preview.client-a.test');
  const ticketId = submitted.json().id as string;

  const listed = await app.inject({ method: 'GET', url: '/api/tickets', headers: auth.read });
  assert.equal(listed.statusCode, 200);
  const ticket = listed.json().tickets[0];
  assert.equal(ticket.id, ticketId);
  assert.equal(ticket.status, 'TODO');
  assert.equal(ticket.pageUrl, 'https://preview.client-a.test/collection', 'query and hash are stripped');
  assert.equal(ticket.text.includes('<img'), true, 'text is stored verbatim and escaped at render time');
  assert.deepEqual(Object.keys(ticket.diagnostics).sort(), ['browser', 'locale', 'os', 'timezone']);
  assert.equal(ticket.viewportWidth, 390);
  assert.equal(ticket.screenshotId, screenshotId);
  assert.equal(ticket.projectName, 'DEMO Atelier');
  assert.equal(ticket.clientLabel, 'DEMO Client A');

  const capture = await app.inject({ method: 'GET', url: `/api/uploads/${screenshotId}`, headers: auth.read });
  assert.equal(capture.statusCode, 200);
  assert.deepEqual(capture.rawPayload, PNG_1X1);
  assert.equal(capture.headers['content-type'], 'image/png');
  assert.equal(capture.headers['cache-control'], 'private, no-store');

  const patched = await app.inject({
    method: 'PATCH',
    url: `/api/tickets/${ticketId}`,
    headers: auth.write,
    payload: { status: 'REVIEW', response: 'Ajustement prêt à valider' },
  });
  assert.equal(patched.statusCode, 200);
  assert.deepEqual(patched.json(), { id: ticketId, status: 'REVIEW', response: 'Ajustement prêt à valider' });

  // Persistence is what the admin actually relies on: read it back on a fresh request.
  const reread = await app.inject({ method: 'GET', url: `/api/tickets?status=REVIEW`, headers: auth.read });
  assert.equal(reread.json().tickets.length, 1);
  assert.equal(reread.json().tickets[0].response, 'Ajustement prêt à valider');

  const responseOnly = await app.inject({
    method: 'PATCH',
    url: `/api/tickets/${ticketId}`,
    headers: auth.write,
    payload: { response: 'Corrigé' },
  });
  assert.deepEqual(responseOnly.json(), { id: ticketId, status: 'REVIEW', response: 'Corrigé' }, 'a partial patch keeps the status');
});

test('admin filters combine project, client, page, format and status', async (t) => {
  const app = await createTestApp(t);
  const auth = await loginAdmin(app);

  const alpha = await createProject(app, auth, {
    name: 'DEMO Alpha',
    clientLabel: 'DEMO Client A',
    origins: ['https://alpha.test'],
  });
  const beta = await createProject(app, auth, {
    name: 'DEMO Beta',
    clientLabel: 'DEMO Client B',
    origins: ['https://beta.test'],
  });
  const alphaToken = (await createReviewLink(app, auth, alpha.id)).token;
  const betaToken = (await createReviewLink(app, auth, beta.id)).token;

  const submit = async (projectId: string, token: string, origin: string, page: string, width: number) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      headers: { authorization: `Bearer ${token}`, origin },
      payload: {
        projectId,
        text: `Retour sur ${page}`,
        pageUrl: `${origin}${page}`,
        anchor: { ...anchor, viewport: { width, height: 800 } },
      },
    });
    assert.equal(response.statusCode, 201, response.body);
  };

  await submit(alpha.id, alphaToken, 'https://alpha.test', '/accueil', 390);
  await submit(alpha.id, alphaToken, 'https://alpha.test', '/tarifs', 1440);
  await submit(beta.id, betaToken, 'https://beta.test', '/accueil', 1440);

  const count = async (query: string) => {
    const response = await app.inject({ method: 'GET', url: `/api/tickets${query}`, headers: auth.read });
    assert.equal(response.statusCode, 200, response.body);
    return response.json().tickets.length as number;
  };

  assert.equal(await count(''), 3, 'no filter');
  assert.equal(await count(`?projectId=${alpha.id}`), 2, 'project filter');
  assert.equal(await count('?client=DEMO%20Client%20B'), 1, 'client filter');
  assert.equal(await count('?page=accueil'), 2, 'site page filter');
  assert.equal(await count('?format=mobile'), 1, 'format filter');
  assert.equal(await count('?format=desktop'), 2, 'format filter');
  assert.equal(await count('?status=TODO'), 3, 'status filter');
  assert.equal(await count('?status=DONE'), 0, 'status filter');
  assert.equal(await count(`?projectId=${alpha.id}&format=desktop&page=tarifs&status=TODO`), 1, 'combined filters');
  assert.equal(await count('?page=%25'), 0, 'a LIKE wildcard is escaped, not expanded');

  for (const invalid of ['?status=DROP', '?projectId=not-a-uuid', '?format=tablet', `?client=${'x'.repeat(81)}`]) {
    const response = await app.inject({ method: 'GET', url: `/api/tickets${invalid}`, headers: auth.read });
    assert.equal(response.statusCode, 400, invalid);
  }
});

test('review links are listable and revocable, and revocation is immediate', async (t) => {
  const app = await createTestApp(t);
  const auth = await loginAdmin(app);
  const project = await createProject(app, auth, {
    name: 'DEMO Atelier',
    clientLabel: 'DEMO Client',
    origins: ['https://preview.test'],
  });
  const link = await createReviewLink(app, auth, project.id);
  const reviewer = { authorization: `Bearer ${link.token}`, origin: 'https://preview.test' };
  const body = { projectId: project.id, text: 'Un retour', pageUrl: 'https://preview.test/', anchor };

  assert.equal((await app.inject({ method: 'POST', url: '/api/feedback', headers: reviewer, payload: body })).statusCode, 201);

  const listed = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/review-links`, headers: auth.read });
  assert.equal(listed.statusCode, 200);
  const links = listed.json().links;
  assert.equal(links.length, 1);
  assert.equal(links[0].id, link.id);
  assert.equal(links[0].revokedAt, null);
  assert.ok(links[0].lastUsedAt, 'usage is recorded so a stale link can be spotted');
  assert.equal(JSON.stringify(links).includes(link.token), false, 'the secret is never returned again');

  const revoked = await app.inject({
    method: 'POST',
    url: `/api/projects/${project.id}/review-links/${link.id}/revoke`,
    headers: auth.write,
  });
  assert.equal(revoked.statusCode, 204);

  const after = await app.inject({ method: 'POST', url: '/api/feedback', headers: reviewer, payload: body });
  assert.equal(after.statusCode, 403, 'a revoked link stops working immediately');
  assert.equal(after.headers['access-control-allow-origin'], undefined, 'no CORS grant for a refused request');

  const uploadAfter = await app.inject({
    method: 'POST',
    url: `/api/uploads?projectId=${project.id}`,
    headers: { ...reviewer, 'content-type': 'multipart/form-data; boundary=b' },
    payload: multipartBody('b', [{ name: 'file', filename: 'c.png', contentType: 'image/png', body: PNG_1X1 }]),
  });
  assert.equal(uploadAfter.statusCode, 403, 'revocation covers uploads too');

  const relisted = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/review-links`, headers: auth.read });
  assert.ok(relisted.json().links[0].revokedAt, 'revocation is visible in the admin');
});

test('health reports the backends the instance is actually bound to', async (t) => {
  const app = await createTestApp(t);
  const response = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.equal(response.json().database, 'postgresql');
  assert.equal(JSON.stringify(response.json()).includes('SecretAccessKey'), false);
});
