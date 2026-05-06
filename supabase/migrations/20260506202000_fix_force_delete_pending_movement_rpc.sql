-- HOTFIX: إصلاح خطأ حذف الحركة المعلقة من التطبيق
-- Error fixed:
-- Could not find the function public.force_delete_pending_movement(p_movement_id, p_user_name) in the schema cache
--
-- ملاحظة مهمة:
-- التطبيق يرسل p_movement_id كقيمة نصية من React Native/Supabase RPC، لذلك ننشئ الدالة بتوقيع text,text
-- ونحذف أي توقيع قديم uuid,text حتى لا يحصل تعارض أو Cache ambiguity.

BEGIN;

DROP FUNCTION IF EXISTS public.force_delete_pending_movement(uuid, text);
DROP FUNCTION IF EXISTS public.force_delete_pending_movement(text, text);

CREATE OR REPLACE FUNCTION public.force_delete_pending_movement(
  p_movement_id text,
  p_user_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_movement_id uuid;
  v_actor_id uuid;
  v_movement public.account_movements%ROWTYPE;
  v_status text;
  v_delete_ids uuid[] := ARRAY[]::uuid[];
  v_deleted_count integer := 0;
BEGIN
  -- تحويل رقم الحركة من text إلى uuid حتى يتوافق مع القيمة القادمة من التطبيق.
  BEGIN
    v_movement_id := p_movement_id::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'رقم الحركة غير صحيح'
      );
  END;

  -- التأكد من أن المستخدم موجود ومفعل في جدول مستخدمي التطبيق.
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
  WHERE id = v_movement_id;

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
      'error', 'هذه الدالة مخصصة لحذف الحركات المعلقة فقط'
    );
  END IF;

  -- تجميع الحركة وأي حركة مرتبطة بها مثل mirror/transfer/commission حتى لا تبقى بيانات معلقة.
  SELECT array_agg(DISTINCT id)
  INTO v_delete_ids
  FROM public.account_movements
  WHERE id = v_movement_id
     OR id = v_movement.mirror_movement_id
     OR id = v_movement.related_transfer_id
     OR id = v_movement.related_commission_movement_id
     OR mirror_movement_id = v_movement_id
     OR related_transfer_id = v_movement_id
     OR related_commission_movement_id = v_movement_id;

  IF v_delete_ids IS NULL OR array_length(v_delete_ids, 1) IS NULL THEN
    v_delete_ids := ARRAY[v_movement_id];
  END IF;

  -- حذف إشعارات الموافقة/الحذف المرتبطة إن كان جدول الإشعارات موجوداً.
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

  -- فك الروابط قبل الحذف لتجنب قيود self-reference إن وجدت.
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

GRANT EXECUTE ON FUNCTION public.force_delete_pending_movement(text, text) TO anon, authenticated;

-- إجبار PostgREST/Supabase API على تحديث schema cache حتى يتعرف على الدالة الجديدة مباشرة.
NOTIFY pgrst, 'reload schema';

COMMIT;

-- اختبار سريع بعد التشغيل: يجب أن يرجع اسم الدالة وتوقيعها text,text
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_arguments(p.oid) AS arguments
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'force_delete_pending_movement';
