// One-shot `s3-init` service (bundled S3 only): reads the init identity from the
// Compose secrets as root, drops to the unprivileged `node` user, then makes sure
// the private bucket exists over verified TLS (NODE_EXTRA_CA_CERTS) and refuses
// anonymous listing. Idempotent: an existing bucket is left untouched.
import { readFileSync } from 'node:fs';
import { anonymousProbeUrl, classifyAnonymousProbe, ensureBucket, prepareS3Env } from './runtime-config.mjs';

try {
  const env = prepareS3Env(process.env, name => readFileSync(`/run/secrets/${name}`, 'utf8'), { accessKeyId: 's3_admin_access_key_id', secretAccessKey: 's3_admin_secret_access_key' });
  if (process.getuid?.() === 0) {
    process.setgroups([]);
    process.setgid('node');
    process.setuid('node');
  }
  const status = async (url, init = {}) => {
    try {
      return (await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(15_000) })).status;
    } catch (error) {
      const cause = error.cause?.code ?? error.name;
      throw new Error(`S3 injoignable en HTTPS (${cause}). Vérifiez que le service s3 est démarré et que certs/ca.pem correspond à certs/s3.pem.`);
    }
  };
  const { signRequest } = await import('./dist/s3-signer.js');
  const result = await ensureBucket({ env, signRequest, status });
  classifyAnonymousProbe(await status(anonymousProbeUrl(env)));
  process.stdout.write(result === 'created'
    ? `ReviewDesk : bucket S3 privé ${env.S3_BUCKET} créé.\n`
    : `ReviewDesk : bucket S3 privé ${env.S3_BUCKET} existe déjà, inchangé.\n`);
} catch (error) {
  process.stderr.write(`ReviewDesk (initialisation S3) : ${error.message}\n`);
  process.exit(1);
}
