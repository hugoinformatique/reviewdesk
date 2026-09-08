import type { StorageConfig } from '../config.js';

export type StoredObject = { body: Buffer; contentType: string | undefined };

export interface ObjectStore {
  /** Human-readable target, safe to log: never contains credentials. */
  readonly description: string;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

export class StorageError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number, options?: ErrorOptions) {
    super(message, options);
    this.status = status;
  }
}

export async function createObjectStore(config: StorageConfig): Promise<ObjectStore> {
  if (config.driver === 's3') {
    const { createS3Store } = await import('./s3.js');
    return createS3Store(config);
  }
  const { createFilesystemStore } = await import('./filesystem.js');
  return createFilesystemStore(config);
}
