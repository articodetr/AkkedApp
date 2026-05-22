/*
  # تسجيل ودخول بدون أي رسائل بريد

  يستخدم التطبيق جدول app_security للمصادقة المباشرة بدلاً من Supabase Auth signUp،
  حتى لا يرسل Supabase رسائل تأكيد أو روابط بريدية أثناء التسجيل.
*/

begin;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.register_app_user(
  p_full_name text,
  p_user_name text,
  p_email text,
  p_password text
)
RETURNS TABLE (
  id uuid,
  user_name text,
  email text,
  full_name text,
  account_number text,
  role text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_full_name text := NULLIF(trim(p_full_name), '');
  v_user_name text := lower(regexp_replace(trim(p_user_name), '\s+', '', 'g'));
  v_email text := lower(trim(p_email));
BEGIN
  IF v_full_name IS NULL OR length(v_full_name) < 2 THEN
    RAISE EXCEPTION 'FULL_NAME_TOO_SHORT';
  END IF;

  IF v_user_name IS NULL OR length(v_user_name) < 3 THEN
    RAISE EXCEPTION 'USER_NAME_TOO_SHORT';
  END IF;

  IF v_email IS NULL OR v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'INVALID_EMAIL';
  END IF;

  IF p_password IS NULL OR length(p_password) < 6 THEN
    RAISE EXCEPTION 'PASSWORD_TOO_SHORT';
  END IF;

  IF EXISTS (
    SELECT 1 FROM app_security
    WHERE lower(user_name) = v_user_name
       OR lower(email) = v_email
  ) THEN
    RAISE EXCEPTION 'USER_NAME_OR_EMAIL_EXISTS';
  END IF;

  INSERT INTO app_security (
    id,
    user_name,
    email,
    full_name,
    pin_hash,
    role,
    is_active,
    auth_provider
  )
  VALUES (
    v_user_id,
    v_user_name,
    v_email,
    v_full_name,
    crypt(p_password, gen_salt('bf')),
    'user',
    true,
    'custom'
  );

  RETURN QUERY
  SELECT
    s.id,
    s.user_name,
    s.email,
    s.full_name,
    s.account_number,
    s.role
  FROM app_security s
  WHERE s.id = v_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.login_app_user(
  p_login text,
  p_password text
)
RETURNS TABLE (
  id uuid,
  user_name text,
  email text,
  full_name text,
  account_number text,
  role text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_login text := lower(trim(p_login));
  v_user app_security%ROWTYPE;
BEGIN
  IF v_login IS NULL OR v_login = '' OR p_password IS NULL THEN
    RETURN;
  END IF;

  SELECT *
  INTO v_user
  FROM app_security
  WHERE is_active = true
    AND pin_hash IS NOT NULL
    AND (lower(user_name) = v_login OR lower(email) = v_login)
    AND pin_hash = crypt(p_password, pin_hash)
  LIMIT 1;

  IF v_user.id IS NULL THEN
    RETURN;
  END IF;

  UPDATE app_security
  SET last_login = now(),
      updated_at = now()
  WHERE app_security.id = v_user.id;

  RETURN QUERY
  SELECT
    v_user.id,
    v_user.user_name,
    v_user.email,
    v_user.full_name,
    v_user.account_number,
    v_user.role;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_app_user(text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.login_app_user(text, text) TO anon, authenticated;

commit;
