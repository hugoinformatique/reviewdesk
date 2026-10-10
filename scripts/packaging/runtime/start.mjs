import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireLock, assertNode22, parsePort, readConfig } from './kit.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
let release;
let app;
try {
  assertNode22();
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--port')) throw new Error('Usage : node start.mjs [--port 4300]');
  const config = await readConfig(root).catch(error => {
    if (error.code === 'ENOENT') throw new Error('Configuration absente. Lancez d’abord : node install.mjs');
    throw error;
  });
  const port = parsePort(args.length ? args[1] : config.port);
  release = await acquireLock(root);
  // Refuse deployment flags rather than overriding the application's production guards.
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL === '1') {
    throw new Error('Le kit local refuse NODE_ENV=production et VERCEL=1. Utilisez une configuration managée pour un déploiement.');
  }
  const { startLocal } = await import('./dist/local-server.js');
  app = await startLocal(root, config.adminPassword, port);
  let closing = false;
  const stop = async () => {
    if (closing) return;
    closing = true;
    try { await app.close(); await release(); } catch { process.exitCode = 1; }
    process.exit(process.exitCode || 0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  console.log(`ReviewDesk local : http://127.0.0.1:${port} — identifiant : admin — Ctrl+C pour arrêter.`);
} catch (error) {
  if (app) await app.close().catch(() => {});
  if (release) await release();
  if (error.code === 'ERR_MODULE_NOT_FOUND') console.error('Dépendances absentes. Lancez : node install.mjs');
  else if (error.code === 'EADDRINUSE') console.error('Port déjà utilisé. Essayez : node start.mjs --port 4301');
  else console.error(error.message);
  process.exitCode = 1;
}
