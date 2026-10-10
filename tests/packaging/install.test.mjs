import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { acquireLock } from '../../scripts/packaging/runtime/kit.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'kit cancel espaces '));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const file of ['install.mjs', 'kit.mjs']) {
    await copyFile(new URL(`../../scripts/packaging/runtime/${file}`, import.meta.url), path.join(root, file));
  }
  return root;
}

function install(t, root, env = {}) {
  const childEnv = { ...process.env, ...env };
  delete childEnv.NODE_PATH;
  delete childEnv.NODE_OPTIONS;
  const child = spawn(process.execPath, ['install.mjs', '--generate-password'], {
    cwd: root, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const done = once(child, 'close');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await done;
  });
  return { child, done, output: () => output };
}

async function waitFor(check) {
  for (let i = 0; i < 300; i++) {
    const result = await check();
    if (result) return result;
    await delay(20);
  }
  assert.fail('Timed out waiting for npm fixture');
}

async function exists(file) {
  try { await stat(file); return true; } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return false;
  }
}

async function unlocked(root) {
  assert.equal(await exists(path.join(root, '.reviewdesk/operation.lock')), false);
  await (await acquireLock(root))();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  for (const stubborn of [false, true]) {
    test(`${signal} during npm: ${stubborn ? 'force termination' : 'wait for child'}, repeated signal, lock and reinstall`,
      { timeout: 15_000, skip: process.platform === 'win32' }, async t => {
        const root = await fixture(t);
        const cli = path.join(root, 'npm-cli.js');
        await writeFile(cli, `
          const fs = require('node:fs');
          const assert = require('node:assert/strict');
          assert.deepEqual(process.argv.slice(2), ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund']);
          process.on('SIGTERM', () => {
            fs.writeFileSync('terminating', 'ready');
            ${stubborn ? '' : `setTimeout(() => {
              fs.writeFileSync('lock-held-at-exit', String(fs.existsSync('.reviewdesk/operation.lock')));
              process.exit(0);
            }, 300);`}
          });
          fs.writeFileSync('npm-pid', String(process.pid));
          setInterval(() => {}, 1000);
        `);
        const run = install(t, root, { npm_execpath: cli });
        await waitFor(() => exists(path.join(root, 'npm-pid')));
        const pid = Number(await readFile(path.join(root, 'npm-pid'), 'utf8'));
        t.after(() => { try { process.kill(pid, 'SIGKILL'); } catch { /* Already stopped. */ } });
        const config = await readFile(path.join(root, '.reviewdesk/config.json'));
        run.child.kill(signal);
        await waitFor(() => exists(path.join(root, 'terminating')));
        await assert.rejects(acquireLock(root), /cours|verrou/);
        run.child.kill(signal);
        assert.deepEqual(await run.done, [signal === 'SIGINT' ? 130 : 143, null], run.output());
        assert.match(run.output(), /Installation annulée/);
        assert.doesNotMatch(run.output(), /Installation terminée/);
        assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
        if (!stubborn) assert.equal(await readFile(path.join(root, 'lock-held-at-exit'), 'utf8'), 'true');
        await unlocked(root);
        // A failed npm and then a successful reinstall must also free the lock.
        for (const code of [1, 0]) {
          await writeFile(cli, `process.exit(${code});`);
          const retry = install(t, root, { npm_execpath: cli });
          assert.deepEqual(await retry.done, [code, null], retry.output());
          await unlocked(root);
          assert.deepEqual(await readFile(path.join(root, '.reviewdesk/config.json')), config);
        }
      });
  }

  test(`${signal} cancels real npm ci during a package download and releases lock`,
    { timeout: 15_000, skip: process.platform === 'win32' }, async t => {
      const root = await fixture(t);
      const server = createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'application/octet-stream' });
        response.write('deliberately incomplete package');
      });
      t.after(() => { server.closeAllConnections(); server.close(); });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const url = `http://127.0.0.1:${server.address().port}/fixture.tgz`;
      const manifest = { name: 'cancel-fixture', version: '1.0.0', dependencies: { fixture: url } };
      await writeFile(path.join(root, 'package.json'), JSON.stringify(manifest));
      await writeFile(path.join(root, 'package-lock.json'), JSON.stringify({
        name: manifest.name, version: manifest.version, lockfileVersion: 3,
        packages: { '': manifest, 'node_modules/fixture': { version: '1.0.0', resolved: url } },
      }));
      const request = once(server, 'request');
      const run = install(t, root, { npm_config_cache: path.join(root, 'npm-cache'), npm_config_fetch_retries: '0' });
      // This event proves npm ci has reached installation, without an external registry.
      await request;
      const socketsClosed = once(server, 'close');
      run.child.kill(signal);
      assert.deepEqual(await run.done, [signal === 'SIGINT' ? 130 : 143, null], run.output());
      await unlocked(root);
      // No npm download connection may survive the installer.
      server.close();
      await socketsClosed;
    });
}
