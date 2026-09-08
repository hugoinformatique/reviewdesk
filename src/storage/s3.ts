import { createHash, createHmac } from 'node:crypto';
import type { StorageConfig } from '../config.js';
import { StorageError, type ObjectStore, type StoredObject } from './index.js';

type S3Config = Extract<StorageConfig, { driver: 's3' }>;

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';
const REQUEST_TIMEOUT_MS = 20_000;

const sha256Hex = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data, 'utf8').digest();

/** RFC 3986 encoding: `encodeURIComponent` leaves !'()* alone, S3 does not. */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodeKeyPath(key: string): string {
  return key.split('/').map(encodeRfc3986).join('/');
}

function amzTimestamps(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

export type SignedRequest = { url: string; headers: Record<string, string> };

/**
 * AWS Signature Version 4 for the three operations this product needs
 * (PutObject / GetObject / DeleteObject). Exported so the request construction
 * is unit-testable; the signature itself is verified end-to-end against MinIO,
 * which recomputes it and rejects any mismatch.
 */
export function signRequest(options: {
  config: S3Config;
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  key: string;
  payload: Buffer;
  contentType?: string;
  now?: Date;
}): SignedRequest {
  const { config, method, key, payload } = options;
  const endpoint = new URL(config.endpoint);
  const bucketPath = encodeRfc3986(config.bucket);
  const keyPath = encodeKeyPath(key);

  let host: string;
  let canonicalUri: string;
  if (config.forcePathStyle) {
    host = endpoint.host;
    canonicalUri = `${endpoint.pathname.replace(/\/+$/, '')}/${bucketPath}/${keyPath}`;
  } else {
    host = `${config.bucket}.${endpoint.host}`;
    canonicalUri = `${endpoint.pathname.replace(/\/+$/, '')}/${keyPath}`;
  }
  if (!canonicalUri.startsWith('/')) canonicalUri = `/${canonicalUri}`;

  const { amzDate, dateStamp } = amzTimestamps(options.now ?? new Date());
  const payloadHash = sha256Hex(payload);
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (config.sessionToken) headers['x-amz-security-token'] = config.sessionToken;
  if (options.contentType) headers['content-type'] = options.contentType;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]!.trim()}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');
  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const scope = `${dateStamp}/${config.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, dateStamp), config.region), SERVICE), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  headers.authorization = `${ALGORITHM} Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url: `${endpoint.protocol}//${host}${canonicalUri}`, headers };
}

async function shortErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    // S3 error bodies are XML and never echo credentials, but stay conservative.
    const code = /<Code>([^<]{0,64})<\/Code>/.exec(text)?.[1];
    return code ?? text.slice(0, 200);
  } catch {
    return '';
  }
}

export function createS3Store(config: S3Config): ObjectStore {
  const prefixed = (key: string) => (config.keyPrefix ? `${config.keyPrefix}/${key}` : key);

  async function send(
    method: 'GET' | 'PUT' | 'DELETE',
    key: string,
    payload: Buffer,
    contentType?: string,
  ): Promise<Response> {
    const signed = signRequest({ config, method, key: prefixed(key), payload, contentType });
    const init: RequestInit = {
      method,
      headers: signed.headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
    if (method === 'PUT') init.body = new Uint8Array(payload);
    try {
      return await fetch(signed.url, init);
    } catch (cause) {
      throw new StorageError(`object store request failed: ${method} ${key}`, undefined, { cause } as ErrorOptions);
    }
  }

  return {
    description: `s3 ${config.bucket} @ ${new URL(config.endpoint).host}`,
    async put(key, body, contentType) {
      const response = await send('PUT', key, body, contentType);
      if (!response.ok) {
        throw new StorageError(`object store rejected PUT (${response.status} ${await shortErrorBody(response)})`, response.status);
      }
      await response.arrayBuffer();
    },
    async get(key): Promise<StoredObject | null> {
      const response = await send('GET', key, Buffer.alloc(0));
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new StorageError(`object store rejected GET (${response.status} ${await shortErrorBody(response)})`, response.status);
      }
      return {
        body: Buffer.from(await response.arrayBuffer()),
        contentType: response.headers.get('content-type') ?? undefined,
      };
    },
    async delete(key) {
      const response = await send('DELETE', key, Buffer.alloc(0));
      if (!response.ok && response.status !== 404) {
        throw new StorageError(`object store rejected DELETE (${response.status} ${await shortErrorBody(response)})`, response.status);
      }
      await response.arrayBuffer();
    },
  };
}
