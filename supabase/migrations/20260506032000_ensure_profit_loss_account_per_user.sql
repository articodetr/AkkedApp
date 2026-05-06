/*
  Ensure every user has a private profit/loss account.

  The account is owned by exactly one user through customers.user_id and is
  never shared globally.
*/

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS only_one_profit_loss_account;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS is_profit_loss_account boolean NOT NULL DEFAULT false;

-- Old shared profit/loss accounts must not remain active without an owner.
UPDATE public.customers c
   SET is_profit_loss_account = false,
       name = CASE
         WHEN c.name = 'الأرباح والخسائر' THEN 'الأرباح والخسائر (قديم)'
         ELSE c.name
       END
WHERE COALESCE(c.is_profit_loss_account, false) = true
  AND c.user_id IS NULL;

-- Keep the first profit/loss account per user, then enforce one per owner.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id
      ORDER BY created_at NULLS FIRST, id
    ) AS rn
  FROM public.customers
  WHERE COALESCE(is_profit_loss_account, false) = true
    AND user_id IS NOT NULL
)
UPDATE public.customers c
   SET is_profit_loss_account = false,
       name = CASE
         WHEN c.name = 'الأرباح والخسائر' THEN 'الأرباح والخسائر (قديم)'
         ELSE c.name
       END
FROM ranked r
WHERE c.id = r.id
  AND r.rn > 1;

DROP INDEX IF EXISTS public.customers_one_profit_loss_per_user_idx;
CREATE UNIQUE INDEX IF NOT EXISTS customers_one_profit_loss_per_user_idx
  ON public.customers (user_id)
  WHERE COALESCE(is_profit_loss_account, false) = true;

CREATE OR REPLACE FUNCTION public.ensure_profit_loss_account_for_user(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_phone text;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT c.id
    INTO v_id
  FROM public.customers c
  WHERE c.user_id = p_user_id
    AND COALESCE(c.is_profit_loss_account, false) = true
  ORDER BY c.created_at NULLS FIRST, c.id
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  v_phone := 'PROFIT_LOSS_' || replace(p_user_id::text, '-', '_');

  INSERT INTO public.customers (
    name,
    phone,
    user_id,
    is_profit_loss_account,
    notes,
    created_at,
    updated_at
  ) VALUES (
    'الأرباح والخسائر',
    v_phone,
    p_user_id,
    true,
    'حساب نظام ثابت وخاص بهذا المستخدم',
    now(),
    now()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.ensure_profit_loss_account_for_user(uuid)
IS 'Ensures that a user has exactly one private profit/loss customer account.';

CREATE OR REPLACE FUNCTION public.get_profit_loss_account_id()
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.ensure_profit_loss_account_for_user(auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.get_profit_loss_account_id(p_user_id uuid)
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.ensure_profit_loss_account_for_user(p_user_id);
$$;

GRANT EXECUTE ON FUNCTION public.ensure_profit_loss_account_for_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_profit_loss_account_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_profit_loss_account_id(uuid) TO authenticated;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id AS user_id
    FROM public.app_security
    WHERE id IS NOT NULL
  LOOP
    PERFORM public.ensure_profit_loss_account_for_user(r.user_id);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.ensure_profit_loss_account_after_user_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.ensure_profit_loss_account_for_user(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_profit_loss_account_after_user_insert ON public.app_security;
CREATE TRIGGER trg_ensure_profit_loss_account_after_user_insert
AFTER INSERT ON public.app_security
FOR EACH ROW
EXECUTE FUNCTION public.ensure_profit_loss_account_after_user_insert();
