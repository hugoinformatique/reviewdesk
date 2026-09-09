import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnchor, resolveAnchor } from '../../src/anchor.js';

const fake = { tagName: 'BUTTON', id: '', classList: ['cta', 'active'], parentPath: 'main:nth-of-type(1)', rect: { left: 10, top: 20, width: 200, height: 40 } };

test('anchor records stable selector, relative point and viewport', () => {
  const a = buildAnchor(fake, 110, 30, { width: 1280, height: 720 });
  assert.equal(a.selector, 'main:nth-of-type(1)>button.cta');
  assert.deepEqual(a.relative, { x: 0.5, y: 0.25 });
  assert.deepEqual(a.viewport, { width: 1280, height: 720 });
});

test('missing element is explicitly reported', () => {
  assert.deepEqual(resolveAnchor({ selector: '#gone', relative: { x: .5, y: .5 }, viewport: { width: 1, height: 1 } }, () => null), { found: false, reason: 'ANCHOR_MISSING' });
});
