/*
  Restore the custom auth RPCs used by the Expo app.

  Production currently does not expose register_app_user/login_app_user/get_login_email,
  so PostgREST returns PGRST202 and registration shows the migration error.
  This migration is intentionally idempotent and also refreshes PostgREST's schema cache.
*/

begin;

create extension if not exists pgcrypto with schema extensions;

alter table public.app_security
  add column if not exists full_name text,
  add column if not exists account_number text,
  add column if not exists email text,
  add column if not exists auth_provider text,
  add column if not exists deleted_at timestamptz;

update public.app_security
set full_name = coalesce(nullif(btrim(full_name), ''), nullif(btrim(user_name), ''), 'User')
where full_name is null or btrim(full_name) = '';

create sequence if not exists public.user_account_number_seq
  start with 26000
  increment by 1
  no maxvalue
  cache 1;

grant usage, select on sequence public.user_account_number_seq to anon, authenticated;

create or replace function public.generate_user_account_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  new_account_number text;
begin
  loop
    new_account_number := lpad(nextval('public.user_account_number_seq'::regclass)::text, 5, '0');

    exit when not exists (
      select 1
      from public.app_security s
      where s.account_number = new_account_number
    );
  end loop;

  return new_account_number;
end;
$$;

create or replace function public.trigger_generate_user_account_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.account_number is null or btrim(new.account_number) = '' then
    new.account_number := public.generate_user_account_number();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_generate_user_account_number on public.app_security;
create trigger trg_generate_user_account_number
  before insert on public.app_security
  for each row
  execute function public.trigger_generate_user_account_number();

drop function if exists public.get_login_email(text);
create function public.get_login_email(p_login text)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select s.email
  from public.app_security s
  where s.deleted_at is null
    and s.is_active = true
    and s.email is not null
    and (
      lower(s.user_name) = lower(btrim(p_login))
      or lower(s.email) = lower(btrim(p_login))
    )
  order by
    case when lower(s.user_name) = lower(btrim(p_login)) then 0 else 1 end,
    s.created_at desc
  limit 1;
$$;

drop function if exists public.register_app_user(text, text, text, text);
create function public.register_app_user(
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

drop function if exists public.login_app_user(text, text);
create function public.login_app_user(
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

  select *
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

  update public.app_security
  set last_login = now(),
      updated_at = now()
  where app_security.id = v_user.id;

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

grant execute on function public.get_login_email(text) to anon, authenticated;
grant execute on function public.register_app_user(text, text, text, text) to anon, authenticated;
grant execute on function public.login_app_user(text, text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
