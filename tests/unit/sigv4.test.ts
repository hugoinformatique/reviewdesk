import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { StorageConfig } from '../../src/config.js';
import { signRequest } from '../../src/storage/s3.js';

type S3Config = Extract<StorageConfig, { driver: 's3' }>;

/**
 * These tests pin the *construction* of the request: URL shape, key encoding,
 * which headers end up signed, and that the signature is bound to the payload.
 *
 * They deliberately do not assert a hard-coded signature digest, which would
 * only prove this signer agrees with itself. The cryptographic check is
 * `tests/integration/storage.test.ts`: MinIO recomputes the signature from the
 * canonical request and answers 403 SignatureDoesNotMatch on any mismatch, so a
 * green round-trip there is an independent verification of the algorithm.
 */
const base: S3Config = {
  driver: 's3',
  bucket: 'examplebucket',
  endpoint: 'https://s3.example.test',
  region: 'eu-west-3',
  accessKeyId: 'AKIAEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  forcePathStyle: false,
  keyPrefix: '',
};
const AT = new Date('2013-05-24T00:00:00Z');

const signatureOf = (authorization: string) => /Signature=([0-9a-f]{64})$/.exec(authorization)?.[1];
const signedHeadersOf = (authorization: string) => /SignedHeaders=([^,]+)/.exec(authorization)?.[1];

test('virtual host style puts the bucket in Host and encodes the key per RFC 3986', () => {
  const signed = signRequest({
    config: base,
    method: 'PUT',
    key: 'test$file (v2).text',
    payload: Buffer.from('Welcome to Amazon S3.'),
    now: AT,
  });
  assert.equal(signed.url, 'https://examplebucket.s3.example.test/test%24file%20%28v2%29.text');
  assert.equal(signed.headers.host, 'examplebucket.s3.example.test');
  assert.equal(signed.headers['x-amz-date'], '20130524T000000Z');
  assert.equal(
    signed.headers['x-amz-content-sha256'],
    createHash('sha256').update('Welcome to Amazon S3.').digest('hex'),
  );
  assert.match(signed.headers.authorization!, /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/20130524\/eu-west-3\/s3\/aws4_request, /);
});

test('path style keeps the bucket in the URI and preserves key slashes', () => {
  const minio: S3Config = { ...base, endpoint: 'http://127.0.0.1:59000', forcePathStyle: true, region: 'auto' };
  const signed = signRequest({ config: minio, method: 'GET', key: 'a/b c.png', payload: Buffer.alloc(0), now: AT });
  assert.equal(signed.url, 'http://127.0.0.1:59000/examplebucket/a/b%20c.png');
  assert.equal(signed.headers.host, '127.0.0.1:59000');
  assert.match(signed.headers.authorization!, /Credential=AKIAEXAMPLE\/20130524\/auto\/s3\/aws4_request/);
});

test('an endpoint path prefix is preserved ahead of the bucket', () => {
  const proxied: S3Config = { ...base, endpoint: 'https://gateway.example.test/storage', forcePathStyle: true };
  const signed = signRequest({ config: proxied, method: 'GET', key: 'k.png', payload: Buffer.alloc(0), now: AT });
  assert.equal(signed.url, 'https://gateway.example.test/storage/examplebucket/k.png');
});

test('an empty payload hashes to the well-known empty SHA-256', () => {
  const signed = signRequest({ config: base, method: 'GET', key: 'k', payload: Buffer.alloc(0), now: AT });
  assert.equal(
    signed.headers['x-amz-content-sha256'],
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
});

test('signed headers are sorted and cover every header actually sent', () => {
  const withToken: S3Config = { ...base, sessionToken: 'FQoDYXdzE' };
  const signed = signRequest({
    config: withToken,
    method: 'PUT',
    key: 'k',
    payload: Buffer.from('x'),
    contentType: 'image/png',
    now: AT,
  });
  const signedHeaders = signedHeadersOf(signed.headers.authorization!)!.split(';');
  assert.deepEqual(signedHeaders, [...signedHeaders].sort(), 'canonical headers must be sorted');
  const sent = Object.keys(signed.headers).filter((name) => name !== 'authorization');
  assert.deepEqual(signedHeaders, sent.sort(), 'every sent header is signed');
  assert.equal(signed.headers['x-amz-security-token'], 'FQoDYXdzE');
  assert.equal(signed.headers['content-type'], 'image/png');
});

test('the signature is bound to the payload, the key, the method and the clock', () => {
  const of = (options: Parameters<typeof signRequest>[0]) => signatureOf(signRequest(options).headers.authorization!);
  const reference = of({ config: base, method: 'PUT', key: 'k', payload: Buffer.from('a'), now: AT });
  assert.equal(of({ config: base, method: 'PUT', key: 'k', payload: Buffer.from('a'), now: AT }), reference, 'deterministic');
  assert.notEqual(of({ config: base, method: 'PUT', key: 'k', payload: Buffer.from('b'), now: AT }), reference);
  assert.notEqual(of({ config: base, method: 'PUT', key: 'j', payload: Buffer.from('a'), now: AT }), reference);
  assert.notEqual(of({ config: base, method: 'GET', key: 'k', payload: Buffer.from('a'), now: AT }), reference);
  assert.notEqual(
    of({ config: base, method: 'PUT', key: 'k', payload: Buffer.from('a'), now: new Date('2013-05-25T00:00:00Z') }),
    reference,
  );
  assert.notEqual(
    of({ config: { ...base, secretAccessKey: 'other' }, method: 'PUT', key: 'k', payload: Buffer.from('a'), now: AT }),
    reference,
  );
});
