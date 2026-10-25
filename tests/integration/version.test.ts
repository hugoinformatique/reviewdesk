import test from 'node:test';
import assert from 'node:assert/strict';
import pkg from '../../package.json' with { type: 'json' };
import { createTestApp, loginAdmin } from '../helpers/harness.js';
import type { FetchLike } from '../../src/update-check.js';

const github: FetchLike = async () =>
  new Response(JSON.stringify({ tag_name: 'v999.0.0', html_url: 'https://github.com/hugoinformatique/reviewdesk/releases/tag/v999.0.0' }));

test('GET /api/version is admin only', async (t) => {
  let calls = 0;
  const app = await createTestApp(t, {}, { updateFetch: async (...args) => (calls += 1, github(...args)) });
  const anonymous = await app.inject({ method: 'GET', url: '/api/version' });
  assert.equal(anonymous.statusCode, 401);
  assert.equal(calls, 0, 'an unauthenticated request never triggers the outbound check');
});

test('GET /api/version reports the installed and the latest version', async (t) => {
  const app = await createTestApp(t, {}, { updateFetch: github });
  const auth = await loginAdmin(app);
  const response = await app.inject({ method: 'GET', url: '/api/version', headers: auth.read });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), {
    current: pkg.version,
    latest: '999.0.0',
    updateAvailable: true,
    releaseUrl: 'https://github.com/hugoinformatique/reviewdesk/releases/tag/v999.0.0',
    checkEnabled: true,
  });
});

test('UPDATE_CHECK=false answers with the version only and never calls out', async (t) => {
  let calls = 0;
  const app = await createTestApp(t, { UPDATE_CHECK: 'false' }, { updateFetch: async (...args) => (calls += 1, github(...args)) });
  const auth = await loginAdmin(app);
  const response = await app.inject({ method: 'GET', url: '/api/version', headers: auth.read });
  assert.deepEqual(response.json(), { current: pkg.version, latest: null, updateAvailable: false, releaseUrl: null, checkEnabled: false });
  assert.equal(calls, 0);
});
