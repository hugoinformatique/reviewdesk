import test from 'node:test';
import assert from 'node:assert/strict';
import { accentTokens, contrastRatio, foregroundFor, normaliseHex, parseHex } from '../../src/brand-tokens.js';
import { normaliseBranding, DEFAULT_BRANDING } from '../../src/branding.js';

test('hex parsing accepts the shorthand and rejects anything that is not a colour', () => {
  assert.deepEqual(parseHex('#fff'), { r: 255, g: 255, b: 255 });
  assert.deepEqual(parseHex('4F46E5'), { r: 79, g: 70, b: 229 });
  assert.equal(normaliseHex('#4F46E5'), '#4f46e5');
  assert.equal(normaliseHex('#abc'), '#aabbcc');
  for (const bad of ['', 'red', '#12345', 'javascript:alert(1)', '#00ff0g']) {
    assert.equal(normaliseHex(bad), null, `${bad} should not parse`);
  }
});

/**
 * The whole point of deriving rather than storing: an agency picks one colour
 * and the text on top of it has to stay readable, including for the pale
 * choices that a lightness threshold alone gets wrong.
 */
test('the foreground on an accent is whichever of black or white actually contrasts', () => {
  assert.equal(foregroundFor(parseHex('#fde047')!), '#09090b', 'pale yellow takes black text');
  assert.equal(foregroundFor(parseHex('#4f46e5')!), '#ffffff', 'indigo takes white text');
  assert.equal(foregroundFor(parseHex('#18181b')!), '#ffffff', 'ink takes white text');
});

test('every derived accent clears AA against its own foreground', () => {
  const accents = ['#18181b', '#2563eb', '#4f46e5', '#0d9488', '#ea580c', '#e11d48', '#fde047', '#ffffff', '#000000'];
  for (const accent of accents) {
    const tokens = accentTokens(accent);
    const ratio = contrastRatio(parseHex(tokens.accent)!, parseHex(tokens.accentFg)!);
    assert.ok(ratio >= 4.5, `${accent}: contrast ${ratio.toFixed(2)} is below AA`);
  }
});

test('the accent used as text clears AA against both page backgrounds', () => {
  const white = parseHex('#ffffff')!;
  const nearBlack = parseHex('#0b0b0c')!;
  for (const accent of ['#fde047', '#18181b', '#ffffff', '#4f46e5', '#0d9488']) {
    const tokens = accentTokens(accent);
    assert.ok(
      contrastRatio(parseHex(tokens.accentOnLight)!, white) >= 4.5,
      `${accent}: accentOnLight is unreadable on white`,
    );
    assert.ok(
      contrastRatio(parseHex(tokens.accentOnDark)!, nearBlack) >= 4.5,
      `${accent}: accentOnDark is unreadable on the dark background`,
    );
  }
});

test('hover moves away from the mid-point instead of always darkening', () => {
  // A near-black accent has nowhere to go but lighter, and vice versa; a fixed
  // direction would make one of the two invert on hover.
  const dark = accentTokens('#18181b');
  const light = accentTokens('#fde047');
  assert.ok(parseHex(dark.accentHover)!.r < parseHex(dark.accent)!.r);
  assert.ok(parseHex(light.accentHover)!.r >= parseHex(light.accent)!.r);
});

test('a corrupt stored accent falls back rather than blanking the interface', () => {
  assert.equal(accentTokens('not-a-colour').accent, '#18181b');
  assert.equal(accentTokens('', '#2563eb').accent, '#2563eb');
});

test('branding read back from the database is repaired field by field', () => {
  const repaired = normaliseBranding({
    productName: 'Pixel Retours',
    accent: 'chartreuse',
    logoDataUri: 'data:text/html;base64,PHNjcmlwdD4=',
    publicUrl: 'javascript:alert(1)',
    emailFromAddress: 'not-an-email',
  });
  assert.equal(repaired.productName, 'Pixel Retours');
  assert.equal(repaired.accent, DEFAULT_BRANDING.accent, 'an unparseable accent falls back');
  assert.equal(repaired.logoDataUri, null, 'a non-image data URI is dropped');
  assert.equal(repaired.publicUrl, '', 'a non-http(s) URL is dropped');
  assert.equal(repaired.emailFromAddress, '', 'a malformed address is dropped');
  assert.equal(repaired.setupCompletedAt, null);
});

test('an empty settings row yields the stock identity', () => {
  assert.deepEqual(normaliseBranding(null), DEFAULT_BRANDING);
  assert.deepEqual(normaliseBranding(undefined), DEFAULT_BRANDING);
});
