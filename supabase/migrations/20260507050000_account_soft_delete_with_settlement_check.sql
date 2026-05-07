/*
  # Account soft-delete with mandatory settlement

  Enforces three rules:
  1. A user cannot soft-delete their account while ANY balance with ANY
     counterparty customer is non-zero, or while any pending approval
     movement involves their customers.
  2. After soft-delete the user cannot log in (treated as "account does
     not exist"). Historical movements remain visible to counterparties.
  3. New movements involving a customer whose owner OR linked user is
     soft-deleted are rejected by a BEFORE INSERT trigger on
     account_movements.
*/

BEGIN;

-- 1. Add deleted_at column to app_security
ALTER TABLE app_security
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_app_security_deleted_at
  ON app_security(deleted_at)
  WHERE deleted_at IS NOT NULL;

-- 2. Helper: list unsettled balances for a user across all their customers
CREATE OR REPLACE FUNCTION get_user_unsettled_balances(p_user_id uuid)
RETURNS TABLE(
  customer_id uuid,
  customer_name text,
  linked_user_id uuid,
  currency text,
  balance numeric
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    cb.customer_id,
    cb.customer_name,
    c.linked_user_id,
    cb.currency,
    cb.balance
  FROM customer_balances_by_currency cb
  JOIN customers c ON c.id = cb.customer_id
  WHERE c.user_id = p_user_id
    AND COALESCE(c.is_profit_loss_account, false) = false
    AND ABS(cb.balance) > 0.005
  ORDER BY cb.customer_name, cb.currency;
$$;

-- 3. Helper: count pending approval movements involving the user's customers
CREATE OR REPLACE FUNCTION get_user_pending_movements_count(p_user_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT COUNT(*)::integer
  FROM account_movements am
  JOIN customers c ON c.id = am.customer_id
  WHERE c.user_id = p_user_id
    AND COALESCE(am.is_voided, false) = false
    AND COALESCE(am.approval_status, 'approved') = 'pending';
$$;

-- 4. Pre-flight check: returns reasons why deletion would fail (or empty if OK)
CREATE OR REPLACE FUNCTION check_user_can_be_deleted(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_name text;
  v_unsettled json;
  v_unsettled_count int;
  v_pending_count int;
BEGIN
  SELECT user_name INTO v_user_name
  FROM app_security
  WHERE id = p_user_id;

  IF v_user_name IS NULL THEN
    RETURN json_build_object(
      'can_delete', false,
      'code', 'USER_NOT_FOUND',
      'message', 'المستخدم غير موجود'
    );
  END IF;

  IF LOWER(v_user_name) = 'ali' THEN
    RETURN json_build_object(
      'can_delete', false,
      'code', 'PROTECTED',
      'message', 'لا يمكن حذف هذا الحساب'
    );
  END IF;

  SELECT COUNT(*)::int,
         COALESCE(json_agg(row_to_json(t)), '[]'::json)
    INTO v_unsettled_count, v_unsettled
  FROM get_user_unsettled_balances(p_user_id) t;

  v_pending_count := get_user_pending_movements_count(p_user_id);

  IF v_unsettled_count > 0 OR v_pending_count > 0 THEN
    RETURN json_build_object(
      'can_delete', false,
      'code', CASE WHEN v_unsettled_count > 0 THEN 'UNSETTLED_BALANCES' ELSE 'PENDING_MOVEMENTS' END,
      'message', CASE
        WHEN v_unsettled_count > 0
        THEN 'لا يمكن حذف الحساب قبل تصفية جميع الأرصدة مع الحسابات الأخرى'
        ELSE 'لديك حركات معلّقة بانتظار الموافقة. يجب إنهاؤها قبل الحذف'
      END,
      'unsettled_count', v_unsettled_count,
      'pending_count', v_pending_count,
      'unsettled', v_unsettled
    );
  END IF;

  RETURN json_build_object(
    'can_delete', true,
    'code', 'OK',
    'message', 'يمكن حذف الحساب'
  );
END;
$$;

-- 5. Soft-delete RPC: marks deleted_at + is_active = false (only after settlement)
CREATE OR REPLACE FUNCTION soft_delete_user_account(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_name text;
  v_check json;
BEGIN
  SELECT user_name INTO v_user_name
  FROM app_security
  WHERE id = p_user_id;

  IF v_user_name IS NULL THEN
    RETURN json_build_object('success', false, 'code', 'USER_NOT_FOUND', 'message', 'المستخدم غير موجود');
  END IF;

  -- Re-run the pre-flight check inside the same transaction to prevent races
  v_check := check_user_can_be_deleted(p_user_id);
  IF (v_check->>'can_delete')::boolean = false THEN
    RETURN json_build_object(
      'success', false,
      'code', v_check->>'code',
      'message', v_check->>'message',
      'details', v_check
    );
  END IF;

  UPDATE app_security
     SET deleted_at = NOW(),
         is_active  = false,
         updated_at = NOW()
   WHERE id = p_user_id;

  -- Audit trail (re-uses existing deletion_logs table)
  BEGIN
    INSERT INTO deletion_logs (operation_type, customer_id, customer_name, notes)
    VALUES ('soft_delete_user', p_user_id, v_user_name,
            'Account soft-deleted via settlement-enforced flow');
  EXCEPTION WHEN OTHERS THEN
    -- Log table shape may differ across environments; ignore log failures
    NULL;
  END;

  RETURN json_build_object(
    'success', true,
    'code', 'OK',
    'message', 'تم حذف الحساب بنجاح',
    'user_name', v_user_name
  );
END;
$$;

-- 6. BEFORE INSERT trigger on account_movements:
--    block any new movement on a customer whose owner OR linked user is soft-deleted
CREATE OR REPLACE FUNCTION check_no_deleted_user_in_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_owner_deleted   boolean := false;
  v_linked_deleted  boolean := false;
BEGIN
  IF NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    BOOL_OR(owner.deleted_at IS NOT NULL),
    BOOL_OR(linked.deleted_at IS NOT NULL)
  INTO v_owner_deleted, v_linked_deleted
  FROM customers c
  LEFT JOIN app_security owner  ON owner.id  = c.user_id
  LEFT JOIN app_security linked ON linked.id = c.linked_user_id
  WHERE c.id = NEW.customer_id;

  IF v_owner_deleted OR v_linked_deleted THEN
    RAISE EXCEPTION 'هذا الحساب غير موجود' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_no_deleted_user_in_movement ON account_movements;
CREATE TRIGGER trg_check_no_deleted_user_in_movement
  BEFORE INSERT ON account_movements
  FOR EACH ROW
  EXECUTE FUNCTION check_no_deleted_user_in_movement();

-- 7. Grants
GRANT EXECUTE ON FUNCTION get_user_unsettled_balances(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_user_pending_movements_count(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION check_user_can_be_deleted(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION soft_delete_user_account(uuid) TO anon, authenticated;

COMMIT;
