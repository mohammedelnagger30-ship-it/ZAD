-- Admin-only user directory. Email addresses are read from auth.users only
-- through this allow-list-gated RPC; they are never exposed to regular clients.
create or replace function public.admin_user_directory(
  p_search text default '',
  p_confirmed boolean default null,
  p_sort text default 'created',
  p_offset integer default 0,
  p_limit integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_search text := left(trim(coalesce(p_search, '')), 128);
  v_confirmed boolean := p_confirmed;
  v_sort text := case when p_sort = 'last_sign_in' then 'last_sign_in' else 'created' end;
  v_offset integer := greatest(0, least(coalesce(p_offset, 0), 10000));
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 50));
begin
  if not public.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  with filtered_users as (
    select
      u.id,
      u.email,
      u.created_at,
      u.last_sign_in_at,
      u.email_confirmed_at
    from auth.users u
    where (
      v_search = ''
      or position(lower(v_search) in lower(coalesce(u.email, ''))) > 0
    )
      and (
        v_confirmed is null
        or (u.email_confirmed_at is not null) = v_confirmed
      )
  ),
  page_users as (
    select *
    from filtered_users u
    order by
      case when v_sort = 'last_sign_in' then u.last_sign_in_at end desc nulls last,
      case when v_sort = 'created' then u.created_at end desc,
      u.id
    offset v_offset
    limit v_limit
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered_users),
    'users', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', u.id,
            'email', u.email,
            'created_at', u.created_at,
            'last_sign_in_at', u.last_sign_in_at,
            'email_confirmed_at', u.email_confirmed_at
          )
          order by
            case when v_sort = 'last_sign_in' then u.last_sign_in_at end desc nulls last,
            case when v_sort = 'created' then u.created_at end desc,
            u.id
        )
        from page_users u
      ),
      '[]'::jsonb
    )
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_user_directory(text, boolean, text, integer, integer) from public, anon;
grant execute on function public.admin_user_directory(text, boolean, text, integer, integer) to authenticated;
