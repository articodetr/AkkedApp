/*
  # إلغاء تأكيد البريد في التسجيل واستخدام اسم مستخدم مستقل

  ## الهدف
  - الحسابات الجديدة بالبريد تُفعّل مباشرة بدون انتظار كود/رسالة تأكيد.
  - app_security.user_name يأخذ اسم المستخدم القادم من metadata بدلاً من البريد.
  - البريد يبقى محفوظاً في app_security.email لاستخدامه في استعادة كلمة المرور.
  - توفير RPC آمن لتحويل اسم المستخدم إلى بريد عند تسجيل الدخول.
*/

begin;

-- ============================================================
-- 1) تأكيد حسابات البريد تلقائياً عند إنشائها في auth.users
-- ============================================================
CREATE OR REPLACE FUNCTION public.auto_confirm_email_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF COALESCE(NEW.raw_app_meta_data->>'provider', 'email') = 'email' THEN
    NEW.email_confirmed_at := COALESCE(NEW.email_confirmed_at, now());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS before_auth_user_auto_confirm_email ON auth.users;
CREATE TRIGGER before_auth_user_auto_confirm_email
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_confirm_email_signup();

-- تأكيد أي حسابات بريد قديمة بقيت عالقة بدون تأكيد.
UPDATE auth.users
SET email_confirmed_at = COALESCE(email_confirmed_at, now()),
    updated_at = now()
WHERE email_confirmed_at IS NULL
  AND COALESCE(raw_app_meta_data->>'provider', 'email') = 'email';

-- ============================================================
-- 2) تحديث trigger إنشاء ملف المستخدم ليحفظ user_name مستقل عن email
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name text;
  v_provider text;
  v_requested_user_name text;
  v_user_name text;
BEGIN
  v_full_name := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'name', ''),
    NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
    'مستخدم'
  );

  v_provider := COALESCE(NEW.raw_app_meta_data->>'provider', 'email');
  v_requested_user_name := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data->>'user_name'), ''),
    NULLIF(trim(NEW.raw_user_meta_data->>'username'), '')
  );

  IF v_provider = 'email' THEN
    v_user_name := COALESCE(
      v_requested_user_name,
      NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
      NEW.id::text
    );
  ELSE
    v_user_name := COALESCE(v_requested_user_name, NEW.email, NEW.id::text);
  END IF;

  IF v_provider = 'email' THEN
    INSERT INTO app_security (id, email, user_name, full_name, role, is_active, auth_provider)
    VALUES (NEW.id, NEW.email, v_user_name, v_full_name, 'user', true, v_provider)
    ON CONFLICT (id) DO UPDATE
      SET email = EXCLUDED.email,
          user_name = COALESCE(NULLIF(app_security.user_name, ''), EXCLUDED.user_name),
          auth_provider = EXCLUDED.auth_provider,
          full_name = COALESCE(NULLIF(app_security.full_name, ''), EXCLUDED.full_name);
  ELSE
    -- OAuth: نفرض البيانات القادمة من المزوّد حتى لا تبقى بيانات قديمة من النظام السابق.
    INSERT INTO app_security (id, email, user_name, full_name, role, is_active, auth_provider)
    VALUES (NEW.id, NEW.email, v_user_name, v_full_name, 'user', true, v_provider)
    ON CONFLICT (id) DO UPDATE
      SET email = EXCLUDED.email,
          user_name = EXCLUDED.user_name,
          auth_provider = EXCLUDED.auth_provider,
          full_name = EXCLUDED.full_name;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 3) اسم المستخدم يتحول إلى البريد داخلياً عند تسجيل الدخول
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_login_email(p_login text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT s.email
  FROM app_security s
  WHERE s.email IS NOT NULL
    AND (
      lower(s.user_name) = lower(trim(p_login))
      OR lower(s.email) = lower(trim(p_login))
    )
  ORDER BY
    CASE WHEN lower(s.user_name) = lower(trim(p_login)) THEN 0 ELSE 1 END,
    s.created_at DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_login_email(text) TO anon, authenticated;

commit;
