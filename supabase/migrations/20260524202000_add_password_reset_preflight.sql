/*
  Add a password-reset preflight check.

  Supabase Auth intentionally does not reveal whether reset emails were sent.
  The app needs a clear local reason when an old custom account has an email in
  app_security but does not yet have a matching auth.users row.
*/

begin;

alter table public.app_security
  add column if not exists email text,
  add column if not exists deleted_at timestamptz;

-- Re-run the auth backfill for old custom accounts when the helper exists.
do $$
declare
  v_user record;
begin
  if to_regprocedure('public.ensure_auth_user_for_app_security(uuid,text,text,text,text)') is null then
    return;
  end if;

  for v_user in
    select
      s.id,
      s.email,
      s.full_name,
      s.user_name
    from public.app_security s
    where s.deleted_at is null
      and coalesce(s.is_active, true) = true
      and s.email is not null
      and btrim(s.email) <> ''
      and not exists (
        select 1
        from auth.users u
        where u.id = s.id
           or lower(u.email) = lower(btrim(s.email))
      )
  loop
    perform public.ensure_auth_user_for_app_security(
      v_user.id,
      v_user.email,
      null,
      v_user.full_name,
      v_user.user_name
    );
  end loop;
end;
$$;

create or replace function public.get_password_reset_status(p_email text)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_user_id uuid;
  v_is_active boolean;
  v_deleted_at timestamptz;
  v_has_auth_user boolean;
begin
  if v_email = '' or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return 'invalid_email';
  end if;

  select
    s.id,
    coalesce(s.is_active, true),
    s.deleted_at
  into
    v_user_id,
    v_is_active,
    v_deleted_at
  from public.app_security s
  where lower(s.email) = v_email
  order by s.created_at desc
  limit 1;

  if v_user_id is null then
    return 'missing_profile';
  end if;

  if v_deleted_at is not null or not v_is_active then
    return 'inactive_profile';
  end if;

  select exists (
    select 1
    from auth.users u
    where u.id = v_user_id
       or lower(u.email) = v_email
  )
  into v_has_auth_user;

  if not v_has_auth_user then
    return 'missing_auth_user';
  end if;

  return 'ready';
end;
$$;

grant execute on function public.get_password_reset_status(text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
