import { buildApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';

try {
  const config = loadConfig();
  const app = await buildApp(config);
  await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 4300) });
} catch (error) {
  if (error instanceof ConfigError) {
    process.stderr.write(`Configuration error: ${error.message}\n`);
    process.exit(1);
  }
  throw error;
}
