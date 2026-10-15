-- 11단계: 기기 승인 기록. 승인 상태는 서버만 읽고, 승인은 운영자가 SQL Editor에서만 바꿉니다.
create table if not exists public.device_approvals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  device_hash text not null check (device_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'revoked')),
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  unique (owner_id, device_hash)
);

alter table public.device_approvals enable row level security;
revoke all privileges on table public.device_approvals from public, anon, authenticated, service_role;
grant select, insert on table public.device_approvals to service_role;

-- 운영자 승인 예시(SQL Editor에서만 실행). 요청 목록을 확인한 뒤 승인할 행의 id를 직접 넣으세요.
-- update public.device_approvals set status = 'approved', approved_at = now()
--   where id = '00000000-0000-4000-8000-000000000000'::uuid and status = 'pending';
-- 회수 예시:
-- update public.device_approvals set status = 'revoked' where id = '00000000-0000-4000-8000-000000000000'::uuid;
