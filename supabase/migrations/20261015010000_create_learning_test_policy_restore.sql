create table if not exists public.learning_test_policy_state (
  id text primary key check (id = 'active'),
  policy jsonb not null check (jsonb_typeof(policy) = 'object'),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);

insert into public.learning_test_policy_state (id, policy)
values (
  'active',
  '{
    "step": 10,
    "allowedRoutes": [
      "POST /api/notes",
      "GET /api/notes/:id",
      "PUT /api/notes/:id",
      "DELETE /api/notes/:id",
      "GET /api/notices",
      "GET /api/notices/:id",
      "GET /api/announcements",
      "GET /api/announcements/:id"
    ],
    "restoreRoute": "POST /api/restore"
  }'::jsonb
)
on conflict (id) do nothing;

create table if not exists public.learning_test_policy_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  backup_version text not null,
  backup_sha256 text not null check (backup_sha256 ~ '^[a-f0-9]{64}$'),
  changed_keys jsonb not null check (jsonb_typeof(changed_keys) = 'array'),
  policy_before jsonb not null,
  policy_after jsonb not null,
  occurred_at timestamptz not null default now()
);

alter table public.learning_test_policy_state enable row level security;
alter table public.learning_test_policy_audit enable row level security;
revoke all privileges on table public.learning_test_policy_state from public, anon, authenticated, service_role;
revoke all privileges on table public.learning_test_policy_audit from public, anon, authenticated, service_role;
grant select on table public.learning_test_policy_state to service_role;
grant select on table public.learning_test_policy_audit to service_role;

create or replace function public.restore_learning_test_policy(
  p_expected_revision bigint,
  p_expected_policy jsonb,
  p_restored_policy jsonb,
  p_actor_id uuid,
  p_backup_version text,
  p_backup_sha256 text,
  p_changed_keys jsonb
)
returns table (revision bigint, policy jsonb, audit_id bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_policy jsonb;
  v_new_policy jsonb;
  v_new_revision bigint;
  v_audit_id bigint;
begin
  if jsonb_typeof(p_expected_policy) <> 'object'
     or jsonb_typeof(p_restored_policy) <> 'object'
     or jsonb_typeof(p_changed_keys) <> 'array'
     or p_actor_id is null
     or p_backup_version is null
     or p_backup_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid policy restore input' using errcode = '22023';
  end if;

  select state.policy
    into v_current_policy
    from public.learning_test_policy_state as state
   where state.id = 'active'
     and state.revision = p_expected_revision
     and state.policy = p_expected_policy
   for update;

  if not found then
    raise exception 'test policy changed' using errcode = '40001';
  end if;

  v_new_policy := v_current_policy || p_restored_policy;

  update public.learning_test_policy_state as state
     set policy = v_new_policy,
         revision = state.revision + 1,
         updated_at = now()
   where state.id = 'active'
   returning state.revision into v_new_revision;

  insert into public.learning_test_policy_audit (
    actor_id, backup_version, backup_sha256, changed_keys, policy_before, policy_after
  )
  values (
    p_actor_id, p_backup_version, p_backup_sha256, p_changed_keys, v_current_policy, v_new_policy
  )
  returning id into v_audit_id;

  return query select v_new_revision, v_new_policy, v_audit_id;
end;
$$;

revoke all on function public.restore_learning_test_policy(bigint, jsonb, jsonb, uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.restore_learning_test_policy(bigint, jsonb, jsonb, uuid, text, text, jsonb)
  to service_role;
