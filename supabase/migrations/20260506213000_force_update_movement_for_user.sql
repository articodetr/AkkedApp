-- Hotfix: allow edit-movement screen to update a movement that is visible through
-- the scoped customer movement RPC but hidden from direct client update by RLS.

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
  v_user_id text;
  v_movement record;
  v_customer record;
  v_updated integer := 0;
BEGIN
  SELECT id::text
    INTO v_user_id
  FROM public.app_security
  WHERE user_name = p_user_name
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'لم يتم العثور على المستخدم الحالي');
  END IF;

  SELECT *
    INTO v_movement
  FROM public.account_movements
  WHERE id::text = p_movement_id
  LIMIT 1;

  IF v_movement.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'لم يتم العثور على الحركة');
  END IF;

  SELECT *
    INTO v_customer
  FROM public.customers
  WHERE id = v_movement.customer_id
  LIMIT 1;

  IF v_customer.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'لم يتم العثور على العميل المرتبط بالحركة');
  END IF;

  IF NOT (
    COALESCE(v_customer.user_id::text, '') = v_user_id OR
    COALESCE(v_customer.linked_user_id::text, '') = v_user_id OR
    COALESCE(v_movement.created_by_user_id::text, '') = v_user_id OR
    COALESCE(v_movement.source_user_id::text, '') = v_user_id OR
    COALESCE(v_movement.created_by_user_name::text, '') = p_user_name
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
  WHERE id::text = p_movement_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', v_updated > 0,
    'updated', v_updated,
    'movement_id', p_movement_id
  );
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
) TO authenticated;

NOTIFY pgrst, 'reload schema';
