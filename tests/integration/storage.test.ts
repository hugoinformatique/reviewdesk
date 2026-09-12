import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../../src/config.js';
import { createObjectStore } from '../../src/storage/index.js';
import { signRequest } from '../../src/storage/s3.js';
import { PNG_1X1, testEnv, usingRealS3 } from '../helpers/harness.js';

/**
 * Runs against the disposable MinIO from `scripts/docker-backends.sh`. MinIO
 * validates SigV4 itself, so a passing round-trip is independent confirmation
 * that the hand-written signer is correct.
 */
test('object store round-trips a private upload', async () => {
  const storage = loadConfig(testEnv()).storage;
  const store = await createObjectStore(storage);
  const key = `${randomUUID()}/${randomUUID()}.png`;

  assert.equal(await store.get(key), null, 'absent key reads as null, not an error');
  await store.put(key, PNG_1X1, 'image/png');
  const fetched = await store.get(key);
  assert.ok(fetched);
  assert.deepEqual(fetched.body, PNG_1X1);
  assert.equal(fetched.contentType, 'image/png');
  await store.delete(key);
  assert.equal(await store.get(key), null, 'delete is effective');
  await assert.doesNotReject(() => store.delete(key), 'deleting twice is not an error');
});

test('stored objects are not readable without a signature', { skip: !usingRealS3 && 'requires TEST_S3_ENDPOINT' }, async () => {
  const storage = loadConfig(testEnv()).storage;
  assert.equal(storage.driver, 's3');
  if (storage.driver !== 's3') return;
  const store = await createObjectStore(storage);
  const key = `${randomUUID()}.png`;
  await store.put(key, PNG_1X1, 'image/png');

  const fullKey = `${storage.keyPrefix}/${key}`;
  const signed = signRequest({ config: storage, method: 'GET', key: fullKey, payload: Buffer.alloc(0) });

  const anonymous = await fetch(signed.url);
  assert.equal(anonymous.ok, false, 'an unsigned GET must not return the bytes');
  assert.ok([401, 403].includes(anonymous.status), `expected 401/403, got ${anonymous.status}`);

  const listing = await fetch(`${storage.endpoint}/${storage.bucket}`);
  assert.equal(listing.ok, false, 'the bucket must not be publicly listable');

  const tampered = await fetch(signed.url, {
    headers: { ...signed.headers, authorization: signed.headers.authorization!.replace(/.$/, c => c === '0' ? '1' : '0') },
  });
  assert.equal(tampered.ok, false, 'a tampered signature is rejected');
  await store.delete(key);
});

test('a wrong secret key is rejected by the object store', { skip: !usingRealS3 && 'requires TEST_S3_ENDPOINT' }, async () => {
  const storage = loadConfig(testEnv()).storage;
  if (storage.driver !== 's3') return;
  const store = await createObjectStore({ ...storage, secretAccessKey: 'wrong-secret' });
  await assert.rejects(() => store.put(`${randomUUID()}.png`, PNG_1X1, 'image/png'), /rejected PUT \(40[0-9]/);
});
