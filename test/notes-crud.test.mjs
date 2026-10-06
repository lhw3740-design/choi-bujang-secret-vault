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

test('POST reports a safe database error code without exposing database details', async () => {
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
    const supabase = {
      from: () => ({
        insert: async () => ({
          error: { code: '42501', message: 'sensitive database detail' },
        }),
      }),
    };
    const response = responseRecorder();
    await handleNotesCollection({
      method: 'POST',
      body: { title: '메모', body: '본문' },
    }, response, { authenticateRequest: verifiedAuth(supabase) });

    assert.equal(response.statusCode, 502);
    assert.deepEqual(response.body, { error: 'NOTE_CREATE_FAILED', code: '42501' });
    assert.equal(JSON.stringify(response.body).includes('sensitive database detail'), false);
    assert.deepEqual(logged, [['note_create_failed', { code: '42501' }]]);
  } finally {
    console.error = originalError;
  }
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

function makeOwnedNoteClient(initialRow) {
  let stored = initialRow;
  const queries = [];
  return {
    queries,
    get row() { return stored; },
    client: {
      from(table) {
        assert.equal(table, 'learning_notes');
        let operation;
        let values;
        let selection;
        const filters = [];
        const query = {
          select(columns) {
            selection = columns;
            operation ??= 'GET';
            return query;
          },
          eq(column, value) {
            filters.push([column, value]);
            return query;
          },
          update(nextValues) {
            operation = 'PUT';
            values = nextValues;
            return query;
          },
          delete() {
            operation = 'DELETE';
            return query;
          },
          async maybeSingle() {
            queries.push({ operation, filters, values, selection });
            const matches = stored && filters.every(([column, value]) => stored[column] === value);
            if (!matches) return { data: null, error: null };
            if (operation === 'PUT') stored = { ...stored, ...values };
            const data = stored;
            if (operation === 'DELETE') stored = null;
            return { data, error: null };
          },
        };
        return query;
      },
    },
  };
}

test('owner can GET, PUT, and DELETE their own note', async () => {
  const database = makeOwnedNoteClient({
    id: noteId, owner_id: userId, title: '제목', content: '원문',
  });
  const authenticateRequest = verifiedAuth(database.client, userId);

  const getResponse = responseRecorder();
  await handleNoteItem({ method: 'GET' }, getResponse, {
    id: noteId, authenticateRequest,
  });
  assert.equal(getResponse.statusCode, 200);
  assert.deepEqual(getResponse.body, { id: noteId, title: '제목', body: '원문' });

  const putResponse = responseRecorder();
  await handleNoteItem({
    method: 'PUT',
    body: { title: '수정 제목', body: '수정 본문', owner_id: '33333333-3333-4333-8333-333333333333' },
  }, putResponse, { id: noteId, authenticateRequest });
  assert.equal(putResponse.statusCode, 200);
  assert.deepEqual(putResponse.body, { id: noteId, title: '수정 제목', body: '수정 본문' });
  assert.equal(database.row.owner_id, userId);
  assert.deepEqual(database.queries[1].values, {
    title: '수정 제목', content: '수정 본문', owner_id: userId,
  });

  const deleteResponse = responseRecorder();
  await handleNoteItem({ method: 'DELETE' }, deleteResponse, {
    id: noteId, authenticateRequest,
  });
  assert.equal(deleteResponse.statusCode, 204);
  assert.equal(deleteResponse.ended, true);

  const missingResponse = responseRecorder();
  await handleNoteItem({ method: 'GET' }, missingResponse, {
    id: noteId, authenticateRequest,
  });
  assert.equal(missingResponse.statusCode, 404);
  assert.deepEqual(missingResponse.body, { error: 'NOTE_NOT_FOUND' });

  for (const query of database.queries) {
    assert.ok(query.filters.some(([column, value]) => column === 'id' && value === noteId));
    assert.ok(query.filters.some(([column, value]) => column === 'owner_id' && value === userId));
  }
});

test('another owner gets 404 and cannot GET, PUT, or DELETE a note', async () => {
  const otherUserId = '33333333-3333-4333-8333-333333333333';
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const database = makeOwnedNoteClient({
      id: noteId, owner_id: userId, title: 'A 제목', content: 'A 본문',
    });
    const response = responseRecorder();
    await handleNoteItem({
      method,
      body: { title: '탈취 제목', body: '탈취 본문', owner_id: otherUserId },
    }, response, {
      id: noteId,
      authenticateRequest: verifiedAuth(database.client, otherUserId),
    });
    assert.equal(response.statusCode, 404, `${method} must hide a note owned by another user`);
    assert.deepEqual(response.body, { error: 'NOTE_NOT_FOUND' });
    assert.deepEqual(database.row, {
      id: noteId, owner_id: userId, title: 'A 제목', content: 'A 본문',
    });
    assert.ok(database.queries[0].filters.some(
      ([column, value]) => column === 'owner_id' && value === otherUserId,
    ));
  }
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
