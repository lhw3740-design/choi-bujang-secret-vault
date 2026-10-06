import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNotesHandler } from '../api/notes.js';

const rows = [
  { id: '00000000-0000-4000-8000-000000000001', title: '과제', content: '실습용 가상 과제 기록' },
  { id: '00000000-0000-4000-8000-000000000002', title: '포트폴리오', content: '실습용 가상 포트폴리오 기록' },
  { id: '00000000-0000-4000-8000-000000000003', title: '아침 리추얼', content: '실습용 가상 리추얼 기록' },
  { id: '00000000-0000-4000-8000-000000000004', title: '훈련 행정 자료', content: '실습용 가상 행정 기록' },
];

function responseRecorder() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(statusCode) { this.statusCode = statusCode; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('GET returns four notes only after the authorization token is verified', async () => {
  let receivedConfig;
  let queried = false;
  const handler = createNotesHandler({
    env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'server-only-test-key' },
    config: { identityProvider: { issuer: 'https://example.supabase.co/auth/v1' } },
    createClient: (url, key, options) => {
      receivedConfig = { url, key, options };
      return {
        from(table) {
          queried = true;
          assert.equal(table, 'learning_notes');
          return {
            select(columns) {
            assert.equal(columns, 'id,title,content');
              return this;
            },
          eq(column, value) {
            assert.equal(column, 'owner_id');
            assert.equal(value, 'verified-user-id');
            return this;
          },
          async order(column, options) {
              assert.equal(column, 'id');
              assert.deepEqual(options, { ascending: true });
              return { data: rows, error: null };
            },
          };
        },
      };
    },
    createVerifier: ({ config, supabaseSecretKey, supabaseClient }) => {
      assert.equal(config.identityProvider.issuer, 'https://example.supabase.co/auth/v1');
      assert.equal(supabaseSecretKey, 'server-only-test-key');
      assert.ok(supabaseClient);
      return async authorization => authorization === 'Bearer valid'
        ? { kind: 'student', userId: 'verified-user-id' }
        : null;
    },
  });
  const response = responseRecorder();
  await handler({
    method: 'GET',
    headers: { authorization: 'Bearer valid' },
    body: { userId: 'forged-user-id', role: 'admin' },
  }, response);

  assert.equal(receivedConfig.key, 'server-only-test-key');
  assert.deepEqual(receivedConfig.options.auth, {
    autoRefreshToken: false, persistSession: false, detectSessionInUrl: false,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(queried, true);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.deepEqual(response.body, rows.map(({ id, title, content }) => ({
    id, title, body: content,
  })));
  assert.equal(JSON.stringify(response.body).includes('server-only-test-key'), false);
});

test('missing or invalid tokens are rejected before querying notes', async () => {
  for (const authorization of [undefined, 'Bearer invalid']) {
    let queried = false;
    const handler = createNotesHandler({
      env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'server-only-test-key' },
      createClient: () => ({
        from() {
          queried = true;
          assert.fail('notes must not be queried for an unverified request');
        },
      }),
      createVerifier: () => async token => token === 'Bearer valid'
        ? { kind: 'student', userId: 'verified-user-id' }
        : null,
    });
    const response = responseRecorder();
    await handler({
      method: 'GET',
      headers: authorization ? { authorization } : {},
      body: { userId: 'forged-user-id', role: 'authenticated' },
    }, response);

    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.body, { error: 'AUTHENTICATION_REQUIRED' });
    assert.equal(queried, false);
  }
});

test('the configured login verifier rejects a request without a bearer token', async () => {
  let queried = false;
  const handler = createNotesHandler({
    env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'server-only-test-key' },
    createClient: () => ({
      auth: { async getClaims() { assert.fail('claims must not be requested without a token'); } },
      from() {
        queried = true;
        assert.fail('notes must not be queried without a token');
      },
    }),
  });
  const response = responseRecorder();
  await handler({ method: 'GET', headers: {} }, response);
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.body, { error: 'AUTHENTICATION_REQUIRED' });
  assert.equal(queried, false);
});

test('unsupported methods are rejected without creating a Supabase client', async () => {
  const handler = createNotesHandler({
    env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'server-only-test-key' },
    createClient() { assert.fail('client must not be created'); },
  });
  const response = responseRecorder();
  await handler({ method: 'PATCH' }, response);
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.Allow, 'GET, POST');
});

test('missing server configuration fails without exposing environment values', async () => {
  const handler = createNotesHandler({ env: { SUPABASE_SECRET_KEY: 'server-only-test-key' } });
  const response = responseRecorder();
  await handler({ method: 'GET' }, response);
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, { error: 'SERVER_CONFIGURATION_ERROR' });
  assert.equal(JSON.stringify(response.body).includes('server-only-test-key'), false);
});
