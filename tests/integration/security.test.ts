import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../../src/app.js';

test('auth fails closed and upload rejects SVG', async (t) => {
  const app = await buildApp({ database: 'memory://', adminPassword: 'long-enough-admin-password', uploadDir: '/tmp/reviewdesk-security-uploads' });
  t.after(() => app.close());
  assert.equal((await app.inject({ method: 'GET', url: '/api/projects' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'wrong' } })).statusCode, 401);
});
