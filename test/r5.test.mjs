import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deploymentIdentity } from '../scripts/deployment-identity.mjs';
import { runAttackChecks } from '../src/attack-check.mjs';
import { supabasePublishableKey } from '../public/supabase-config.js';

const config = {
  step: 1,
  judgeIssuer: 'https://aleph-judge-production.up.railway.app/defense/judge',
  sampleMarker: 'SAMPLE_NOTE_1',
  publicAppUrl: 'https://student-defense.vercel.app',
};
const env = {
  VERCEL_GIT_PROVIDER: 'github',
  VERCEL_GIT_REPO_OWNER: 'Student-A',
  VERCEL_GIT_REPO_SLUG: 'aleph-defense',
  VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40),
  VERCEL_URL: 'student-defense-123.vercel.app',
};

test('build identity uses Vercel Git and deployment metadata', () => {
  assert.deepEqual(deploymentIdentity(env, config), {
    schema: 'aleph.defense.deployment.v1',
    step: 1,
    repoUrl: 'https://github.com/student-a/aleph-defense',
    commit: 'a'.repeat(40),
    publicAppUrl: 'https://student-defense-123.vercel.app',
    judgeIssuer: config.judgeIssuer,
    sampleMarker: config.sampleMarker,
  });
  assert.throws(() => deploymentIdentity({ ...env, VERCEL_GIT_PROVIDER: undefined }, config));
  assert.throws(() => deploymentIdentity({ ...env, VERCEL_GIT_COMMIT_SHA: 'short' }, config));
});

test('build identity preserves the configured defense step', () => {
  const identity = deploymentIdentity(env, { ...config, step: 3 });
  assert.equal(identity.step, 3);
  assert.equal('sampleMarker' in identity, false);
});

test('fifth-stage build identity includes only a valid query-free HTTPS original API URL', () => {
  const originalApiUrl = 'https://example.supabase.co/rest/v1/learning_notes';
  const identity = deploymentIdentity(env, {
    ...config,
    step: 5,
    originalApiUrl,
  });
  assert.equal(identity.originalApiUrl, originalApiUrl);
  assert.throws(() => deploymentIdentity(env, {
    ...config,
    step: 5,
    originalApiUrl: 'https://example.supabase.co/rest/v1/learning_notes?select=*',
  }));
  assert.throws(() => deploymentIdentity(env, {
    ...config,
    step: 5,
    originalApiUrl: 'http://example.supabase.co/rest/v1/learning_notes',
  }));
});

test('first attack check reads public data.json without credentials', async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl;
  let options;
  try {
    globalThis.fetch = async (url, init) => {
      requestUrl = String(url);
      options = init;
      return new Response(JSON.stringify({ sampleMarker: 'SAMPLE_NOTE_1', notes: [{ title: '가상' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const [result] = await runAttackChecks(config);
    assert.equal(requestUrl, 'https://student-defense.vercel.app/data.json');
    assert.equal(options.redirect, 'error');
    assert.match(result.observed, /확인 표시가 보임/u);
    globalThis.fetch = async () => new Response('<html>not the data</html>', { status: 200 });
    const [failed] = await runAttackChecks(config);
    assert.match(failed.observed, /보이지 않음/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('third- and fourth-stage attack checks record the unauthenticated API response only', async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl;
  let options;
  try {
    globalThis.fetch = async (url, init) => {
      requestUrl = String(url);
      options = init;
      return Response.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });
    };
    for (const step of [3, 4]) {
      const [result] = await runAttackChecks({
        ...config,
        step,
        sampleMarker: undefined,
      });
      assert.equal(requestUrl, 'https://student-defense.vercel.app/api/notes');
      assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'error');
      assert.equal('authorization' in options.headers, false);
      assert.deepEqual(result, {
        attackId: 'anonymous_note_read',
        expected: '비로그인 목록 요청이 401 또는 403 JSON 오류로 거부됨',
        observed: '인증 없는 GET /api/notes: HTTP 401, JSON 오류 응답 확인',
      });
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fifth- and sixth-stage attack checks send anonymous requests to the original API and notes function', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const step of [5, 6]) {
      const requests = [];
      globalThis.fetch = async (url, init) => {
        requests.push({ url: String(url), options: init });
        return String(url).includes('supabase.co')
          ? Response.json({ message: 'permission denied', details: 'not included in report' }, {
            status: 403,
          })
          : Response.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });
      };
      const results = await runAttackChecks({
        ...config,
        step,
        originalApiUrl: 'https://example.supabase.co/rest/v1/learning_notes',
        sampleMarker: undefined,
      });
      assert.equal(requests[0].url, 'https://example.supabase.co/rest/v1/learning_notes');
      assert.equal(requests[0].options.method, 'GET');
      assert.equal(requests[0].options.headers.apikey, supabasePublishableKey);
      assert.equal(requests[0].options.redirect, 'error');
      assert.equal(requests[1].url, 'https://student-defense.vercel.app/api/notes');
      assert.equal(requests[1].options.method, 'GET');
      assert.equal('authorization' in requests[1].options.headers, false);
      assert.deepEqual(results, [{
        attackId: 'anonymous_original_read',
        expected: 'anon 키의 원본 자료 요청이 권한 오류로 거부됨',
        observed: '익명 원본 GET: HTTP 403, JSON 오류 응답 확인',
      }, {
        attackId: 'anonymous_note_read',
        expected: '비로그인 목록 요청이 401 또는 403 JSON 오류로 거부됨',
        observed: '인증 없는 GET /api/notes: HTTP 401, JSON 오류 응답 확인',
      }]);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
