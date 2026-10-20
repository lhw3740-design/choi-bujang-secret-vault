# BYTE BACK 방어전 시작 틀 R5

이 저장소는 1단계에서 학생 본인이 GitHub 저장소와 Vercel 배포를 만드는 출발점입니다. 포함된 메모 네 건은 가상 자료입니다. 실제 학생 자료, 토큰, 비밀키를 넣지 마세요.

## 학생이 하는 일: 세 걸음

1. GitHub 계정을 만듭니다.
2. 방어전 1단계 카드의 **Deploy** 버튼을 누릅니다. Vercel에 GitHub로 로그인하고, 새 저장소가 **본인 계정의 Public 저장소**인지 확인한 뒤 Deploy를 누릅니다.
3. 배포가 끝나면 화면에 나온 `https://…vercel.app` 주소를 방어전 1단계 카드에 붙여넣고 제출합니다. 저장소 주소나 설정 파일은 적지 않습니다.

## 현재 자료 흐름과 남은 약점

화면은 Supabase `learning_notes` 테이블에서 메모를 읽는 Vercel 함수 `/api/notes`를 호출합니다. 정적 파일 `/data.json`에는 메모를 두지 않습니다. 서버 함수는 Vercel 환경변수 `SUPABASE_URL`과 서버 전용 `SUPABASE_SECRET_KEY`를 사용합니다. 두 값은 브라우저 파일, 응답, 로그, Git에 넣지 마세요. Vercel **Settings → Environment Variables**에 직접 설정하고 다시 배포합니다. 실제 키를 코드나 문서에 적지 마세요.

Supabase SQL Editor에서 [학습 자료 테이블 SQL](supabase/migrations/20261006063758_create_learning_notes.sql)을 실행하면 `owner_id uuid` 칸이 있는 `learning_notes` 테이블과 네 건의 가상 자료가 만들어집니다. 이 SQL은 `auth.users` 외래키를 만들지 않고, RLS를 켜며 `anon`·`authenticated`의 테이블 권한을 회수합니다.

화면의 이메일·비밀번호 로그인과 로그아웃은 Supabase JS SDK를 사용합니다. 실제 로그인 전에 [public/supabase-config.js](public/supabase-config.js)에 Supabase Project URL과 **publishable key**를 직접 입력하세요. 두 값은 브라우저에 공개되는 값입니다. 비밀번호와 세션 토큰은 SDK가 처리하며 직접 만들지 않습니다.

화면은 Supabase 세션의 access token을 `Authorization: Bearer`로 `/api/notes`에 보냅니다. 서버는 기존 `src/verify-login.mjs`를 사용해 Supabase 발급자, `authenticated` 대상, 만료 시각을 검증하고 실패하면 `401` JSON을 반환합니다. 브라우저가 보낸 user ID나 role은 사용하지 않습니다. `aleph.config.json`의 `identityProvider`에는 공개 가능한 issuer, audience, JWKS URL만 기록하며 비밀 키는 포함하지 않습니다.

현재 `aleph.config.json`은 12단계이며 실제 Vercel 앱 URL, Supabase Auth 발급자 설정, 원본 자료 REST 경로를 기록합니다. 빌드된 `/aleph.json`에는 설정된 단계 번호가 반영됩니다.

로그인한 사용자는 화면에서 가상 메모를 추가·수정·삭제할 수 있습니다. `POST /api/notes`는 `{id?, title, body}`를 받고, `id`가 없으면 서버가 UUID를 만듭니다. `GET /api/notes`는 검증된 사용자 ID의 메모 배열을 반환하고, `GET`, `PUT`, `DELETE /api/notes/:id`는 한 메모를 처리합니다. 데이터베이스 `content` 열은 API의 `body` 필드로 변환됩니다.

4단계에서는 목록과 단건 `GET`, `PUT`, `DELETE` 모두 서버가 검증한 사용자 ID를 `owner_id`와 비교합니다. 추가 시에도 요청 본문의 소유자 값은 사용하지 않고 검증된 ID를 저장합니다. 수정은 기존 행과 변경 후 행 모두 본인 소유로 제한합니다. 다른 계정의 메모는 `404`로 처리합니다.

5단계에서는 화면의 메모 자료 요청을 `/api/notes` 및 `/api/notes/:id` 서버 함수로 모읍니다. 함수는 서버 전용 `SUPABASE_SECRET_KEY`로 데이터베이스를 사용하고, 로그인 검증과 소유자 제한을 유지합니다. `aleph.config.json`의 `originalApiUrl`은 쿼리 없는 Supabase REST 자료 경로이며, 빌드가 이를 공개 배포 메타데이터 `/aleph.json`에도 포함합니다. `src/attack-check.mjs`의 제출 자기 점검은 해당 경로에 공개 publishable key로 익명 요청을 보내 실제 응답 상태만 기록합니다. 이 점검은 심판 판정이 아니며, 학습 DB 권한 SQL의 실행이나 실제 A 계정 화면 확인을 대신하지 않습니다.

10단계의 메모 복구는 `POST /api/restore`가 복원 직전에 고정 SHA-256 지문으로 `restore-backup.json`을 다시 읽어 검증하고, 이후 서버 인증으로 확인한 사용자 ID와 비공개 `learning_note_backups`의 ID·소유자·내용 해시를 대조한 뒤 해당 사용자의 메모 한 건만 `learning_notes`에 복원합니다. 화면에서 메모 ID를 입력해 **백업과 변경 상태 미리보기**를 먼저 확인하고, **확인한 백업으로 이 메모 복구**를 눌러야 합니다. 백업 사본이 없거나 지문이 다르면 DB를 조회·수정하지 않고 `TRUSTED_BACKUP_UNAVAILABLE`로 중단합니다. 백업 테이블은 [전용 마이그레이션](supabase/migrations/20261014083000_create_learning_note_backups.sql)을 적용하고, 침해 전에 신뢰한 메모 사본만 관리자 SQL Editor에서 넣어야 합니다. 마이그레이션 적용만으로 과거 내용이 백업되지는 않습니다. 현재 잘못된/변조된 자료에서 새 백업을 만들면 복구용 사본이 되지 않으므로, 반드시 침해 전 신뢰된 사본을 사용하세요.

사전 백업을 준비하는 운영자는 Supabase Dashboard → SQL Editor에서 먼저 마이그레이션 SQL을 실행합니다. 침해 전 신뢰된 원본이 `learning_notes`에 아직 있는 경우에만 다음 쿼리의 두 UUID를 해당 메모 ID와 소유자 ID로 바꿔 실행합니다. 쿼리는 내용을 비공개 백업 테이블로 복사하고 화면에 메모 본문을 출력하지 않습니다. 이미 메모가 변조·삭제된 뒤라면 현재 행을 백업하지 말고, 별도의 검증된 사본으로 백업 행을 채워야 합니다.

```sql
insert into public.learning_note_backups (
  note_id, owner_id, title, content, content_hash, snapshot_version, verified_at
)
select
  id, owner_id, title, content,
  public.learning_note_backup_hash(id, owner_id, title, content),
  'pre-attack-verified-v1',
  now()
from public.learning_notes
where id = '00000000-0000-4000-8000-000000000000'::uuid
  and owner_id = '00000000-0000-4000-8000-000000000000'::uuid
on conflict (note_id) do nothing;
```

화면에서 확인할 순서:

1. Supabase Dashboard → Table Editor → `public.learning_notes`에서 시험 계정 B의 메모 ID를 확인합니다. 본문을 복사하거나 채팅·로그에 남기지 않습니다.
2. Vercel 배포 주소를 열고 시험 계정 B로 로그인합니다.
3. **검증된 백업에서 메모 복구**에 메모 ID를 입력한 뒤 **백업과 변경 상태 미리보기**를 누릅니다. `VERIFIED_BACKUP_NOT_FOUND` 또는 `BACKUP_VERIFICATION_FAILED`가 나오면 중단합니다.
4. 표시된 버전·검증 시각·백업 해시·현재 상태가 기대한 대상인지 확인하고, **확인한 백업으로 이 메모 복구**를 눌러 확인 대화상자에 동의합니다.
5. 정상 확인은 B의 자료실에서 해당 메모가 원래대로 보이고, ID·소유자·복원 해시가 확인되는 것입니다. 금지 확인은 다른 소유자의 메모 ID로 미리보기를 요청했을 때 `VERIFIED_BACKUP_NOT_FOUND`가 나고 복구되지 않는 것입니다. 실제 수행한 결과만 아래에 기록합니다.

실제 배포 재시험 기록(2026-10-14, 사용자 실행 결과 보고, 배포 커밋 `c6d36a3456794fccf73d7da1f44acff4b2dfeeef`):

- 백업 미리보기: 성공 — 검증 백업과 대상 상태 확인
- 시험 계정 B 단일 메모 복구 및 ID·소유자·해시 확인: 성공
- B 정상 자료 요청: 성공 — 허용
- 다른 사용자 메모 요청 거부: 성공 — 복구 거부
- 1~9단계 정상·금지 요청 재시험: 성공 — 사용자 확인에 따라 모두 기대한 결과

정책 복원(`mode: "policy"`)은 고정 지문으로 `restore-backup.json`을 다시 읽어 검증한 뒤 사본 버전과 바뀔 정책 항목만 보여 주며(`applied:false`), 검증에 실패하면 `TRUSTED_BACKUP_UNAVAILABLE`로 중단합니다. 배포 서버 파일·감사 이력은 쓰지 않습니다. 자동화 테스트는 `node --test test/restore.test.mjs`이며 실제 계정·DB·배포 시험을 대신하지 않습니다.

`aleph.config.json`의 `allowedRoutes`에는 `GET`·`POST /api/notes`와 `GET`·`PUT`·`DELETE /api/notes/:id` 경로가 기록되어 있습니다.

4~6단계 로컬 확인은 `node --test test/notes-api.test.mjs test/notes-crud.test.mjs test/package-starter.test.mjs test/r5.test.mjs`로 실행하고, 정적 산출물은 `npm run build -- --local`로 만듭니다. 판정기 가상 요청 순서는 `npm run decider:test`로 실행합니다. 이 테스트들은 모의 요청을 확인하며 실제 계정·기기 등록·배포·심판 시험을 대신하지 않습니다. `npm run bundle`은 실제 배포 `/api/notes`의 비로그인 요청과 설정된 원본 REST 경로의 익명 요청을 실행하고 그 응답 결과만 자기 점검에 기록합니다. 이 점검은 A/B 간 소유자 격리나 A의 화면 CRUD를 확인하지 않습니다. 배포에서는 A가 자기 메모를 읽고 추가·수정·삭제할 수 있는지, 원본 직접 요청이 거부되는지 별도로 확인하세요.

## 11단계: 설치형 접속 화면과 기기 승인

화면은 `/manifest.webmanifest`(앱 이름·아이콘)와 `/sw.js`를 가진 설치형 웹앱입니다. 서비스 워커는 오프라인 안내 화면(`/offline.html`)만 보관하고 `/api/*`, 로그인, 보호 자료 응답은 저장하지 않습니다. 오프라인이면 안내가 보이며 보호 자료는 열리지 않습니다. 따로 설치하는 접속 프로그램은 없습니다. **앱을 설치했다는 표시만으로 기기를 믿지 않습니다.**

로그인한 뒤 화면은 `GET /api/device`로 서버가 판단한 기기 상태(`unregistered`·`pending`·`approved`·`revoked`)를 받습니다. `approved`일 때만 `/api/notes`를 호출하고 메모 추가·복구 화면을 엽니다. 상태 확인이 실패하거나 알 수 없는 값이면 닫힌 상태를 유지합니다. **이 화면 잠금은 사용자 화면의 안내이며, 실제 기기 차단은 반 엔진 릴레이의 `deviceRegistered` 확인과 `src/decider.mjs`가 맡습니다.** 이 저장소의 `/api/notes` 서버 함수는 이번 단계에서 바꾸지 않았습니다.

**이 기기 승인 요청**은 `POST /api/device`로 대기 기록만 만듭니다. 서버가 무작위 값을 만들어 JavaScript가 읽을 수 없는 `HttpOnly` 쿠키(`__Host-aleph_device`)에 담고, 서버에는 그 값의 SHA-256 지문과 로그인 사용자 ID만 `device_approvals` 테이블에 둡니다. 브라우저 저장소(localStorage·sessionStorage·IndexedDB)에는 기기 키·토큰·승인 상태를 넣지 않습니다. Supabase 로그인 세션도 `persistSession: false`로 메모리에만 두므로, 새로고침하면 다시 로그인해야 합니다. 요청 본문의 상태·사용자·기기 값은 읽지 않으며, 승인 버튼은 없습니다. `approved`는 운영자가 Supabase SQL Editor에서만 바꿉니다. 한계: 쿠키 값은 그 기기 안의 무기명 값이라, 기기가 악성코드에 감염되면 빼내질 수 있습니다. 더 강한 기기 묶음(패스키 등)은 별도 계약이 필요합니다.

적용 순서:

1. Supabase SQL Editor에서 [기기 승인 마이그레이션](supabase/migrations/20261015060000_create_device_approvals.sql)을 실행합니다.
2. 배포 주소에서 시험 계정으로 로그인하면 **승인 전에는 메모가 표시되지 않고** 상태가 `unregistered`로 보입니다. **이 기기 승인 요청**을 누르면 `pending`이 됩니다.
3. Table Editor의 `device_approvals`에서 내 요청 행을 확인하고, 마이그레이션 파일의 승인 예시 SQL로 `approved`로 바꿉니다. 새로고침하면 기존 화면이 열립니다. `revoked`로 바꾸면 다시 닫힙니다.

자동 확인은 `node --test test/device.test.mjs`입니다(모의 DB). 실제 배포·계정·심판 시험을 대신하지 않으며, 실행하지 않은 시험은 미실행으로 남깁니다.

## 12단계: 정상·금지 요청 결과표

`npm run evidence`는 `aleph.config.json`의 실제 배포 주소(`publicAppUrl`)에 요청을 보내 1~11단계의 정상·금지 요청 결과를 한 표로 남깁니다. 표의 열은 단계·구분·시험·**기대 결과**·**실제 API 결과**·판정·**요청 ID**(스크립트가 만들어 `x-request-id`로 보낸 값)·서버 요청 ID(`x-vercel-id`)·**확인 시각**·비고입니다. 결과는 `artifacts/evidence-table.md`와 `.json`에 쓰며 Git에 올리지 않습니다.

- 로그인이 필요한 시험은 시험 계정 A·B가 있어야 합니다. 비밀번호는 터미널에서 입력만 하고 파일·Git·채팅에 남기지 마세요.
  ```bash
  read -r -p "A 이메일: " ALEPH_EMAIL_A; read -r -s -p "A 비밀번호: " ALEPH_PASSWORD_A; echo
  read -r -p "B 이메일: " ALEPH_EMAIL_B; read -r -s -p "B 비밀번호: " ALEPH_PASSWORD_B; echo
  export ALEPH_EMAIL_A ALEPH_PASSWORD_A ALEPH_EMAIL_B ALEPH_PASSWORD_B
  npm run evidence
  ```
  A의 백업 메모 미리보기까지 확인하려면 `export ALEPH_A_BACKUP_NOTE_ID=<A의 백업 메모 UUID>`를 추가하세요. 계정 정보가 없으면 해당 줄은 **미실행**으로 남고 통과로 세지 않습니다.
- 표에는 토큰·비밀번호·쿠키·메모 제목과 본문이 들어가지 않습니다. B의 메모 ID는 B 본인의 목록에서 읽어 A가 접근하지 못하는지 확인하는 데만 씁니다.
- 데이터를 바꾸는 요청(메모 수정·삭제, 실제 복구)은 스크립트가 보내지 않습니다. 판정기·탐지·회수(6~9단계)는 운영 엔진이 호출하므로 이 저장소에서 실제 응답을 받을 수 없어 **미실행**입니다. 승인한 기기 화면은 브라우저에서 직접 확인합니다.
- **총공세 41종 시험은 이 표로 통과 처리하지 않습니다.** 41종 판정은 심판 결과로만 확인하며, 표의 맨 아래 줄에 미판정으로 적습니다.
- 스크립트 로직의 자동 시험은 `node --test test/evidence.test.mjs`(모의 서버)이며 실제 배포 결과를 대신하지 않습니다.

## 12단계: 설치·실행·중지·복구 재현 안내

**검사 기준 커밋:** 이 README가 들어 있는 커밋(`HEAD`)입니다. README 안에 자기 커밋 해시를 적을 수 없으므로, 아래 명령으로 확인한 값이 제출 묶음(`artifacts/submission.json`)의 `commit`과 같은지 대조하세요.

```bash
git log -1 --format="%H %s"
```

### 학생 몫과 제공 엔진의 구분

두 출처를 섞지 않습니다. **학생 제작물**은 이 저장소의 판정기·탐지 규칙·접속 앱·자료실입니다. **제공 엔진**은 **ALEPH SDP 엔진**(운영 측 서비스)이며 이 저장소에 코드가 없습니다.

| 구분 | 내용 | 위치 |
|---|---|---|
| 학생 몫 | 판정기 규칙(`decide`, 규칙 이름 `RULE_IDS`) | `src/decider.mjs` |
| 학생 몫 | 탐지 규칙(`detect`, 10분 구간 `GET` 120건 초과 시 `burst_read` 회수 **제안**) | `src/detect.mjs` |
| 학생 몫 | 접속 앱(화면·manifest·오프라인 안내·기기 승인 요청)과 서버 함수 | `public/`, `api/` |
| 학생 몫 | 자료실 저장소·백업·기기 승인 표, 메모·정책 복구 | `supabase/migrations/`, `src/restore.mjs`, `restore-backup.json` |
| 학생 몫 | 탈환 작전실 요약과 정상·금지 요청 결과표 | `api/command-room.js`, `src/evidence.mjs`, `scripts/evidence-table.mjs` |
| 제공: **ALEPH SDP 엔진** | 신원·기기·경로 확인, 판정기 호출, 사건 전달, 접속 회수 집행, 심판 | 운영 측 서비스이며 이 저장소에 코드가 없습니다. 요청·응답 계약은 [docs/DECIDER_REQUEST.md](docs/DECIDER_REQUEST.md), [docs/DETECT_EVENTS.md](docs/DETECT_EVENTS.md)에 있습니다. |
| 제공: 시작 틀 | 패키징·빌드·제출 묶음 스크립트, 안내 문서, XDR 연습 경보 | `scripts/`, `package/`, `xdr/` (시작 틀 `ChoiTimo/aleph-defense-starter`) |

로컬에서 도는 `decider:test`, `detect:test`, `fixture:7`은 가상 요청 연습이며 ALEPH SDP 엔진의 실제 판정·회수 결과가 아닙니다. 이 저장소만으로는 엔진이 실제로 접속을 회수했는지 확인할 수 없고, `detect`는 회수를 **제안**할 뿐 집행하지 않습니다.

### 설치

1. Node.js 22 이상과 Git이 필요합니다. 저장소를 받고 `npm ci`를 실행합니다(오류 없이 끝나야 합니다).
2. Supabase SQL Editor에서 마이그레이션을 **이 순서로** 실행합니다.
   1. `supabase/migrations/20261006063758_create_learning_notes.sql` — 메모 표와 가상 자료
   2. `supabase/migrations/20261014083000_create_learning_note_backups.sql` — 비공개 백업 표
   3. `supabase/migrations/20261015060000_create_device_approvals.sql` — 기기 승인 표
   
   `20261015010000_create_learning_test_policy_restore.sql`은 정책 복원 연습용 표를 만들며 현재 코드가 사용하지 않습니다.
3. 비밀값은 저장소에 넣지 않습니다. Vercel **Settings → Environment Variables**에 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`를 직접 입력하고 다시 배포합니다. `public/supabase-config.js`에는 공개되는 Project URL과 publishable key만 둡니다.
4. 저장소를 Vercel에 연결하면 `npm run build`가 정적 화면(`public`)과 `/aleph.json`을 만듭니다. 서버 함수(`api/`)는 배포 환경에서 확인합니다.

### 실행·확인

```bash
node --test test/*.test.mjs        # 모의 시험. 실제 배포·계정·엔진 결과를 대신하지 않음
npm run decider:test               # 가상 판정 연습
npm run detect:test                # 가상 탐지 연습
npm run build -- --local           # 정적 화면 로컬 빌드
npm run evidence                   # 실제 배포 주소에 정상·금지 요청을 보내 결과표 생성
```

사용 순서: 시험 계정으로 로그인 → **이 기기 승인 요청** → Supabase에서 운영자가 `device_approvals`의 `pending`을 `approved`로 변경(승인 SQL은 마이그레이션 파일에 있음) → 새로고침하면 자료실과 탈환 작전실이 열립니다.

### 중지

- **한 기기 회수:** `update public.device_approvals set status = 'revoked' where id = '<행 id>'::uuid;` 새로고침하면 보호 자료와 작전실이 닫힙니다.
- **화면에서 나가기:** 로그아웃 버튼. 로그인 세션은 브라우저 저장소에 남기지 않으므로 새로고침하면 다시 로그인해야 합니다.
- **서버 전체 차단(비상):** Vercel에서 `SUPABASE_SECRET_KEY`를 지우고 재배포하면 서버 함수가 `SERVER_CONFIGURATION_ERROR`로 응답하고 자료를 읽지 않습니다. 키가 노출됐다면 Supabase에서 키를 교체합니다.
- **설치형 앱:** 서비스 워커는 오프라인 안내 화면만 보관합니다. 브라우저 개발자도구의 Application → Service Workers에서 등록을 해제할 수 있습니다.
- **엔진의 접속 회수 집행:** ALEPH SDP 엔진 몫입니다. 이 저장소에서는 중지할 수 없습니다.

### 복구

- **메모 한 건:** 침해 전에 신뢰한 사본을 `learning_note_backups`에 넣어 둔 경우에만 가능합니다(위 10단계 설명의 SQL과 순서). 화면에서 **백업과 변경 상태 미리보기**를 확인한 뒤 **확인한 백업으로 이 메모 복구**를 누릅니다. `restore-backup.json`의 고정 지문 검증에 실패하면 DB를 바꾸지 않고 `TRUSTED_BACKUP_UNAVAILABLE`로 멈춥니다.
- **정책:** `POST /api/restore`의 `mode: "policy"`는 사본 버전과 바뀔 항목만 보여 줍니다(`applied:false`). 배포 서버 파일은 고치지 않으며, 정책을 되돌릴 때는 코드·`aleph.config.json` 변경을 새 커밋으로 만듭니다.
- **코드 되돌리기:** `git revert <커밋>`을 쓰고 `git reset --hard`는 쓰지 않습니다. 되돌리기 전에 `git status`와 `git diff`로 사라질 내용을 확인합니다.

### 재현 순서와 한계

1. 위 **설치** 1~4단계를 마치고 저장소를 푸시, Vercel 배포가 Ready가 된 것을 확인합니다.
2. 시험 계정으로 기기를 승인한 뒤 화면에서 자료실과 탈환 작전실을 확인합니다.
3. `npm run evidence`로 결과표를 만들고 **미실행** 줄을 그대로 둡니다.
4. 커밋·푸시 후 `npm run bundle`로 제출 묶음을 만들고, `commit` 값이 위 `git log -1` 결과와 같은지 확인합니다.

이 문서는 설치·실행·중지·복구 절차를 설명할 뿐 총공세 41종 방어나 ALEPH SDP 엔진 연동의 통과를 주장하지 않습니다. 실제 판정은 심판 결과로만 확인합니다.

## 시작 틀의 자동 처리

`vercel.json`은 정적 결과물 `public`을 배포합니다. 빌드 명령 `npm run build`는 Vercel이 제공하는 GitHub 저장소 소유자·이름, 커밋 SHA, 배포 URL을 검증하고 `public/aleph.json`을 생성합니다. 필요한 값이 없으면 빌드가 실패하며, 성공한 것처럼 빈 주소를 내보내지 않습니다. `aleph.json`만으로 저장소 소유권이나 방어 성공을 인정하지 않습니다.

`aleph.config.json`의 `repoUrl`과 `publicAppUrl`이 실제 주소인지 확인하세요. 자리표시자라면 실제 배포를 확인할 수 없습니다. 제출 묶음은 `npm run bundle`로 만들며, 실행 전에 개인 자료가 아닌 단계 설명을 `bundle-notes.json`에 준비해야 합니다. 생성되는 `artifacts/submission.json`과 `bundle-notes.json`은 커밋하지 않습니다.

로컬에서 정적 화면을 빌드할 때는 `npm run build -- --local`을 사용합니다. 로컬 빌드는 Vercel 배포, Supabase 연결, 심판 접수를 증명하지 않습니다. Supabase 환경변수 없이 로컬에서 `/api/notes`를 실행하면 메모는 반환되지 않습니다. `src/attack-check.mjs`의 1단계 점검은 `/data.json`을 요청하므로 이 API 동작이나 자료 보호를 확인하는 시험이 아닙니다.

## 가상 메모 노출 확인

아래 네 문장을 그대로 검색합니다.

- `실습용 가상 과제 기록`
- `실습용 가상 포트폴리오 기록`
- `실습용 가상 리추얼 기록`
- `실습용 가상 행정 기록`

1단계의 `sampleMarker` 확인 표시는 현재 단계 정적 응답에 포함하지 않습니다. 텍스트 검색은 `-F` 옵션으로 문장을 글자 그대로 찾습니다.

### 현재 작업본과 GitHub 최신 파일

현재 작업본의 정적 데이터 파일을 검색합니다.

```sh
rg -n -F -e '실습용 가상 과제 기록' -e '실습용 가상 포트폴리오 기록' \
  -e '실습용 가상 리추얼 기록' -e '실습용 가상 행정 기록' \
  data.json public/data.json
```

GitHub의 최신 기본 브랜치와 비교하려면 먼저 원격을 갱신한 뒤 검색합니다.

```sh
git fetch origin main
git grep -n -F -e '실습용 가상 과제 기록' -e '실습용 가상 포트폴리오 기록' \
  -e '실습용 가상 리추얼 기록' -e '실습용 가상 행정 기록' \
  origin/main -- data.json public/data.json
```

출력이 없고 검색 명령이 일치 항목 없음으로 끝나면 해당 파일에서 문장을 찾지 못한 것입니다. 원격 인증이나 fetch가 실패하면 GitHub 최신 파일 확인은 미완료로 기록합니다. 웹에서는 GitHub 저장소의 최신 `main`에서 두 파일을 각각 열어 **Raw** 내용을 확인할 수 있습니다.

### 옛 공개 커밋

최신 파일에서 문장이 사라져도 과거 커밋에 남아 있을 수 있습니다. 공개 저장소에 가져온 이력 전체에서 메모가 든 커밋을 검색합니다.

```sh
for commit in $(git rev-list --all); do
  if git grep -q -F '실습용 가상' "$commit" -- data.json public/data.json; then
    git log -1 --format='%h %ad %s' --date=short "$commit"
  fi
done
```

검색에 나온 커밋은 과거 공개 이력의 노출로 기록합니다. 공개 커밋에 문장이 남아 있는 동안 **과거 노출은 해소되지 않은 것**입니다. 커밋 이력을 다시 쓰거나 옛 파일을 지워도 이미 복제·캐시된 사본이 사라졌다고 단정하지 마세요.

### 현재 배포 파일과 옛 배포

실제 현재 배포 주소에서 정적 `/data.json`을 검색합니다.

```sh
curl -fsS 'https://실제-배포주소.vercel.app/data.json' |
  rg -n -F -e '실습용 가상 과제 기록' -e '실습용 가상 포트폴리오 기록' \
    -e '실습용 가상 리추얼 기록' -e '실습용 가상 행정 기록'
```

배포 주소는 Vercel에서 직접 확인합니다. `aleph.config.json`이 자리표시자이거나 요청이 실패하면 배포 확인은 미실행으로 기록합니다. Vercel Deployments 목록에서 옛 배포의 고유 주소도 각각 같은 방법으로 확인합니다. 접근이 막힌 옛 배포도 삭제된 것이 아니면 남아 있는 사본으로 기록합니다.

화면은 `/api/notes`로 메모를 읽습니다. 이 API는 의도적으로 네 건의 메모를 반환하므로 정적 파일 검색 결과와 별도로 확인하고, 공개 약점으로 기록합니다.

### 확인 기록 원칙

- 최신 파일이나 현재 배포에서 검색 결과가 없더라도 그 확인 대상에서만 문장을 찾지 못한 것입니다.
- 옛 공개 커밋이나 옛 배포에서 문장이 발견되면 과거 노출은 해소되지 않은 것입니다.
- 옛 공개 커밋·배포가 하나라도 남아 있는 동안 과거 노출이 해소됐거나 안전하다고 쓰지 않습니다.
- 공개 API가 메모를 반환하는 것은 검색 결과가 아니라 별도의 남은 약점으로 기록합니다.

## 다음 단계의 코딩 도구에 전달할 규칙

[AGENTS.md](AGENTS.md)를 먼저 읽히고 한 번에 한 제작 단위만 요청하세요. 비밀번호·토큰·서버 전용 키·실제 학생 기록을 코드, Git, 제출 묶음에 넣지 않습니다. `src/decider.mjs`와 `src/detect.mjs`의 로컬 시험은 반 엔진이나 운영 심판의 결과가 아닙니다.

11단계 저장점 기록(2026-10-15): 로컬 자동 시험 통과. 실제 배포 기기 승인 시험은 확인한 결과만 이 아래에 기록합니다.

12단계 저장점 기록: `src/attack-check.mjs`의 `anonymous_note_read`(GET /api/notes)와 `anonymous_device_status`(GET /api/device)는 실제로 보낸 요청의 HTTP 상태를 `observed`에 적고, 응답을 받지 못하면 `not_run`을 적습니다. 41종 총공세는 이 저장소에서 실행하지 않았으며 통과로 적지 않습니다.
