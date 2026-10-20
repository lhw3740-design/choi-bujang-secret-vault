// 이 파일은 다른 파일·패키지를 불러오지 않고, 파일을 읽거나 쓰지 않으며, 바깥에 묻지 않고 혼자 계산합니다.
// 근거: MITRE ATT&CK T1190. 아래 상수는 patterns.json의 내용을 옮겨 적은 것입니다.
const PATTERNS = Object.freeze([
  Object.freeze({
    name: 'sql_injection_repeat',
    condition: '같은 주소의 요청 인자에 SQL 구문 표기가 8번 이상 반복',
    evidence: 'T1190: 외부에 공개된 앱의 입력 인자에 SQL을 이어 붙여 앱 취약점을 악용하는 형태',
  }),
  Object.freeze({
    name: 'script_injection_repeat',
    condition: '같은 주소의 요청 인자에 스크립트 태그·삽입 표기가 8번 이상 반복',
    evidence: 'T1190: 외부에 공개된 앱의 입력 칸에 스크립트를 밀어 넣어 앱 취약점을 악용하는 형태',
  }),
  Object.freeze({
    name: 'path_traversal_repeat',
    condition: '같은 주소의 요청 경로에 상위 폴더로 거슬러 올라가는 표기(../)가 8번 이상 반복',
    evidence: 'T1190: 공개된 앱의 파일 경로 인자를 이용해 허용 범위 밖 자료를 노리는 형태',
  }),
  Object.freeze({
    name: 'command_separator_repeat',
    condition: '같은 주소의 연속 요청 인자에 명령 구분자 표기가 8번 이상 반복',
    evidence: 'T1190: 공개된 앱의 입력 인자에 명령을 이어 붙여 앱 취약점을 악용하는 형태',
  }),
]);

const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
const REPEAT_AT = 8;
const [SQL, SCRIPT, TRAVERSAL, COMMAND] = PATTERNS.map((p) => p.name);

// 패턴별로 설명과 요청 주소에서 찾는 표기. 수업 단어(select-course 등)는 표기가 아니라 반복이 있어야 센다.
const MARKERS = Object.freeze([
  [SQL, /SQL\s*(?:구문|표식)|데이터베이스 조회|doc-sql|union\s+select|['"]\s*or\s+\S+\s*=|;\s*drop\s/iu],
  [SCRIPT, /스크립트\s*(삽입|표식)|doc-script|<\s*script|javascript:|onerror\s*=/iu],
  [TRAVERSAL, /거슬러|경로 이탈|doc-up-repeat|(?:\.\.\/|%2e%2e%2f){2,}/iu],
  [COMMAND, /명령 구분자|doc-cmd|[;|&]\s*(?:cat|ls|rm|wget|curl|id)\b|\$\(/iu],
]);
// 약한 단서: 한 번만 나온 SQL·script·up·따옴표·구분 문자 같은 낱말. 알림 근거로만 쓴다.
const WEAK = Object.freeze([
  [SQL, /SQL|select|따옴표|주입처럼/iu],
  [SCRIPT, /스크립트|script/iu],
  [TRAVERSAL, /\bup\b|경로/iu],
  [COMMAND, /구분 문자/u],
]);

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

function matched(table, text) {
  return table.filter(([, re]) => re.test(text)).map(([name]) => name);
}

export function decide(alert) {
  const description = typeof alert?.rule?.description === 'string' ? alert.rule.description : '';
  const level = Number.isFinite(alert?.rule?.level) ? alert.rule.level : 0;
  const data = alert && typeof alert.data === 'object' && alert.data ? alert.data : {};
  let url = typeof data.url === 'string' ? data.url : '';
  try { url = decodeURIComponent(url); } catch { /* 해석할 수 없으면 원문 그대로 본다 */ }
  const text = `${description} ${url}`;
  const tagged = Array.isArray(alert?.rule?.mitre) && alert.rule.mitre.includes('T1190');
  const count = Math.max(toInt(data.count), toInt(description.match(/(\d+)\s*번/u)?.[1]));
  // 설명이 스스로 "표식이 아님/공격 표기 없음"이라고 밝힌 경보는 차단하지 않는다.
  const denied = /아닙니다|공격 표기는 없습니다/u.test(description);

  const strong = matched(MARKERS, text);
  if (strong.length && count >= REPEAT_AT && level >= 10 && !denied) {
    const mixed = strong.length > 1;
    return result(mixed ? 0.93 : 0.88 + Math.min(count, 20) * 0.002, strong.join('+'));
  }
  if (strong.length && count >= 3 && !denied) {
    return result(0.6 + Math.min(count, 7) * 0.02, strong.join('+'));
  }
  // 반복 없는 단서나 T1190 표시가 붙은 중간 수준 경보는 알림으로만 남긴다.
  if (level >= 5 && (tagged || strong.length)) {
    const weak = [...strong, ...matched(WEAK, text)];
    const name = weak.length ? weak[0] : '근거 패턴 불분명';
    return result(0.5 + Math.min(Math.max(level - 5, 0), 4) * 0.02, name);
  }
  return result(0.1, '주입 표기가 없는 일반 요청');
}
