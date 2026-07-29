/*
  Secure the entity-transfer module for the Supabase Auth model.

  The application has used Supabase Auth since 20260515120000, so a
  client-supplied p_user_id must never be treated as proof of identity.
  This migration:

  - scopes the new module tables to auth.uid();
  - makes entity_transfers read-only to clients so its accounting snapshot
    can only be created atomically by the RPC;
  - wraps the two user-scoped RPCs with an auth.uid() ownership check; and
  - removes direct client access to internal account-creation helpers.
*/

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Tenant-scoped RLS for the module's client-managed tables.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow read access to transfer entities"
  ON public.transfer_entities;
DROP POLICY IF EXISTS "Allow insert access to transfer entities"
  ON public.transfer_entities;
DROP POLICY IF EXISTS "Allow update access to transfer entities"
  ON public.transfer_entities;
DROP POLICY IF EXISTS "Allow delete access to transfer entities"
  ON public.transfer_entities;

CREATE POLICY "Users can read their transfer entities"
  ON public.transfer_entities
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "Users can insert their transfer entities"
  ON public.transfer_entities
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "Users can update their transfer entities"
  ON public.transfer_entities
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "Users can delete their transfer entities"
  ON public.transfer_entities
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

REVOKE ALL PRIVILEGES ON TABLE public.transfer_entities FROM anon;
REVOKE INSERT, UPDATE ON TABLE public.transfer_entities FROM authenticated;
GRANT SELECT, DELETE ON TABLE public.transfer_entities TO authenticated;
GRANT INSERT (
  user_id,
  name,
  entity_type,
  phone,
  address,
  notes,
  is_active
) ON public.transfer_entities TO authenticated;
GRANT UPDATE (
  name,
  entity_type,
  phone,
  address,
  notes,
  is_active
) ON public.transfer_entities TO authenticated;

-- The settlement marker controls quota counting and customer visibility.
-- A normal client must not be able to turn an arbitrary customer into a
-- hidden system account. SECURITY DEFINER lifecycle helpers still run as
-- their owner and may set the marker when creating a real settlement row.
CREATE OR REPLACE FUNCTION public.protect_entity_settlement_account_marker()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT'
       AND COALESCE(NEW.is_entity_settlement_account, false) THEN
      RAISE EXCEPTION 'لا يمكن إنشاء حساب تسوية نظامي مباشرة'
        USING ERRCODE = '42501';
    END IF;

    IF TG_OP = 'UPDATE'
       AND NEW.is_entity_settlement_account
           IS DISTINCT FROM OLD.is_entity_settlement_account THEN
      RAISE EXCEPTION 'لا يمكن تغيير علامة حساب التسوية مباشرة'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_entity_settlement_marker_insert
  ON public.customers;
CREATE TRIGGER trg_protect_entity_settlement_marker_insert
  BEFORE INSERT ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_entity_settlement_account_marker();

DROP TRIGGER IF EXISTS trg_protect_entity_settlement_marker_update
  ON public.customers;
CREATE TRIGGER trg_protect_entity_settlement_marker_update
  BEFORE UPDATE OF is_entity_settlement_account ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_entity_settlement_account_marker();

DROP POLICY IF EXISTS "Allow read access to transfer commission rules"
  ON public.transfer_commission_rules;
DROP POLICY IF EXISTS "Allow insert access to transfer commission rules"
  ON public.transfer_commission_rules;
DROP POLICY IF EXISTS "Allow update access to transfer commission rules"
  ON public.transfer_commission_rules;
DROP POLICY IF EXISTS "Allow delete access to transfer commission rules"
  ON public.transfer_commission_rules;

CREATE POLICY "Users can read their transfer commission rules"
  ON public.transfer_commission_rules
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "Users can insert their transfer commission rules"
  ON public.transfer_commission_rules
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "Users can update their transfer commission rules"
  ON public.transfer_commission_rules
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "Users can delete their transfer commission rules"
  ON public.transfer_commission_rules
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

REVOKE ALL PRIVILEGES ON TABLE public.transfer_commission_rules FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.transfer_commission_rules TO authenticated;

-- entity_transfers is an accounting snapshot. Clients may read their rows,
-- but only create_entity_transfer may insert or update them.
DROP POLICY IF EXISTS "Allow read access to entity transfers"
  ON public.entity_transfers;
DROP POLICY IF EXISTS "Allow insert access to entity transfers"
  ON public.entity_transfers;
DROP POLICY IF EXISTS "Allow update access to entity transfers"
  ON public.entity_transfers;

CREATE POLICY "Users can read their entity transfers"
  ON public.entity_transfers
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

REVOKE ALL PRIVILEGES ON TABLE public.entity_transfers FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.entity_transfers FROM authenticated;
GRANT SELECT ON TABLE public.entity_transfers TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Keep the existing atomic implementation private and expose an
--    authenticated wrapper that proves p_user_id ownership first.
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.create_entity_transfer(
  uuid, uuid, uuid, text, text, text, text, text, numeric, text, uuid, uuid,
  text, boolean, uuid, numeric, numeric
)
RENAME TO create_entity_transfer_unchecked;

REVOKE ALL PRIVILEGES ON FUNCTION public.create_entity_transfer_unchecked(
  uuid, uuid, uuid, text, text, text, text, text, numeric, text, uuid, uuid,
  text, boolean, uuid, numeric, numeric
) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.create_entity_transfer(
  p_operation_id uuid,
  p_user_id uuid,
  p_entity_id uuid,
  p_direction text,
  p_sender_name text,
  p_sender_phone text,
  p_beneficiary_name text,
  p_beneficiary_phone text,
  p_amount numeric,
  p_currency text,
  p_debit_customer_id uuid,
  p_credit_customer_id uuid,
  p_notes text DEFAULT NULL,
  p_commission_enabled boolean DEFAULT false,
  p_commission_rule_id uuid DEFAULT NULL,
  p_customer_commission numeric DEFAULT NULL,
  p_network_commission numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_authenticated_user_id uuid := auth.uid();
BEGIN
  IF v_authenticated_user_id IS NULL
     OR p_user_id IS DISTINCT FROM v_authenticated_user_id THEN
    RAISE EXCEPTION 'غير مصرح بإنشاء حوالة لهذا المستخدم'
      USING ERRCODE = '42501';
  END IF;

  RETURN public.create_entity_transfer_unchecked(
    p_operation_id,
    p_user_id,
    p_entity_id,
    p_direction,
    p_sender_name,
    p_sender_phone,
    p_beneficiary_name,
    p_beneficiary_phone,
    p_amount,
    p_currency,
    p_debit_customer_id,
    p_credit_customer_id,
    p_notes,
    p_commission_enabled,
    p_commission_rule_id,
    p_customer_commission,
    p_network_commission
  );
END;
$$;

REVOKE ALL PRIVILEGES ON FUNCTION public.create_entity_transfer(
  uuid, uuid, uuid, text, text, text, text, text, numeric, text, uuid, uuid,
  text, boolean, uuid, numeric, numeric
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_entity_transfer(
  uuid, uuid, uuid, text, text, text, text, text, numeric, text, uuid, uuid,
  text, boolean, uuid, numeric, numeric
) TO authenticated;

-- Quote lookup also contains tenant-private rule data and accepts p_user_id.
ALTER FUNCTION public.get_matching_transfer_commission_rule(
  uuid, text, text, numeric
)
RENAME TO get_matching_transfer_commission_rule_unchecked;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.get_matching_transfer_commission_rule_unchecked(
    uuid, text, text, numeric
  )
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.get_matching_transfer_commission_rule(
  p_user_id uuid,
  p_direction text,
  p_currency text,
  p_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_authenticated_user_id uuid := auth.uid();
BEGIN
  IF v_authenticated_user_id IS NULL
     OR p_user_id IS DISTINCT FROM v_authenticated_user_id THEN
    RAISE EXCEPTION 'غير مصرح بقراءة قواعد عمولة هذا المستخدم'
      USING ERRCODE = '42501';
  END IF;

  RETURN public.get_matching_transfer_commission_rule_unchecked(
    p_user_id,
    p_direction,
    p_currency,
    p_amount
  );
END;
$$;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.get_matching_transfer_commission_rule(
    uuid, text, text, numeric
  )
  FROM PUBLIC, anon;

GRANT EXECUTE
  ON FUNCTION public.get_matching_transfer_commission_rule(
    uuid, text, text, numeric
  )
  TO authenticated;

-- These are implementation helpers, not public client RPCs.
REVOKE ALL PRIVILEGES
  ON FUNCTION public.ensure_entity_settlement_account(uuid)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.ensure_profit_loss_account_for_user(uuid)
  FROM PUBLIC, anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

SELECT 'entity_transfer_access_secured' AS status;
