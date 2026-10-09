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
  type AdminAuth,
  type Project,
} from '../helpers/harness.js';
import type { App } from '../../src/app.js';

type Comment = { id: string; author: string; body: string; visibility: string; statusFrom: string | null; statusTo: string | null };

async function mintAgentToken(
  app: App,
  auth: AdminAuth,
  payload: { label?: string; scope?: 'read' | 'write'; projectId?: string } = {},
): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/agent-tokens', headers: auth.write, payload });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().token as string;
}

async function fileTicket(app: App, auth: AdminAuth, project: Project, text: string): Promise<string> {
  const link = await createReviewLink(app, auth, project.id);
  const response = await app.inject({
    method: 'POST',
    url: '/api/feedback',
    headers: { authorization: `Bearer ${link.token}`, origin: project.origins[0]! },
    payload: { projectId: project.id, text, pageUrl: `${project.origins[0]}/tarifs`, anchor },
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().id as string;
}

test('an agent reads the backlog, works it and writes back what it did', async (t) => {
  const app = await createTestApp(t);
  const auth = await loginAdmin(app);
  const project = await createProject(app, auth, {
    name: 'DEMO Atelier',
    clientLabel: 'DEMO Client A',
    origins: ['https://preview.client-a.test'],
  });
  const ticketId = await fileTicket(app, auth, project, 'Le bouton du hero est illisible sur mobile');
  const token = await mintAgentToken(app, auth, { label: 'Claude Code' });
  const agent = { authorization: `Bearer ${token}` };

  const context = await app.inject({ method: 'GET', url: '/api/agent/context', headers: agent });
  assert.equal(context.statusCode, 200, context.body);
  assert.equal(context.json().token.scope, 'write');
  assert.equal(context.json().projects[0].todo, 1);

  const list = await app.inject({ method: 'GET', url: '/api/agent/tickets?status=TODO', headers: agent });
  assert.equal(list.statusCode, 200, list.body);
  assert.equal(list.json().total, 1);
  assert.equal(list.json().tickets[0].id, ticketId);
  assert.equal(list.json().tickets[0].commentCount, 0);

  const detail = await app.inject({ method: 'GET', url: `/api/agent/tickets/${ticketId}`, headers: agent });
  assert.equal(detail.statusCode, 200, detail.body);
  assert.equal(detail.json().anchor.selector, anchor.selector);
  assert.deepEqual(detail.json().comments, []);

  // The call an agent makes when it has finished: move the status and say what
  // was done, in one request.
  const patched = await app.inject({
    method: 'PATCH',
    url: `/api/agent/tickets/${ticketId}`,
    headers: agent,
    payload: { status: 'REVIEW', comment: 'Contraste du CTA porté à 5.2:1, testé à 390 px.' },
  });
  assert.equal(patched.statusCode, 200, patched.body);
  assert.equal(patched.json().previousStatus, 'TODO');
  assert.equal(patched.json().status, 'REVIEW');

  const afterWork = await app.inject({ method: 'GET', url: `/api/agent/tickets/${ticketId}`, headers: agent });
  const comments = afterWork.json().comments as Comment[];
  assert.equal(afterWork.json().status, 'REVIEW');
  assert.equal(comments.length, 1);
  assert.equal(comments[0]!.author, 'agent');
  assert.equal(comments[0]!.statusFrom, 'TODO');
  assert.equal(comments[0]!.statusTo, 'REVIEW');
  // An internal note must not leak into the reviewer's own reply field.
  assert.equal(afterWork.json().replyText, '');

  // The same history is what the operator reads in the admin.
  const adminView = await app.inject({ method: 'GET', url: `/api/tickets/${ticketId}/comments`, headers: auth.read });
  assert.equal(adminView.statusCode, 200, adminView.body);
  assert.equal((adminView.json().comments as Comment[]).length, 1);
});

test('an agent comment marked reviewer becomes the answer the client reads, an internal one never does', async (t) => {
  const app = await createTestApp(t);
  const auth = await loginAdmin(app);
  const project = await createProject(app, auth, {
    name: 'DEMO Atelier',
    clientLabel: 'DEMO Client A',
    origins: ['https://preview.client-a.test'],
  });
  const link = await createReviewLink(app, auth, project.id);
  const reviewer = { authorization: `Bearer ${link.token}`, origin: 'https://preview.client-a.test' };
  const filed = await app.inject({
    method: 'POST',
    url: '/api/feedback',
    headers: reviewer,
    payload: {
      projectId: project.id,
      text: 'La page tarifs déborde à droite',
      pageUrl: 'https://preview.client-a.test/tarifs',
      anchor,
    },
  });
  const ticketId = filed.json().id as string;
  const token = await mintAgentToken(app, auth, { label: 'Claude Code' });
  const agent = { authorization: `Bearer ${token}` };

  await app.inject({
    method: 'POST',
    url: `/api/agent/tickets/${ticketId}/comments`,
    headers: agent,
    payload: { body: 'Cause : une grille en 100vw sous la scrollbar.' },
  });
  const published = await app.inject({
    method: 'POST',
    url: `/api/agent/tickets/${ticketId}/comments`,
    headers: agent,
    payload: { body: 'Corrigé, la page ne déborde plus.', visibility: 'reviewer' },
  });
  assert.equal(published.statusCode, 201, published.body);

  const asReviewer = await app.inject({
    method: 'GET',
    url: `/api/feedback?projectId=${project.id}`,
    headers: reviewer,
  });
  assert.equal(asReviewer.statusCode, 200, asReviewer.body);
  const ticket = asReviewer.json().tickets[0] as { replyText: string };
  assert.equal(ticket.replyText, 'Corrigé, la page ne déborde plus.');
  assert.ok(!JSON.stringify(asReviewer.json()).includes('une grille en 100vw'), 'internal comments must stay internal');
});

test('agent tokens are scoped, revocable and refused where they do not belong', async (t) => {
  const app = await createTestApp(t);
  const auth = await loginAdmin(app);
  const projectA = await createProject(app, auth, {
    name: 'DEMO Atelier',
    clientLabel: 'DEMO Client A',
    origins: ['https://preview.client-a.test'],
  });
  const projectB = await createProject(app, auth, {
    name: 'DEMO Boutique',
    clientLabel: 'DEMO Client B',
    origins: ['https://preview.client-b.test'],
  });
  const ticketA = await fileTicket(app, auth, projectA, 'Retour du client A');
  const ticketB = await fileTicket(app, auth, projectB, 'Retour du client B');

  const noToken = await app.inject({ method: 'GET', url: '/api/agent/tickets' });
  assert.equal(noToken.statusCode, 401);
  const garbage = await app.inject({
    method: 'GET',
    url: '/api/agent/tickets',
    headers: { authorization: 'Bearer rda_not-a-real-token' },
  });
  assert.equal(garbage.statusCode, 401);

  // A project-scoped token sees its project and nothing else, whatever it asks for.
  const scopedToken = await mintAgentToken(app, auth, { label: 'Agent A', projectId: projectA.id });
  const scoped = { authorization: `Bearer ${scopedToken}` };
  const scopedList = await app.inject({ method: 'GET', url: '/api/agent/tickets', headers: scoped });
  assert.equal(scopedList.json().total, 1);
  assert.equal(scopedList.json().tickets[0].id, ticketA);
  const crossProject = await app.inject({
    method: 'GET',
    url: `/api/agent/tickets?projectId=${projectB.id}`,
    headers: scoped,
  });
  assert.equal(crossProject.statusCode, 403, crossProject.body);
  const crossTicket = await app.inject({ method: 'GET', url: `/api/agent/tickets/${ticketB}`, headers: scoped });
  assert.equal(crossTicket.statusCode, 404);
  const crossWrite = await app.inject({
    method: 'PATCH',
    url: `/api/agent/tickets/${ticketB}`,
    headers: scoped,
    payload: { status: 'DONE' },
  });
  assert.equal(crossWrite.statusCode, 404);

  // A read-only token may look at everything it is scoped to, and change nothing.
  const readToken = await mintAgentToken(app, auth, { label: 'Lecture', scope: 'read' });
  const reader = { authorization: `Bearer ${readToken}` };
  assert.equal((await app.inject({ method: 'GET', url: '/api/agent/tickets', headers: reader })).statusCode, 200);
  const refused = await app.inject({
    method: 'PATCH',
    url: `/api/agent/tickets/${ticketA}`,
    headers: reader,
    payload: { status: 'DONE', comment: 'ne doit pas passer' },
  });
  assert.equal(refused.statusCode, 403);
  assert.equal(refused.json().error, 'READ_ONLY_TOKEN');
  const refusedComment = await app.inject({
    method: 'POST',
    url: `/api/agent/tickets/${ticketA}/comments`,
    headers: reader,
    payload: { body: 'ne doit pas passer' },
  });
  assert.equal(refusedComment.statusCode, 403);

  // Revocation is immediate, and the admin sees the state of every token.
  const tokens = await app.inject({ method: 'GET', url: '/api/agent-tokens', headers: auth.read });
  const listed = tokens.json().tokens as { id: string; label: string }[];
  const target = listed.find((row) => row.label === 'Agent A')!;
  const revoked = await app.inject({
    method: 'POST',
    url: `/api/agent-tokens/${target.id}/revoke`,
    headers: auth.write,
  });
  assert.equal(revoked.statusCode, 204);
  assert.equal((await app.inject({ method: 'GET', url: '/api/agent/tickets', headers: scoped })).statusCode, 401);

  // The agent API is not a way around the admin session either.
  const asAgentOnAdmin = await app.inject({ method: 'GET', url: '/api/tickets', headers: scoped });
  assert.equal(asAgentOnAdmin.statusCode, 401);
});

test('an agent reads the screenshot of its own project only', async (t) => {
  const app = await createTestApp(t);
  const auth = await loginAdmin(app);
  const projectA = await createProject(app, auth, {
    name: 'DEMO Atelier',
    clientLabel: 'DEMO Client A',
    origins: ['https://preview.client-a.test'],
  });
  const projectB = await createProject(app, auth, {
    name: 'DEMO Boutique',
    clientLabel: 'DEMO Client B',
    origins: ['https://preview.client-b.test'],
  });
  const link = await createReviewLink(app, auth, projectA.id);
  const boundary = `boundary-${randomUUID()}`;
  const upload = await app.inject({
    method: 'POST',
    url: `/api/uploads?projectId=${projectA.id}`,
    headers: {
      authorization: `Bearer ${link.token}`,
      origin: 'https://preview.client-a.test',
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: multipartBody(boundary, [
      { name: 'file', filename: 'capture.png', contentType: 'image/png', body: PNG_1X1 },
    ]),
  });
  assert.equal(upload.statusCode, 201, upload.body);
  const screenshotId = upload.json().id as string;

  const ownToken = await mintAgentToken(app, auth, { projectId: projectA.id });
  const own = await app.inject({
    method: 'GET',
    url: `/api/agent/uploads/${screenshotId}`,
    headers: { authorization: `Bearer ${ownToken}` },
  });
  assert.equal(own.statusCode, 200, own.body);
  assert.equal(own.headers['content-type'], 'image/png');
  assert.equal(own.headers['cache-control'], 'private, no-store');

  const otherToken = await mintAgentToken(app, auth, { projectId: projectB.id });
  const other = await app.inject({
    method: 'GET',
    url: `/api/agent/uploads/${screenshotId}`,
    headers: { authorization: `Bearer ${otherToken}` },
  });
  assert.equal(other.statusCode, 404, 'a scoped token must not reach another project’s capture');
});

test('« Lancer la correction » queues a ticket for the agent until it reaches review', async (t) => {
  const app = await createTestApp(t);
  const auth = await loginAdmin(app);
  const project = await createProject(app, auth, {
    name: 'DEMO Correction',
    clientLabel: 'DEMO Client C',
    origins: ['https://preview.client-c.test'],
  });
  const queued = await fileTicket(app, auth, project, 'Le menu ne se ferme pas sur mobile');
  const untouched = await fileTicket(app, auth, project, 'Une faute dans le pied de page');
  const token = await mintAgentToken(app, auth, { label: 'Claude Code' });
  const agent = { authorization: `Bearer ${token}` };

  // Only the admin can queue, and only with a write session.
  const anonymous = await app.inject({ method: 'POST', url: `/api/tickets/${queued}/fix-request`, payload: {} });
  assert.equal(anonymous.statusCode, 401);
  const asAgent = await app.inject({ method: 'POST', url: `/api/tickets/${queued}/fix-request`, headers: agent, payload: {} });
  assert.equal(asAgent.statusCode, 401);

  const requested = await app.inject({
    method: 'POST',
    url: `/api/tickets/${queued}/fix-request`,
    headers: auth.write,
    payload: { agent: 'Claude Code' },
  });
  assert.equal(requested.statusCode, 201, requested.body);
  assert.equal(requested.json().status, 'IN_PROGRESS');
  assert.equal(requested.json().fixRequestedFor, 'Claude Code');

  // The agent sees the queue, and only what was queued.
  const queue = await app.inject({ method: 'GET', url: '/api/agent/tickets?requested=1', headers: agent });
  assert.equal(queue.statusCode, 200, queue.body);
  assert.deepEqual(queue.json().tickets.map((ticket: { id: string }) => ticket.id), [queued]);
  assert.ok(queue.json().tickets[0].fixRequestedAt);
  const bad = await app.inject({ method: 'GET', url: '/api/agent/tickets?requested=yes', headers: agent });
  assert.equal(bad.statusCode, 400);

  // The request is traced in the work log, with the status move.
  const detail = await app.inject({ method: 'GET', url: `/api/agent/tickets/${queued}`, headers: agent });
  const log = detail.json().comments as Comment[];
  assert.equal(log.at(-1)?.body, 'Correction demandée à Claude Code.');
  assert.equal(log.at(-1)?.statusFrom, 'TODO');
  assert.equal(log.at(-1)?.statusTo, 'IN_PROGRESS');

  // Moving the ticket to review answers the request and empties the queue.
  const done = await app.inject({
    method: 'PATCH',
    url: `/api/agent/tickets/${queued}`,
    headers: agent,
    payload: { status: 'REVIEW', comment: 'Menu corrigé.' },
  });
  assert.equal(done.statusCode, 200, done.body);
  const after = await app.inject({ method: 'GET', url: '/api/agent/tickets?requested=1', headers: agent });
  assert.equal(after.json().total, 0);

  // The admin can also withdraw a request.
  await app.inject({ method: 'POST', url: `/api/tickets/${untouched}/fix-request`, headers: auth.write, payload: {} });
  const withdrawn = await app.inject({ method: 'DELETE', url: `/api/tickets/${untouched}/fix-request`, headers: auth.write });
  assert.equal(withdrawn.statusCode, 200, withdrawn.body);
  const empty = await app.inject({ method: 'GET', url: '/api/agent/tickets?requested=1', headers: agent });
  assert.equal(empty.json().total, 0);
});
