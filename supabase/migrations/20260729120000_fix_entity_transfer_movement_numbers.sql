/*
  لكل حوالة سجل رئيسي واحد، لكن لها قيدان في account_movements.
  وحيث إن account_movements.transfer_number فريد، يحصل كل قيد على مرجع
  مشتق وفريد مع بقاء رقم الحوالة الرئيسي كما هو في entity_transfers:

    القيد المدين:  <رقم الحوالة>-D
    القيد الدائن:  <رقم الحوالة>-C
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
BEGIN
  IF NEW.operation_group_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    et.transfer_number,
    et.debit_customer_id,
    et.credit_customer_id
  INTO v_transfer
  FROM public.entity_transfers et
  WHERE et.operation_id = NEW.operation_group_id
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

DROP TRIGGER IF EXISTS trg_set_entity_transfer_movement_reference
  ON public.account_movements;

CREATE TRIGGER trg_set_entity_transfer_movement_reference
  BEFORE INSERT ON public.account_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.set_entity_transfer_movement_reference();

COMMIT;

NOTIFY pgrst, 'reload schema';

SELECT 'entity_transfer_movement_numbers_fixed' AS status;
