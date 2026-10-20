// 12단계 제작 2: 실제 배포 주소에 요청을 보내 정상·금지 결과를 한 표로 남깁니다.
// 비밀번호·토큰·쿠키·메모 제목과 본문은 표와 파일에 넣지 않습니다. 실행하지 못한 항목은 "미실행"입니다.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

export const MANUAL_ROWS = Object.freeze([
  { caseId: 's6_9_engine', step: '6~9', kind: '정상·금지', description: '판정기 규칙·탐지 사건·접속 회수의 엔진 판정',
    expected: '운영 엔진이 확인한 요청에 정상은 허용, 금지는 거부', reason: '운영 엔진이 호출하는 단계라 이 저장소에서 실제 응답을 받을 수 없습니다. 심판 결과로만 확인합니다.' },
  { caseId: 's10_restore_write', step: '10', kind: '정상', description: '미리보기 후 메모 한 건 실제 복구',
    expected: '확인 해시가 맞을 때만 한 건 복구', reason: '데이터를 바꾸는 요청이라 표 스크립트가 보내지 않습니다. 화면에서 직접 확인합니다.' },
  { caseId: 's11_approved_screen', step: '11', kind: '정상', description: '승인한 기기에서 기존 자료실 화면 열림',
    expected: '서버가 승인 기기로 확인한 뒤에만 자료 표시', reason: '기기 쿠키가 있는 브라우저 화면에서만 확인할 수 있습니다. 화면에서 직접 확인합니다.' },
  { caseId: 's12_attacks_41', step: '12', kind: '금지', description: '총공세 41종 공격 시험',
    expected: '41종 모두 방어', reason: '41종 판정은 심판 결과로만 확인합니다. 이 표의 일치 건수로 통과 처리하지 않습니다.' },
]);

function jsonOrNull(text) {
  try { return JSON.parse(text); } catch { return null; }
}

async function send({ baseUrl, fetchImpl, now, newRequestId, spec, token }) {
  const requestId = newRequestId();
  const headers = { accept: 'application/json', 'x-request-id': requestId, ...(spec.headers ?? {}) };
  if (token) headers.authorization = `Bearer ${token}`;
  if (spec.body !== undefined) headers['content-type'] = 'application/json';
  const url = spec.absoluteUrl ?? new URL(spec.path, baseUrl).href;
  try {
    const response = await fetchImpl(url, {
      method: spec.method ?? 'GET',
      headers,
      ...(spec.body !== undefined ? { body: JSON.stringify(spec.body) } : {}),
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    return {
      requestId,
      vercelId: response.headers?.get?.('x-vercel-id') ?? null,
      status: response.status,
      body: jsonOrNull(text),
      checkedAt: now().toISOString(),
    };
  } catch {
    return { requestId, vercelId: null, status: null, body: null, checkedAt: now().toISOString() };
  }
}

const describeActual = (result, extra = '') => {
  if (result.status === null) return '응답 없음(연결 오류)';
  const code = typeof result.body?.error === 'string' ? ` ${result.body.error}` : '';
  return `HTTP ${result.status}${code}${extra ? ` · ${extra}` : ''}`;
};

export async function runEvidence({
  baseUrl,
  originalApiUrl,
  publishableKey,
  fetchImpl = fetch,
  signIn = async () => null,
  env = {},
  now = () => new Date(),
  newRequestId = () => crypto.randomUUID(),
}) {
  const rows = [];
  const tokens = { A: await signIn('A'), B: await signIn('B') };
  const ctx = { baseUrl, fetchImpl, now, newRequestId };

  const add = (base, outcome) => rows.push({
    step: base.step, kind: base.kind, caseId: base.caseId, description: base.description, expected: base.expected,
    actual: outcome.actual ?? '', result: outcome.result, requestId: outcome.requestId ?? '',
    vercelId: outcome.vercelId ?? '', checkedAt: outcome.checkedAt ?? '', note: outcome.note ?? '',
  });
  const skipped = (base, reason) => add(base, { result: '미실행', actual: '', note: reason });

  async function run(base, spec, role, judge) {
    if (role && !tokens[role]) return skipped(base, `${role} 시험 계정 로그인 정보가 없거나 로그인하지 못했습니다.`);
    const result = await send({ ...ctx, spec, token: role ? tokens[role] : null });
    const verdict = judge(result);
    add(base, {
      result: verdict.ok ? '일치' : '불일치', actual: describeActual(result, verdict.extra),
      requestId: result.requestId, vercelId: result.vercelId, checkedAt: result.checkedAt,
    });
    return result;
  }

  const status = (...codes) => (result) => ({ ok: codes.includes(result.status) });

  // 1단계
  await run({ step: '1', kind: '정상', caseId: 's1_public_data', description: '공개 /data.json에 메모가 없음', expected: 'HTTP 200, notes 0건' },
    { path: '/data.json' }, null, (r) => ({ ok: r.status === 200 && Array.isArray(r.body?.notes) && r.body.notes.length === 0, extra: Array.isArray(r.body?.notes) ? `notes ${r.body.notes.length}건` : '' }));

  // 3~4단계
  await run({ step: '3~4', kind: '금지', caseId: 's3_anon_notes_list', description: '로그인 없이 메모 목록 요청', expected: 'HTTP 401 또는 403' },
    { path: '/api/notes' }, null, status(401, 403));
  await run({ step: '3~4', kind: '금지', caseId: 's3_anon_notes_create', description: '로그인 없이 메모 추가 요청(빈 본문)', expected: 'HTTP 401 또는 403' },
    { path: '/api/notes', method: 'POST', body: {} }, null, status(401, 403));
  await run({ step: '4', kind: '정상', caseId: 's4_a_notes_list', description: '시험 계정 A가 자기 메모 목록 요청', expected: 'HTTP 200, 배열' },
    { path: '/api/notes' }, 'A', (r) => ({ ok: r.status === 200 && Array.isArray(r.body), extra: Array.isArray(r.body) ? `메모 ${r.body.length}건` : '' }));

  // B의 메모 ID는 B 본인의 목록에서만 읽고, 제목·본문은 쓰지 않는다.
  let bNoteId = null;
  if (tokens.B) {
    const listing = await send({ ...ctx, spec: { path: '/api/notes' }, token: tokens.B });
    const first = Array.isArray(listing.body) ? listing.body.find((n) => typeof n?.id === 'string' && UUID.test(n.id)) : null;
    bNoteId = first?.id ?? null;
  }
  const crossBase = { step: '4', kind: '금지', caseId: 's4_cross_owner_read', description: 'A가 B의 메모 한 건을 ID로 요청', expected: 'HTTP 404' };
  if (!tokens.A || !tokens.B) skipped(crossBase, 'A와 B 두 시험 계정 로그인 정보가 모두 필요합니다.');
  else if (!bNoteId) skipped(crossBase, 'B 계정에 읽을 수 있는 메모가 없습니다.');
  else await run(crossBase, { path: `/api/notes/${bNoteId}` }, 'A', status(404));

  // 5단계
  const originalBase = { step: '5', kind: '금지', caseId: 's5_anon_original', description: '공개 키만으로 원본 자료 REST 직접 요청', expected: 'HTTP 401 또는 403' };
  if (!originalApiUrl || !publishableKey) skipped(originalBase, '원본 REST 주소 또는 공개 키 설정이 없습니다.');
  else await run(originalBase, { absoluteUrl: originalApiUrl, headers: { apikey: publishableKey } }, null, status(401, 403));

  // 10단계
  await run({ step: '10', kind: '금지', caseId: 's10_anon_restore', description: '로그인 없이 복구 요청', expected: 'HTTP 401 또는 403' },
    { path: '/api/restore', method: 'POST', body: { mode: 'preview', noteId: MISSING_ID } }, null, status(401, 403));
  await run({ step: '10', kind: '금지', caseId: 's10_invalid_mode', description: 'A가 알 수 없는 복구 방식으로 요청', expected: 'HTTP 400' },
    { path: '/api/restore', method: 'POST', body: { mode: 'bogus' } }, 'A', status(400));
  await run({ step: '10', kind: '정상', caseId: 's10_policy_preview', description: 'A가 정책 사본 버전·바뀔 항목 미리보기', expected: 'HTTP 200, applied false' },
    { path: '/api/restore', method: 'POST', body: { mode: 'policy' } }, 'A', (r) => ({ ok: r.status === 200 && r.body?.applied === false, extra: typeof r.body?.snapshotVersion === 'string' ? `사본 ${r.body.snapshotVersion}` : '' }));
  const crossPreviewBase = { step: '10', kind: '금지', caseId: 's10_cross_owner_preview', description: 'A가 B의 메모 ID로 백업 미리보기', expected: 'HTTP 404 VERIFIED_BACKUP_NOT_FOUND' };
  if (!tokens.A || !tokens.B) skipped(crossPreviewBase, 'A와 B 두 시험 계정 로그인 정보가 모두 필요합니다.');
  else if (!bNoteId) skipped(crossPreviewBase, 'B 계정에 읽을 수 있는 메모가 없습니다.');
  else await run(crossPreviewBase, { path: '/api/restore', method: 'POST', body: { mode: 'preview', noteId: bNoteId } }, 'A',
    (r) => ({ ok: r.status === 404 && r.body?.error === 'VERIFIED_BACKUP_NOT_FOUND' }));
  const ownPreviewBase = { step: '10', kind: '정상', caseId: 's10_own_preview', description: 'A가 자기 백업 메모를 미리보기(본문 없음)', expected: 'HTTP 200, 백업 해시 있음' };
  const ownId = env.ALEPH_A_BACKUP_NOTE_ID;
  if (!ownId || !UUID.test(ownId)) skipped(ownPreviewBase, 'ALEPH_A_BACKUP_NOTE_ID(A의 백업 메모 ID)가 설정되지 않았습니다.');
  else await run(ownPreviewBase, { path: '/api/restore', method: 'POST', body: { mode: 'preview', noteId: ownId } }, 'A',
    (r) => ({ ok: r.status === 200 && typeof r.body?.backupHash === 'string', extra: typeof r.body?.snapshotVersion === 'string' ? `사본 ${r.body.snapshotVersion}` : '' }));

  // 11단계
  await run({ step: '11', kind: '정상', caseId: 's11_manifest', description: '설치 정보(manifest) 열림', expected: 'HTTP 200, 앱 이름 있음' },
    { path: '/manifest.webmanifest' }, null, (r) => ({ ok: r.status === 200 && typeof r.body?.name === 'string' && r.body.name.length > 0 }));
  await run({ step: '11', kind: '금지', caseId: 's11_anon_device', description: '로그인 없이 기기 상태 요청', expected: 'HTTP 401 또는 403' },
    { path: '/api/device' }, null, status(401, 403));
  await run({ step: '11', kind: '정상', caseId: 's11_device_unregistered', description: '기기 쿠키 없는 A의 기기 상태 요청', expected: 'HTTP 200, unregistered' },
    { path: '/api/device' }, 'A', (r) => ({ ok: r.status === 200 && r.body?.state === 'unregistered', extra: typeof r.body?.state === 'string' ? `state ${r.body.state}` : '' }));
  await run({ step: '11', kind: '금지', caseId: 's11_anon_command_room', description: '로그인 없이 탈환 작전실 요청', expected: 'HTTP 401 또는 403' },
    { path: '/api/command-room' }, null, status(401, 403));
  await run({ step: '12', kind: '금지', caseId: 's12_room_without_device', description: '승인 기기 쿠키 없는 A의 탈환 작전실 요청', expected: 'HTTP 403 DEVICE_NOT_APPROVED' },
    { path: '/api/command-room' }, 'A', (r) => ({ ok: r.status === 403 && r.body?.error === 'DEVICE_NOT_APPROVED' }));

  for (const manual of MANUAL_ROWS) skipped(manual, manual.reason);

  const executed = rows.filter((row) => row.result !== '미실행');
  const summary = {
    executed: executed.length,
    matched: executed.filter((row) => row.result === '일치').length,
    mismatched: executed.filter((row) => row.result === '불일치').length,
    notRun: rows.length - executed.length,
    attacks41: '미판정 — 41종은 심판 결과로만 확인하며 이 표로 통과 처리하지 않습니다.',
  };
  return { schema: 'aleph.evidence.table.v1', baseUrl, rows, summary };
}

const cell = (value) => String(value ?? '').replaceAll('|', '／').replaceAll('\n', ' ');

export function toMarkdown(report) {
  const head = '| 단계 | 구분 | 시험 | 기대 결과 | 실제 API 결과 | 판정 | 요청 ID | 서버 요청 ID | 확인 시각 | 비고 |\n|---|---|---|---|---|---|---|---|---|---|';
  const lines = report.rows.map((row) => `| ${[row.step, row.kind, row.description, row.expected, row.actual || '—', row.result,
    row.requestId || '—', row.vercelId || '—', row.checkedAt || '—', row.note || ''].map(cell).join(' | ')} |`);
  const { summary } = report;
  return `${head}\n${lines.join('\n')}\n\n실행 ${summary.executed}건(일치 ${summary.matched} · 불일치 ${summary.mismatched}), 미실행 ${summary.notRun}건. ${summary.attacks41}\n`;
}
