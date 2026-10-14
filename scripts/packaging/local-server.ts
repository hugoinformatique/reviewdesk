/** Packaging adapter: no change to the application or its managed deployment. */
import path from 'node:path';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';

export async function startLocal(root: string, adminPassword: string, port: number) {
  const config = loadConfig({
    NODE_ENV: 'development',
    ADMIN_PASSWORD: adminPassword,
    DATABASE_URL: `pglite://${path.join(root, '.reviewdesk', 'database')}`,
    STORAGE_DRIVER: 'filesystem',
    UPLOAD_DIR: path.join(root, '.reviewdesk', 'uploads'),
    SERVE_STATIC: 'true',
    SECURE_COOKIES: 'false',
    RUN_MIGRATIONS_ON_BOOT: 'true',
    LOG_LEVEL: 'error',
  });
  const app = await buildApp(config);
  try {
    await app.listen({ host: '127.0.0.1', port });
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
