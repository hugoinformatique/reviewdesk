import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { assertNode22 } from './runtime/kit.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const forbidden = /(^|\/)(?:\.[^/]*|src|node_modules|data|uploads|logs|secrets?)(\/|$)|\.(?:ts|tsx|map|log|sqlite|db|pem|key)$/i;
function safeName(name) {
  if (!name || name.startsWith('/') || name.includes('\\') || name.includes(':') || /\p{C}/u.test(name) || name.split('/').some(part => !part || part === '..') || forbidden.test(name)) {
    throw new Error(`Chemin interdit dans le kit : ${name}`);
  }
}

export async function collectAssets(directory, prefix = '') {
  const result = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
    const name = prefix + entry.name;
    safeName(name);
    if (entry.isSymbolicLink()) throw new Error(`Lien symbolique interdit : ${name}`);
    if (entry.isDirectory()) result.push(...await collectAssets(path.join(directory, entry.name), `${name}/`));
    else {
      if (!entry.isFile() || !(/\.(?:html|css|js|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|txt)$/i.test(name) || /^integrations\/[\w-]+\.zip$/.test(name)) || /(?:^|\/)(?:secret|credentials?)(?:[.-]|$)/i.test(name)) {
        throw new Error(`Asset public interdit : ${name}`);
      }
      result.push({ name, data: await readFile(path.join(directory, entry.name)) });
    }
  }
  return result;
}

/**
 * Build outputs that land in public/ during development. A package rebuilds
 * them from source instead, so whatever a local build left there (an older
 * hashed chunk, a stale widget) never ships.
 */
const GENERATED_PUBLIC = new Set(['index.html', 'assets', 'widget.js']);

/** The hand-written files of the repository's public/, without build outputs. */
export async function collectSourceAssets(directory) {
  return (await collectAssets(directory)).filter((asset) => !GENERATED_PUBLIC.has(asset.name.split('/')[0]));
}

export function validateRuntimeManifest(manifest, lock) {
  if (manifest.name !== 'reviewdesk-local' || !/^\d+\.\d+\.\d+$/.test(manifest.version ?? '') || manifest.license !== 'MIT' || !manifest.private || manifest.type !== 'module' || manifest.engines?.node !== '22.x' || manifest.devDependencies || !manifest.dependencies?.['@electric-sql/pglite']) {
    throw new Error('Manifeste runtime invalide.');
  }
  if (lock.lockfileVersion !== 3 || lock.name !== manifest.name || lock.version !== manifest.version || JSON.stringify(lock.packages[''].dependencies) !== JSON.stringify(manifest.dependencies)) throw new Error('Lock runtime incohérent.');
  for (const [name, version] of Object.entries(manifest.dependencies)) {
    if (!/^\d+\.\d+\.\d+$/.test(version) || lock.packages[`node_modules/${name}`]?.version !== version) throw new Error(`Dépendance non verrouillée : ${name}`);
  }
  for (const [name, item] of Object.entries(lock.packages)) {
    if (!name) continue;
    if (item.dev || item.link || !item.integrity || !item.resolved?.startsWith('https://registry.npmjs.org/')) throw new Error(`Entrée runtime invalide : ${name}`);
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Small deterministic ZIP32 writer: UTF-8 names, DEFLATE, fixed timestamps, no external zip utility. */
export function createZip(entries) {
  const local = [], central = [], seen = new Set();
  let offset = 0;
  if (entries.length > 65535) throw new Error('ZIP32 : trop de fichiers.');
  for (const { name, data } of [...entries].sort((a, b) => a.name < b.name ? -1 : 1)) {
    safeName(name);
    if (seen.has(name)) throw new Error(`Fichier en double : ${name}`);
    seen.add(name);
    const filename = Buffer.from(name, 'utf8');
    const body = Buffer.from(data);
    const compressed = deflateRawSync(body, { level: 9 });
    if (filename.length > 65535 || body.length > 0xffffffff || offset + compressed.length > 0xffffffff) throw new Error('Limite ZIP32 dépassée.');
    const crc = crc32(body);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(33, 12); // 1980-01-01, 00:00:00
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(body.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, compressed);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    header.copy(record, 6, 4, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, filename);
    offset += header.length + filename.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

export async function packageKit(outputDirectory) {
  assertNode22();
  const app = JSON.parse(await readFile(path.join(repository, 'package.json'), 'utf8'));
  const runtime = path.join(repository, 'scripts/packaging/runtime');
  const manifest = JSON.parse(await readFile(path.join(runtime, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(path.join(runtime, 'package-lock.json'), 'utf8'));
  validateRuntimeManifest(manifest, lock);
  if (app.version !== manifest.version) throw new Error('Versions application/kit incohérentes.');
  const appLock = JSON.parse(await readFile(path.join(repository, 'package-lock.json'), 'utf8'));
  for (const name of [...Object.keys(app.dependencies), '@electric-sql/pglite']) {
    if (manifest.dependencies[name] !== appLock.packages[`node_modules/${name}`]?.version) throw new Error(`Synchronisez le lock runtime : ${name}`);
  }
  const staging = await mkdtemp(path.join(tmpdir(), 'reviewdesk-package-'));
  try {
    await mkdir(path.join(staging, 'public'), { recursive: true });
    // Rebuilt here so a kit never ships a stale or missing plugin archive. A
    // child process, not an import: that script imports this module back.
    execFileSync(process.execPath, [path.join(repository, 'scripts/build-integrations.mjs')], { stdio: 'ignore' });
    for (const asset of await collectSourceAssets(path.join(repository, 'public'))) {
      const target = path.join(staging, 'public', asset.name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, asset.data);
    }
    const { build } = await import('esbuild');
    const base = { absWorkingDir: repository, bundle: true, sourcemap: false, logLevel: 'info' };
    await build({ ...base, entryPoints: ['src/widget/index.ts'], format: 'iife', globalName: 'ReviewDesk', outfile: path.join(staging, 'public/widget.js') });
    // The React admin, built fresh: index.html and its hashed assets/.
    const { buildAdmin } = await import('../build-admin.mjs');
    for (const file of await buildAdmin()) {
      const target = path.join(staging, 'public', file.name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.data);
    }
    for (const [entry, name] of [['src/server.ts', 'server'], ['src/mcp/server.ts', 'mcp'], ['scripts/packaging/local-server.ts', 'local-server']]) {
      await build({ ...base, entryPoints: [entry], platform: 'node', format: 'esm', packages: 'external', outfile: path.join(staging, `dist/${name}.js`), ...(name === 'mcp' ? { banner: { js: '#!/usr/bin/env node' } } : {}) });
    }
    const entries = [];
    const include = async (source, name) => {
      if (!(await lstat(source)).isFile()) throw new Error(`Fichier régulier requis : ${name}`);
      entries.push({ name, data: await readFile(source) });
    };
    for (const name of ['install.mjs', 'start.mjs', 'kit.mjs', 'package.json', 'package-lock.json']) await include(path.join(runtime, name), name);
    await include(path.join(repository, 'docs/KIT-LOCAL.md'), 'GUIDE-FR.md');
    await include(path.join(repository, 'scripts/packaging/NOTICE.txt'), 'NOTICE.txt');
    for (const name of ['server', 'mcp', 'local-server']) await include(path.join(staging, `dist/${name}.js`), `dist/${name}.js`);
    for (const asset of await collectAssets(path.join(staging, 'public'))) entries.push({ name: `public/${asset.name}`, data: asset.data });
    const name = `reviewdesk-v${manifest.version}-local`;
    const archive = createZip(entries.map(entry => ({ ...entry, name: `${name}/${entry.name}` })));
    await mkdir(outputDirectory, { recursive: true });
    const zipPath = path.join(outputDirectory, `${name}.zip`);
    const checksum = createHash('sha256').update(archive).digest('hex');
    await writeFile(zipPath, archive);
    await writeFile(`${zipPath}.sha256`, `${checksum}  ${name}.zip\n`);
    console.log(`ZIP : ${zipPath}\nSHA-256 : ${zipPath}.sha256\n${entries.length} fichiers, ${archive.length} octets`);
    return zipPath;
  } finally { await rm(staging, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--output') throw new Error('Usage : node scripts/packaging/package-kit.mjs --output <dossier>');
    await packageKit(path.resolve(args[1]));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
