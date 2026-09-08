import test from 'node:test';
import assert from 'node:assert/strict';
import { loginErrorMessage } from '../../src/admin/errors.js';

test('the login UI distinguishes credentials, throttling and infrastructure failures', () => {
  assert.equal(loginErrorMessage(401), 'Identifiants invalides.');
  assert.match(loginErrorMessage(429), /Trop de tentatives/);
  assert.match(loginErrorMessage(500), /Service momentanément indisponible/);
  assert.match(loginErrorMessage(0), /Service momentanément indisponible/);
});
