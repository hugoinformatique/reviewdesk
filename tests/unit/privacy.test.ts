import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanUrl, normalizeDiagnostics } from '../../src/privacy.js';

test('cleanUrl removes query, hash and credentials', () => {
  assert.equal(cleanUrl('https://u:p@example.test/path?a=token#secret'), 'https://example.test/path');
});

test('diagnostics keeps only coarse allowlisted fields', () => {
  const result = normalizeDiagnostics({ viewport: { width: 390, height: 844 }, dpr: 3, timezone: 'Europe/Paris', locale: 'fr-FR', orientation: 'portrait', platform: 'MacIntel', userAgent: 'full agent secret', cookies: 'no', console: ['private'], errors: [{ category: 'widget', code: 'ANCHOR_MISSING', count: 2, message: 'Bearer abcdefghijklmnopqrstuvwxyz' }] });
  assert.equal(result.path, undefined);
  assert.equal('cookies' in result, false);
  assert.equal('console' in result, false);
  assert.equal('userAgent' in result, false);
  assert.equal(result.browser, 'Unknown');
  assert.equal(result.os, 'macOS');
  assert.equal(result.errors?.[0]?.message, '[redacted]');
});
