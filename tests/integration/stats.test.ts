import test from 'node:test';
import assert from 'node:assert/strict';
import { anchor, createProject, createReviewLink, createTestApp, loginAdmin } from '../helpers/harness.js';
import type { App } from '../../src/app.js';
import type { AdminAuth, Project } from '../helpers/harness.js';

async function fileTicket(app: App, token: string, project: Project, text: string, page = '/tarifs'): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/feedback',
    headers: { authorization: `Bearer ${token}`, origin: project.origins[0]! },
    payload: { projectId: project.id, text, pageUrl: `${project.origins[0]}${page}`, anchor },
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().id as string;
}

async function seed(app: App, auth: AdminAuth) {
  const atelier = await createProject(app, auth, {
    name: 'DEMO Atelier',
    clientLabel: 'DEMO Client A',
    origins: ['https://preview.client-a.test'],
  });
  const boutique = await createProject(app, auth, {
    name: 'DEMO Boutique',
    clientLabel: 'DEMO Client B',
    origins: ['https://preview.client-b.test'],
  });
  const atelierLink = await createReviewLink(app, auth, atelier.id);
  const boutiqueLink = await createReviewLink(app, auth, boutique.id);
  const first = await fileTicket(app, atelierLink.token, atelier, 'Le bouton est illisible');
  await fileTicket(app, atelierLink.token, atelier, 'La page déborde', '/tarifs');
  const other = await fileTicket(app, boutiqueLink.token, boutique, 'Le menu se referme', '/contact');
  return { atelier, boutique, first, other };
}

test('the overview counts what is waiting, what moved and where', async (t) => {
  const app = await createTestApp(t);
  const auth = await loginAdmin(app);
  const { atelier, first } = await seed(app, auth);

  await app.inject({
    method: 'PATCH',
    url: `/api/tickets/${first}`,
    headers: auth.write,
    payload: { status: 'DONE' },
  });

  const response = await app.inject({ method: 'GET', url: '/api/stats?days=30', headers: auth.read });
  assert.equal(response.statusCode, 200, response.body);
  const stats = response.json();

  assert.equal(stats.days, 30);
  assert.equal(stats.total, 3);
  assert.deepEqual(stats.byStatus, { TODO: 2, IN_PROGRESS: 0, REVIEW: 0, DONE: 1 });
  assert.equal(stats.received, 3);
  assert.equal(stats.receivedPrevious, 0, 'nothing existed before this test ran');
  assert.equal(stats.resolved, 1);
  // A ticket closed within the test took seconds, not zero: the figure exists.
  assert.ok(stats.resolutionSeconds !== null && stats.resolutionSeconds >= 0);
  assert.equal(stats.stale, 0, 'nothing is a week old yet');

  const today = new Date().toISOString().slice(0, 10);
  assert.equal(stats.daily.received[today], 3);
  assert.equal(stats.daily.resolved[today], 1);

  const byName = Object.fromEntries(
    (stats.projects as { name: string; todo: number; done: number; total: number }[]).map((row) => [row.name, row]),
  );
  assert.equal(byName['DEMO Atelier']!.todo, 1);
  assert.equal(byName['DEMO Atelier']!.done, 1);
  assert.equal(byName['DEMO Boutique']!.total, 1);
  // The busiest page comes first, with its open count alongside.
  assert.equal(stats.pages[0].pageUrl, 'https://preview.client-a.test/tarifs');
  assert.equal(stats.pages[0].count, 2);
  assert.equal(stats.pages[0].open, 1);

  // Scoping to a project restricts every part of the answer, not just the list.
  const scoped = await app.inject({ method: 'GET', url: `/api/stats?projectId=${atelier.id}`, headers: auth.read });
  const scopedStats = scoped.json();
  assert.equal(scopedStats.total, 2);
  assert.equal(scopedStats.projects.length, 1);
  assert.equal(scopedStats.projects[0].name, 'DEMO Atelier');
  assert.ok(
    (scopedStats.pages as { pageUrl: string }[]).every((page) => page.pageUrl.includes('client-a')),
    'a scoped overview must not count another project’s pages',
  );
});

test('the overview shows the work log, and refuses a period it cannot answer for', async (t) => {
  const app = await createTestApp(t);
  const auth = await loginAdmin(app);
  const { first } = await seed(app, auth);

  const minted = await app.inject({
    method: 'POST',
    url: '/api/agent-tokens',
    headers: auth.write,
    payload: { label: 'Claude Code' },
  });
  await app.inject({
    method: 'PATCH',
    url: `/api/agent/tickets/${first}`,
    headers: { authorization: `Bearer ${minted.json().token}` },
    payload: { status: 'REVIEW', comment: 'Contraste corrigé.' },
  });

  const stats = (await app.inject({ method: 'GET', url: '/api/stats?days=7', headers: auth.read })).json();
  assert.equal(stats.days, 7);
  assert.equal(stats.activity.length, 1);
  assert.equal(stats.activity[0].author, 'agent');
  assert.equal(stats.activity[0].authorLabel, 'Claude Code');
  assert.equal(stats.activity[0].statusTo, 'REVIEW');
  assert.equal(stats.activity[0].ticketId, first);

  for (const url of ['/api/stats?days=5', '/api/stats?days=abc', '/api/stats?projectId=not-a-uuid']) {
    const refused = await app.inject({ method: 'GET', url, headers: auth.read });
    assert.equal(refused.statusCode, 400, url);
  }
  assert.equal((await app.inject({ method: 'GET', url: '/api/stats' })).statusCode, 401, 'stats are admin-only');
});
