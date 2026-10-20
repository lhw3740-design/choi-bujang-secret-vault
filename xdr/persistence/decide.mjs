// 이 파일은 다른 파일·패키지를 불러오지 않고, 파일을 읽거나 쓰지 않으며, 바깥에 묻지 않고 혼자 계산합니다.
// 근거: MITRE ATT&CK T1543, T1053, T1547.001. 아래 상수는 patterns.json의 내용을 옮겨 적은 것입니다.
const PATTERNS = Object.freeze([
  Object.freeze({
    name: 'unsigned_service_registration',
    condition: '서명 없는 새 서비스가 등록되거나 서비스 실행 파일이 서명 없이 바뀌고, 임시 폴더 실행 파일·평소 목록에 없음·연속 등록이 함께 있음',
    evidence: 'T1543: 서비스를 만들거나 바꿔 재부팅 뒤에도 악성 프로그램이 다시 실행되게 하는 지속 형태',
  }),
  Object.freeze({
    name: 'unfamiliar_scheduled_task',
    condition: '처음 보는 예약 작업이 임시 폴더의 프로그램이나 수업 시간 밖·임의 이름으로 실행',
    evidence: 'T1053: 예약 작업으로 프로그램을 정해진 때마다 실행해 지속하는 형태',
  }),
  Object.freeze({
    name: 'startup_folder_change',
    condition: '시작 폴더·시작 프로그램에 평소 목록에 없는 프로그램이 추가됨',
    evidence: 'T1547.001 Startup Folder: 로그온 때마다 실행되도록 시작 폴더에 항목을 넣는 지속 형태(경보는 T1543으로 표기)',
  }),
]);

const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
const [SERVICE, TASK, STARTUP] = PATTERNS.map((p) => p.name);

const IS_SERVICE = /서비스/u;
const IS_TASK = /예약 작업/u;
const IS_STARTUP = /시작 (?:폴더|프로그램|항목)/u;
// 이미 믿을 수 있다고 밝힌 정상 경보(서명됨·평소 시각·읽기만 등)는 지속 형태로 세지 않는다.
const BENIGN = /서명된 채|평소 시각|읽기만|평소 저장소|마쳤습니다|로그인했|로그아웃|열렸습니다/u;

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
  const path = typeof data.path === 'string' ? data.path : '';
  const mitre = Array.isArray(alert?.rule?.mitre) ? alert.rule.mitre : [];
  const count = toInt(data.count);

  const service = IS_SERVICE.test(description) || (mitre.includes('T1543') && !IS_STARTUP.test(description));
  const task = IS_TASK.test(description) || (mitre.length === 1 && mitre[0] === 'T1053');
  const startup = IS_STARTUP.test(description) || /\\Startup\\/iu.test(path);
  const kinds = [service && !startup ? SERVICE : null, task ? TASK : null, startup ? STARTUP : null].filter(Boolean);
  const mechanism = IS_SERVICE.test(description) || IS_TASK.test(description) || startup;
  const benign = BENIGN.test(description);

  // 증거 신호: 서명 없음, 임시 폴더 실행 파일, 평소와 다름, 시작 폴더 경로, 연속 등록, 두 방식이 같은 파일을 가리킴.
  const signals = [
    /서명 없는|서명이 없습니다/u.test(description),
    /\\Temp\\/iu.test(path) || /임시 폴더/u.test(description),
    /처음 보는|평소 목록에 없는|임의 문자열|수업 시간 밖|다시 켜도 남도록/u.test(description),
    /\\Startup\\/iu.test(path),
    count >= 3,
    /함께 가리킵니다/u.test(description),
  ].filter(Boolean).length;
  const reason = kinds.length ? kinds.join('+') : SERVICE;

  if (!benign && mechanism && signals >= 2 && level >= 10) {
    return result(0.8 + Math.min(signals, 4) * 0.04, reason);
  }
  // 새 항목이나 낯선 파일의 단서가 하나뿐이거나 서명을 아직 모르는 중간 수준 경보는 알림으로만 남긴다.
  if (!benign && level >= 5 && (mitre.length > 0 || signals > 0)) {
    return result(0.5 + Math.min(Math.max(level - 5, 0), 4) * 0.02 + Math.min(signals, 2) * 0.03, reason);
  }
  return result(0.1, '새로 심어진 지속 항목 단서가 없는 일반 이벤트');
}
