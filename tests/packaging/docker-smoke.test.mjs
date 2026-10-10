// End-to-end smoke of the Docker self-host ZIP. Opt-in (REVIEWDESK_DOCKER_SMOKE=1)
// because it builds images and starts containers.
//
// Isolation rules: Compose project `reviewdesk-kit-docker-test` only, loopback
// high ports only, never `down -v` nor prune; named volumes are preserved and
// the matching config/PKI is kept in a state directory so a rerun reuses them.
// A test-only overlay adds SeaweedFS as a private HTTPS S3 behind a private CA,
// and this process plays the same-host TLS reverse proxy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { packageDocker } from '../../scripts/packaging/docker/package-docker.mjs';
import { readZip } from './docker-zip.mjs';

const exec = promisify(execFile);
const PROJECT = 'reviewdesk-kit-docker-test';
const PUBLIC_HOST = 'reviewdesk.test';
const S3_HOST = 's3.reviewdesk.test';
// Second SeaweedFS, tmpfs only: anonymous identity with `Read` but not `List`, i.e.
// anonymous listing denied while objects are publicly readable.
const PUBLIC_S3_HOST = 's3public.reviewdesk.test';
const BUCKET = 'reviewdesk-smoke';
const SEAWEED = 'chrislusf/seaweedfs@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d';
const state = process.env.REVIEWDESK_DOCKER_STATE || path.join(homedir(), '.cache', PROJECT);
const enabled = process.env.REVIEWDESK_DOCKER_SMOKE === '1';
const exists = file => stat(file).then(() => true, () => false);

async function freePort(port) {
  const server = createServer();
  server.listen(port, '127.0.0.1');
  try { await once(server, 'listening'); return server.address().port; } finally { server.close(); }
}

function run(command, args, { cwd, input, env, allowFail = false, timeout = 600_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], timeout });
    let stdout = '', stderr = '';
    child.stdout.on('data', c => { stdout += c; });
    child.stderr.on('data', c => { stderr += c; });
    child.stdin.end(input ?? '');
    child.once('error', reject);
    child.once('exit', code => (code === 0 || allowFail ? resolve({ code, stdout, stderr }) : reject(new Error(`${command} ${args.join(' ')} → ${code}\n${stderr.slice(-2000)}`))));
  });
}

async function pki(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const ssl = (...args) => exec('openssl', args, { cwd: dir });
  if (!(await exists(path.join(dir, 'ca.pem')))) await ssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650', '-subj', '/CN=ReviewDesk smoke test CA', '-keyout', 'ca.key', '-out', 'ca.pem', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign');
  for (const [name, san] of [['s3', `DNS:${S3_HOST}`], ['proxy', `DNS:${PUBLIC_HOST}`], ['s3public', `DNS:${PUBLIC_S3_HOST}`]]) {
    if (await exists(path.join(dir, `${name}.pem`))) continue;
    await ssl('req', '-newkey', 'rsa:2048', '-nodes', '-subj', `/CN=${san.slice(4)}`, '-keyout', `${name}.key`, '-out', `${name}.csr`);
    await writeFile(path.join(dir, `${name}.ext`), `subjectAltName=${san}\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n`);
    await ssl('x509', '-req', '-in', `${name}.csr`, '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-days', '3650', '-extfile', `${name}.ext`, '-out', `${name}.pem`);
  }
  // Test-only keys, read by the root SeaweedFS process through a bind mount.
  for (const name of ['s3', 's3public']) await chmod(path.join(dir, `${name}.key`), 0o644);
}

test('Docker ZIP: install.sh, compose build/up, HTTPS proxy, private HTTPS S3 with private CA, persistence', { skip: !enabled && 'set REVIEWDESK_DOCKER_SMOKE=1', timeout: 1_200_000 }, async t => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'kit docker été '));
  let proxy;
  const compose = (args, options) => run('docker', ['compose', '-p', PROJECT, '-f', 'compose.yaml', '-f', path.join(scratch, 'overlay.yaml'), ...args], { cwd: root, env: { COMPOSE_PROJECT_NAME: PROJECT }, ...options });
  t.after(async () => {
    proxy?.close();
    // One-off `compose run` containers of this test project only (a timeout skips --rm).
    const oneOff = await run('docker', ['ps', '-aq', '--filter', `label=com.docker.compose.project=${PROJECT}`, '--filter', 'label=com.docker.compose.oneoff=True'], { allowFail: true });
    const ids = oneOff.stdout.split(/\s+/).filter(Boolean);
    if (ids.length) await run('docker', ['rm', '-f', ...ids], { allowFail: true });
    if (process.env.REVIEWDESK_DOCKER_KEEP !== '1') await compose(['down'], { allowFail: true }).catch(() => {}); // never -v: volumes stay
    await rm(scratch, { recursive: true, force: true });
  });

  // 1. Package, verify, extract into a path with spaces and accents.
  const zipPath = await packageDocker(path.join(scratch, 'dist'));
  const root = path.join(scratch, 'srv', 'reviewdesk-v8.0.0-docker');
  await readZip(await readFile(zipPath), path.join(scratch, 'srv'));

  // 2. Private CA + SeaweedFS identities, kept across runs with the volumes.
  await mkdir(state, { recursive: true, mode: 0o700 });
  await pki(path.join(state, 'pki'));
  const seaweedConfig = path.join(state, 's3.json');
  if (!(await exists(seaweedConfig))) {
    const identity = { accessKey: `RDK${randomBytes(8).toString('hex').toUpperCase()}`, secretKey: randomBytes(24).toString('base64url') };
    await writeFile(seaweedConfig, JSON.stringify({ identities: [{ name: 'reviewdesk', credentials: [identity], actions: ['Admin', 'Read', 'Write', 'List', 'Tagging'] }] }), { mode: 0o644 });
  }
  const { identities: [{ credentials: [s3] }] } = JSON.parse(await readFile(seaweedConfig, 'utf8'));
  const publicConfig = path.join(scratch, 's3public.json');
  await writeFile(publicConfig, JSON.stringify({ identities: [{ name: 'reviewdesk', credentials: [s3], actions: ['Admin', 'Read', 'Write', 'List', 'Tagging'] }, { name: 'anonymous', actions: ['Read'] }] }), { mode: 0o644 });
  await cp(path.join(state, 'pki/ca.pem'), path.join(root, 'certs/ca.pem'));
  await writeFile(path.join(scratch, 'overlay.yaml'), `
services:
  s3:
    image: ${SEAWEED}
    command: ["server", "-dir=/data", "-ip=${S3_HOST}", "-ip.bind=0.0.0.0", "-s3", "-s3.port.https=8443", "-s3.config=/etc/rdk/s3.json", "-s3.cert.file=/etc/rdk/s3.pem", "-s3.key.file=/etc/rdk/s3.key"]
    volumes:
      - s3data:/data
      - ${seaweedConfig}:/etc/rdk/s3.json:ro
      - ${path.join(state, 'pki/s3.pem')}:/etc/rdk/s3.pem:ro
      - ${path.join(state, 'pki/s3.key')}:/etc/rdk/s3.key:ro
    networks:
      egress:
        aliases: [${S3_HOST}]
  s3public:
    image: ${SEAWEED}
    command: ["server", "-dir=/data", "-ip=${PUBLIC_S3_HOST}", "-ip.bind=0.0.0.0", "-s3", "-s3.port.https=8443", "-s3.config=/etc/rdk/s3.json", "-s3.cert.file=/etc/rdk/s3.pem", "-s3.key.file=/etc/rdk/s3.key"]
    tmpfs: [/data]
    volumes:
      - ${publicConfig}:/etc/rdk/s3.json:ro
      - ${path.join(state, 'pki/s3public.pem')}:/etc/rdk/s3.pem:ro
      - ${path.join(state, 'pki/s3public.key')}:/etc/rdk/s3.key:ro
    networks:
      egress:
        aliases: [${PUBLIC_S3_HOST}]
volumes:
  s3data: {}
`);

  // 3. Configuration: first run creates it, later runs restore it (upgrade path).
  const saved = path.join(state, 'kit-config');
  const installEnv = { PATH: '/usr/bin:/bin', COMPOSE_PROJECT_NAME: PROJECT };
  if (await exists(path.join(saved, '.env'))) {
    await cp(path.join(saved, '.env'), path.join(root, '.env'));
    await cp(path.join(saved, 'secrets'), path.join(root, 'secrets'), { recursive: true });
    await chmod(path.join(root, '.env'), 0o600);
    const kept = await run('sh', ['install.sh', '--non-interactive'], { cwd: root, env: installEnv, allowFail: true });
    assert.equal(kept.code, 0, kept.stdout + kept.stderr);
    assert.match(kept.stdout, /conserv/i);
  } else {
    const port = await freePort(48391);
    const created = await run('sh', ['install.sh', '--non-interactive', '--port', String(port), '--s3-endpoint', `https://${S3_HOST}:8443`, '--s3-bucket', BUCKET, '--s3-credentials-stdin', '--ca-file', 'ca.pem'], { cwd: root, env: installEnv, input: `S3_ACCESS_KEY_ID=${s3.accessKey}\nS3_SECRET_ACCESS_KEY=${s3.secretKey}\n`, allowFail: true });
    assert.equal(created.code, 0, created.stdout + created.stderr);
    for (const value of [s3.accessKey, s3.secretKey]) assert.ok(!(created.stdout + created.stderr).includes(value));
    await mkdir(saved, { recursive: true, mode: 0o700 });
    await cp(path.join(root, '.env'), path.join(saved, '.env'));
    await cp(path.join(root, 'secrets'), path.join(saved, 'secrets'), { recursive: true });
  }
  const appPort = Number((await readFile(path.join(root, '.env'), 'utf8')).match(/^REVIEWDESK_HTTP_PORT=(\d+)$/m)[1]);
  const secretValues = await Promise.all(['admin_password', 'postgres_password', 's3_secret_access_key'].map(name => readFile(path.join(root, 'secrets', name), 'utf8')));
  const [adminPassword] = secretValues;

  // 4. Compose config / build / up.
  const config = await compose(['config', '--format', 'json']);
  for (const value of secretValues) assert.ok(!config.stdout.includes(value), 'secret in compose config');
  const weed = (service, command) => compose(['exec', '-T', service, 'sh', '-c', `echo "${command}" | weed shell -master=localhost:9333`], { allowFail: true });
  const canaries = async service => {
    const listing = await weed(service, `fs.ls /buckets/${BUCKET}/uploads/`);
    const names = (listing.stdout + listing.stderr).split(/\s+/).filter(Boolean);
    return { names, probes: names.filter(name => name.includes('reviewdesk-startup-probe')) };
  };
  await compose(['up', '-d', '--wait', 's3', 's3public']);
  for (const service of ['s3', 's3public']) {
    for (let i = 0; ; i++) {
      const made = await weed(service, `s3.bucket.create -name ${BUCKET}`);
      const list = await weed(service, 's3.bucket.list');
      if (list.stdout.includes(BUCKET)) break;
      if (i > 30) throw new Error(`bucket creation failed on ${service}: ${made.stdout}${made.stderr}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  await compose(['build', 'app']);
  await compose(['up', '-d', '--wait', '--wait-timeout', '180']);

  // 5. Network exposure: app on loopback only, PostgreSQL and S3 unpublished.
  const ps = (await compose(['ps', '--format', 'json'])).stdout.trim().split('\n').map(line => JSON.parse(line));
  const published = Object.fromEntries(ps.map(item => [item.Service, (item.Publishers ?? []).filter(p => p.PublishedPort)]));
  assert.deepEqual(published.postgres, []);
  assert.deepEqual(published.s3, []);
  assert.deepEqual(published.app.map(p => [p.URL, p.PublishedPort, p.TargetPort]), [['127.0.0.1', appPort, 4300]]);
  const uid = await compose(['exec', '-T', 'app', 'sh', '-c', 'grep ^Uid: /proc/1/status']);
  assert.match(uid.stdout, /^Uid:\s+1000\s+1000/);
  const inspect = await run('docker', ['inspect', ps.find(item => item.Service === 'app').ID]);
  for (const value of secretValues) assert.ok(!inspect.stdout.includes(value), 'secret in container metadata');
  const health = await fetch(`http://127.0.0.1:${appPort}/health`).then(r => r.json());
  assert.deepEqual([health.ok, health.database, health.storage], [true, 'postgresql', `s3 ${BUCKET} @ ${S3_HOST}:8443`]);

  // 6. Same-host TLS reverse proxy with a real hostname check on the client side.
  const ca = await readFile(path.join(state, 'pki/ca.pem'));
  proxy = https.createServer({ key: await readFile(path.join(state, 'pki/proxy.key')), cert: await readFile(path.join(state, 'pki/proxy.pem')) }, (req, res) => {
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
  for (const route of ['/.env', '/package.json', '/dist/server.js', '/entrypoint.mjs']) assert.equal((await request('GET', route)).status, 404, route);

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
  let response = await api('POST', '/api/projects', { name: `Smoke ${Date.now()}`, clientLabel: 'Docker', origins: [clientOrigin] }, admin);
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
  response = await api('POST', '/api/feedback', { projectId: project.id, text: 'Smoke Docker', pageUrl: `${clientOrigin}/`, anchor: { selector: '#hero', relative: { x: 0.5, y: 0.5 }, viewport: { width: 1200, height: 800 } }, screenshotId: upload.id }, reviewer);
  assert.equal(response.status, 201, response.body.toString());
  const ticket = asJson(response);

  async function verifyPersistence() {
    admin = await login();
    const tickets = asJson(await api('GET', '/api/tickets', undefined, admin));
    assert.ok(tickets.tickets.some(item => item.id === ticket.id && item.screenshotId === upload.id));
    const capture = await api('GET', `/api/uploads/${upload.id}`, undefined, admin);
    assert.equal(capture.status, 200);
    assert.deepEqual(capture.body, png);
  }
  await verifyPersistence();

  // 7. Restart: database (volume) and S3 objects survive.
  await compose(['restart', 'app', 'postgres']);
  await compose(['up', '-d', '--wait', '--wait-timeout', '180']);
  await verifyPersistence();
  const dump = await compose(['exec', '-T', 'postgres', 'pg_dump', '-U', 'reviewdesk', '--schema-only', 'reviewdesk']);
  assert.match(dump.stdout, /CREATE TABLE/);

  // 8. Fail closed inside the container: HTTP endpoint, missing private CA, unknown bucket.
  for (const [env, message] of [[['S3_ENDPOINT=http://s3.reviewdesk.test:8333'], /S3_ENDPOINT/], [['NODE_EXTRA_CA_CERTS='], /injoignable en HTTPS/], [['S3_BUCKET=reviewdesk-absent'], /introuvable/]]) {
    const result = await compose(['run', '--rm', '--no-deps', '-T', ...env.flatMap(item => ['-e', item]), 'app'], { allowFail: true, timeout: 120_000 });
    assert.notEqual(result.code, 0, env.join(' '));
    assert.match(result.stdout + result.stderr, message);
  }

  // 9. Object privacy canary. Every start above wrote then deleted one: none may remain.
  const privateListing = await canaries('s3');
  assert.ok(privateListing.names.length > 0, 'listing must see the stored capture (non-vacuous check)');
  assert.deepEqual(privateListing.probes, [], 'start-up canary left in the private bucket');
  // Anonymous listing denied but objects publicly readable: start-up must refuse,
  // and the canary must still be deleted.
  const anonymousList = await compose(['exec', '-T', 'app', 'node', '-e', `fetch('https://${PUBLIC_S3_HOST}:8443/${BUCKET}?list-type=2').then(r => console.log(r.status))`]);
  assert.match(anonymousList.stdout, /^40[13]$/m, 'precondition: anonymous listing is denied on the public-read store');
  const publicRun = await compose(['run', '--rm', '--no-deps', '-T', '-e', `S3_ENDPOINT=https://${PUBLIC_S3_HOST}:8443`, 'app'], { allowFail: true, timeout: 120_000 });
  assert.notEqual(publicRun.code, 0, 'public-read bucket must stop the start-up');
  assert.match(publicRun.stdout + publicRun.stderr, /lisibles anonymement/);
  assert.deepEqual((await canaries('s3public')).probes, [], 'canary left in the public-read bucket');
  for (const value of secretValues) assert.ok(!(publicRun.stdout + publicRun.stderr).includes(value), 'secret in start-up error');

  const logs = await compose(['logs', '--no-color']);
  for (const value of secretValues) assert.ok(!logs.stdout.includes(value) && !logs.stderr.includes(value), 'secret in logs');
});
