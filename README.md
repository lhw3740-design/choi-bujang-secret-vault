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

현재 `aleph.config.json`은 10단계이며 실제 Vercel 앱 URL, Supabase Auth 발급자 설정, 원본 자료 REST 경로를 기록합니다. 빌드된 `/aleph.json`에는 설정된 단계 번호가 반영됩니다.

로그인한 사용자는 화면에서 가상 메모를 추가·수정·삭제할 수 있습니다. `POST /api/notes`는 `{id?, title, body}`를 받고, `id`가 없으면 서버가 UUID를 만듭니다. `GET /api/notes`는 검증된 사용자 ID의 메모 배열을 반환하고, `GET`, `PUT`, `DELETE /api/notes/:id`는 한 메모를 처리합니다. 데이터베이스 `content` 열은 API의 `body` 필드로 변환됩니다.

4단계에서는 목록과 단건 `GET`, `PUT`, `DELETE` 모두 서버가 검증한 사용자 ID를 `owner_id`와 비교합니다. 추가 시에도 요청 본문의 소유자 값은 사용하지 않고 검증된 ID를 저장합니다. 수정은 기존 행과 변경 후 행 모두 본인 소유로 제한합니다. 다른 계정의 메모는 `404`로 처리합니다.

5단계에서는 화면의 메모 자료 요청을 `/api/notes` 및 `/api/notes/:id` 서버 함수로 모읍니다. 함수는 서버 전용 `SUPABASE_SECRET_KEY`로 데이터베이스를 사용하고, 로그인 검증과 소유자 제한을 유지합니다. `aleph.config.json`의 `originalApiUrl`은 쿼리 없는 Supabase REST 자료 경로이며, 빌드가 이를 공개 배포 메타데이터 `/aleph.json`에도 포함합니다. `src/attack-check.mjs`의 제출 자기 점검은 해당 경로에 공개 publishable key로 익명 요청을 보내 실제 응답 상태만 기록합니다. 이 점검은 심판 판정이 아니며, 학습 DB 권한 SQL의 실행이나 실제 A 계정 화면 확인을 대신하지 않습니다.

10단계의 메모 복구는 `POST /api/restore`가 서버 인증으로 확인한 사용자 ID와 비공개 `learning_note_backups`의 ID·소유자·내용 해시를 대조한 뒤, 해당 사용자의 메모 한 건만 `learning_notes`에 복원합니다. 화면에서 메모 ID를 입력해 **백업과 변경 상태 미리보기**를 먼저 확인하고, **확인한 백업으로 이 메모 복구**를 눌러야 합니다. 백업 테이블은 [전용 마이그레이션](supabase/migrations/20261014083000_create_learning_note_backups.sql)을 적용하고, 침해 전에 신뢰한 메모 사본만 관리자 SQL Editor에서 넣어야 합니다. 마이그레이션 적용만으로 과거 내용이 백업되지는 않습니다. 현재 잘못된/변조된 자료에서 새 백업을 만들면 복구용 사본이 되지 않으므로, 반드시 침해 전 신뢰된 사본을 사용하세요.

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

정책 복원은 배포 서버 파일에 쓰지 않도록 API에서 제공하지 않으며(`POLICY_RESTORE_UNAVAILABLE`), 정책 비교/복구 모듈은 로컬 연습용입니다. 자동화 테스트는 `node --test test/restore.test.mjs`이며 실제 계정·DB·배포 시험을 대신하지 않습니다.

`aleph.config.json`의 `allowedRoutes`에는 `GET`·`POST /api/notes`와 `GET`·`PUT`·`DELETE /api/notes/:id` 경로가 기록되어 있습니다.

4~6단계 로컬 확인은 `node --test test/notes-api.test.mjs test/notes-crud.test.mjs test/package-starter.test.mjs test/r5.test.mjs`로 실행하고, 정적 산출물은 `npm run build -- --local`로 만듭니다. 판정기 가상 요청 순서는 `npm run decider:test`로 실행합니다. 이 테스트들은 모의 요청을 확인하며 실제 계정·기기 등록·배포·심판 시험을 대신하지 않습니다. `npm run bundle`은 실제 배포 `/api/notes`의 비로그인 요청과 설정된 원본 REST 경로의 익명 요청을 실행하고 그 응답 결과만 자기 점검에 기록합니다. 이 점검은 A/B 간 소유자 격리나 A의 화면 CRUD를 확인하지 않습니다. 배포에서는 A가 자기 메모를 읽고 추가·수정·삭제할 수 있는지, 원본 직접 요청이 거부되는지 별도로 확인하세요.

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
