import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { decide } from '../xdr/exfiltration/decide.mjs';
import { readAlerts, mask } from '../xdr/exfiltration/read-alerts.mjs';
import { respond } from '../xdr/exfiltration/respond.mjs';

const fixture = JSON.parse(await readFile(new URL('../xdr/fixtures/exfiltration.json', import.meta.url), 'utf8'));

test('decide.mjs has no imports and returns the three-field shape', async () => {
  const source = await readFile(new URL('../xdr/exfiltration/decide.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^\s*import\s|\brequire\(|\bfetch\(|\bprocess\b/mu);
  for (const alert of [...fixture.alerts, null, {}, { rule: {} }]) {
    const out = decide(alert);
    assert.deepEqual(Object.keys(out).sort(), ['action', 'confidence', 'reason']);
    assert.ok(out.confidence >= 0 && out.confidence <= 1);
  }
});

test('clear attacks block, ambiguous alert, normal record', () => {
  for (const alert of fixture.alerts) {
    const n = Number(alert.id.slice(3));
    assert.equal(decide(alert).action, n <= 10 ? 'block' : n <= 20 ? 'alert' : 'record', alert.id);
  }
});

test('patterns.json matches the constants in decide.mjs and every pattern has evidence', async () => {
  const patterns = JSON.parse(await readFile(new URL('../xdr/exfiltration/patterns.json', import.meta.url), 'utf8')).patterns;
  const source = await readFile(new URL('../xdr/exfiltration/decide.mjs', import.meta.url), 'utf8');
  for (const p of patterns) {
    assert.match(p.evidence, /T1041|T1048/u);
    for (const text of [p.name, p.condition, p.evidence]) assert.ok(source.includes(text), text);
  }
});

test('read-alerts keeps counts equal and masks secret-looking values', async () => {
  const { total, rows } = await readAlerts();
  assert.equal(total, rows.length);
  assert.match(mask('password=hunter2 token: abc'), /\[가림\]/u);
  assert.doesNotMatch(mask('x ABCDEFGHIJKLMNOPQRSTUVWXYZ0123 y'), /ABCDEF/u);
});

test('respond adds deny rules only for block candidates and never for shared normal addresses', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'xdr-'));
  const opts = { rulesPath: join(dir, 'rules.json'), logPath: join(dir, 'alerts.log'), now: new Date('2026-10-20T00:00:00Z') };
  const out = await respond({ alerts: fixture.alerts, ...opts });
  const blocked = new Set(fixture.alerts.filter((a) => Number(a.id.slice(3)) <= 10).map((a) => a.data.dstip));
  assert.deepEqual(new Set(out.rules.map((r) => r.dstip)), blocked);
  for (const r of out.rules) {
    assert.ok(Date.parse(r.expiresAt) > Date.parse(r.createdAt));
    assert.ok(r.alertIds.length > 0);
  }
  const normalPairs = new Set(fixture.alerts.filter((a) => Number(a.id.slice(3)) > 20).map((a) => a.data.dstip));
  assert.ok(out.rules.every((r) => !normalPairs.has(r.dstip)));
  const log = await readFile(opts.logPath, 'utf8');
  assert.equal(log.trim().split('\n').length, 10 + 10);
  await respond({ alerts: fixture.alerts, ...opts });
  assert.equal((await readFile(opts.logPath, 'utf8')).trim().split('\n').length, 20, '재실행해도 로그가 중복되지 않음');
  const shared = [{ id: 'x1', rule: { level: 12, description: '처음 보는 목적지로 자료가 나갔습니다.', mitre: ['T1048'] }, data: { srcip: '192.0.2.99', srcuser: 'user09', dstip: '203.0.113.99', bytes: '200000000', files: '9' } },
    { id: 'x2', rule: { level: 3, description: '반 공지를 읽었습니다.' }, data: { srcip: '192.0.2.98', srcuser: 'user09', dstip: '203.0.113.99', bytes: '2000', files: '1' } }];
  const none = await respond({ alerts: shared, ...opts, rulesPath: join(dir, 'r2.json'), logPath: join(dir, 'l2.log') });
  assert.equal(none.rules.length, 0);
});
