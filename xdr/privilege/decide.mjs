// 이 파일은 다른 파일·패키지를 불러오지 않고, 파일을 읽거나 쓰지 않으며, 바깥에 묻지 않고 혼자 계산합니다.
// 근거: MITRE ATT&CK T1068, T1078. 아래 상수는 patterns.json의 내용을 옮겨 적은 것입니다.
const PATTERNS = Object.freeze([
  Object.freeze({
    name: 'admin_group_added',
    condition: '평범한 계정이 관리자 그룹에 추가되거나(처음 보는 주소·여러 계정 동시·빠졌다 다시 들어옴) 관리자 권한으로 바뀜',
    evidence: 'T1078: 정상 계정을 얻은 공격자가 관리자 권한을 붙여 더 깊이 들어가는 형태',
  }),
  Object.freeze({
    name: 'unfamiliar_admin_command',
    condition: '방금 권한을 얻은 계정이거나 처음 보는 주소·다른 계정의 권한으로 관리자 명령을 실행',
    evidence: 'T1068: 권한 상승을 악용해 평소에 쓰지 않던 관리자 명령을 실행하는 형태',
  }),
  Object.freeze({
    name: 'off_hours_privilege_use',
    condition: '수업·업무 시간 밖에 관리자 그룹 추가나 관리자 명령이 일어남',
    evidence: 'T1078: 정상 계정을 도용한 접속은 평소 이용 시간 밖에 권한을 쓰는 경우가 많음',
  }),
]);

const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
const [GROUP, COMMAND, OFFHOURS] = PATTERNS.map((p) => p.name);

// 이미 괜찮다고 밝힌 표현(취소·변경 없음·실패·평소 주소·읽기만·관리자 그룹이 아님)은 차단 근거로 세지 않는다.
const BENIGN = /취소됐|변경은 없습니다|명령은 없습니다|실패 \d+건|평소 주소|읽기만|설명만|관리자 그룹은 아닙니다|조회|로그인|로그아웃|열었습니다|변경했습니다|확인했습니다/u;

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
  const count = toInt(data.count);
  const hour = Number.parseInt(String(alert?.timestamp ?? '').match(/T(\d\d):/u)?.[1] ?? '', 10);

  const addedToAdmin = !/관리자 그룹은 아닙니다/u.test(description)
    && (/관리자 그룹(?:에|에서)?[^.]*(?:추가|들어)/u.test(description) || /관리자 권한으로 바뀌/u.test(description)
      || (data.group === 'administrators' && /추가|들어/u.test(description)));
  const adminCommand = /관리자 명령을 실행했습니다|권한 명령을 실행했습니다|명령 실행이 같이/u.test(description);
  const stolen = /다른 계정의 권한으로|방금 관리자가 된|곧바로|다시 관리자로 들어왔/u.test(description);
  const newAddress = /처음 보는 주소|처음 봅니다|원격 주소/u.test(description);
  const offHours = /수업 시간 밖|업무처럼 보이지 않는/u.test(description) || (Number.isFinite(hour) && (hour < 7 || hour >= 20));
  const bulk = count >= 4;
  const flap = /다시 관리자로 들어왔/u.test(description);

  const kinds = [addedToAdmin || bulk || flap ? GROUP : null, adminCommand ? COMMAND : null,
    offHours && (addedToAdmin || adminCommand) ? OFFHOURS : null].filter(Boolean);
  const signals = [addedToAdmin, adminCommand, stolen, newAddress, offHours && (addedToAdmin || adminCommand), bulk, flap].filter(Boolean).length;
  const reason = kinds.length ? kinds.join('+') : /명령|권한 상승|세션/u.test(description) ? COMMAND : GROUP;
  const benign = BENIGN.test(description);

  if (!benign && (addedToAdmin || adminCommand) && signals >= 2 && level >= 10) {
    return result(0.8 + Math.min(signals, 4) * 0.04, reason);
  }
  // 권한 관련 단서가 하나뿐이거나 취소·실패·평소 주소로 끝난 중간 수준 경보는 알림으로만 남긴다.
  if (level >= 5 && mitre.length > 0) {
    return result(0.5 + Math.min(Math.max(level - 5, 0), 4) * 0.02 + Math.min(signals, 2) * 0.02, reason);
  }
  return result(0.1, '권한 상승 단서가 없는 일반 이벤트');
}
