/*
  Pending linked movement edit/delete workflow.

  - The original creator can edit/delete a pending movement directly.
  - The counterparty can request an edit/delete; the creator must approve it.
*/

ALTER TABLE public.account_movements
  ADD COLUMN IF NOT EXISTS pending_update_payload jsonb,
  ADD COLUMN IF NOT EXISTS update_requested_by uuid REFERENCES public.app_security(id),
  ADD COLUMN IF NOT EXISTS update_requested_at timestamptz;

CREATE INDEX IF NOT EXISTS account_movements_update_requested_by_idx
  ON public.account_movements(update_requested_by)
  WHERE update_requested_by IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_movement_pair_ids(p_movement_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ARRAY(
    SELECT DISTINCT x.id
    FROM public.account_movements m
    CROSS JOIN LATERAL (
      VALUES (m.id), (m.mirror_movement_id)
    ) AS x(id)
    WHERE m.id = p_movement_id
      AND x.id IS NOT NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.apply_movement_update_payload(
  p_movement_id uuid,
  p_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_movement public.account_movements%ROWTYPE;
  v_pair_id uuid;
  v_type text;
  v_pair_type text;
BEGIN
  SELECT *
    INTO v_movement
  FROM public.account_movements
  WHERE id = p_movement_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movement not found';
  END IF;

  v_pair_id := v_movement.mirror_movement_id;
  v_type := COALESCE(NULLIF(p_payload->>'movement_type', ''), v_movement.movement_type);
  v_pair_type := CASE
    WHEN v_type = 'incoming' THEN 'outgoing'
    WHEN v_type = 'outgoing' THEN 'incoming'
    ELSE v_type
  END;

  UPDATE public.account_movements
     SET movement_type = CASE WHEN id = v_movement.id THEN v_type ELSE v_pair_type END,
         amount = COALESCE(NULLIF(p_payload->>'amount', '')::numeric, amount),
         currency = COALESCE(NULLIF(p_payload->>'currency', ''), currency),
         commission = NULL,
         commission_currency = NULL,
         notes = NULLIF(p_payload->>'notes', ''),
         sender_name = NULLIF(p_payload->>'sender_name', ''),
         beneficiary_name = NULLIF(p_payload->>'beneficiary_name', ''),
         transfer_number = NULLIF(p_payload->>'transfer_number', '')
   WHERE id = ANY(public.get_movement_pair_ids(v_movement.id));

  UPDATE public.account_movements
     SET pending_update_payload = NULL,
         update_requested_by = NULL,
         update_requested_at = NULL
   WHERE id = ANY(public.get_movement_pair_ids(v_movement.id));
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_movement_workflow(
  p_user_id uuid,
  p_actor_user_id uuid,
  p_movement_id uuid,
  p_notification_type text,
  p_title text,
  p_message text,
  p_action_required boolean DEFAULT false,
  p_status text DEFAULT 'info',
  p_extra_data jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_movement public.account_movements%ROWTYPE;
  v_customer_name text;
  v_actor_name text;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT *
    INTO v_movement
  FROM public.account_movements
  WHERE id = p_movement_id;

  IF NOT FOUND THEN
    INSERT INTO public.movement_notifications (
      user_id,
      recipient_user_id,
      sender_user_id,
      movement_id,
      notification_type,
      title,
      message,
      is_read,
      status,
      action_required,
      extra_data
    ) VALUES (
      p_user_id,
      p_user_id,
      p_actor_user_id,
      NULL,
      p_notification_type,
      p_title,
      p_message,
      false,
      p_status,
      p_action_required,
      COALESCE(p_extra_data, '{}'::jsonb)
    );
    RETURN;
  END IF;

  SELECT name
    INTO v_customer_name
  FROM public.customers
  WHERE id = v_movement.customer_id;

  SELECT COALESCE(NULLIF(full_name, ''), user_name)
    INTO v_actor_name
  FROM public.app_security
  WHERE id = p_actor_user_id;

  INSERT INTO public.movement_notifications (
    user_id,
    recipient_user_id,
    sender_user_id,
    customer_id,
    movement_id,
    notification_type,
    title,
    message,
    is_read,
    status,
    action_required,
    movement_number,
    amount,
    currency,
    movement_type,
    customer_name,
    actor_name,
    extra_data
  ) VALUES (
    p_user_id,
    p_user_id,
    p_actor_user_id,
    v_movement.customer_id,
    p_movement_id,
    p_notification_type,
    p_title,
    p_message,
    false,
    p_status,
    p_action_required,
    v_movement.movement_number,
    v_movement.amount,
    v_movement.currency,
    v_movement.movement_type,
    v_customer_name,
    v_actor_name,
    COALESCE(p_extra_data, '{}'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_movement_other_user_id(
  p_movement_id uuid,
  p_actor_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_other_user_id uuid;
BEGIN
  SELECT COALESCE(
           NULLIF(c.linked_user_id, p_actor_user_id),
           NULLIF(pc.user_id, p_actor_user_id),
           NULLIF(c.user_id, p_actor_user_id)
         )
    INTO v_other_user_id
  FROM public.account_movements m
  LEFT JOIN public.customers c ON c.id = m.customer_id
  LEFT JOIN public.account_movements pm ON pm.id = m.mirror_movement_id
  LEFT JOIN public.customers pc ON pc.id = pm.customer_id
  WHERE m.id = p_movement_id;

  RETURN v_other_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_movement_update(
  p_movement_id uuid,
  p_user_name text,
  p_movement_type text,
  p_amount numeric,
  p_currency text,
  p_notes text,
  p_sender_name text DEFAULT NULL,
  p_beneficiary_name text DEFAULT NULL,
  p_transfer_number text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_movement public.account_movements%ROWTYPE;
  v_creator_user_id uuid;
  v_other_user_id uuid;
  v_payload jsonb;
  v_is_pending boolean;
BEGIN
  SELECT id
    INTO v_user_id
  FROM public.app_security
  WHERE user_name = p_user_name;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not found: %', p_user_name;
  END IF;

  SELECT *
    INTO v_movement
  FROM public.account_movements
  WHERE id = p_movement_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movement not found';
  END IF;

  v_creator_user_id := COALESCE(v_movement.created_by_user_id, v_movement.source_user_id);
  v_is_pending := COALESCE(v_movement.pending_approval, false)
    OR LOWER(COALESCE(v_movement.approval_status::text, '')) = 'pending';

  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'movement_type', p_movement_type,
    'amount', p_amount,
    'currency', p_currency,
    'notes', p_notes,
    'sender_name', p_sender_name,
    'beneficiary_name', p_beneficiary_name,
    'transfer_number', p_transfer_number
  ));

  IF NOT v_is_pending OR v_creator_user_id IS NULL OR v_creator_user_id = v_user_id THEN
    PERFORM public.apply_movement_update_payload(p_movement_id, v_payload);

    v_other_user_id := public.get_movement_other_user_id(p_movement_id, v_user_id);
    PERFORM public.notify_movement_workflow(
      v_other_user_id,
      v_user_id,
      p_movement_id,
      'movement_pending',
      'تم تعديل حركة معلقة',
      'قام منشئ الحركة بتعديل بيانات الحركة المعلقة. راجع الحركة قبل الموافقة.',
      false,
      'pending',
      jsonb_build_object(
        'request_type', 'creator_direct_update',
        'approval_status', 'pending',
        'updated_payload', v_payload
      )
    );

    RETURN json_build_object(
      'success', true,
      'updated', true,
      'requires_approval', false
    );
  END IF;

  UPDATE public.account_movements
     SET pending_update_payload = v_payload,
         update_requested_by = v_user_id,
         update_requested_at = now()
   WHERE id = ANY(public.get_movement_pair_ids(p_movement_id));

  PERFORM public.notify_movement_workflow(
    v_creator_user_id,
    v_user_id,
    p_movement_id,
    'approval_needed',
    'طلب تعديل حركة معلقة',
    'طلب الطرف الآخر تعديل بيانات حركة معلقة. يجب موافقتك قبل تطبيق التعديل.',
    true,
    'pending',
    jsonb_build_object(
      'request_type', 'movement_update_request',
      'approval_status', 'pending',
      'requires_action', true,
      'requested_payload', v_payload
    )
  );

  RETURN json_build_object(
    'success', true,
    'updated', false,
    'requires_approval', true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_movement_update_request(
  p_movement_id uuid,
  p_user_name text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_movement public.account_movements%ROWTYPE;
  v_creator_user_id uuid;
  v_requester_id uuid;
  v_payload jsonb;
BEGIN
  SELECT id
    INTO v_user_id
  FROM public.app_security
  WHERE user_name = p_user_name;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not found: %', p_user_name;
  END IF;

  SELECT *
    INTO v_movement
  FROM public.account_movements
  WHERE id = p_movement_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movement not found';
  END IF;

  v_creator_user_id := COALESCE(v_movement.created_by_user_id, v_movement.source_user_id);
  v_requester_id := v_movement.update_requested_by;
  v_payload := v_movement.pending_update_payload;

  IF v_creator_user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'Only the movement creator can approve this update request';
  END IF;

  IF v_payload IS NULL OR v_requester_id IS NULL THEN
    RAISE EXCEPTION 'No pending update request for this movement';
  END IF;

  PERFORM public.apply_movement_update_payload(p_movement_id, v_payload);

  UPDATE public.movement_notifications
     SET status = 'approved',
         action_required = false,
         is_read = true,
         read_at = now(),
         acted_at = now(),
         extra_data = COALESCE(extra_data, '{}'::jsonb)
           || jsonb_build_object('approval_status', 'approved', 'requires_action', false)
   WHERE movement_id = p_movement_id
     AND user_id = v_user_id
     AND notification_type = 'approval_needed'
     AND extra_data->>'request_type' = 'movement_update_request'
     AND deleted_at IS NULL;

  PERFORM public.notify_movement_workflow(
    v_requester_id,
    v_user_id,
    p_movement_id,
    'movement_approved',
    'تمت الموافقة على تعديل الحركة',
    'وافق منشئ الحركة على التعديل الذي طلبته، وتم تطبيق البيانات الجديدة.',
    false,
    'approved',
    jsonb_build_object(
      'request_type', 'movement_update_request',
      'approval_status', 'approved'
    )
  );

  RETURN json_build_object('success', true, 'updated', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_movement_update_request(
  p_movement_id uuid,
  p_user_name text,
  p_reject_reason text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_movement public.account_movements%ROWTYPE;
  v_creator_user_id uuid;
  v_requester_id uuid;
BEGIN
  SELECT id
    INTO v_user_id
  FROM public.app_security
  WHERE user_name = p_user_name;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not found: %', p_user_name;
  END IF;

  SELECT *
    INTO v_movement
  FROM public.account_movements
  WHERE id = p_movement_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movement not found';
  END IF;

  v_creator_user_id := COALESCE(v_movement.created_by_user_id, v_movement.source_user_id);
  v_requester_id := v_movement.update_requested_by;

  IF v_creator_user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'Only the movement creator can reject this update request';
  END IF;

  UPDATE public.account_movements
     SET pending_update_payload = NULL,
         update_requested_by = NULL,
         update_requested_at = NULL
   WHERE id = ANY(public.get_movement_pair_ids(p_movement_id));

  UPDATE public.movement_notifications
     SET status = 'rejected',
         action_required = false,
         is_read = true,
         read_at = now(),
         acted_at = now(),
         extra_data = COALESCE(extra_data, '{}'::jsonb)
           || jsonb_strip_nulls(jsonb_build_object(
             'approval_status', 'rejected',
             'requires_action', false,
             'reject_reason', p_reject_reason
           ))
   WHERE movement_id = p_movement_id
     AND user_id = v_user_id
     AND notification_type = 'approval_needed'
     AND extra_data->>'request_type' = 'movement_update_request'
     AND deleted_at IS NULL;

  PERFORM public.notify_movement_workflow(
    v_requester_id,
    v_user_id,
    p_movement_id,
    'movement_rejected',
    'تم رفض تعديل الحركة',
    COALESCE('رفض منشئ الحركة طلب التعديل. السبب: ' || NULLIF(p_reject_reason, ''), 'رفض منشئ الحركة طلب التعديل.'),
    false,
    'rejected',
    jsonb_strip_nulls(jsonb_build_object(
      'request_type', 'movement_update_request',
      'approval_status', 'rejected',
      'reject_reason', p_reject_reason
    ))
  );

  RETURN json_build_object('success', true, 'rejected', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.request_movement_deletion(
  p_movement_id uuid,
  p_user_name text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_movement public.account_movements%ROWTYPE;
  v_creator_user_id uuid;
  v_other_user_id uuid;
BEGIN
  SELECT id
    INTO v_user_id
  FROM public.app_security
  WHERE user_name = p_user_name;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not found: %', p_user_name;
  END IF;

  SELECT *
    INTO v_movement
  FROM public.account_movements
  WHERE id = p_movement_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movement not found';
  END IF;

  v_creator_user_id := COALESCE(v_movement.created_by_user_id, v_movement.source_user_id);

  IF v_creator_user_id IS NULL OR v_creator_user_id = v_user_id THEN
    v_other_user_id := public.get_movement_other_user_id(p_movement_id, v_user_id);

    DELETE FROM public.account_movements
    WHERE id = ANY(public.get_movement_pair_ids(p_movement_id));

    PERFORM public.notify_movement_workflow(
      v_other_user_id,
      v_user_id,
      NULL,
      'movement_deleted',
      'تم حذف حركة معلقة',
      'قام منشئ الحركة بحذف الحركة المعلقة قبل اعتمادها.',
      false,
      'done',
      jsonb_build_object(
        'request_type', 'creator_direct_delete',
        'movement_number', v_movement.movement_number,
        'amount', v_movement.amount,
        'currency', v_movement.currency
      )
    );

    RETURN json_build_object(
      'success', true,
      'deleted', true,
      'requires_approval', false
    );
  END IF;

  UPDATE public.account_movements
     SET deletion_requested = true,
         deletion_requested_by = v_user_id,
         deletion_requested_at = now()
   WHERE id = ANY(public.get_movement_pair_ids(p_movement_id));

  PERFORM public.notify_movement_workflow(
    v_creator_user_id,
    v_user_id,
    p_movement_id,
    'deletion_request',
    'طلب حذف حركة معلقة',
    'طلب الطرف الآخر حذف حركة معلقة. يجب موافقتك قبل حذفها.',
    true,
    'pending',
    jsonb_build_object(
      'request_type', 'deletion_request',
      'approval_status', 'pending',
      'requires_action', true
    )
  );

  RETURN json_build_object(
    'success', true,
    'deleted', false,
    'requires_approval', true,
    'pending_approval', true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_movement_deletion(
  p_movement_id uuid,
  p_user_name text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_movement public.account_movements%ROWTYPE;
  v_creator_user_id uuid;
  v_requester_id uuid;
BEGIN
  SELECT id
    INTO v_user_id
  FROM public.app_security
  WHERE user_name = p_user_name;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not found: %', p_user_name;
  END IF;

  SELECT *
    INTO v_movement
  FROM public.account_movements
  WHERE id = p_movement_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movement not found';
  END IF;

  v_creator_user_id := COALESCE(v_movement.created_by_user_id, v_movement.source_user_id);
  v_requester_id := v_movement.deletion_requested_by;

  IF v_creator_user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'Only the movement creator can approve deletion';
  END IF;

  IF COALESCE(v_movement.deletion_requested, false) = false THEN
    RAISE EXCEPTION 'No deletion request for this movement';
  END IF;

  DELETE FROM public.account_movements
  WHERE id = ANY(public.get_movement_pair_ids(p_movement_id));

  PERFORM public.notify_movement_workflow(
    v_requester_id,
    v_user_id,
    NULL,
    'movement_deleted',
    'تمت الموافقة على حذف الحركة',
    'وافق منشئ الحركة على طلب الحذف وتم حذف الحركة.',
    false,
    'done',
    jsonb_build_object(
      'request_type', 'deletion_request',
      'approval_status', 'approved',
      'movement_number', v_movement.movement_number,
      'amount', v_movement.amount,
      'currency', v_movement.currency
    )
  );

  RETURN json_build_object('success', true, 'deleted', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_movement_deletion_request(
  p_movement_id uuid,
  p_user_name text,
  p_reject_reason text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_movement public.account_movements%ROWTYPE;
  v_creator_user_id uuid;
  v_requester_id uuid;
BEGIN
  SELECT id
    INTO v_user_id
  FROM public.app_security
  WHERE user_name = p_user_name;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not found: %', p_user_name;
  END IF;

  SELECT *
    INTO v_movement
  FROM public.account_movements
  WHERE id = p_movement_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movement not found';
  END IF;

  v_creator_user_id := COALESCE(v_movement.created_by_user_id, v_movement.source_user_id);
  v_requester_id := v_movement.deletion_requested_by;

  IF v_creator_user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'Only the movement creator can reject deletion';
  END IF;

  UPDATE public.account_movements
     SET deletion_requested = false,
         deletion_requested_by = NULL,
         deletion_requested_at = NULL
   WHERE id = ANY(public.get_movement_pair_ids(p_movement_id));

  UPDATE public.movement_notifications
     SET status = 'rejected',
         action_required = false,
         is_read = true,
         read_at = now(),
         acted_at = now(),
         extra_data = COALESCE(extra_data, '{}'::jsonb)
           || jsonb_strip_nulls(jsonb_build_object(
             'approval_status', 'rejected',
             'requires_action', false,
             'reject_reason', p_reject_reason
           ))
   WHERE movement_id = p_movement_id
     AND user_id = v_user_id
     AND notification_type = 'deletion_request'
     AND deleted_at IS NULL;

  PERFORM public.notify_movement_workflow(
    v_requester_id,
    v_user_id,
    p_movement_id,
    'movement_rejected',
    'تم رفض حذف الحركة',
    COALESCE('رفض منشئ الحركة طلب الحذف. السبب: ' || NULLIF(p_reject_reason, ''), 'رفض منشئ الحركة طلب الحذف.'),
    false,
    'rejected',
    jsonb_strip_nulls(jsonb_build_object(
      'request_type', 'deletion_request',
      'approval_status', 'rejected',
      'reject_reason', p_reject_reason
    ))
  );

  RETURN json_build_object('success', true, 'rejected', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_movement_update(uuid, text, text, numeric, text, text, text, text, text)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_movement_update_request(uuid, text)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_movement_update_request(uuid, text, text)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_movement_deletion(uuid, text)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_movement_deletion(uuid, text)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_movement_deletion_request(uuid, text, text)
  TO anon, authenticated;
