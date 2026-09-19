import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestApp, loginAdmin } from '../helpers/harness.js';

/** A 1x1 transparent PNG, small enough to inline as a logo. */
const LOGO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const draft = {
  productName: 'Pixel Retours',
  tagline: 'Vos clients annotent, votre équipe livre.',
  logoDataUri: null as string | null,
  accent: '#4f46e5',
  publicUrl: 'https://retours.pixel.fr',
  emailFromName: 'Support Pixel',
  emailFromAddress: 'support@pixel.fr',
  emailReplyTo: '',
};

test('a fresh instance reports the stock identity and an incomplete setup', async (t) => {
  const app = await createTestApp(t);
  const response = await app.inject({ method: 'GET', url: '/api/branding' });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.productName, 'ReviewDesk');
  assert.equal(body.setupComplete, false, 'the wizard has to open on a first run');
  assert.equal(body.tokens.accentFg, '#ffffff');
});

test('public branding is readable without a session but hides the operator’s addresses', async (t) => {
  const app = await createTestApp(t);
  const auth = await loginAdmin(app);
  const saved = await app.inject({
    method: 'PUT',
    url: '/api/branding',
    headers: auth.write,
    payload: { ...draft, completeSetup: true },
  });
  assert.equal(saved.statusCode, 200, saved.body);

  const anonymous = await app.inject({ method: 'GET', url: '/api/branding' });
  assert.equal(anonymous.statusCode, 200, 'the sign-in screen is branded before anyone signs in');
  const body = anonymous.json();
  assert.equal(body.productName, 'Pixel Retours');
  assert.equal(body.setupComplete, true);
  assert.equal(body.tokens.accent, '#4f46e5');
  assert.ok(!('emailFromAddress' in body), 'the sender identity must stay behind auth');
  assert.ok(!('publicUrl' in body), 'the configured domain must stay behind auth');

  const settings = await app.inject({ method: 'GET', url: '/api/branding/settings', headers: auth.read });
  assert.equal(settings.statusCode, 200);
  assert.equal(settings.json().emailFromAddress, 'support@pixel.fr');
});

test('reading the full settings requires a session, writing requires CSRF', async (t) => {
  const app = await createTestApp(t);
  const auth = await loginAdmin(app);

  assert.equal((await app.inject({ method: 'GET', url: '/api/branding/settings' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'PUT', url: '/api/branding', payload: draft })).statusCode, 401);

  const noCsrf = await app.inject({
    method: 'PUT',
    url: '/api/branding',
    headers: { cookie: auth.cookie },
    payload: draft,
  });
  assert.equal(noCsrf.statusCode, 403, 'a session cookie alone must never be enough to rebrand the instance');
});

test('invalid branding is refused rather than stored', async (t) => {
  const app = await createTestApp(t);
  const auth = await loginAdmin(app);
  const reject = async (payload: Record<string, unknown>, why: string) => {
    const response = await app.inject({ method: 'PUT', url: '/api/branding', headers: auth.write, payload });
    assert.equal(response.statusCode, 400, `${why}: ${response.body}`);
  };
  await reject({ ...draft, accent: 'chartreuse' }, 'an accent that is not a hex colour');
  await reject({ ...draft, productName: '' }, 'an empty product name');
  await reject({ ...draft, publicUrl: 'javascript:alert(1)' }, 'a non-http(s) public URL');
  await reject({ ...draft, emailFromAddress: 'not-an-email' }, 'a malformed sender address');
  // An SVG is allowed because it is only ever rendered through <img>, where it
  // cannot execute; anything that is not an image is not.
  await reject({ ...draft, logoDataUri: 'data:text/html;base64,PHNjcmlwdD4=' }, 'a non-image data URI');
});

test('a logo round-trips and the accent is normalised on the way in', async (t) => {
  const app = await createTestApp(t);
  const auth = await loginAdmin(app);
  const saved = await app.inject({
    method: 'PUT',
    url: '/api/branding',
    headers: auth.write,
    payload: { ...draft, logoDataUri: LOGO, accent: '#4F46E5', completeSetup: true },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().accent, '#4f46e5');

  const published = (await app.inject({ method: 'GET', url: '/api/branding' })).json();
  assert.equal(published.logoDataUri, LOGO);
});

test('reopening the wizard never un-completes the setup', async (t) => {
  const app = await createTestApp(t);
  const auth = await loginAdmin(app);
  const put = (payload: Record<string, unknown>) =>
    app.inject({ method: 'PUT', url: '/api/branding', headers: auth.write, payload });

  const first = await put({ ...draft, completeSetup: true });
  const completedAt = first.json().setupCompletedAt as string;
  assert.ok(completedAt, 'finishing the wizard stamps the instance as configured');

  // What the « Personnalisation » entry sends: a plain edit, no completion flag.
  const second = await put({ ...draft, accent: '#0d9488' });
  assert.equal(second.json().setupCompletedAt, completedAt, 'the stamp is write-once');
  assert.equal(second.json().accent, '#0d9488');
  assert.equal((await app.inject({ method: 'GET', url: '/api/branding' })).json().setupComplete, true);
});
