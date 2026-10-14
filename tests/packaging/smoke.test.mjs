import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const version = JSON.parse(await readFile(path.join(repository, 'package.json'), 'utf8')).version;
const archivePath = process.env.REVIEWDESK_KIT_ZIP || path.join(repository, `test-results/local-kit/reviewdesk-v${version}-local.zip`);
const password = 'fougere-Quartz!7926-violet'; // Disposable test credential only.
const timeout = ms => new Promise(resolve => setTimeout(resolve, ms));

// Read the central directory independently of the writer and validate each local entry.
async function extractZip(zip, destination) {
  const end = zip.length - 22;
  assert.equal(zip.readUInt32LE(end), 0x06054b50);
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  const names = [];
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(offset), 0x02014b50);
    assert.equal(zip.readUInt16LE(offset + 10), 8);
    const size = zip.readUInt32LE(offset + 20);
    const length = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 46, offset + 46 + length).toString('utf8');
    assert.ok(!name.split('/').includes('..') && !path.isAbsolute(name) && !name.includes('\\'));
    assert.ok(!names.includes(name));
    names.push(name);
    const local = zip.readUInt32LE(offset + 42);
    assert.equal(zip.readUInt32LE(local), 0x04034b50);
    assert.equal(zip.readUInt32LE(local + 14), zip.readUInt32LE(offset + 16));
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = inflateRawSync(zip.subarray(start, start + size));
    assert.equal(data.length, zip.readUInt32LE(offset + 24));
    const file = path.join(destination, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
    offset += 46 + length + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32);
  }
  assert.equal(offset, end);
  return names;
}

function childNode(args, cwd, input = '', env = {}) {
  const childEnv = { ...process.env, ...env };
  delete childEnv.NODE_PATH;
  delete childEnv.NODE_OPTIONS;
  const child = spawn(process.execPath, args, { cwd, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  child.stdin.on('error', () => {});
  child.stdin.end(input);
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal, output }));
  });
  return { child, done, output: () => output };
}

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function assets(root, prefix = '') {
  const names = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    // Build outputs a local `npm run build` may have left: the kit rebuilds them.
    if (!prefix && ['index.html', 'assets', 'next', 'admin.js', 'widget.js'].includes(entry.name)) continue;
    if (entry.isDirectory()) names.push(...await assets(root, `${prefix}${entry.name}/`));
    else names.push(prefix + entry.name);
  }
  return names;
}

test('ZIP installs in a path with spaces; local HTTP/admin, uploads and database survive restart and npm reinstall', { timeout: 240_000 }, async t => {
  const zip = await readFile(archivePath);
  const checksum = (await readFile(`${archivePath}.sha256`, 'utf8')).trim().split(/\s+/)[0];
  assert.equal(createHash('sha256').update(zip).digest('hex'), checksum);
  const scratchBase = await realpath(tmpdir());
  const repo = await realpath(repository);
  assert.ok(scratchBase !== repo && !scratchBase.startsWith(repo + path.sep), 'OS temp must be outside the repository');
  const scratch = await mkdtemp(path.join(scratchBase, 'kit smoke espaces été '));
  let running;
  t.after(async () => {
    if (running && running.child.exitCode === null && running.child.signalCode === null) {
      running.child.kill('SIGKILL');
      await running.done;
    }
    await rm(scratch, { recursive: true, force: true });
  });
  const names = await extractZip(zip, scratch);
  const prefix = `reviewdesk-v${version}-local/`;
  assert.ok(names.every(name => name.startsWith(prefix)));
  const members = names.map(name => name.slice(prefix.length));
  assert.ok(members.every(name => /^(dist\/(server|mcp|local-server)\.js|public\/.+|install\.mjs|start\.mjs|kit\.mjs|package(-lock)?\.json|GUIDE-FR\.md|NOTICE\.txt)$/.test(name)));
  assert.ok(!members.some(name => /(^|\/)(\.[^/]*|src|node_modules|data|uploads|logs)(\/|$)|\.(ts|map|log)$/.test(name)));
  const root = path.join(scratch, prefix);
  // Probe both CommonJS and ESM from the kit, never from the test runner.
  const probe = path.join(root, 'resolution-probe.mjs');
  await writeFile(probe, `
    import assert from 'node:assert/strict';
    import { readFileSync, realpathSync } from 'node:fs';
    import { createRequire } from 'node:module';
    import { fileURLToPath } from 'node:url';
    import path from 'node:path';
    const require = createRequire(import.meta.url);
    const dependencies = Object.keys(JSON.parse(readFileSync(new URL('./package.json', import.meta.url))).dependencies)
      .map(name => name === '@modelcontextprotocol/sdk' ? name + '/server/index.js' : name);
    assert.equal(process.env.NODE_PATH, undefined);
    assert.equal(process.env.NODE_OPTIONS, undefined);
    for (const name of [...dependencies, 'esbuild']) {
      if (process.argv[2] === 'absent' || name === 'esbuild') {
        assert.throws(() => require.resolve(name), { code: 'MODULE_NOT_FOUND' });
        assert.throws(() => import.meta.resolve(name), { code: 'ERR_MODULE_NOT_FOUND' });
      } else {
        const local = realpathSync(new URL('./node_modules/', import.meta.url)) + path.sep;
        assert.ok(realpathSync(require.resolve(name)).startsWith(local), name);
        assert.ok(realpathSync(fileURLToPath(import.meta.resolve(name))).startsWith(local), name);
      }
    }
  `);
  const resolutionOverrides = { NODE_PATH: path.join(repository, 'node_modules'), NODE_OPTIONS: '--require=/must-not-load.cjs' };
  async function verifyResolution(mode) {
    const result = await childNode([probe, mode], root, '', resolutionOverrides).done;
    assert.equal(result.code, 0, result.output);
  }
  await verifyResolution('absent');
  for (const name of await assets(path.join(repository, 'public'))) {
    assert.ok(members.includes(`public/${name}`), `missing asset ${name}`);
    assert.deepEqual(await readFile(path.join(root, 'public', name)), await readFile(path.join(repository, 'public', name)));
  }
  assert.ok(members.includes('public/widget.js') && members.includes('public/index.html'));
  const adminEntry = members.find((name) => /^public\/assets\/index-[\w-]+\.js$/.test(name));
  assert.ok(adminEntry, 'React admin entry chunk');
  const originalConfig = path.join(root, '.reviewdesk/config.json');
  const startPath = path.join(root, 'start.mjs');
  const installPath = path.join(root, 'install.mjs');
  let result = await childNode([startPath], scratch).done;
  assert.equal(result.code, 1);
  assert.match(result.output, /install.mjs/);
  result = await childNode([installPath], scratch).done;
  assert.equal(result.code, 1);
  assert.match(result.output, /terminal/i);
  result = await childNode([installPath, '--password-stdin'], scratch, 'weak\n').done;
  assert.equal(result.code, 1);
  await assert.rejects(readFile(originalConfig), { code: 'ENOENT' });
  result = await childNode([installPath, '--password-stdin'], scratch, `${password}\r\n`).done;
  assert.equal(result.code, 0, result.output);
  assert.ok(!result.output.includes(password));
  await verifyResolution('installed');
  t.diagnostic('Standalone CJS/ESM resolution: absent before install, kit-local after install; NODE_PATH/NODE_OPTIONS cleared.');
  const savedConfig = await readFile(originalConfig, 'utf8');
  const installed = JSON.parse(await readFile(path.join(root, 'node_modules/@electric-sql/pglite/package.json'), 'utf8'));
  assert.equal(installed.version, '0.5.8');
  await assert.rejects(readFile(path.join(root, 'node_modules/esbuild/package.json')), { code: 'ENOENT' });

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  for (const deployment of [{ NODE_ENV: 'production' }, { VERCEL: '1' }]) {
    const denied = await childNode([startPath, '--port', String(port)], scratch, '', deployment).done;
    assert.equal(denied.code, 1, denied.output);
    assert.match(denied.output, /refuse NODE_ENV=production et VERCEL=1/);
    await assert.rejects(readFile(path.join(root, '.reviewdesk/operation.lock')), { code: 'ENOENT' });
  }
  const hostileEnvironment = {
    HOST: '0.0.0.0', PORT: '1',
    DATABASE_URL: 'postgres://invalid.invalid/db', POSTGRES_URL: 'postgres://invalid.invalid/db',
    STORAGE_DRIVER: 's3', UPLOAD_DIR: '/must-not-be-used', ADMIN_PASSWORD: 'not-the-configured-password',
    SERVE_STATIC: 'false', SECURE_COOKIES: 'true', LOG_LEVEL: 'trace',
  };
  async function start() {
    running = childNode([startPath, '--port', String(port)], scratch, '', hostileEnvironment);
    for (let i = 0; i < 200; i++) {
      if (running.child.exitCode !== null) assert.fail(running.output());
      try {
        const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(400) });
        if (response.ok) {
          const health = await response.json();
          assert.equal(health.ok, true);
          assert.ok(health.storage.includes(path.join(root, '.reviewdesk/uploads')));
          return;
        }
      } catch { /* Wait until migrations and listen complete. */ }
      await timeout(100);
    }
    assert.fail(`Server did not become healthy: ${running.output()}`);
  }
  async function stop() {
    running.child.kill('SIGTERM');
    const result = await Promise.race([running.done, timeout(10000).then(() => { throw new Error('Graceful stop timed out'); })]);
    assert.equal(result.code, 0, result.output);
    assert.ok(!result.output.includes(password));
    await assert.rejects(readFile(path.join(root, '.reviewdesk/operation.lock')), { code: 'ENOENT' });
  }
  async function api(route, { method = 'GET', data, headers = {} } = {}) {
    const response = await fetch(`${base}${route}`, { method, headers: { ...(data ? { 'content-type': 'application/json' } : {}), ...headers }, body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(10000) });
    return response;
  }
  async function login() {
    const response = await api('/api/auth/login', { method: 'POST', data: { username: 'admin', password } });
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    assert.match(response.headers.get('set-cookie'), /HttpOnly/i);
    assert.match(response.headers.get('set-cookie'), /SameSite=Strict/i);
    const { csrfToken } = await response.json();
    return { cookie, 'x-csrf-token': csrfToken };
  }
  await start();
  for (const route of ['/', `/${adminEntry.slice('public/'.length)}`, '/widget.js', '/theme.js', '/demo.js', '/demo.html', '/fonts/geist-latin.woff2', '/fonts/geist-mono-latin.woff2', '/favicon.svg']) {
    const response = await api(route);
    assert.equal(response.status, 200, route);
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  }
  for (const route of ['/.reviewdesk/config.json', '/package.json', '/dist/server.js', '/.env']) assert.equal((await api(route)).status, 404, route);
  assert.equal((await api('/api/projects')).status, 401);
  assert.equal((await api('/api/auth/login', { method: 'POST', data: { username: 'admin', password: 'wrong' } })).status, 401);
  const duplicate = await childNode([startPath, '--port', String(await freePort())], scratch).done;
  assert.equal(duplicate.code, 1);
  assert.match(duplicate.output, /cours|verrou/);
  const concurrentInstall = await childNode([installPath], scratch).done;
  assert.equal(concurrentInstall.code, 1);
  assert.match(concurrentInstall.output, /cours|verrou/);
  const external = Object.values(networkInterfaces()).flat().find(item => item.family === 'IPv4' && !item.internal);
  if (external) {
    await assert.rejects(fetch(`http://${external.address}:${port}/health`, { signal: AbortSignal.timeout(1000) }));
    t.diagnostic('Non-loopback interface connection refused.');
  }
  let headers = await login();
  let response = await api('/api/projects', { method: 'POST', headers, data: { name: 'Persistence kit', clientLabel: 'Local', origins: [base] } });
  assert.equal(response.status, 201);
  const project = await response.json();
  response = await api(`/api/projects/${project.id}/review-links`, { method: 'POST', headers, data: {} });
  assert.equal(response.status, 201);
  const { token } = await response.json();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'capture.png');
  const reviewer = { authorization: `Bearer ${token}`, origin: base };
  response = await fetch(`${base}/api/uploads?projectId=${project.id}`, { method: 'POST', headers: reviewer, body: form });
  assert.equal(response.status, 201);
  const upload = await response.json();
  response = await api('/api/feedback', { method: 'POST', headers: reviewer, data: { projectId: project.id, text: 'Persiste après réinstallation', pageUrl: `${base}/demo.html`, anchor: { selector: '#hero', relative: { x: 0.5, y: 0.5 }, viewport: { width: 1200, height: 800 } }, screenshotId: upload.id } });
  assert.equal(response.status, 201);
  const ticket = await response.json();
  async function verifyPersistence() {
    headers = await login();
    const projectResponse = await api('/api/projects', { headers });
    assert.equal(projectResponse.status, 200);
    const projects = await projectResponse.json();
    assert.ok(projects.some(item => item.id === project.id));
    const tickets = await (await api('/api/tickets', { headers })).json();
    assert.ok(tickets.tickets.some(item => item.id === ticket.id && item.screenshotId === upload.id));
    const capture = await api(`/api/uploads/${upload.id}`, { headers });
    assert.equal(capture.status, 200);
    assert.deepEqual(Buffer.from(await capture.arrayBuffer()), png);
    assert.equal(await readFile(originalConfig, 'utf8'), savedConfig);
  }
  await stop();
  await start();
  await verifyPersistence();
  await stop();
  result = await childNode([installPath, '--generate-password'], scratch).done;
  assert.equal(result.code, 0, result.output);
  await verifyResolution('installed');
  assert.equal(await readFile(originalConfig, 'utf8'), savedConfig);
  await start();
  await verifyPersistence();
  await stop();
  t.diagnostic('Extraction, locked npm ci, admin login, project/ticket/upload persistence, restart and reinstall passed.');
});
