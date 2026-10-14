/**
 * Builds the React admin (admin/, vite.config.ts) for the root of the site.
 *
 * Always into a fresh directory, then handed over: as a file list to the
 * packagers, or copied into public/ (index.html + assets/) for the dev server,
 * Vercel and `npm run build`. Hashed asset names change on every build, so
 * public/assets/ is replaced, never merged: no stale chunk is left behind.
 */
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function walk(directory, prefix = '') {
  const files = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) files.push(...(await walk(path.join(directory, entry.name), `${name}/`)));
    else if (entry.isFile()) files.push({ name, data: await readFile(path.join(directory, entry.name)) });
  }
  return files;
}

/** Returns the built files, relative to the site root (index.html, assets/…). */
export async function buildAdmin() {
  const { build } = await import('vite');
  const outDir = await mkdtemp(path.join(tmpdir(), 'reviewdesk-admin-'));
  try {
    await build({
      configFile: path.join(repository, 'vite.config.ts'),
      base: '/',
      logLevel: 'warn',
      build: { outDir, emptyOutDir: true },
    });
    return await walk(outDir);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}

/** Builds and replaces public/index.html and public/assets/. */
export async function buildAdminIntoPublic() {
  const files = await buildAdmin();
  const publicDir = path.join(repository, 'public');
  await rm(path.join(publicDir, 'assets'), { recursive: true, force: true });
  const staging = await mkdtemp(path.join(tmpdir(), 'reviewdesk-admin-copy-'));
  try {
    const { mkdir, writeFile } = await import('node:fs/promises');
    for (const file of files) {
      const target = path.join(staging, file.name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.data);
    }
    await cp(staging, publicDir, { recursive: true });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return files.map((file) => file.name);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const names = await buildAdminIntoPublic();
  console.log(`admin : ${names.length} fichiers dans public/ (${names.filter((name) => name.endsWith('.js')).length} scripts)`);
}
