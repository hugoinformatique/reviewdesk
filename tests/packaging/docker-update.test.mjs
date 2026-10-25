import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip } from '../../scripts/packaging/package-kit.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const template = path.join(repository, 'scripts/packaging/docker/template');
const updateScript = path.join(template, 'update.sh');
const installScript = path.join(template, 'install.sh');
const REPO = 'hugoinformatique/reviewdesk';

// Fake docker / curl: they only log their calls (FAKE_LOG) and answer from the
// environment. No real Docker, no network.
const fakeDocker = `#!/bin/sh
echo "$PWD|$*" >> "$FAKE_LOG"
case "$*" in
  "volume ls -q") echo other_pgdata ;;
  "compose exec -T postgres pg_dump -U reviewdesk reviewdesk")
    [ "\${FAKE_DUMP:-ok}" = ok ] || { echo "pg_dump: connection refused" >&2; exit 1; }
    echo "-- fake dump" ;;
  "compose up -d --build --force-recreate") [ "\${FAKE_UP:-ok}" = ok ] || exit 1 ;;
  "compose ps -q app") echo fakecid ;;
  inspect*) echo "\${FAKE_HEALTH:-healthy}" ;;
  *) echo "unexpected docker call: $*" >&2; exit 99 ;;
esac
`;
const fakeCurl = `#!/bin/sh
echo "$*" >> "$FAKE_LOG"
out='' url=''
while [ $# -gt 0 ]; do
  case "$1" in -o) out=$2; shift ;; -*) ;; *) url=$1 ;; esac
  shift
done
case "$url" in
  https://api.github.com/repos/*/releases/latest) printf '{\\n  "tag_name": "%s",\\n  "name": "x"\\n}\\n' "$FAKE_TAG" > "$out" ;;
  *.zip.sha256) cp "$FAKE_SHA" "$out" ;;
  *.zip) cp "$FAKE_ZIP" "$out" ;;
  *) echo "unexpected url: $url" >&2; exit 22 ;;
esac
`;
let binDir;
async function bin() {
  if (binDir) return binDir;
  binDir = await mkdtemp(path.join(tmpdir(), 'reviewdesk-fake-update-'));
  process.on('exit', () => { rmSync(binDir, { recursive: true, force: true }); });
  await writeFile(path.join(binDir, 'docker'), fakeDocker, { mode: 0o755 });
  await writeFile(path.join(binDir, 'curl'), fakeCurl, { mode: 0o755 });
  return binDir;
}

function packageJson(version) { return `${JSON.stringify({ name: 'reviewdesk-docker', version }, null, 2)}\n`; }

// A target release archive: the real install.sh and update.sh, a stub app.
function release(version, { tamper = false } = {}) {
  const root = `reviewdesk-v${version}-docker`;
  const entries = [
    ['compose.yaml', 'name: reviewdesk\nservices: {}\n'],
    ['install.sh', require_('install')],
    ['update.sh', require_('update')],
    ['certs/LISEZMOI.txt', 'nouveau LISEZMOI\n'],
    ['app/package.json', packageJson(version)],
  ].map(([name, data]) => ({ name: `${root}/${name}`, data: Buffer.from(data) }));
  const zip = createZip(entries);
  const sha = createHash('sha256').update(tamper ? Buffer.concat([zip, Buffer.from('x')]) : zip).digest('hex');
  return { root, zip, sha: `${sha}  ${root}.zip\n` };
}
const sources = {};
function require_(name) { return sources[name]; }
sources.install = await readFile(installScript, 'utf8');
sources.update = await readFile(updateScript, 'utf8');

async function run(command, args, { cwd, env, input = '' }) {
  const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  // A script refused early exits without reading its input: EPIPE is expected then.
  child.stdin.on('error', () => {});
  child.stdin.end(input);
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    // 'close', not 'exit': the output streams are fully read by then.
    child.once('close', code => resolve({ code, output }));
  });
}

// Installation de départ (v1.0.0) dont la configuration est produite par le vrai install.sh.
async function setup(t, { current = '1.0.0' } = {}) {
  const parent = await mkdtemp(path.join(tmpdir(), 'ReviewDesk mise à jour '));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const old = path.join(parent, 'reviewdesk-v' + current + '-docker');
  await mkdir(path.join(old, 'app'), { recursive: true });
  await mkdir(path.join(old, 'certs'));
  await writeFile(path.join(old, 'compose.yaml'), 'name: reviewdesk\nservices: {}\n');
  await writeFile(path.join(old, 'app/package.json'), packageJson(current));
  await writeFile(path.join(old, 'certs/LISEZMOI.txt'), 'ancien LISEZMOI\n');
  await writeFile(path.join(old, 'install.sh'), sources.install);
  await writeFile(path.join(old, 'update.sh'), sources.update);
  const log = path.join(parent, 'docker.log');
  await writeFile(log, '');
  const base = { PATH: `${await bin()}:/usr/bin:/bin`, LANG: 'C.UTF-8', FAKE_LOG: log, REVIEWDESK_UPDATE_POLL: '0' };
  const install = await run('sh', ['install.sh', '--non-interactive', '--port', '48312'], { cwd: old, env: base });
  assert.equal(install.code, 0, install.output);
  await writeFile(log, '');
  return { parent, old, log, base };
}

async function serve(parent, version, options) {
  const r = release(version, options);
  const zip = path.join(parent, `${r.root}.zip`);
  await writeFile(zip, r.zip);
  await writeFile(`${zip}.sha256`, r.sha);
  return { ...r, zipPath: zip, shaPath: `${zip}.sha256` };
}

const lines = async log => (await readFile(log, 'utf8')).split('\n').filter(Boolean);
const dockerCalls = async log => (await lines(log)).filter(line => line.includes('|'));
const mode = async file => (await stat(file)).mode & 0o777;
const sh = process.env.UPDATE_TEST_SHELL || 'sh';
const update = (ctx, args, extra = {}, input = '') => run(sh, [path.join(ctx.old, 'update.sh'), ...args], { cwd: ctx.old, env: { ...ctx.base, ...extra }, input });

test('update.sh is POSIX sh: parses under sh -n and dash -n, no bashisms', async () => {
  const text = sources.update;
  assert.match(text, /^#!\/bin\/sh\n/);
  assert.doesNotMatch(text, /\[\[(?!:)|\bfunction\b|\$\{[A-Za-z_]+\/\/|<<<|\bnode\b|\bnpm\b|\bpython/);
  assert.equal(spawnSync('sh', ['-n', updateScript]).status, 0);
  const dash = spawnSync('dash', ['-n', updateScript]);
  if (!dash.error) assert.equal(dash.status, 0);
});

test('--help documents every option', async (t) => {
  const ctx = await setup(t);
  const result = await update(ctx, ['--help']);
  assert.equal(result.code, 0);
  for (const word of ['--version', '--archive', '--force', '--yes', '--skip-backup', '--timeout', 'REVIEWDESK_REPOSITORY', 'pg_dump', '--force-recreate']) assert.ok(result.output.includes(word), word);
  assert.deepEqual(await dockerCalls(ctx.log), []);
});

test('nominal update from the latest release: backup, then recreate, old directory untouched', async (t) => {
  const ctx = await setup(t);
  const r = release('1.1.0');
  const zip = path.join(ctx.parent, 'served.zip');
  await writeFile(zip, r.zip);
  await writeFile(`${zip}.sha256`, r.sha);
  const before = await readFile(path.join(ctx.old, '.env'), 'utf8');
  const result = await update(ctx, ['--yes'], { FAKE_TAG: 'v1.1.0', FAKE_ZIP: zip, FAKE_SHA: `${zip}.sha256` });
  assert.equal(result.code, 0, result.output);
  const log = await lines(ctx.log);
  assert.ok(log.some(l => l.includes(`https://api.github.com/repos/${REPO}/releases/latest`)));
  assert.ok(log.some(l => l.includes(`https://github.com/${REPO}/releases/download/v1.1.0/reviewdesk-v1.1.0-docker.zip`)));
  const nw = path.join(ctx.parent, 'reviewdesk-v1.1.0-docker');
  const calls = await dockerCalls(ctx.log);
  const dump = calls.findIndex(l => l.endsWith('|compose exec -T postgres pg_dump -U reviewdesk reviewdesk'));
  const up = calls.findIndex(l => l.endsWith('|compose up -d --build --force-recreate'));
  assert.ok(dump >= 0 && up > dump, 'pg_dump runs before up');
  assert.ok(calls[dump].startsWith(`${ctx.old}|`), 'dump runs in the OLD directory');
  assert.ok(calls[up].startsWith(`${nw}|`), 'up runs in the NEW directory');
  const backups = (await readdir(ctx.old)).filter(n => /^backup-\d{8}-\d{6}\.sql$/.test(n));
  assert.equal(backups.length, 1);
  assert.equal(await mode(path.join(ctx.old, backups[0])), 0o600);
  assert.match(await readFile(path.join(ctx.old, backups[0]), 'utf8'), /fake dump/);
  // Configuration copied with its permissions; new LISEZMOI kept.
  assert.equal(await readFile(path.join(nw, '.env'), 'utf8'), before);
  assert.equal(await mode(path.join(nw, '.env')), 0o600);
  assert.equal(await mode(path.join(nw, 'secrets')), 0o700);
  assert.equal(await mode(path.join(nw, 'secrets/postgres_password')), 0o600);
  assert.equal(await readFile(path.join(nw, 'certs/LISEZMOI.txt'), 'utf8'), 'nouveau LISEZMOI\n');
  assert.equal(await readFile(path.join(nw, 'secrets/postgres_password'), 'utf8'), await readFile(path.join(ctx.old, 'secrets/postgres_password'), 'utf8'));
  // Old directory intact, final message complete.
  assert.equal(JSON.parse(await readFile(path.join(ctx.old, 'app/package.json'), 'utf8')).version, '1.0.0');
  assert.equal(await readFile(path.join(ctx.old, 'certs/LISEZMOI.txt'), 'utf8'), 'ancien LISEZMOI\n');
  assert.ok(result.output.includes('1.1.0') && result.output.includes(ctx.old) && result.output.includes(backups[0]));
  assert.match(result.output, /Retour arrière/);
  assert.deepEqual((await readdir(nw)).filter(n => n.startsWith('.reviewdesk-install.lock')), []);
});

test('confirmation: refusal (or empty stdin) stops before any Docker call', async (t) => {
  const ctx = await setup(t);
  const served = await serve(ctx.parent, '1.1.0');
  const result = await update(ctx, ['--archive', served.zipPath], {}, 'n\n');
  assert.equal(result.code, 1, result.output);
  assert.deepEqual(await dockerCalls(ctx.log), []);
  // The folder this run prepared (with copied secrets) is removed, so a retry just works.
  await assert.rejects(stat(path.join(ctx.parent, 'reviewdesk-v1.1.0-docker')));
  const retry = await update(ctx, ['--archive', served.zipPath], {}, 'o\n');
  assert.equal(retry.code, 0, retry.output);
});

test('already up to date: exit 0, nothing downloaded or started', async (t) => {
  const ctx = await setup(t);
  const result = await update(ctx, ['--yes'], { FAKE_TAG: 'v1.0.0' });
  assert.equal(result.code, 0);
  assert.match(result.output, /déjà à jour/);
  assert.deepEqual(await dockerCalls(ctx.log), []);
  assert.deepEqual((await readdir(ctx.parent)).filter(n => n.endsWith('-docker')), ['reviewdesk-v1.0.0-docker']);
  // A latest release older than the local version is also "up to date"; an explicit older one is refused.
  assert.equal((await update(ctx, ['--yes'], { FAKE_TAG: 'v0.9.0' })).code, 0);
  const older = await update(ctx, ['--yes', '--version', '0.9.0']);
  assert.equal(older.code, 2);
  assert.match(older.output, /plus ancienne/);
});

test('--force reinstalls the same version only when the target directory is free', async (t) => {
  const ctx = await setup(t);
  const refused = await update(ctx, ['--yes', '--force', '--version', '1.0.0']);
  assert.equal(refused.code, 2);
  assert.match(refused.output, /existe déjà/);
  assert.deepEqual(await dockerCalls(ctx.log), []);
});

test('wrong SHA-256: stops before anything is created or started', async (t) => {
  const ctx = await setup(t);
  const served = await serve(ctx.parent, '1.1.0', { tamper: true });
  const result = await update(ctx, ['--yes'], { FAKE_TAG: 'v1.1.0', FAKE_ZIP: served.zipPath, FAKE_SHA: served.shaPath });
  assert.equal(result.code, 2);
  assert.match(result.output, /SHA-256/);
  assert.equal(await stat(path.join(ctx.parent, 'reviewdesk-v1.1.0-docker')).catch(() => null), null);
  assert.deepEqual(await dockerCalls(ctx.log), []);
  const offline = await update(ctx, ['--yes', '--archive', served.zipPath]);
  assert.equal(offline.code, 2);
  assert.equal(await stat(path.join(ctx.parent, 'reviewdesk-v1.1.0-docker')).catch(() => null), null);
});

test('existing target directory: refused, left untouched', async (t) => {
  const ctx = await setup(t);
  const served = await serve(ctx.parent, '1.1.0');
  const target = path.join(ctx.parent, 'reviewdesk-v1.1.0-docker');
  await mkdir(target);
  await writeFile(path.join(target, 'marker'), 'x');
  const result = await update(ctx, ['--yes', '--archive', served.zipPath]);
  assert.equal(result.code, 2);
  assert.match(result.output, /existe déjà/);
  assert.deepEqual(await readdir(target), ['marker']);
  assert.deepEqual(await dockerCalls(ctx.log), []);
});

test('--archive works offline (no curl call) and checks the .sha256 next to it', async (t) => {
  const ctx = await setup(t);
  const served = await serve(ctx.parent, '1.2.0');
  const result = await update(ctx, ['--yes', '--archive', served.zipPath]);
  assert.equal(result.code, 0, result.output);
  assert.ok(!(await lines(ctx.log)).some(l => !l.includes('|')), 'no curl call');
  assert.ok((await stat(path.join(ctx.parent, 'reviewdesk-v1.2.0-docker/.env'))).isFile());
  const ctx2 = await setup(t);
  const lone = await serve(ctx2.parent, '1.2.0');
  await rm(lone.shaPath);
  const missing = await update(ctx2, ['--yes', '--archive', lone.zipPath]);
  assert.equal(missing.code, 2);
  assert.match(missing.output, /sha256/);
});

test('malformed or conflicting versions are refused before any work', async (t) => {
  const ctx = await setup(t);
  for (const bad of ['1.2', 'v1.2.3', '1.2.3-rc1', '1.2.3.4', '../1.2.3', '1.2.3; true', '']) {
    const result = await update(ctx, ['--yes', '--version', bad]);
    assert.equal(result.code, 2, bad);
    assert.match(result.output, /version invalide/, bad);
  }
  const both = await update(ctx, ['--yes', '--version', '1.2.3', '--archive', 'x.zip']);
  assert.equal(both.code, 2);
  const badTag = await update(ctx, ['--yes'], { FAKE_TAG: 'latest' });
  assert.equal(badTag.code, 2);
  assert.match(badTag.output, /tag de release inattendu/);
  assert.equal((await update(ctx, ['--bogus'])).code, 2);
  assert.deepEqual(await dockerCalls(ctx.log), []);
  assert.deepEqual((await readdir(ctx.parent)).filter(n => n.endsWith('-docker')), ['reviewdesk-v1.0.0-docker']);
});

test('failed backup stops the update before up; --skip-backup is explicit', async (t) => {
  const ctx = await setup(t);
  const served = await serve(ctx.parent, '1.1.0');
  const failed = await update(ctx, ['--yes', '--archive', served.zipPath], { FAKE_DUMP: 'fail' });
  assert.equal(failed.code, 2);
  assert.match(failed.output, /sauvegarde/);
  const calls = await dockerCalls(ctx.log);
  assert.equal(calls.length, 1);
  assert.ok(!calls.some(l => l.includes(' up ')));
  assert.deepEqual((await readdir(ctx.old)).filter(n => n.startsWith('backup-')), []);
  // The prepared directory exists: the user removes it by hand before retrying; here skip the backup in another install.
  const ctx2 = await setup(t);
  const served2 = await serve(ctx2.parent, '1.1.0');
  const skipped = await update(ctx2, ['--yes', '--skip-backup', '--archive', served2.zipPath]);
  assert.equal(skipped.code, 0, skipped.output);
  assert.ok(!(await dockerCalls(ctx2.log)).some(l => l.includes('pg_dump')));
});

test('app never healthy: clear error and rollback help, non-zero exit', async (t) => {
  const ctx = await setup(t);
  const served = await serve(ctx.parent, '1.1.0');
  const result = await update(ctx, ['--yes', '--timeout', '0', '--archive', served.zipPath], { FAKE_HEALTH: 'starting' });
  assert.equal(result.code, 1);
  assert.match(result.output, /pas healthy/);
  assert.match(result.output, /Retour arrière/);
});

test('refuses to run outside an installation directory', async (t) => {
  const ctx = await setup(t);
  await rm(path.join(ctx.old, '.env'));
  const result = await update(ctx, ['--yes']);
  assert.equal(result.code, 2);
  assert.match(result.output, /\.env introuvable/);
});

test('no destructive Docker or filesystem command is ever issued', async (t) => {
  const ctx = await setup(t);
  const served = await serve(ctx.parent, '1.1.0');
  assert.equal((await update(ctx, ['--yes', '--archive', served.zipPath])).code, 0);
  const forbidden = /\bdown\b|volume rm|volume prune|system prune|\bprune\b|\brm\b| -v\b|compose rm|\bkill\b/;
  for (const call of await dockerCalls(ctx.log)) assert.doesNotMatch(call.split('|')[1], forbidden, call);
  const code = sources.update.split('\n').filter(line => !/^\s*#/.test(line)).join('\n');
  assert.doesNotMatch(code, /down -v|volume rm|prune|rm -rf "\$old_dir|rm -rf "\$new_dir"/);
  assert.ok((await stat(path.join(ctx.old, 'app/package.json'))).isFile());
});
