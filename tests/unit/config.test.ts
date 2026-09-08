import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError, assertStrongAdminPassword, loadConfig } from '../../src/config.js';

const base = {
  ADMIN_PASSWORD: 'grenat-fougere-litanie-8412',
  DATABASE_URL: 'postgres://user:pw@db.example.test/reviewdesk',
  STORAGE_DRIVER: 's3',
  S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  S3_BUCKET: 'reviewdesk',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
};

const expectConfigError = (env: Record<string, string | undefined>, match: RegExp) =>
  assert.throws(() => loadConfig(env), (error: unknown) => error instanceof ConfigError && match.test(error.message));

test('a production configuration resolves to postgres plus a private S3 bucket', () => {
  const config = loadConfig({ ...base, NODE_ENV: 'production' });
  assert.equal(config.production, true);
  assert.equal(config.database.driver, 'postgres');
  assert.equal(config.storage.driver, 's3');
  assert.equal(config.secureCookies, true);
  assert.equal(config.serveStatic, true, 'self-hosted production still serves public/');
  assert.equal(config.database.driver === 'postgres' && config.database.ssl, true, 'TLS on for a remote host');
  assert.equal(config.database.driver === 'postgres' && config.database.poolMax, 1);
});

test('VERCEL=1 is production and hands static files to the CDN', () => {
  const config = loadConfig({ ...base, VERCEL: '1' });
  assert.equal(config.production, true);
  assert.equal(config.serveStatic, false);
  assert.equal(config.secureCookies, true);
});

test('the managed Vercel database URL is a failover, not an override', () => {
  const integrated = loadConfig({ ...base, DATABASE_URL: undefined, POSTGRES_URL: 'postgres://integration.example.test/reviewdesk' });
  assert.equal(integrated.database.driver === 'postgres' && integrated.database.url, 'postgres://integration.example.test/reviewdesk');

  const explicit = loadConfig({ ...base, POSTGRES_URL: 'postgres://integration.example.test/reviewdesk' });
  assert.equal(explicit.database.driver === 'postgres' && explicit.database.url, base.DATABASE_URL);
});

test('the embedded dev drivers are refused in production', () => {
  expectConfigError({ ...base, NODE_ENV: 'production', DATABASE_URL: 'pglite://.data/reviewdesk' }, /refused in production/);
  expectConfigError({ ...base, VERCEL: '1', DATABASE_URL: 'pglite://memory' }, /refused in production/);
  expectConfigError({ ...base, NODE_ENV: 'production', STORAGE_DRIVER: 'filesystem' }, /refused in production/);
  expectConfigError({ ...base, VERCEL: '1', S3_ENDPOINT: 'http://insecure.example.test' }, /https in production/);
});

test('the embedded dev drivers stay available outside production', () => {
  const config = loadConfig({
    ADMIN_PASSWORD: base.ADMIN_PASSWORD,
    DATABASE_URL: 'pglite://.data/reviewdesk',
    STORAGE_DRIVER: 'filesystem',
    UPLOAD_DIR: '.data/uploads',
  });
  assert.equal(config.production, false);
  assert.deepEqual(config.database, { driver: 'pglite', path: '.data/reviewdesk' });
  assert.deepEqual(config.storage, { driver: 'filesystem', directory: '.data/uploads' });
  assert.equal(config.secureCookies, false);
});

test('a missing or malformed backend configuration fails at boot, not at runtime', () => {
  expectConfigError({ ...base, DATABASE_URL: undefined }, /DATABASE_URL or POSTGRES_URL is required/);
  expectConfigError({ ...base, DATABASE_URL: 'mysql://db.example.test/x' }, /must start with postgres/);
  expectConfigError({ ...base, S3_BUCKET: undefined }, /S3_BUCKET is required/);
  expectConfigError({ ...base, S3_ENDPOINT: 'account.r2.cloudflarestorage.com' }, /absolute http\(s\) URL/);
  expectConfigError({ ...base, STORAGE_DRIVER: 'dropbox' }, /STORAGE_DRIVER/);
  expectConfigError({ ...base, DATABASE_POOL_MAX: '0' }, /DATABASE_POOL_MAX/);
});

test('the upload cap stays under the 4.5 MB serverless request body limit', () => {
  assert.equal(loadConfig(base).uploadMaxBytes, 4_000_000);
  expectConfigError({ ...base, UPLOAD_MAX_BYTES: '10000000' }, /UPLOAD_MAX_BYTES/);
});

test('a weak admin secret is rejected before the server can start', () => {
  for (const weak of ['short', 'aaaaaaaaaaaaaaaaaaaa', 'reviewdesk-admin-2026', 'my-password-is-long']) {
    assert.throws(() => assertStrongAdminPassword(weak), ConfigError, weak);
  }
  assert.doesNotThrow(() => assertStrongAdminPassword('grenat-fougere-litanie-8412'));
  expectConfigError({ ...base, ADMIN_PASSWORD: 'admin' }, /ADMIN_PASSWORD/);
});

test('Supabase storage is accepted in production without S3 credentials', () => {
  const env = {
    ...base,
    STORAGE_DRIVER: 'supabase',
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-value',
    SUPABASE_STORAGE_BUCKET: 'reviewdesk',
  };
  (env as Record<string, string | undefined>).S3_ENDPOINT = undefined;
  const config = loadConfig(env);
  assert.deepEqual(config.storage, {
    driver: 'supabase',
    endpoint: 'https://project.supabase.co',
    serviceRoleKey: 'service-role-value',
    bucket: 'reviewdesk',
    keyPrefix: 'objects',
  });
});
