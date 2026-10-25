begin;

-- Run once in a FREE Supabase project. No app passwords or user records are
-- placed in this table: it points to an encrypted private SQLite snapshot.
create table if not exists public.lothold_checkpoint (
  namespace text primary key,
  owner uuid not null,
  revision bigint not null default 0,
  object_key text,
  sha256 text,
  previous_key text,
  updated_at timestamptz not null default now()
);
alter table public.lothold_checkpoint enable row level security;
revoke all on public.lothold_checkpoint from public, anon, authenticated;
grant all on public.lothold_checkpoint to service_role;

-- A new process fences an old process before restoring. An old deployment can
-- upload orphan objects, but it cannot advance the authoritative pointer/ack.
create or replace function public.lothold_claim(p_namespace text, p_owner uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.lothold_checkpoint;
begin
  if p_namespace !~ '^[a-zA-Z0-9_-]{1,64}$' then raise exception 'invalid namespace'; end if;
  insert into public.lothold_checkpoint(namespace, owner) values(p_namespace, p_owner)
  on conflict(namespace) do update set owner = excluded.owner, updated_at = now()
  returning * into r;
  return to_jsonb(r);
end $$;

create or replace function public.lothold_status(p_namespace text)
returns jsonb language sql security definer set search_path = public, pg_temp as $$
  select to_jsonb(c) from public.lothold_checkpoint c where namespace = p_namespace;
$$;

create or replace function public.lothold_commit(p_namespace text, p_owner uuid, p_revision bigint, p_object_key text, p_sha256 text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.lothold_checkpoint; discarded text;
begin
  select * into r from public.lothold_checkpoint where namespace = p_namespace for update;
  if not found or r.owner is distinct from p_owner or r.revision is distinct from p_revision then raise exception 'writer fenced or revision changed'; end if;
  if p_object_key is null or p_sha256 is null or left(p_object_key, length(p_namespace)+1) <> p_namespace || '/' or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'invalid checkpoint'; end if;
  discarded := r.previous_key;
  update public.lothold_checkpoint set previous_key = object_key, object_key = p_object_key,
    sha256 = p_sha256, revision = revision + 1, updated_at = now()
    where namespace = p_namespace returning * into r;
  return to_jsonb(r) || jsonb_build_object('discarded_key', discarded);
end $$;

revoke all on function public.lothold_claim(text,uuid) from public, anon, authenticated;
revoke all on function public.lothold_status(text) from public, anon, authenticated;
revoke all on function public.lothold_commit(text,uuid,bigint,text,text) from public, anon, authenticated;
grant execute on function public.lothold_claim(text,uuid) to service_role;
grant execute on function public.lothold_status(text) to service_role;
grant execute on function public.lothold_commit(text,uuid,bigint,text,text) to service_role;

-- Bucket stays private. The service-role secret is server-only.
insert into storage.buckets(id, name, public, file_size_limit)
values ('lothold-private', 'lothold-private', false, 41943040)
on conflict(id) do update set public = false, file_size_limit = excluded.file_size_limit;

notify pgrst, 'reload schema';
commit;
