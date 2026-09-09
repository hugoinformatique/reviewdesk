import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../src/config.js';
import { createDb, type Db } from '../../src/db/index.js';
import { MIGRATIONS, migrate } from '../../src/db/migrate.js';
import { testEnv, usingRealPostgres } from '../helpers/harness.js';

async function connect(extra: Record<string, string> = {}): Promise<Db> {
  return createDb(loadConfig(testEnv(extra)).database);
}

test('migrations are idempotent and record what they applied', async (t) => {
  const db = await connect();
  t.after(() => db.close());

  await migrate(db);
  const applied = await db.query<{ id: string }>('SELECT id FROM schema_migrations ORDER BY id');
  assert.deepEqual(
    applied.rows.map((row) => row.id),
    MIGRATIONS.map((migration) => migration.id),
  );

  assert.deepEqual(await migrate(db), [], 'a second run applies nothing');
  const again = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM schema_migrations');
  assert.equal(Number(again.rows[0]!.count), MIGRATIONS.length, 'no duplicate bookkeeping rows');
});

test(
  'concurrent cold starts serialise on the advisory lock instead of colliding',
  { skip: !usingRealPostgres && 'requires TEST_DATABASE_URL (Docker PostgreSQL)' },
  async (t) => {
    // A pool wide enough that the five calls below really do hold five separate
    // PostgreSQL backends at once, as five booting instances would.
    const db = await connect({ DATABASE_POOL_MAX: '5' });
    t.after(() => db.close());
    // Force every contender to see a database that still needs work.
    await db.exec('DROP TABLE IF EXISTS schema_migrations');

    const results = await Promise.all(Array.from({ length: 5 }, () => migrate(db)));
    const appliedCounts = results.map((applied) => applied.length).sort();
    assert.equal(
      appliedCounts.filter((count) => count > 0).length,
      1,
      `exactly one contender should apply the migrations, got ${JSON.stringify(appliedCounts)}`,
    );
    assert.equal(appliedCounts.at(-1), MIGRATIONS.length);

    const rows = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM schema_migrations');
    assert.equal(Number(rows.rows[0]!.count), MIGRATIONS.length);
  },
);

test('the schema survives replaying every migration over an existing database', async (t) => {
  const db = await connect();
  t.after(() => db.close());
  await migrate(db);
  // Replaying the SQL directly is what a botched bookkeeping row would cause.
  for (const migration of MIGRATIONS) await db.exec(migration.sql);
  const columns = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'uploads' ORDER BY column_name`,
  );
  assert.deepEqual(
    columns.rows.map((row) => row.column_name),
    ['checksum', 'created_at', 'filename', 'id', 'mime', 'project_id', 'size_bytes', 'storage_key'],
  );
});
