import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleNotesCollection } from '../api/notes.js';
import { handleNoteItem } from '../api/notes/[id].js';

const userId = '11111111-1111-4111-8111-111111111111';
const noteId = '22222222-2222-4222-8222-222222222222';

function responseRecorder() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(statusCode) { this.statusCode = statusCode; return this; },
    json(body) { this.body = body; return this; },
    end() { this.ended = true; return this; },
  };
}

const verifiedAuth = (supabase, authenticatedUserId = userId) => async () => ({
  supabase, userId: authenticatedUserId,
});

test('POST stores the verified user as owner and returns the new id', async () => {
  let inserted;
  const supabase = {
    from(table) {
      assert.equal(table, 'learning_notes');
      return {
        insert(row) { inserted = row; return { error: null }; },
      };
    },
  };
  const response = responseRecorder();
  await handleNotesCollection({
    method: 'POST',
    body: { title: ' 새 메모 ', body: '본문', owner_id: 'forged-owner' },
  }, response, {
    authenticateRequest: verifiedAuth(supabase),
    createId: () => noteId,
  });

  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.body, { id: noteId });
  assert.deepEqual(inserted, {
    id: noteId, title: '새 메모', content: '본문', owner_id: userId,
  });
});

test('POST accepts a valid supplied UUID and rejects malformed IDs', async () => {
  let inserted;
  const supabase = { from: () => ({ insert(row) { inserted = row; return { error: null }; } }) };
  const validResponse = responseRecorder();
  await handleNotesCollection({
    method: 'POST',
    body: { id: noteId, title: '메모', body: '본문' },
  }, validResponse, { authenticateRequest: verifiedAuth(supabase) });
  assert.equal(validResponse.statusCode, 201);
  assert.equal(inserted.id, noteId);

  const invalidResponse = responseRecorder();
  await handleNotesCollection({
    method: 'POST',
    body: { id: 'not-a-uuid', title: '메모', body: '본문' },
  }, invalidResponse, {
    authenticateRequest: verifiedAuth(supabase),
  });
  assert.equal(invalidResponse.statusCode, 400);
  assert.deepEqual(invalidResponse.body, { error: 'INVALID_NOTE' });
});

test('list GET filters by verified owner and maps database content to body', async () => {
  const row = { id: noteId, title: '내 메모', content: '본문' };
  const supabase = {
    from: table => {
      assert.equal(table, 'learning_notes');
      return {
        select(columns) {
          assert.equal(columns, 'id,title,content');
          return this;
        },
        eq(column, value) {
          assert.equal(column, 'owner_id');
          assert.equal(value, userId);
          return this;
        },
        async order(column, options) {
          assert.equal(column, 'id');
          assert.deepEqual(options, { ascending: true });
          return { data: [row], error: null };
        },
      };
    },
  };
  const response = responseRecorder();
  await handleNotesCollection({ method: 'GET' }, response, {
    authenticateRequest: verifiedAuth(supabase),
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, [{ id: noteId, title: '내 메모', body: '본문' }]);
});

test('item GET, PUT, and DELETE use IDs without owner filtering', async () => {
  let stored = { id: noteId, title: '제목', content: '원문' };
  const operations = [];
  const supabase = {
    from: table => {
      assert.equal(table, 'learning_notes');
      let operation;
      let update;
      return {
        select(columns) {
          assert.ok(['id,title,content', 'id'].includes(columns));
          operation ??= 'GET';
          return this;
        },
        eq(column, value) {
          assert.equal(column, 'id');
          assert.equal(value, noteId);
          return this;
        },
        maybeSingle: async () => {
          if (operation === 'PUT') stored = { ...stored, ...update };
          const data = stored;
          if (operation === 'DELETE') stored = null;
          operations.push(operation);
          return { data, error: null };
        },
        update(values) {
          operation = 'PUT';
          update = values;
          return this;
        },
        delete() {
          operation = 'DELETE';
          return this;
        },
      };
    },
  };

  const getResponse = responseRecorder();
  await handleNoteItem({ method: 'GET' }, getResponse, {
    id: noteId, authenticateRequest: verifiedAuth(supabase, '33333333-3333-4333-8333-333333333333'),
  });
  assert.deepEqual(getResponse.body, { id: noteId, title: '제목', body: '원문' });

  const putResponse = responseRecorder();
  await handleNoteItem({
    method: 'PUT', body: { title: '수정 제목', body: '수정 본문' },
  }, putResponse, {
    id: noteId,
    authenticateRequest: verifiedAuth(supabase, '33333333-3333-4333-8333-333333333333'),
  });
  assert.equal(putResponse.statusCode, 200);
  assert.deepEqual(putResponse.body, { id: noteId, title: '수정 제목', body: '수정 본문' });

  const deleteResponse = responseRecorder();
  await handleNoteItem({ method: 'DELETE' }, deleteResponse, {
    id: noteId, authenticateRequest: verifiedAuth(supabase, '33333333-3333-4333-8333-333333333333'),
  });
  assert.equal(deleteResponse.statusCode, 204);
  assert.equal(deleteResponse.ended, true);

  const missingResponse = responseRecorder();
  await handleNoteItem({ method: 'GET' }, missingResponse, {
    id: noteId, authenticateRequest: verifiedAuth(supabase, '33333333-3333-4333-8333-333333333333'),
  });
  assert.equal(missingResponse.statusCode, 404);
  assert.deepEqual(missingResponse.body, { error: 'NOTE_NOT_FOUND' });
  assert.deepEqual(operations, ['GET', 'PUT', 'DELETE', 'GET']);
});

test('item route rejects unauthenticated requests before touching the table', async () => {
  let queried = false;
  const response = responseRecorder();
  await handleNoteItem({ method: 'GET' }, response, {
    id: noteId,
    authenticateRequest: async () => ({ error: 'AUTHENTICATION_REQUIRED', status: 401 }),
  });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.body, { error: 'AUTHENTICATION_REQUIRED' });
  assert.equal(queried, false);
});
