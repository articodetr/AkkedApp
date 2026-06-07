/*
  # فرض الحد المجاني لعدد العملاء (20 عميلاً لكل مستخدم)

  ## الهدف
  منع المستخدم من تجاوز الحد المجاني (20 عميلاً) عبر طبقتين في قاعدة البيانات:
    1. trigger على جدول customers يمنع إضافة عميل عادي جديد بعد بلوغ الحد.
    2. فحص داخل create_linked_customer يمنع المالك من ربط مستخدم جديد بعد بلوغ الحد.

  ## ملاحظات تصميمية
  - يُحتسب ضمن الحد: العملاء العاديون + المستخدمون المربوطون.
  - يُستثنى من العدّ والفرض: حساب الأرباح/الخسائر الثابت (is_profit_loss_account = true).
  - لا يُطبَّق الحد على الصفوف التي تُنشأ تلقائياً (الربط المتبادل reciprocal والحركات
    المرآة mirror)، لأنها ليست إضافة يبدأها المستخدم. هذه الصفوف تحمل linked_user_id
    غير NULL فيتجاهلها الـ trigger، بينما يُطبَّق فحص الربط على المالك (المُنشئ) فقط.
  - الحد ثابت (20) ليطابق ثابت الواجهة FREE_CUSTOMER_LIMIT في utils/subscriptionUpgradeRequest.ts.
*/

-- ============================================================
-- 1. دالة مساعدة: عدّ عملاء المستخدم (باستثناء حساب الأرباح/الخسائر)
-- ============================================================
CREATE OR REPLACE FUNCTION app_count_user_customers(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COUNT(*)::int
  FROM customers
  WHERE user_id = p_user_id
    AND COALESCE(is_profit_loss_account, false) = false;
$$;

COMMENT ON FUNCTION app_count_user_customers IS
  'عدد عملاء المستخدم المحتسَبين ضمن الحد المجاني (عاديون + مربوطون، باستثناء حساب الأرباح/الخسائر)';

GRANT EXECUTE ON FUNCTION app_count_user_customers(uuid) TO anon, authenticated;

-- ============================================================
-- 2. trigger لمنع تجاوز الحد عند إضافة عميل عادي يبدأه المستخدم
-- ============================================================
CREATE OR REPLACE FUNCTION enforce_free_customer_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count int;
  v_limit constant int := 20;
BEGIN
  -- تجاهل الصفوف التلقائية (الربط المتبادل / الحركات المرآة) — تحمل linked_user_id.
  IF NEW.linked_user_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- تجاهل حساب الأرباح/الخسائر الثابت.
  IF COALESCE(NEW.is_profit_loss_account, false) = true THEN
    RETURN NEW;
  END IF;

  -- بلا user_id لا يمكن فرض الحد (نظرياً لا يحدث لأن العمود NOT NULL).
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)::int INTO v_count
  FROM customers
  WHERE user_id = NEW.user_id
    AND COALESCE(is_profit_loss_account, false) = false;

  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'customer_limit_reached: free limit of % customers reached', v_limit
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION enforce_free_customer_limit IS
  'يمنع إضافة عميل عادي جديد بعد بلوغ الحد المجاني (20). يتجاهل الصفوف المربوطة التلقائية وحساب الأرباح/الخسائر.';

DROP TRIGGER IF EXISTS trg_enforce_free_customer_limit ON customers;
CREATE TRIGGER trg_enforce_free_customer_limit
  BEFORE INSERT ON customers
  FOR EACH ROW
  EXECUTE FUNCTION enforce_free_customer_limit();

-- ============================================================
-- 3. تحديث create_linked_customer لفرض الحد على المالك (المُنشئ) فقط
--    (نسخة مطابقة لأحدث تعريف مع إضافة فحص الحد المجاني)
-- ============================================================
CREATE OR REPLACE FUNCTION create_linked_customer(
  p_owner_user_id uuid,
  p_linked_user_id uuid,
  p_customer_name text
)
RETURNS TABLE (
  success boolean,
  customer_id uuid,
  message text
) AS $$
DECLARE
  v_customer_id uuid;
  v_reciprocal_customer_id uuid;
  v_linked_user_name text;
  v_owner_user_name text;
  v_linked_account_number text;
  v_owner_account_number text;
  v_existing_link uuid;
  v_existing_reciprocal_link uuid;
  v_owner_customer_count int;
  v_free_limit constant int := 20;
BEGIN
  -- التحقق من عدم ربط نفس المستخدم
  IF p_owner_user_id = p_linked_user_id THEN
    RETURN QUERY SELECT false, NULL::uuid, 'لا يمكن ربط نفسك كعميل'::text;
    RETURN;
  END IF;

  -- التحقق من وجود ربط سابق
  SELECT id INTO v_existing_link
  FROM customers
  WHERE user_id = p_owner_user_id
    AND linked_user_id = p_linked_user_id;

  IF v_existing_link IS NOT NULL THEN
    RETURN QUERY SELECT false, v_existing_link, 'هذا المستخدم مربوط بالفعل'::text;
    RETURN;
  END IF;

  -- فرض الحد المجاني على المالك (الإضافة التي يبدأها المستخدم فقط)
  v_owner_customer_count := app_count_user_customers(p_owner_user_id);
  IF v_owner_customer_count >= v_free_limit THEN
    RETURN QUERY SELECT
      false,
      NULL::uuid,
      ('customer_limit_reached: لقد وصلت إلى الحد المجاني (' || v_free_limit ||
       ' عميل). يجب عليك الاشتراك في التطبيق لإضافة المزيد.')::text;
    RETURN;
  END IF;

  -- الحصول على معلومات المستخدم المرتبط
  SELECT full_name, account_number INTO v_linked_user_name, v_linked_account_number
  FROM app_security
  WHERE id = p_linked_user_id;

  IF v_linked_user_name IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid, 'المستخدم المحدد غير موجود'::text;
    RETURN;
  END IF;

  -- الحصول على معلومات المستخدم المالك
  SELECT full_name, account_number INTO v_owner_user_name, v_owner_account_number
  FROM app_security
  WHERE id = p_owner_user_id;

  -- إنشاء سجل العميل المرتبط (A -> B)
  INSERT INTO customers (
    user_id,
    linked_user_id,
    name,
    phone,
    account_number,
    notes
  ) VALUES (
    p_owner_user_id,
    p_linked_user_id,
    COALESCE(p_customer_name, v_linked_user_name),
    'LINKED_USER_' || v_linked_account_number,
    v_linked_account_number,
    'عميل مرتبط بمستخدم مسجل - رقم الحساب الحقيقي: ' || v_linked_account_number
  ) RETURNING id INTO v_customer_id;

  -- إنشاء سجل في user_customer_links (A -> B)
  INSERT INTO user_customer_links (
    owner_user_id,
    linked_user_id,
    customer_id,
    status,
    notes
  ) VALUES (
    p_owner_user_id,
    p_linked_user_id,
    v_customer_id,
    'active',
    'ربط تلقائي عند إضافة العميل'
  );

  -- ============================================================
  -- الربط الثنائي: إنشاء العميل المقابل تلقائياً (B -> A)
  -- ملاحظة: الصف المقابل لا يخضع لفحص الحد لأنه ليس إضافة يبدأها المستخدم B.
  -- ============================================================

  -- التحقق من عدم وجود ربط عكسي بالفعل
  SELECT id INTO v_existing_reciprocal_link
  FROM customers
  WHERE user_id = p_linked_user_id
    AND linked_user_id = p_owner_user_id;

  IF v_existing_reciprocal_link IS NULL THEN
    -- إنشاء العميل المقابل (B -> A)
    INSERT INTO customers (
      user_id,
      linked_user_id,
      name,
      phone,
      account_number,
      notes
    ) VALUES (
      p_linked_user_id,         -- المستخدم المستهدف يصبح مالك
      p_owner_user_id,          -- المستخدم المالك يصبح مرتبط
      v_owner_user_name,        -- اسم المستخدم المالك
      'LINKED_USER_' || v_owner_account_number,
      v_owner_account_number,   -- رقم حساب المستخدم المالك
      'تم إنشاؤه تلقائياً كحساب متبادل - رقم الحساب الحقيقي: ' || v_owner_account_number
    ) RETURNING id INTO v_reciprocal_customer_id;

    -- إنشاء سجل في user_customer_links (B -> A)
    INSERT INTO user_customer_links (
      owner_user_id,
      linked_user_id,
      customer_id,
      status,
      notes
    ) VALUES (
      p_linked_user_id,
      p_owner_user_id,
      v_reciprocal_customer_id,
      'active',
      'ربط متبادل تلقائي'
    );

    -- إرسال إشعار للمستخدم المرتبط (B)
    PERFORM create_notification(
      NULL,
      p_linked_user_id,
      'customer_added',
      'تم إضافتك كحساب مرتبط من قبل ' || v_owner_user_name || ' (رقم الحساب: ' || v_owner_account_number || ')'
    );

    RAISE NOTICE 'تم إنشاء الربط الثنائي: العميل المقابل ID = %', v_reciprocal_customer_id;
  ELSE
    RAISE NOTICE 'الربط العكسي موجود بالفعل: %', v_existing_reciprocal_link;
  END IF;

  RETURN QUERY SELECT
    true,
    v_customer_id,
    'تم ربط المستخدم كعميل بنجاح (ربط ثنائي) - رقم الحساب: ' || v_linked_account_number::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION create_linked_customer IS
  'إنشاء عميل مرتبط مع ربط ثنائي تلقائي وإشعارات، مع فرض الحد المجاني (20) على المالك فقط.';
