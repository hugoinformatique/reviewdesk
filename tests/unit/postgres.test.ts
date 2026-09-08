import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { X509Certificate } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { postgresTransport } from '../../src/db/postgres.js';
import { SUPABASE_ROOT_CA_2021 } from '../../src/db/supabase-ca.js';

const base = { driver: 'postgres' as const, poolMax: 1, statementTimeoutMs: 8_000 };


test('bundled Supabase CA has the published fingerprint', () => {
  assert.equal(
    new X509Certificate(SUPABASE_ROOT_CA_2021).fingerprint256,
    '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA',
  );
});

test('Supabase transport pins its official CA and verifies certificates', () => {
  const transport = postgresTransport({
    ...base,
    url: 'postgresql://actor:credential@aws-0-eu-west-3.pooler.supabase.com:6543/postgres?sslmode=require',
    ssl: true,
  });
  assert.equal(new URL(transport.connectionString).searchParams.has('sslmode'), false);
  assert.equal(typeof transport.ssl, 'object');
  assert.equal(typeof transport.ssl === 'object' && transport.ssl.rejectUnauthorized, true);
  assert.match(typeof transport.ssl === 'object' ? String(transport.ssl.ca) : '', /BEGIN CERTIFICATE/);
});

test('generic PostgreSQL keeps verified TLS without the Supabase CA', () => {
  const transport = postgresTransport({ ...base, url: 'postgres://actor:credential@db.example.test/app', ssl: true });
  assert.deepEqual(transport.ssl, { rejectUnauthorized: true });
});

test('URL SSL overrides cannot weaken the verified transport', () => {
  const transport = postgresTransport({
    ...base,
    url: 'postgres://actor:***@db.example.test/app?sslmode=verify-full&ssl=no-verify',
    ssl: true,
  });
  const parameters = (new pg.Client(transport) as unknown as { connectionParameters: { ssl: pg.ConnectionConfig['ssl'] } })
    .connectionParameters;
  assert.equal(new URL(transport.connectionString).searchParams.has('ssl'), false);
  assert.equal(typeof parameters.ssl === 'object' && parameters.ssl?.rejectUnauthorized, true);
});

test('generic PostgreSQL preserves an explicit private CA while enforcing verification', () => {
  const directory = mkdtempSync(join(tmpdir(), 'reviewdesk-pg-ca-'));
  const caPath = join(directory, 'private-ca.pem');
  try {
    writeFileSync(caPath, SUPABASE_ROOT_CA_2021);
    const url = `postgres://actor:****@db.example.test/app?sslmode=verify-full&sslrootcert=${encodeURIComponent(caPath)}&sslnegotiation=direct`;
    const transport = postgresTransport({ ...base, url, ssl: true });
    const parsedUrl = new URL(transport.connectionString);
    const parameters = (new pg.Client(transport) as unknown as { connectionParameters: { ssl: pg.ConnectionConfig['ssl'] } })
      .connectionParameters;
    assert.equal(parsedUrl.searchParams.has('sslrootcert'), false);
    assert.equal(parsedUrl.searchParams.has('sslnegotiation'), false);
    assert.equal(typeof transport.ssl === 'object' ? transport.ssl.ca : undefined, SUPABASE_ROOT_CA_2021);
    assert.equal(typeof parameters.ssl === 'object' ? parameters.ssl?.ca : undefined, SUPABASE_ROOT_CA_2021);
    assert.equal(typeof parameters.ssl === 'object' && parameters.ssl?.rejectUnauthorized, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('an explicitly local non-TLS connection remains non-TLS', () => {
  const url = 'postgres://actor:credential@127.0.0.1:5432/app?sslmode=disable';
  assert.deepEqual(postgresTransport({ ...base, url, ssl: false }), { connectionString: url, ssl: false });
});
