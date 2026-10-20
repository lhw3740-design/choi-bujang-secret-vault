import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MANUAL_ROWS, runEvidence, toMarkdown } from '../src/evidence.mjs';

const B_NOTE = '33333333-3333-4333-8333-333333333333';
const TOKENS = { A: 'token-for-a-secret', B: 'token-for-b-secret' };

function reply(status, body, headers = {}) {
  return { status, headers: { get: (name) => headers[name.toLowerCase()] ?? null }, text: async () => JSON.stringify(body) };
}

function makeServer({ broken = {}, calls = [] } = {}) {
  return async (url, options = {}) => {
    const { pathname } = new URL(url);
    const method = options.method ?? 'GET';
    const auth = options.headers?.authorization;
    calls.push({ pathname, method, auth, requestId: options.headers?.['x-request-id'] });
    const meta = { 'x-vercel-id': 'icn1::abc-123' };
    const who = auth === `Bearer ${TOKENS.A}` ? 'A' : auth === `Bearer ${TOKENS.B}` ? 'B' : null;
    if (pathname === '/data.json') return reply(200, { notes: [] }, meta);
    if (pathname === '/manifest.webmanifest') return reply(200, { name: '내 자료실' }, meta);
    if (url.includes('supabase.example')) return reply(401, { message: 'no' }, meta);
    if (!who && !(broken.anonAllowed && pathname === '/api/notes')) return reply(401, { error: 'AUTHENTICATION_REQUIRED' }, meta);
    if (!who) return reply(200, [], meta);
    if (pathname === '/api/notes') return reply(200, who === 'B' ? [{ id: B_NOTE, title: '비공개 제목', body: '비공개 본문' }] : [], meta);
    if (pathname === `/api/notes/${B_NOTE}`) return reply(404, { error: 'NOTE_NOT_FOUND' }, meta);
    if (pathname === '/api/restore') {
      const body = JSON.parse(options.body);
      if (body.mode === 'bogus') return reply(400, { error: 'INVALID_RESTORE_MODE' }, meta);
      if (body.mode === 'policy') return reply(200, { ok: true, applied: false, snapshotVersion: 'pre-attack-verified-v1' }, meta);
      return reply(404, { error: 'VERIFIED_BACKUP_NOT_FOUND' }, meta);
    }
    if (pathname === '/api/device') return reply(200, { ok: true, state: 'unregistered' }, meta);
    if (pathname === '/api/command-room') return reply(403, { error: 'DEVICE_NOT_APPROVED' }, meta);
    return reply(404, {}, meta);
  };
}

const base = {
  baseUrl: 'https://app.example/',
  originalApiUrl: 'https://supabase.example/rest/v1/learning_notes',
  publishableKey: 'publishable-public-key',
  now: () => new Date('2026-10-16T11:00:00.000Z'),
};

test('every automated row matches when the server behaves, and manual rows stay not-run', async () => {
  const calls = [];
  let n = 0;
  const report = await runEvidence({
    ...base, fetchImpl: makeServer({ calls }), signIn: async (role) => TOKENS[role],
    env: {}, newRequestId: () => `req-${++n}`,
  });
  const executed = report.rows.filter((row) => row.result !== '미실행');
  assert.ok(executed.length >= 15);
  assert.ok(executed.every((row) => row.result === '일치'), JSON.stringify(executed.filter((r) => r.result !== '일치')));
  for (const manual of MANUAL_ROWS) {
    const row = report.rows.find((r) => r.caseId === manual.caseId);
    assert.equal(row.result, '미실행');
    assert.equal(row.requestId, '');
  }
  assert.equal(report.summary.mismatched, 0);
  assert.match(report.summary.attacks41, /통과 처리하지 않습니다/u);
  // 실제 요청마다 요청 ID와 확인 시각이 남는다.
  for (const row of executed) {
    assert.match(row.requestId, /^req-\d+$/u);
    assert.equal(row.checkedAt, '2026-10-16T11:00:00.000Z');
    assert.equal(row.vercelId, 'icn1::abc-123');
  }
  // 교차 소유자 요청은 A의 토큰으로 B의 메모 ID에 보낸다.
  const cross = calls.find((c) => c.pathname === `/api/notes/${B_NOTE}`);
  assert.equal(cross.auth, `Bearer ${TOKENS.A}`);
});

test('the report never contains tokens, passwords or note text', async () => {
  const report = await runEvidence({ ...base, fetchImpl: makeServer(), signIn: async (role) => TOKENS[role], env: {} });
  const text = JSON.stringify(report) + toMarkdown(report);
  for (const secret of [TOKENS.A, TOKENS.B, '비공개 제목', '비공개 본문', 'Bearer']) {
    assert.equal(text.includes(secret), false, secret);
  }
});

test('without test accounts the signed-in rows are not-run with a reason, not passed', async () => {
  const report = await runEvidence({ ...base, fetchImpl: makeServer(), signIn: async () => null, env: {} });
  const a = report.rows.find((r) => r.caseId === 's4_a_notes_list');
  assert.equal(a.result, '미실행');
  assert.match(a.note, /로그인/u);
  assert.equal(report.rows.find((r) => r.caseId === 's4_cross_owner_read').result, '미실행');
  assert.equal(report.rows.find((r) => r.caseId === 's3_anon_notes_list').result, '일치');
  assert.ok(report.summary.notRun >= 8);
});

test('a forbidden request that is allowed is reported as a mismatch', async () => {
  const report = await runEvidence({ ...base, fetchImpl: makeServer({ broken: { anonAllowed: true } }), signIn: async () => null, env: {} });
  const row = report.rows.find((r) => r.caseId === 's3_anon_notes_list');
  assert.equal(row.result, '불일치');
  assert.match(row.actual, /HTTP 200/u);
  assert.equal(report.rows.find((r) => r.caseId === 's3_anon_notes_create').result, '불일치');
  assert.equal(report.summary.mismatched, 2);
});

test('a connection failure is a mismatch with no invented status', async () => {
  const report = await runEvidence({ ...base, fetchImpl: async () => { throw new Error('boom'); }, signIn: async () => null, env: {} });
  const row = report.rows.find((r) => r.caseId === 's1_public_data');
  assert.equal(row.result, '불일치');
  assert.match(row.actual, /응답 없음/u);
});

test('own-backup preview runs only when the note id is configured', async () => {
  const none = await runEvidence({ ...base, fetchImpl: makeServer(), signIn: async (r) => TOKENS[r], env: {} });
  assert.equal(none.rows.find((r) => r.caseId === 's10_own_preview').result, '미실행');
  const invalid = await runEvidence({ ...base, fetchImpl: makeServer(), signIn: async (r) => TOKENS[r], env: { ALEPH_A_BACKUP_NOTE_ID: 'not-a-uuid' } });
  assert.equal(invalid.rows.find((r) => r.caseId === 's10_own_preview').result, '미실행');
});

test('markdown table lists every row with the required columns', async () => {
  const report = await runEvidence({ ...base, fetchImpl: makeServer(), signIn: async (r) => TOKENS[r], env: {} });
  const md = toMarkdown(report);
  for (const column of ['기대 결과', '실제 API 결과', '요청 ID', '확인 시각']) assert.ok(md.includes(column));
  assert.equal(md.split('\n').filter((line) => line.startsWith('| ')).length, report.rows.length + 1);
  assert.match(md, /미실행/u);
});
