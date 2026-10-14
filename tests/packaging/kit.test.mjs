import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectAssets, createZip, validateRuntimeManifest } from '../../scripts/packaging/package-kit.mjs';
import { configure, readConfig, validatePassword, parsePort, assertNode22, acquireLock, npmCliCandidates } from '../../scripts/packaging/runtime/kit.mjs';

const strong = 'fougere-Quartz!7926-violet';
async function scratch(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'ReviewDesk kit test '));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('runtime requires Node 22 and rejects unsafe or malformed ports', () => {
  assertNode22('22.23.3');
  for (const version of ['20.19.0', '24.0.0']) assert.throws(() => assertNode22(version), /22/);
  for (const value of ['0', '-1', '65536', '4300garbage', '1e3', '']) assert.throws(() => parsePort(value));
  assert.equal(parsePort('4300'), 4300);
});

test('password rules agree with app and exclude values that cannot survive login', () => {
  assert.equal(validatePassword(strong), strong);
  for (const value of ['', 'short', 'aaaaaaaaaaaaaaaa', 'abcdabcdabcdabcd', 'my-password-12345678', ` ${strong}`, `${strong}\n`, `${strong}\u0000`, 'a'.repeat(401)]) {
    assert.throws(() => validatePassword(value));
  }
});

test('first run fails closed without input; stdin configuration is private and never overwritten on reinstall', async (t) => {
  const root = await scratch(t);
  await assert.rejects(configure(root, {}), /mot de passe|terminal/i);
  await assert.rejects(configure(root, { password: 'weak' }));
  await assert.rejects(readConfig(root));
  const created = await configure(root, { password: strong });
  assert.equal(created.adminPassword, strong);
  const file = path.join(root, '.reviewdesk/config.json');
  const before = await readFile(file, 'utf8');
  if (process.platform !== 'win32') {
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal((await stat(path.dirname(file))).mode & 0o777, 0o700);
  }
  await configure(root, { password: 'different-Quartz!8397-green' });
  assert.equal(await readFile(file, 'utf8'), before);
  assert.deepEqual(await readConfig(root), created);
});

test('generated credential is strong, unique, persisted, and damaged config fails closed', async (t) => {
  const a = await scratch(t), b = await scratch(t);
  const one = await configure(a, { generate: true }), two = await configure(b, { generate: true });
  validatePassword(one.adminPassword);
  assert.notEqual(one.adminPassword, two.adminPassword);
  await writeFile(path.join(a, '.reviewdesk/config.json'), '{broken');
  await assert.rejects(configure(a, { generate: true }), /configuration/i);
  assert.equal(await readFile(path.join(a, '.reviewdesk/config.json'), 'utf8'), '{broken');
});

test('configuration rejects symlinks and simultaneous install/start cannot own the same database', async (t) => {
  const root = await scratch(t);
  const release = await acquireLock(root);
  await assert.rejects(acquireLock(root), /cours|verrou/i);
  await release();
  await (await acquireLock(root))();
  if (process.platform !== 'win32') {
    const target = path.join(root, 'outside.json');
    await writeFile(target, JSON.stringify({ version: 1, adminPassword: strong, port: 4300 }));
    await symlink(target, path.join(root, '.reviewdesk/config.json'));
    await assert.rejects(readConfig(root), /symbolique/i);
  }
});

test('npm discovery handles Windows and Unix Node installations without a shell', () => {
  assert.ok(npmCliCandidates('C:\\Program Files\\nodejs\\node.exe', {}, 'win32').includes('C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js'));
  assert.ok(npmCliCandidates('/usr/local/bin/node', {}, 'linux').includes('/usr/local/lib/node_modules/npm/bin/npm-cli.js'));
});

test('asset collection includes nested fonts/licenses and refuses secrets, source, data, logs and symlinks', async (t) => {
  const root = await scratch(t);
  await mkdir(path.join(root, 'fonts'));
  await writeFile(path.join(root, 'fonts/geist.woff2'), 'font');
  await writeFile(path.join(root, 'fonts/LICENSE-geist.txt'), 'license');
  await writeFile(path.join(root, 'index.html'), '<html>kit</html>');
  assert.deepEqual((await collectAssets(root)).map(x => x.name), ['fonts/LICENSE-geist.txt', 'fonts/geist.woff2', 'index.html']);
  for (const name of ['.env', 'secret.json', 'error.log', 'source.ts', 'bundle.js.map', 'data.sqlite']) {
    await writeFile(path.join(root, name), 'MUST NOT SHIP');
    await assert.rejects(collectAssets(root), /interdit|asset/i);
    await rm(path.join(root, name));
  }
  if (process.platform !== 'win32') {
    await symlink(path.join(root, 'index.html'), path.join(root, 'link.html'));
    await assert.rejects(collectAssets(root), /symbolique/i);
  }
});

test('ZIP creation is deterministic and refuses traversal, duplicate names and private paths', () => {
  const entries = [{ name: 'reviewdesk-v8.0.0-local/public/index.html', data: Buffer.from('été') }];
  const zip = createZip(entries);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.deepEqual(zip, createZip(entries));
  for (const name of ['../escape', '/absolute', 'C:/escape', 'kit/.env', 'kit/.git/config', 'kit/.data/db', 'kit/src/index.ts', 'kit/error.log', 'kit/dist/server.js.map', 'kit/node_modules/thing.js']) {
    assert.throws(() => createZip([{ name, data: Buffer.from('no') }]));
  }
  assert.throws(() => createZip([...entries, ...entries]));
});

test('standalone manifest pins runtime dependencies including PGlite and lockfile has no dev tooling', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../scripts/packaging/runtime/package.json', import.meta.url)));
  const lock = JSON.parse(await readFile(new URL('../../scripts/packaging/runtime/package-lock.json', import.meta.url)));
  validateRuntimeManifest(manifest, lock);
  assert.equal(manifest.version, '8.0.0');
  assert.equal(manifest.license, 'UNLICENSED');
  assert.ok(manifest.dependencies['@electric-sql/pglite']);
  assert.equal(manifest.devDependencies, undefined);
  assert.equal(lock.packages['node_modules/@electric-sql/pglite'].dev, undefined);
  assert.equal(lock.packages['node_modules/esbuild'], undefined);
  assert.throws(() => validateRuntimeManifest({ ...manifest, dependencies: { ...manifest.dependencies, fastify: '^5' } }, lock));
});
