// 이 파일은 다른 파일·패키지를 불러오지 않고, 파일을 읽거나 쓰지 않으며, 바깥에 묻지 않고 혼자 계산합니다.
// 근거: MITRE ATT&CK T1110. 아래 상수는 patterns.json의 내용을 옮겨 적은 것입니다.
const PATTERNS = Object.freeze([
  Object.freeze({
    name: 'burst_same_ip_failures',
    condition: '짧은 시간 같은 주소·같은 계정의 로그인 실패가 30건 이상 연속',
    evidence: 'T1110.001 Password Guessing: 한 계정에 비밀번호를 반복 대입해 맞추는 형태',
  }),
  Object.freeze({
    name: 'password_spray_multi_account',
    condition: '같은 주소가 여러 계정(8개 이상)에 같은 비밀번호를 연속으로 대입',
    evidence: 'T1110.003 Password Spraying: 흔한 비밀번호 하나를 많은 계정에 시도해 잠금을 피하는 형태',
  }),
  Object.freeze({
    name: 'password_mutation_guessing',
    condition: '비밀번호를 한 글자씩 바꿔 가며 실패가 15건 이상 이어짐',
    evidence: 'T1110.001 Password Guessing: 변형 후보를 차례로 대입하는 추측 형태',
  }),
]);

const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
const [BURST, SPRAY, MUTATION] = PATTERNS.map((p) => p.name);

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

  const samePassword = /같은 비밀번호/u.test(description);
  const isFailure = /실패/u.test(description) || samePassword;
  if (!isFailure) return result(0.1, '로그인 실패가 없는 일반 이벤트');

  const succeeded = /성공/u.test(description.replace(/성공은 없/gu, ''));
  const count = toInt(data.count) || toInt(description.match(/실패\s*(\d+)\s*건/u)?.[1]);
  const listed = typeof data.accounts === 'string' ? data.accounts.split(',').filter(Boolean).length : 0;
  const accounts = Math.max(listed, toInt(description.match(/계정\s*(\d+)\s*개/u)?.[1]));
  const mutation = /한 글자씩 바꿔/u.test(description);
  const rotating = /계정 이름을 바꿔|여러 계정|계정\s*\d+\s*개/u.test(description);

  let confidence;
  let reason;
  if (samePassword && accounts >= 8) {
    confidence = 0.9; reason = SPRAY;
  } else if (accounts >= 10 && count >= accounts) {
    confidence = 0.88; reason = SPRAY;
  } else if (mutation && count >= 15) {
    confidence = 0.9; reason = MUTATION;
  } else if (count >= 30) {
    confidence = rotating ? 0.93 : 0.92; reason = BURST;
  } else if (samePassword || count >= 5) {
    confidence = 0.55 + Math.min(Math.max(level, 0), 9) * 0.01; reason = samePassword ? SPRAY : BURST;
  } else if (count >= 3 && level >= 5) {
    confidence = 0.5; reason = BURST;
  } else {
    return result(0.2, '실패가 적어 패턴에 맞지 않음');
  }

  // 로그인 성공이 섞인 경우는 정상 사용자일 수 있어 차단까지 가지 않고 알림에서 멈춘다.
  if (succeeded) confidence = Math.min(confidence, 0.7);
  // 규칙 수준이 낮으면 확신을 올리지 않는다.
  if (confidence >= BLOCK_AT && level < 10) confidence = 0.8;
  return result(confidence, `${reason}: ${PATTERNS.find((p) => p.name === reason).evidence.split(':')[0]}`);
}
