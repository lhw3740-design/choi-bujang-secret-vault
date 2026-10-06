import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNotesHandler } from '../api/notes.js';

const rows = [
  { title: '과제', content: '실습용 가상 과제 기록' },
  { title: '포트폴리오', content: '실습용 가상 포트폴리오 기록' },
  { title: '아침 리추얼', content: '실습용 가상 리추얼 기록' },
  { title: '훈련 행정 자료', content: '실습용 가상 행정 기록' },
];

function responseRecorder() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(statusCode) { this.statusCode = statusCode; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('GET returns four notes without returning the server key', async () => {
  let receivedConfig;
  const handler = createNotesHandler({
    env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'server-only-test-key' },
    createClient: (url, key, options) => {
      receivedConfig = { url, key, options };
      return {
        from(table) {
          assert.equal(table, 'learning_notes');
          return {
            select(columns) {
              assert.equal(columns, 'title,content');
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
  });
  const response = responseRecorder();
  await handler({ method: 'GET' }, response);

  assert.equal(receivedConfig.key, 'server-only-test-key');
  assert.deepEqual(receivedConfig.options.auth, {
    autoRefreshToken: false, persistSession: false, detectSessionInUrl: false,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.deepEqual(response.body, { notes: rows });
  assert.equal(JSON.stringify(response.body).includes('server-only-test-key'), false);
});

test('non-GET requests are rejected without creating a Supabase client', async () => {
  const handler = createNotesHandler({
    env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'server-only-test-key' },
    createClient() { assert.fail('client must not be created'); },
  });
  const response = responseRecorder();
  await handler({ method: 'POST' }, response);
  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.Allow, 'GET');
});

test('missing server configuration fails without exposing environment values', async () => {
  const handler = createNotesHandler({ env: { SUPABASE_SECRET_KEY: 'server-only-test-key' } });
  const response = responseRecorder();
  await handler({ method: 'GET' }, response);
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, { error: 'SERVER_CONFIGURATION_ERROR' });
  assert.equal(JSON.stringify(response.body).includes('server-only-test-key'), false);
});
