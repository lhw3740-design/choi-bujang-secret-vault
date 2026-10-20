// 이 파일은 다른 파일·패키지를 불러오지 않고, 파일을 읽거나 쓰지 않으며, 바깥에 묻지 않고 혼자 계산합니다.
// 근거: CVE-2021-44228 형태 요청, MITRE ATT&CK T1190. 아래 상수는 patterns.json의 내용을 옮겨 적은 것입니다.
const PATTERNS = Object.freeze([
  Object.freeze({
    name: 'jndi_lookup_in_header',
    condition: '요청 머리글(User-Agent 등) 값에 jndi 원격 조회 구문(${jndi:프로토콜://주소/...})이 완전한 형태로 있음',
    evidence: 'CVE-2021-44228: 로그에 남는 머리글 값 안의 jndi 조회 구문이 오래된 로그 라이브러리의 원격 조회를 일으키는 형태',
  }),
  Object.freeze({
    name: 'jndi_lookup_in_url',
    condition: '요청 주소·인자에 jndi 원격 조회 구문이 완전한 형태로 있고, 반복되면 확신을 높임',
    evidence: 'CVE-2021-44228: 주소 인자 안의 jndi 조회 구문으로 같은 취약점을 노리는 형태(T1190)',
  }),
  Object.freeze({
    name: 'known_scanner_trace',
    condition: '알려진 취약점 점검 도구의 흔적(점검 주소·도구 이름)이 있고, 위 조회 구문이 함께 있으면 확신을 높임',
    evidence: 'T1190: 공개된 앱의 알려진 취약점을 점검 도구로 훑은 뒤 악용하는 형태',
  }),
]);

const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
const [HEADER, URL_P, SCANNER] = PATTERNS.map((p) => p.name);

// 완전한 조회 구문: ${jndi:프로토콜://...}. 단어 jndi, CVE 번호, 중괄호만 있는 것은 구문이 아니다.
const FULL_LOOKUP = /\$\{\s*jndi\s*:\s*(?:ldaps?|rmi|dns|iiop|https?):\/\/[^\s}]+\}/iu;
const HEADER_KEYS = Object.freeze(['useragent', 'referer', 'x_forwarded_for', 'header', 'headers']);
const SCANNER_RE = /점검 (?:도구|흔적)|scanner|nuclei|nessus|probe=/iu;
const NEGATED = /구문은 없습니다|구문은 아닙니다|악용 구문은 없습니다|글자만 있습니다/u;

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

function decoded(value) {
  const text = typeof value === 'string' ? value : '';
  try { return decodeURIComponent(text); } catch { return text; }
}

export function decide(alert) {
  const description = typeof alert?.rule?.description === 'string' ? alert.rule.description : '';
  const level = Number.isFinite(alert?.rule?.level) ? alert.rule.level : 0;
  const data = alert && typeof alert.data === 'object' && alert.data ? alert.data : {};
  const tagged = Array.isArray(alert?.rule?.mitre) && alert.rule.mitre.includes('T1190');
  const count = toInt(data.count) || toInt(description.match(/(\d+)\s*번/u)?.[1]);
  const negated = NEGATED.test(description);

  const inHeader = HEADER_KEYS.some((key) => FULL_LOOKUP.test(decoded(data[key])));
  const inUrl = FULL_LOOKUP.test(decoded(data.url));
  const scanner = SCANNER_RE.test(`${description} ${decoded(data.url)} ${decoded(data.useragent)}`);

  if ((inHeader || inUrl) && !negated) {
    const names = [inHeader ? HEADER : null, inUrl ? URL_P : null, scanner ? SCANNER : null].filter(Boolean);
    let confidence = 0.88 + (inHeader && inUrl ? 0.05 : 0) + (scanner ? 0.02 : 0)
      + Math.min(count, 8) * 0.003;
    // 규칙 수준이 낮은 경보는 구문이 있어도 차단까지 가지 않고 알림에서 멈춘다.
    if (level < 10) confidence = 0.8;
    return result(confidence, names.join('+'));
  }
  // 구문은 없지만 취약점·도구·형태의 단서가 있는 중간 수준 경보는 알림으로만 남긴다.
  if (level >= 5 && (tagged || scanner)) {
    const name = scanner ? SCANNER : /jndi|중괄호|머리글/iu.test(`${description} ${decoded(data.url)}`) ? HEADER : URL_P;
    return result(0.5 + Math.min(Math.max(level - 5, 0), 4) * 0.02 + Math.min(count, 3) * 0.01, name);
  }
  return result(0.1, '알려진 악용 형태가 없는 일반 요청');
}
