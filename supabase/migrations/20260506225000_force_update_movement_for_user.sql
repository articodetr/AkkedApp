-- Hotfix for editing a movement from the bottom sheet.
-- This function is used when normal client update is blocked by RLS/schema visibility.

BEGIN;

DROP FUNCTION IF EXISTS public.force_update_movement_for_user(text, text, text, numeric, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.force_update_movement_for_user(
  p_movement_id text,
  p_user_name text,
  p_movement_type text,
  p_amount numeric,
  p_currency text,
  p_notes text,
  p_sender_name text DEFAULT NULL,
  p_beneficiary_name text DEFAULT NULL,
  p_transfer_number text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_movement_id uuid;
  v_movement public.account_movements%ROWTYPE;
  v_customer public.customers%ROWTYPE;
  v_updated integer := 0;
BEGIN
  BEGIN
    v_movement_id := p_movement_id::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RETURN jsonb_build_object('success', false, 'error', 'رقم الحركة غير صحيح');
  END;

  SELECT id
  INTO v_user_id
  FROM public.app_security
  WHERE lower(user_name) = lower(coalesce(p_user_name, ''))
    AND coalesce(is_active, true) = true
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'لم يتم العثور على المستخدم الحالي أو أن الحساب غير مفعل');
  END IF;

  SELECT *
  INTO v_movement
  FROM public.account_movements
  WHERE id = v_movement_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'لم يتم العثور على الحركة');
  END IF;

  SELECT *
  INTO v_customer
  FROM public.customers
  WHERE id = v_movement.customer_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'لم يتم العثور على العميل المرتبط بالحركة');
  END IF;

  IF NOT (
    COALESCE(v_customer.user_id::text, '') = v_user_id::text OR
    COALESCE(v_customer.linked_user_id::text, '') = v_user_id::text OR
    COALESCE(v_movement.created_by_user_id::text, '') = v_user_id::text OR
    COALESCE(v_movement.source_user_id::text, '') = v_user_id::text OR
    lower(COALESCE(v_movement.created_by_user_name::text, '')) = lower(COALESCE(p_user_name, ''))
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'هذه الحركة غير متاحة للحساب الحالي');
  END IF;

  UPDATE public.account_movements
  SET
    movement_type = p_movement_type,
    amount = p_amount,
    currency = p_currency,
    commission = NULL,
    commission_currency = NULL,
    notes = NULLIF(TRIM(COALESCE(p_notes, '')), ''),
    sender_name = NULLIF(TRIM(COALESCE(p_sender_name, '')), ''),
    beneficiary_name = NULLIF(TRIM(COALESCE(p_beneficiary_name, '')), ''),
    transfer_number = NULLIF(TRIM(COALESCE(p_transfer_number, '')), '')
  WHERE id = v_movement_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', v_updated > 0,
    'updated', v_updated,
    'movement_id', p_movement_id
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.force_update_movement_for_user(
  text,
  text,
  text,
  numeric,
  text,
  text,
  text,
  text,
  text
) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
