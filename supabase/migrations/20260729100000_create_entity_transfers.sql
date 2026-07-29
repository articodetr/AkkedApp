/*
  حوالات الجهات والشبكات
  ======================

  يسجل كل إرسال/استلام كسجل حوالة مستقل، ثم ينشئ قيداً محاسبياً
  متوازناً على حسابين غير مرتبطين يملكهما المستخدم:

    الحساب المدين  -> account_movements.outgoing (عليه / رصيد سالب)
    الحساب الدائن  -> account_movements.incoming (له / رصيد موجب)

  operation_id هو مفتاح منع التكرار؛ إعادة نفس طلب الحفظ ترجع الحوالة
  الموجودة ولا تنشئ قيوداً إضافية.
*/

BEGIN;

CREATE TABLE IF NOT EXISTS public.entity_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL,
  transfer_number text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES public.app_security(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('send', 'receive')),
  sender_name text NOT NULL,
  sender_phone text NOT NULL,
  beneficiary_name text NOT NULL,
  beneficiary_phone text NOT NULL,
  amount numeric(15, 2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL,
  debit_customer_id uuid NOT NULL,
  credit_customer_id uuid NOT NULL,
  debit_movement_id uuid,
  credit_movement_id uuid,
  notes text,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT entity_transfers_entity_id_fkey
    FOREIGN KEY (entity_id) REFERENCES public.transfer_entities(id) ON DELETE RESTRICT,
  CONSTRAINT entity_transfers_debit_customer_id_fkey
    FOREIGN KEY (debit_customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT,
  CONSTRAINT entity_transfers_credit_customer_id_fkey
    FOREIGN KEY (credit_customer_id) REFERENCES public.customers(id) ON DELETE RESTRICT,
  CONSTRAINT entity_transfers_debit_movement_id_fkey
    FOREIGN KEY (debit_movement_id) REFERENCES public.account_movements(id) ON DELETE SET NULL,
  CONSTRAINT entity_transfers_credit_movement_id_fkey
    FOREIGN KEY (credit_movement_id) REFERENCES public.account_movements(id) ON DELETE SET NULL,
  CONSTRAINT entity_transfers_accounts_different
    CHECK (debit_customer_id <> credit_customer_id),
  CONSTRAINT entity_transfers_sender_name_not_blank
    CHECK (length(trim(sender_name)) > 0),
  CONSTRAINT entity_transfers_sender_phone_not_blank
    CHECK (length(trim(sender_phone)) > 0),
  CONSTRAINT entity_transfers_beneficiary_name_not_blank
    CHECK (length(trim(beneficiary_name)) > 0),
  CONSTRAINT entity_transfers_beneficiary_phone_not_blank
    CHECK (length(trim(beneficiary_phone)) > 0),
  CONSTRAINT entity_transfers_currency_not_blank
    CHECK (length(trim(currency)) > 0),
  CONSTRAINT entity_transfers_user_operation_unique
    UNIQUE (user_id, operation_id)
);

CREATE INDEX IF NOT EXISTS idx_entity_transfers_user_created
  ON public.entity_transfers (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_entity_transfers_entity
  ON public.entity_transfers (entity_id, created_at DESC);

ALTER TABLE public.entity_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read access to entity transfers" ON public.entity_transfers;
CREATE POLICY "Allow read access to entity transfers"
  ON public.entity_transfers FOR SELECT
  TO authenticated, anon
  USING (true);

DROP POLICY IF EXISTS "Allow insert access to entity transfers" ON public.entity_transfers;
CREATE POLICY "Allow insert access to entity transfers"
  ON public.entity_transfers FOR INSERT
  TO authenticated, anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update access to entity transfers" ON public.entity_transfers;
CREATE POLICY "Allow update access to entity transfers"
  ON public.entity_transfers FOR UPDATE
  TO authenticated, anon
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON public.entity_transfers TO anon, authenticated;

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
  v_entity public.transfer_entities%ROWTYPE;
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

  SELECT *
    INTO v_entity
  FROM public.transfer_entities
  WHERE id = p_entity_id
    AND user_id = p_user_id
    AND is_active = true;

  IF v_entity.id IS NULL THEN
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
    upper(substr(replace(p_operation_id::text, '-', ''), 1, 12));
  v_movement_notes :=
    CASE WHEN p_direction = 'send' THEN 'حوالة إرسال' ELSE 'حوالة استلام' END ||
    ' عبر ' || v_entity.name || ': ' ||
    trim(p_sender_name) || ' ← ' || trim(p_beneficiary_name) ||
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

SELECT 'entity_transfers_created' AS status;
