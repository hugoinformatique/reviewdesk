import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { VERSION } from '../../src/version.js';

test('the version reported by the server is the one in package.json', async () => {
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(VERSION, pkg.version);
});
