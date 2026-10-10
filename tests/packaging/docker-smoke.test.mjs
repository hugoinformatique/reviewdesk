// End-to-end smoke of the self-contained Docker ZIP (bundled SeaweedFS S3).
// Opt-in (REVIEWDESK_DOCKER_SMOKE=1) because it builds images and starts containers.
//
// Isolation rules: every docker command goes through `docker compose -p
// reviewdesk-kit-selfcontained-test`; loopback high ports only; never `down -v`
// nor prune. Named volumes are preserved and the matching kit configuration
// (.env, secrets/, certs/) is kept in a state directory so a rerun reuses them.
// No compose overlay: the stack under test is exactly the archive's compose.yaml.
// This process only plays the same-host TLS reverse proxy, with its own test CA.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { packageDocker } from '../../scripts/packaging/docker/package-docker.mjs';
import { readZip } from './docker-zip.mjs';

const exec = promisify(execFile);
const PROJECT = 'reviewdesk-kit-selfcontained-test';
const PUBLIC_HOST = 'reviewdesk.test';
const BUCKET = 'reviewdesk-captures';
const state = process.env.REVIEWDESK_DOCKER_STATE || path.join(homedir(), '.cache', PROJECT);
const enabled = process.env.REVIEWDESK_DOCKER_SMOKE === '1';
const exists = file => stat(file).then(() => true, () => false);
const CONFIG = ['.env', 'secrets', 'certs/ca.pem', 'certs/s3.pem'];
const SECRET_FILES = ['admin_password', 'postgres_password', 's3_access_key_id', 's3_secret_access_key', 's3_admin_access_key_id', 's3_admin_secret_access_key', 's3_tls_key'];

async function freePort(port) {
  const server = createServer();
  server.listen(port, '127.0.0.1');
  try { await once(server, 'listening'); return server.address().port; } finally { server.close(); }
}

function run(command, args, { cwd, input, env, allowFail = false, timeout = 900_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], timeout });
    let stdout = '', stderr = '';
    child.stdout.on('data', c => { stdout += c; });
    child.stderr.on('data', c => { stderr += c; });
    child.stdin.end(input ?? '');
    child.once('error', reject);
    child.once('exit', code => (code === 0 || allowFail ? resolve({ code, stdout, stderr }) : reject(new Error(`${command} ${args.join(' ')} → ${code}\n${stderr.slice(-3000)}`))));
  });
}

// Test-only PKI for the local reverse proxy (unrelated to the kit's internal S3 CA).
async function proxyPki(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const ssl = (...args) => exec('openssl', args, { cwd: dir });
  if (await exists(path.join(dir, 'proxy.pem'))) return;
  await ssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650', '-subj', '/CN=ReviewDesk proxy test CA', '-keyout', 'ca.key', '-out', 'ca.pem', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign');
  await ssl('req', '-newkey', 'rsa:2048', '-nodes', '-subj', `/CN=${PUBLIC_HOST}`, '-keyout', 'proxy.key', '-out', 'proxy.csr');
  await writeFile(path.join(dir, 'proxy.ext'), `subjectAltName=DNS:${PUBLIC_HOST}\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n`);
  await ssl('x509', '-req', '-in', 'proxy.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-days', '3650', '-extfile', 'proxy.ext', '-out', 'proxy.pem');
}

const snapshot = async root => {
  const files = {};
  for (const name of ['.env', 'certs/ca.pem', 'certs/s3.pem', ...SECRET_FILES.map(s => `secrets/${s}`)]) files[name] = await readFile(path.join(root, name), 'utf8').catch(() => null);
  return files;
};

test('Docker ZIP, self-contained: install.sh, compose up, bundled HTTPS S3 with generated CA, HTTPS proxy, persistence', { skip: !enabled && 'set REVIEWDESK_DOCKER_SMOKE=1', timeout: 1_800_000 }, async t => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'kit docker autonome été '));
  let proxy;
  let root;
  const compose = (args, options = {}) => run('docker', ['compose', '-p', PROJECT, ...args], { cwd: options.cwd ?? root, env: { COMPOSE_PROJECT_NAME: PROJECT }, ...options });
  t.after(async () => {
    proxy?.close();
    // Containers of this test project only (including one-off `run` containers); never -v: volumes stay.
    if (process.env.REVIEWDESK_DOCKER_KEEP !== '1' && root) await compose(['down', '--remove-orphans'], { allowFail: true }).catch(() => {});
    await rm(scratch, { recursive: true, force: true });
  });

  // 1. Package, verify the checksum, extract into a path with spaces and accents.
  const zipPath = await packageDocker(path.join(scratch, 'dist'));
  await run('sha256sum', ['-c', `${path.basename(zipPath)}.sha256`], { cwd: path.dirname(zipPath) });
  root = path.join(scratch, 'srv', 'reviewdesk-v8.0.0-docker');
  await readZip(await readFile(zipPath), path.join(scratch, 'srv'));
  assert.deepEqual((await readdir(path.join(root, 'certs'))).sort(), ['LISEZMOI.txt'], 'the archive ships no certificate nor key');

  // 2. Configuration: first run creates it with no S3 question; later runs restore it (upgrade path).
  await mkdir(state, { recursive: true, mode: 0o700 });
  const saved = path.join(state, 'kit-config');
  const installEnv = { PATH: '/usr/bin:/bin', COMPOSE_PROJECT_NAME: PROJECT };
  let firstRun = false;
  if (await exists(path.join(saved, '.env'))) {
    for (const name of CONFIG) await cp(path.join(saved, name), path.join(root, name), { recursive: true, preserveTimestamps: true });
    await chmod(path.join(root, '.env'), 0o600);
  } else {
    firstRun = true;
    const port = await freePort(48393);
    const created = await run('sh', ['install.sh', '--non-interactive', '--port', String(port)], { cwd: root, env: installEnv, allowFail: true });
    assert.equal(created.code, 0, created.stdout + created.stderr);
    assert.doesNotMatch(created.stdout + created.stderr, /PRIVATE KEY|S3_ACCESS_KEY_ID|S3_SECRET/);
    await mkdir(path.join(saved, 'certs'), { recursive: true, mode: 0o700 });
    for (const name of CONFIG) await cp(path.join(root, name), path.join(saved, name), { recursive: true });
  }
  const before = await snapshot(root);
  const kept = await run('sh', ['install.sh', '--non-interactive'], { cwd: root, env: installEnv, allowFail: true });
  assert.equal(kept.code, 0, kept.stdout + kept.stderr);
  assert.match(kept.stdout, /conserv/i);
  assert.deepEqual(await snapshot(root), before, 'rerun regenerates nothing');
  const env = before['.env'];
  assert.match(env, /^REVIEWDESK_S3=bundled$/m);
  assert.match(env, /^S3_ENDPOINT=https:\/\/s3:8443$/m);
  assert.equal((await stat(path.join(root, 'secrets/s3_tls_key'))).mode & 0o777, 0o600);
  const appPort = Number(env.match(/^REVIEWDESK_HTTP_PORT=(\d+)$/m)[1]);
  const secretValues = SECRET_FILES.map(name => before[`secrets/${name}`]);
  const tlsKeyBody = before['secrets/s3_tls_key'].split('\n').filter(line => line && !line.startsWith('-----')).join('');
  const leaks = text => secretValues.filter(value => text.includes(value)).length + (text.includes(tlsKeyBody.slice(0, 40)) ? 1 : 0);
  const adminPassword = before['secrets/admin_password'];

  // 3. TLS material checked on the host: generated CA, service name `s3` only.
  await run('openssl', ['verify', '-CAfile', path.join(root, 'certs/ca.pem'), '-verify_hostname', 's3', path.join(root, 'certs/s3.pem')]);
  assert.notEqual((await run('openssl', ['verify', '-CAfile', path.join(root, 'certs/ca.pem'), '-verify_hostname', 's3.example.test', path.join(root, 'certs/s3.pem')], { allowFail: true })).code, 0);

  // 4. Compose config / build / up, exactly as documented.
  const config = await compose(['config', '--format', 'json']);
  assert.equal(leaks(config.stdout), 0, 'secret in compose config');
  assert.deepEqual(Object.keys(JSON.parse(config.stdout).services).sort(), ['app', 'postgres', 's3', 's3-init', 's3-storage']);
  // Upgrade path (config restored into a new folder): --force-recreate, as documented,
  // so no container keeps secret bind mounts pointing at a previous folder.
  await compose(['up', '-d', '--build', ...(firstRun ? [] : ['--force-recreate'])]);
  const waitHealthy = async () => {
    for (let i = 0; i < 120; i++) {
      const ps = (await compose(['ps', '--format', 'json'])).stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      const app = ps.find(item => item.Service === 'app');
      if (app?.Health === 'healthy') return ps;
      if (app && /exited|dead/.test(app.State)) throw new Error(`app stopped: ${(await compose(['logs', '--no-color', '--tail', '50'])).stdout.slice(-3000)}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new Error(`app not healthy: ${(await compose(['logs', '--no-color', '--tail', '80'])).stdout.slice(-4000)}`);
  };
  let ps = await waitHealthy();
  const init = (await compose(['ps', '-a', '--format', 'json', 's3-init'])).stdout.trim().split('\n').map(line => JSON.parse(line))[0];
  assert.equal(init.ExitCode, 0, 'bucket bootstrap completed');
  const initLogs = (await compose(['logs', '--no-color', 's3-init'])).stdout;
  assert.match(initLogs, firstRun ? /créé|existe/ : /existe/);

  // 5. Network exposure: app on loopback only; PostgreSQL and S3 unpublished; app not root.
  const published = Object.fromEntries(ps.map(item => [item.Service, (item.Publishers ?? []).filter(p => p.PublishedPort)]));
  assert.deepEqual(published.postgres, []);
  assert.deepEqual(published.s3, []);
  assert.deepEqual(published.app.map(p => [p.URL, p.PublishedPort, p.TargetPort]), [['127.0.0.1', appPort, 4300]]);
  assert.match((await compose(['exec', '-T', 'app', 'sh', '-c', 'grep ^Uid: /proc/1/status'])).stdout, /^Uid:\s+1000\s+1000/);
  const weedUid = await compose(['exec', '-T', 's3-storage', 'sh', '-c', 'for p in /proc/[0-9]*; do [ "$(cat $p/comm 2>/dev/null)" = weed ] && grep ^Uid: $p/status; done; true']);
  assert.match(weedUid.stdout, /^Uid:\s+(\d+)/m);
  assert.doesNotMatch(weedUid.stdout, /^Uid:\s+0\s/m, 'SeaweedFS must not run as root');
  assert.deepEqual(published['s3-storage'], []);
  // SeaweedFS has no network interface: every listener, the S3 gateway (HTTPS
  // only, 8444) and its gRPC port (18444, IAM RPCs unauthenticated without a
  // filer signing key) included, exists on its loopback only.
  const interfaces = (await compose(['exec', '-T', 's3-storage', 'sh', '-c', "tail -n +3 /proc/net/dev | cut -d: -f1 | tr -d ' '"])).stdout.trim().split('\n');
  assert.deepEqual(interfaces, ['lo'], 'SeaweedFS container has loopback only');
  const listening = (await compose(['exec', '-T', 's3-storage', 'netstat', '-tln'])).stdout;
  const sockets = [...listening.matchAll(/^tcp6?\s+\d+\s+\d+\s+(\S+):(\d+)\s/gm)].map(([, host, port]) => [host, Number(port)]);
  for (const port of [9333, 8080, 8888, 8444, 18444]) assert.ok(sockets.some(([host, p]) => host === '127.0.0.1' && p === port), `SeaweedFS port ${port} on loopback`);
  assert.deepEqual(sockets.filter(([host]) => host !== '127.0.0.1'), [], listening);
  assert.ok(!sockets.some(([, port]) => port === 8333 || port === 18333), 'no default S3 HTTP/gRPC port');
  // The gateway listens on 8443 only (127.0.0.11 is Docker's embedded DNS).
  const gatewayPorts = `
    const fs = require('node:fs');
    const rows = ['/proc/net/tcp', '/proc/net/tcp6'].flatMap(f => fs.readFileSync(f, 'utf8').trim().split('\\n').slice(1));
    const listen = rows.map(r => r.trim().split(/\\s+/)).filter(c => c[3] === '0A').map(c => c[1]).filter(a => !a.startsWith('0B00007F:'));
    console.log([...new Set(listen.map(a => parseInt(a.split(':')[1], 16)))].join(' '));`;
  assert.equal((await compose(['exec', '-T', 's3', 'node', '-e', gatewayPorts])).stdout.trim(), '8443');
  assert.match((await compose(['exec', '-T', 's3', 'sh', '-c', 'grep ^Uid: /proc/1/status'])).stdout, /^Uid:\s+1000\s+1000/, 'gateway runs as node');
  const reach = `
    const net = require('node:net');
    const probe = (host, port) => new Promise(r => { const s = net.connect({ host, port, timeout: 3000 }, () => { r(host + ':' + port + ' open'); s.destroy(); }); s.on('timeout', () => { r(host + ':' + port + ' timeout'); s.destroy(); }); s.on('error', e => r(host + ':' + port + ' ' + e.code)); });
    (async () => {
      console.log(await probe('s3', 8443));
      for (const port of [8333, 8444, 18333, 18444, 8888, 18888, 9333, 19333, 8080, 18080]) console.log(await probe('s3', port));
      console.log(await probe('s3-storage', 18444));
    })();`;
  const reached = (await compose(['exec', '-T', 'app', 'node', '-e', reach])).stdout.trim().split('\n');
  assert.equal(reached[0], 's3:8443 open');
  for (const line of reached.slice(1)) assert.match(line, /ECONNREFUSED|timeout|EHOSTUNREACH|ENOTFOUND|EAI_AGAIN/, `unreachable from the app network: ${line}`);
  assert.equal(reached.length, 12);
  // Plaintext HTTP gets no S3 answer, neither through the network nor on loopback.
  const plain = await compose(['exec', '-T', 'app', 'node', '-e', "fetch('http://s3:8443/healthz').then(async r => console.log(r.status), e => console.log('error', e.cause?.code ?? e.name))"]);
  assert.match(plain.stdout, /^error /, plain.stdout);
  const plainLocal = await compose(['exec', '-T', 's3-storage', 'sh', '-c', 'curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:8444/healthz; echo; curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:8333/healthz 2>&1; true']);
  assert.match(plainLocal.stdout, /^400\n/, 'SeaweedFS primary listener is TLS only');
  assert.match(plainLocal.stdout, /refused|Failed to connect|^000/m, 'no plaintext S3 port 8333');
  const health = await fetch(`http://127.0.0.1:${appPort}/health`).then(r => r.json());
  assert.deepEqual([health.ok, health.database, health.storage], [true, 'postgresql', `s3 ${BUCKET} @ s3:8443`]);

  // 6. TLS from the app container: trusted through NODE_EXTRA_CA_CERTS only, name checked, no CA = refused.
  const tlsCheck = `
    const tls = require('node:tls'); const fs = require('node:fs');
    const ca = fs.readFileSync('/etc/reviewdesk/certs/ca.pem');
    const probe = opts => new Promise(r => { const s = tls.connect({ host: 's3', port: 8443, ...opts }, () => { r('ok ' + s.getPeerCertificate().subjectaltname); s.end(); }); s.on('error', e => r(e.code)); });
    (async () => { console.log(await probe({ servername: 's3' })); console.log(await probe({ servername: 'other.test', ca })); })();`;
  const tlsOut = (await compose(['exec', '-T', 'app', 'node', '-e', tlsCheck])).stdout.trim().split('\n');
  assert.deepEqual(tlsOut, ['ok DNS:s3', 'ERR_TLS_CERT_ALTNAME_INVALID']);
  const noCa = await compose(['exec', '-T', '-e', 'NODE_EXTRA_CA_CERTS=', 'app', 'node', '-e', "fetch('https://s3:8443/healthz').then(r => console.log(r.status), e => console.log(e.cause?.code))"]);
  assert.match(noCa.stdout, /UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED|UNABLE_TO_GET_ISSUER/);

  // 7. Same-host TLS reverse proxy with a real hostname check on the client side.
  await proxyPki(path.join(state, 'proxy-pki'));
  const ca = await readFile(path.join(state, 'proxy-pki/ca.pem'));
  proxy = https.createServer({ key: await readFile(path.join(state, 'proxy-pki/proxy.key')), cert: await readFile(path.join(state, 'proxy-pki/proxy.pem')) }, (req, res) => {
    const upstream = http.request({ host: '127.0.0.1', port: appPort, method: req.method, path: req.url, headers: { ...req.headers, 'x-forwarded-proto': 'https', 'x-forwarded-host': req.headers.host } }, up => { res.writeHead(up.statusCode, up.headers); up.pipe(res); });
    upstream.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  const origin = `https://${PUBLIC_HOST}`;
  const request = (method, route, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port: proxy.address().port, servername: PUBLIC_HOST, ca, method, path: route, headers: { host: PUBLIC_HOST, ...headers } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end(body);
  });
  const api = (method, route, data, headers = {}) => request(method, route, { headers: { ...(data ? { 'content-type': 'application/json' } : {}), ...headers }, body: data ? JSON.stringify(data) : undefined });
  const asJson = response => JSON.parse(response.body.toString('utf8'));
  await assert.rejects(new Promise((resolve, reject) => https.get({ host: '127.0.0.1', port: proxy.address().port, servername: 'wrong.test', ca, headers: { host: 'wrong.test' } }, resolve).on('error', reject)), /altnames|hostname|certificate/i);
  assert.equal((await request('GET', '/widget.js')).status, 200);
  for (const route of ['/.env', '/package.json', '/dist/server.js', '/entrypoint.mjs', '/s3-bootstrap.mjs']) assert.equal((await request('GET', route)).status, 404, route);

  async function login() {
    const response = await api('POST', '/api/auth/login', { username: 'admin', password: adminPassword }, { origin });
    assert.equal(response.status, 200);
    const setCookie = [response.headers['set-cookie']].flat().join('\n');
    assert.match(setCookie, /;\s*Secure/i);
    assert.match(setCookie, /HttpOnly/i);
    return { cookie: setCookie.split(';')[0], 'x-csrf-token': asJson(response).csrfToken, origin };
  }
  assert.equal((await api('POST', '/api/auth/login', { username: 'admin', password: 'wrong-password-value' }, { origin })).status, 401);
  let admin = await login();
  assert.ok((await api('POST', '/api/projects', { name: 'x', clientLabel: 'x', origins: [] }, { ...admin, origin: 'https://evil.test' })).status >= 400, 'cross-site admin write must be refused');
  const clientOrigin = 'https://client.reviewdesk.test';
  let response = await api('POST', '/api/projects', { name: `Smoke autonome ${Date.now()}`, clientLabel: 'Docker', origins: [clientOrigin] }, admin);
  assert.equal(response.status, 201, response.body.toString());
  const project = asJson(response);
  response = await api('POST', `/api/projects/${project.id}/review-links`, {}, admin);
  assert.equal(response.status, 201);
  const { token } = asJson(response);
  const preflight = await request('OPTIONS', `/api/feedback?projectId=${project.id}`, { headers: { origin: clientOrigin, 'access-control-request-method': 'POST' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], clientOrigin);

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'capture.png');
  const multipart = new Request('http://multipart.invalid', { method: 'POST', body: form });
  const reviewer = { authorization: `Bearer ${token}`, origin: clientOrigin };
  response = await request('POST', `/api/uploads?projectId=${project.id}`, { headers: { ...reviewer, 'content-type': multipart.headers.get('content-type') }, body: Buffer.from(await multipart.arrayBuffer()) });
  assert.equal(response.status, 201, response.body.toString());
  const upload = asJson(response);
  response = await api('POST', '/api/feedback', { projectId: project.id, text: 'Smoke Docker autonome', pageUrl: `${clientOrigin}/`, anchor: { selector: '#hero', relative: { x: 0.5, y: 0.5 }, viewport: { width: 1200, height: 800 } }, screenshotId: upload.id }, reviewer);
  assert.equal(response.status, 201, response.body.toString());
  const ticket = asJson(response);

  async function verifyPersistence(label) {
    admin = await login();
    const tickets = asJson(await api('GET', '/api/tickets', undefined, admin));
    assert.ok(tickets.tickets.some(item => item.id === ticket.id && item.screenshotId === upload.id), `${label}: ticket`);
    const capture = await api('GET', `/api/uploads/${upload.id}`, undefined, admin);
    assert.equal(capture.status, 200, `${label}: capture`);
    assert.deepEqual(capture.body, png, `${label}: capture bytes`);
  }
  await verifyPersistence('initial');

  // 8. The stored capture is a private object: anonymous GET refused over verified TLS.
  const weed = command => compose(['exec', '-T', 's3-storage', 'sh', '-c', `echo "${command}" | weed shell -master=127.0.0.1:9333`], { allowFail: true });
  const listing = async () => (await weed(`fs.ls /buckets/${BUCKET}/uploads/`)).stdout.split(/\s+/).filter(name => name && !name.startsWith('>') && !/^(fs\.ls|exit)$/.test(name));
  const objects = (await listing()).filter(name => !name.includes('reviewdesk-startup-probe'));
  assert.ok(objects.length > 0, 'listing must see the stored capture (non-vacuous check)');
  const anonymousGet = await compose(['exec', '-T', 'app', 'node', '-e', `Promise.all(${JSON.stringify(objects.slice(0, 5))}.map(name => fetch('https://s3:8443/${BUCKET}/uploads/' + encodeURIComponent(name)).then(r => r.status))).then(s => console.log(s.join(' ')))`]);
  assert.match(anonymousGet.stdout.trim(), /^(403|401)( (403|401))*$/, 'anonymous object read must be refused');
  const anonymousList = await compose(['exec', '-T', 'app', 'node', '-e', `fetch('https://s3:8443/${BUCKET}?list-type=2').then(r => console.log(r.status))`]);
  assert.match(anonymousList.stdout, /^40[13]$/m);

  // 9. Restart, then recreate every container: database and objects survive (named volumes).
  await compose(['restart']);
  ps = await waitHealthy();
  await verifyPersistence('restart');
  // Each bundled S3 container restarted alone: the gateway reconnects to the socket per connection.
  for (const service of ['s3-storage', 's3']) {
    await compose(['restart', service]);
    let back = '';
    for (let i = 0; i < 60 && back !== '200'; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      back = (await compose(['exec', '-T', 'app', 'node', '-e', "fetch('https://s3:8443/healthz').then(r => console.log(r.status), e => console.log(e.cause?.code ?? e.name))"], { allowFail: true })).stdout.trim();
    }
    assert.equal(back, '200', `S3 reachable again after restarting ${service} alone`);
  }
  await verifyPersistence('s3 restart');
  await compose(['up', '-d', '--force-recreate']);
  ps = await waitHealthy();
  await verifyPersistence('recreate');
  assert.match((await compose(['logs', '--no-color', 's3-init'])).stdout, /existe/, 'bootstrap is idempotent on recreate');
  const dump = await compose(['exec', '-T', 'postgres', 'pg_dump', '-U', 'reviewdesk', '--schema-only', 'reviewdesk']);
  assert.match(dump.stdout, /CREATE TABLE/);

  // 10. Fail closed inside the container: HTTP endpoint, missing CA, unknown bucket.
  for (const [vars, message] of [[['S3_ENDPOINT=http://s3:8333'], /S3_ENDPOINT/], [['NODE_EXTRA_CA_CERTS='], /injoignable en HTTPS/], [['S3_BUCKET=reviewdesk-absent'], /introuvable|refusés/]]) {
    const result = await compose(['run', '--rm', '--no-deps', '-T', ...vars.flatMap(item => ['-e', item]), 'app'], { allowFail: true, timeout: 120_000 });
    assert.notEqual(result.code, 0, vars.join(' '));
    assert.match(result.stdout + result.stderr, message);
    assert.equal(leaks(result.stdout + result.stderr), 0, 'secret in start-up error');
  }

  // Both S3 identities are confined to the configured bucket: the init identity cannot create another one.
  const otherBucket = await compose(['run', '--rm', '--no-deps', '-T', '-e', 'S3_BUCKET=reviewdesk-other', 's3-init'], { allowFail: true, timeout: 120_000 });
  assert.notEqual(otherBucket.code, 0);
  assert.match(otherBucket.stdout + otherBucket.stderr, /refusé/);
  assert.equal(leaks(otherBucket.stdout + otherBucket.stderr), 0);

  // 11. A new install next to the existing volumes is refused and writes nothing.
  const fresh = path.join(scratch, 'fresh copy');
  await readZip(await readFile(zipPath), fresh);
  const freshRoot = path.join(fresh, 'reviewdesk-v8.0.0-docker');
  const refused = await run('sh', ['install.sh', '--non-interactive', '--port', '48394'], { cwd: freshRoot, env: installEnv, allowFail: true });
  assert.notEqual(refused.code, 0);
  assert.match(refused.stdout + refused.stderr, new RegExp(`${PROJECT}_(pgdata|s3data) existe`));
  assert.deepEqual(Object.values(await snapshot(freshRoot)).filter(Boolean), [], 'refused install wrote files');

  // 12. Start-up canaries are always deleted; no secret anywhere in the logs.
  assert.deepEqual((await listing()).filter(name => name.includes('reviewdesk-startup-probe')), [], 'start-up canary left in the bucket');
  const logs = await compose(['logs', '--no-color']);
  assert.equal(leaks(logs.stdout + logs.stderr), 0, 'secret in logs');
});
