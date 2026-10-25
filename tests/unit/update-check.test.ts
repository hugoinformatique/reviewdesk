import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, createUpdateChecker, isValidRepository, parseVersion, type FetchLike } from '../../src/update-check.js';
import { loadConfig } from '../../src/config.js';

const release = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ tag_name: 'v10.2.0', html_url: 'https://github.com/hugoinformatique/reviewdesk/releases/tag/v10.2.0', draft: false, prerelease: false, ...over });

function fake(body: string | (() => Promise<Response>), status = 200) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers });
    return typeof body === 'string' ? new Response(body, { status }) : body();
  };
  return { impl, calls };
}

const checker = (f: FetchLike, extra: Partial<Parameters<typeof createUpdateChecker>[0]> = {}) =>
  createUpdateChecker({ enabled: true, repository: 'hugoinformatique/reviewdesk', currentVersion: '10.1.0', fetch: f, ...extra });

test('versions compare strictly as X.Y.Z', () => {
  assert.deepEqual(parseVersion('v1.2.3'), [1, 2, 3]);
  for (const bad of ['1.2', '1.2.3-rc.1', 'v1.2.3.4', 'latest', '', '1.2.x', 42, null]) assert.equal(parseVersion(bad), null, String(bad));
  assert.ok(compareVersions('10.2.0', '10.1.9')! > 0);
  assert.ok(compareVersions('10.0.0', '9.99.99')! > 0, 'numeric, not lexical');
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.ok(compareVersions('1.2.3', '1.10.0')! < 0);
  assert.equal(compareVersions('x', '1.0.0'), null);
});

test('repository names are validated as owner/repo', () => {
  assert.equal(isValidRepository('hugoinformatique/reviewdesk'), true);
  for (const bad of ['reviewdesk', 'a/b/c', '../x', 'a/../b', '/a', 'a/', 'a b/c', 'a/b?x=1']) assert.equal(isValidRepository(bad), false, bad);
});

test('a newer release is reported, with the documented request and nothing else', async () => {
  const f = fake(release());
  const info = await checker(f.impl).get();
  assert.deepEqual(info, {
    current: '10.1.0',
    latest: '10.2.0',
    updateAvailable: true,
    releaseUrl: 'https://github.com/hugoinformatique/reviewdesk/releases/tag/v10.2.0',
    checkEnabled: true,
  });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0]!.url, 'https://api.github.com/repos/hugoinformatique/reviewdesk/releases/latest');
  assert.deepEqual(f.calls[0]!.headers, { Accept: 'application/vnd.github+json', 'User-Agent': 'ReviewDesk/10.1.0' });
});

test('same or older release means no update', async () => {
  for (const tag of ['v10.1.0', 'v10.0.9']) {
    const info = await checker(fake(release({ tag_name: tag })).impl).get();
    assert.equal(info.updateAvailable, false);
    assert.equal(info.releaseUrl, null);
  }
});

test('drafts, prereleases and malformed tags are ignored', async () => {
  for (const over of [{ draft: true }, { prerelease: true }, { tag_name: 'v10.3.0-beta.1' }, { tag_name: 'nightly' }, { tag_name: 7 }]) {
    const info = await checker(fake(release(over)).impl).get();
    assert.equal(info.updateAvailable, false, JSON.stringify(over));
    assert.equal(info.latest, null);
  }
});

test('a release URL outside github.com is dropped', async () => {
  const info = await checker(fake(release({ html_url: 'https://evil.example/github.com/x' })).impl).get();
  assert.equal(info.updateAvailable, true);
  assert.equal(info.releaseUrl, null);
});

test('unexpected answers never throw and report nothing', async () => {
  for (const f of [fake('<html>nope</html>'), fake('null'), fake('[]'), fake('{}', 404), fake(release(), 403), fake(async () => Promise.reject(new Error('offline')))]) {
    const info = await checker(f.impl).get();
    assert.equal(info.updateAvailable, false);
    assert.equal(info.latest, null);
    assert.equal(info.checkEnabled, true);
  }
});

test('success is cached for 12 hours, then refreshed in the background', async () => {
  let t = 0;
  const f = fake(release());
  const c = checker(f.impl, { now: () => t });
  await c.get();
  t = 12 * 3_600_000 - 1;
  await c.get();
  assert.equal(f.calls.length, 1);
  t = 12 * 3_600_000 + 1;
  const stale = await c.get();
  assert.equal(stale.latest, '10.2.0', 'the stale answer is served immediately');
  await new Promise((r) => setImmediate(r));
  assert.equal(f.calls.length, 2);
});

test('a failure is cached for one hour, then retried', async () => {
  let t = 0;
  const f = fake('boom', 500);
  const c = checker(f.impl, { now: () => t });
  await c.get();
  await c.get();
  t = 3_600_000 - 1;
  await c.get();
  assert.equal(f.calls.length, 1);
  t = 3_600_000 + 1;
  await c.get();
  await new Promise((r) => setImmediate(r));
  assert.equal(f.calls.length, 2);
});

test('a failed refresh keeps the last known release', async () => {
  let t = 0;
  let ok = true;
  const f = fake(async () => (ok ? new Response(release()) : new Response('x', { status: 500 })));
  const c = checker(f.impl, { now: () => t });
  await c.get();
  ok = false;
  t = 13 * 3_600_000;
  await c.get();
  await new Promise((r) => setImmediate(r));
  assert.equal((await c.get()).latest, '10.2.0');
});

test('concurrent first calls share one request', async () => {
  const f = fake(release());
  const c = checker(f.impl);
  await Promise.all([c.get(), c.get(), c.get()]);
  assert.equal(f.calls.length, 1);
});

test('a hanging server is abandoned after the timeout', async () => {
  const hang: FetchLike = (_url, init) =>
    new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const started = Date.now();
  const info = await checker(hang, { timeoutMs: 50 }).get();
  assert.ok(Date.now() - started < 1_000);
  assert.equal(info.updateAvailable, false);
  assert.equal(info.latest, null);
});

test('when disabled, no request is ever made', async () => {
  const f = fake(release());
  const info = await checker(f.impl, { enabled: false }).get();
  assert.deepEqual(info, { current: '10.1.0', latest: null, updateAvailable: false, releaseUrl: null, checkEnabled: false });
  assert.equal(f.calls.length, 0);
});

test('configuration: enabled by default, switchable, repository validated', () => {
  const env = {
    ADMIN_PASSWORD: 'grenat-fougere-litanie-8412',
    DATABASE_URL: 'pglite://memory',
    STORAGE_DRIVER: 'filesystem',
  };
  const defaults = loadConfig(env);
  assert.equal(defaults.updateCheck, true);
  assert.equal(defaults.updateCheckRepository, 'hugoinformatique/reviewdesk');
  for (const off of ['false', '0', 'off', 'no']) assert.equal(loadConfig({ ...env, UPDATE_CHECK: off }).updateCheck, false, off);
  assert.equal(loadConfig({ ...env, UPDATE_CHECK_REPOSITORY: 'acme/fork' }).updateCheckRepository, 'acme/fork');
  assert.throws(() => loadConfig({ ...env, UPDATE_CHECK_REPOSITORY: 'not a repo' }), /owner\/repo/);
});
