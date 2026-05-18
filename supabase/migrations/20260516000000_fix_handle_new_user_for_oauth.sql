/*
  # إصلاح handle_new_user لمستخدمي OAuth (Google)

  ## المشكلة
  - عند تسجيل الدخول بـ Google لأول مرة، كان الـ trigger يستخدم COALESCE
    على full_name و user_name، مما يبقي القيم القديمة (مثل "AAA") لأي صف
    موجود مسبقاً بنفس الـ id في app_security.
  - النتيجة: المستخدم الجديد يرى اسمه القديم من النظام السابق
    بدلاً من اسمه من حساب Google.

  ## الإصلاح
  1. trigger handle_new_user يأخذ الاسم من Google metadata دائماً
     لمزوّدي OAuth، ويعدّل user_name ليطابق الإيميل.
  2. تحديث لمرة واحدة: للحسابات الموجودة في auth.users المرتبطة بـ provider
     غير 'email'، نُعيد تعيين user_name = email و full_name = metadata.full_name.
*/

begin;

-- ============================================================
-- 0) ضمان وجود الأعمدة المطلوبة (آمن: IF NOT EXISTS)
--    يحلّ حالة عدم تطبيق migration السابقة بالكامل على الإنتاج.
-- ============================================================
ALTER TABLE app_security
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS auth_provider text;

CREATE UNIQUE INDEX IF NOT EXISTS app_security_email_uidx
  ON app_security (lower(email))
  WHERE email IS NOT NULL;

DO $$
BEGIN
  BEGIN
    ALTER TABLE app_security ALTER COLUMN user_name DROP NOT NULL;
  EXCEPTION WHEN others THEN NULL;
  END;
  BEGIN
    ALTER TABLE app_security ALTER COLUMN pin_hash DROP NOT NULL;
  EXCEPTION WHEN others THEN NULL;
  END;
END $$;

-- ============================================================
-- 1) تحديث الـ trigger
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name text;
  v_provider  text;
BEGIN
  v_full_name := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'name', ''),
    NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
    'مستخدم'
  );

  v_provider := COALESCE(NEW.raw_app_meta_data->>'provider', 'email');

  -- لمستخدمي OAuth (مثل Google) نريد دائماً اسم الإيميل/الـ metadata الجديد،
  -- لا نُبقي قيم قديمة من نظام app_security السابق.
  -- لمستخدمي الإيميل العادي نُبقي السلوك القديم (COALESCE) حفاظاً على
  -- الأسماء التي يضعها المستخدم يدوياً.
  IF v_provider = 'email' THEN
    INSERT INTO app_security (id, email, user_name, full_name, role, is_active, auth_provider)
    VALUES (NEW.id, NEW.email, NEW.email, v_full_name, 'user', true, v_provider)
    ON CONFLICT (id) DO UPDATE
      SET email = EXCLUDED.email,
          user_name = COALESCE(app_security.user_name, EXCLUDED.user_name),
          auth_provider = EXCLUDED.auth_provider,
          full_name = COALESCE(NULLIF(app_security.full_name, ''), EXCLUDED.full_name);
  ELSE
    -- OAuth: نفرض البيانات الجديدة بدلاً من الإبقاء على القديمة
    INSERT INTO app_security (id, email, user_name, full_name, role, is_active, auth_provider)
    VALUES (NEW.id, NEW.email, NEW.email, v_full_name, 'user', true, v_provider)
    ON CONFLICT (id) DO UPDATE
      SET email = EXCLUDED.email,
          user_name = EXCLUDED.user_name,
          auth_provider = EXCLUDED.auth_provider,
          full_name = EXCLUDED.full_name;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 2) تنظيف لمرة واحدة: مستخدمو OAuth الحاليون الذين يحملون أسماء قديمة
-- ============================================================
UPDATE app_security s
SET
  email = u.email,
  user_name = u.email,
  full_name = COALESCE(
    NULLIF(u.raw_user_meta_data->>'full_name', ''),
    NULLIF(u.raw_user_meta_data->>'name', ''),
    s.full_name
  ),
  auth_provider = u.raw_app_meta_data->>'provider',
  updated_at = now()
FROM auth.users u
WHERE s.id = u.id
  AND COALESCE(u.raw_app_meta_data->>'provider', 'email') <> 'email';

commit;
