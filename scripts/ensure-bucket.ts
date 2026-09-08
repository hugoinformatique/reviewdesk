/**
 * Creates the test bucket on an S3-compatible endpoint using the same SigV4
 * signer the application uses. Idempotent: an existing bucket is accepted.
 */
import { loadConfig } from '../src/config.js';
import { signRequest } from '../src/storage/s3.js';

const config = loadConfig({
  ...process.env,
  NODE_ENV: 'test',
  VERCEL: '',
  ADMIN_PASSWORD: 'bucket-bootstrap-not-a-server',
  DATABASE_URL: 'pglite://memory',
  STORAGE_DRIVER: 's3',
}).storage;
if (config.driver !== 's3') throw new Error('expected the s3 storage driver');

// An empty key addresses the bucket itself under path style.
const signed = signRequest({ config, method: 'PUT', key: '', payload: Buffer.alloc(0) });
const response = await fetch(signed.url, { method: 'PUT', headers: signed.headers });
const body = await response.text();
if (response.ok || /BucketAlreadyOwnedByYou|BucketAlreadyExists/.test(body)) {
  process.stdout.write(`bucket ready: ${config.bucket}\n`);
} else {
  process.stderr.write(`bucket creation failed (${response.status}): ${body.slice(0, 300)}\n`);
  process.exit(1);
}
