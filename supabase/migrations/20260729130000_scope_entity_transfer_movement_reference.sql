/*
  تضييق مطابقة operation_id على صاحب العملية أيضاً، لأن مفتاح منع
  التكرار فريد داخل المستخدم لا على مستوى جميع المستخدمين.
*/

BEGIN;

CREATE OR REPLACE FUNCTION public.set_entity_transfer_movement_reference()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transfer record;
  v_owner_user_id uuid;
BEGIN
  IF NEW.operation_group_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_owner_user_id := COALESCE(NEW.source_user_id, NEW.created_by_user_id);
  IF v_owner_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    et.transfer_number,
    et.debit_customer_id,
    et.credit_customer_id
  INTO v_transfer
  FROM public.entity_transfers et
  WHERE et.operation_id = NEW.operation_group_id
    AND et.user_id = v_owner_user_id
  LIMIT 1;

  IF v_transfer.transfer_number IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.customer_id = v_transfer.debit_customer_id THEN
    NEW.transfer_number := v_transfer.transfer_number || '-D';
  ELSIF NEW.customer_id = v_transfer.credit_customer_id THEN
    NEW.transfer_number := v_transfer.transfer_number || '-C';
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';

SELECT 'entity_transfer_movement_reference_scoped' AS status;
