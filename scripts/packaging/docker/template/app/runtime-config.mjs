// Turns Compose environment + mounted secret files into the app environment.
// Pure functions: the entrypoint performs the I/O. Error messages name the
// offending setting, never its value.
import { randomUUID } from 'node:crypto';

export const SECRET_NAMES = ['admin_password', 'postgres_password', 's3_access_key_id', 's3_secret_access_key'];
export const CA_DIRECTORY = '/etc/reviewdesk/certs/';

const fail = message => { throw new Error(message); };

function secret(read, name) {
  let raw;
  try { raw = read(name); } catch { fail(`Secret manquant ou illisible : ${name} (relancez sh install.sh).`); }
  const value = String(raw).replace(/\r?\n$/, '');
  if (!value || /[\r\n\0]/.test(value) || value.length > 1024) fail(`Secret invalide : ${name} (une seule ligne non vide attendue).`);
  return value;
}

/** Accepts only `https://host[:port]`, exactly as typed: no path, query, credentials or trailing slash. */
export function assertHttpsEndpoint(value) {
  let url;
  try { url = new URL(value); } catch { fail('S3_ENDPOINT doit être une URL https://hôte[:port].'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.origin !== value) {
    fail('S3_ENDPOINT doit être exactement https://hôte[:port] (HTTP refusé, sans chemin, paramètres ni identifiants).');
  }
  return value;
}

export function assertBucket(value) {
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value ?? '') || value.includes('..')) fail('S3_BUCKET invalide (3 à 63 caractères a-z, 0-9, point, tiret).');
  return value;
}

export function prepareRuntimeEnv(env, readSecret) {
  const endpoint = assertHttpsEndpoint(env.S3_ENDPOINT ?? '');
  const bucket = assertBucket(env.S3_BUCKET);
  if (!/^[a-z0-9-]{1,32}$/.test(env.S3_REGION ?? '')) fail('S3_REGION invalide.');
  if (!['true', 'false'].includes(env.S3_FORCE_PATH_STYLE)) fail('S3_FORCE_PATH_STYLE doit valoir true ou false.');
  if (env.S3_KEY_PREFIX !== undefined && !/^[A-Za-z0-9._-]{1,64}$/.test(env.S3_KEY_PREFIX)) fail('S3_KEY_PREFIX invalide.');
  const ca = env.NODE_EXTRA_CA_CERTS ?? '';
  if (ca && (!ca.startsWith(CA_DIRECTORY) || ca.slice(CA_DIRECTORY.length).includes('/') || !/\.(pem|crt)$/.test(ca))) {
    fail(`NODE_EXTRA_CA_CERTS doit désigner un fichier .pem/.crt de ${CA_DIRECTORY}.`);
  }
  const values = Object.fromEntries(SECRET_NAMES.map(name => [name, secret(readSecret, name)]));
  return {
    ...env,
    NODE_ENV: 'production',
    STORAGE_DRIVER: 's3',
    S3_ENDPOINT: endpoint,
    S3_BUCKET: bucket,
    ADMIN_PASSWORD: values.admin_password,
    S3_ACCESS_KEY_ID: values.s3_access_key_id,
    S3_SECRET_ACCESS_KEY: values.s3_secret_access_key,
    // Internal Compose network only: PostgreSQL has no published port.
    DATABASE_URL: `postgres://reviewdesk:${encodeURIComponent(values.postgres_password)}@postgres:5432/reviewdesk?sslmode=disable`,
  };
}

/** URL of an unauthenticated ListObjectsV2 on the bucket, honouring the addressing style. */
export function anonymousProbeUrl(env) {
  const url = new URL(env.S3_ENDPOINT);
  if (env.S3_FORCE_PATH_STYLE === 'false') url.hostname = `${env.S3_BUCKET}.${url.hostname}`;
  else url.pathname = `/${env.S3_BUCKET}`;
  url.search = '?list-type=2&max-keys=1';
  return url.href;
}

/** A private bucket must explicitly refuse anonymous listing. Anything else stops the start-up. */
export function classifyAnonymousProbe(status) {
  if (status === 401 || status === 403) return 'private';
  if (status >= 200 && status < 300) fail('Le bucket S3 est lisible anonymement (public) : rendez-le privé avant de démarrer.');
  if (status === 404) fail('Bucket S3 introuvable : créez-le (privé) ou corrigez S3_BUCKET / S3_ENDPOINT.');
  fail(`Réponse S3 inattendue (${status}) à la vérification d'accès anonyme : vérifiez S3_ENDPOINT et S3_FORCE_PATH_STYLE.`);
}

/** Signed HeadBucket with the configured key: the bucket must exist and accept these credentials. */
export function classifyAuthenticatedProbe(status) {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 404) fail('Bucket S3 introuvable : créez-le (privé) ou corrigez S3_BUCKET / S3_ENDPOINT.');
  if (status === 401 || status === 403) fail('Identifiants S3 refusés pour ce bucket : vérifiez secrets/s3_access_key_id, secrets/s3_secret_access_key et S3_REGION.');
  fail(`Réponse S3 inattendue (${status}) à la vérification du bucket : vérifiez S3_ENDPOINT et S3_FORCE_PATH_STYLE.`);
}

const CANARY_BODY = Buffer.from('ReviewDesk : objet de test temporaire (vérification de confidentialité au démarrage), sans donnée.\n');

function failedCanaryDelete(key, detail) {
  return `L'objet de test ${key} n'a pas pu être supprimé (${detail}) : supprimez-le à la main et vérifiez la permission s3:DeleteObject.`;
}

/**
 * Listing denial does not prove that objects are private: writes a harmless random
 * object under the configured prefix, requires an explicit 401/403 to an anonymous
 * GET of it, and always deletes it. Proves nothing about ACLs set on other objects
 * nor about later policy changes.
 */
export async function verifyObjectPrivacy({ env, signRequest, status, id = randomUUID() }) {
  const config = s3SignerConfig(env);
  const key = `${config.keyPrefix}/.reviewdesk-startup-probe-${id}`;
  let problem;
  try {
    const put = signRequest({ config, method: 'PUT', key, payload: CANARY_BODY, contentType: 'text/plain; charset=utf-8' });
    const written = await status(put.url, { method: 'PUT', headers: put.headers, body: CANARY_BODY });
    if (written === 401 || written === 403) fail('Écriture S3 refusée pour ces identifiants : la permission s3:PutObject est requise sur le préfixe configuré.');
    if (written === 404) fail('Bucket S3 introuvable : créez-le (privé) ou corrigez S3_BUCKET / S3_ENDPOINT.');
    if (written < 200 || written >= 300) fail(`Réponse S3 inattendue (${written}) à l'écriture de l'objet de test.`);
    const anonymous = await status(put.url, { method: 'GET' });
    if (anonymous >= 200 && anonymous < 300) {
      fail('Les objets du bucket S3 sont lisibles anonymement (public) : retirez toute politique ou ACL de lecture publique et activez le blocage de l\'accès public du fournisseur avant de démarrer.');
    }
    if (anonymous !== 401 && anonymous !== 403) {
      fail(`Réponse S3 inattendue (${anonymous}) à la lecture anonyme de l'objet de test : seul un refus explicite (401/403) prouve que les objets sont privés.`);
    }
  } catch (error) {
    problem = error;
  }
  try {
    const del = signRequest({ config, method: 'DELETE', key, payload: Buffer.alloc(0) });
    const deleted = await status(del.url, { method: 'DELETE', headers: del.headers });
    if ((deleted < 200 || deleted >= 300) && deleted !== 404) throw new Error(failedCanaryDelete(key, `statut ${deleted}`));
  } catch (error) {
    const message = error.message.startsWith("L'objet de test") ? error.message : failedCanaryDelete(key, error.message);
    problem = new Error(problem ? `${problem.message} ${message}` : message);
  }
  if (problem) throw problem;
  return 'private';
}

export function s3SignerConfig(env) {
  return {
    driver: 's3',
    bucket: env.S3_BUCKET,
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE !== 'false',
    keyPrefix: env.S3_KEY_PREFIX || 'uploads',
  };
}
