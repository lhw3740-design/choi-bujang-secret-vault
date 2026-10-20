// decide 결과 중 차단 후보만 거부 규칙 파일에 넣고, 알림은 xdr/alerts.log에 한 줄씩 쌓습니다.
// decide.mjs와 src/decider.mjs는 고치지 않습니다. 거부 규칙은 xdr/persistence/deny-rules.json에만 기록합니다.
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
  rulesPath = join(root, 'xdr', 'persistence', 'deny-rules.json'),
  logPath = join(root, 'xdr', 'alerts.log'),
}) {
  const decided = alerts.map((alert) => ({ alert, out: decide(alert) }));
  // 같은 주소에서 record(정상) 판단이 나온 경보가 있으면 그 주소는 막지 않는다.
  const normalIps = new Set(decided.filter((d) => d.out.action === 'record')
    .map((d) => d.alert?.data?.srcip).filter(Boolean));

  const existing = await readJson(rulesPath, { schema: 'aleph.xdr.deny-rules.v1', rules: [] });
  const live = (Array.isArray(existing.rules) ? existing.rules : [])
    .filter((r) => Date.parse(r.expiresAt) > now.getTime());
  const byIp = new Map(live.map((r) => [r.srcip, r]));

  const seen = new Set((await readFile(logPath, 'utf8').catch(() => '')).split('\n')
    .map((line) => line.split(" ").slice(1, 3).join(" ")));
  const lines = [];
  const skipped = [];
  let added = 0;

  for (const { alert, out } of decided) {
    const id = oneLine(alert?.id);
    const ip = alert?.data?.srcip;
    if (out.action === 'block') {
      if (typeof ip !== 'string' || !IPV4.test(ip) || normalIps.has(ip)) {
        skipped.push(id);
        lines.push({ key: `${out.action} ${id}`, text: `${now.toISOString()} alert ${id} block_skipped ${oneLine(ip)} ${out.confidence} ${oneLine(out.reason)}` });
        continue;
      }
      const rule = byIp.get(ip) ?? {
        id: `ps-deny-${ip}`, action: 'deny', srcip: ip,
        createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
        alertIds: [], confidence: out.confidence, reason: out.reason,
      };
      if (!rule.alertIds.includes(id)) rule.alertIds.push(id);
      rule.confidence = Math.max(rule.confidence, out.confidence);
      if (!byIp.has(ip)) { byIp.set(ip, rule); added += 1; }
      lines.push({ key: `${out.action} ${id}`, text: `${now.toISOString()} ${out.action} ${id} ${ip} ${out.confidence} ${oneLine(out.reason)}` });
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
    const fixture = JSON.parse(await readFile(join(root, 'xdr', 'fixtures', 'persistence.json'), 'utf8'));
    const out = await respond({ alerts: fixture.alerts });
    console.log(`거부 규칙 ${out.rules.length}건(새로 ${out.added}건), 알림 로그 ${out.logged}줄, 건너뜀 ${out.skipped.length}건`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : '실행 오류');
    process.exitCode = 1;
  }
}
