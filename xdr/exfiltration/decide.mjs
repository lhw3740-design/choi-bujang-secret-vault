// 이 파일은 다른 파일·패키지를 불러오지 않고, 파일을 읽거나 쓰지 않으며, 바깥에 묻지 않고 혼자 계산합니다.
// 근거: MITRE ATT&CK T1041, T1048. 아래 상수는 patterns.json의 내용을 옮겨 적은 것입니다.
const PATTERNS = Object.freeze([
  Object.freeze({
    name: 'large_transfer_new_destination',
    condition: '처음 보는 목적지(또는 평소 쓰지 않던 포트)로 50MB 이상 대용량 전송이 나가고, 파일이 많거나 자료실 전체를 복사함',
    evidence: 'T1048: 평소 쓰지 않는 경로·목적지로 자료를 한꺼번에 내보내는 유출 형태',
  }),
  Object.freeze({
    name: 'archive_exfil_off_hours',
    condition: '수업·업무 시간 밖에 압축 파일이 처음 보는 주소로 나가거나 압축 파일이 연속으로 올라감',
    evidence: 'T1048: 자료를 압축해 묶은 뒤 눈에 덜 띄는 시간에 반출하는 유출 형태',
  }),
  Object.freeze({
    name: 'command_channel_repeated_transfer',
    condition: '같은 목적지로 대용량 전송이 8번 이상 반복되거나 명령 통로로 큰 파일이 반복 전송됨',
    evidence: 'T1041: 공격자가 쓰는 명령 통로로 자료를 나눠 반복해서 빼내는 유출 형태',
  }),
]);

const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
const BIG_BYTES = 50_000_000;
const REPEAT_AT = 8;
const [LARGE, ARCHIVE, CHANNEL] = PATTERNS.map((p) => p.name);

// 이미 괜찮다고 밝힌 표현(평소 목적지·수업 자료 주소·실패·아직 전송 없음 등)은 차단 근거로 세지 않는다.
const BENIGN = /평소 목적지|수업 자료 주소|실패 \d+건|전송은 아직 없|전송은 없습니다|읽었습니다|저장했습니다|열었습니다|받았습니다|로그아웃|새로고침|동기화가 끝/u;

function toInt(value) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function clamp(n) {
  return Math.min(1, Math.max(0, Math.round(n * 100) / 100));
}

function result(confidence, reason) {
  const c = clamp(confidence);
  const action = c >= BLOCK_AT ? 'block' : c >= ALERT_AT ? 'alert' : 'record';
  return { action, confidence: c, reason };
}

export function decide(alert) {
  const description = typeof alert?.rule?.description === 'string' ? alert.rule.description : '';
  const level = Number.isFinite(alert?.rule?.level) ? alert.rule.level : 0;
  const data = alert && typeof alert.data === 'object' && alert.data ? alert.data : {};
  const mitre = Array.isArray(alert?.rule?.mitre) ? alert.rule.mitre : [];
  const bytes = toInt(data.bytes);
  const files = toInt(data.files);
  const count = Math.max(toInt(data.count), toInt(description.match(/(\d+)\s*번/u)?.[1]));
  const hour = Number.parseInt(String(alert?.timestamp ?? '').match(/T(\d\d):/u)?.[1] ?? '', 10);

  const big = bytes >= BIG_BYTES;
  const newDestination = /처음 보는|평소에 쓰지 않던 포트/u.test(description);
  const bulk = files >= 50 || /자료실 전체/u.test(description);
  const repeated = count >= REPEAT_AT;
  const archive = /압축 파일/u.test(description);
  const offHours = /수업 시간 밖|업무 시간 밖/u.test(description) || (Number.isFinite(hour) && (hour < 7 || hour >= 20));
  const channel = /명령 통로/u.test(description) || (repeated && /같은 목적지/u.test(description));

  const kinds = [newDestination || bulk ? LARGE : null, archive && (offHours || newDestination) ? ARCHIVE : null,
    channel || repeated ? CHANNEL : null].filter(Boolean);
  const signals = [newDestination, bulk, repeated, offHours, archive].filter(Boolean).length;
  const reason = kinds.length ? kinds.join('+') : archive ? ARCHIVE : channel ? CHANNEL : LARGE;

  // 대용량이면서 낯선 목적지·반복·시간 밖·대량 복사 중 하나라도 겹치고 규칙 수준이 높으면 차단 후보다.
  if (big && signals >= 1 && level >= 10 && !BENIGN.test(description)) {
    return result(0.84 + Math.min(signals, 3) * 0.03 + (bytes >= 100_000_000 ? 0.02 : 0), reason);
  }
  // 용량이 작거나 단서가 하나뿐인 중간 수준 경보는 알림으로만 남긴다.
  if (level >= 5 && mitre.length > 0) {
    return result(0.5 + Math.min(Math.max(level - 5, 0), 4) * 0.02 + Math.min(signals, 2) * 0.02, reason);
  }
  return result(0.1, '평소 목적지로 가는 작은 일반 전송');
}
