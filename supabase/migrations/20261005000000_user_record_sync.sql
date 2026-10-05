create table if not exists public.user_sync_records (
  user_id uuid not null references auth.users (id) on delete cascade,
  table_name text not null check (
    table_name in (
      'settings',
      'plans',
      'tasks',
      'bookmarks',
      'pageBookmarks',
      'prayerRecords',
      'sunnahRecords',
      'hifzProgress',
      'hadithFavorites'
    )
  ),
  record_id text not null,
  record_data jsonb,
  modified_at timestamptz not null,
  is_deleted boolean not null default false,
  primary key (user_id, table_name, record_id),
  check (
    (is_deleted and record_data is null)
    or (not is_deleted and jsonb_typeof(record_data) = 'object')
  )
);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'user_sync_records'
    )
  then
    alter publication supabase_realtime add table public.user_sync_records;
  end if;
end;
$$;

alter table public.user_sync_records enable row level security;

drop policy if exists "Users read their own sync records" on public.user_sync_records;
create policy "Users read their own sync records"
  on public.user_sync_records
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.user_sync_records from anon, authenticated;
grant select on public.user_sync_records to authenticated;

create or replace function public.sync_user_records(p_records jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  record_item record;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;
  if jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) > 200 then
    raise exception 'Expected an array of at most 200 sync records';
  end if;

  for record_item in
    select *
    from jsonb_to_recordset(p_records) as item(
      table_name text,
      record_id text,
      record_data jsonb,
      modified_at timestamptz,
      is_deleted boolean
    )
  loop
    if record_item.table_name not in (
      'settings',
      'plans',
      'tasks',
      'bookmarks',
      'pageBookmarks',
      'prayerRecords',
      'sunnahRecords',
      'hifzProgress',
      'hadithFavorites'
    ) or record_item.record_id is null or record_item.modified_at is null then
      raise exception 'Invalid sync record';
    end if;

    insert into public.user_sync_records (
      user_id,
      table_name,
      record_id,
      record_data,
      modified_at,
      is_deleted
    )
    values (
      (select auth.uid()),
      record_item.table_name,
      record_item.record_id,
      record_item.record_data,
      record_item.modified_at,
      coalesce(record_item.is_deleted, false)
    )
    on conflict (user_id, table_name, record_id)
    do update set
      record_data = excluded.record_data,
      modified_at = excluded.modified_at,
      is_deleted = excluded.is_deleted
    where public.user_sync_records.modified_at <= excluded.modified_at;
  end loop;
end;
$$;

revoke all on function public.sync_user_records(jsonb) from public, anon;
grant execute on function public.sync_user_records(jsonb) to authenticated;
