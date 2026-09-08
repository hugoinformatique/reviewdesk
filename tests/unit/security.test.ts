import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectImageMime,
  escapeLikePattern,
  isCrossSiteWrite,
  originAllowed,
  secretsMatch,
  securityHeaders,
  selfOrigin,
} from '../../src/security.js';
import { PNG_1X1 } from '../helpers/harness.js';

test('image type comes from the magic bytes, and SVG has none', () => {
  assert.equal(detectImageMime(PNG_1X1), 'image/png');
  assert.equal(detectImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])), 'image/jpeg');
  assert.equal(detectImageMime(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])), 'image/webp');
  assert.equal(detectImageMime(Buffer.from('<svg onload="alert(1)"></svg>')), null);
  assert.equal(detectImageMime(Buffer.from('GIF89a')), null);
  assert.equal(detectImageMime(Buffer.from('<!doctype html>')), null);
  assert.equal(detectImageMime(Buffer.alloc(0)), null);
});

test('origin matching is exact, never a prefix or suffix', () => {
  const allowed = ['https://preview.client.test'];
  assert.equal(originAllowed(allowed, 'https://preview.client.test'), true);
  for (const hostile of [
    'https://preview.client.test.evil.test',
    'https://evil.test/preview.client.test',
    'http://preview.client.test',
    'https://preview.client.test:8443',
    'https://PREVIEW.client.test',
    'null',
    undefined,
  ]) {
    assert.equal(originAllowed(allowed, hostile), false, String(hostile));
  }
});

test('cross-site admin writes are detected from Sec-Fetch-Site, then Origin', () => {
  assert.equal(isCrossSiteWrite({ 'sec-fetch-site': 'same-origin' }), false);
  assert.equal(isCrossSiteWrite({ 'sec-fetch-site': 'none' }), false);
  assert.equal(isCrossSiteWrite({ 'sec-fetch-site': 'cross-site' }), true);
  assert.equal(isCrossSiteWrite({ 'sec-fetch-site': 'same-site' }), true, 'a sibling subdomain is not us');
  assert.equal(isCrossSiteWrite({ origin: 'https://evil.test', host: 'reviewdesk.example' }), true);
  assert.equal(
    isCrossSiteWrite({ origin: 'https://reviewdesk.example', host: 'reviewdesk.example', 'x-forwarded-proto': 'https' }),
    false,
  );
  assert.equal(isCrossSiteWrite({}), false, 'a non-browser client sends neither header');
});

test('the served origin follows the platform forwarding headers', () => {
  assert.equal(selfOrigin({ host: 'localhost:4300' }), 'http://localhost:4300');
  assert.equal(
    selfOrigin({ 'x-forwarded-host': 'reviewdesk.vercel.app', host: 'internal', 'x-forwarded-proto': 'https,http' }),
    'https://reviewdesk.vercel.app',
  );
  assert.equal(selfOrigin({}), undefined);
});

test('LIKE metacharacters in a filter cannot widen the query', () => {
  assert.equal(escapeLikePattern('100%_off\\'), '100\\%\\_off\\\\');
});

test('secret comparison does not depend on length or content shape', () => {
  assert.equal(secretsMatch('abc', 'abc'), true);
  assert.equal(secretsMatch('abc', 'abd'), false);
  assert.equal(secretsMatch('', 'a-much-longer-secret'), false);
});

test('responses carry the hardening headers, HSTS only over TLS', () => {
  const plain = securityHeaders({ https: false, contentSecurityPolicy: "default-src 'none'" });
  assert.equal(plain['X-Content-Type-Options'], 'nosniff');
  assert.equal(plain['Referrer-Policy'], 'no-referrer');
  assert.equal(plain['X-Frame-Options'], 'DENY');
  assert.equal(plain['Strict-Transport-Security'], undefined);
  const secure = securityHeaders({ https: true, contentSecurityPolicy: "default-src 'none'" });
  assert.match(secure['Strict-Transport-Security']!, /max-age=31536000/);
});
