import test from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { CREDENTIAL_REDACT_PATHS } from '../../src/app.js';
import { anchor, createProject, createReviewLink, createTestApp, loginAdmin } from '../helpers/harness.js';

function captureStream(): { stream: Writable; text: () => string } {
  const chunks: string[] = [];
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk));
        callback();
      },
    }),
    text: () => chunks.join(''),
  };
}

test('a server error logs enough to debug and no credential at all', async (t) => {
  const log = captureStream();
  // An unreachable object store makes the upload route throw for real.
  const app = await createTestApp(
    t,
    {
      STORAGE_DRIVER: 's3',
      S3_ENDPOINT: 'http://127.0.0.1:1',
      S3_BUCKET: 'unreachable',
      S3_ACCESS_KEY_ID: 'AKIA-LOG-TEST',
      S3_SECRET_ACCESS_KEY: 'super-secret-storage-key',
      LOG_LEVEL: 'trace',
    },
    { logStream: log.stream },
  );
  const auth = await loginAdmin(app);
  const project = await createProject(app, auth, {
    name: 'DEMO Logs',
    clientLabel: 'Client',
    origins: ['https://preview.test'],
  });
  const link = await createReviewLink(app, auth, project.id);

  const boundary = 'log-boundary';
  const response = await app.inject({
    method: 'POST',
    url: `/api/uploads?projectId=${project.id}`,
    headers: {
      authorization: `Bearer ${link.token}`,
      origin: 'https://preview.test',
      cookie: auth.cookie,
      'x-csrf-token': auth.csrfToken,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="c.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  });
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json(), { error: 'INTERNAL' }, 'the client is told nothing about the internals');

  const logged = log.text();
  assert.ok(logged.includes('request failed'), 'the failure is still recorded server-side');
  assert.equal(logged.includes(link.token), false, 'the reviewer secret never reaches a log line');
  assert.equal(logged.includes(auth.csrfToken), false, 'the CSRF token never reaches a log line');
  assert.equal(logged.includes(auth.cookie.split('=')[1]!), false, 'the session cookie never reaches a log line');
  assert.equal(logged.includes('super-secret-storage-key'), false, 'the storage secret never reaches a log line');
  assert.equal(logged.includes('AKIA-LOG-TEST'), false, 'the storage key id never reaches a log line');
});

test('a reviewer secret is not written to the logs on a successful submission', async (t) => {
  const log = captureStream();
  const app = await createTestApp(t, { LOG_LEVEL: 'trace' }, { logStream: log.stream });
  const auth = await loginAdmin(app);
  const project = await createProject(app, auth, {
    name: 'DEMO Logs OK',
    clientLabel: 'Client',
    origins: ['https://preview.test'],
  });
  const link = await createReviewLink(app, auth, project.id);
  const response = await app.inject({
    method: 'POST',
    url: '/api/feedback',
    headers: { authorization: `Bearer ${link.token}`, origin: 'https://preview.test' },
    payload: { projectId: project.id, text: 'Un retour', pageUrl: 'https://preview.test/page?token=leak', anchor },
  });
  assert.equal(response.statusCode, 201);
  assert.equal(log.text().includes(link.token), false);

  const stored = await app.reviewdesk.db.query<{ page_url: string }>('SELECT page_url FROM tickets');
  assert.equal(stored.rows[0]!.page_url, 'https://preview.test/page', 'the query string is dropped before storage');
});

test('redaction covers the nested header shapes plugins log, not only req.headers', () => {
  // @fastify/multipart logs the raw headers under `busboyOptions.headers` at
  // trace level; a `req.headers.*`-only redaction let credentials through there.
  for (const header of ['authorization', 'cookie', 'set-cookie', 'x-csrf-token']) {
    const accessor = header.includes('-') ? `["${header}"]` : `.${header}`;
    for (const prefix of ['req.headers', 'headers', '*.headers']) {
      assert.ok(CREDENTIAL_REDACT_PATHS.includes(`${prefix}${accessor}`), `${prefix}${accessor}`);
    }
  }
});
