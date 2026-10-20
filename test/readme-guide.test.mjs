import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const readme = readFileSync('README.md', 'utf8');
const guide = readme.slice(readme.indexOf('## 12단계: 설치·실행·중지·복구 재현 안내'));

test('README guide separates student work from the provided ALEPH SDP engine', () => {
  assert.match(guide, /ALEPH SDP 엔진/u);
  assert.match(guide, /학생 몫/u);
  assert.match(guide, /제공: \*\*ALEPH SDP 엔진\*\*/u);
  assert.match(guide, /git log -1 --format/u);
});

test('README guide has install, run, stop and recover sections and does not claim a pass', () => {
  for (const heading of ['### 설치', '### 실행·확인', '### 중지', '### 복구', '### 재현 순서와 한계']) {
    assert.ok(guide.includes(heading), heading);
  }
  assert.match(guide, /통과를 주장하지 않습니다/u);
});

test('every file the guide points to exists and no secret-like value is written', () => {
  for (const path of ['src/decider.mjs', 'src/detect.mjs', 'src/restore.mjs', 'restore-backup.json', 'api/command-room.js',
    'scripts/evidence-table.mjs', 'docs/DECIDER_REQUEST.md', 'docs/DETECT_EVENTS.md',
    'supabase/migrations/20261006063758_create_learning_notes.sql',
    'supabase/migrations/20261014083000_create_learning_note_backups.sql',
    'supabase/migrations/20261015060000_create_device_approvals.sql',
    'supabase/migrations/20261015010000_create_learning_test_policy_restore.sql']) {
    assert.ok(existsSync(path), path);
  }
  assert.doesNotMatch(readme, /sb_secret_|-----BEGIN [A-Z ]*PRIVATE KEY|eyJ[A-Za-z0-9_-]{12,}\.eyJ|Bearer\s+[A-Za-z0-9._~+/-]{16,}/u);
});
