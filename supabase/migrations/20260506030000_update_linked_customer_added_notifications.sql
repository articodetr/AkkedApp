/*
  Make linked-customer addition notifications explicit and idempotent.
*/

ALTER TABLE public.movement_notifications
  DROP CONSTRAINT IF EXISTS valid_notification_type;

ALTER TABLE public.movement_notifications
  DROP CONSTRAINT IF EXISTS movement_notifications_notification_type_check;

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  FOR v_constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'movement_notifications'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%notification_type%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.movement_notifications DROP CONSTRAINT IF EXISTS %I',
      v_constraint_name
    );
  END LOOP;
END $$;

ALTER TABLE public.movement_notifications
  ADD CONSTRAINT movement_notifications_notification_type_check
  CHECK (
    notification_type IN (
      'approval_needed',
      'deletion_request',
      'approved',
      'rejected',
      'movement_added',
      'movement_pending',
      'movement_approved',
      'movement_rejected',
      'movement_deleted',
      'customer_added',
      'linked_account_added'
    )
  );

CREATE OR REPLACE FUNCTION public.notify_linked_customer_added(
  p_owner_user_id uuid,
  p_linked_user_id uuid,
  p_owner_name text DEFAULT NULL,
  p_customer_name text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_full_name text;
  v_owner_user_name text;
  v_owner_account_number text;
  v_linked_full_name text;
  v_linked_user_name text;
  v_owner_display_name text;
  v_customer_display_name text;
  v_reciprocal_customer_id uuid;
  v_existing_notification_id uuid;
  v_title text := 'تمت إضافتك كعميل جديد';
  v_message text;
BEGIN
  IF p_owner_user_id IS NULL OR p_linked_user_id IS NULL OR p_owner_user_id = p_linked_user_id THEN
    RETURN;
  END IF;

  SELECT full_name, user_name, account_number
    INTO v_owner_full_name, v_owner_user_name, v_owner_account_number
  FROM public.app_security
  WHERE id = p_owner_user_id;

  SELECT full_name, user_name
    INTO v_linked_full_name, v_linked_user_name
  FROM public.app_security
  WHERE id = p_linked_user_id;

  v_owner_display_name := COALESCE(
    NULLIF(trim(p_owner_name), ''),
    NULLIF(trim(v_owner_full_name), ''),
    NULLIF(trim(v_owner_user_name), ''),
    'مستخدم'
  );

  v_customer_display_name := COALESCE(
    NULLIF(trim(p_customer_name), ''),
    NULLIF(trim(v_linked_full_name), ''),
    NULLIF(trim(v_linked_user_name), ''),
    'عميل'
  );

  SELECT id
    INTO v_reciprocal_customer_id
  FROM public.customers
  WHERE user_id = p_linked_user_id
    AND linked_user_id = p_owner_user_id
  ORDER BY created_at DESC
  LIMIT 1;

  v_message := format(
    'قام %s بإضافتك إلى قائمة عملائه.%s',
    v_owner_display_name,
    CASE
      WHEN COALESCE(v_owner_account_number, '') <> '' THEN ' رقم الحساب: ' || v_owner_account_number || '.'
      ELSE ''
    END
  );

  SELECT id
    INTO v_existing_notification_id
  FROM public.movement_notifications
  WHERE user_id = p_linked_user_id
    AND sender_user_id = p_owner_user_id
    AND notification_type = 'customer_added'
    AND deleted_at IS NULL
    AND created_at > now() - interval '1 day'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_notification_id IS NOT NULL THEN
    UPDATE public.movement_notifications
       SET title = v_title,
           message = v_message,
           status = 'info',
           is_read = false,
           read_at = NULL,
           action_required = false,
           customer_id = COALESCE(v_reciprocal_customer_id, customer_id),
           recipient_user_id = p_linked_user_id,
           sender_user_id = p_owner_user_id,
           customer_name = v_customer_display_name,
           actor_name = v_owner_display_name,
           extra_data = COALESCE(extra_data, '{}'::jsonb) || jsonb_strip_nulls(
             jsonb_build_object(
               'owner_name', v_owner_display_name,
               'owner_user_id', p_owner_user_id,
               'account_number', v_owner_account_number,
               'owner_account_number', v_owner_account_number,
               'customer_name', v_customer_display_name,
               'linked_customer_name', v_customer_display_name
             )
           )
     WHERE id = v_existing_notification_id;

    RETURN;
  END IF;

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
    customer_name,
    actor_name,
    extra_data
  ) VALUES (
    p_linked_user_id,
    p_linked_user_id,
    p_owner_user_id,
    v_reciprocal_customer_id,
    NULL,
    'customer_added',
    v_title,
    v_message,
    false,
    'info',
    false,
    v_customer_display_name,
    v_owner_display_name,
    jsonb_strip_nulls(
      jsonb_build_object(
        'owner_name', v_owner_display_name,
        'owner_user_id', p_owner_user_id,
        'account_number', v_owner_account_number,
        'owner_account_number', v_owner_account_number,
        'customer_name', v_customer_display_name,
        'linked_customer_name', v_customer_display_name
      )
    )
  );
END;
$$;

COMMENT ON FUNCTION public.notify_linked_customer_added(uuid, uuid, text, text)
IS 'Creates a clear customer_added notification when one user adds another as a linked customer.';
