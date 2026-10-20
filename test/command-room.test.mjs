import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { handleCommandRoom } from '../api/command-room.js';
import { noteHash } from '../src/restore.mjs';
import { RULE_IDS } from '../src/decider.mjs';

const userId = '11111111-1111-4111-8111-111111111111';
const noteId = '22222222-2222-4222-8222-222222222222';
const handle = 'A'.repeat(43);
const sha = (value) => createHash('sha256').update(value).digest('hex');
const cookie = `__Host-aleph_device=${handle}`;

function responseRecorder() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function makeBackup() {
  const row = {
    note_id: noteId, owner_id: userId, title: '비공개 제목', content: '비공개 본문',
    snapshot_version: 'pre-attack-verified-v1', verified_at: '2026-10-14T00:00:00.000Z',
  };
  row.content_hash = noteHash(row);
  return row;
}

function createStore({ deviceStatus, backups = [], backupError = null }) {
  return {
    from(table) {
      const filters = [];
      const query = {
        select() { return query; },
        eq(column, value) { filters.push([column, value]); return query; },
        async maybeSingle() {
          assert.equal(table, 'device_approvals');
          return deviceStatus && filters.some(([c, v]) => c === 'device_hash' && v === sha(handle))
            ? { data: { status: deviceStatus }, error: null } : { data: null, error: null };
        },
        then(resolve) {
          assert.equal(table, 'learning_note_backups');
          return Promise.resolve(backupError ? { data: null, error: backupError } : { data: backups, error: null }).then(resolve);
        },
      };
      return query;
    },
  };
}

const call = async (store, request = {}, options = {}) => {
  const response = responseRecorder();
  await handleCommandRoom({ method: 'GET', headers: { cookie }, ...request }, response, {
    authenticateRequest: async () => ({ supabase: store, userId }),
    now: () => new Date('2026-10-15T07:40:00.000Z'),
    ...options,
  });
  return response;
};

test('command room rejects unauthenticated requests', async () => {
  const response = responseRecorder();
  await handleCommandRoom({ method: 'GET', headers: {} }, response, {
    authenticateRequest: async () => ({ error: 'AUTHENTICATION_REQUIRED', status: 401 }),
  });
  assert.equal(response.statusCode, 401);
});

test('command room stays closed until the server approves the device', async () => {
  for (const deviceStatus of [null, 'pending', 'revoked']) {
    const response = await call(createStore({ deviceStatus }));
    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.body, { error: 'DEVICE_NOT_APPROVED' });
  }
  const noCookie = await call(createStore({ deviceStatus: 'approved' }), { headers: {} });
  assert.equal(noCookie.statusCode, 403);
});

test('approved device gets a summary that separates verified results from not-run items', async () => {
  const backup = makeBackup();
  const response = await call(createStore({ deviceStatus: 'approved', backups: [backup] }));
  assert.equal(response.statusCode, 200);
  const body = response.body;
  assert.equal(body.generatedAt, '2026-10-15T07:40:00.000Z');
  assert.deepEqual(body.decider.ruleIds, [...RULE_IDS]);
  assert.equal(body.decider.engineDecisions.status, 'not_connected');
  assert.equal(body.detection.engineEvents.status, 'not_connected');
  assert.equal(body.revocation.status, 'not_connected');
  assert.equal(body.recovery.status, 'verified');
  assert.equal(body.recovery.snapshotVersion, 'pre-attack-verified-v1');
  assert.equal(body.recovery.policyVersion, 'verified-policy-10');
  assert.equal(body.recovery.noteBackups.count, 1);
  assert.deepEqual(body.recovery.noteBackups.items, [{
    noteIdPrefix: noteId.slice(0, 8),
    snapshotVersion: backup.snapshot_version,
    verifiedAt: backup.verified_at,
    hashOk: true,
  }]);
  const text = JSON.stringify(body);
  assert.equal(text.includes(backup.title), false);
  assert.equal(text.includes(backup.content), false);
  assert.equal(text.includes(noteId), false);
  assert.equal(text.includes(backup.content_hash), false);
});

test('a backup whose hash does not match is reported, not hidden', async () => {
  const backup = { ...makeBackup(), content: '바뀐 본문' };
  const response = await call(createStore({ deviceStatus: 'approved', backups: [backup] }));
  assert.equal(response.body.recovery.noteBackups.items[0].hashOk, false);
});

test('backup read failure and snapshot failure are reported as unavailable, never as verified', async () => {
  const failing = await call(createStore({ deviceStatus: 'approved', backupError: { code: 'x' } }), {}, {
    snapshotPath: '/nonexistent/restore-backup.json',
  });
  assert.equal(failing.statusCode, 200);
  assert.equal(failing.body.recovery.status, 'unavailable');
  assert.equal(failing.body.recovery.noteBackups.status, 'unavailable');
  assert.equal(failing.body.recovery.snapshotVersion, null);
});

test('other methods are rejected', async () => {
  const response = await call(createStore({ deviceStatus: 'approved' }), { method: 'POST' });
  assert.equal(response.statusCode, 405);
});

test('screen builds the command room with text nodes and labels not-run items', () => {
  const html = readFileSync('public/index.html', 'utf8');
  const script = html.slice(html.indexOf('function roomCard'), html.indexOf('async function loadCommandRoom'));
  assert.doesNotMatch(script, /innerHTML/u);
  assert.match(html, /not_connected: '미실행'/u);
  assert.match(html, /commandRoomId \+= 1;\s*commandRoomCards\.replaceChildren\(\)/u);
  assert.match(html, /메모 제목과 본문은 표시하지 않습니다/u);
});
