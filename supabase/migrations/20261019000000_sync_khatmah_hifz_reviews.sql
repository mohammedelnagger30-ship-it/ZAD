-- khatmah (the Quran-completion plan) and hifzReviews (the SM-2 memorisation
-- schedule) used to be device-local, so signing in on a second device silently
-- started a second khatmah and an independent review schedule over the same
-- ranges. Both now sync, which means the server has to admit their names.
--
-- Run this before the build that syncs them ships — the same rule as the adhkar
-- migration: until this lands, that build's push fails the whole round against
-- the constraint below.

alter table public.user_sync_records
  drop constraint if exists user_sync_records_table_name_check;

alter table public.user_sync_records
  add constraint user_sync_records_table_name_check
  check (
    table_name in (
      'settings',
      'plans',
      'tasks',
      'bookmarks',
      'pageBookmarks',
      'prayerRecords',
      'sunnahRecords',
      'hifzProgress',
      'hadithFavorites',
      'adhkar',
      'khatmah',
      'hifzReviews'
    )
  );

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
      'hadithFavorites',
      'adhkar',
      'khatmah',
      'hifzReviews'
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
