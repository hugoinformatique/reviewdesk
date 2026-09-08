/**
 * Single place where environment turns into a validated configuration.
 *
 * Two deployment shapes are supported and they are kept explicitly apart:
 *  - managed: `DATABASE_URL=postgres://…` + `STORAGE_DRIVER=s3`. The only shape
 *    allowed when running on Vercel or with NODE_ENV=production.
 *  - local dev/test: `DATABASE_URL=pglite://…` + `STORAGE_DRIVER=filesystem`.
 *    Both refuse to start in production, and PGlite is a devDependency so it is
 *    not even installed in a production build.
 */

export type DatabaseConfig =
  | { driver: 'postgres'; url: string; poolMax: number; ssl: boolean; statementTimeoutMs: number }
  | { driver: 'pglite'; path: string };

export type StorageConfig =
  | {
      driver: 's3';
      bucket: string;
      endpoint: string;
      region: string;
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken?: string;
      forcePathStyle: boolean;
      keyPrefix: string;
    }
  | { driver: 'filesystem'; directory: string };

export type AppConfig = {
  production: boolean;
  adminPassword: string;
  database: DatabaseConfig;
  storage: StorageConfig;
  /** Serve `public/` from Fastify. Off on Vercel, where the CDN owns static files. */
  serveStatic: boolean;
  secureCookies: boolean;
  sessionTtlSeconds: number;
  uploadMaxBytes: number;
  submissionsPerMinute: number;
  loginAttemptsPerMinute: number;
  runMigrationsOnBoot: boolean;
  logLevel: string;
};

export class ConfigError extends Error {}

const MIN_ADMIN_PASSWORD_LENGTH = 16;
/** Vercel caps a serverless request body at 4.5 MB; stay safely under it. */
const DEFAULT_UPLOAD_MAX_BYTES = 4_000_000;

type Env = Record<string, string | undefined>;

function required(env: Env, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new ConfigError(`${key} is required`);
  return value;
}

function integer(env: Env, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${key} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function boolean(env: Env, key: string, fallback: boolean): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new ConfigError(`${key} must be a boolean`);
}

/**
 * The admin password is the only human credential in the product, so it is held
 * to a real bar rather than a length check alone.
 */
export function assertStrongAdminPassword(password: string): void {
  if (password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    throw new ConfigError(`ADMIN_PASSWORD must contain at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`);
  }
  if (/^(.)\1*$/.test(password)) throw new ConfigError('ADMIN_PASSWORD must not be a single repeated character');
  if (new Set(password).size < 8) throw new ConfigError('ADMIN_PASSWORD must contain at least 8 distinct characters');
  const weak = ['password', 'admin', 'reviewdesk', 'changeme', 'letmein', 'secret', '12345678', 'qwerty'];
  const normalized = password.toLowerCase();
  if (weak.some((word) => normalized.includes(word))) {
    throw new ConfigError('ADMIN_PASSWORD must not contain a common word such as "password" or "admin"');
  }
}

function databaseConfig(env: Env, production: boolean): DatabaseConfig {
  // Vercel's Supabase integration exposes POSTGRES_URL. Prefer an explicit
  // DATABASE_URL, then fall back to the managed integration URL.
  const url = env.DATABASE_URL?.trim() || env.POSTGRES_URL?.trim();
  if (!url) throw new ConfigError('DATABASE_URL or POSTGRES_URL is required');
  if (url.startsWith('pglite://')) {
    if (production) {
      throw new ConfigError('DATABASE_URL=pglite:// is a local development driver and is refused in production; use postgres://');
    }
    const path = url.slice('pglite://'.length);
    if (!path) throw new ConfigError('DATABASE_URL=pglite:// requires a path or "memory"');
    return { driver: 'pglite', path };
  }
  if (!url.startsWith('postgres://') && !url.startsWith('postgresql://')) {
    throw new ConfigError('DATABASE_URL must start with postgres://, postgresql:// or pglite://');
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ConfigError('DATABASE_URL is not a valid URL');
  }
  const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  const sslMode = parsed.searchParams.get('sslmode');
  const ssl = boolean(env, 'DATABASE_SSL', sslMode ? sslMode !== 'disable' : !local);
  return {
    driver: 'postgres',
    url,
    // One connection per serverless invocation by default: a warm Lambda holds a
    // single socket, so N concurrent invocations cost N connections, not N*max.
    poolMax: integer(env, 'DATABASE_POOL_MAX', 1, 1, 20),
    ssl,
    statementTimeoutMs: integer(env, 'DATABASE_STATEMENT_TIMEOUT_MS', 8_000, 500, 60_000),
  };
}

function storageConfig(env: Env, production: boolean): StorageConfig {
  const driver = (env.STORAGE_DRIVER?.trim() || (production ? 's3' : 'filesystem')).toLowerCase();
  if (driver === 'filesystem') {
    if (production) {
      throw new ConfigError('STORAGE_DRIVER=filesystem is a local development driver and is refused in production; use s3');
    }
    return { driver: 'filesystem', directory: env.UPLOAD_DIR?.trim() || '.data/uploads' };
  }
  if (driver !== 's3') throw new ConfigError('STORAGE_DRIVER must be "s3" or "filesystem"');
  const endpoint = required(env, 'S3_ENDPOINT');
  if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
    throw new ConfigError('S3_ENDPOINT must be an absolute http(s) URL');
  }
  if (production && endpoint.startsWith('http://')) {
    throw new ConfigError('S3_ENDPOINT must use https in production');
  }
  const keyPrefix = (env.S3_KEY_PREFIX?.trim() || 'uploads').replace(/^\/+|\/+$/g, '');
  return {
    driver: 's3',
    bucket: required(env, 'S3_BUCKET'),
    endpoint: endpoint.replace(/\/+$/, ''),
    region: env.S3_REGION?.trim() || 'auto',
    accessKeyId: required(env, 'S3_ACCESS_KEY_ID'),
    secretAccessKey: required(env, 'S3_SECRET_ACCESS_KEY'),
    ...(env.S3_SESSION_TOKEN?.trim() ? { sessionToken: env.S3_SESSION_TOKEN.trim() } : {}),
    // Cloudflare R2 and MinIO both accept path style; S3 itself accepts it too.
    forcePathStyle: boolean(env, 'S3_FORCE_PATH_STYLE', true),
    keyPrefix,
  };
}

export function loadConfig(env: Env = process.env): AppConfig {
  const production = env.NODE_ENV === 'production' || env.VERCEL === '1';
  const adminPassword = required(env, 'ADMIN_PASSWORD');
  assertStrongAdminPassword(adminPassword);
  const uploadMaxBytes = integer(env, 'UPLOAD_MAX_BYTES', DEFAULT_UPLOAD_MAX_BYTES, 1_000, 4_400_000);
  return {
    production,
    adminPassword,
    database: databaseConfig(env, production),
    storage: storageConfig(env, production),
    serveStatic: boolean(env, 'SERVE_STATIC', env.VERCEL !== '1'),
    secureCookies: boolean(env, 'SECURE_COOKIES', production),
    sessionTtlSeconds: integer(env, 'SESSION_TTL_SECONDS', 8 * 3600, 300, 30 * 24 * 3600),
    uploadMaxBytes,
    submissionsPerMinute: integer(env, 'SUBMISSIONS_PER_MINUTE', 20, 1, 1_000),
    loginAttemptsPerMinute: integer(env, 'LOGIN_ATTEMPTS_PER_MINUTE', 10, 1, 1_000),
    runMigrationsOnBoot: boolean(env, 'RUN_MIGRATIONS_ON_BOOT', true),
    logLevel: env.LOG_LEVEL?.trim() || (production ? 'warn' : 'error'),
  };
}
