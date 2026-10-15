import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { handleDevice } from '../api/device.js';

const userId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '22222222-2222-4222-8222-222222222222';

function responseRecorder() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function createStore(rows = []) {
  const table = rows.map((row) => ({ ...row }));
  const supabase = {
    from(name) {
      assert.equal(name, 'device_approvals');
      const filters = [];
      let insertValues;
      const matches = () => table.filter((row) => filters.every(([c, v]) => row[c] === v));
      const query = {
        select() { return query; },
        eq(column, value) { filters.push([column, value]); return query; },
        insert(values) { insertValues = values; return query; },
        async maybeSingle() { return { data: matches()[0] ?? null, error: null }; },
        then(resolve) {
          if (insertValues) {
            table.push({ ...insertValues });
            return Promise.resolve({ data: null, error: null }).then(resolve);
          }
          return Promise.resolve({ data: matches().map((row) => ({ id: row.device_hash })), error: null }).then(resolve);
        },
      };
      return query;
    },
  };
  return { supabase, table };
}

const authAs = (supabase, id = userId) => async () => ({ supabase, userId: id });
const sha = (value) => createHash('sha256').update(value).digest('hex');

test('device API rejects unauthenticated requests without touching the store', async () => {
  const response = responseRecorder();
  await handleDevice({ method: 'GET', headers: {} }, response, {
    authenticateRequest: async () => ({ error: 'AUTHENTICATION_REQUIRED', status: 401 }),
  });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.body, { error: 'AUTHENTICATION_REQUIRED' });
  assert.equal(response.headers['Cache-Control'], 'no-store');
});

test('a device with no request is reported unregistered', async () => {
  const { supabase } = createStore();
  const response = responseRecorder();
  await handleDevice({ method: 'GET', headers: {} }, response, { authenticateRequest: authAs(supabase) });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { ok: true, state: 'unregistered' });
});

test('requesting approval stores only a hash, sets an HttpOnly cookie and never approves', async () => {
  const { supabase, table } = createStore();
  const response = responseRecorder();
  await handleDevice({
    method: 'POST',
    headers: {},
    body: { status: 'approved', owner_id: otherUserId, device_hash: 'a'.repeat(64) },
  }, response, { authenticateRequest: authAs(supabase) });

  assert.equal(response.statusCode, 202);
  assert.deepEqual(response.body, { ok: true, state: 'pending' });
  const cookie = response.headers['Set-Cookie'];
  assert.match(cookie, /^__Host-aleph_device=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Strict/u);
  const handle = /=([^;]+)/u.exec(cookie)[1];
  assert.equal(table.length, 1);
  assert.deepEqual(table[0], { owner_id: userId, device_hash: sha(handle), status: 'pending' });
  assert.equal(JSON.stringify(response.body).includes(handle), false);
});

test('only a server-side approved record opens the device, and only for its owner', async () => {
  const handle = 'A'.repeat(43);
  const { supabase } = createStore([
    { owner_id: userId, device_hash: sha(handle), status: 'approved' },
  ]);
  const cookie = `__Host-aleph_device=${handle}`;
  const owner = responseRecorder();
  await handleDevice({ method: 'GET', headers: { cookie } }, owner, { authenticateRequest: authAs(supabase) });
  assert.deepEqual(owner.body, { ok: true, state: 'approved' });

  const other = responseRecorder();
  await handleDevice({ method: 'GET', headers: { cookie } }, other, {
    authenticateRequest: authAs(supabase, otherUserId),
  });
  assert.deepEqual(other.body, { ok: true, state: 'unregistered' });

  const forged = responseRecorder();
  await handleDevice({ method: 'GET', headers: { cookie: '__Host-aleph_device=' + 'B'.repeat(43) } }, forged, {
    authenticateRequest: authAs(supabase),
  });
  assert.deepEqual(forged.body, { ok: true, state: 'unregistered' });
});

test('a pending or revoked device stays closed and a repeat request creates no new record', async () => {
  const handle = 'C'.repeat(43);
  const { supabase, table } = createStore([
    { owner_id: userId, device_hash: sha(handle), status: 'revoked' },
  ]);
  const response = responseRecorder();
  await handleDevice({ method: 'POST', headers: { cookie: `__Host-aleph_device=${handle}` }, body: {} }, response, {
    authenticateRequest: authAs(supabase),
  });
  assert.deepEqual(response.body, { ok: true, state: 'revoked' });
  assert.equal(table.length, 1);
  assert.equal(response.headers['Set-Cookie'], undefined);
});

test('too many pending requests are refused', async () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({
    owner_id: userId, device_hash: sha(String(i)), status: 'pending',
  }));
  const { supabase, table } = createStore(rows);
  const response = responseRecorder();
  await handleDevice({ method: 'POST', headers: {}, body: {} }, response, { authenticateRequest: authAs(supabase) });
  assert.equal(response.statusCode, 429);
  assert.equal(table.length, 5);
});

test('other methods are rejected', async () => {
  const response = responseRecorder();
  await handleDevice({ method: 'DELETE', headers: {} }, response, { authenticateRequest: authAs(createStore().supabase) });
  assert.equal(response.statusCode, 405);
});

test('installable shell: manifest is valid, service worker never caches API or protected data', () => {
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.name && manifest.short_name && manifest.start_url === '/');
  for (const icon of manifest.icons) {
    assert.ok(readFileSync(`public${icon.src}`).length > 100);
  }
  const worker = readFileSync('public/sw.js', 'utf8');
  assert.doesNotMatch(worker, /\/api\//u);
  assert.match(worker, /mode !== 'navigate'/u);
  assert.match(readFileSync('public/offline.html', 'utf8'), /오프라인|연결되어 있지 않습니다/u);
});

test('screen keeps device state out of browser storage and gates protected data on server state', () => {
  const html = readFileSync('public/index.html', 'utf8');
  assert.doesNotMatch(html, /localStorage|sessionStorage|indexedDB/u);
  assert.match(html, /rel="manifest"/u);
  assert.match(html, /deviceState !== 'approved'/u);
  assert.match(html, /설치했다는 표시만으로는 기기를 믿지 않습니다/u);
});
