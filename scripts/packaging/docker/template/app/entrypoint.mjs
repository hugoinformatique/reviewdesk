// Container entrypoint: reads Compose secrets as root, validates the
// configuration, checks over TLS that the bucket refuses anonymous listing and
// that a temporary canary object refuses anonymous reads, drops to the
// unprivileged `node` user, then starts the compiled server in this process.
import { readFileSync } from 'node:fs';
import { anonymousProbeUrl, classifyAnonymousProbe, classifyAuthenticatedProbe, prepareRuntimeEnv, s3SignerConfig, verifyObjectPrivacy } from './runtime-config.mjs';

try {
  const env = prepareRuntimeEnv(process.env, name => readFileSync(`/run/secrets/${name}`, 'utf8'));
  if (env.NODE_EXTRA_CA_CERTS && !readFileSync(env.NODE_EXTRA_CA_CERTS, 'utf8').includes('-----BEGIN CERTIFICATE-----')) {
    throw new Error('NODE_EXTRA_CA_CERTS ne contient aucun certificat PEM.');
  }
  const status = async (url, init = {}) => {
    try {
      return (await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(15_000) })).status;
    } catch (error) {
      const cause = error.cause?.code ?? error.name;
      throw new Error(`S3 injoignable en HTTPS (${cause}). Vérifiez S3_ENDPOINT, le DNS et, pour une autorité privée, NODE_EXTRA_CA_CERTS.`);
    }
  };
  const { signRequest } = await import('./dist/s3-signer.js');
  const signed = signRequest({ config: s3SignerConfig(env), method: 'HEAD', key: '', payload: Buffer.alloc(0) });
  classifyAuthenticatedProbe(await status(signed.url, { method: 'HEAD', headers: signed.headers }));
  classifyAnonymousProbe(await status(anonymousProbeUrl(env)));
  await verifyObjectPrivacy({ env, signRequest, status });
  Object.assign(process.env, env);
  if (process.getuid?.() === 0) {
    process.setgroups([]);
    process.setgid('node');
    process.setuid('node');
  }
  await import('./dist/server.js');
} catch (error) {
  process.stderr.write(`ReviewDesk : ${error.message}\n`);
  process.exit(1);
}
