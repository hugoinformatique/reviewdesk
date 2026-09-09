import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { StorageConfig } from '../config.js';
import type { ObjectStore, StoredObject } from './index.js';

type FilesystemConfig = Extract<StorageConfig, { driver: 'filesystem' }>;

/**
 * Local disk store for development and tests only. `loadConfig` refuses
 * `STORAGE_DRIVER=filesystem` in production, and this guard repeats it: a
 * serverless filesystem is ephemeral and per-instance, so uploads written here
 * would silently disappear.
 */
export async function createFilesystemStore(config: FilesystemConfig): Promise<ObjectStore> {
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL === '1') {
    throw new Error('The filesystem object store is not available in production');
  }
  const root = path.resolve(config.directory);
  await mkdir(root, { recursive: true });

  const resolve = (key: string): string => {
    const target = path.resolve(root, key);
    // Keys are server-generated, but never let one escape the root anyway.
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error('invalid storage key');
    return target;
  };

  return {
    description: `filesystem ${root}`,
    async put(key, body, contentType) {
      const target = resolve(key);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, body, { flag: 'wx' });
      await writeFile(`${target}.type`, contentType, 'utf8');
    },
    async get(key): Promise<StoredObject | null> {
      const target = resolve(key);
      try {
        const body = await readFile(target);
        const contentType = await readFile(`${target}.type`, 'utf8').catch(() => undefined);
        return { body, contentType };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async delete(key) {
      const target = resolve(key);
      await rm(target, { force: true });
      await rm(`${target}.type`, { force: true });
    },
  };
}
