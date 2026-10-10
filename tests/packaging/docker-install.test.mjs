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
  *) echo reviewdesk_pgdata_old; echo other_pgdata ;;
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

const base = credentials => ['--non-interactive', '--port', '48311', '--s3-endpoint', 'https://s3.example.test', '--s3-bucket', 'reviewdesk-captures', '--s3-credentials-file', credentials];
const mode = async file => (await stat(file)).mode & 0o777;
async function snapshot(root) {
  const files = {};
  for (const name of ['.env', ...SECRETS.map(s => `secrets/${s}`)]) files[name] = await readFile(path.join(root, name), 'utf8').catch(() => null);
  return files;
}

test('first run writes private config with strong distinct generated passwords and never prints secrets', async t => {
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

test('a new configuration is refused unless Docker positively confirms the PostgreSQL volume is absent', async t => {
  for (const [label, env, pattern] of [
    ['docker missing', async () => ({ PATH: await noDockerPath(t) }), /Docker/],
    ['daemon unreachable', async () => ({ FAKE_DOCKER: 'down' }), /Docker/],
    ['volume present', async () => ({ FAKE_DOCKER: 'present' }), /reviewdesk_pgdata existe/],
    ['custom project volume present', async () => ({ FAKE_DOCKER: 'present', COMPOSE_PROJECT_NAME: 'acme', FAKE_VOLUME: 'acme_pgdata' }), /acme_pgdata existe/],
  ]) {
    const { root, credentials } = await kit(t);
    const result = await install(root, base(credentials), '', await env());
    assert.notEqual(result.code, 0, label);
    assert.match(result.output, pattern, label);
    assert.deepEqual(Object.values(await snapshot(root)).filter(Boolean), [], `${label} wrote files`);
    assert.deepEqual((await readdir(root)).filter(name => name.startsWith('.reviewdesk')), [], `${label} left a lock or staging dir`);
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
