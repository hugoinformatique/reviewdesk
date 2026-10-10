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
import { classifyAnonymousProbe, classifyAuthenticatedProbe, prepareRuntimeEnv, verifyObjectPrivacy } from '../../scripts/packaging/docker/template/app/runtime-config.mjs';
import { readZip } from './docker-zip.mjs';

const run = promisify(execFile);
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

async function fakeConfig(root, overrides = {}) {
  const env = { REVIEWDESK_CONFIGURED: '1', REVIEWDESK_HTTP_PORT: '48399', ...goodEnv, NODE_EXTRA_CA_CERTS: '', ...overrides };
  await writeFile(path.join(root, '.env'), Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
  await mkdir(path.join(root, 'secrets'), { recursive: true, mode: 0o700 });
  for (const [name, value] of Object.entries(goodSecrets)) await writeFile(path.join(root, 'secrets', name), value, { mode: 0o600 });
}

const docker = await run('docker', ['compose', 'version']).then(() => true, () => false);

test('compose: pinned images, PostgreSQL unexposed on an internal network, app on loopback only, production env', { skip: !docker && 'docker compose unavailable' }, async t => {
  const root = await scratch(t, 'compose');
  await cp(template, root, { recursive: true });
  await fakeConfig(root);
  const { stdout } = await run('docker', ['compose', '-p', 'reviewdesk-kit-docker-test', 'config', '--format', 'json'], { cwd: root });
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

test('compose config fails closed without .env or with an empty S3 endpoint', { skip: !docker && 'docker compose unavailable' }, async t => {
  const root = await scratch(t, 'compose closed');
  await cp(template, root, { recursive: true });
  await assert.rejects(run('docker', ['compose', '-p', 'reviewdesk-kit-docker-test', 'config', '-q'], { cwd: root }), /install\.sh|required|REVIEWDESK|S3_/);
  await fakeConfig(root, { S3_ENDPOINT: '' });
  await assert.rejects(run('docker', ['compose', '-p', 'reviewdesk-kit-docker-test', 'config', '-q'], { cwd: root }), /S3_ENDPOINT/);
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
  const prefix = 'reviewdesk-v8.0.0-docker/';
  const members = [...entries.keys()].map(name => { assert.ok(name.startsWith(prefix), name); return name.slice(prefix.length); });
  for (const name of members) {
    assert.match(name, /^(compose\.yaml|install\.sh|GUIDE-DOCKER-FR\.md|NOTICE\.txt|certs\/LISEZMOI\.txt|app\/(Dockerfile|entrypoint\.mjs|runtime-config\.mjs|package\.json|package-lock\.json|dist\/(server|mcp|s3-signer)\.js|public\/.+))$/, name);
    assert.doesNotMatch(name, /(^|\/)(\.env|secrets?|src|node_modules)(\/|$)|\.(ts|map|pem|key)$/);
  }
  for (const required of ['compose.yaml', 'install.sh', 'app/Dockerfile', 'app/dist/server.js', 'app/dist/s3-signer.js', 'app/public/widget.js', 'app/public/admin.js', 'app/package-lock.json']) assert.ok(members.includes(required), required);
  const lock = entries.get(`${prefix}app/package-lock.json`).toString('utf8');
  assert.doesNotMatch(lock, /pglite/i);
  assert.doesNotMatch(entries.get(`${prefix}app/package.json`).toString('utf8'), /pglite/i);
  assert.doesNotMatch(entries.get(`${prefix}app/dist/server.js`).toString('utf8'), /BEGIN (RSA |EC )?PRIVATE KEY/);
  const notice = entries.get(`${prefix}NOTICE.txt`).toString('utf8');
  assert.match(notice, /Tous droits réservés/);
  assert.doesNotMatch(notice, /\b(MIT|Apache|GPL|open source licen[cs]e granted)\b/i);
});

test('install.sh is POSIX sh: it parses under sh -n and uses no bashisms marker', async () => {
  const script = path.join(template, 'install.sh');
  await chmod(script, 0o644);
  await run('sh', ['-n', script]);
  const text = await readFile(script, 'utf8');
  assert.match(text, /^#!\/bin\/sh\n/);
  assert.doesNotMatch(text, /\[\[|\bfunction\b|\$\{[A-Za-z_]+\/\/|<<<|\bnode\b|\bnpm\b|\bpython/);
});
