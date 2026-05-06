-- حذف الحركة المعلقة مباشرة من التطبيق حتى لو كانت بانتظار الموافقة.
-- تستخدمها شاشة تفاصيل العميل وشاشة تفاصيل الحركة عند الضغط على زر حذف لحركة pending.

CREATE OR REPLACE FUNCTION public.force_delete_pending_movement(
  p_movement_id uuid,
  p_user_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_movement account_movements%ROWTYPE;
  v_status text;
  v_delete_ids uuid[];
  v_deleted_count integer := 0;
BEGIN
  SELECT id
  INTO v_actor_id
  FROM public.app_security
  WHERE lower(user_name) = lower(coalesce(p_user_name, ''))
    AND coalesce(is_active, true) = true
  LIMIT 1;

  IF v_actor_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'لم يتم العثور على المستخدم الحالي أو أن الحساب غير مفعل'
    );
  END IF;

  SELECT *
  INTO v_movement
  FROM public.account_movements
  WHERE id = p_movement_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'لم يتم العثور على الحركة'
    );
  END IF;

  v_status := COALESCE(
    v_movement.approval_status,
    CASE WHEN COALESCE(v_movement.pending_approval, false) THEN 'pending' ELSE 'approved' END
  );

  IF v_status <> 'pending' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'الحذف المباشر مخصص للحركات المعلقة فقط'
    );
  END IF;

  SELECT array_agg(DISTINCT id)
  INTO v_delete_ids
  FROM public.account_movements
  WHERE id = p_movement_id
     OR id = v_movement.mirror_movement_id
     OR id = v_movement.related_transfer_id
     OR id = v_movement.related_commission_movement_id
     OR mirror_movement_id = p_movement_id
     OR related_transfer_id = p_movement_id
     OR related_commission_movement_id = p_movement_id;

  IF v_delete_ids IS NULL OR array_length(v_delete_ids, 1) IS NULL THEN
    v_delete_ids := ARRAY[p_movement_id];
  END IF;

  -- حذف الإشعارات المرتبطة إن كان جدول الإشعارات موجوداً.
  IF to_regclass('public.movement_notifications') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'movement_notifications'
        AND column_name = 'movement_id'
    ) THEN
      EXECUTE 'DELETE FROM public.movement_notifications WHERE movement_id = ANY($1)'
      USING v_delete_ids;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'movement_notifications'
        AND column_name = 'related_movement_id'
    ) THEN
      EXECUTE 'DELETE FROM public.movement_notifications WHERE related_movement_id = ANY($1)'
      USING v_delete_ids;
    END IF;
  END IF;

  -- فك الارتباطات قبل الحذف لتفادي أي قيود self-reference غير متوقعة.
  UPDATE public.account_movements
  SET
    mirror_movement_id = CASE WHEN mirror_movement_id = ANY(v_delete_ids) THEN NULL ELSE mirror_movement_id END,
    related_transfer_id = CASE WHEN related_transfer_id = ANY(v_delete_ids) THEN NULL ELSE related_transfer_id END,
    related_commission_movement_id = CASE WHEN related_commission_movement_id = ANY(v_delete_ids) THEN NULL ELSE related_commission_movement_id END
  WHERE mirror_movement_id = ANY(v_delete_ids)
     OR related_transfer_id = ANY(v_delete_ids)
     OR related_commission_movement_id = ANY(v_delete_ids);

  DELETE FROM public.account_movements
  WHERE id = ANY(v_delete_ids);

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'deleted', true,
    'deleted_count', v_deleted_count,
    'movement_ids', v_delete_ids
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.force_delete_pending_movement(uuid, text) TO anon, authenticated;
