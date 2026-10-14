import { randomBytes } from 'node:crypto';
import { access, chmod, lstat, mkdir, open, readFile, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { emitKeypressEvents } from 'node:readline';

export function assertNode22(version = process.versions.node) {
  if (version.split('.')[0] !== '22') throw new Error('Node.js 22.x est requis (avec npm).');
}

export function parsePort(value) {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error('Le port doit être un entier entre 1 et 65535.');
  }
  return Number(value);
}

// Keep aligned with src/config.ts; the packaged server validates again before listening.
export function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 16 || value.length > 400 || value.trim() !== value || /\p{C}/u.test(value)) {
    throw new Error('Le mot de passe doit contenir 16 à 400 caractères, sans caractères de contrôle ni espaces aux extrémités.');
  }
  if (new Set(value).size < 8 || /password|admin|reviewdesk|changeme|letmein|secret|12345678|qwerty/i.test(value)) {
    throw new Error('Le mot de passe doit comporter au moins 8 caractères distincts, sans mot courant interdit (voir GUIDE).');
  }
  return value;
}

async function safeDirectory(root) {
  const directory = path.join(root, '.reviewdesk');
  await mkdir(directory, { mode: 0o700, recursive: true });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Le dossier .reviewdesk ne doit pas être un lien symbolique.');
  if (process.platform !== 'win32') await chmod(directory, 0o700);
  return directory;
}

export async function readConfig(root) {
  const file = path.join(await safeDirectory(root), 'config.json');
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('La configuration ne doit pas être un lien symbolique.');
  if (info.size > 4096) throw new Error('Fichier de configuration invalide.');
  let config;
  try {
    config = JSON.parse(await readFile(file, 'utf8'));
    if (!config || config.version !== 1) throw new Error();
    validatePassword(config.adminPassword);
    parsePort(config.port);
  } catch {
    throw new Error('Configuration invalide : corrigez .reviewdesk/config.json (voir GUIDE). Elle ne sera pas écrasée.');
  }
  if (process.platform !== 'win32') await chmod(file, 0o600);
  return config;
}

export async function configure(root, { password, generate = false } = {}) {
  try { return await readConfig(root); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (generate) {
    do { password = randomBytes(32).toString('base64url'); } while (/password|admin|reviewdesk|changeme|letmein|secret|12345678|qwerty/i.test(password));
  }
  if (password === undefined) throw new Error('Premier lancement : choisissez un mot de passe dans un terminal, ou utilisez --password-stdin / --generate-password (voir GUIDE).');
  const config = { version: 1, adminPassword: validatePassword(password), port: 4300 };
  const file = path.join(await safeDirectory(root), 'config.json');
  const handle = await open(file, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(config, null, 2)}\n`, 'utf8');
    await handle.sync();
  } catch (error) {
    await unlink(file).catch(() => {});
    throw error;
  } finally { await handle.close(); }
  return config;
}

export async function acquireLock(root) {
  const file = path.join(await safeDirectory(root), 'operation.lock');
  let handle;
  try { handle = await open(file, 'wx', 0o600); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new Error('Une installation ou un serveur est déjà en cours, ou un verrou subsiste après interruption. Voir GUIDE : .reviewdesk/operation.lock.');
  }
  try { await handle.writeFile(`${JSON.stringify({ pid: process.pid })}\n`); } finally { await handle.close(); }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await unlink(file);
  };
}

// Run npm's JavaScript entry with Node, avoiding cmd.exe/sh quoting and npm.cmd on Windows.
export function npmCliCandidates(nodePath, env, platform = process.platform) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const bin = p.dirname(nodePath);
  const candidates = [env.npm_execpath, p.join(bin, 'node_modules/npm/bin/npm-cli.js'), p.resolve(bin, '../lib/node_modules/npm/bin/npm-cli.js')];
  const searchPath = env.PATH || env.Path || '';
  for (const directory of searchPath.split(platform === 'win32' ? ';' : ':').filter(Boolean)) {
    candidates.push(p.join(directory, 'node_modules/npm/bin/npm-cli.js'), p.resolve(directory, '../lib/node_modules/npm/bin/npm-cli.js'));
    if (platform !== 'win32') candidates.push(p.join(directory, 'npm'));
  }
  return candidates.filter(Boolean);
}

export async function runNpm(args, cwd, { signal } = {}) {
  signal?.throwIfAborted();
  let cli;
  for (const candidate of npmCliCandidates(process.execPath, process.env)) {
    try {
      const resolved = await realpath(candidate);
      if (!resolved.endsWith(`${path.sep}npm-cli.js`)) continue;
      await access(resolved);
      cli = resolved;
      break;
    } catch { /* Try the next installation layout. */ }
  }
  signal?.throwIfAborted();
  if (!cli) throw new Error('npm introuvable. Installez Node.js 22 avec npm, puis relancez.');
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, stdio: 'inherit', shell: false });
    let forceKill;
    let spawnError;
    const cancel = () => {
      child.kill('SIGTERM');
      // npm must stop writing node_modules before the installation lock is freed.
      forceKill = setTimeout(() => child.kill('SIGKILL'), 2000);
    };
    signal?.addEventListener('abort', cancel, { once: true });
    child.once('error', error => { spawnError = error; });
    child.once('close', (code, childSignal) => {
      clearTimeout(forceKill);
      signal?.removeEventListener('abort', cancel);
      if (signal?.aborted) reject(signal.reason);
      else if (spawnError) reject(spawnError);
      else if (code === 0) resolve();
      else reject(new Error(`npm a échoué (${childSignal || code}). Vérifiez la connexion et relancez install.mjs.`));
    });
  });
}

export async function stdinPassword(input = process.stdin) {
  let value = '';
  input.setEncoding('utf8');
  for await (const chunk of input) {
    value += chunk;
    if (value.length > 4096) throw new Error('Entrée de mot de passe trop longue.');
  }
  // Accept one line with optional LF or CRLF; never silently trim a password.
  return validatePassword(value.replace(/\r?\n$/, ''));
}

export async function hiddenPassword(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Un terminal interactif est requis, ou utilisez --password-stdin / --generate-password.');
  const input = process.stdin;
  const wasRaw = input.isRaw;
  emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error) => {
      input.removeListener('keypress', onKey);
      input.setRawMode(wasRaw);
      input.pause();
      process.stdout.write('\n');
      if (error) reject(error); else resolve(value);
    };
    const onKey = (text, key = {}) => {
      if (key.ctrl && (key.name === 'c' || key.name === 'd')) return finish(new Error('Configuration annulée.'));
      if (key.name === 'return' || key.name === 'enter') return finish();
      if (key.name === 'backspace') { value = [...value].slice(0, -1).join(''); return; }
      if (text && !key.ctrl && !key.meta && !/\p{C}/u.test(text) && value.length < 401) value += text;
    };
    input.on('keypress', onKey);
    // Publish the prompt only after echo is disabled and the handler is ready.
    // A fast paste (or a terminal controller) can otherwise expose the password.
    process.stdout.write(prompt);
  });
}
