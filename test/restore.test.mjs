import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { handleRestore } from '../api/restore.js';
import { loadSnapshot, loadVerifiedSnapshot, noteHash } from '../src/restore.mjs';

const userId = '11111111-1111-4111-8111-111111111111';
const noteId = '22222222-2222-4222-8222-222222222222';

function responseRecorder() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(statusCode) { this.statusCode = statusCode; return this; },
    json(body) { this.body = body; return this; },
  };
}

function createDatabase({ backup, backupReads, notes = [] }) {
  const storedNotes = new Map(notes.map((note) => [note.id, { ...note }]));
  let backupReadCount = 0;
  const supabase = {
    from(table) {
      let operation = 'select';
      let values;
      const filters = [];
      const query = {
        select() { return query; },
        eq(column, value) { filters.push([column, value]); return query; },
        update(nextValues) { operation = 'update'; values = nextValues; return query; },
        insert(nextValues) { operation = 'insert'; values = nextValues; return query; },
        async maybeSingle() {
          if (table === 'learning_note_backups') {
            assert.equal(operation, 'select');
            const idFilter = filters.find(([column]) => column === 'note_id');
            const ownerFilter = filters.find(([column]) => column === 'owner_id');
            const selectedBackup = backupReads && backupReadCount < backupReads.length
              ? backupReads[backupReadCount]
              : backup;
            backupReadCount += 1;
            return {
              data: idFilter?.[1] === selectedBackup?.note_id
                && ownerFilter?.[1] === selectedBackup?.owner_id ? selectedBackup : null,
              error: null,
            };
          }
          assert.equal(table, 'learning_notes');
          const idFilter = filters.find(([column]) => column === 'id');
          if (operation === 'insert') {
            if (storedNotes.has(values.id)) return { data: null, error: { code: '23505' } };
            storedNotes.set(values.id, { ...values });
            return { data: { ...values }, error: null };
          }
          const existing = storedNotes.get(idFilter?.[1]);
          if (operation === 'select') {
            return { data: existing ? { ...existing } : null, error: null };
          }
          const ownerFilter = filters.find(([column]) => column === 'owner_id');
          const titleFilter = filters.find(([column]) => column === 'title');
          const contentFilter = filters.find(([column]) => column === 'content');
          if (!existing || existing.owner_id !== ownerFilter?.[1]
              || (operation === 'update'
                && (existing.title !== titleFilter?.[1] || existing.content !== contentFilter?.[1]))) {
            return { data: null, error: null };
          }
          const updated = { ...existing, ...values };
          storedNotes.set(updated.id, updated);
          return { data: { ...updated }, error: null };
        },
      };
      return query;
    },
  };
  return { supabase, storedNotes };
}

function verifiedAuth(supabase) {
  return async () => ({ supabase, userId });
}

function createPolicyDatabase(policy, revision = 4) {
  let currentPolicy = structuredClone(policy);
  let currentRevision = revision;
  const audit = [];
  return {
    audit,
    get policy() { return currentPolicy; },
    get revision() { return currentRevision; },
    supabase: {
      from(table) {
        assert.equal(table, 'learning_test_policy_state');
        const query = {
          select() { return query; },
          eq(column, value) {
            assert.equal(column, 'id');
            assert.equal(value, 'active');
            return query;
          },
          async maybeSingle() {
            return {
              data: { id: 'active', policy: structuredClone(currentPolicy), revision: currentRevision },
              error: null,
            };
          },
        };
        return query;
      },
      async rpc(name, args) {
        assert.equal(name, 'restore_learning_test_policy');
        if (currentRevision !== args.p_expected_revision
            || JSON.stringify(currentPolicy) !== JSON.stringify(args.p_expected_policy)) {
          return { data: null, error: { code: '40001' } };
        }
        const before = structuredClone(currentPolicy);
        currentPolicy = { ...currentPolicy, ...args.p_restored_policy };
        currentRevision += 1;
        audit.push({
          actorId: args.p_actor_id,
          backupVersion: args.p_backup_version,
          backupHash: args.p_backup_sha256,
          changedKeys: args.p_changed_keys,
          before,
          after: structuredClone(currentPolicy),
        });
        return {
          data: [{ revision: currentRevision, policy: currentPolicy, audit_id: audit.length }],
          error: null,
        };
      },
    },
  };
}

function makeBackup(overrides = {}) {
  const backup = {
    note_id: noteId,
    owner_id: userId,
    title: '검증된 제목',
    content: '검증된 본문',
    snapshot_version: 'pre-attack-verified-v2',
    verified_at: '2026-10-14T00:00:00.000Z',
    ...overrides,
  };
  backup.content_hash = noteHash(backup);
  return backup;
}

test('loadSnapshot accepts the pinned verified backup', () => {
  const snapshot = loadSnapshot();
  assert.equal(snapshot.version, 'pre-attack-verified-v1');
});

test('loadSnapshot rejects a changed backup before restore', () => {
  const directory = mkdtempSync(join(tmpdir(), 'restore-backup-'));
  const changedSnapshotPath = join(directory, 'restore-backup.json');
  try {
    const snapshot = JSON.parse(readFileSync(resolve('restore-backup.json'), 'utf8'));
    snapshot.notes[0].content = 'tampered';
    writeFileSync(changedSnapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

    assert.throws(
      () => loadSnapshot(changedSnapshotPath),
      /무결성 검증에 실패/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('noteHash is stable for multibyte values and length-delimited fields', () => {
  const note = { id: noteId, owner_id: userId, title: '제목|', content: '본문😀' };
  assert.equal(noteHash(note), noteHash({ ...note }));
  assert.notEqual(noteHash(note), noteHash({ ...note, content: '본문' }));
});

test('restore preview validates the private backup and does not return note content', async () => {
  const backup = makeBackup();
  const { supabase } = createDatabase({
    backup,
    notes: [{ id: noteId, owner_id: userId, title: '변조 제목', content: '변조 본문' }],
  });
  const response = responseRecorder();
  await handleRestore({
    method: 'POST',
    body: { mode: 'preview', noteId, owner_id: 'forged-owner' },
  }, response, { authenticateRequest: verifiedAuth(supabase) });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    ok: true,
    mode: 'preview',
    noteId,
    owner_id: userId,
    snapshotVersion: backup.snapshot_version,
    verifiedAt: backup.verified_at,
    backupHash: backup.content_hash,
    currentHash: noteHash({ id: noteId, owner_id: userId, title: '변조 제목', content: '변조 본문' }),
    currentState: 'present',
    changedFields: ['title', 'content'],
  });
  assert.equal(JSON.stringify(response.body).includes(backup.content), false);
});

test('restore rejects a tampered private backup without changing the note', async () => {
  const backup = makeBackup({ content: 'altered after verification' });
  backup.content_hash = '0'.repeat(64);
  const originalNote = { id: noteId, owner_id: userId, title: '현재 제목', content: '현재 본문' };
  const { supabase, storedNotes } = createDatabase({ backup, notes: [originalNote] });
  const response = responseRecorder();
  await handleRestore({
    method: 'POST',
    body: { mode: 'restore', noteId, confirmHash: backup.content_hash },
  }, response, { authenticateRequest: verifiedAuth(supabase) });

  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.body, { error: 'BACKUP_VERIFICATION_FAILED' });
  assert.deepEqual(storedNotes.get(noteId), originalNote);
});

test('policy preview shows the verified backup version and targeted differences without mutation', async () => {
  const trusted = loadVerifiedSnapshot();
  const currentPolicy = {
    ...structuredClone(trusted.snapshot.policy),
    allowedRoutes: ['GET /api/notes', 'POST /api/notes'],
    teacherRules: ['preserve-this-service'],
  };
  const database = createPolicyDatabase(currentPolicy);
  const response = responseRecorder();
  await handleRestore({
    method: 'POST',
    body: { mode: 'policy', action: 'preview' },
  }, response, { authenticateRequest: verifiedAuth(database.supabase) });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.backupVersion, trusted.snapshot.policyVersion);
  assert.equal(response.body.backupHash, trusted.digest);
  assert.deepEqual(response.body.changedKeys, ['allowedRoutes']);
  assert.deepEqual(response.body.changes, [{
    key: 'allowedRoutes',
    from: currentPolicy.allowedRoutes,
    to: trusted.snapshot.policy.allowedRoutes,
  }]);
  assert.deepEqual(database.policy, currentPolicy);
  assert.equal(database.audit.length, 0);
});

test('policy restore requires the preview confirmation and preserves unrelated rules and audit history', async () => {
  const trusted = loadVerifiedSnapshot();
  const currentPolicy = {
    ...structuredClone(trusted.snapshot.policy),
    allowedRoutes: ['GET /api/notes', 'POST /api/notes'],
    teacherRules: ['preserve-this-service'],
  };
  const database = createPolicyDatabase(currentPolicy);
  const response = responseRecorder();
  await handleRestore({
    method: 'POST',
    body: {
      mode: 'policy',
      action: 'restore',
      confirmHash: trusted.digest,
      expectedRevision: database.revision,
    },
  }, response, { authenticateRequest: verifiedAuth(database.supabase) });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.restored, true);
  assert.equal(database.revision, 5);
  assert.deepEqual(database.policy.allowedRoutes, trusted.snapshot.policy.allowedRoutes);
  assert.deepEqual(database.policy.teacherRules, ['preserve-this-service']);
  assert.equal(database.audit.length, 1);
  assert.deepEqual(database.audit[0].changedKeys, ['allowedRoutes']);
  assert.deepEqual(database.audit[0].before, currentPolicy);
  assert.deepEqual(database.audit[0].after, database.policy);
});

test('policy restore stops before database access if the verified snapshot is altered', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'policy-restore-unverified-'));
  const snapshotPath = join(directory, 'restore-backup.json');
  const snapshot = JSON.parse(readFileSync(resolve('restore-backup.json'), 'utf8'));
  snapshot.policyVersion = 'tampered';
  writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  const response = responseRecorder();
  const originalError = console.error;
  console.error = () => {};
  try {
    await handleRestore({
      method: 'POST',
      body: { mode: 'policy', action: 'restore' },
    }, response, {
      snapshotPath,
      authenticateRequest: async () => ({
        userId,
        supabase: { from() { assert.fail('policy store must not be read before backup verification'); } },
      }),
    });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.body, { error: 'TRUSTED_BACKUP_UNAVAILABLE' });
  } finally {
    console.error = originalError;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('restore stops before database access when the pinned snapshot fails verification', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'restore-unverified-'));
  const snapshotPath = join(directory, 'restore-backup.json');
  const snapshot = JSON.parse(readFileSync(resolve('restore-backup.json'), 'utf8'));
  snapshot.version = 'modified-after-verification';
  writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  const response = responseRecorder();
  try {
    await handleRestore({
      method: 'POST',
      body: {
        mode: 'restore',
        noteId,
        confirmHash: '0'.repeat(64),
        expectedCurrentHash: null,
      },
    }, response, {
      snapshotPath,
      authenticateRequest: async () => ({
        userId,
        supabase: { from() { assert.fail('database must not be accessed for an unverified snapshot'); } },
      }),
    });

    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.body, { error: 'TRUSTED_BACKUP_UNAVAILABLE' });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('restore rereads and rejects a changed verified backup before changing the note', async () => {
  const backup = makeBackup();
  const changedBackup = makeBackup({ title: '사본 재조회 중 변경됨' });
  const originalNote = { id: noteId, owner_id: userId, title: '현재 제목', content: '현재 본문' };
  const { supabase, storedNotes } = createDatabase({
    backup,
    backupReads: [backup, changedBackup],
    notes: [originalNote],
  });
  const response = responseRecorder();
  await handleRestore({
    method: 'POST',
    body: {
      mode: 'restore',
      noteId,
      confirmHash: backup.content_hash,
      expectedCurrentHash: noteHash(originalNote),
    },
  }, response, { authenticateRequest: verifiedAuth(supabase) });

  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.body, { error: 'BACKUP_VERIFICATION_FAILED' });
  assert.deepEqual(storedNotes.get(noteId), originalNote);
});

test('restore updates only the authenticated owner’s selected note after hash confirmation', async () => {
  const backup = makeBackup();
  const originalNote = { id: noteId, owner_id: userId, title: '변조 제목', content: '변조 본문' };
  const otherNoteId = '33333333-3333-4333-8333-333333333333';
  const otherNote = { id: otherNoteId, owner_id: userId, title: '다른 메모', content: '보존할 내용' };
  const { supabase, storedNotes } = createDatabase({ backup, notes: [originalNote, otherNote] });
  const response = responseRecorder();
  await handleRestore({
    method: 'POST',
    body: {
      mode: 'restore',
      noteId,
      confirmHash: backup.content_hash,
      expectedCurrentHash: noteHash(originalNote),
      owner_id: 'forged-owner',
    },
  }, response, { authenticateRequest: verifiedAuth(supabase) });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    ok: true,
    mode: 'restore',
    restored: true,
    noteId,
    owner_id: userId,
    restoredHash: backup.content_hash,
    snapshotVersion: backup.snapshot_version,
  });
  assert.deepEqual(storedNotes.get(noteId), {
    id: noteId, owner_id: userId, title: backup.title, content: backup.content,
  });
  assert.deepEqual(storedNotes.get(otherNoteId), otherNote);
});

test('restore inserts a deleted note from the verified backup', async () => {
  const backup = makeBackup();
  const { supabase, storedNotes } = createDatabase({ backup });
  const response = responseRecorder();
  await handleRestore({
    method: 'POST',
    body: {
      mode: 'restore',
      noteId,
      confirmHash: backup.content_hash,
      expectedCurrentHash: null,
    },
  }, response, { authenticateRequest: verifiedAuth(supabase) });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(storedNotes.get(noteId), {
    id: noteId, owner_id: userId, title: backup.title, content: backup.content,
  });
});

test('restore denies a backup owned by a different authenticated user', async () => {
  const backup = makeBackup({ owner_id: '44444444-4444-4444-8444-444444444444' });
  const { supabase, storedNotes } = createDatabase({ backup });
  const response = responseRecorder();
  await handleRestore({
    method: 'POST',
    body: { mode: 'restore', noteId, confirmHash: backup.content_hash },
  }, response, { authenticateRequest: verifiedAuth(supabase) });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, { error: 'VERIFIED_BACKUP_NOT_FOUND' });
  assert.equal(storedNotes.size, 0);
});

test('restore requires an exact confirmation hash', async () => {
  const backup = makeBackup();
  const { supabase, storedNotes } = createDatabase({
    backup, notes: [{ id: noteId, owner_id: userId, title: '현재 제목', content: '현재 본문' }],
  });
  const response = responseRecorder();
  await handleRestore({
    method: 'POST',
    body: {
      mode: 'restore',
      noteId,
      confirmHash: '0'.repeat(64),
      expectedCurrentHash: noteHash({ id: noteId, owner_id: userId, title: '현재 제목', content: '현재 본문' }),
    },
  }, response, { authenticateRequest: verifiedAuth(supabase) });

  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.body, { error: 'RESTORE_CONFIRMATION_MISMATCH' });
  assert.equal(storedNotes.get(noteId).title, '현재 제목');
});

test('restore rejects a target changed after the preview', async () => {
  const backup = makeBackup();
  const current = { id: noteId, owner_id: userId, title: '변조 제목', content: '변조 본문' };
  const { supabase, storedNotes } = createDatabase({ backup, notes: [current] });
  const response = responseRecorder();
  await handleRestore({
    method: 'POST',
    body: {
      mode: 'restore',
      noteId,
      confirmHash: backup.content_hash,
      expectedCurrentHash: '0'.repeat(64),
    },
  }, response, { authenticateRequest: verifiedAuth(supabase) });

  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.body, { error: 'RESTORE_TARGET_CHANGED' });
  assert.deepEqual(storedNotes.get(noteId), current);
});
