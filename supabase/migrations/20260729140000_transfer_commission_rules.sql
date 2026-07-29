/*
  قواعد عمولة حوالات الجهات والشبكات
  ==================================

  - القاعدة تخص المستخدم + نوع الحوالة + العملة + نطاق مبلغ.
  - يمنع تداخل قاعدتين مفعّلتين حتى تكون المطابقة التلقائية حتمية.
  - تحفظ الحوالة نسخة كاملة من القاعدة والمبالغ المحسوبة والنهائية.
  - الحساب الدائن هو حساب الشبكة دائماً، سواء كانت الحوالة إرسالاً أو استلاماً.
  - صافي عمولة المستخدم فقط يسجل في حساب الأرباح والخسائر الخاص به.
*/

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) قواعد العمولة
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transfer_commission_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.app_security(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('send', 'receive')),
  currency text NOT NULL,
  min_amount numeric(15, 2) NOT NULL DEFAULT 0 CHECK (min_amount >= 0),
  max_amount numeric(15, 2),
  calculation_type text NOT NULL
    CHECK (calculation_type IN ('fixed', 'percentage', 'per_thousand', 'per_million')),
  customer_value numeric(18, 6) NOT NULL DEFAULT 0 CHECK (customer_value >= 0),
  network_value numeric(18, 6) NOT NULL DEFAULT 0 CHECK (network_value >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT transfer_commission_rules_currency_not_blank
    CHECK (length(trim(currency)) > 0),
  CONSTRAINT transfer_commission_rules_amount_range
    CHECK (max_amount IS NULL OR max_amount >= min_amount)
);

COMMENT ON TABLE public.transfer_commission_rules IS
  'قواعد عمولة حوالات الإرسال والاستلام الخاصة بكل مستخدم.';
COMMENT ON COLUMN public.transfer_commission_rules.max_amount IS
  'الحد الأعلى شامل. NULL يعني لا يوجد حد أعلى.';
COMMENT ON COLUMN public.transfer_commission_rules.customer_value IS
  'قيمة حساب عمولة العميل حسب calculation_type.';
COMMENT ON COLUMN public.transfer_commission_rules.network_value IS
  'قيمة حساب عمولة الشبكة حسب calculation_type.';

CREATE INDEX IF NOT EXISTS idx_transfer_commission_rules_match
  ON public.transfer_commission_rules (
    user_id,
    direction,
    currency,
    is_active,
    min_amount
  );

CREATE OR REPLACE FUNCTION public.prepare_transfer_commission_rule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.currency := upper(trim(NEW.currency));
  NEW.updated_at := now();

  -- يمنع طلبان متزامنان من تجاوز فحص التداخل لنفس مجموعة القواعد.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'transfer-commission-rule:' ||
      NEW.user_id::text || ':' || NEW.direction || ':' || NEW.currency,
      0
    )
  );

  IF NEW.is_active AND EXISTS (
    SELECT 1
    FROM public.transfer_commission_rules r
    WHERE r.user_id = NEW.user_id
      AND r.direction = NEW.direction
      AND r.currency = NEW.currency
      AND r.is_active = true
      AND r.id <> NEW.id
      -- النهايتان شاملتان؛ مشاركة حد واحد تعد تداخلاً.
      AND (r.max_amount IS NULL OR r.max_amount >= NEW.min_amount)
      AND (NEW.max_amount IS NULL OR NEW.max_amount >= r.min_amount)
  ) THEN
    RAISE EXCEPTION
      'يوجد تداخل مع قاعدة عمولة مفعّلة لنفس الاتجاه والعملة';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prepare_transfer_commission_rule
  ON public.transfer_commission_rules;
CREATE TRIGGER trg_prepare_transfer_commission_rule
  BEFORE INSERT OR UPDATE ON public.transfer_commission_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.prepare_transfer_commission_rule();

ALTER TABLE public.transfer_commission_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read access to transfer commission rules"
  ON public.transfer_commission_rules;
CREATE POLICY "Allow read access to transfer commission rules"
  ON public.transfer_commission_rules FOR SELECT
  TO authenticated, anon
  USING (true);

DROP POLICY IF EXISTS "Allow insert access to transfer commission rules"
  ON public.transfer_commission_rules;
CREATE POLICY "Allow insert access to transfer commission rules"
  ON public.transfer_commission_rules FOR INSERT
  TO authenticated, anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update access to transfer commission rules"
  ON public.transfer_commission_rules;
CREATE POLICY "Allow update access to transfer commission rules"
  ON public.transfer_commission_rules FOR UPDATE
  TO authenticated, anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow delete access to transfer commission rules"
  ON public.transfer_commission_rules;
CREATE POLICY "Allow delete access to transfer commission rules"
  ON public.transfer_commission_rules FOR DELETE
  TO authenticated, anon
  USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.transfer_commission_rules TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) حاسبة موحدة ومطابقة القاعدة
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_transfer_commission_amount(
  p_amount numeric,
  p_value numeric,
  p_calculation_type text
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public
AS $$
BEGIN
  IF p_amount < 0 OR p_value < 0 THEN
    RAISE EXCEPTION 'المبلغ وقيمة العمولة لا يمكن أن يكونا سالبين';
  END IF;

  RETURN round(
    CASE p_calculation_type
      WHEN 'fixed' THEN p_value
      WHEN 'percentage' THEN p_amount * p_value / 100
      WHEN 'per_thousand' THEN p_amount * p_value / 1000
      WHEN 'per_million' THEN p_amount * p_value / 1000000
      ELSE NULL
    END,
    2
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_matching_transfer_commission_rule(
  p_user_id uuid,
  p_direction text,
  p_currency text,
  p_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule public.transfer_commission_rules%ROWTYPE;
  v_currency text;
  v_amount numeric(15, 2);
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'معرّف المستخدم مطلوب';
  END IF;

  IF p_direction NOT IN ('send', 'receive') THEN
    RAISE EXCEPTION 'نوع الحوالة غير صالح';
  END IF;

  v_amount := round(COALESCE(p_amount, 0), 2);
  IF v_amount <= 0 THEN
    RETURN jsonb_build_object('matched', false);
  END IF;

  v_currency := upper(NULLIF(trim(COALESCE(p_currency, '')), ''));
  IF v_currency IS NULL THEN
    RAISE EXCEPTION 'العملة مطلوبة';
  END IF;

  SELECT r.*
    INTO v_rule
  FROM public.transfer_commission_rules r
  WHERE r.user_id = p_user_id
    AND r.direction = p_direction
    AND r.currency = v_currency
    AND r.is_active = true
    AND r.min_amount <= v_amount
    AND (r.max_amount IS NULL OR r.max_amount >= v_amount)
  ORDER BY r.min_amount DESC, r.created_at ASC
  LIMIT 1;

  IF v_rule.id IS NULL THEN
    RETURN jsonb_build_object('matched', false);
  END IF;

  RETURN jsonb_build_object(
    'matched', true,
    'rule_id', v_rule.id,
    'direction', v_rule.direction,
    'currency', v_rule.currency,
    'min_amount', v_rule.min_amount,
    'max_amount', v_rule.max_amount,
    'calculation_type', v_rule.calculation_type,
    'customer_value', v_rule.customer_value,
    'network_value', v_rule.network_value,
    'calculated_customer_commission',
      public.calculate_transfer_commission_amount(
        v_amount,
        v_rule.customer_value,
        v_rule.calculation_type
      ),
    'calculated_network_commission',
      public.calculate_transfer_commission_amount(
        v_amount,
        v_rule.network_value,
        v_rule.calculation_type
      )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_matching_transfer_commission_rule(
  uuid, text, text, numeric
) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) Snapshot العمولة على الحوالة
-- ---------------------------------------------------------------------------
ALTER TABLE public.entity_transfers
  ADD COLUMN IF NOT EXISTS commission_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS commission_source text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS commission_rule_id uuid
    REFERENCES public.transfer_commission_rules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS commission_rule_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS calculated_customer_commission numeric(15, 2)
    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS calculated_network_commission numeric(15, 2)
    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS customer_commission numeric(15, 2)
    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS network_commission numeric(15, 2)
    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_overridden boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS profit_loss_movement_id uuid
    REFERENCES public.account_movements(id) ON DELETE SET NULL;

ALTER TABLE public.entity_transfers
  ADD COLUMN IF NOT EXISTS debit_total numeric(16, 2)
    GENERATED ALWAYS AS (amount + customer_commission) STORED,
  ADD COLUMN IF NOT EXISTS network_total numeric(16, 2)
    GENERATED ALWAYS AS (amount + network_commission) STORED,
  ADD COLUMN IF NOT EXISTS net_profit numeric(15, 2)
    GENERATED ALWAYS AS (customer_commission - network_commission) STORED;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'entity_transfers_commission_source_check'
  ) THEN
    ALTER TABLE public.entity_transfers
      ADD CONSTRAINT entity_transfers_commission_source_check
      CHECK (commission_source IN ('none', 'rule', 'manual'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'entity_transfers_commission_amounts_nonnegative'
  ) THEN
    ALTER TABLE public.entity_transfers
      ADD CONSTRAINT entity_transfers_commission_amounts_nonnegative
      CHECK (
        calculated_customer_commission >= 0
        AND calculated_network_commission >= 0
        AND customer_commission >= 0
        AND network_commission >= 0
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'entity_transfers_commission_state_consistent'
  ) THEN
    ALTER TABLE public.entity_transfers
      ADD CONSTRAINT entity_transfers_commission_state_consistent
      CHECK (
        (
          commission_enabled = false
          AND commission_source = 'none'
          AND commission_rule_id IS NULL
          AND calculated_customer_commission = 0
          AND calculated_network_commission = 0
          AND customer_commission = 0
          AND network_commission = 0
          AND commission_overridden = false
        )
        OR
        (
          commission_enabled = true
          AND commission_source IN ('rule', 'manual')
          AND (
            commission_source <> 'rule'
            OR commission_rule_snapshot IS NOT NULL
          )
        )
      );
  END IF;
END $$;

COMMENT ON COLUMN public.entity_transfers.commission_rule_snapshot IS
  'نسخة القاعدة عند تنفيذ الحوالة حتى لا تتغير السجلات القديمة بعد تعديل الإعدادات.';
COMMENT ON COLUMN public.entity_transfers.customer_commission IS
  'عمولة العميل النهائية بعد أي تعديل يدوي.';
COMMENT ON COLUMN public.entity_transfers.network_commission IS
  'عمولة الشبكة النهائية بعد أي تعديل يدوي.';
COMMENT ON COLUMN public.entity_transfers.net_profit IS
  'صافي ربح موجب أو خسارة سالبة = عمولة العميل - عمولة الشبكة.';

-- ---------------------------------------------------------------------------
-- 4) حماية إنشاء حساب الأرباح والخسائر من سباق أول عمليتين للمستخدم.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_profit_loss_account_for_user(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_phone text;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('profit-loss-account:' || p_user_id::text, 0)
  );

  SELECT c.id
    INTO v_id
  FROM public.customers c
  WHERE c.user_id = p_user_id
    AND COALESCE(c.is_profit_loss_account, false) = true
  ORDER BY c.created_at NULLS FIRST, c.id
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  v_phone := 'PROFIT_LOSS_' || replace(p_user_id::text, '-', '_');

  INSERT INTO public.customers (
    name,
    phone,
    user_id,
    is_profit_loss_account,
    notes,
    created_at,
    updated_at
  ) VALUES (
    'الأرباح والخسائر',
    v_phone,
    p_user_id,
    true,
    'حساب نظام ثابت وخاص بهذا المستخدم',
    now(),
    now()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_profit_loss_account_for_user(uuid)
  TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) إنشاء الحوالة مع عمولة اختيارية وقيد محاسبي متوازن.
--    إسقاط التوقيع القديم يمنع التباس overload في PostgREST، بينما القيم
--    الافتراضية للوسائط الجديدة تبقي العملاء القدامى متوافقين.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_entity_transfer(
  uuid, uuid, uuid, text, text, text, text, text, numeric, text, uuid, uuid, text
);

CREATE FUNCTION public.create_entity_transfer(
  p_operation_id uuid,
  p_user_id uuid,
  p_entity_id uuid,
  p_direction text,
  p_sender_name text,
  p_sender_phone text,
  p_beneficiary_name text,
  p_beneficiary_phone text,
  p_amount numeric,
  p_currency text,
  p_debit_customer_id uuid,
  p_credit_customer_id uuid,
  p_notes text DEFAULT NULL,
  p_commission_enabled boolean DEFAULT false,
  p_commission_rule_id uuid DEFAULT NULL,
  p_customer_commission numeric DEFAULT NULL,
  p_network_commission numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.entity_transfers%ROWTYPE;
  v_rule public.transfer_commission_rules%ROWTYPE;
  v_debit_customer_id uuid;
  v_credit_customer_id uuid;
  v_user_display_name text;
  v_transfer_id uuid;
  v_transfer_number text;
  v_debit_movement_id uuid;
  v_credit_movement_id uuid;
  v_profit_loss_movement_id uuid;
  v_profit_loss_customer_id uuid;
  v_clean_currency text;
  v_base_amount numeric(15, 2);
  v_clean_notes text;
  v_movement_notes text;
  v_profit_loss_notes text;
  v_commission_source text := 'none';
  v_rule_snapshot jsonb;
  v_calculated_customer numeric(15, 2) := 0;
  v_calculated_network numeric(15, 2) := 0;
  v_customer_commission numeric(15, 2) := 0;
  v_network_commission numeric(15, 2) := 0;
  v_debit_total numeric(16, 2);
  v_network_total numeric(16, 2);
  v_net_profit numeric(15, 2);
  v_commission_overridden boolean := false;
BEGIN
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'معرّف العملية مطلوب';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'معرّف المستخدم مطلوب';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text || ':' || p_operation_id::text, 0)
  );

  SELECT *
    INTO v_existing
  FROM public.entity_transfers
  WHERE user_id = p_user_id
    AND operation_id = p_operation_id
  LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    RETURN to_jsonb(v_existing) || jsonb_build_object('duplicate', true);
  END IF;

  SELECT COALESCE(NULLIF(trim(full_name), ''), user_name)
    INTO v_user_display_name
  FROM public.app_security
  WHERE id = p_user_id
    AND COALESCE(is_active, true) = true;

  IF v_user_display_name IS NULL THEN
    RAISE EXCEPTION 'المستخدم غير موجود أو غير نشط';
  END IF;

  IF p_direction NOT IN ('send', 'receive') THEN
    RAISE EXCEPTION 'نوع الحوالة غير صالح';
  END IF;

  v_base_amount := round(COALESCE(p_amount, 0), 2);
  IF v_base_amount <= 0 THEN
    RAISE EXCEPTION 'المبلغ يجب أن يكون أكبر من صفر';
  END IF;

  IF p_debit_customer_id IS NULL OR p_credit_customer_id IS NULL THEN
    RAISE EXCEPTION 'يجب تحديد الحساب المدين وحساب الشبكة الدائن';
  END IF;

  IF p_debit_customer_id = p_credit_customer_id THEN
    RAISE EXCEPTION 'لا يمكن اختيار الحساب نفسه كمدين ودائن';
  END IF;

  IF NULLIF(trim(COALESCE(p_sender_name, '')), '') IS NULL
     OR NULLIF(trim(COALESCE(p_sender_phone, '')), '') IS NULL
     OR NULLIF(trim(COALESCE(p_beneficiary_name, '')), '') IS NULL
     OR NULLIF(trim(COALESCE(p_beneficiary_phone, '')), '') IS NULL THEN
    RAISE EXCEPTION 'بيانات المرسل والمستلم مطلوبة';
  END IF;

  v_clean_currency := upper(NULLIF(trim(COALESCE(p_currency, '')), ''));
  IF v_clean_currency IS NULL THEN
    RAISE EXCEPTION 'العملة مطلوبة';
  END IF;

  IF p_entity_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.transfer_entities e
       WHERE e.id = p_entity_id
         AND e.user_id = p_user_id
         AND e.is_active = true
     ) THEN
    RAISE EXCEPTION 'الجهة أو الشبكة غير موجودة أو متوقفة';
  END IF;

  SELECT id
    INTO v_debit_customer_id
  FROM public.customers
  WHERE id = p_debit_customer_id
    AND user_id = p_user_id
    AND linked_user_id IS NULL
    AND COALESCE(is_profit_loss_account, false) = false
    AND COALESCE(is_entity_settlement_account, false) = false;

  IF v_debit_customer_id IS NULL THEN
    RAISE EXCEPTION 'الحساب المدين غير صالح أو ليس من الحسابات غير المرتبطة';
  END IF;

  SELECT id
    INTO v_credit_customer_id
  FROM public.customers
  WHERE id = p_credit_customer_id
    AND user_id = p_user_id
    AND linked_user_id IS NULL
    AND COALESCE(is_profit_loss_account, false) = false
    AND COALESCE(is_entity_settlement_account, false) = false;

  IF v_credit_customer_id IS NULL THEN
    RAISE EXCEPTION 'حساب الشبكة الدائن غير صالح أو ليس من الحسابات غير المرتبطة';
  END IF;

  IF COALESCE(p_commission_enabled, false) THEN
    IF p_commission_rule_id IS NOT NULL THEN
      SELECT r.*
        INTO v_rule
      FROM public.transfer_commission_rules r
      WHERE r.id = p_commission_rule_id
        AND r.user_id = p_user_id
        AND r.direction = p_direction
        AND r.currency = v_clean_currency
        AND r.is_active = true
        AND r.min_amount <= v_base_amount
        AND (r.max_amount IS NULL OR r.max_amount >= v_base_amount);

      IF v_rule.id IS NULL THEN
        RAISE EXCEPTION 'قاعدة العمولة لم تعد مطابقة؛ حدّث الحوالة وحاول مرة أخرى';
      END IF;

      v_commission_source := 'rule';
      v_calculated_customer := public.calculate_transfer_commission_amount(
        v_base_amount,
        v_rule.customer_value,
        v_rule.calculation_type
      );
      v_calculated_network := public.calculate_transfer_commission_amount(
        v_base_amount,
        v_rule.network_value,
        v_rule.calculation_type
      );
      v_rule_snapshot := jsonb_build_object(
        'id', v_rule.id,
        'direction', v_rule.direction,
        'currency', v_rule.currency,
        'min_amount', v_rule.min_amount,
        'max_amount', v_rule.max_amount,
        'calculation_type', v_rule.calculation_type,
        'customer_value', v_rule.customer_value,
        'network_value', v_rule.network_value,
        'rounding_scale', 2
      );
    ELSE
      v_commission_source := 'manual';
    END IF;

    IF p_customer_commission IS NULL AND p_commission_rule_id IS NULL THEN
      RAISE EXCEPTION 'أدخل عمولة العميل أو اختر قاعدة عمولة مطابقة';
    END IF;

    IF p_network_commission IS NULL AND p_commission_rule_id IS NULL THEN
      RAISE EXCEPTION 'أدخل عمولة الشبكة أو اختر قاعدة عمولة مطابقة';
    END IF;

    IF COALESCE(p_customer_commission, v_calculated_customer) < 0
       OR COALESCE(p_network_commission, v_calculated_network) < 0 THEN
      RAISE EXCEPTION 'قيم العمولة لا يمكن أن تكون سالبة';
    END IF;

    v_customer_commission := round(
      COALESCE(p_customer_commission, v_calculated_customer),
      2
    );
    v_network_commission := round(
      COALESCE(p_network_commission, v_calculated_network),
      2
    );
    v_commission_overridden :=
      v_commission_source = 'rule'
      AND (
        v_customer_commission <> v_calculated_customer
        OR v_network_commission <> v_calculated_network
      );
  END IF;

  v_debit_total := round(v_base_amount + v_customer_commission, 2);
  v_network_total := round(v_base_amount + v_network_commission, 2);
  v_net_profit := round(v_customer_commission - v_network_commission, 2);

  v_clean_notes := NULLIF(trim(COALESCE(p_notes, '')), '');
  v_transfer_id := gen_random_uuid();
  v_transfer_number :=
    'TRF-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' ||
    upper(substr(replace(v_transfer_id::text, '-', ''), 1, 12));
  v_movement_notes :=
    CASE WHEN p_direction = 'send' THEN 'حوالة إرسال' ELSE 'حوالة استلام' END ||
    ': ' || trim(p_sender_name) || ' ← ' || trim(p_beneficiary_name) ||
    CASE
      WHEN COALESCE(p_commission_enabled, false)
      THEN ' — عمولة العميل ' || v_customer_commission::text ||
           '، عمولة الشبكة ' || v_network_commission::text
      ELSE ''
    END ||
    CASE WHEN v_clean_notes IS NULL THEN '' ELSE ' — ' || v_clean_notes END;

  INSERT INTO public.entity_transfers (
    id,
    operation_id,
    transfer_number,
    user_id,
    entity_id,
    direction,
    sender_name,
    sender_phone,
    beneficiary_name,
    beneficiary_phone,
    amount,
    currency,
    debit_customer_id,
    credit_customer_id,
    notes,
    commission_enabled,
    commission_source,
    commission_rule_id,
    commission_rule_snapshot,
    calculated_customer_commission,
    calculated_network_commission,
    customer_commission,
    network_commission,
    commission_overridden
  ) VALUES (
    v_transfer_id,
    p_operation_id,
    v_transfer_number,
    p_user_id,
    p_entity_id,
    p_direction,
    trim(p_sender_name),
    trim(p_sender_phone),
    trim(p_beneficiary_name),
    trim(p_beneficiary_phone),
    v_base_amount,
    v_clean_currency,
    p_debit_customer_id,
    p_credit_customer_id,
    v_clean_notes,
    COALESCE(p_commission_enabled, false),
    v_commission_source,
    CASE WHEN v_commission_source = 'rule' THEN v_rule.id ELSE NULL END,
    v_rule_snapshot,
    v_calculated_customer,
    v_calculated_network,
    v_customer_commission,
    v_network_commission,
    v_commission_overridden
  );

  INSERT INTO public.account_movements (
    movement_number,
    customer_id,
    movement_type,
    amount,
    currency,
    notes,
    sender_name,
    beneficiary_name,
    transfer_number,
    from_customer_id,
    to_customer_id,
    transfer_direction,
    base_amount,
    operation_group_id,
    source_user_id,
    created_by_user_id,
    created_by_user_name,
    pending_approval,
    approval_status,
    approved_by_user_id,
    approved_at,
    is_voided
  ) VALUES (
    public.generate_movement_number(),
    p_debit_customer_id,
    'outgoing',
    v_debit_total,
    v_clean_currency,
    v_movement_notes,
    trim(p_sender_name),
    trim(p_beneficiary_name),
    v_transfer_number,
    p_debit_customer_id,
    p_credit_customer_id,
    'customer_to_customer',
    v_base_amount,
    p_operation_id,
    p_user_id,
    p_user_id,
    v_user_display_name,
    false,
    'approved',
    p_user_id,
    now(),
    false
  )
  RETURNING id INTO v_debit_movement_id;

  INSERT INTO public.account_movements (
    movement_number,
    customer_id,
    movement_type,
    amount,
    currency,
    notes,
    sender_name,
    beneficiary_name,
    transfer_number,
    from_customer_id,
    to_customer_id,
    transfer_direction,
    related_transfer_id,
    mirror_movement_id,
    base_amount,
    operation_group_id,
    source_user_id,
    created_by_user_id,
    created_by_user_name,
    pending_approval,
    approval_status,
    approved_by_user_id,
    approved_at,
    is_voided
  ) VALUES (
    public.generate_movement_number(),
    p_credit_customer_id,
    'incoming',
    v_network_total,
    v_clean_currency,
    v_movement_notes,
    trim(p_sender_name),
    trim(p_beneficiary_name),
    v_transfer_number,
    p_debit_customer_id,
    p_credit_customer_id,
    'customer_to_customer',
    v_debit_movement_id,
    v_debit_movement_id,
    v_base_amount,
    p_operation_id,
    p_user_id,
    p_user_id,
    v_user_display_name,
    false,
    'approved',
    p_user_id,
    now(),
    false
  )
  RETURNING id INTO v_credit_movement_id;

  UPDATE public.account_movements
     SET related_transfer_id = v_credit_movement_id,
         mirror_movement_id = v_credit_movement_id
   WHERE id = v_debit_movement_id;

  IF v_net_profit <> 0 THEN
    v_profit_loss_customer_id :=
      public.ensure_profit_loss_account_for_user(p_user_id);

    IF v_profit_loss_customer_id IS NULL THEN
      RAISE EXCEPTION 'تعذر تجهيز حساب الأرباح والخسائر';
    END IF;

    v_profit_loss_notes :=
      CASE
        WHEN v_net_profit > 0 THEN 'صافي ربح عمولة حوالة '
        ELSE 'صافي خسارة عمولة حوالة '
      END ||
      v_transfer_number ||
      ' — عمولة العميل ' || v_customer_commission::text ||
      '، عمولة الشبكة ' || v_network_commission::text;

    INSERT INTO public.account_movements (
      movement_number,
      customer_id,
      movement_type,
      amount,
      currency,
      notes,
      transfer_number,
      is_commission_movement,
      related_commission_movement_id,
      base_amount,
      operation_group_id,
      source_user_id,
      created_by_user_id,
      created_by_user_name,
      pending_approval,
      approval_status,
      approved_by_user_id,
      approved_at,
      is_voided
    ) VALUES (
      public.generate_movement_number(),
      v_profit_loss_customer_id,
      CASE WHEN v_net_profit > 0 THEN 'incoming' ELSE 'outgoing' END,
      abs(v_net_profit),
      v_clean_currency,
      v_profit_loss_notes,
      v_transfer_number || '-P',
      true,
      v_debit_movement_id,
      v_base_amount,
      p_operation_id,
      p_user_id,
      p_user_id,
      v_user_display_name,
      false,
      'approved',
      p_user_id,
      now(),
      false
    )
    RETURNING id INTO v_profit_loss_movement_id;
  END IF;

  UPDATE public.entity_transfers
     SET debit_movement_id = v_debit_movement_id,
         credit_movement_id = v_credit_movement_id,
         profit_loss_movement_id = v_profit_loss_movement_id
   WHERE id = v_transfer_id;

  SELECT *
    INTO v_existing
  FROM public.entity_transfers
  WHERE id = v_transfer_id;

  RETURN to_jsonb(v_existing) || jsonb_build_object('duplicate', false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_entity_transfer(
  uuid, uuid, uuid, text, text, text, text, text, numeric, text, uuid, uuid,
  text, boolean, uuid, numeric, numeric
) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

SELECT 'transfer_commission_rules_ready' AS status;
