import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseStore } from '../../src/storage/supabase.js';

test('Supabase storage keeps credentials server-side and round-trips objects', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fakeFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    if (init.method === 'GET') return new Response(Buffer.from('image'), { headers: { 'content-type': 'image/png' } });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const store = createSupabaseStore(
    {
      driver: 'supabase',
      endpoint: 'https://project.supabase.co',
      serviceRoleKey: 'server-only-key',
      bucket: 'reviewdesk',
      keyPrefix: 'objects',
    },
    fakeFetch,
  );

  await store.put('folder/a b.png', Buffer.from('image'), 'image/png');
  const object = await store.get('folder/a b.png');
  await store.delete('folder/a b.png');

  assert.deepEqual(object, { body: Buffer.from('image'), contentType: 'image/png' });
  assert.deepEqual(calls.map((call) => call.init.method), ['POST', 'GET', 'DELETE']);
  assert.match(calls[0]!.url, /reviewdesk\/objects\/folder\/a%20b\.png$/);
  assert.match(calls[1]!.url, /object\/authenticated\/reviewdesk\/objects\/folder/);
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers.authorization, 'Bearer server-only-key');
  assert.equal(headers.apikey, 'server-only-key');
  assert.equal(headers['x-upsert'], 'true');
});

test('Supabase storage maps a missing object to null without leaking an error body', async () => {
  const fakeFetch = (async () => new Response('{"statusCode":"404","code":"NoSuchKey","message":"sensitive upstream detail"}', { status: 400 })) as typeof fetch;
  const store = createSupabaseStore(
    {
      driver: 'supabase',
      endpoint: 'https://project.supabase.co',
      serviceRoleKey: 'server-only-key',
      bucket: 'reviewdesk',
      keyPrefix: 'objects',
    },
    fakeFetch,
  );
  assert.equal(await store.get('absent'), null);
});
