-- ===========================================================================
-- Rate limits for track_app_open()
--
-- `track_app_open` is callable without a session — a guest's open is the point
-- — and the only identity it has for a guest is `p_device_id`, which the caller
-- chooses. The anon key ships inside the published bundle, so nothing stopped
-- anyone from minting unlimited device ids and inserting one row per call:
-- unbounded rows in `usage_events`, and complete poisoning of the guest
-- numbers the dashboard exists to report.
--
-- A ceiling needs an identity the caller does not control. For a guest that is
-- the network address, so this records it and caps per address:
--
--   * at most GUEST_DEVICES_PER_IP_PER_DAY distinct guest device ids per address
--   * at most GUEST_OPENS_PER_IP_PER_DAY guest opens per address
--
-- A real phone sits far below both. An address that rotates device ids stops
-- counting after the first few, which is exactly the behaviour wanted.
--
-- Two things this deliberately does *not* trust:
--
--   * `x-forwarded-for`'s first element. A client may prepend whatever it
--     likes; the header arrives as "spoofed, <real>". The rightmost hop is the
--     one the proxy appended and is the only part worth reading.
--   * "no address, no limit". When the address cannot be read the per-identity
--     ceiling is the only defence, so it applies a per-device daily cap
--     instead of simply proceeding.
--
-- A global backstop caps growth whatever happens, and rows older than
-- RETENTION_DAYS are pruned so the table cannot accumulate.
-- ===========================================================================

alter table public.usage_events
  add column if not exists client_ip inet;

create index if not exists usage_events_client_ip_idx
  on public.usage_events (client_ip, occurred_at desc)
  where user_id is null;

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
  -- A real install opens a handful of times a day. These sit an order of
  -- magnitude above that, so a legitimate household behind one carrier-grade
  -- NAT is never the thing that gets refused.
  --
  -- Declared plainly, without PL/pgSQL's `CONSTANT` keyword. The PostgreSQL
  -- manual lists that keyword, but the parser rejects it here in either case —
  -- it reads `constant` as the *name* of the first variable, hands
  -- "GUEST_DEVICES_PER_IP_PER_DAY int" to the type parser, which stops at
  -- `int` (checked against PostgreSQL 18.4). Do not restore it: `name type :=
  -- value` is the form that parses, and none of these is assigned after the
  -- block is entered, so the immutability `CONSTANT` promises is already true.
  GUEST_DEVICES_PER_IP_PER_DAY int := 8;
  GUEST_OPENS_PER_IP_PER_DAY int := 30;
  GUEST_OPENS_PER_DEVICE_PER_DAY int := 6;
  MAX_GUEST_DEVICES_PER_DAY int := 500;
  MAX_GUEST_OPENS_PER_DAY int := 5000;
  RETENTION_DAYS int := 180;

  v_user uuid := (select auth.uid());
  v_device text := nullif(trim(coalesce(p_device_id, '')), '');
  v_recent timestamptz;
  v_version text := nullif(trim(coalesce(p_app_version, '')), '');
  v_cf text;
  v_xff text;
  v_ip inet;
  v_day_start timestamptz;
  v_count int;
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

  -- Read the caller's address, best effort. `cf-connecting-ip` is set by the
  -- edge and cannot be forged by the caller; `x-forwarded-for` can, so only its
  -- rightmost element — the hop the proxy appended — is used. Anything that
  -- fails to parse becomes "unknown" rather than an error: an unreadable header
  -- must never turn an app open into a failed request.
  begin
    v_cf := nullif(trim(coalesce(
      (current_setting('request.headers', true)::jsonb) ->> 'cf-connecting-ip', '')), '');
    v_xff := nullif((current_setting('request.headers', true)::jsonb) ->> 'x-forwarded-for', '');

    if v_cf is not null then
      v_ip := v_cf::inet;
    elsif v_xff is not null then
      v_ip := nullif(trim(reverse(split_part(reverse(v_xff), ',', 1))), '')::inet;
    end if;
  exception when others then
    v_ip := null;
  end;

  v_day_start := date_trunc('day', now());

  -- Existing behaviour, kept: repeated opens collapse into one row per identity
  -- every 30 minutes so the table counts visits rather than button presses.
  select max(e.occurred_at)
  into v_recent
  from public.usage_events e
  where (v_user is not null and e.user_id = v_user)
     or (v_user is null and e.device_id = v_device);

  if v_recent is not null and v_recent > now() - interval '30 minutes' then
    return;
  end if;

  if v_user is null then
    -- Per-address ceilings. An address minting device ids past the first few
    -- stops being counted, which is the whole point of the exercise.
    if v_ip is not null then
      select count(distinct e.device_id)
      into v_count
      from public.usage_events e
      where e.user_id is null
        and e.client_ip = v_ip
        and e.occurred_at > now() - interval '1 day';
      if v_count >= GUEST_DEVICES_PER_IP_PER_DAY then
        return;
      end if;

      select count(*)
      into v_count
      from public.usage_events e
      where e.user_id is null
        and e.client_ip = v_ip
        and e.occurred_at > now() - interval '1 day';
      if v_count >= GUEST_OPENS_PER_IP_PER_DAY then
        return;
      end if;
    else
      -- No readable address: one identity, one small allowance.
      select count(*)
      into v_count
      from public.usage_events e
      where e.user_id is null
        and e.device_id = v_device
        and e.occurred_at >= v_day_start;
      if v_count >= GUEST_OPENS_PER_DEVICE_PER_DAY then
        return;
      end if;
    end if;

    -- Global backstop. Nothing organic reaches these; they exist so a
    -- determined caller cannot grow the table without limit no matter how the
    -- per-address reads above behave.
    select count(distinct e.device_id)
    into v_count
    from public.usage_events e
    where e.user_id is null and e.occurred_at >= v_day_start;
    if v_count >= MAX_GUEST_DEVICES_PER_DAY then
      return;
    end if;

    select count(*)
    into v_count
    from public.usage_events e
    where e.user_id is null and e.occurred_at >= v_day_start;
    if v_count >= MAX_GUEST_OPENS_PER_DAY then
      return;
    end if;
  end if;

  insert into public.usage_events (user_id, device_id, kind, app_version, client_ip)
  values (v_user, v_device, 'app_open', v_version, v_ip);

  -- Retention, and the reason the address can be stored at all. Sampled rather
  -- than run on every call: the delete is cheap against the index but there is
  -- no reason to pay for it on every open.
  if random() < 0.02 then
    delete from public.usage_events
    where occurred_at < now() - (RETENTION_DAYS || ' days')::interval;
  end if;
end;
$$;

revoke all on function public.track_app_open(text, text) from public;
grant execute on function public.track_app_open(text, text) to anon, authenticated;

comment on column public.usage_events.client_ip is
  'Network address the open came from, used only to rate-limit anonymous callers. Never readable by clients: the table has RLS enabled with no policies and its privileges are revoked. Pruned with the row after 180 days.';
