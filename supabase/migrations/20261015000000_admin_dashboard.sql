-- ===========================================================================
-- Admin dashboard: gated statistics + anonymous usage tracking
--
-- Three pieces:
--   1. public.admin_emails  — the only source of truth for "who is an admin".
--   2. public.usage_events  — one row per app open, attributed either to a
--      signed-in user (user_id) or to a random device id held on the device
--      (device_id). Guests are counted through that random id; it carries no
--      personal data and cannot be linked back to a person.
--   3. RPCs — track_app_open() is callable by everyone (that is how the app
--      reports an open), admin_stats() is callable only by an address listed
--      in admin_emails.
--
-- The tables themselves are closed: RLS is enabled with no policies and the
-- privileges are revoked from anon/authenticated, so the dashboard can only be
-- read through the admin-gated function below.
--
-- ⚠️  EDIT THE INSERT AT THE BOTTOM BEFORE RUNNING THIS FILE.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Admin allow-list
-- ---------------------------------------------------------------------------
create table if not exists public.admin_emails (
  email text primary key,
  added_at timestamptz not null default now(),
  -- an email address is stored lowercase so comparisons never depend on case
  constraint admin_emails_format_check check (email = lower(email) and position('@' in email) > 1)
);

alter table public.admin_emails enable row level security;
revoke all on public.admin_emails from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Usage events (app opens)
-- ---------------------------------------------------------------------------
create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  -- set for signed-in opens; cascades, because nulling it alone could leave a row
  -- with no identity at all and block the account's deletion
  user_id uuid references auth.users (id) on delete cascade,
  -- set for opens without an account: a random id minted on the device
  device_id text,
  kind text not null default 'app_open',
  app_version text,
  occurred_at timestamptz not null default now(),
  constraint usage_events_kind_check check (kind in ('app_open')),
  -- every row must be attributable to *something*
  constraint usage_events_identity_check check (user_id is not null or device_id is not null),
  constraint usage_events_device_check check (device_id is null or char_length(device_id) between 8 and 64),
  constraint usage_events_version_check check (app_version is null or char_length(app_version) <= 32)
);

create index if not exists usage_events_occurred_at_idx on public.usage_events (occurred_at desc);
create index if not exists usage_events_user_id_idx on public.usage_events (user_id, occurred_at desc);
create index if not exists usage_events_device_id_idx on public.usage_events (device_id, occurred_at desc);

alter table public.usage_events enable row level security;
revoke all on public.usage_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Who am I?
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_emails a
    where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Reporting an app open
--
-- Callable without a session: a guest's open is the point of the exercise.
-- Repeated opens collapse into one row per identity every 30 minutes so the
-- table counts visits rather than button presses.
-- ---------------------------------------------------------------------------
create or replace function public.track_app_open(
  p_device_id text default null,
  p_app_version text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_device text := nullif(trim(coalesce(p_device_id, '')), '');
  v_recent timestamptz;
  v_version text := nullif(trim(coalesce(p_app_version, '')), '');
begin
  if v_user is null then
    -- A guest without a usable device id cannot be counted, and refusing costs
    -- nothing: the caller simply stays uncounted for this open.
    if v_device is null or char_length(v_device) < 8 or char_length(v_device) > 64 then
      return;
    end if;
  else
    -- Signed-in opens are attributed to the account; the device id is kept as
    -- supporting detail only.
    if v_device is not null and (char_length(v_device) < 8 or char_length(v_device) > 64) then
      v_device := null;
    end if;
  end if;

  if v_version is not null then
    v_version := left(v_version, 32);
  end if;

  select max(e.occurred_at)
  into v_recent
  from public.usage_events e
  where (v_user is not null and e.user_id = v_user)
     or (v_user is null and e.device_id = v_device);

  if v_recent is not null and v_recent > now() - interval '30 minutes' then
    return;
  end if;

  insert into public.usage_events (user_id, device_id, kind, app_version)
  values (v_user, v_device, 'app_open', v_version);
end;
$$;

revoke all on function public.track_app_open(text, text) from public;
grant execute on function public.track_app_open(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The dashboard payload
--
-- Reads auth.users (hence security definer) and refuses anyone who is not on
-- the allow-list. One round trip: totals, actives, guests and a 14-day series.
-- ---------------------------------------------------------------------------
create or replace function public.admin_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total_users', (select count(*) from auth.users),
    'users_created_7d', (
      select count(*) from auth.users where created_at > now() - interval '7 days'),
    'users_created_30d', (
      select count(*) from auth.users where created_at > now() - interval '30 days'),
    'active_users_7d', (
      select count(distinct e.user_id)
      from public.usage_events e
      where e.user_id is not null and e.occurred_at > now() - interval '7 days'),
    'active_users_30d', (
      select count(distinct e.user_id)
      from public.usage_events e
      where e.user_id is not null and e.occurred_at > now() - interval '30 days'),
    'guest_devices_total', (
      select count(distinct e.device_id)
      from public.usage_events e
      where e.user_id is null and e.device_id is not null),
    'guest_devices_7d', (
      select count(distinct e.device_id)
      from public.usage_events e
      where e.user_id is null and e.device_id is not null
        and e.occurred_at > now() - interval '7 days'),
    'guest_opens_7d', (
      select count(*)
      from public.usage_events e
      where e.user_id is null and e.occurred_at > now() - interval '7 days'),
    'app_opens_7d', (
      select count(*) from public.usage_events e
      where e.occurred_at > now() - interval '7 days'),
    'first_event_at', (
      select min(e.occurred_at) from public.usage_events e),
    'last_event_at', (
      select max(e.occurred_at) from public.usage_events e),
    'daily', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'day', to_char(s.day, 'YYYY-MM-DD'),
            'users', s.users,
            'guests', s.guests
          )
          order by s.day
        ),
        '[]'::jsonb
      )
      from (
        select d.day as day,
               count(distinct e.user_id) filter (where e.user_id is not null) as users,
               count(distinct e.device_id) filter (where e.user_id is null) as guests
        from generate_series(
               date_trunc('day', now()) - interval '13 days',
               date_trunc('day', now()),
               interval '1 day'
             ) as d(day)
        left join public.usage_events e
          on e.occurred_at >= d.day and e.occurred_at < d.day + interval '1 day'
        group by d.day
      ) s
    )
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_stats() from public, anon;
grant execute on function public.admin_stats() to authenticated;

-- ===========================================================================
-- ⚠️  EDIT THIS BEFORE RUNNING — replace with the email of the admin account.
--
-- The account itself is created normally from the app's sign-in screen
-- (sign up → confirm the email → sign in). Listing that address here is what
-- turns its sign-in into the dashboard instead of the regular app.
-- To add another admin later:
--   insert into public.admin_emails (email) values ('someone@example.com');
-- To remove one:
--   delete from public.admin_emails where email = 'someone@example.com';
-- ===========================================================================
insert into public.admin_emails (email)
values ('admin@example.com')          -- ← change this
on conflict (email) do nothing;
