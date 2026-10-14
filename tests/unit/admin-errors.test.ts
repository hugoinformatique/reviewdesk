import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, loginErrorMessage } from '../../admin/src/lib/api.js';

test('the login UI distinguishes credentials, throttling and infrastructure failures', () => {
  assert.equal(loginErrorMessage(new ApiError(401)), 'Identifiants invalides.');
  assert.match(loginErrorMessage(new ApiError(429)), /Trop de tentatives/);
  assert.match(loginErrorMessage(new ApiError(500)), /Service momentanément indisponible/);
  // A network failure is a TypeError from fetch, not an ApiError.
  assert.match(loginErrorMessage(new TypeError('Failed to fetch')), /Service momentanément indisponible/);
});
