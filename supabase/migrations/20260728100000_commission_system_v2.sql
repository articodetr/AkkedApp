/*
  Commission System v2 — optional commission on customer movements
  ================================================================

  Accounting model (signed, single source of truth):
    - movement_type 'incoming' = له   (credit for the customer, balance +)
    - movement_type 'outgoing' = عليه (debit on the customer, balance -)
    - signed_base       = +base  for 'incoming', -base for 'outgoing'
    - signed_commission = +commission when commission_owner = 'account_owner'
                          -commission when commission_owner = 'current_user'
      (effect of the commission on the CUSTOMER account, seen from the
       ledger owner's side)
    - customer row: amount = |signed_base + signed_commission|,
      movement_type = direction of that sum.
    - Profit/Loss row: amount = commission,
      'incoming' (profit)  when commission_owner = 'current_user',
      'outgoing' (expense) when commission_owner = 'account_owner'.
    - Invariant: signed_customer + signed_profit_loss = signed_base.

  Storage design:
    - account_movements.amount ALWAYS stores the customer TOTAL, so every
      existing balance view, statistic, statement and running-balance
      computation stays correct without modification.
    - base_amount / commission_amount / commission_owner are display
      metadata (NULL on legacy rows → old behaviour unchanged).
    - Profit/Loss rows reuse the legacy markers is_commission_movement =
      true and related_commission_movement_id = <parent movement id>, so:
        * they are hidden from normal customer movement lists,
        * they are excluded from customer balances,
        * they appear inside the P&L account page and statements,
        * get_approval_related_movement_ids() collects them into the
          approval group automatically (pair approval / rejection works
          without touching approve_movement / reject_movement_with_reason).
    - operation_group_id groups all rows of one logical operation and is
      the idempotency key.

  Linked accounts: the existing AFTER INSERT mirror trigger creates the
  counterparty customer row (flipped direction, same total) and its
  notification; this RPC then stamps the commission metadata on the mirror
  and inserts the two P&L rows (one per user, opposite directions).

  This migration does NOT re-enable any legacy commission trigger. It also
  removes record_commission_for_profit_loss_trigger, a legacy trigger that
  20260430000000_fix_profit_loss_per_user_disable_commission.sql missed
  (it only dropped trigger_record_commission).
*/

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Safety: drop the leftover legacy commission trigger that the 20260430
--    "disable commission" migration did not remove.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS record_commission_for_profit_loss_trigger ON public.account_movements;
DROP FUNCTION IF EXISTS public.record_commission_for_profit_loss_smart();

-- ---------------------------------------------------------------------------
-- 2) New columns on account_movements (nullable → legacy rows untouched)
-- ---------------------------------------------------------------------------
ALTER TABLE public.account_movements
  ADD COLUMN IF NOT EXISTS base_amount numeric(15, 2),
  ADD COLUMN IF NOT EXISTS commission_amount numeric(15, 2),
  ADD COLUMN IF NOT EXISTS commission_owner text,
  ADD COLUMN IF NOT EXISTS operation_group_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'account_movements_commission_owner_check'
  ) THEN
    ALTER TABLE public.account_movements
      ADD CONSTRAINT account_movements_commission_owner_check
      CHECK (commission_owner IS NULL OR commission_owner IN ('account_owner', 'current_user'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'account_movements_commission_amount_positive'
  ) THEN
    ALTER TABLE public.account_movements
      ADD CONSTRAINT account_movements_commission_amount_positive
      CHECK (commission_amount IS NULL OR commission_amount > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'account_movements_commission_pair_check'
  ) THEN
    ALTER TABLE public.account_movements
      ADD CONSTRAINT account_movements_commission_pair_check
      CHECK ((commission_amount IS NULL) = (commission_owner IS NULL));
  END IF;
END $$;

COMMENT ON COLUMN public.account_movements.base_amount IS
  'المبلغ الأساسي قبل العمولة. NULL للحركات القديمة (يُعامل amount كما هو).';
COMMENT ON COLUMN public.account_movements.commission_amount IS
  'قيمة العمولة بنفس عملة الحركة. amount = المجموع النهائي على العميل دائماً.';
COMMENT ON COLUMN public.account_movements.commission_owner IS
  'صاحب العمولة من منظور صاحب هذا الدفتر: account_owner = العميل، current_user = صاحب الدفتر.';
COMMENT ON COLUMN public.account_movements.operation_group_id IS
  'معرّف موحد لكل صفوف العملية الواحدة (الحركة + المرآة + قيدا الأرباح والخسائر) ومفتاح منع التكرار.';

CREATE INDEX IF NOT EXISTS idx_account_movements_operation_group
  ON public.account_movements (operation_group_id)
  WHERE operation_group_id IS NOT NULL;

-- Duplicate protection: within one operation, each ledger account gets at
-- most one row (creator customer, mirror customer, creator P&L, counterparty
-- P&L are four distinct customer_ids).
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_movements_operation_customer
  ON public.account_movements (operation_group_id, customer_id)
  WHERE operation_group_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3) Keep P&L commission rows out of the creator-notification trigger.
--    The function body (20260503150000) stays untouched; the guard lives in
--    the trigger's WHEN clause.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_ensure_creator_pending_movement_notification ON public.account_movements;
CREATE TRIGGER trg_ensure_creator_pending_movement_notification
AFTER INSERT OR UPDATE OF approval_status, pending_approval, reject_reason
ON public.account_movements
FOR EACH ROW
WHEN (COALESCE(NEW.is_commission_movement, false) = false)
EXECUTE FUNCTION public.ensure_creator_pending_movement_notification();

-- ---------------------------------------------------------------------------
-- 4) Atomic RPC: create a customer movement with an optional commission.
--    Everything (customer row + mirror + both P&L rows + notifications)
--    happens inside one transaction; any failure rolls the whole thing back.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_movement_with_commission(
  p_user_name text,
  p_customer_id uuid,
  p_movement_type text,
  p_base_amount numeric,
  p_currency text,
  p_notes text,
  p_commission_amount numeric DEFAULT NULL,
  p_commission_owner text DEFAULT NULL,
  p_operation_id uuid DEFAULT NULL,
  p_sender_name text DEFAULT NULL,
  p_beneficiary_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_user_full_name text;
  v_customer record;
  v_notes text;
  v_existing record;
  v_operation_group_id uuid;
  v_base_signed numeric;
  v_commission_signed numeric;
  v_total_signed numeric;
  v_customer_type text;
  v_customer_total numeric;
  v_pl_type text;
  v_pl_mirror_type text;
  v_mirror_owner text;
  v_needs_approval boolean := false;
  v_approval_status text := 'approved';
  v_movement_id uuid;
  v_movement_number text;
  v_receipt_number text;
  v_mirror_id uuid;
  v_mirror_number text;
  v_mirror_customer_name text;
  v_pl_a_account uuid;
  v_pl_b_account uuid;
  v_pl_a_id uuid;
  v_pl_b_id uuid;
  v_pl_note_a text;
  v_pl_note_b text;
BEGIN
  SELECT u.id, COALESCE(NULLIF(trim(u.full_name), ''), u.user_name)
    INTO v_user_id, v_user_full_name
  FROM public.app_security u
  WHERE u.user_name = p_user_name
    AND COALESCE(u.is_active, true) = true
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not found: %', p_user_name;
  END IF;

  SELECT * INTO v_customer
  FROM public.customers
  WHERE customers.id = p_customer_id;

  IF v_customer.id IS NULL THEN
    RAISE EXCEPTION 'Customer not found: %', p_customer_id;
  END IF;

  IF v_customer.user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF p_movement_type NOT IN ('incoming', 'outgoing') THEN
    RAISE EXCEPTION 'نوع الحركة غير صالح';
  END IF;

  IF p_base_amount IS NULL OR p_base_amount <= 0 THEN
    RAISE EXCEPTION 'المبلغ الأساسي يجب أن يكون أكبر من صفر';
  END IF;

  v_notes := NULLIF(trim(COALESCE(p_notes, '')), '');
  IF v_notes IS NULL THEN
    RAISE EXCEPTION 'الملاحظة مطلوبة';
  END IF;

  IF (p_commission_amount IS NULL) <> (p_commission_owner IS NULL) THEN
    RAISE EXCEPTION 'يجب تحديد قيمة العمولة وصاحبها معاً';
  END IF;

  IF p_commission_amount IS NOT NULL THEN
    IF p_commission_amount <= 0 THEN
      RAISE EXCEPTION 'قيمة العمولة يجب أن تكون أكبر من صفر';
    END IF;
    IF p_commission_owner NOT IN ('account_owner', 'current_user') THEN
      RAISE EXCEPTION 'صاحب العمولة غير صالح';
    END IF;
    IF COALESCE(v_customer.is_profit_loss_account, false) THEN
      RAISE EXCEPTION 'لا يمكن إضافة عمولة على حساب الأرباح والخسائر';
    END IF;
  END IF;

  -- Idempotency: an operation id that already produced a movement returns
  -- the existing movement instead of inserting again (retry-safe).
  IF p_operation_id IS NOT NULL THEN
    SELECT am.id, am.movement_number, am.receipt_number, am.amount, am.movement_type,
           am.mirror_movement_id, am.pending_approval, am.approval_status,
           am.base_amount, am.commission_amount, am.commission_owner
      INTO v_existing
    FROM public.account_movements am
    WHERE am.operation_group_id = p_operation_id
      AND am.customer_id = p_customer_id
      AND COALESCE(am.is_commission_movement, false) = false
    LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'duplicate', true,
        'id', v_existing.id,
        'movement_number', v_existing.movement_number,
        'receipt_number', v_existing.receipt_number,
        'customer_id', p_customer_id,
        'movement_type', v_existing.movement_type,
        'amount', v_existing.amount,
        'base_amount', v_existing.base_amount,
        'commission_amount', v_existing.commission_amount,
        'commission_owner', v_existing.commission_owner,
        'currency', p_currency,
        'operation_group_id', p_operation_id,
        'mirror_movement_id', v_existing.mirror_movement_id,
        'pending_approval', v_existing.pending_approval,
        'approval_status', v_existing.approval_status
      );
    END IF;
  END IF;

  v_operation_group_id := COALESCE(p_operation_id, gen_random_uuid());

  v_base_signed := CASE WHEN p_movement_type = 'incoming' THEN p_base_amount ELSE -p_base_amount END;
  v_commission_signed := CASE
    WHEN p_commission_amount IS NULL THEN 0
    WHEN p_commission_owner = 'account_owner' THEN p_commission_amount
    ELSE -p_commission_amount
  END;
  v_total_signed := v_base_signed + v_commission_signed;

  IF p_commission_amount IS NOT NULL
     AND (v_total_signed = 0 OR sign(v_total_signed) <> sign(v_base_signed)) THEN
    RAISE EXCEPTION 'قيمة العمولة تلغي أو تعكس اتجاه الحركة الأساسية — راجع المبلغ أو صاحب العمولة';
  END IF;

  v_customer_type := CASE WHEN v_total_signed >= 0 THEN 'incoming' ELSE 'outgoing' END;
  v_customer_total := abs(v_total_signed);
  v_pl_type := CASE WHEN p_commission_owner = 'current_user' THEN 'incoming' ELSE 'outgoing' END;
  v_pl_mirror_type := CASE WHEN v_pl_type = 'incoming' THEN 'outgoing' ELSE 'incoming' END;
  v_mirror_owner := CASE WHEN p_commission_owner = 'account_owner' THEN 'current_user' ELSE 'account_owner' END;

  IF v_customer.linked_user_id IS NOT NULL THEN
    v_needs_approval := true;
    v_approval_status := 'pending';
  END IF;

  v_movement_number := public.generate_movement_number();

  INSERT INTO public.account_movements (
    movement_number,
    customer_id,
    movement_type,
    amount,
    currency,
    notes,
    sender_name,
    beneficiary_name,
    base_amount,
    commission_amount,
    commission_owner,
    operation_group_id,
    source_user_id,
    created_by_user_id,
    created_by_user_name,
    pending_approval,
    approval_status,
    is_voided
  ) VALUES (
    v_movement_number,
    p_customer_id,
    v_customer_type,
    v_customer_total,
    p_currency,
    v_notes,
    p_sender_name,
    p_beneficiary_name,
    p_base_amount,
    p_commission_amount,
    p_commission_owner,
    v_operation_group_id,
    v_user_id,
    v_user_id,
    v_user_full_name,
    v_needs_approval,
    v_approval_status,
    false
  )
  RETURNING account_movements.id INTO v_movement_id;

  -- The AFTER INSERT trigger has already created the mirror (if the customer
  -- is linked) and back-linked it; read the state it wrote.
  SELECT am.mirror_movement_id, am.receipt_number, am.movement_number
    INTO v_mirror_id, v_receipt_number, v_movement_number
  FROM public.account_movements am
  WHERE am.id = v_movement_id;

  IF v_mirror_id IS NOT NULL THEN
    -- The commission owner label flips on the counterparty's ledger.
    UPDATE public.account_movements
       SET base_amount = p_base_amount,
           commission_amount = p_commission_amount,
           commission_owner = CASE WHEN p_commission_amount IS NULL THEN NULL ELSE v_mirror_owner END,
           operation_group_id = v_operation_group_id
     WHERE id = v_mirror_id;

    SELECT am.movement_number, c.name
      INTO v_mirror_number, v_mirror_customer_name
    FROM public.account_movements am
    JOIN public.customers c ON c.id = am.customer_id
    WHERE am.id = v_mirror_id;
  END IF;

  IF p_commission_amount IS NOT NULL THEN
    v_pl_a_account := public.ensure_profit_loss_account_for_user(v_user_id);
    IF v_pl_a_account IS NULL THEN
      RAISE EXCEPTION 'تعذر تجهيز حساب الأرباح والخسائر';
    END IF;

    IF p_commission_owner = 'account_owner' THEN
      v_pl_note_a := 'عمولة مدفوعة لـ ' || COALESCE(v_customer.name, 'العميل')
        || ' — حركة رقم ' || COALESCE(v_movement_number, '')
        || ' (المبلغ الأساسي ' || p_base_amount::text || ' ' || p_currency || ')';
    ELSE
      v_pl_note_a := 'عمولة مستلمة من ' || COALESCE(v_customer.name, 'العميل')
        || ' — حركة رقم ' || COALESCE(v_movement_number, '')
        || ' (المبلغ الأساسي ' || p_base_amount::text || ' ' || p_currency || ')';
    END IF;

    INSERT INTO public.account_movements (
      movement_number,
      customer_id,
      movement_type,
      amount,
      currency,
      notes,
      is_commission_movement,
      related_commission_movement_id,
      base_amount,
      commission_amount,
      commission_owner,
      operation_group_id,
      source_user_id,
      created_by_user_id,
      created_by_user_name,
      pending_approval,
      approval_status,
      is_voided
    ) VALUES (
      public.generate_movement_number(),
      v_pl_a_account,
      v_pl_type,
      p_commission_amount,
      p_currency,
      v_pl_note_a,
      true,
      v_movement_id,
      p_base_amount,
      p_commission_amount,
      p_commission_owner,
      v_operation_group_id,
      v_user_id,
      v_user_id,
      v_user_full_name,
      v_needs_approval,
      v_approval_status,
      false
    )
    RETURNING account_movements.id INTO v_pl_a_id;

    IF v_mirror_id IS NOT NULL AND v_customer.linked_user_id IS NOT NULL THEN
      v_pl_b_account := public.ensure_profit_loss_account_for_user(v_customer.linked_user_id);
      IF v_pl_b_account IS NULL THEN
        RAISE EXCEPTION 'تعذر تجهيز حساب الأرباح والخسائر للطرف الآخر';
      END IF;

      IF p_commission_owner = 'account_owner' THEN
        -- The counterparty earns the commission.
        v_pl_note_b := 'عمولة مستلمة من ' || COALESCE(v_mirror_customer_name, v_user_full_name)
          || ' — حركة رقم ' || COALESCE(v_mirror_number, '')
          || ' (المبلغ الأساسي ' || p_base_amount::text || ' ' || p_currency || ')';
      ELSE
        v_pl_note_b := 'عمولة مدفوعة لـ ' || COALESCE(v_mirror_customer_name, v_user_full_name)
          || ' — حركة رقم ' || COALESCE(v_mirror_number, '')
          || ' (المبلغ الأساسي ' || p_base_amount::text || ' ' || p_currency || ')';
      END IF;

      INSERT INTO public.account_movements (
        movement_number,
        customer_id,
        movement_type,
        amount,
        currency,
        notes,
        is_commission_movement,
        related_commission_movement_id,
        mirror_movement_id,
        base_amount,
        commission_amount,
        commission_owner,
        operation_group_id,
        source_user_id,
        created_by_user_id,
        created_by_user_name,
        pending_approval,
        approval_status,
        is_voided
      ) VALUES (
        public.generate_movement_number(),
        v_pl_b_account,
        v_pl_mirror_type,
        p_commission_amount,
        p_currency,
        v_pl_note_b,
        true,
        v_mirror_id,
        v_pl_a_id,
        p_base_amount,
        p_commission_amount,
        v_mirror_owner,
        v_operation_group_id,
        v_user_id,
        v_user_id,
        v_user_full_name,
        v_needs_approval,
        v_approval_status,
        false
      )
      RETURNING account_movements.id INTO v_pl_b_id;

      UPDATE public.account_movements
         SET mirror_movement_id = v_pl_b_id
       WHERE id = v_pl_a_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'duplicate', false,
    'id', v_movement_id,
    'movement_number', v_movement_number,
    'receipt_number', v_receipt_number,
    'customer_id', p_customer_id,
    'movement_type', v_customer_type,
    'amount', v_customer_total,
    'base_amount', p_base_amount,
    'commission_amount', p_commission_amount,
    'commission_owner', p_commission_owner,
    'currency', p_currency,
    'operation_group_id', v_operation_group_id,
    'mirror_movement_id', v_mirror_id,
    'profit_loss_movement_id', v_pl_a_id,
    'profit_loss_mirror_movement_id', v_pl_b_id,
    'pending_approval', v_needs_approval,
    'approval_status', v_approval_status,
    'created_by_user_name', v_user_full_name,
    'created_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_movement_with_commission(
  text, uuid, text, numeric, text, text, numeric, text, uuid, text, text
) TO anon, authenticated;

COMMENT ON FUNCTION public.create_movement_with_commission IS
'إنشاء حركة عميل مع عمولة اختيارية بشكل ذري: حركة العميل + المرآة + قيدا الأرباح والخسائر في معاملة واحدة. amount يخزن دائماً إجمالي العميل.';

-- ---------------------------------------------------------------------------
-- 5) get_customer_movements_with_user: expose the new commission fields and
--    restore the creator/approval fields. Same filters as 20260430000100.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_customer_movements_with_user(
  p_user_name text,
  p_customer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM set_config('app.current_user', p_user_name, false);

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', am.id,
      'movement_number', am.movement_number,
      'customer_id', am.customer_id,
      'movement_type', am.movement_type,
      'amount', am.amount,
      'currency', am.currency,
      'notes', am.notes,
      'created_at', am.created_at,
      'sender_name', am.sender_name,
      'beneficiary_name', am.beneficiary_name,
      'commission', am.commission,
      'commission_currency', am.commission_currency,
      'commission_recipient_id', am.commission_recipient_id,
      'is_commission_movement', am.is_commission_movement,
      'base_amount', am.base_amount,
      'commission_amount', am.commission_amount,
      'commission_owner', am.commission_owner,
      'operation_group_id', am.operation_group_id,
      'receipt_number', am.receipt_number,
      'account_statement_number', am.account_statement_number,
      'transfer_number', am.transfer_number,
      'from_customer_id', am.from_customer_id,
      'to_customer_id', am.to_customer_id,
      'transfer_direction', am.transfer_direction,
      'related_transfer_id', am.related_transfer_id,
      'mirror_movement_id', am.mirror_movement_id,
      'source_user_id', am.source_user_id,
      'created_by_user_id', am.created_by_user_id,
      'created_by_user_name', am.created_by_user_name,
      'related_commission_movement_id', am.related_commission_movement_id,
      'pending_approval', COALESCE(am.pending_approval, false),
      'approval_status', COALESCE(am.approval_status, 'approved'),
      'approved_at', am.approved_at,
      'approved_by_user_id', am.approved_by_user_id,
      'reject_reason', am.reject_reason,
      'is_voided', COALESCE(am.is_voided, false),
      'is_internal_transfer', CASE
        WHEN am.from_customer_id IS NOT NULL OR am.to_customer_id IS NOT NULL THEN true
        ELSE false
      END,
      'customer', jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'linked_user_id', c.linked_user_id,
        'linked_user', CASE
          WHEN c.linked_user_id IS NOT NULL THEN
            jsonb_build_object(
              'id', lu.id,
              'user_name', lu.user_name,
              'full_name', lu.full_name,
              'account_number', lu.account_number
            )
          ELSE NULL
        END
      )
    )
    ORDER BY am.created_at DESC
  )
  INTO v_result
  FROM account_movements am
  LEFT JOIN customers c ON am.customer_id = c.id
  LEFT JOIN app_security lu ON c.linked_user_id = lu.id
  WHERE am.customer_id = p_customer_id
    AND COALESCE(am.is_voided, false) = false;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION get_customer_movements_with_user(text, uuid) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6) Commission P&L summary for the statistics screen (new-system rows live
--    on P&L accounts, which get_app_statistics excludes by design).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_commission_pl_summary(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'currency', s.currency,
        'income', s.income,
        'expense', s.expense,
        'net', s.net
      )
      ORDER BY s.currency
    ),
    '[]'::jsonb
  )
  FROM (
    SELECT
      am.currency,
      COALESCE(SUM(am.amount) FILTER (WHERE am.movement_type = 'incoming'), 0) AS income,
      COALESCE(SUM(am.amount) FILTER (WHERE am.movement_type = 'outgoing'), 0) AS expense,
      COALESCE(SUM(CASE WHEN am.movement_type = 'incoming' THEN am.amount ELSE -am.amount END), 0) AS net
    FROM public.account_movements am
    JOIN public.customers c ON c.id = am.customer_id
    WHERE c.user_id = p_user_id
      AND COALESCE(c.is_profit_loss_account, false) = true
      AND COALESCE(am.is_commission_movement, false) = true
      AND COALESCE(am.is_voided, false) = false
      AND public.get_movement_approval_status(am.approval_status, am.pending_approval) = 'approved'
      AND am.currency IS NOT NULL
    GROUP BY am.currency
  ) s;
$$;

GRANT EXECUTE ON FUNCTION public.get_commission_pl_summary(uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.get_commission_pl_summary(uuid) IS
'ملخص عمولات حساب الأرباح والخسائر الخاص بالمستخدم لكل عملة (دخل/مصروف/صافي) — الحركات المعتمدة فقط.';

-- ---------------------------------------------------------------------------
-- 7) customer_balances_by_currency: identical to 20260430000100 except that
--    commission rows now count INSIDE profit/loss accounts (they ARE the P&L
--    balance) while remaining excluded from normal customer balances.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS customer_balances_by_currency;

CREATE VIEW customer_balances_by_currency AS
SELECT
  c.id AS customer_id,
  c.name AS customer_name,
  c.user_id,
  c.linked_user_id,
  am.currency,
  COALESCE(
    SUM(
      CASE
        WHEN am.movement_type = 'incoming' THEN am.amount
        ELSE 0
      END
    ),
    0
  ) AS total_incoming,
  COALESCE(
    SUM(
      CASE
        WHEN am.movement_type = 'outgoing' THEN am.amount
        ELSE 0
      END
    ),
    0
  ) AS total_outgoing,
  COALESCE(
    SUM(
      CASE
        WHEN am.movement_type = 'incoming' THEN am.amount
        WHEN am.movement_type = 'outgoing' THEN -am.amount
        ELSE 0
      END
    ),
    0
  ) AS balance,
  MAX(am.created_at) AS last_movement_date,
  COUNT(am.id) AS movement_count
FROM customers c
LEFT JOIN account_movements am
  ON c.id = am.customer_id
  AND COALESCE(am.is_voided, false) = false
  AND COALESCE(am.pending_approval, false) = false
  AND COALESCE(am.approval_status, 'approved') = 'approved'
  AND (
    COALESCE(am.is_commission_movement, false) = false
    OR COALESCE(c.is_profit_loss_account, false) = true
  )
GROUP BY c.id, c.name, c.user_id, c.linked_user_id, am.currency
HAVING am.currency IS NOT NULL
  AND (
    COALESCE(
      SUM(
        CASE
          WHEN am.movement_type = 'incoming' THEN am.amount
          WHEN am.movement_type = 'outgoing' THEN -am.amount
          ELSE 0
        END
      ),
      0
    ) <> 0
    OR EXISTS (
      SELECT 1
      FROM customers c2
      WHERE c2.id = c.id
        AND COALESCE(c2.is_profit_loss_account, false) = true
    )
  );

GRANT SELECT ON customer_balances_by_currency TO authenticated, anon;

COMMENT ON VIEW customer_balances_by_currency IS
  'Customer balances by currency — approved, non-voided movements; commission rows count only inside profit/loss accounts';

COMMIT;

NOTIFY pgrst, 'reload schema';

SELECT 'commission_system_v2_applied' AS status;
