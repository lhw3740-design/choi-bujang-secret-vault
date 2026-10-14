create extension if not exists pgcrypto with schema extensions;

create table if not exists public.learning_note_backups (
  note_id uuid primary key,
  owner_id uuid not null,
  title text not null,
  content text not null,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  snapshot_version text not null,
  verified_at timestamptz not null,
  constraint learning_note_backups_snapshot_version_nonempty
    check (length(trim(snapshot_version)) > 0)
);

alter table public.learning_note_backups enable row level security;
revoke all privileges on table public.learning_note_backups from public, anon, authenticated, service_role;
grant select on table public.learning_note_backups to service_role;

create or replace function public.learning_note_backup_hash(
  p_note_id uuid,
  p_owner_id uuid,
  p_title text,
  p_content text
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        'note-backup-v1|'
        || octet_length(convert_to(p_note_id::text, 'UTF8'))::text || ':' || p_note_id::text || '|'
        || octet_length(convert_to(p_owner_id::text, 'UTF8'))::text || ':' || p_owner_id::text || '|'
        || octet_length(convert_to(p_title, 'UTF8'))::text || ':' || p_title || '|'
        || octet_length(convert_to(p_content, 'UTF8'))::text || ':' || p_content,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

revoke all on function public.learning_note_backup_hash(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.learning_note_backup_hash(uuid, uuid, text, text) to service_role;
