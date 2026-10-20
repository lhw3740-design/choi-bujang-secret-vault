import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { supabasePublishableKey, supabaseUrl } from '../public/supabase-config.js';
import { runEvidence, toMarkdown } from '../src/evidence.mjs';

const root = resolve(import.meta.dirname, '..');
const config = JSON.parse(readFileSync(join(root, 'aleph.config.json'), 'utf8'));
const baseUrl = config.publicAppUrl;

// 시험 계정 로그인 정보는 환경변수로만 받고, 파일·출력·Git에 남기지 않습니다.
async function signIn(role) {
  const email = process.env[`ALEPH_EMAIL_${role}`];
  const password = process.env[`ALEPH_PASSWORD_${role}`];
  if (!email || !password) return null;
  try {
    const client = createClient(supabaseUrl, supabasePublishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    return error ? null : data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

try {
  const app = new URL(baseUrl);
  if (app.protocol !== 'https:') throw new Error('aleph.config.json의 publicAppUrl이 실제 https 배포 주소여야 합니다.');
  const report = await runEvidence({
    baseUrl, originalApiUrl: config.originalApiUrl, publishableKey: supabasePublishableKey,
    signIn, env: process.env,
  });
  mkdirSync(join(root, 'artifacts'), { recursive: true });
  writeFileSync(join(root, 'artifacts', 'evidence-table.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const markdown = toMarkdown(report);
  writeFileSync(join(root, 'artifacts', 'evidence-table.md'), markdown, 'utf8');
  process.stdout.write(`${markdown}\n저장: artifacts/evidence-table.md, artifacts/evidence-table.json (Git에 올리지 않습니다)\n`);
  if (report.summary.mismatched > 0) process.exitCode = 2;
} catch (error) {
  process.stderr.write(`시험 결과표 생성 중 첫 오류: ${error.message}\n`);
  process.exitCode = 1;
}
