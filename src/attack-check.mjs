import { supabasePublishableKey } from '../public/supabase-config.js';

// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.
export async function runAttackChecks(config) {
  if (config.step !== 1 && config.step !== 3 && config.step !== 4 && config.step !== 5) {
    throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
  }
  let app;
  try {
    app = new URL(config.publicAppUrl);
  } catch {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  if (app.protocol !== 'https:' || app.username || app.password || app.search || app.hash
      || app.pathname !== '/' || app.hostname.endsWith('.example')) {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  if (config.step === 5) {
    let originalApi;
    try {
      originalApi = new URL(config.originalApiUrl);
    } catch {
      throw new Error('5단계 원본 자료 API의 HTTPS 주소를 aleph.config.json에 넣어 주세요.');
    }
    if (originalApi.protocol !== 'https:' || originalApi.username || originalApi.password
        || originalApi.search || originalApi.hash || !supabasePublishableKey.trim()) {
      throw new Error('5단계 원본 자료 API 주소와 공개 publishable key를 확인해 주세요.');
    }
    const response = await fetch(originalApi, {
      method: 'GET',
      headers: { accept: 'application/json', apikey: supabasePublishableKey },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    const responseText = await response.text();
    let body;
    try {
      body = JSON.parse(responseText);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      return [{
        attackId: 'anonymous_original_read',
        expected: 'anon 키의 원본 자료 요청이 권한 오류로 거부됨',
        observed: `익명 원본 GET: HTTP ${response.status}, JSON 오류 응답 아님`,
      }];
    }
    const rejected = (response.status === 401 || response.status === 403)
      && (typeof body?.message === 'string' || typeof body?.error === 'string');
    const originalResult = {
      attackId: 'anonymous_original_read',
      expected: 'anon 키의 원본 자료 요청이 권한 오류로 거부됨',
      observed: rejected
        ? `익명 원본 GET: HTTP ${response.status}, JSON 오류 응답 확인`
        : `익명 원본 GET: HTTP ${response.status}, 자료 접근 거부 확인 안 됨`,
    };
    return [originalResult, await checkAnonymousNotesApi(app)];
  }
  if (config.step === 3 || config.step === 4) return [await checkAnonymousNotesApi(app)];
  if (typeof config.sampleMarker !== 'string' || !config.sampleMarker) throw new Error('가상 메모의 확인 표시를 넣어 주세요.');
  const response = await fetch(new URL('/data.json', app), {
    redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  let visible = false;
  if (response.ok) {
    try {
      const data = await response.json();
      visible = data?.sampleMarker === config.sampleMarker && Array.isArray(data.notes)
        && data.notes.length > 0;
    } catch {
      // A non-JSON response is a failed check, not a successful deployment.
    }
  }
  return [{ attackId: 'anonymous_note_read', expected: '비로그인 화면에서 가상 메모를 확인',
    observed: visible ? '비로그인 요청에서 공개 가상 메모 확인 표시가 보임' : `비로그인 요청에서 확인 표시가 보이지 않음 (HTTP ${response.status})` }];
}

async function checkAnonymousNotesApi(app) {
  const response = await fetch(new URL('/api/notes', app), {
    method: 'GET',
    headers: { accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  const responseText = await response.text();
  let body;
  try {
    body = JSON.parse(responseText);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return {
      attackId: 'anonymous_note_read',
      expected: '비로그인 목록 요청이 401 또는 403 JSON 오류로 거부됨',
      observed: `인증 없는 GET /api/notes: HTTP ${response.status}, JSON 오류 응답 아님`,
    };
  }
  const rejected = (response.status === 401 || response.status === 403)
    && typeof body?.error === 'string' && body.error.length > 0;
  return {
    attackId: 'anonymous_note_read',
    expected: '비로그인 목록 요청이 401 또는 403 JSON 오류로 거부됨',
    observed: rejected
      ? `인증 없는 GET /api/notes: HTTP ${response.status}, JSON 오류 응답 확인`
      : `인증 없는 GET /api/notes: HTTP ${response.status}, ${typeof body?.error === 'string' ? 'JSON 오류 응답' : '거부 오류 없는 JSON 응답'}`,
  };
}
