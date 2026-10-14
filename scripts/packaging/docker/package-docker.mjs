import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildWordPressPlugin } from '../../build-integrations.mjs';
import { collectAssets, createZip } from '../package-kit.mjs';
import { assertNode22 } from '../runtime/kit.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const template = path.join(repository, 'scripts/packaging/docker/template');
const NAME = 'reviewdesk-docker';
const REGISTRY = 'https://registry.npmjs.org/';

/** Production manifest: the app's runtime dependencies at their exact locked versions. */
export function buildDockerManifest(app, appLock) {
  const dependencies = {};
  for (const name of Object.keys(app.dependencies).sort()) {
    const version = appLock.packages[`node_modules/${name}`]?.version;
    if (!version) throw new Error(`Dépendance absente du lock applicatif : ${name}`);
    dependencies[name] = version;
  }
  return { name: NAME, version: app.version, private: true, license: 'UNLICENSED', type: 'module', engines: { node: '22.x' }, dependencies };
}

function resolveFrom(packages, from, name) {
  for (let base = from; ; base = base.includes('/node_modules/') ? base.slice(0, base.lastIndexOf('/node_modules/')) : '') {
    const key = `${base ? `${base}/` : ''}node_modules/${name}`;
    if (packages[key]) return key;
    if (!base) return undefined;
  }
}

/**
 * Derives the production lock from the verified runtime lock: same resolved
 * tarballs and integrities, minus PGlite and anything only it pulled in.
 * Pure and order-independent, so the output is byte-for-byte reproducible.
 */
export function deriveProductionLock(source, manifest) {
  if (source.lockfileVersion !== 3) throw new Error('Lock source : lockfileVersion 3 attendu.');
  const rootDependencies = source.packages['']?.dependencies ?? {};
  for (const [name, version] of Object.entries(manifest.dependencies)) {
    if (rootDependencies[name] !== version) throw new Error(`Synchronisez le lock runtime : ${name}`);
  }
  const reached = new Set();
  const queue = Object.keys(manifest.dependencies).map(name => ['', name, false]);
  while (queue.length) {
    const [from, name, optional] = queue.shift();
    const key = resolveFrom(source.packages, from, name);
    if (!key) {
      if (optional) continue;
      throw new Error(`Lock source incomplet : ${name} (depuis ${from || 'la racine'})`);
    }
    if (reached.has(key)) continue;
    reached.add(key);
    const item = source.packages[key];
    for (const dep of Object.keys(item.dependencies ?? {})) queue.push([key, dep, false]);
    for (const dep of Object.keys(item.optionalDependencies ?? {})) queue.push([key, dep, true]);
    for (const dep of Object.keys(item.peerDependencies ?? {})) queue.push([key, dep, Boolean(item.peerDependenciesMeta?.[dep]?.optional)]);
  }
  const packages = { '': { name: manifest.name, version: manifest.version, license: manifest.license, dependencies: { ...manifest.dependencies }, engines: { ...manifest.engines } } };
  for (const key of [...reached].sort()) packages[key] = JSON.parse(JSON.stringify(source.packages[key]));
  return { name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true, packages };
}

export function validateDockerManifest(manifest, lock) {
  if (manifest.name !== NAME || manifest.license !== 'UNLICENSED' || manifest.private !== true || manifest.type !== 'module' || manifest.engines?.node !== '22.x' || manifest.devDependencies || manifest.scripts) {
    throw new Error('Manifeste Docker invalide.');
  }
  if (/pglite/i.test(JSON.stringify(manifest)) || /pglite/i.test(JSON.stringify(lock))) throw new Error('PGlite ne doit pas figurer dans la distribution Docker.');
  if (lock.lockfileVersion !== 3 || lock.name !== manifest.name || lock.version !== manifest.version || JSON.stringify(lock.packages['']?.dependencies) !== JSON.stringify(manifest.dependencies)) {
    throw new Error('Lock Docker incohérent avec le manifeste.');
  }
  for (const [name, version] of Object.entries(manifest.dependencies)) {
    if (!/^\d+\.\d+\.\d+$/.test(version) || lock.packages[`node_modules/${name}`]?.version !== version) throw new Error(`Dépendance non verrouillée : ${name}`);
  }
  for (const [name, item] of Object.entries(lock.packages)) {
    if (!name) continue;
    if (item.dev || item.link || !item.integrity || !item.resolved?.startsWith(REGISTRY)) throw new Error(`Entrée de lock invalide : ${name}`);
  }
}

const json = async file => JSON.parse(await readFile(file, 'utf8'));

export async function packageDocker(outputDirectory) {
  assertNode22();
  const app = await json(path.join(repository, 'package.json'));
  const manifest = buildDockerManifest(app, await json(path.join(repository, 'package-lock.json')));
  const lock = deriveProductionLock(await json(path.join(repository, 'scripts/packaging/runtime/package-lock.json')), manifest);
  validateDockerManifest(manifest, lock);
  const staging = await mkdtemp(path.join(tmpdir(), 'reviewdesk-docker-package-'));
  try {
    const { build } = await import('esbuild');
    const base = { absWorkingDir: repository, bundle: true, sourcemap: false, logLevel: 'warning' };
    await build({ ...base, entryPoints: ['src/widget/index.ts'], format: 'iife', globalName: 'ReviewDesk', outfile: path.join(staging, 'widget.js') });
    await build({ ...base, entryPoints: ['src/admin/app.ts'], format: 'iife', outfile: path.join(staging, 'admin.js') });
    await build({ ...base, entryPoints: ['src/server.ts'], platform: 'node', format: 'esm', packages: 'external', outfile: path.join(staging, 'server.js') });
    await build({ ...base, entryPoints: ['src/mcp/server.ts'], platform: 'node', format: 'esm', packages: 'external', banner: { js: '#!/usr/bin/env node' }, outfile: path.join(staging, 'mcp.js') });
    await build({ ...base, entryPoints: ['scripts/packaging/docker/s3-signer.ts'], platform: 'node', format: 'esm', outfile: path.join(staging, 's3-signer.js') });
    const entries = new Map();
    const include = async (source, name) => {
      if (!(await lstat(source)).isFile()) throw new Error(`Fichier régulier requis : ${name}`);
      entries.set(name, await readFile(source));
    };
    for (const name of ['compose.yaml', 'install.sh', 'certs/LISEZMOI.txt', 's3/entrypoint.sh', 'app/Dockerfile', 'app/entrypoint.mjs', 'app/runtime-config.mjs', 'app/s3-bootstrap.mjs', 'app/s3-gateway.mjs']) await include(path.join(template, name), name);
    await include(path.join(repository, 'docs/GUIDE-DOCKER-FR.md'), 'GUIDE-DOCKER-FR.md');
    await include(path.join(repository, 'scripts/packaging/docker/NOTICE.txt'), 'NOTICE.txt');
    entries.set('app/package.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
    entries.set('app/package-lock.json', Buffer.from(`${JSON.stringify(lock, null, 2)}\n`));
    await buildWordPressPlugin();
    for (const asset of await collectAssets(path.join(repository, 'public'))) entries.set(`app/public/${asset.name}`, asset.data);
    for (const name of ['widget', 'admin']) await include(path.join(staging, `${name}.js`), `app/public/${name}.js`);
    for (const name of ['server', 'mcp', 's3-signer']) await include(path.join(staging, `${name}.js`), `app/dist/${name}.js`);
    const root = `reviewdesk-v${manifest.version}-docker`;
    const archive = createZip([...entries].map(([name, data]) => ({ name: `${root}/${name}`, data })));
    await mkdir(outputDirectory, { recursive: true });
    const zipPath = path.join(outputDirectory, `${root}.zip`);
    const checksum = createHash('sha256').update(archive).digest('hex');
    await writeFile(zipPath, archive);
    await writeFile(`${zipPath}.sha256`, `${checksum}  ${root}.zip\n`);
    console.log(`ZIP : ${zipPath}\nSHA-256 : ${checksum}\n${entries.size} fichiers, ${archive.length} octets`);
    return zipPath;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--output') throw new Error('Usage : node scripts/packaging/docker/package-docker.mjs --output <dossier>');
    await packageDocker(path.resolve(args[1]));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
