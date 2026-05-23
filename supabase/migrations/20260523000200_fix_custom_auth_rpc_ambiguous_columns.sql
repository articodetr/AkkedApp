/*
  Fix ambiguous column references in the custom auth RPCs.

  Because register_app_user/login_app_user return columns named user_name and email,
  unqualified table columns with the same names are ambiguous inside PL/pgSQL.
*/

begin;

create extension if not exists pgcrypto with schema extensions;

create or replace function public.register_app_user(
  p_full_name text,
  p_user_name text,
  p_email text,
  p_password text
)
returns table (
  id uuid,
  user_name text,
  email text,
  full_name text,
  account_number text,
  role text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid := gen_random_uuid();
  v_full_name text := nullif(btrim(p_full_name), '');
  v_user_name text := lower(regexp_replace(btrim(p_user_name), '\s+', '', 'g'));
  v_email text := lower(btrim(p_email));
begin
  if v_full_name is null or length(v_full_name) < 2 then
    raise exception 'FULL_NAME_TOO_SHORT';
  end if;

  if v_user_name is null or length(v_user_name) < 3 then
    raise exception 'USER_NAME_TOO_SHORT';
  end if;

  if v_email is null or v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_EMAIL';
  end if;

  if p_password is null or length(p_password) < 6 then
    raise exception 'PASSWORD_TOO_SHORT';
  end if;

  if exists (
    select 1
    from public.app_security s
    where s.deleted_at is null
      and (
        lower(s.user_name) = v_user_name
        or lower(s.email) = v_email
      )
  ) then
    raise exception 'USER_NAME_OR_EMAIL_EXISTS';
  end if;

  insert into public.app_security (
    id,
    user_name,
    email,
    full_name,
    pin_hash,
    role,
    is_active,
    auth_provider
  )
  values (
    v_user_id,
    v_user_name,
    v_email,
    v_full_name,
    crypt(p_password, gen_salt('bf')),
    'user',
    true,
    'custom'
  );

  return query
  select
    s.id,
    s.user_name::text,
    s.email::text,
    s.full_name::text,
    s.account_number::text,
    s.role::text
  from public.app_security s
  where s.id = v_user_id;
end;
$$;

create or replace function public.login_app_user(
  p_login text,
  p_password text
)
returns table (
  id uuid,
  user_name text,
  email text,
  full_name text,
  account_number text,
  role text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_login text := lower(btrim(p_login));
  v_user public.app_security%rowtype;
begin
  if v_login is null or v_login = '' or p_password is null then
    return;
  end if;

  select s.*
  into v_user
  from public.app_security s
  where s.deleted_at is null
    and s.is_active = true
    and s.pin_hash is not null
    and (
      lower(s.user_name) = v_login
      or lower(s.email) = v_login
    )
    and s.pin_hash = crypt(p_password, s.pin_hash)
  limit 1;

  if v_user.id is null then
    return;
  end if;

  update public.app_security s
  set last_login = now(),
      updated_at = now()
  where s.id = v_user.id;

  return query
  select
    v_user.id,
    v_user.user_name::text,
    v_user.email::text,
    v_user.full_name::text,
    v_user.account_number::text,
    v_user.role::text;
end;
$$;

grant execute on function public.register_app_user(text, text, text, text) to anon, authenticated;
grant execute on function public.login_app_user(text, text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
