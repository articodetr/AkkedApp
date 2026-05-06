-- Keep notification snapshots in sync when a linked movement is edited.
-- Notification cards also join account_movements, but touching the notification
-- rows makes existing realtime subscriptions refresh immediately.

BEGIN;

ALTER TABLE public.movement_notifications
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE OR REPLACE FUNCTION public.sync_movement_notifications_after_movement_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF to_regclass('public.movement_notifications') IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.movement_notifications
     SET customer_id = NEW.customer_id,
         movement_number = NEW.movement_number,
         amount = NEW.amount,
         currency = NEW.currency,
         movement_type = NEW.movement_type,
         extra_data = COALESCE(extra_data, '{}'::jsonb)
           || jsonb_strip_nulls(jsonb_build_object(
             'movement_notes', NEW.notes,
             'movement_note', NEW.notes,
             'updated_movement_at', now()
           ))
   WHERE movement_id = NEW.id
     AND deleted_at IS NULL;

  RETURN NEW;
END;
$$;

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
  v_pair_ids uuid[];
  v_pair_type text;
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

  v_pair_ids := public.get_movement_pair_ids(v_movement_id);
  v_pair_type := CASE
    WHEN p_movement_type = 'incoming' THEN 'outgoing'
    WHEN p_movement_type = 'outgoing' THEN 'incoming'
    ELSE p_movement_type
  END;

  UPDATE public.account_movements
     SET movement_type = CASE
           WHEN id = v_movement_id THEN p_movement_type
           ELSE v_pair_type
         END,
         amount = p_amount,
         currency = p_currency,
         commission = NULL,
         commission_currency = NULL,
         notes = NULLIF(TRIM(COALESCE(p_notes, '')), ''),
         sender_name = NULLIF(TRIM(COALESCE(p_sender_name, '')), ''),
         beneficiary_name = NULLIF(TRIM(COALESCE(p_beneficiary_name, '')), ''),
         transfer_number = NULLIF(TRIM(COALESCE(p_transfer_number, '')), '')
   WHERE id = ANY(v_pair_ids);

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  UPDATE public.movement_notifications mn
     SET customer_id = am.customer_id,
         movement_number = am.movement_number,
         amount = am.amount,
         currency = am.currency,
         movement_type = am.movement_type,
         extra_data = COALESCE(mn.extra_data, '{}'::jsonb)
           || jsonb_strip_nulls(jsonb_build_object(
             'movement_notes', am.notes,
             'movement_note', am.notes,
             'updated_movement_at', now()
           ))
    FROM public.account_movements am
   WHERE mn.movement_id = am.id
     AND am.id = ANY(v_pair_ids)
     AND mn.deleted_at IS NULL;

  RETURN jsonb_build_object(
    'success', v_updated > 0,
    'updated', v_updated,
    'movement_ids', v_pair_ids
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

DROP TRIGGER IF EXISTS trg_sync_movement_notifications_after_movement_update
  ON public.account_movements;

CREATE TRIGGER trg_sync_movement_notifications_after_movement_update
AFTER UPDATE OF
  movement_number,
  movement_type,
  amount,
  currency,
  notes,
  customer_id
ON public.account_movements
FOR EACH ROW
WHEN (
  OLD.movement_number IS DISTINCT FROM NEW.movement_number OR
  OLD.movement_type IS DISTINCT FROM NEW.movement_type OR
  OLD.amount IS DISTINCT FROM NEW.amount OR
  OLD.currency IS DISTINCT FROM NEW.currency OR
  OLD.notes IS DISTINCT FROM NEW.notes OR
  OLD.customer_id IS DISTINCT FROM NEW.customer_id
)
EXECUTE FUNCTION public.sync_movement_notifications_after_movement_update();

UPDATE public.movement_notifications mn
   SET customer_id = am.customer_id,
       movement_number = am.movement_number,
       amount = am.amount,
       currency = am.currency,
       movement_type = am.movement_type,
       extra_data = COALESCE(mn.extra_data, '{}'::jsonb)
         || jsonb_strip_nulls(jsonb_build_object(
           'movement_notes', am.notes,
           'movement_note', am.notes,
           'updated_movement_at', now()
         ))
  FROM public.account_movements am
 WHERE mn.movement_id = am.id
   AND mn.deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
