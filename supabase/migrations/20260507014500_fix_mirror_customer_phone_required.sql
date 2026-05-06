-- Fix linked movement creation when the reciprocal customer does not exist.
-- Older create_mirror_movement_v2 definitions inserted the reciprocal customer
-- without phone, while customers.phone is NOT NULL in this project.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_mirror_movement_v2(p_movement_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_original_movement record;
  v_customer record;
  v_linked_customer_id uuid;
  v_mirror_movement_id uuid;
  v_mirror_type text;
  v_mirror_needs_approval boolean;
  v_mirror_approval_status text;
  v_original_creator_name text;
BEGIN
  SELECT *
    INTO v_original_movement
  FROM public.account_movements
  WHERE id = p_movement_id;

  IF v_original_movement IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_original_movement.mirror_movement_id IS NOT NULL THEN
    RETURN v_original_movement.mirror_movement_id;
  END IF;

  SELECT *
    INTO v_customer
  FROM public.customers
  WHERE id = v_original_movement.customer_id;

  IF v_customer IS NULL OR v_customer.linked_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id
    INTO v_linked_customer_id
  FROM public.customers
  WHERE user_id = v_customer.linked_user_id
    AND linked_user_id = v_customer.user_id
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_linked_customer_id IS NULL THEN
    SELECT COALESCE(NULLIF(trim(full_name), ''), user_name)
      INTO v_original_creator_name
    FROM public.app_security
    WHERE id = v_customer.user_id
    LIMIT 1;

    INSERT INTO public.customers (
      user_id,
      linked_user_id,
      name,
      phone,
      account_number,
      notes
    ) VALUES (
      v_customer.linked_user_id,
      v_customer.user_id,
      COALESCE(v_original_creator_name, 'الطرف المقابل'),
      '',
      v_customer.account_number,
      'تم إنشاؤه تلقائياً للحركات المرتبطة'
    )
    RETURNING id INTO v_linked_customer_id;
  END IF;

  v_mirror_type := CASE
    WHEN v_original_movement.movement_type = 'outgoing' THEN 'incoming'
    ELSE 'outgoing'
  END;

  v_mirror_needs_approval := true;
  v_mirror_approval_status := 'pending';

  INSERT INTO public.account_movements (
    customer_id,
    movement_type,
    amount,
    currency,
    notes,
    commission,
    commission_currency,
    commission_recipient_id,
    source_user_id,
    created_by_user_id,
    created_by_user_name,
    mirror_movement_id,
    pending_approval,
    approval_status,
    is_voided
  ) VALUES (
    v_linked_customer_id,
    v_mirror_type,
    v_original_movement.amount,
    v_original_movement.currency,
    v_original_movement.notes,
    v_original_movement.commission,
    v_original_movement.commission_currency,
    v_original_movement.commission_recipient_id,
    v_original_movement.source_user_id,
    v_original_movement.created_by_user_id,
    v_original_movement.created_by_user_name,
    p_movement_id,
    v_mirror_needs_approval,
    v_mirror_approval_status,
    false
  )
  RETURNING id INTO v_mirror_movement_id;

  UPDATE public.account_movements
     SET mirror_movement_id = v_mirror_movement_id
   WHERE id = p_movement_id;

  PERFORM public.create_notification(
    v_mirror_movement_id,
    v_customer.linked_user_id,
    'approval_needed',
    'حركة جديدة تنتظر موافقتك من ' || COALESCE(v_customer.name, 'الطرف الآخر'),
    v_original_movement.movement_number,
    v_original_movement.amount,
    v_original_movement.currency,
    COALESCE(v_customer.name, 'الطرف الآخر'),
    COALESCE(v_original_movement.created_by_user_name, v_customer.name, 'الطرف الآخر'),
    v_original_movement.movement_type,
    jsonb_build_object(
      'approval_status', 'pending',
      'requires_action', true,
      'created_by_user_id', v_original_movement.created_by_user_id,
      'source_user_id', v_original_movement.source_user_id,
      'created_by_name', v_original_movement.created_by_user_name,
      'movement_notes', v_original_movement.notes
    )
  );

  RETURN v_mirror_movement_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_mirror_movement_v2(uuid)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
