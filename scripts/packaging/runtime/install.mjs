import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireLock, assertNode22, configure, hiddenPassword, readConfig, runNpm, stdinPassword, validatePassword } from './kit.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
let release;
const cancellation = new AbortController();
let interrupted;
const cancel = signal => {
  if (interrupted) return;
  interrupted = signal;
  process.exitCode = signal === 'SIGINT' ? 130 : 143;
  cancellation.abort(new Error(`Installation annulée (${signal}).`));
};
const onInterrupt = () => cancel('SIGINT');
const onTerminate = () => cancel('SIGTERM');
try {
  assertNode22();
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(arg => !['--password-stdin', '--generate-password'].includes(arg))) {
    throw new Error('Usage : node install.mjs [--password-stdin | --generate-password]');
  }
  release = await acquireLock(root);
  let exists = false;
  try { await readConfig(root); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!exists) {
    let password;
    if (args.includes('--password-stdin')) password = await stdinPassword();
    else if (!args.includes('--generate-password')) {
      password = validatePassword(await hiddenPassword('Mot de passe admin (saisie masquée, 16 caractères minimum) : '));
      if (password !== await hiddenPassword('Confirmez le mot de passe : ')) throw new Error('Les mots de passe ne correspondent pas. Relancez install.mjs.');
    }
    await configure(root, { password, generate: args.includes('--generate-password') });
    console.log('Configuration enregistrée dans .reviewdesk/config.json. Gardez ce fichier privé.');
    if (args.includes('--generate-password')) console.log('Consultez ce fichier localement pour retrouver votre mot de passe généré.');
  } else console.log('Configuration existante conservée.');
  // Keep these handlers until the child has stopped and the lock is released.
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);
  await runNpm(['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], root, { signal: cancellation.signal });
  console.log('Installation terminée. Lancez : node start.mjs');
} catch (error) {
  console.error(error.message);
  process.exitCode = interrupted === 'SIGINT' ? 130 : interrupted === 'SIGTERM' ? 143 : 1;
} finally {
  try { if (release) await release(); } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
  }
}
