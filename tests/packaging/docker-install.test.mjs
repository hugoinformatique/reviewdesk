import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, unlink, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const template = path.join(repository, 'scripts/packaging/docker/template');
const SECRETS = ['admin_password', 'postgres_password', 's3_access_key_id', 's3_secret_access_key'];
// Bundled S3 only: init identity (creates the bucket) and the S3 TLS private key.
const BUNDLED_SECRETS = ['s3_admin_access_key_id', 's3_admin_secret_access_key', 's3_tls_key'];
const CERTS = ['certs/ca.pem', 'certs/s3.pem'];
const s3Key = 'AKIATESTONLY0001';
const s3Secret = 'test-only/Secret+Value=9f8e7d6c5b4a';

async function kit(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'ReviewDesk install été '));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(template, root, { recursive: true });
  const credentials = path.join(root, '..', `${path.basename(root)}-s3.txt`);
  await writeFile(credentials, `# test only\nS3_ACCESS_KEY_ID=${s3Key}\nS3_SECRET_ACCESS_KEY=${s3Secret}\n`, { mode: 0o600 });
  t.after(() => rm(credentials, { force: true }));
  return { root, credentials };
}

// Fake `docker` first in PATH: the tests never query the host's real Docker.
// FAKE_DOCKER=absent (default) lists unrelated volumes, `present` also lists
// <project>_pgdata, `down` fails like an unreachable daemon.
const fakeDocker = `#!/bin/sh
[ "$*" = "volume ls -q" ] || { echo "unexpected docker call: $*" >&2; exit 99; }
case "\${FAKE_DOCKER:-absent}" in
  down) echo "Cannot connect to the Docker daemon" >&2; exit 1 ;;
  present) echo other_pgdata; echo "\${FAKE_VOLUME:-reviewdesk_pgdata}" ;;
  *) echo reviewdesk_pgdata_old; echo reviewdesk_s3data_old; echo other_pgdata ;;
esac
`;
let binDir;
async function bin() {
  if (binDir) return binDir;
  binDir = await mkdtemp(path.join(tmpdir(), 'reviewdesk-fake-docker-'));
  process.on('exit', () => { rmSync(binDir, { recursive: true, force: true }); });
  await writeFile(path.join(binDir, 'docker'), fakeDocker, { mode: 0o755 });
  return binDir;
}
// PATH with the system tools but no docker at all.
async function noDockerPath(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'reviewdesk-no-docker-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const system of ['/usr/bin', '/bin']) {
    for (const name of await readdir(system).catch(() => [])) {
      if (name === 'docker') continue;
      await symlink(path.join(system, name), path.join(dir, name)).catch(() => {});
    }
  }
  return dir;
}

async function install(root, args, input = '', env = {}) {
  // Restricted PATH: the installer must work with a shell, openssl, coreutils and Docker only.
  const PATH = env.PATH ?? `${await bin()}:/usr/bin:/bin`;
  const child = spawn('sh', ['install.sh', ...args], { cwd: root, env: { LANG: 'C.UTF-8', ...env, PATH }, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  child.stdin.end(input);
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => resolve({ code, output }));
  });
}

// External S3 (optional mode): explicit endpoint, bucket and credentials.
const base = credentials => ['--non-interactive', '--port', '48311', '--s3-endpoint', 'https://s3.example.test', '--s3-bucket', 'reviewdesk-captures', '--s3-credentials-file', credentials];
// Default mode: bundled S3, nothing about S3 is asked.
const bundled = ['--non-interactive', '--port', '48311'];
const mode = async file => (await stat(file)).mode & 0o777;
async function snapshot(root) {
  const files = {};
  for (const name of ['.env', ...[...SECRETS, ...BUNDLED_SECRETS].map(s => `secrets/${s}`), ...CERTS]) files[name] = await readFile(path.join(root, name), 'utf8').catch(() => null);
  return files;
}

test('external S3: first run writes private config with strong distinct generated passwords and never prints secrets', async t => {
  const { root, credentials } = await kit(t);
  const result = await install(root, base(credentials));
  assert.equal(result.code, 0, result.output);
  assert.equal(await mode(path.join(root, '.env')), 0o600);
  assert.equal(await mode(path.join(root, 'secrets')), 0o700);
  for (const name of SECRETS) assert.equal(await mode(path.join(root, 'secrets', name)), 0o600, name);
  const files = await snapshot(root);
  const admin = files['secrets/admin_password'];
  const postgres = files['secrets/postgres_password'];
  assert.ok(admin.length >= 24 && postgres.length >= 24);
  assert.notEqual(admin, postgres);
  assert.ok(new Set(admin).size >= 8);
  assert.doesNotMatch(admin, /password|admin|reviewdesk|changeme|letmein|secret|12345678|qwerty/i);
  assert.equal(files['secrets/s3_access_key_id'], s3Key);
  assert.equal(files['secrets/s3_secret_access_key'], s3Secret);
  assert.match(files['.env'], /^S3_ENDPOINT=https:\/\/s3\.example\.test$/m);
  assert.match(files['.env'], /^REVIEWDESK_HTTP_PORT=48311$/m);
  assert.match(files['.env'], /^REVIEWDESK_CONFIGURED=1$/m);
  assert.match(files['.env'], /^REVIEWDESK_S3=external$/m);
  assert.doesNotMatch(files['.env'], /^COMPOSE_PROFILES=./m, 'external S3: bundled services stay disabled');
  for (const name of [...BUNDLED_SECRETS.map(s => `secrets/${s}`), ...CERTS]) assert.equal(files[name], null, `${name} is bundled-only`);
  for (const value of [admin, postgres, s3Secret, s3Key]) {
    assert.ok(!result.output.includes(value), 'secret leaked to output');
    assert.ok(!files['.env'].includes(value), 'secret leaked to .env');
  }
  assert.match(result.output, /secrets\/admin_password/);
  assert.deepEqual((await readdir(root)).filter(name => name.startsWith('.reviewdesk-init')), []);
});

test('existing complete config is preserved byte for byte; new options are refused instead of overwriting', async t => {
  const { root, credentials } = await kit(t);
  assert.equal((await install(root, base(credentials))).code, 0);
  const before = await snapshot(root);
  const again = await install(root, ['--non-interactive']);
  assert.equal(again.code, 0, again.output);
  assert.match(again.output, /conserv/i);
  assert.deepEqual(await snapshot(root), before);
  const overwrite = await install(root, base(credentials));
  assert.notEqual(overwrite.code, 0);
  assert.match(overwrite.output, /existe|exist/i);
  assert.deepEqual(await snapshot(root), before);
});

test('partial or broken config is rejected and left untouched', async t => {
  const { root, credentials } = await kit(t);
  assert.equal((await install(root, base(credentials))).code, 0);
  await unlink(path.join(root, 'secrets/s3_secret_access_key'));
  let before = await snapshot(root);
  let result = await install(root, base(credentials));
  assert.notEqual(result.code, 0);
  assert.match(result.output, /s3_secret_access_key/);
  assert.match(result.output, /incompl|partiel/i);
  assert.deepEqual(await snapshot(root), before);

  await writeFile(path.join(root, 'secrets/s3_secret_access_key'), '', { mode: 0o600 });
  result = await install(root, ['--non-interactive']);
  assert.notEqual(result.code, 0);
  assert.match(result.output, /s3_secret_access_key/);

  await writeFile(path.join(root, 'secrets/s3_secret_access_key'), s3Secret, { mode: 0o600 });
  await chmod(path.join(root, 'secrets/admin_password'), 0o644);
  result = await install(root, ['--non-interactive']);
  assert.notEqual(result.code, 0);
  assert.match(result.output, /600/);
  await chmod(path.join(root, 'secrets/admin_password'), 0o600);

  const env = path.join(root, '.env');
  await writeFile(env, (await readFile(env, 'utf8')).replace('https://s3.example.test', 'http://s3.example.test'), { mode: 0o600 });
  before = await snapshot(root);
  result = await install(root, ['--non-interactive']);
  assert.notEqual(result.code, 0);
  assert.match(result.output, /https/i);
  assert.deepEqual(await snapshot(root), before);
});

test('invalid inputs are refused before anything is written', async t => {
  const { root, credentials } = await kit(t);
  const cases = [
    ['--s3-endpoint', 'http://s3.example.test'],
    ['--s3-endpoint', 'https://s3.example.test/path'],
    ['--s3-endpoint', 'https://user@s3.example.test'],
    // Rewritten by the runtime URL parser, hence refused at start-up: refuse here too.
    ['--s3-endpoint', 'https://S3.Example.test'],
    ['--s3-endpoint', 'https://s3.example.test:443'],
    ['--s3-endpoint', 'https://s3.example.test:08443'],
    ['--s3-endpoint', 'https://s3.example.test:0'],
    ['--s3-endpoint', 'https://s3.example.test:70000'],
    ['--s3-endpoint', 'https://1.2.3'],
    ['--s3-endpoint', 'https://0x7f.1'],
    ['--s3-endpoint', 'https://256.1.1.1'],
    ['--s3-endpoint', 'https://01.2.3.4'],
    ['--s3-bucket', 'Bad_Bucket'],
    ['--port', '80'],
    ['--port', '70000'],
    ['--port', '4300x'],
    ['--s3-path-style', 'maybe'],
    ['--ca-file', '../etc/passwd'],
    ['--ca-file', 'absent.pem'],
  ];
  for (const [flag, value] of cases) {
    const args = base(credentials);
    const index = args.indexOf(flag);
    if (index >= 0) args[index + 1] = value; else args.push(flag, value);
    const result = await install(root, args);
    assert.notEqual(result.code, 0, `${flag} ${value}`);
    assert.deepEqual(Object.values(await snapshot(root)).filter(Boolean), [], `${flag} ${value} wrote files`);
  }
  // Missing values in non-interactive mode, malformed credentials file.
  assert.notEqual((await install(root, ['--non-interactive', '--s3-endpoint', 'https://s3.example.test'])).code, 0);
  await writeFile(credentials, `S3_ACCESS_KEY_ID=${s3Key}\n`, { mode: 0o600 });
  const partial = await install(root, base(credentials));
  assert.notEqual(partial.code, 0);
  assert.match(partial.output, /S3_SECRET_ACCESS_KEY/);
  await writeFile(credentials, `S3_ACCESS_KEY_ID=${s3Key}\nS3_SECRET_ACCESS_KEY=has space\n`, { mode: 0o600 });
  assert.notEqual((await install(root, base(credentials))).code, 0);
  assert.deepEqual(Object.values(await snapshot(root)).filter(Boolean), []);
});

test('credentials may come from stdin without a terminal; CA file is wired into the container path', async t => {
  const { root } = await kit(t);
  await writeFile(path.join(root, 'certs/ca.pem'), '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n');
  const result = await install(root, ['--non-interactive', '--port', '48312', '--s3-endpoint', 'https://s3.example.test:9443', '--s3-bucket', 'reviewdesk-captures', '--s3-credentials-stdin', '--ca-file', 'ca.pem'], `S3_ACCESS_KEY_ID=${s3Key}\nS3_SECRET_ACCESS_KEY=${s3Secret}\n`);
  assert.equal(result.code, 0, result.output);
  const env = await readFile(path.join(root, '.env'), 'utf8');
  assert.match(env, /^NODE_EXTRA_CA_CERTS=\/etc\/reviewdesk\/certs\/ca\.pem$/m);
  assert.match(env, /^S3_ENDPOINT=https:\/\/s3\.example\.test:9443$/m);
  assert.equal(await readFile(path.join(root, 'secrets/s3_secret_access_key'), 'utf8'), s3Secret);
  assert.ok(!result.output.includes(s3Secret));
});

test('installer and runtime agree on every endpoint form', async t => {
  const { assertHttpsEndpoint } = await import('../../scripts/packaging/docker/template/app/runtime-config.mjs');
  const endpoints = ['https://s3.example.test', 'https://s3.example.test:9443', 'https://10.0.0.5', 'https://10.0.0.5:8443', 'https://a-b.c-d.test:65535',
    'https://S3.example.test', 'https://s3.example.test:443', 'https://s3.example.test:0443', 'https://1.2.3', 'https://0x7f.1', 'https://1.2.3.4.5', 'https://300.1.1.1', 'https://s3.example.test:65536'];
  for (const endpoint of endpoints) {
    const { root, credentials } = await kit(t);
    const args = base(credentials);
    args[args.indexOf('--s3-endpoint') + 1] = endpoint;
    const installer = (await install(root, args)).code === 0;
    let runtime = true;
    try { assertHttpsEndpoint(endpoint); } catch { runtime = false; }
    assert.equal(installer, runtime, `${endpoint}: installer ${installer}, runtime ${runtime}`);
    if (installer) assert.match(await readFile(path.join(root, '.env'), 'utf8'), new RegExp(`^S3_ENDPOINT=${endpoint.replace(/[.]/g, '\\.')}$`, 'm'), 'endpoint bytes unchanged');
  }
});

test('a new configuration is refused unless Docker positively confirms the PostgreSQL and S3 volumes are absent', async t => {
  for (const [label, env, pattern] of [
    ['docker missing', async () => ({ PATH: await noDockerPath(t) }), /Docker/],
    ['daemon unreachable', async () => ({ FAKE_DOCKER: 'down' }), /Docker/],
    ['volume present', async () => ({ FAKE_DOCKER: 'present' }), /reviewdesk_pgdata existe/],
    ['S3 volume present', async () => ({ FAKE_DOCKER: 'present', FAKE_VOLUME: 'reviewdesk_s3data' }), /reviewdesk_s3data existe/],
    ['custom project volume present', async () => ({ FAKE_DOCKER: 'present', COMPOSE_PROJECT_NAME: 'acme', FAKE_VOLUME: 'acme_pgdata' }), /acme_pgdata existe/],
    ['custom project S3 volume present', async () => ({ FAKE_DOCKER: 'present', COMPOSE_PROJECT_NAME: 'acme', FAKE_VOLUME: 'acme_s3data' }), /acme_s3data existe/],
  ]) {
    for (const mode of ['bundled', 'external']) {
      const { root, credentials } = await kit(t);
      const result = await install(root, mode === 'bundled' ? bundled : base(credentials), '', await env());
      assert.notEqual(result.code, 0, `${label} (${mode})`);
      assert.match(result.output, pattern, `${label} (${mode})`);
      assert.deepEqual(Object.values(await snapshot(root)).filter(Boolean), [], `${label} (${mode}) wrote files`);
      assert.deepEqual((await readdir(root)).filter(name => name.startsWith('.reviewdesk')), [], `${label} (${mode}) left a lock or staging dir`);
    }
  }
  // Another project's volume, or a similarly named one, does not block.
  const { root, credentials } = await kit(t);
  const ok = await install(root, base(credentials), '', { FAKE_DOCKER: 'present', COMPOSE_PROJECT_NAME: 'acme', FAKE_VOLUME: 'reviewdesk_pgdata' });
  assert.equal(ok.code, 0, ok.output);
});

test('an existing configuration is checked without Docker', async t => {
  const { root, credentials } = await kit(t);
  assert.equal((await install(root, base(credentials))).code, 0);
  const before = await snapshot(root);
  const again = await install(root, ['--non-interactive'], '', { PATH: await noDockerPath(t) });
  assert.equal(again.code, 0, again.output);
  assert.deepEqual(await snapshot(root), before);
});

test('an installation lock is taken before any check; a held lock refuses and is left in place', async t => {
  const { root, credentials } = await kit(t);
  await mkdir(path.join(root, '.reviewdesk-install.lock'));
  let result = await install(root, base(credentials));
  assert.notEqual(result.code, 0);
  assert.match(result.output, /verrou|en cours/i);
  assert.deepEqual(Object.values(await snapshot(root)).filter(Boolean), []);
  assert.ok((await stat(path.join(root, '.reviewdesk-install.lock'))).isDirectory(), 'foreign lock must not be removed');
  await rm(path.join(root, '.reviewdesk-install.lock'), { recursive: true });
  assert.equal((await install(root, base(credentials))).code, 0);
  assert.deepEqual((await readdir(root)).filter(name => name.startsWith('.reviewdesk')), [], 'own lock released');
  await mkdir(path.join(root, '.reviewdesk-install.lock'));
  result = await install(root, ['--non-interactive']);
  assert.notEqual(result.code, 0, 'verification of an existing config also waits for the lock');
  assert.match(result.output, /verrou|en cours/i);
});

test('concurrent installers: exactly one writes, the configuration stays whole and consistent', async t => {
  const { root, credentials } = await kit(t);
  const results = await Promise.all(Array.from({ length: 6 }, () => install(root, base(credentials))));
  assert.equal(results.filter(r => r.code === 0).length, 1, results.map(r => r.output).join('\n---\n'));
  for (const r of results.filter(r => r.code !== 0)) assert.match(r.output, /verrou|en cours|existe/i);
  const check = await install(root, ['--non-interactive']);
  assert.equal(check.code, 0, check.output);
  assert.deepEqual((await readdir(root)).filter(name => name.startsWith('.reviewdesk')), []);
});

// ------------------------------------------------------------- bundled S3

const exec = (command, args, options = {}) => new Promise(resolve => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  child.once('exit', code => resolve({ code, output }));
});
const openssl = (...args) => exec('openssl', args);

test('bundled S3 is the default: no S3 question, unique generated keys, private TLS material, nothing printed', async t => {
  const { root } = await kit(t);
  const result = await install(root, bundled);
  assert.equal(result.code, 0, result.output);
  const files = await snapshot(root);
  const env = files['.env'];
  for (const line of ['REVIEWDESK_S3=bundled', 'COMPOSE_PROFILES=bundled-s3', 'S3_ENDPOINT=https://s3:8443', 'S3_BUCKET=reviewdesk-captures', 'S3_FORCE_PATH_STYLE=true', 'S3_KEY_PREFIX=uploads', 'NODE_EXTRA_CA_CERTS=/etc/reviewdesk/certs/ca.pem', 'REVIEWDESK_HTTP_PORT=48311']) {
    assert.match(env, new RegExp(`^${line.replace(/[.]/g, '\\.')}$`, 'm'), line);
  }
  assert.equal(await mode(path.join(root, 'secrets')), 0o700);
  for (const name of [...SECRETS, ...BUNDLED_SECRETS]) assert.equal(await mode(path.join(root, 'secrets', name)), 0o600, name);
  for (const name of CERTS) assert.equal(await mode(path.join(root, name)), 0o644, name);
  const keys = ['s3_access_key_id', 's3_secret_access_key', 's3_admin_access_key_id', 's3_admin_secret_access_key'].map(name => files[`secrets/${name}`]);
  assert.equal(new Set(keys).size, 4, 'app and init identities use distinct keys');
  for (const key of keys) assert.match(key, /^[A-Za-z0-9]{20,64}$/);
  for (const secret of [keys[1], keys[3]]) assert.ok(secret.length >= 40);
  // A second, independent install never reuses the keys.
  const other = await kit(t);
  assert.equal((await install(other.root, bundled)).code, 0);
  const otherFiles = await snapshot(other.root);
  for (const name of ['s3_access_key_id', 's3_secret_access_key', 's3_admin_secret_access_key', 's3_tls_key']) assert.notEqual(otherFiles[`secrets/${name}`], files[`secrets/${name}`], name);
  assert.notEqual(otherFiles['certs/ca.pem'], files['certs/ca.pem']);

  assert.match(files['secrets/s3_tls_key'], /-----BEGIN PRIVATE KEY-----/);
  for (const name of CERTS) {
    assert.match(files[name], /^-----BEGIN CERTIFICATE-----/);
    assert.doesNotMatch(files[name], /PRIVATE KEY/);
  }
  // The CA private key is discarded: the TLS key is the only private key in the kit.
  const privateKeys = [];
  const walk = async dir => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (/-----BEGIN [A-Z ]*PRIVATE KEY-----\r?\n[A-Za-z0-9+/=]{20}/.test(await readFile(file, 'utf8'))) privateKeys.push(path.relative(root, file));
    }
  };
  await walk(root);
  assert.deepEqual(privateKeys, ['secrets/s3_tls_key']);

  // TLS: the service certificate chains to the generated CA for the `s3` service name only.
  const ca = path.join(root, 'certs/ca.pem');
  const leaf = path.join(root, 'certs/s3.pem');
  const ok = await openssl('verify', '-CAfile', ca, '-verify_hostname', 's3', '-purpose', 'sslserver', leaf);
  assert.equal(ok.code, 0, ok.output);
  assert.notEqual((await openssl('verify', '-CAfile', ca, '-verify_hostname', 'wrong.example', leaf)).code, 0);
  assert.notEqual((await openssl('verify', '-CAfile', path.join(other.root, 'certs/ca.pem'), leaf)).code, 0, 'another install CA must not validate this certificate');
  const text = (await openssl('x509', '-in', leaf, '-noout', '-text')).output;
  assert.match(text, /DNS:s3\b/);
  assert.match(text, /CA:FALSE/);
  assert.match((await openssl('x509', '-in', ca, '-noout', '-text')).output, /CA:TRUE/);
  const pub = async args => (await openssl(...args)).output;
  assert.equal(await pub(['pkey', '-in', path.join(root, 'secrets/s3_tls_key'), '-pubout']), await pub(['x509', '-in', leaf, '-noout', '-pubkey']), 'TLS key matches the certificate');

  for (const value of [...keys, files['secrets/postgres_password'], files['secrets/admin_password']]) {
    assert.ok(!result.output.includes(value), 'secret leaked to output');
    assert.ok(!env.includes(value), 'secret leaked to .env');
  }
  assert.doesNotMatch(result.output, /PRIVATE KEY|BEGIN CERTIFICATE/);
  assert.deepEqual((await readdir(root)).filter(name => name.startsWith('.reviewdesk')), []);
});

test('bundled S3: rerun keeps everything byte for byte; options, missing pieces and tampering are refused', async t => {
  const { root, credentials } = await kit(t);
  assert.equal((await install(root, bundled)).code, 0);
  const before = await snapshot(root);
  const again = await install(root, ['--non-interactive'], '', { PATH: await noDockerPath(t) });
  assert.equal(again.code, 0, again.output);
  assert.match(again.output, /conserv/i);
  assert.deepEqual(await snapshot(root), before);
  for (const args of [bundled, base(credentials)]) {
    const refused = await install(root, args);
    assert.notEqual(refused.code, 0);
    assert.deepEqual(await snapshot(root), before);
  }
  for (const name of ['secrets/s3_tls_key', 'secrets/s3_admin_secret_access_key', 'certs/s3.pem', 'certs/ca.pem']) {
    const file = path.join(root, name);
    const saved = await readFile(file);
    await unlink(file);
    const partial = await install(root, ['--non-interactive']);
    assert.notEqual(partial.code, 0, name);
    assert.match(partial.output, new RegExp(path.basename(name).replace('.', '\\.')), name);
    const created = await install(root, bundled);
    assert.notEqual(created.code, 0, `${name}: never regenerated`);
    await stat(file).then(() => assert.fail(`${name} regenerated`), () => {});
    await writeFile(file, saved, { mode: name.startsWith('secrets/') ? 0o600 : 0o644 });
    await chmod(file, name.startsWith('secrets/') ? 0o600 : 0o644);
  }
  assert.deepEqual(await snapshot(root), before);
  await chmod(path.join(root, 'secrets/s3_tls_key'), 0o644);
  let result = await install(root, ['--non-interactive']);
  assert.notEqual(result.code, 0);
  assert.match(result.output, /s3_tls_key[\s\S]*600/);
  await chmod(path.join(root, 'secrets/s3_tls_key'), 0o600);
  const envFile = path.join(root, '.env');
  for (const [from, to] of [['S3_ENDPOINT=https://s3:8443', 'S3_ENDPOINT=https://s3.example.test'], ['COMPOSE_PROFILES=bundled-s3\n', ''], ['NODE_EXTRA_CA_CERTS=/etc/reviewdesk/certs/ca.pem', 'NODE_EXTRA_CA_CERTS='], ['REVIEWDESK_S3=bundled', 'REVIEWDESK_S3=maybe']]) {
    await writeFile(envFile, before['.env'].replace(from, to), { mode: 0o600 });
    result = await install(root, ['--non-interactive']);
    assert.notEqual(result.code, 0, `${from} → ${to}`);
  }
  await writeFile(envFile, before['.env'], { mode: 0o600 });
  assert.deepEqual(await snapshot(root), before);
});

test('bundled S3 refuses external-only options and never overwrites existing certificates', async t => {
  const { root, credentials } = await kit(t);
  for (const extra of [['--s3-credentials-file', credentials], ['--s3-credentials-stdin'], ['--ca-file', 'LISEZMOI.txt'], ['--s3-region', 'eu-west-3'], ['--s3-path-style', 'false']]) {
    const result = await install(root, [...bundled, ...extra]);
    assert.notEqual(result.code, 0, extra.join(' '));
    assert.match(result.output, /externe|--s3-endpoint/, extra.join(' '));
    assert.deepEqual(Object.values(await snapshot(root)).filter(Boolean), [], `${extra.join(' ')} wrote files`);
  }
  // A CA the operator placed in certs/ (e.g. for an external S3) is never replaced.
  const foreign = '-----BEGIN CERTIFICATE-----\nMIIBforeign\n-----END CERTIFICATE-----\n';
  await writeFile(path.join(root, 'certs/ca.pem'), foreign);
  const result = await install(root, bundled);
  assert.notEqual(result.code, 0);
  assert.match(result.output, /certs\/ca\.pem/);
  assert.equal(await readFile(path.join(root, 'certs/ca.pem'), 'utf8'), foreign);
  for (const name of ['.env', ...SECRETS.map(s => `secrets/${s}`), 'certs/s3.pem']) await stat(path.join(root, name)).then(() => assert.fail(`${name} written`), () => {});
  // Custom bucket and prefix are accepted in bundled mode.
  await unlink(path.join(root, 'certs/ca.pem'));
  const custom = await install(root, [...bundled, '--s3-bucket', 'acme-reviews', '--s3-key-prefix', 'captures']);
  assert.equal(custom.code, 0, custom.output);
  const env = await readFile(path.join(root, '.env'), 'utf8');
  assert.match(env, /^S3_BUCKET=acme-reviews$/m);
  assert.match(env, /^S3_KEY_PREFIX=captures$/m);
});

test('bundled S3 interactive default: an empty external endpoint answer selects the bundled store', async t => {
  // No terminal: interactive mode falls back to defaults, and the default is bundled.
  const { root } = await kit(t);
  const result = await install(root, ['--port', '48313']);
  assert.equal(result.code, 0, result.output);
  assert.match(await readFile(path.join(root, '.env'), 'utf8'), /^REVIEWDESK_S3=bundled$/m);
});

// .env exactly as written by the previous installer (commit bfea010): no
// REVIEWDESK_S3, no COMPOSE_PROFILES. It can only describe an external S3.
const legacyEnv = path.join(repository, 'tests/packaging/fixtures/env-bfea010.env');
async function legacyKit(t, transform = text => text) {
  const { root } = await kit(t);
  await writeFile(path.join(root, '.env'), transform(await readFile(legacyEnv, 'utf8')), { mode: 0o600 });
  await mkdir(path.join(root, 'secrets'), { mode: 0o700 });
  const values = { admin_password: 'AdminTestOnly0123456789abcdefABCD', postgres_password: 'PgTestOnly0123456789abcdefABCDEF', s3_access_key_id: s3Key, s3_secret_access_key: s3Secret };
  for (const [name, value] of Object.entries(values)) await writeFile(path.join(root, 'secrets', name), value, { mode: 0o600 });
  return root;
}

test('upgrade: a configuration from the previous installer is accepted as external S3 and never rewritten', async t => {
  const root = await legacyKit(t);
  assert.doesNotMatch(await readFile(path.join(root, '.env'), 'utf8'), /REVIEWDESK_S3|COMPOSE_PROFILES/);
  const before = await snapshot(root);
  const result = await install(root, ['--non-interactive'], '', { PATH: await noDockerPath(t) });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /conserv/i);
  assert.match(result.output, /antérieur.*S3 externe/);
  assert.deepEqual(await snapshot(root), before);
  for (const name of [...BUNDLED_SECRETS.map(s => `secrets/${s}`), ...CERTS]) assert.equal(before[name], null, name);
});

test('upgrade: a previous-format configuration that is not purely external is refused untouched', async t => {
  for (const [transform, message] of [
    [text => `${text}COMPOSE_PROFILES=bundled-s3\n`, /REVIEWDESK_S3 manquant/],
    [text => `${text}COMPOSE_PROFILES=\n`, /REVIEWDESK_S3 manquant/],
    [text => text.replace(/^S3_ENDPOINT=.*$/m, 'S3_ENDPOINT=http://s3.example.test'), /HTTP refusé/],
  ]) {
    const root = await legacyKit(t, transform);
    const before = await snapshot(root);
    const result = await install(root, ['--non-interactive'], '', { PATH: await noDockerPath(t) });
    assert.notEqual(result.code, 0, result.output);
    assert.match(result.output, message);
    assert.deepEqual(await snapshot(root), before);
  }
});
