/*
  وحدة الجهات والشبكات — المرحلة 1: حسابات التسوية
  =================================================

  كل جهة/شبكة تحصل على "حساب تسوية" — صف عميل نظامي مخفي (بنفس نمط حساب
  الأرباح والخسائر) يوازن قيود توزيع العمولات في المراحل القادمة، ويرث
  تلقائياً الأرصدة والكشوفات والتقارير الموجودة.

  - customers.is_entity_settlement_account: علامة الحساب النظامي.
  - transfer_entities.settlement_customer_id → customers (ON DELETE RESTRICT):
    يمنع حذف حساب التسوية ما دامت الجهة قائمة.
  - إنشاء تلقائي عبر تريغر عند إضافة جهة + backfill للجهات الموجودة.
  - مزامنة اسم حساب التسوية عند إعادة تسمية الجهة.
  - حذف الجهة: ممنوع إن كانت لحساب تسويتها حركات (توقف بدل الحذف)،
    وإلا يُحذف حساب التسوية اليتيم تلقائياً بعد حذف الجهة.
  - حسابات التسوية مستثناة من: الحد المجاني للعملاء (20)، قائمة العملاء
    (customers_with_last_activity)، وإحصائيات get_app_statistics
    و get_app_period_statistics.

  لا قواعد عمولات ولا تحويلات في هذه المرحلة.
*/

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) الأعمدة والعلاقات
-- ---------------------------------------------------------------------------
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS is_entity_settlement_account boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.customers.is_entity_settlement_account IS
  'حساب تسوية نظامي مخفي خاص بجهة/شبكة تحويل — لا يظهر في قائمة العملاء ولا يُحتسب في الحد المجاني.';

ALTER TABLE public.transfer_entities
  ADD COLUMN IF NOT EXISTS settlement_customer_id uuid REFERENCES public.customers(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_transfer_entities_settlement_customer
  ON public.transfer_entities (settlement_customer_id)
  WHERE settlement_customer_id IS NOT NULL;

COMMENT ON COLUMN public.transfer_entities.settlement_customer_id IS
  'حساب التسوية (صف في customers) الذي يوازن قيود عمولات هذه الجهة.';

-- ---------------------------------------------------------------------------
-- 2) إنشاء حساب التسوية (idempotent)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_entity_settlement_account(p_entity_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entity record;
  v_customer_id uuid;
BEGIN
  IF p_entity_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_entity
  FROM public.transfer_entities
  WHERE id = p_entity_id;

  IF v_entity.id IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_entity.settlement_customer_id IS NOT NULL THEN
    SELECT id INTO v_customer_id
    FROM public.customers
    WHERE id = v_entity.settlement_customer_id;

    IF v_customer_id IS NOT NULL THEN
      RETURN v_customer_id;
    END IF;
  END IF;

  INSERT INTO public.customers (
    name,
    phone,
    user_id,
    is_entity_settlement_account,
    notes,
    created_at,
    updated_at
  )
  VALUES (
    'تسوية — ' || v_entity.name,
    'ENTITY_' || replace(p_entity_id::text, '-', '_'),
    v_entity.user_id,
    true,
    'حساب تسوية تلقائي للجهة/الشبكة. لا يُحذف يدوياً.',
    now(),
    now()
  )
  RETURNING id INTO v_customer_id;

  UPDATE public.transfer_entities
     SET settlement_customer_id = v_customer_id
   WHERE id = p_entity_id;

  RETURN v_customer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_entity_settlement_account(uuid) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) تريغرات دورة حياة الجهة
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_settlement_after_entity_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.ensure_entity_settlement_account(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_entity_settlement_after_insert ON public.transfer_entities;
CREATE TRIGGER trg_entity_settlement_after_insert
  AFTER INSERT ON public.transfer_entities
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_settlement_after_entity_insert();

-- مزامنة اسم حساب التسوية عند إعادة تسمية الجهة
CREATE OR REPLACE FUNCTION public.sync_settlement_name_after_entity_rename()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.settlement_customer_id IS NOT NULL AND NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.customers
       SET name = 'تسوية — ' || NEW.name,
           updated_at = now()
     WHERE id = NEW.settlement_customer_id
       AND COALESCE(is_entity_settlement_account, false) = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_entity_settlement_sync_name ON public.transfer_entities;
CREATE TRIGGER trg_entity_settlement_sync_name
  AFTER UPDATE OF name ON public.transfer_entities
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_settlement_name_after_entity_rename();

-- منع حذف جهة لها حركات تسوية، وتنظيف الحساب اليتيم عند الحذف المسموح
CREATE OR REPLACE FUNCTION public.block_entity_delete_with_settlement_movements()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.settlement_customer_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.account_movements am
    WHERE am.customer_id = OLD.settlement_customer_id
  ) THEN
    RAISE EXCEPTION 'لا يمكن حذف الجهة لوجود حركات على حساب تسويتها — يمكنك إيقافها بدلاً من حذفها';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_entity_block_delete_with_movements ON public.transfer_entities;
CREATE TRIGGER trg_entity_block_delete_with_movements
  BEFORE DELETE ON public.transfer_entities
  FOR EACH ROW
  EXECUTE FUNCTION public.block_entity_delete_with_settlement_movements();

CREATE OR REPLACE FUNCTION public.cleanup_settlement_after_entity_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.settlement_customer_id IS NOT NULL THEN
    DELETE FROM public.customers
     WHERE id = OLD.settlement_customer_id
       AND COALESCE(is_entity_settlement_account, false) = true
       AND NOT EXISTS (
         SELECT 1
         FROM public.account_movements am
         WHERE am.customer_id = OLD.settlement_customer_id
       );
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_entity_settlement_cleanup ON public.transfer_entities;
CREATE TRIGGER trg_entity_settlement_cleanup
  AFTER DELETE ON public.transfer_entities
  FOR EACH ROW
  EXECUTE FUNCTION public.cleanup_settlement_after_entity_delete();

-- ---------------------------------------------------------------------------
-- 4) الحد المجاني: حسابات التسوية لا تُحتسب ولا تُحتجز.
--    يوجد حارسان على INSERT في customers:
--      أ) enforce_free_customer_limit (هجرة 20260607000000 المحلية)
--      ب) enforce_customer_free_limit (نظام الاشتراكات — مطبق عن بُعد فقط،
--         يفوض العد إلى admin_dashboard_get_customer_quota_snapshot)
--    أجسام دوال (ب) منسوخة حرفياً من قاعدة البيانات الحية مع إضافة
--    استثناء حسابات التسوية فقط. يجب أن يسبق هذا القسم الـ backfill
--    وإلا فشل إنشاء حسابات التسوية لمن بلغ الحد المجاني.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_count_user_customers(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT COUNT(*)::int
  FROM customers
  WHERE user_id = p_user_id
    AND COALESCE(is_profit_loss_account, false) = false
    AND COALESCE(is_entity_settlement_account, false) = false;
$$;

COMMENT ON FUNCTION app_count_user_customers IS
  'عدد عملاء المستخدم المحتسَبين ضمن الحد المجاني (باستثناء حساب الأرباح/الخسائر وحسابات تسوية الجهات).';

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

  -- تجاهل حسابات تسوية الجهات النظامية.
  IF COALESCE(NEW.is_entity_settlement_account, false) = true THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)::int INTO v_count
  FROM customers
  WHERE user_id = NEW.user_id
    AND COALESCE(is_profit_loss_account, false) = false
    AND COALESCE(is_entity_settlement_account, false) = false;

  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'customer_limit_reached: free limit of % customers reached', v_limit
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- (ب) دوال نظام الاشتراكات الحية — نسخ حرفية مع استثناء حسابات التسوية.
--     ملاحظة: جدول admin_subscriptions ودالة
--     admin_dashboard_effective_subscription_status موجودان في القاعدة
--     الحية عبر هجرات بعيدة غير مضمّنة محلياً؛ إنشاء الدوال هنا سليم
--     لأن plpgsql لا يتحقق من الجداول إلا عند التنفيذ.
CREATE OR REPLACE FUNCTION public.admin_dashboard_get_customer_quota_snapshot(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_customer_count integer := 0;
  v_limit integer;
  v_free_limit integer := 20;
  v_has_active boolean := false;
  v_subscription_id uuid;
  v_plan_name text;
  v_end_date date;
  v_effective_status text;
BEGIN
  SELECT COUNT(*)::integer
  INTO v_customer_count
  FROM public.customers c
  WHERE c.user_id = p_user_id
    AND COALESCE(c.is_profit_loss_account, false) = false
    AND COALESCE(c.is_entity_settlement_account, false) = false;

  SELECT
    s.id,
    GREATEST(COALESCE(s.max_customers, 999999), v_free_limit),
    s.plan_name,
    s.end_date,
    public.admin_dashboard_effective_subscription_status(s.status, s.end_date)
  INTO v_subscription_id, v_limit, v_plan_name, v_end_date, v_effective_status
  FROM public.admin_subscriptions s
  WHERE s.user_id = p_user_id
    AND public.admin_dashboard_effective_subscription_status(s.status, s.end_date) IN ('active', 'ending_soon', 'trial')
  ORDER BY s.end_date DESC, s.created_at DESC
  LIMIT 1;

  v_has_active := v_subscription_id IS NOT NULL;
  v_limit := COALESCE(v_limit, v_free_limit);

  RETURN jsonb_build_object(
    'customer_count', v_customer_count,
    'customer_limit', v_limit,
    'free_customer_limit', v_free_limit,
    'has_active_subscription', v_has_active,
    'can_add_customer', v_customer_count < v_limit,
    'subscription_id', v_subscription_id,
    'plan_name', v_plan_name,
    'end_date', v_end_date,
    'subscription_status', v_effective_status,
    'quota_message', CASE
      WHEN v_customer_count >= v_limit AND v_has_active THEN 'وصل المستخدم إلى الحد المسموح في الاشتراك الحالي'
      WHEN v_customer_count >= v_limit THEN 'وصل المستخدم إلى الحد المجاني 20 عميل، يجب تفعيل الاشتراك'
      ELSE 'يمكن إضافة عميل'
    END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_customer_free_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_quota jsonb;
  v_message text;
BEGIN
  IF COALESCE(NEW.is_profit_loss_account, false) = true THEN
    RETURN NEW;
  END IF;

  -- حسابات تسوية الجهات النظامية لا تخضع للحد.
  IF COALESCE(NEW.is_entity_settlement_account, false) = true THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_quota := public.admin_dashboard_get_customer_quota_snapshot(NEW.user_id);

  IF COALESCE((v_quota->>'can_add_customer')::boolean, true) = false THEN
    v_message := COALESCE(v_quota->>'quota_message', 'وصلت إلى الحد المسموح من العملاء');
    RAISE EXCEPTION '%', v_message
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'customer_count', v_quota->>'customer_count',
              'customer_limit', v_quota->>'customer_limit',
              'free_customer_limit', v_quota->>'free_customer_limit'
            )::text;
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5) Backfill: حسابات تسوية للجهات الموجودة (بعد تحديث الحرّاس)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id FROM public.transfer_entities WHERE settlement_customer_id IS NULL
  LOOP
    PERFORM public.ensure_entity_settlement_account(r.id);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 6) إخفاء حسابات التسوية من قائمة العملاء
--    (نفس تعريف 20260124132009 + العمود الجديد + استثناء حسابات التسوية)
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS customers_with_last_activity CASCADE;

CREATE VIEW customers_with_last_activity AS
SELECT
  c.id,
  c.name,
  c.account_number,
  c.phone,
  c.notes,
  c.is_profit_loss_account,
  c.is_entity_settlement_account,
  c.user_id,
  c.linked_user_id,
  c.created_at,
  c.updated_at,
  COALESCE(
    (
      SELECT MAX(am.created_at)
      FROM account_movements am
      WHERE am.customer_id = c.id
        AND am.is_voided = false
    ),
    c.created_at
  ) AS last_activity,
  (
    SELECT COUNT(*)
    FROM account_movements am
    WHERE am.customer_id = c.id
      AND am.is_voided = false
  ) AS movement_count,
  COALESCE(
    (
      SELECT json_agg(
        json_build_object(
          'currency', currency,
          'balance', balance
        )
      )
      FROM (
        SELECT
          am.currency,
          SUM(
            CASE
              WHEN am.movement_type = 'incoming' THEN am.amount
              WHEN am.movement_type = 'outgoing' THEN -am.amount
              ELSE 0
            END
          ) AS balance
        FROM account_movements am
        WHERE am.customer_id = c.id
          AND am.is_voided = false
        GROUP BY am.currency
        HAVING SUM(
          CASE
            WHEN am.movement_type = 'incoming' THEN am.amount
            WHEN am.movement_type = 'outgoing' THEN -am.amount
            ELSE 0
          END
        ) != 0
      ) balances
    ),
    '[]'::json
  ) AS balances
FROM customers c
WHERE COALESCE(c.is_entity_settlement_account, false) = false
ORDER BY last_activity DESC;

GRANT SELECT ON customers_with_last_activity TO authenticated, anon;

COMMENT ON VIEW customers_with_last_activity IS
  'Customers with last activity and balances - application filters by user_id; entity settlement accounts are hidden';

-- ---------------------------------------------------------------------------
-- 7) الإحصائيات: استثناء حسابات التسوية من نطاق العملاء المرئيين
--    (نسخة حرفية من 20260425190500 مع إضافة الشرط الجديد فقط —
--     مُولّدة آلياً من الملف الأصلي)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_app_period_statistics(
  p_user_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start timestamptz := p_start_date::timestamptz;
  v_end timestamptz := (p_end_date + 1)::timestamptz;
  v_role text;
  v_result jsonb;
BEGIN
  SELECT role INTO v_role
  FROM public.app_security
  WHERE id = p_user_id
  LIMIT 1;

  WITH visible_customers AS (
    SELECT c.*
    FROM public.customers c
    WHERE (v_role = 'admin' OR c.user_id = p_user_id)
      AND COALESCE(c.is_profit_loss_account, false) = false
      AND c.phone IS DISTINCT FROM 'PROFIT_LOSS_ACCOUNT'
      AND COALESCE(c.is_entity_settlement_account, false) = false
  ),
  period_transactions AS (
    SELECT t.*
    FROM public.transactions t
    JOIN visible_customers c ON c.id = t.customer_id
    WHERE COALESCE(t.status, 'completed') = 'completed'
      AND t.created_at >= v_start
      AND t.created_at < v_end
  ),
  period_movements AS (
    SELECT am.*
    FROM public.account_movements am
    JOIN visible_customers c ON c.id = am.customer_id
    WHERE am.created_at >= v_start
      AND am.created_at < v_end
      AND COALESCE(am.is_commission_movement, false) = false
      AND COALESCE(am.is_voided, false) = false
      AND public.get_movement_approval_status(am.approval_status, am.pending_approval) = 'approved'
      AND (
        v_role <> 'admin'
        OR am.mirror_movement_id IS NULL
        OR am.id::text < am.mirror_movement_id::text
      )
  ),
  period_commissions AS (
    SELECT COALESCE(NULLIF(am.commission_currency, ''), am.currency) AS currency, COALESCE(am.commission, 0) AS amount
    FROM period_movements am
    WHERE COALESCE(am.commission, 0) > 0
    UNION ALL
    SELECT am.currency, COALESCE(am.amount, 0) AS amount
    FROM public.account_movements am
    JOIN visible_customers c ON c.id = am.customer_id
    WHERE am.created_at >= v_start
      AND am.created_at < v_end
      AND COALESCE(am.is_commission_movement, false) = true
      AND COALESCE(am.is_voided, false) = false
      AND public.get_movement_approval_status(am.approval_status, am.pending_approval) = 'approved'
  )
  SELECT jsonb_build_object(
    'transactions', (SELECT COUNT(*) FROM period_transactions),
    'movements', (SELECT COUNT(*) FROM period_movements),
    'commissionMovements', (SELECT COUNT(*) FROM period_commissions),
    'transactionAmount', COALESCE((SELECT SUM(amount_sent) FROM period_transactions), 0),
    'movementAmount', COALESCE((SELECT SUM(amount) FROM period_movements), 0),
    'commissionAmount', COALESCE((SELECT SUM(amount) FROM period_commissions), 0),
    'transactionAmountsByCurrency', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('currency', currency_sent, 'amount', amount) ORDER BY amount DESC)
      FROM (
        SELECT currency_sent, SUM(amount_sent) AS amount
        FROM period_transactions
        GROUP BY currency_sent
      ) s
    ), '[]'::jsonb),
    'movementAmountsByCurrency', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount) ORDER BY amount DESC)
      FROM (
        SELECT currency, SUM(amount) AS amount
        FROM period_movements
        GROUP BY currency
      ) s
    ), '[]'::jsonb),
    'commissionAmountsByCurrency', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount) ORDER BY amount DESC)
      FROM (
        SELECT currency, SUM(amount) AS amount
        FROM period_commissions
        GROUP BY currency
      ) s
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- -----------------------------------------------------------------------------
-- 8) Main statistics: approved cash flow is counted from the user's own ledger
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_app_statistics(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := CURRENT_DATE;
  v_yesterday date := CURRENT_DATE - 1;
  v_week_start date := CURRENT_DATE - 7;
  v_month_start date := CURRENT_DATE - 30;
  v_role text;
  v_result jsonb;
BEGIN
  SELECT role INTO v_role
  FROM public.app_security
  WHERE id = p_user_id
  LIMIT 1;

  WITH approval_scope_customers AS (
    SELECT c.*
    FROM public.customers c
    WHERE v_role = 'admin'
       OR c.user_id = p_user_id
       OR c.linked_user_id = p_user_id
       OR c.id IN (
         SELECT am.customer_id
         FROM public.account_movements am
         JOIN public.movement_notifications mn ON mn.movement_id = am.id
         WHERE mn.user_id = p_user_id
       )
  ),
  visible_customers AS (
    SELECT c.*
    FROM public.customers c
    WHERE (v_role = 'admin' OR c.user_id = p_user_id)
      AND COALESCE(c.is_profit_loss_account, false) = false
      AND c.phone IS DISTINCT FROM 'PROFIT_LOSS_ACCOUNT'
      AND COALESCE(c.is_entity_settlement_account, false) = false
  ),
  scoped_transactions AS (
    SELECT t.*
    FROM public.transactions t
    JOIN visible_customers c ON c.id = t.customer_id
    WHERE COALESCE(t.status, 'completed') = 'completed'
  ),
  approval_scope_movements AS (
    SELECT
      am.*,
      c.name AS customer_name,
      c.phone AS customer_phone,
      c.user_id AS customer_user_id,
      c.linked_user_id AS customer_linked_user_id,
      COALESCE(c.is_profit_loss_account, false) AS customer_is_profit_loss_account,
      public.get_movement_approval_status(am.approval_status, am.pending_approval) AS normalized_status,
      COALESCE(am.is_voided, false) AS normalized_voided,
      COALESCE(am.is_commission_movement, false) AS normalized_commission,
      CASE
        WHEN am.mirror_movement_id IS NOT NULL THEN LEAST(am.id::text, am.mirror_movement_id::text)
        ELSE am.id::text
      END AS logical_pair_key
    FROM public.account_movements am
    JOIN approval_scope_customers c ON c.id = am.customer_id
  ),
  visible_movements AS (
    SELECT
      am.*,
      c.name AS customer_name,
      c.phone AS customer_phone,
      c.user_id AS customer_user_id,
      c.linked_user_id AS customer_linked_user_id,
      COALESCE(c.is_profit_loss_account, false) AS customer_is_profit_loss_account,
      public.get_movement_approval_status(am.approval_status, am.pending_approval) AS normalized_status,
      COALESCE(am.is_voided, false) AS normalized_voided,
      COALESCE(am.is_commission_movement, false) AS normalized_commission,
      CASE
        WHEN am.mirror_movement_id IS NOT NULL THEN LEAST(am.id::text, am.mirror_movement_id::text)
        ELSE am.id::text
      END AS logical_pair_key
    FROM public.account_movements am
    JOIN visible_customers c ON c.id = am.customer_id
    WHERE v_role <> 'admin'
       OR am.mirror_movement_id IS NULL
       OR am.id::text < am.mirror_movement_id::text
  ),
  visible_non_commission_movements AS (
    SELECT *
    FROM visible_movements
    WHERE normalized_commission = false
      AND normalized_voided = false
      AND currency IS NOT NULL
  ),
  approved_customer_movements AS (
    SELECT *
    FROM visible_non_commission_movements
    WHERE normalized_status = 'approved'
  ),
  pending_scope_movements_raw AS (
    SELECT *
    FROM approval_scope_movements
    WHERE normalized_commission = false
      AND normalized_voided = false
      AND currency IS NOT NULL
      AND normalized_status = 'pending'
  ),
  pending_customer_movements AS (
    SELECT *
    FROM (
      SELECT
        p.*,
        row_number() OVER (
          PARTITION BY p.logical_pair_key
          ORDER BY
            CASE WHEN p.id IN (
              SELECT movement_id
              FROM public.movement_notifications
              WHERE user_id = p_user_id
                AND notification_type = 'approval_needed'
                AND COALESCE(action_required, true) = true
            ) THEN 0 ELSE 1 END,
            CASE WHEN p.customer_user_id = p_user_id THEN 0 ELSE 1 END,
            p.created_at DESC
        ) AS rn
      FROM pending_scope_movements_raw p
    ) ranked
    WHERE rn = 1
  ),
  balance_by_customer_currency AS (
    SELECT
      customer_id,
      customer_name,
      customer_phone,
      customer_user_id,
      customer_linked_user_id,
      currency,
      SUM(CASE WHEN movement_type = 'incoming' THEN amount ELSE 0 END) AS total_incoming,
      SUM(CASE WHEN movement_type = 'outgoing' THEN amount ELSE 0 END) AS total_outgoing,
      SUM(CASE
        WHEN movement_type = 'incoming' THEN amount
        WHEN movement_type = 'outgoing' THEN -amount
        ELSE 0
      END) AS balance
    FROM approved_customer_movements
    GROUP BY customer_id, customer_name, customer_phone, customer_user_id, customer_linked_user_id, currency
  ),
  currency_balances AS (
    SELECT currency, SUM(total_incoming) AS total_incoming, SUM(total_outgoing) AS total_outgoing, SUM(balance) AS balance
    FROM balance_by_customer_currency
    GROUP BY currency
  ),
  owed_to_us AS (
    SELECT currency, ABS(SUM(balance)) AS amount
    FROM balance_by_customer_currency
    WHERE balance < 0
    GROUP BY currency
  ),
  we_owe AS (
    SELECT currency, SUM(balance) AS amount
    FROM balance_by_customer_currency
    WHERE balance > 0
    GROUP BY currency
  ),
  cash_flow_currencies AS (
    SELECT currency FROM visible_non_commission_movements WHERE currency IS NOT NULL
    UNION
    SELECT currency FROM pending_customer_movements WHERE currency IS NOT NULL
  ),
  cash_flow AS (
    SELECT
      cur.currency,
      COALESCE(SUM(CASE WHEN vm.normalized_status = 'approved' AND vm.movement_type = 'incoming' THEN vm.amount ELSE 0 END), 0) AS total_received,
      COALESCE(SUM(CASE WHEN vm.normalized_status = 'approved' AND vm.movement_type = 'outgoing' THEN vm.amount ELSE 0 END), 0) AS total_paid,
      COALESCE(SUM(CASE WHEN vm.normalized_status = 'approved' AND vm.movement_type = 'incoming'
        AND (vm.related_transfer_id IS NOT NULL OR vm.mirror_movement_id IS NOT NULL)
        AND vm.from_customer_id IS NULL AND vm.to_customer_id IS NULL THEN vm.amount ELSE 0 END), 0) AS linked_received,
      COALESCE(SUM(CASE WHEN vm.normalized_status = 'approved' AND vm.movement_type = 'outgoing'
        AND (vm.related_transfer_id IS NOT NULL OR vm.mirror_movement_id IS NOT NULL)
        AND vm.from_customer_id IS NULL AND vm.to_customer_id IS NULL THEN vm.amount ELSE 0 END), 0) AS linked_paid,
      COALESCE(SUM(CASE WHEN vm.normalized_status = 'approved' AND vm.movement_type = 'incoming'
        AND vm.related_transfer_id IS NULL AND vm.mirror_movement_id IS NULL
        AND vm.from_customer_id IS NULL AND vm.to_customer_id IS NULL THEN vm.amount ELSE 0 END), 0) AS direct_received,
      COALESCE(SUM(CASE WHEN vm.normalized_status = 'approved' AND vm.movement_type = 'outgoing'
        AND vm.related_transfer_id IS NULL AND vm.mirror_movement_id IS NULL
        AND vm.from_customer_id IS NULL AND vm.to_customer_id IS NULL THEN vm.amount ELSE 0 END), 0) AS direct_paid,
      COALESCE((SELECT SUM(pm.amount) FROM pending_customer_movements pm WHERE pm.currency = cur.currency), 0) AS pending_amount,
      COALESCE((SELECT COUNT(*) FROM pending_customer_movements pm WHERE pm.currency = cur.currency), 0) AS pending_count,
      COALESCE(SUM(CASE WHEN vm.from_customer_id IS NOT NULL OR vm.to_customer_id IS NOT NULL THEN vm.amount ELSE 0 END), 0) AS internal_transfer_amount,
      COUNT(vm.id) FILTER (WHERE vm.from_customer_id IS NOT NULL OR vm.to_customer_id IS NOT NULL) AS internal_transfer_count,
      COUNT(vm.id) FILTER (WHERE vm.normalized_status = 'approved') AS approved_count
    FROM cash_flow_currencies cur
    LEFT JOIN visible_non_commission_movements vm ON vm.currency = cur.currency
    GROUP BY cur.currency
  ),
  pending_stats AS (
    SELECT
      COUNT(*) FILTER (
        WHERE (
          COALESCE(source_user_id, created_by_user_id) IS DISTINCT FROM p_user_id
          AND (
            customer_user_id = p_user_id
            OR customer_linked_user_id = p_user_id
            OR id IN (
              SELECT movement_id
              FROM public.movement_notifications
              WHERE user_id = p_user_id
                AND notification_type = 'approval_needed'
                AND COALESCE(action_required, true) = true
            )
          )
        )
      ) AS awaiting_my_approval_count,
      COUNT(*) FILTER (
        WHERE COALESCE(source_user_id, created_by_user_id) = p_user_id
      ) AS awaiting_others_approval_count,
      COUNT(*) FILTER (WHERE created_at <= now() - interval '24 hours') AS stale_pending_count
    FROM pending_customer_movements
  ),
  approval_performance AS (
    SELECT
      COUNT(*) FILTER (WHERE normalized_status = 'approved' AND approved_at >= now() - interval '7 days') AS approved_last_7_days,
      COUNT(*) FILTER (WHERE normalized_status = 'rejected' AND COALESCE(rejected_at, created_at) >= now() - interval '7 days') AS rejected_last_7_days,
      AVG(EXTRACT(EPOCH FROM (approved_at - created_at)) / 60.0) FILTER (
        WHERE normalized_status = 'approved'
          AND approved_at >= now() - interval '7 days'
          AND approved_at IS NOT NULL
      ) AS average_approval_minutes_last_7_days
    FROM visible_movements
    WHERE normalized_commission = false
  ),
  commission_entries AS (
    SELECT COALESCE(NULLIF(commission_currency, ''), currency) AS currency, COALESCE(commission, 0) AS amount
    FROM approved_customer_movements
    WHERE COALESCE(commission, 0) > 0
    UNION ALL
    SELECT vm.currency, COALESCE(vm.amount, 0) AS amount
    FROM visible_movements vm
    WHERE vm.normalized_commission = true
      AND vm.normalized_voided = false
      AND vm.normalized_status = 'approved'
      AND vm.currency IS NOT NULL
  ),
  top_customer_stats AS (
    SELECT
      c.id,
      c.name,
      c.phone,
      c.linked_user_id,
      COUNT(am.id) AS total_movements,
      COALESCE(SUM(am.amount), 0) AS total_volume,
      COALESCE(MAX(am.created_at), COALESCE(c.updated_at, c.created_at)) AS last_activity
    FROM visible_customers c
    LEFT JOIN approved_customer_movements am ON am.customer_id = c.id
    GROUP BY c.id, c.name, c.phone, c.linked_user_id, c.created_at, c.updated_at
    HAVING COUNT(am.id) > 0
    ORDER BY COUNT(am.id) DESC, COALESCE(SUM(am.amount), 0) DESC, COALESCE(MAX(am.created_at), COALESCE(c.updated_at, c.created_at)) DESC
    LIMIT 5
  )
  SELECT jsonb_build_object(
    'totalCustomers', (SELECT COUNT(*) FROM visible_customers),
    'totalTransactions', (SELECT COUNT(*) FROM scoped_transactions),
    'totalMovements', (SELECT COUNT(*) FROM approved_customer_movements),
    'totalAmount', COALESCE((SELECT SUM(amount) FROM approved_customer_movements), 0),
    'totalDebts', COALESCE((SELECT SUM(amount) FROM owed_to_us), 0),
    'totalWeOwe', COALESCE((SELECT SUM(amount) FROM we_owe), 0),
    'periodStats', jsonb_build_object(
      'today', public.get_app_period_statistics(p_user_id, v_today, v_today),
      'yesterday', public.get_app_period_statistics(p_user_id, v_yesterday, v_yesterday),
      'week', public.get_app_period_statistics(p_user_id, v_week_start, v_today),
      'month', public.get_app_period_statistics(p_user_id, v_month_start, v_today)
    ),
    'currencyBalances', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'currency', currency,
        'total_incoming', COALESCE(total_incoming, 0),
        'total_outgoing', COALESCE(total_outgoing, 0),
        'balance', COALESCE(balance, 0)
      ) ORDER BY currency)
      FROM currency_balances
    ), '[]'::jsonb),
    'cashFlowByCurrency', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'currency', currency,
        'totalReceived', COALESCE(total_received, 0),
        'totalPaid', COALESCE(total_paid, 0),
        'netFlow', COALESCE(total_received, 0) - COALESCE(total_paid, 0),
        'linkedReceived', COALESCE(linked_received, 0),
        'linkedPaid', COALESCE(linked_paid, 0),
        'directReceived', COALESCE(direct_received, 0),
        'directPaid', COALESCE(direct_paid, 0),
        'pendingAmount', COALESCE(pending_amount, 0),
        'pendingCount', COALESCE(pending_count, 0),
        'internalTransferAmount', COALESCE(internal_transfer_amount, 0),
        'internalTransferCount', COALESCE(internal_transfer_count, 0),
        'approvedCount', COALESCE(approved_count, 0)
      ) ORDER BY currency)
      FROM cash_flow
    ), '[]'::jsonb),
    'topCustomers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'phone', t.phone,
        'linked_user_id', t.linked_user_id,
        'totalMovements', t.total_movements,
        'totalVolume', t.total_volume,
        'lastActivity', t.last_activity,
        'balanceByCurrency', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('currency', b.currency, 'amount', b.balance) ORDER BY ABS(b.balance) DESC)
          FROM balance_by_customer_currency b
          WHERE b.customer_id = t.id
            AND b.balance <> 0
        ), '[]'::jsonb)
      ))
      FROM top_customer_stats t
    ), '[]'::jsonb),
    'commissionStats', jsonb_build_object(
      'totalCommission', COALESCE((SELECT SUM(amount) FROM commission_entries), 0),
      'commissionByCurrency', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('currency', currency, 'total', total) ORDER BY total DESC)
        FROM (
          SELECT currency, SUM(amount) AS total
          FROM commission_entries
          GROUP BY currency
        ) s
      ), '[]'::jsonb)
    ),
    'debtStats', jsonb_build_object(
      'totalOwedToUs', COALESCE((SELECT SUM(amount) FROM owed_to_us), 0),
      'totalWeOwe', COALESCE((SELECT SUM(amount) FROM we_owe), 0),
      'owedToUsByCurrency', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount) ORDER BY amount DESC)
        FROM owed_to_us
      ), '[]'::jsonb),
      'weOweByCurrency', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount) ORDER BY amount DESC)
        FROM we_owe
      ), '[]'::jsonb)
    ),
    'actionableStats', jsonb_build_object(
      'awaitingMyApprovalCount', COALESCE((SELECT awaiting_my_approval_count FROM pending_stats), 0),
      'awaitingMyApprovalByCurrency', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount) ORDER BY amount DESC)
        FROM (
          SELECT currency, SUM(amount) AS amount
          FROM pending_customer_movements
          WHERE COALESCE(source_user_id, created_by_user_id) IS DISTINCT FROM p_user_id
          GROUP BY currency
        ) s
      ), '[]'::jsonb),
      'awaitingOthersApprovalCount', COALESCE((SELECT awaiting_others_approval_count FROM pending_stats), 0),
      'awaitingOthersApprovalByCurrency', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount) ORDER BY amount DESC)
        FROM (
          SELECT currency, SUM(amount) AS amount
          FROM pending_customer_movements
          WHERE COALESCE(source_user_id, created_by_user_id) = p_user_id
          GROUP BY currency
        ) s
      ), '[]'::jsonb),
      'stalePendingCount', COALESCE((SELECT stale_pending_count FROM pending_stats), 0),
      'stalePendingByCurrency', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount) ORDER BY amount DESC)
        FROM (
          SELECT currency, SUM(amount) AS amount
          FROM pending_customer_movements
          WHERE created_at <= now() - interval '24 hours'
          GROUP BY currency
        ) s
      ), '[]'::jsonb),
      'approvedLast7Days', COALESCE((SELECT approved_last_7_days FROM approval_performance), 0),
      'rejectedLast7Days', COALESCE((SELECT rejected_last_7_days FROM approval_performance), 0),
      'approvalRateLast7Days', CASE
        WHEN COALESCE((SELECT approved_last_7_days + rejected_last_7_days FROM approval_performance), 0) = 0 THEN 0
        ELSE ROUND(((SELECT approved_last_7_days FROM approval_performance)::numeric / NULLIF((SELECT approved_last_7_days + rejected_last_7_days FROM approval_performance), 0)) * 100, 1)
      END,
      'rejectionRateLast7Days', CASE
        WHEN COALESCE((SELECT approved_last_7_days + rejected_last_7_days FROM approval_performance), 0) = 0 THEN 0
        ELSE ROUND(((SELECT rejected_last_7_days FROM approval_performance)::numeric / NULLIF((SELECT approved_last_7_days + rejected_last_7_days FROM approval_performance), 0)) * 100, 1)
      END,
      'averageApprovalMinutesLast7Days', (SELECT ROUND(average_approval_minutes_last_7_days::numeric, 1) FROM approval_performance)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_app_period_statistics(uuid, date, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_app_statistics(uuid) TO anon, authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

SELECT 'entity_settlement_accounts_created' AS status;
