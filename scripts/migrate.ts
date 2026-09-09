/**
 * Applies outstanding migrations and exits. Safe to run repeatedly and in
 * parallel with a live deployment; use it as a Vercel build step when you would
 * rather set RUN_MIGRATIONS_ON_BOOT=0.
 */
import { ConfigError, loadConfig } from '../src/config.js';
import { createDb } from '../src/db/index.js';
import { migrate } from '../src/db/migrate.js';

try {
  const config = loadConfig();
  const db = await createDb(config.database);
  try {
    const applied = await migrate(db);
    process.stdout.write(applied.length ? `applied: ${applied.join(', ')}\n` : 'already up to date\n');
  } finally {
    await db.close();
  }
} catch (error) {
  process.stderr.write(`${error instanceof ConfigError ? 'Configuration error' : 'Migration failed'}: ${(error as Error).message}\n`);
  process.exit(1);
}
