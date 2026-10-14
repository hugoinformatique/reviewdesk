import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildDockerManifest, deriveProductionLock, validateDockerManifest, packageDocker } from '../../scripts/packaging/docker/package-docker.mjs';
import { classifyAnonymousProbe, classifyAuthenticatedProbe, ensureBucket, prepareRuntimeEnv, prepareS3Env, verifyObjectPrivacy } from '../../scripts/packaging/docker/template/app/runtime-config.mjs';
import { readZip } from './docker-zip.mjs';

const run = promisify(execFile);
// Only Compose project used by these tests (config only: nothing is created).
const PROJECT = 'reviewdesk-kit-selfcontained-test';
const SEAWEED = 'chrislusf/seaweedfs@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d';
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const template = path.join(repository, 'scripts/packaging/docker/template');
const json = async file => JSON.parse(await readFile(path.join(repository, file), 'utf8'));

async function scratch(t, label = 'docker package') {
  const root = await mkdtemp(path.join(tmpdir(), `ReviewDesk ${label} `));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

const entry = (version, extra = {}) => ({ version, resolved: `https://registry.npmjs.org/x/-/x-${version}.tgz`, integrity: 'sha512-AAAA', license: 'MIT', ...extra });

test('production manifest pins the app dependencies exactly and excludes PGlite', async () => {
  const manifest = buildDockerManifest(await json('package.json'), await json('package-lock.json'));
  assert.equal(manifest.name, 'reviewdesk-docker');
  assert.equal(manifest.license, 'UNLICENSED');
  assert.equal(manifest.private, true);
  assert.equal(manifest.devDependencies, undefined);
  assert.equal(manifest.dependencies['@electric-sql/pglite'], undefined);
  for (const version of Object.values(manifest.dependencies)) assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(Object.keys(manifest.dependencies), Object.keys((await json('package.json')).dependencies).sort());
});

test('lock derivation removes PGlite and orphans, keeps shared packages, and is deterministic', () => {
  const manifest = { name: 'reviewdesk-docker', version: '8.0.0', private: true, license: 'UNLICENSED', type: 'module', engines: { node: '22.x' }, dependencies: { a: '1.0.0' } };
  const source = {
    name: 'reviewdesk-local', version: '8.0.0', lockfileVersion: 3, requires: true,
    packages: {
      '': { name: 'reviewdesk-local', version: '8.0.0', dependencies: { '@electric-sql/pglite': '0.5.8', a: '1.0.0' } },
      'node_modules/@electric-sql/pglite': entry('0.5.8', { dependencies: { orphan: '^2.0.0', shared: '^3.0.0' } }),
      'node_modules/a': entry('1.0.0', { dependencies: { shared: '^3.0.0', nested: '^1.0.0' } }),
      'node_modules/a/node_modules/nested': entry('1.1.0'),
      'node_modules/orphan': entry('2.0.0'),
      'node_modules/shared': entry('3.0.0'),
    },
  };
  const lock = deriveProductionLock(source, manifest);
  assert.deepEqual(Object.keys(lock.packages).sort(), ['', 'node_modules/a', 'node_modules/a/node_modules/nested', 'node_modules/shared']);
  assert.equal(lock.name, 'reviewdesk-docker');
  assert.deepEqual(lock.packages[''].dependencies, { a: '1.0.0' });
  assert.equal(JSON.stringify(deriveProductionLock(source, manifest)), JSON.stringify(lock));
  validateDockerManifest(manifest, lock);
});

test('manifest validation fails closed on PGlite, ranges, dev entries and non-registry sources', () => {
  const manifest = { name: 'reviewdesk-docker', version: '8.0.0', private: true, license: 'UNLICENSED', type: 'module', engines: { node: '22.x' }, dependencies: { a: '1.0.0' } };
  const lock = () => ({ name: 'reviewdesk-docker', version: '8.0.0', lockfileVersion: 3, packages: { '': { name: 'reviewdesk-docker', version: '8.0.0', dependencies: { a: '1.0.0' } }, 'node_modules/a': entry('1.0.0') } });
  validateDockerManifest(manifest, lock());
  assert.throws(() => validateDockerManifest({ ...manifest, dependencies: { a: '^1.0.0' } }, lock()));
  const withPglite = lock();
  withPglite.packages['node_modules/@electric-sql/pglite'] = entry('0.5.8');
  assert.throws(() => validateDockerManifest(manifest, withPglite), /pglite/i);
  for (const patch of [{ dev: true }, { integrity: undefined }, { resolved: 'git+https://example.invalid/a.git' }]) {
    const bad = lock();
    Object.assign(bad.packages['node_modules/a'], patch);
    assert.throws(() => validateDockerManifest(manifest, bad));
  }
});

const secretsFor = values => name => {
  if (!(name in values)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
  return values[name];
};
const goodSecrets = { admin_password: 'Tq7vXr2pLm9sKd4wZb8n', postgres_password: 'p@ss/w:rd?#%7Qx9Lz', s3_access_key_id: 'AKIAEXAMPLE', s3_secret_access_key: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCY' };
const goodEnv = { S3_ENDPOINT: 'https://s3.example.test:8443', S3_BUCKET: 'reviewdesk-captures', S3_REGION: 'auto', S3_FORCE_PATH_STYLE: 'true', S3_KEY_PREFIX: 'uploads' };

test('runtime env keeps the exact HTTPS endpoint and URL-encodes the database password', () => {
  const env = prepareRuntimeEnv({ ...goodEnv }, secretsFor({ ...goodSecrets, admin_password: `${goodSecrets.admin_password}\n` }));
  assert.equal(env.S3_ENDPOINT, 'https://s3.example.test:8443');
  assert.equal(env.ADMIN_PASSWORD, goodSecrets.admin_password);
  assert.equal(env.S3_SECRET_ACCESS_KEY, goodSecrets.s3_secret_access_key);
  const url = new URL(env.DATABASE_URL);
  assert.equal(url.hostname, 'postgres');
  assert.equal(decodeURIComponent(url.password), goodSecrets.postgres_password);
  assert.equal(url.searchParams.get('sslmode'), 'disable');
});

test('runtime env fails closed on HTTP, ambiguous endpoints, bad bucket, missing or malformed secrets and stray CA paths', () => {
  for (const S3_ENDPOINT of ['http://s3.example.test', 'https://user:pw@s3.example.test', 'https://s3.example.test/bucket', 'https://s3.example.test?x=1', 'https://s3.example.test/', 'ftp://s3.example.test', '', 'https://']) {
    assert.throws(() => prepareRuntimeEnv({ ...goodEnv, S3_ENDPOINT }, secretsFor(goodSecrets)), /S3_ENDPOINT/, S3_ENDPOINT);
  }
  for (const S3_BUCKET of ['', 'UPPER', 'a', 'bad_bucket', '-x-', 'a..b']) assert.throws(() => prepareRuntimeEnv({ ...goodEnv, S3_BUCKET }, secretsFor(goodSecrets)), /S3_BUCKET/);
  assert.throws(() => prepareRuntimeEnv({ ...goodEnv, S3_FORCE_PATH_STYLE: 'maybe' }, secretsFor(goodSecrets)), /S3_FORCE_PATH_STYLE/);
  for (const name of Object.keys(goodSecrets)) {
    const missing = { ...goodSecrets };
    delete missing[name];
    assert.throws(() => prepareRuntimeEnv({ ...goodEnv }, secretsFor(missing)), new RegExp(name));
    assert.throws(() => prepareRuntimeEnv({ ...goodEnv }, secretsFor({ ...goodSecrets, [name]: '' })), new RegExp(name));
    assert.throws(() => prepareRuntimeEnv({ ...goodEnv }, secretsFor({ ...goodSecrets, [name]: 'two\nlines' })), new RegExp(name));
  }
  assert.throws(() => prepareRuntimeEnv({ ...goodEnv, NODE_EXTRA_CA_CERTS: '/etc/passwd' }, secretsFor(goodSecrets)), /NODE_EXTRA_CA_CERTS/);
  // A secret must never be echoed into an error message.
  try { prepareRuntimeEnv({ ...goodEnv, S3_ENDPOINT: 'http://x' }, secretsFor(goodSecrets)); } catch (error) {
    for (const value of Object.values(goodSecrets)) assert.ok(!error.message.includes(value));
  }
});

test('authenticated bucket probe requires an existing bucket and accepted credentials', () => {
  assert.equal(classifyAuthenticatedProbe(200), 'ok');
  assert.throws(() => classifyAuthenticatedProbe(404), /introuvable/i);
  for (const status of [401, 403]) assert.throws(() => classifyAuthenticatedProbe(status), /identifiants|refus/i);
  for (const status of [301, 400, 500]) assert.throws(() => classifyAuthenticatedProbe(status));
});

test('anonymous bucket probe only accepts an explicit denial', () => {
  for (const status of [401, 403]) assert.equal(classifyAnonymousProbe(status), 'private');
  assert.throws(() => classifyAnonymousProbe(200), /public/i);
  assert.throws(() => classifyAnonymousProbe(404), /introuvable/i);
  for (const status of [301, 307, 400, 500, 503]) assert.throws(() => classifyAnonymousProbe(status));
});

test('runtime refuses endpoints the URL parser would rewrite (case, default port, numeric hosts)', () => {
  for (const S3_ENDPOINT of ['https://S3.example.test', 'https://s3.example.test:443', 'https://s3.example.test:08443', 'https://1.2.3', 'https://0x7f.1']) {
    assert.throws(() => prepareRuntimeEnv({ ...goodEnv, S3_ENDPOINT }, secretsFor(goodSecrets)), /S3_ENDPOINT/, S3_ENDPOINT);
  }
  for (const S3_ENDPOINT of ['https://10.0.0.5:9443', 'https://s3.fr-par.example-cloud.test']) {
    assert.equal(prepareRuntimeEnv({ ...goodEnv, S3_ENDPOINT }, secretsFor(goodSecrets)).S3_ENDPOINT, S3_ENDPOINT);
  }
});

// Simulated object store: records every request; `anonymousGet` is the status an
// unsigned GET of the canary receives (200 = public-read object/bucket policy).
function fakeStore({ put = 200, anonymousGet = 403, del = 204, failOn } = {}) {
  const calls = [];
  const signRequest = ({ config, method, key, payload, contentType }) => ({
    url: `${config.endpoint}/${config.bucket}/${key}`,
    headers: { authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/fake`, ...(contentType ? { 'content-type': contentType } : {}) },
    method, payload,
  });
  const status = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const signed = Boolean(init.headers?.authorization);
    calls.push({ method, url, signed, body: init.body });
    if (failOn === method) throw new Error('S3 injoignable en HTTPS (ECONNRESET).');
    if (method === 'PUT') return put;
    if (method === 'GET' && !signed) return anonymousGet;
    if (method === 'DELETE') return del;
    return 500;
  };
  return { calls, signRequest, status };
}
const probeEnv = () => prepareRuntimeEnv({ ...goodEnv, S3_KEY_PREFIX: 'captures' }, secretsFor(goodSecrets));

test('object privacy canary: signed PUT in the prefix, anonymous GET denied, signed DELETE, nothing left behind', async () => {
  const store = fakeStore();
  assert.equal(await verifyObjectPrivacy({ env: probeEnv(), ...store, id: 'abc123' }), 'private');
  assert.deepEqual(store.calls.map(c => [c.method, c.signed]), [['PUT', true], ['GET', false], ['DELETE', true]]);
  const key = new URL(store.calls[0].url).pathname;
  assert.match(key, /^\/reviewdesk-captures\/captures\/\.reviewdesk-startup-probe-abc123$/);
  assert.ok(store.calls.every(c => c.url === store.calls[0].url), 'same object for all three requests');
  assert.doesNotMatch(String(store.calls[0].body), /AKIA|secret/i, 'harmless body');
});

test('object privacy canary: a public-read object fails start-up, and the canary is still deleted', async () => {
  for (const anonymousGet of [200, 206]) {
    const store = fakeStore({ anonymousGet });
    await assert.rejects(verifyObjectPrivacy({ env: probeEnv(), ...store, id: 'pub' }), /lisible anonymement|public/i);
    assert.equal(store.calls.at(-1).method, 'DELETE');
    assert.ok(store.calls.at(-1).signed);
  }
});

test('object privacy canary: only an explicit 401/403 counts as private; every failure still deletes and never leaks secrets', async () => {
  for (const anonymousGet of [301, 307, 400, 404, 500]) {
    const store = fakeStore({ anonymousGet });
    await assert.rejects(verifyObjectPrivacy({ env: probeEnv(), ...store, id: 'x' }), /inattendue/i, String(anonymousGet));
    assert.equal(store.calls.at(-1).method, 'DELETE');
  }
  for (const [put, pattern] of [[403, /PutObject/], [404, /introuvable/i], [500, /inattendue/i]]) {
    const store = fakeStore({ put });
    await assert.rejects(verifyObjectPrivacy({ env: probeEnv(), ...store, id: 'x' }), pattern);
    assert.deepEqual(store.calls.map(c => c.method), ['PUT', 'DELETE'], 'delete even if the write was refused');
  }
  // A canary that cannot be deleted fails start-up and names its (non-secret) key.
  let store = fakeStore({ del: 403 });
  await assert.rejects(verifyObjectPrivacy({ env: probeEnv(), ...store, id: 'stuck' }), error => {
    assert.match(error.message, /DeleteObject/);
    assert.match(error.message, /captures\/\.reviewdesk-startup-probe-stuck/);
    for (const value of Object.values(goodSecrets)) assert.ok(!error.message.includes(value));
    return true;
  });
  // Public object AND failed delete: both problems are reported.
  store = fakeStore({ anonymousGet: 200, del: 500 });
  await assert.rejects(verifyObjectPrivacy({ env: probeEnv(), ...store, id: 'both' }), /public[\s\S]*reviewdesk-startup-probe-both/i);
  // Network failure during the anonymous GET: delete still attempted.
  store = fakeStore({ failOn: 'GET' });
  await assert.rejects(verifyObjectPrivacy({ env: probeEnv(), ...store, id: 'net' }), /injoignable/);
  assert.equal(store.calls.at(-1).method, 'DELETE');
  // 404 on delete means already gone: acceptable.
  assert.equal(await verifyObjectPrivacy({ env: probeEnv(), ...fakeStore({ del: 404 }), id: 'gone' }), 'private');
});

test('object privacy canary uses a fresh random key per start by default', async () => {
  const keys = [];
  for (let i = 0; i < 2; i++) {
    const store = fakeStore();
    await verifyObjectPrivacy({ env: probeEnv(), ...store });
    keys.push(store.calls[0].url);
  }
  assert.notEqual(keys[0], keys[1]);
  assert.match(keys[0], /reviewdesk-startup-probe-[0-9a-f-]{36}$/);
});

test('S3 env for the bucket bootstrap reads only the named S3 secrets', () => {
  const read = name => {
    if (!['s3_admin_access_key_id', 's3_admin_secret_access_key'].includes(name)) throw new Error(`unexpected secret ${name}`);
    return { s3_admin_access_key_id: 'RDKADMINKEY0001', s3_admin_secret_access_key: 'AdminSecretValue0123456789abcdefABCDEF01' }[name];
  };
  const env = prepareS3Env({ ...goodEnv, S3_ENDPOINT: 'https://s3:8443' }, read, { accessKeyId: 's3_admin_access_key_id', secretAccessKey: 's3_admin_secret_access_key' });
  assert.equal(env.S3_ACCESS_KEY_ID, 'RDKADMINKEY0001');
  assert.equal(env.S3_SECRET_ACCESS_KEY, 'AdminSecretValue0123456789abcdefABCDEF01');
  assert.equal(env.S3_ENDPOINT, 'https://s3:8443');
  assert.equal(env.ADMIN_PASSWORD, undefined);
  assert.equal(env.DATABASE_URL, undefined);
  assert.throws(() => prepareS3Env({ ...goodEnv, S3_ENDPOINT: 'http://s3:8333' }, read, { accessKeyId: 's3_admin_access_key_id', secretAccessKey: 's3_admin_secret_access_key' }), /S3_ENDPOINT/);
  assert.throws(() => prepareS3Env({ ...goodEnv }, () => { throw new Error('nope'); }, { accessKeyId: 's3_admin_access_key_id', secretAccessKey: 's3_admin_secret_access_key' }), /s3_admin_access_key_id/);
});

// Bucket-level fake: HEAD answers come from a queue, PUT (CreateBucket) from `create`.
function fakeBucket({ heads, create = 200 }) {
  const calls = [];
  const signRequest = ({ config, method, key }) => ({ url: `${config.endpoint}/${config.bucket}/${key}`, headers: { authorization: 'AWS4-HMAC-SHA256 fake' }, method });
  const status = async (url, init = {}) => {
    calls.push({ method: init.method ?? 'GET', url, signed: Boolean(init.headers?.authorization) });
    if (init.method === 'HEAD') return heads.shift();
    if (init.method === 'PUT') return create;
    return 500;
  };
  return { calls, signRequest, status };
}

test('bucket bootstrap is idempotent: existing bucket untouched, missing bucket created once then confirmed', async () => {
  const env = prepareRuntimeEnv({ ...goodEnv }, secretsFor(goodSecrets));
  let store = fakeBucket({ heads: [200] });
  assert.equal(await ensureBucket({ env, ...store }), 'exists');
  assert.deepEqual(store.calls.map(c => [c.method, c.signed]), [['HEAD', true]]);
  store = fakeBucket({ heads: [404, 200] });
  assert.equal(await ensureBucket({ env, ...store }), 'created');
  assert.deepEqual(store.calls.map(c => c.method), ['HEAD', 'PUT', 'HEAD']);
  assert.ok(store.calls.every(c => c.signed && c.url === 'https://s3.example.test:8443/reviewdesk-captures/'), 'bucket URL only, always signed');
  // Concurrent creation: "already owned" is fine once the bucket answers.
  store = fakeBucket({ heads: [404, 200], create: 409 });
  assert.equal(await ensureBucket({ env, ...store }), 'exists');
});

test('bucket bootstrap fails closed on refused credentials, failed creation or a bucket that never appears', async () => {
  const env = prepareRuntimeEnv({ ...goodEnv }, secretsFor(goodSecrets));
  for (const [heads, create, pattern] of [[[403], 200, /Identifiants/], [[404], 403, /création|créer/i], [[404], 500, /inattendue/], [[404, 404], 200, /introuvable/], [[500], 200, /inattendue/]]) {
    const store = fakeBucket({ heads: [...heads], create });
    await assert.rejects(ensureBucket({ env, ...store }), error => {
      assert.match(error.message, pattern, JSON.stringify([heads, create]));
      for (const value of Object.values(goodSecrets)) assert.ok(!error.message.includes(value));
      return true;
    });
  }
});

const bundledSecrets = { ...goodSecrets, s3_admin_access_key_id: 'RDKADMINKEY0001', s3_admin_secret_access_key: 'AdminSecretValue0123456789abcdefABCDEF01', s3_tls_key: '-----BEGIN PRIVATE KEY-----\nTESTONLYKEYMATERIAL\n-----END PRIVATE KEY-----' };

async function fakeConfig(root, overrides = {}) {
  const env = { REVIEWDESK_CONFIGURED: '1', REVIEWDESK_HTTP_PORT: '48399', REVIEWDESK_S3: 'external', ...goodEnv, NODE_EXTRA_CA_CERTS: '', ...overrides };
  await writeFile(path.join(root, '.env'), Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
  await mkdir(path.join(root, 'secrets'), { recursive: true, mode: 0o700 });
  for (const [name, value] of Object.entries(goodSecrets)) await writeFile(path.join(root, 'secrets', name), value, { mode: 0o600 });
}

async function fakeBundledConfig(root) {
  await fakeConfig(root, { REVIEWDESK_S3: 'bundled', COMPOSE_PROFILES: 'bundled-s3', S3_ENDPOINT: 'https://s3:8443', S3_REGION: 'us-east-1', NODE_EXTRA_CA_CERTS: '/etc/reviewdesk/certs/ca.pem' });
  for (const [name, value] of Object.entries(bundledSecrets)) await writeFile(path.join(root, 'secrets', name), value, { mode: 0o600 });
}

const docker = await run('docker', ['compose', 'version']).then(() => true, () => false);

test('compose: pinned images, PostgreSQL unexposed on an internal network, app on loopback only, production env', { skip: !docker && 'docker compose unavailable' }, async t => {
  const root = await scratch(t, 'compose');
  await cp(template, root, { recursive: true });
  await fakeConfig(root);
  const { stdout } = await run('docker', ['compose', '-p', PROJECT, 'config', '--format', 'json'], { cwd: root });
  const config = JSON.parse(stdout);
  const { postgres, app } = config.services;
  assert.match(postgres.image, /^postgres:17\.11-alpine3\.24@sha256:[0-9a-f]{64}$/);
  assert.equal(postgres.ports, undefined);
  assert.deepEqual(Object.keys(postgres.networks), ['backend']);
  assert.equal(config.networks.backend.internal, true);
  assert.equal(postgres.environment.POSTGRES_PASSWORD, undefined);
  assert.equal(postgres.environment.POSTGRES_PASSWORD_FILE, '/run/secrets/postgres_password');
  assert.equal(app.ports.length, 1);
  assert.equal(app.ports[0].host_ip, '127.0.0.1');
  assert.equal(app.ports[0].published, '48399');
  assert.equal(app.ports[0].target, 4300);
  for (const [key, value] of Object.entries({ NODE_ENV: 'production', HOST: '0.0.0.0', SECURE_COOKIES: 'true', STORAGE_DRIVER: 's3', S3_ENDPOINT: goodEnv.S3_ENDPOINT })) assert.equal(app.environment[key], value, key);
  for (const key of ['ADMIN_PASSWORD', 'DATABASE_URL', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) assert.equal(app.environment[key], undefined, key);
  assert.ok(!stdout.includes(goodSecrets.admin_password) && !stdout.includes(goodSecrets.s3_secret_access_key));
  assert.equal(app.read_only, true);
  assert.deepEqual(app.cap_drop, ['ALL']);
  const dockerfile = await readFile(path.join(template, 'app/Dockerfile'), 'utf8');
  for (const line of dockerfile.split('\n').filter(line => /^FROM /.test(line))) assert.match(line, /^FROM node:22\.\d+\.\d+-bookworm-slim@sha256:[0-9a-f]{64}( AS \w+)?$/);
  assert.match(dockerfile, /npm ci --omit=dev/);
});

test('compose (default bundled S3): pinned SeaweedFS, internal-only, no S3 port, secrets as files, TLS verified, bucket bootstrap before the app', { skip: !docker && 'docker compose unavailable' }, async t => {
  const root = await scratch(t, 'compose bundled');
  await cp(template, root, { recursive: true });
  await fakeBundledConfig(root);
  const { stdout } = await run('docker', ['compose', '-p', PROJECT, 'config', '--format', 'json'], { cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  const config = JSON.parse(stdout);
  const { 's3-storage': s3, s3: gateway, 's3-init': init, app } = config.services;
  assert.ok(s3 && gateway && init, 'bundled services enabled by COMPOSE_PROFILES from .env');
  assert.equal(s3.image, SEAWEED);
  assert.equal(s3.ports, undefined);
  assert.equal(gateway.ports, undefined);
  // SeaweedFS has no network interface: its gRPC port (unauthenticated IAM RPCs
  // without a filer signing key) cannot be reached from any other container.
  assert.equal(s3.network_mode, 'none');
  assert.equal(s3.networks, undefined);
  assert.deepEqual(Object.keys(gateway.networks), ['backend']);
  assert.deepEqual(Object.keys(init.networks), ['backend']);
  assert.deepEqual(gateway.command, ['node', '/app/s3-gateway.mjs']);
  assert.deepEqual(gateway.secrets.map(x => x.source), ['s3_tls_key'], 'the gateway holds the TLS key, no S3 identity');
  assert.equal(gateway.depends_on['s3-storage'].condition, 'service_healthy');
  const socket = v => v.type === 'volume' && v.source === 's3socket' && v.target === '/run/reviewdesk-s3';
  assert.ok(s3.volumes.some(socket) && gateway.volumes.some(socket));
  assert.ok(!app.volumes?.some(v => v.source === 's3socket') && !init.volumes?.some(v => v.source === 's3socket'), 'socket shared by s3-storage and s3 only');
  assert.deepEqual(config.volumes.s3socket.driver_opts, { type: 'tmpfs', device: 'tmpfs', o: 'uid=1000,gid=1000,mode=0700' });
  assert.ok(s3.volumes.some(v => v.type === 'volume' && v.source === 's3data' && v.target === '/data'));
  assert.ok(config.volumes.s3data && config.volumes.pgdata);
  assert.deepEqual(s3.secrets.map(x => x.source).sort(), ['s3_access_key_id', 's3_admin_access_key_id', 's3_admin_secret_access_key', 's3_secret_access_key', 's3_tls_key']);
  assert.deepEqual(init.secrets.map(x => x.source).sort(), ['s3_admin_access_key_id', 's3_admin_secret_access_key']);
  assert.ok(!app.secrets.some(x => /admin_access|admin_secret|tls_key/.test(x.source)), 'app gets neither the init identity nor the TLS key');
  for (const service of [s3, gateway, init]) {
    assert.equal(service.read_only, true);
    assert.deepEqual(service.cap_drop, ['ALL']);
    assert.ok(service.security_opt.includes('no-new-privileges:true'));
    for (const key of Object.keys(service.environment ?? {})) assert.doesNotMatch(key, /ACCESS_KEY|SECRET|PASSWORD|TLS_KEY/, key);
  }
  const command = [...(s3.entrypoint ?? []), ...(s3.command ?? [])].join(' ');
  assert.match(command, /entrypoint\.sh/);
  assert.equal(init.depends_on.s3.condition, 'service_healthy');
  assert.equal(app.depends_on['s3-init'].condition, 'service_completed_successfully');
  assert.equal(app.environment.S3_ENDPOINT, 'https://s3:8443');
  assert.equal(app.environment.NODE_EXTRA_CA_CERTS, '/etc/reviewdesk/certs/ca.pem');
  // SeaweedFS health is checked on its loopback listener, with the name `s3` pinned to 127.0.0.1.
  assert.match(s3.healthcheck.test.join(' '), /--cacert \/etc\/reviewdesk\/certs\/ca\.pem --resolve s3:8444:127\.0\.0\.1 https:\/\/s3:8444\//);
  assert.match(gateway.healthcheck.test.join(' '), /s3-gateway\.mjs --check/);
  assert.doesNotMatch(stdout, /--insecure|\s-k\s|NODE_TLS_REJECT_UNAUTHORIZED|rejectUnauthorized|no-check-certificate/);
  for (const value of Object.values(bundledSecrets)) assert.ok(!stdout.includes(value), 'secret value in compose config');
  const entrypoint = await readFile(path.join(template, 's3/entrypoint.sh'), 'utf8');
  // HTTPS-only primary listener and gRPC (unauthenticated IAM RPCs) both on loopback.
  for (const flag of ['-ip.bind=127.0.0.1', '-s3.ip.bind=127.0.0.1', '-s3.port=8444', '-s3.port.https=0', '-s3.port.grpc=18444', '-s3.localSocket=/run/reviewdesk-s3/s3.sock', '-s3.autoCreateBucket=false', '-s3.iam=false', '-master.telemetry=false', '-s3.cert.file=', '-s3.key.file=']) assert.ok(entrypoint.includes(flag), flag);
  assert.doesNotMatch(entrypoint, /0\.0\.0\.0|-s3\.port\.https=[1-9]/);
  assert.match(entrypoint, /su-exec seaweed/);
});

test('compose (external S3): bundled services stay disabled', { skip: !docker && 'docker compose unavailable' }, async t => {
  const root = await scratch(t, 'compose external');
  await cp(template, root, { recursive: true });
  await fakeConfig(root);
  const { stdout } = await run('docker', ['compose', '-p', PROJECT, 'config', '--format', 'json'], { cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  assert.deepEqual(Object.keys(JSON.parse(stdout).services).sort(), ['app', 'postgres']);
});

test('compose (previous installer .env, no REVIEWDESK_S3 nor COMPOSE_PROFILES): external S3, bundled services disabled', { skip: !docker && 'docker compose unavailable' }, async t => {
  const root = await scratch(t, 'compose legacy');
  await cp(template, root, { recursive: true });
  await fakeConfig(root);
  await cp(path.join(repository, 'tests/packaging/fixtures/env-bfea010.env'), path.join(root, '.env'));
  const { stdout } = await run('docker', ['compose', '-p', PROJECT, 'config', '--format', 'json'], { cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  const config = JSON.parse(stdout);
  assert.deepEqual(Object.keys(config.services).sort(), ['app', 'postgres']);
  assert.equal(config.services.app.environment.S3_ENDPOINT, 'https://s3.example.test');
});

test('s3-gateway: terminates TLS for the name s3, forwards to the Unix socket, refuses plaintext, survives a missing socket', async t => {
  const { startGateway, checkGateway } = await import('../../scripts/packaging/docker/template/app/s3-gateway.mjs');
  const net = await import('node:net');
  const tls = await import('node:tls');
  const { once } = await import('node:events');
  const dir = await scratch(t, 'gateway');
  const ssl = (...args) => run('openssl', args, { cwd: dir });
  await ssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=test CA', '-keyout', 'ca.key', '-out', 'ca.pem', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign');
  await ssl('req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=s3', '-keyout', 's3.key', '-out', 's3.csr');
  await writeFile(path.join(dir, 's3.ext'), 'subjectAltName=DNS:s3\nextendedKeyUsage=serverAuth\n');
  await ssl('x509', '-req', '-in', 's3.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-days', '1', '-extfile', 's3.ext', '-out', 's3.pem');
  const [key, cert, ca] = await Promise.all(['s3.key', 's3.pem', 'ca.pem'].map(name => readFile(path.join(dir, name))));
  // Fake SeaweedFS: plain HTTP on a Unix socket, answers /healthz.
  const socketPath = path.join(dir, 's3.sock');
  const received = [];
  const upstream = net.createServer(socket => socket.once('data', chunk => {
    received.push(chunk.toString());
    socket.end(chunk.toString().startsWith('GET /healthz ') ? 'HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n' : 'HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n');
  }));
  upstream.listen(socketPath);
  await once(upstream, 'listening');
  t.after(() => upstream.close());
  const gateway = await startGateway({ host: '127.0.0.1', port: 0, key, cert, socketPath });
  t.after(() => gateway.close());
  const { port } = gateway.address();
  assert.equal(gateway.address().address, '127.0.0.1');
  assert.equal(await checkGateway({ port, ca }), true, 'TLS verified for s3, then /healthz through the socket');
  assert.match(received.at(-1), /^GET \/healthz HTTP\/1\.1\r\nHost: s3:8443\r\n/, 'decrypted bytes reach the socket unchanged (Host kept for SigV4)');
  // Wrong name: the certificate is only valid for `s3`.
  const wrongName = await new Promise(resolve => { const s = tls.connect({ host: '127.0.0.1', port, servername: 'other.test', ca }, () => resolve('ok')); s.on('error', e => resolve(e.code)); });
  assert.equal(wrongName, 'ERR_TLS_CERT_ALTNAME_INVALID');
  // Plaintext HTTP never reaches SeaweedFS.
  const before = received.length;
  const plain = net.connect(port, '127.0.0.1');
  plain.on('error', () => {});
  await once(plain, 'connect');
  plain.write('GET /healthz HTTP/1.1\r\nHost: s3\r\n\r\n');
  let answer = '';
  plain.on('data', chunk => { answer += chunk; });
  await once(plain, 'close');
  assert.doesNotMatch(answer, /HTTP\/1\.1 200/);
  assert.equal(received.length, before, 'plaintext request forwarded');
  // Socket gone (SeaweedFS restarting): the health check fails, the gateway keeps listening.
  upstream.close();
  await once(upstream, 'close');
  assert.equal(await checkGateway({ port, ca }), false);
  assert.equal(gateway.listening, true);
});

test('s3/entrypoint.sh is POSIX sh, never echoes secrets and keeps generated material in tmpfs', async () => {
  const script = path.join(template, 's3/entrypoint.sh');
  await run('sh', ['-n', script]);
  const text = await readFile(script, 'utf8');
  assert.match(text, /^#!\/bin\/sh\n/);
  assert.doesNotMatch(text, /\[\[|\bfunction\b|<<<|set -x/);
  assert.doesNotMatch(text, /(echo|printf)[^\n|]*\$(access|secret|admin)[^\n]*(>&2|$)/m, 'secret printed to a log');
  assert.match(text, /\/tmp\//);
});

test('compose config fails closed without .env or with an empty S3 endpoint', { skip: !docker && 'docker compose unavailable' }, async t => {
  const root = await scratch(t, 'compose closed');
  await cp(template, root, { recursive: true });
  await assert.rejects(run('docker', ['compose', '-p', PROJECT, 'config', '-q'], { cwd: root }), /install\.sh|required|REVIEWDESK|S3_/);
  await fakeConfig(root, { S3_ENDPOINT: '' });
  await assert.rejects(run('docker', ['compose', '-p', PROJECT, 'config', '-q'], { cwd: root }), /S3_ENDPOINT/);
});

test('ZIP contains only the self-host allowlist, no secrets, no sources, no PGlite, and is reproducible', { timeout: 120_000 }, async t => {
  const out = await scratch(t, 'zip');
  const first = await packageDocker(path.join(out, 'a'));
  const second = await packageDocker(path.join(out, 'b'));
  const zip = await readFile(first);
  assert.deepEqual(zip, await readFile(second));
  const checksum = (await readFile(`${first}.sha256`, 'utf8')).trim().split(/\s+/)[0];
  assert.equal(createHash('sha256').update(zip).digest('hex'), checksum);
  const entries = await readZip(zip);
  // The archive is named after the version being shipped, whatever it is.
  const { version } = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  const prefix = `reviewdesk-v${version}-docker/`;
  const members = [...entries.keys()].map(name => { assert.ok(name.startsWith(prefix), name); return name.slice(prefix.length); });
  for (const name of members) {
    assert.match(name, /^(compose\.yaml|install\.sh|GUIDE-DOCKER-FR\.md|NOTICE\.txt|certs\/LISEZMOI\.txt|s3\/entrypoint\.sh|app\/(Dockerfile|entrypoint\.mjs|s3-gateway\.mjs|runtime-config\.mjs|s3-bootstrap\.mjs|package\.json|package-lock\.json|dist\/(server|mcp|s3-signer)\.js|public\/.+))$/, name);
    assert.doesNotMatch(name, /(^|\/)(\.env|secrets?|src|node_modules)(\/|$)|\.(ts|map|pem|key)$/);
  }
  for (const required of ['compose.yaml', 'install.sh', 's3/entrypoint.sh', 'app/s3-bootstrap.mjs', 'app/s3-gateway.mjs', 'app/Dockerfile', 'app/dist/server.js', 'app/dist/s3-signer.js', 'app/public/widget.js', 'app/public/admin.js', 'app/package-lock.json']) assert.ok(members.includes(required), required);
  const lock = entries.get(`${prefix}app/package-lock.json`).toString('utf8');
  assert.doesNotMatch(lock, /pglite/i);
  assert.doesNotMatch(entries.get(`${prefix}app/package.json`).toString('utf8'), /pglite/i);
  assert.doesNotMatch(entries.get(`${prefix}app/dist/server.js`).toString('utf8'), /BEGIN (RSA |EC )?PRIVATE KEY/);
  const notice = entries.get(`${prefix}NOTICE.txt`).toString('utf8');
  assert.match(notice, /Tous droits réservés/);
  assert.doesNotMatch(notice, /\b(MIT|Apache|GPL|open source licen[cs]e granted)\b/i);
  assert.match(notice, /seaweedfs/i, 'third-party SeaweedFS image is named');
  const guide = entries.get(`${prefix}GUIDE-DOCKER-FR.md`).toString('utf8');
  assert.match(guide, /Tous droits réservés/);
  assert.match(guide, /frais d'hébergement|coûts d'hébergement/i, 'hosting costs are stated');
});

test('install.sh is POSIX sh: it parses under sh -n and uses no bashisms marker', async () => {
  const script = path.join(template, 'install.sh');
  await chmod(script, 0o644);
  await run('sh', ['-n', script]);
  const text = await readFile(script, 'utf8');
  assert.match(text, /^#!\/bin\/sh\n/);
  assert.doesNotMatch(text, /\[\[|\bfunction\b|\$\{[A-Za-z_]+\/\/|<<<|\bnode\b|\bnpm\b|\bpython/);
});
