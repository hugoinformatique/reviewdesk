/**
 * Zips the WordPress plugin into public/integrations/, where the admin links
 * to it. The archive holds one folder, as WordPress expects of an upload.
 * Deterministic: same sources, same bytes.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createZip } from './packaging/package-kit.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(repository, 'integrations/wordpress/reviewdesk');
export const wordpressZip = path.join(repository, 'public/integrations/reviewdesk-wordpress.zip');

export async function buildWordPressPlugin() {
  const entries = [];
  for (const name of (await readdir(source)).sort()) {
    entries.push({ name: `reviewdesk/${name}`, data: await readFile(path.join(source, name)) });
  }
  await mkdir(path.dirname(wordpressZip), { recursive: true });
  await writeFile(wordpressZip, createZip(entries));
  return wordpressZip;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(path.relative(repository, await buildWordPressPlugin()));
}
