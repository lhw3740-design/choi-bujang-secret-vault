// decide 결과 중 차단 후보만 세션 회수(거부) 규칙 파일에 넣고, 알림은 xdr/alerts.log에 한 줄씩 쌓습니다.
// decide.mjs와 src/decider.mjs는 고치지 않습니다. 거부 규칙은 xdr/privilege/deny-rules.json에만 기록합니다.
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide } from './decide.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TTL_MS = 60 * 60 * 1000;
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/u;

function oneLine(value) {
  return String(value ?? '').replace(/[\r\n\t]+/gu, ' ').slice(0, 200);
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export async function respond({
  alerts,
  now = new Date(),
  ttlMs = TTL_MS,
  rulesPath = join(root, 'xdr', 'privilege', 'deny-rules.json'),
  logPath = join(root, 'xdr', 'alerts.log'),
}) {
  const decided = alerts.map((alert) => ({ alert, out: decide(alert) }));
  // 같은 계정이 같은 주소에서 record(정상) 판단을 받은 경보가 있으면 그 계정·주소는 막지 않는다.
  // 규칙은 계정과 출발 주소를 함께 지정한다. 같은 계정의 평소 주소 세션은 회수 대상이 아니다.
  const pairKey = (a) => `${a?.data?.srcuser}@${a?.data?.srcip}`;
  const normalPairs = new Set(decided.filter((d) => d.out.action === 'record').map((d) => pairKey(d.alert)));

  const existing = await readJson(rulesPath, { schema: 'aleph.xdr.deny-rules.v1', rules: [] });
  const live = (Array.isArray(existing.rules) ? existing.rules : [])
    .filter((r) => Date.parse(r.expiresAt) > now.getTime());
  const byIp = new Map(live.map((r) => [`${r.srcuser}@${r.srcip}`, r]));

  const seen = new Set((await readFile(logPath, 'utf8').catch(() => '')).split('\n')
    .map((line) => line.split(" ").slice(1, 3).join(" ")));
  const lines = [];
  const skipped = [];
  let added = 0;

  for (const { alert, out } of decided) {
    const id = oneLine(alert?.id);
    const ip = alert?.data?.srcip;
    if (out.action === 'block') {
      const user = alert?.data?.srcuser;
      const key = pairKey(alert);
      if (typeof ip !== 'string' || !IPV4.test(ip) || typeof user !== 'string' || !user || normalPairs.has(key)) {
        skipped.push(id);
        lines.push({ key: `${out.action} ${id}`, text: `${now.toISOString()} alert ${id} block_skipped ${oneLine(ip)} ${out.confidence} ${oneLine(out.reason)}` });
        continue;
      }
      const rule = byIp.get(key) ?? {
        id: `pv-deny-${key}`, action: 'revoke_session', srcuser: user, srcip: ip,
        createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
        alertIds: [], confidence: out.confidence, reason: out.reason,
      };
      if (!rule.alertIds.includes(id)) rule.alertIds.push(id);
      rule.confidence = Math.max(rule.confidence, out.confidence);
      if (!byIp.has(key)) { byIp.set(key, rule); added += 1; }
      lines.push({ key: `${out.action} ${id}`, text: `${now.toISOString()} ${out.action} ${id} ${user}@${ip} ${out.confidence} ${oneLine(out.reason)}` });
    } else if (out.action === 'alert') {
      lines.push({ key: `${out.action} ${id}`, text: `${now.toISOString()} ${out.action} ${id} ${oneLine(ip)} ${out.confidence} ${oneLine(out.reason)}` });
    }
  }

  await mkdir(dirname(rulesPath), { recursive: true });
  await mkdir(dirname(logPath), { recursive: true });
  const rules = [...byIp.values()];
  await writeFile(rulesPath, `${JSON.stringify({ schema: 'aleph.xdr.deny-rules.v1', rules }, null, 2)}\n`, 'utf8');
  const fresh = lines.filter((l) => !seen.has(l.key));
  if (fresh.length) await appendFile(logPath, `${fresh.map((l) => l.text).join('\n')}\n`, 'utf8');
  return { rules, added, skipped, logged: fresh.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const fixture = JSON.parse(await readFile(join(root, 'xdr', 'fixtures', 'privilege.json'), 'utf8'));
    const out = await respond({ alerts: fixture.alerts });
    console.log(`거부 규칙 ${out.rules.length}건(새로 ${out.added}건), 알림 로그 ${out.logged}줄, 건너뜀 ${out.skipped.length}건`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : '실행 오류');
    process.exitCode = 1;
  }
}
