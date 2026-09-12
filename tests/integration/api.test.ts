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
  assert.deepEqual(patched.json(), {
    id: ticketId,
    status: 'REVIEW',
    response: 'Ajustement prêt à valider',
    replyText: '',
  });

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
  assert.deepEqual(
    responseOnly.json(),
    { id: ticketId, status: 'REVIEW', response: 'Corrigé', replyText: '' },
    'a partial patch keeps the status',
  );
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

test('the reviewer read view exposes the public reply and never the internal note', async (t) => {
  const app = await createTestApp(t);
  const auth = await loginAdmin(app);
  const project = await createProject(app, auth, {
    name: 'DEMO Atelier',
    clientLabel: 'DEMO Client A',
    origins: ['https://preview.client-a.test'],
  });
  const link = await createReviewLink(app, auth, project.id);
  const reviewer = { authorization: `Bearer ${link.token}`, origin: 'https://preview.client-a.test' };

  const submitted = await app.inject({
    method: 'POST',
    url: '/api/feedback',
    headers: reviewer,
    payload: {
      projectId: project.id,
      text: 'Le bouton est trop discret',
      pageUrl: 'https://preview.client-a.test/collection',
      anchor,
    },
  });
  assert.equal(submitted.statusCode, 201, submitted.body);
  const ticketId = submitted.json().id as string;

  await app.inject({
    method: 'PATCH',
    url: `/api/tickets/${ticketId}`,
    headers: auth.write,
    payload: { status: 'DONE', response: 'facturer la retouche', replyText: 'Corrigé, merci du retour.' },
  });

  const mine = await app.inject({ method: 'GET', url: `/api/feedback?projectId=${project.id}`, headers: reviewer });
  assert.equal(mine.statusCode, 200, mine.body);
  assert.equal(mine.headers['access-control-allow-origin'], 'https://preview.client-a.test');
  const seen = mine.json().tickets[0];
  assert.equal(seen.status, 'DONE');
  assert.equal(seen.replyText, 'Corrigé, merci du retour.');
  // The whole point of splitting the columns: the internal note stays internal.
  assert.equal('response' in seen, false, 'the internal note must never reach a reviewer');
  assert.equal(mine.body.includes('facturer la retouche'), false);

  // The bearer link is the only key; a revoked one loses the read view too.
  const links = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/review-links`, headers: auth.read });
  const linkId = links.json().links[0].id as string;
  await app.inject({
    method: 'POST',
    url: `/api/projects/${project.id}/review-links/${linkId}/revoke`,
    headers: auth.write,
  });
  const afterRevoke = await app.inject({
    method: 'GET',
    url: `/api/feedback?projectId=${project.id}`,
    headers: reviewer,
  });
  assert.equal(afterRevoke.statusCode, 403, 'revocation covers the read view too');
});

test('ticket paging reports an honest total and never repeats a row', async (t) => {
  const app = await createTestApp(t);
  const auth = await loginAdmin(app);
  const project = await createProject(app, auth, {
    name: 'DEMO Atelier',
    clientLabel: 'DEMO Client A',
    origins: ['https://preview.client-a.test'],
  });
  const link = await createReviewLink(app, auth, project.id);
  const reviewer = { authorization: `Bearer ${link.token}`, origin: 'https://preview.client-a.test' };

  for (let index = 0; index < 5; index += 1) {
    const created = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      headers: reviewer,
      payload: {
        projectId: project.id,
        text: `retour numéro ${index}`,
        pageUrl: 'https://preview.client-a.test/collection',
        anchor,
      },
    });
    assert.equal(created.statusCode, 201, created.body);
  }

  const seen: string[] = [];
  let cursor: string | null = null;
  let total = 0;
  do {
    const url: string = `/api/tickets?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const page = await app.inject({ method: 'GET', url, headers: auth.read });
    assert.equal(page.statusCode, 200, page.body);
    // Annotated rather than inferred: `cursor` feeds the next `url`, and letting
    // TypeScript infer the shape here makes that a circular initialiser.
    const body = page.json() as { total: number; tickets: { id: string }[]; nextCursor: string | null };
    total = body.total;
    seen.push(...body.tickets.map((ticket) => ticket.id));
    cursor = body.nextCursor;
  } while (cursor);

  assert.equal(total, 5, 'the total counts every match, not the loaded page');
  assert.equal(seen.length, 5);
  assert.equal(new Set(seen).size, 5, 'keyset paging must not repeat a ticket');
});

test('a webhook URL must be public https, and a project can be edited', async (t) => {
  const app = await createTestApp(t);
  const auth = await loginAdmin(app);
  const project = await createProject(app, auth, {
    name: 'DEMO Atelier',
    clientLabel: 'DEMO Client A',
    origins: ['https://preview.client-a.test'],
  });

  for (const rejected of ['http://hooks.example.com/x', 'https://127.0.0.1/x', 'https://localhost/x', 'not-a-url']) {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}`,
      headers: auth.write,
      payload: { ...project, webhookUrl: rejected },
    });
    assert.equal(response.statusCode, 400, `${rejected} must be refused`);
  }

  const updated = await app.inject({
    method: 'PATCH',
    url: `/api/projects/${project.id}`,
    headers: auth.write,
    payload: { ...project, name: 'DEMO Atelier v2', webhookUrl: 'https://hooks.example.com/rd' },
  });
  assert.equal(updated.statusCode, 200, updated.body);

  const projects = await app.inject({ method: 'GET', url: '/api/projects', headers: auth.read });
  const stored = projects.json()[0];
  assert.equal(stored.name, 'DEMO Atelier v2');
  assert.equal(stored.webhookUrl, 'https://hooks.example.com/rd');
  assert.equal(stored.openCount, 0);
});

test('a project can be deleted, cascading its links and tickets', async (t) => {
  const app = await createTestApp(t);
  const auth = await loginAdmin(app);

  const project = await createProject(app, auth, {
    name: 'DEMO To Delete',
    clientLabel: 'DEMO Client D',
    origins: ['https://preview.delete.test'],
  });
  const link = await createReviewLink(app, auth, project.id);

  // Submit a ticket on this project
  const ticketRes = await app.inject({
    method: 'POST',
    url: '/api/feedback',
    headers: { origin: 'https://preview.delete.test', authorization: `Bearer ${link.token}` },
    payload: {
      projectId: project.id,
      text: 'Bouton mal centré',
      pageUrl: 'https://preview.delete.test/page',
      anchor,
      viewportWidth: 1024,
      diagnostics: {},
    },
  });
  assert.equal(ticketRes.statusCode, 201);

  // Deleting with invalid UUID is rejected
  const invalidUuid = await app.inject({
    method: 'DELETE',
    url: '/api/projects/not-a-uuid',
    headers: auth.write,
  });
  assert.equal(invalidUuid.statusCode, 400);

  // Deleting nonexistent project returns 404
  const notFound = await app.inject({
    method: 'DELETE',
    url: `/api/projects/${randomUUID()}`,
    headers: auth.write,
  });
  assert.equal(notFound.statusCode, 404);

  // Delete the real project
  const deleted = await app.inject({
    method: 'DELETE',
    url: `/api/projects/${project.id}`,
    headers: auth.write,
  });
  assert.equal(deleted.statusCode, 204);

  // Project is gone from GET /api/projects
  const projects = await app.inject({ method: 'GET', url: '/api/projects', headers: auth.read });
  assert.ok(!projects.json().some((p: { id: string }) => p.id === project.id));

  // Review links for that project are gone
  const links = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/review-links`, headers: auth.read });
  assert.equal(links.json().links.length, 0);
});

test('a reviewer can validate and reopen tickets in review status', async (t) => {
  const app = await createTestApp(t);
  const auth = await loginAdmin(app);

  const project = await createProject(app, auth, {
    name: 'DEMO Workflow',
    clientLabel: 'DEMO Client Review',
    origins: ['https://preview.review.test'],
  });
  const link = await createReviewLink(app, auth, project.id);
  const reviewer = { authorization: `Bearer ${link.token}`, origin: 'https://preview.review.test' };

  // 1. Submit ticket
  const submitted = await app.inject({
    method: 'POST',
    url: '/api/feedback',
    headers: reviewer,
    payload: {
      projectId: project.id,
      text: 'Bouton de paiement mal aligné',
      pageUrl: 'https://preview.review.test/checkout',
      anchor,
    },
  });
  assert.equal(submitted.statusCode, 201);
  const ticketId = submitted.json().id as string;

  // 2. Admin works on it and puts it in REVIEW
  await app.inject({
    method: 'PATCH',
    url: `/api/tickets/${ticketId}`,
    headers: auth.write,
    payload: { status: 'REVIEW', replyText: 'Alignement corrigé sur mobile et desktop.' },
  });

  // Check CORS preflight for resolve endpoint
  const preflight = await app.inject({
    method: 'OPTIONS',
    url: `/api/feedback/${ticketId}/resolve?projectId=${project.id}`,
    headers: { origin: 'https://preview.review.test' },
  });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], 'https://preview.review.test');

  // 3. Reviewer validates the correction
  const resolved = await app.inject({
    method: 'POST',
    url: `/api/feedback/${ticketId}/resolve?projectId=${project.id}`,
    headers: reviewer,
    payload: { comment: 'Parfait, le bouton est bien aligné !' },
  });
  assert.equal(resolved.statusCode, 200);
  assert.equal(resolved.json().status, 'DONE');
  assert.equal(resolved.headers['access-control-allow-origin'], 'https://preview.review.test');

  // Check ticket in admin
  const checkedDone = await app.inject({ method: 'GET', url: `/api/tickets?projectId=${project.id}`, headers: auth.read });
  assert.equal(checkedDone.json().tickets[0].status, 'DONE');

  // 4. Reviewer reopens if need adjustment
  const reopened = await app.inject({
    method: 'POST',
    url: `/api/feedback/${ticketId}/reopen?projectId=${project.id}`,
    headers: reviewer,
    payload: { comment: 'Finalement il y a un léger décalage sur Safari.' },
  });
  assert.equal(reopened.statusCode, 200);
  assert.equal(reopened.json().status, 'TODO');
  assert.equal(reopened.headers['access-control-allow-origin'], 'https://preview.review.test');

  const checkedTodo = await app.inject({ method: 'GET', url: `/api/tickets?projectId=${project.id}`, headers: auth.read });
  assert.equal(checkedTodo.json().tickets[0].status, 'TODO');

  // Unauthorized access (missing or invalid token/origin) is forbidden
  const unauthorized = await app.inject({
    method: 'POST',
    url: `/api/feedback/${ticketId}/resolve?projectId=${project.id}`,
    headers: { origin: 'https://evil.test' },
  });
  assert.equal(unauthorized.statusCode, 403);
});
