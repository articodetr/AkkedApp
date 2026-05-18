/*
  # الانتقال إلى Supabase Auth (تسجيل الدخول بالإيميل و Google)

  ## الهدف
  - تحويل التطبيق من نظام مصادقة مخصص (app_security + user_name + PIN)
    إلى Supabase Auth (إيميل/كلمة مرور + Google).
  - جدول app_security يتحول إلى "جدول ملفات تعريف" (profiles) مرتبط بـ auth.users
    عبر نفس المعرّف (id).

  ## التغييرات
  1. إضافة email + auth_provider إلى app_security، وجعل user_name و pin_hash اختياريين.
  2. Trigger على auth.users: عند أي تسجيل جديد (إيميل أو Google) يُنشأ صف app_security
     بنفس الـ id تلقائياً (مع توليد account_number عبر التريغر الموجود مسبقاً).
  3. get_current_user_id() تعتمد الآن على auth.uid().
  4. set_current_user() تصبح دالة فارغة (توافق خلفي مع الكود القديم).
  5. نسخ جميع سياسات RLS المخصصة لدور anon إلى دور authenticated حتى يستمر
     التطبيق بالعمل بعد أن يصبح المستخدم "authenticated".
  6. دالة admin_relink_user_data() لربط بيانات حساب قديم بحساب جديد.

  ## ملاحظة
  - المستخدمون القدامى (صفوف app_security بدون auth.users) تبقى كما هي،
    وتُربط بياناتهم بالحسابات الجديدة عبر admin_relink_user_data().
*/

begin;

-- ============================================================
-- 1) app_security يتحول إلى جدول ملفات تعريف
-- ============================================================
ALTER TABLE app_security
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS auth_provider text;

-- الإيميل فريد (مع تجاهل القيم الفارغة للصفوف القديمة)
CREATE UNIQUE INDEX IF NOT EXISTS app_security_email_uidx
  ON app_security (lower(email))
  WHERE email IS NOT NULL;

-- user_name و pin_hash لم يعودا إلزاميين (كلمة المرور تُدار في auth.users)
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
-- 2) Trigger: إنشاء صف app_security عند إنشاء مستخدم في auth.users
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

  -- ملاحظة مهمة: نضع user_name = البريد الإلكتروني حتى تستمر دوال RPC القديمة
  -- التي تبحث عن المستخدم عبر user_name (مثل insert_movement_with_user) بالعمل،
  -- لأن واجهة التطبيق تمرّر currentUser.userName = البريد الإلكتروني.
  INSERT INTO app_security (id, email, user_name, full_name, role, is_active, auth_provider)
  VALUES (NEW.id, NEW.email, NEW.email, v_full_name, 'user', true, v_provider)
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        user_name = COALESCE(app_security.user_name, EXCLUDED.user_name),
        auth_provider = EXCLUDED.auth_provider,
        full_name = COALESCE(NULLIF(app_security.full_name, ''), EXCLUDED.full_name);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

-- مزامنة الإيميل عند تأكيده/تغييره في auth.users
CREATE OR REPLACE FUNCTION handle_user_email_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    -- نُبقي user_name مساوياً للبريد فقط إذا كان مساوياً له أصلاً
    -- (حتى لا نلمس أسماء المستخدمين القديمة).
    UPDATE app_security
    SET email = NEW.email,
        user_name = CASE WHEN user_name = OLD.email THEN NEW.email ELSE user_name END,
        updated_at = now()
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;
CREATE TRIGGER on_auth_user_email_updated
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_user_email_update();

-- ============================================================
-- 3) get_current_user_id() تعتمد على auth.uid()
-- ============================================================
CREATE OR REPLACE FUNCTION get_current_user_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT auth.uid();
$$;

GRANT EXECUTE ON FUNCTION get_current_user_id() TO anon, authenticated;

-- دالة مساعدة للتحقق من صلاحية المدير (SECURITY DEFINER لتجنب تكرار RLS)
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_security
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

GRANT EXECUTE ON FUNCTION is_admin() TO anon, authenticated;

-- ============================================================
-- 4) set_current_user() تصبح دالة فارغة (توافق خلفي)
-- ============================================================
CREATE OR REPLACE FUNCTION set_current_user(user_name text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- لم تعد مستخدمة بعد الانتقال إلى Supabase Auth.
  -- نُبقيها فارغة حتى لا ينكسر الكود القديم الذي ما زال يستدعيها.
  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION set_current_user(text) TO anon, authenticated;

-- ============================================================
-- 5) نسخ سياسات RLS من دور anon إلى دور authenticated
--    حتى يستمر التطبيق بالعمل بعد أن يصبح المستخدم authenticated.
-- ============================================================
DO $$
DECLARE
  pol      record;
  v_name   text;
  v_using  text;
  v_check  text;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND 'anon' = ANY (roles)
      AND NOT ('authenticated' = ANY (roles))
      AND NOT ('public' = ANY (roles))
  LOOP
    v_name  := left(pol.policyname, 55) || '_auth';
    v_using := CASE WHEN pol.qual IS NOT NULL
                    THEN ' USING (' || pol.qual || ')' ELSE '' END;
    v_check := CASE WHEN pol.with_check IS NOT NULL
                    THEN ' WITH CHECK (' || pol.with_check || ')' ELSE '' END;
    BEGIN
      EXECUTE format(
        'CREATE POLICY %I ON %I.%I AS PERMISSIVE FOR %s TO authenticated%s%s',
        v_name, pol.schemaname, pol.tablename, pol.cmd, v_using, v_check
      );
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN
        RAISE NOTICE 'تخطّي السياسة %.% : %', pol.tablename, pol.policyname, SQLERRM;
    END;
  END LOOP;
END $$;

-- ضمان صلاحيات الجداول والتسلسلات لدور authenticated
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated;

-- ============================================================
-- 6) ربط بيانات حساب قديم بحساب جديد
--    يستطيع تشغيلها: المدير، أو صاحب الحساب الجديد نفسه.
-- ============================================================
CREATE OR REPLACE FUNCTION admin_relink_user_data(
  p_old_user_id uuid,
  p_new_user_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r        record;
  v_rows   bigint;
  v_total  bigint := 0;
BEGIN
  IF p_old_user_id IS NULL OR p_new_user_id IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'المعرّفات مطلوبة');
  END IF;

  IF p_old_user_id = p_new_user_id THEN
    RETURN json_build_object('success', false, 'message', 'الحسابان متطابقان');
  END IF;

  -- التحقق من الصلاحية: مدير أو صاحب الحساب الجديد
  IF NOT (
    EXISTS (SELECT 1 FROM app_security WHERE id = auth.uid() AND role = 'admin')
    OR auth.uid() = p_new_user_id
  ) THEN
    RETURN json_build_object('success', false, 'message', 'غير مصرح بهذه العملية');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM app_security WHERE id = p_new_user_id) THEN
    RETURN json_build_object('success', false, 'message', 'الحساب الجديد غير موجود');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM app_security WHERE id = p_old_user_id) THEN
    RETURN json_build_object('success', false, 'message', 'الحساب القديم غير موجود');
  END IF;

  -- إعدادات المتجر: نحذف الإعدادات الفارغة للحساب الجديد ثم ننقل القديمة
  DELETE FROM app_settings WHERE user_id = p_new_user_id;
  UPDATE app_settings SET user_id = p_new_user_id WHERE user_id = p_old_user_id;

  -- نقل بقية الأعمدة المرتبطة بالمستخدم في كل جداول public ديناميكياً
  FOR r IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.column_name IN ('user_id', 'linked_user_id', 'created_by_user_id', 'source_user_id')
      AND c.table_name NOT IN ('app_security', 'app_settings')
  LOOP
    EXECUTE format(
      'UPDATE public.%I SET %I = $1 WHERE %I = $2',
      r.table_name, r.column_name, r.column_name
    ) USING p_new_user_id, p_old_user_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_total := v_total + v_rows;
  END LOOP;

  RETURN json_build_object(
    'success', true,
    'message', 'تم ربط البيانات بنجاح',
    'updated_rows', v_total
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_relink_user_data(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION admin_relink_user_data(uuid, uuid) TO authenticated;

-- دالة مساعدة: قائمة الحسابات القديمة غير المرتبطة بـ auth.users
-- (للمدير) — تُستخدم في شاشة ربط البيانات.
CREATE OR REPLACE FUNCTION get_legacy_accounts()
RETURNS TABLE (
  id uuid,
  user_name text,
  full_name text,
  account_number text,
  role text,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.user_name, s.full_name, s.account_number, s.role, s.created_at
  FROM app_security s
  WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = s.id)
  ORDER BY s.created_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION get_legacy_accounts() FROM anon;
GRANT EXECUTE ON FUNCTION get_legacy_accounts() TO authenticated;

commit;
