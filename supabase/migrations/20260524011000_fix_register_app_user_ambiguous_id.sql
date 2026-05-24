/*
  Hotfix custom registration ambiguity.

  Supabase/Postgres can treat an unqualified "id" inside a RETURNS TABLE
  function as ambiguous because "id" is both a returned column and a table
  column. This version avoids ON CONFLICT (id) and qualifies all id checks.
*/

begin;

create extension if not exists pgcrypto with schema extensions;

alter table public.app_security
  add column if not exists full_name text,
  add column if not exists account_number text,
  add column if not exists email text,
  add column if not exists auth_provider text,
  add column if not exists deleted_at timestamptz;

alter table public.app_settings
  add column if not exists email text;

create or replace function public.ensure_auth_user_for_app_security(
  p_user_id uuid,
  p_email text,
  p_password text,
  p_full_name text,
  p_user_name text
)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_email text := lower(btrim(p_email));
  v_full_name text := nullif(btrim(p_full_name), '');
  v_user_name text := nullif(lower(regexp_replace(btrim(p_user_name), '\s+', '', 'g')), '');
  v_password text := coalesce(p_password, gen_random_uuid()::text);
begin
  if p_user_id is null or v_email is null or v_email = '' then
    return;
  end if;

  if v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return;
  end if;

  if exists (
    select 1
    from auth.users existing_auth_user
    where existing_auth_user.id = p_user_id
       or lower(existing_auth_user.email) = v_email
  ) then
    update auth.users auth_user
    set email = coalesce(auth_user.email, v_email),
        email_confirmed_at = coalesce(auth_user.email_confirmed_at, now()),
        raw_app_meta_data = coalesce(auth_user.raw_app_meta_data, '{}'::jsonb) ||
          jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
        raw_user_meta_data = coalesce(auth_user.raw_user_meta_data, '{}'::jsonb) ||
          jsonb_build_object(
            'full_name', coalesce(v_full_name, v_user_name, split_part(v_email, '@', 1)),
            'user_name', coalesce(v_user_name, split_part(v_email, '@', 1))
          ),
        updated_at = now()
    where auth_user.id = p_user_id
       or lower(auth_user.email) = v_email;

    return;
  end if;

  insert into auth.users (
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    confirmation_sent_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  values (
    p_user_id,
    'authenticated',
    'authenticated',
    v_email,
    crypt(v_password, gen_salt('bf')),
    now(),
    now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    jsonb_build_object(
      'full_name', coalesce(v_full_name, v_user_name, split_part(v_email, '@', 1)),
      'user_name', coalesce(v_user_name, split_part(v_email, '@', 1))
    ),
    now(),
    now()
  );
end;
$$;

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
    from public.app_security security_user
    where security_user.deleted_at is null
      and (
        lower(security_user.user_name) = v_user_name
        or lower(security_user.email) = v_email
      )
  ) or exists (
    select 1
    from auth.users auth_user
    where lower(auth_user.email) = v_email
  ) then
    raise exception 'USER_NAME_OR_EMAIL_EXISTS';
  end if;

  perform public.ensure_auth_user_for_app_security(
    v_user_id,
    v_email,
    p_password,
    v_full_name,
    v_user_name
  );

  update public.app_security security_user
  set user_name = v_user_name,
      email = v_email,
      full_name = v_full_name,
      pin_hash = crypt(p_password, gen_salt('bf')),
      role = coalesce(security_user.role, 'user'),
      is_active = true,
      auth_provider = 'custom',
      updated_at = now()
  where security_user.id = v_user_id;

  if not found then
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
  end if;

  perform public.get_or_create_user_settings(v_user_id);

  update public.app_settings settings
  set email = v_email,
      updated_at = now()
  where settings.user_id = v_user_id
    and (settings.email is null or btrim(settings.email) = '');

  return query
  select
    security_user.id,
    security_user.user_name::text,
    security_user.email::text,
    security_user.full_name::text,
    security_user.account_number::text,
    security_user.role::text
  from public.app_security security_user
  where security_user.id = v_user_id;
end;
$$;

update public.app_settings settings
set email = lower(btrim(security_user.email)),
    updated_at = now()
from public.app_security security_user
where settings.user_id = security_user.id
  and security_user.deleted_at is null
  and security_user.email is not null
  and btrim(security_user.email) <> ''
  and (settings.email is null or btrim(settings.email) = '');

do $$
declare
  v_user record;
begin
  for v_user in
    select
      security_user.id,
      security_user.email,
      security_user.full_name,
      security_user.user_name
    from public.app_security security_user
    where security_user.deleted_at is null
      and security_user.email is not null
      and btrim(security_user.email) <> ''
      and not exists (
        select 1
        from auth.users auth_user
        where auth_user.id = security_user.id
           or lower(auth_user.email) = lower(btrim(security_user.email))
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

revoke execute on function public.ensure_auth_user_for_app_security(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.register_app_user(text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
