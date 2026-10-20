// 확인용 읽기 모듈입니다. decide.mjs가 불러오지 않으며 원본 경보 파일은 고치지 않습니다.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_FILE = join(root, 'xdr', 'fixtures', 'web-injection.json');
const SECRET_PAIR = /\b(pass(?:word|wd)?|pwd|token|secret|api[-_]?key|key)\b\s*[=:]\s*\S+/giu;
const LONG_TOKEN = /[A-Za-z0-9+/_-]{24,}/gu;

// 비밀값처럼 보이는 문자열은 출력하지 않고 가린다.
export function mask(value) {
  return String(value ?? '').replace(SECRET_PAIR, '$1=[가림]').replace(LONG_TOKEN, '[가림]');
}

export function pickAlert(alert) {
  return {
    id: mask(alert?.id),
    timestamp: mask(alert?.timestamp),
    srcip: mask(alert?.data?.srcip),
    srcuser: mask(alert?.data?.srcuser),
    level: Number.isFinite(alert?.rule?.level) ? alert.rule.level : null,
    description: mask(alert?.rule?.description),
  };
}

export async function readAlerts(file = DEFAULT_FILE) {
  const fixture = JSON.parse(await readFile(file, 'utf8'));
  if (!Array.isArray(fixture?.alerts)) throw new Error('경보 묶음 형식이 아닙니다.');
  return { total: fixture.alerts.length, rows: fixture.alerts.map(pickAlert) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const { total, rows } = await readAlerts(process.argv[2]);
    for (const r of rows) {
      console.log([r.timestamp, r.srcip, r.srcuser, `level ${r.level}`, r.description].join(' | '));
    }
    console.log(`경보 ${total}건, 뽑은 줄 ${rows.length}줄${total === rows.length ? ' (일치)' : ' (불일치)'}`);
    if (total !== rows.length) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : '읽기 오류');
    process.exitCode = 1;
  }
}
