import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

/** Reads a ZIP32 archive independently of the writer; optionally extracts it. */
export async function readZip(zip, destination) {
  const end = zip.length - 22;
  assert.equal(zip.readUInt32LE(end), 0x06054b50);
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(offset), 0x02014b50);
    assert.equal(zip.readUInt16LE(offset + 10), 8);
    const size = zip.readUInt32LE(offset + 20);
    const length = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 46, offset + 46 + length).toString('utf8');
    assert.ok(!name.split('/').includes('..') && !path.isAbsolute(name) && !name.includes('\\'), name);
    assert.ok(!entries.has(name), name);
    const local = zip.readUInt32LE(offset + 42);
    assert.equal(zip.readUInt32LE(local), 0x04034b50);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = inflateRawSync(zip.subarray(start, start + size));
    assert.equal(data.length, zip.readUInt32LE(offset + 24));
    entries.set(name, data);
    if (destination) {
      const file = path.join(destination, name);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, data);
    }
    offset += 46 + length + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32);
  }
  assert.equal(offset, end);
  return entries;
}
