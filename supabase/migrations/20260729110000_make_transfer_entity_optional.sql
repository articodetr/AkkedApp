/*
  الحوالات لا تتطلب اختيار جهة أو شبكة.

  نحافظ على entity_id للسجلات القديمة والتوافق المستقبلي، لكنه يصبح
  اختيارياً. الدالة تبقي التحقق من الجهة فقط إذا مرر عميل قديم قيمة لها.
*/

BEGIN;

ALTER TABLE public.entity_transfers
  ALTER COLUMN entity_id DROP NOT NULL;

COMMENT ON COLUMN public.entity_transfers.entity_id IS
  'جهة/شبكة اختيارية للسجلات القديمة أو للاستخدام المستقبلي؛ الحوالة لا تتطلبها.';

CREATE OR REPLACE FUNCTION public.create_entity_transfer(
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
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.entity_transfers%ROWTYPE;
  v_debit_customer_id uuid;
  v_credit_customer_id uuid;
  v_user_display_name text;
  v_transfer_id uuid;
  v_transfer_number text;
  v_debit_movement_id uuid;
  v_credit_movement_id uuid;
  v_debit_movement_number text;
  v_credit_movement_number text;
  v_clean_currency text;
  v_clean_notes text;
  v_movement_notes text;
BEGIN
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'معرّف العملية مطلوب';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'معرّف المستخدم مطلوب';
  END IF;

  -- يمنع طلبين متزامنين لنفس المفتاح من تجاوز فحص منع التكرار.
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

  IF COALESCE(p_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'المبلغ يجب أن يكون أكبر من صفر';
  END IF;

  IF p_debit_customer_id IS NULL OR p_credit_customer_id IS NULL THEN
    RAISE EXCEPTION 'يجب تحديد الحساب المدين والحساب الدائن';
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
    RAISE EXCEPTION 'الحساب الدائن غير صالح أو ليس من الحسابات غير المرتبطة';
  END IF;

  v_clean_notes := NULLIF(trim(COALESCE(p_notes, '')), '');
  v_transfer_id := gen_random_uuid();
  v_transfer_number :=
    'TRF-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' ||
    upper(substr(replace(v_transfer_id::text, '-', ''), 1, 12));
  v_movement_notes :=
    CASE WHEN p_direction = 'send' THEN 'حوالة إرسال' ELSE 'حوالة استلام' END ||
    ': ' || trim(p_sender_name) || ' ← ' || trim(p_beneficiary_name) ||
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
    notes
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
    p_amount,
    v_clean_currency,
    p_debit_customer_id,
    p_credit_customer_id,
    v_clean_notes
  );

  v_debit_movement_number := public.generate_movement_number();
  v_credit_movement_number := public.generate_movement_number();

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
    v_debit_movement_number,
    p_debit_customer_id,
    'outgoing',
    p_amount,
    v_clean_currency,
    v_movement_notes,
    trim(p_sender_name),
    trim(p_beneficiary_name),
    v_transfer_number,
    p_debit_customer_id,
    p_credit_customer_id,
    'customer_to_customer',
    p_amount,
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
    v_credit_movement_number,
    p_credit_customer_id,
    'incoming',
    p_amount,
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
    p_amount,
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

  UPDATE public.entity_transfers
     SET debit_movement_id = v_debit_movement_id,
         credit_movement_id = v_credit_movement_id
   WHERE id = v_transfer_id;

  RETURN jsonb_build_object(
    'id', v_transfer_id,
    'operation_id', p_operation_id,
    'transfer_number', v_transfer_number,
    'debit_movement_id', v_debit_movement_id,
    'credit_movement_id', v_credit_movement_id,
    'duplicate', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_entity_transfer(
  uuid, uuid, uuid, text, text, text, text, text, numeric, text, uuid, uuid, text
) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

SELECT 'entity_transfer_entity_optional' AS status;
