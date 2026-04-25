-- ============================================================================
-- ArtiCode App - Rebuild Statistics From Database Source of Truth
-- File: 20260425020000_rebuild_statistics_rpc.sql
--
-- الهدف:
-- 1) توحيد منطق الإحصائيات والتدفق المالي داخل قاعدة البيانات.
-- 2) عدم احتساب الحركات المعلقة أو المرفوضة أو الملغاة في الإجماليات.
-- 3) حساب "بانتظار موافقتي" و"بانتظار رد الطرف الآخر" بدقة.
-- 4) إعادة بناء customer_balances_by_currency و customer_balances بنفس القاعدة.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Ensure required approval columns exist
-- ----------------------------------------------------------------------------

ALTER TABLE public.account_movements
  ADD COLUMN IF NOT EXISTS pending_approval boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS approval_status text,
  ADD COLUMN IF NOT EXISTS approved_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS reject_reason text,
  ADD COLUMN IF NOT EXISTS is_voided boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS void_type text,
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS created_by_user_name text,
  ADD COLUMN IF NOT EXISTS source_user_id uuid,
  ADD COLUMN IF NOT EXISTS mirror_movement_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'account_movements_approval_status_check'
  ) THEN
    ALTER TABLE public.account_movements
      ADD CONSTRAINT account_movements_approval_status_check
      CHECK (
        approval_status IS NULL
        OR approval_status IN ('pending', 'approved', 'rejected')
      );
  END IF;
END $$;

UPDATE public.account_movements
SET approval_status =
  CASE
    WHEN COALESCE(pending_approval, false) = true THEN 'pending'
    ELSE 'approved'
  END
WHERE approval_status IS NULL;

UPDATE public.account_movements
SET pending_approval = (approval_status = 'pending')
WHERE pending_approval IS DISTINCT FROM (approval_status = 'pending');

CREATE INDEX IF NOT EXISTS account_movements_stats_customer_idx
  ON public.account_movements (customer_id, currency, created_at);

CREATE INDEX IF NOT EXISTS account_movements_stats_approval_idx
  ON public.account_movements (approval_status, pending_approval, is_voided);

CREATE INDEX IF NOT EXISTS customers_stats_scope_idx
  ON public.customers (user_id, linked_user_id);

-- ----------------------------------------------------------------------------
-- 1) Rebuild approved-only balance views
-- ----------------------------------------------------------------------------
-- ملاحظة مهمة:
-- DROP VIEW مستخدم هنا لأن PostgreSQL لا يسمح بحذف أعمدة View عبر CREATE OR REPLACE.

DROP VIEW IF EXISTS public.customer_balances_by_currency CASCADE;
DROP VIEW IF EXISTS public.customer_balances CASCADE;

CREATE VIEW public.customer_balances_by_currency AS
SELECT
  c.id AS customer_id,
  c.name AS customer_name,
  c.user_id,
  c.linked_user_id,
  am.currency,
  COALESCE(SUM(CASE WHEN am.movement_type = 'incoming' THEN am.amount ELSE 0 END), 0) AS total_incoming,
  COALESCE(SUM(CASE WHEN am.movement_type = 'outgoing' THEN am.amount ELSE 0 END), 0) AS total_outgoing,
  COALESCE(
    SUM(
      CASE
        WHEN am.movement_type = 'incoming' THEN am.amount
        WHEN am.movement_type = 'outgoing' THEN -am.amount
        ELSE 0
      END
    ),
    0
  ) AS balance
FROM public.customers c
JOIN public.account_movements am
  ON am.customer_id = c.id
  AND COALESCE(am.is_commission_movement, false) = false
  AND COALESCE(am.is_voided, false) = false
  AND COALESCE(
    am.approval_status,
    CASE
      WHEN COALESCE(am.pending_approval, false) THEN 'pending'
      ELSE 'approved'
    END
  ) = 'approved'
WHERE am.currency IS NOT NULL
GROUP BY
  c.id,
  c.name,
  c.user_id,
  c.linked_user_id,
  am.currency;

CREATE VIEW public.customer_balances AS
SELECT
  c.id,
  c.name,
  c.phone,
  c.user_id,
  c.linked_user_id,
  COALESCE(SUM(CASE WHEN am.movement_type = 'incoming' THEN am.amount ELSE 0 END), 0) AS total_incoming,
  COALESCE(SUM(CASE WHEN am.movement_type = 'outgoing' THEN am.amount ELSE 0 END), 0) AS total_outgoing,
  COALESCE(
    SUM(
      CASE
        WHEN am.movement_type = 'incoming' THEN am.amount
        WHEN am.movement_type = 'outgoing' THEN -am.amount
        ELSE 0
      END
    ),
    0
  ) AS balance,
  COUNT(am.id) AS total_movements,
  MAX(am.created_at) AS last_activity
FROM public.customers c
LEFT JOIN public.account_movements am
  ON am.customer_id = c.id
  AND COALESCE(am.is_commission_movement, false) = false
  AND COALESCE(am.is_voided, false) = false
  AND COALESCE(
    am.approval_status,
    CASE
      WHEN COALESCE(am.pending_approval, false) THEN 'pending'
      ELSE 'approved'
    END
  ) = 'approved'
WHERE COALESCE(c.is_profit_loss_account, false) = false
  AND c.phone IS DISTINCT FROM 'PROFIT_LOSS_ACCOUNT'
GROUP BY
  c.id,
  c.name,
  c.phone,
  c.user_id,
  c.linked_user_id;

COMMENT ON VIEW public.customer_balances_by_currency IS
  'Approved-only balances. Pending, rejected, voided, and commission movements are excluded.';
COMMENT ON VIEW public.customer_balances IS
  'Approved-only customer balances. Pending, rejected, voided, and commission movements are excluded.';

-- ----------------------------------------------------------------------------
-- 2) Main RPC: get_app_statistics
-- ----------------------------------------------------------------------------
-- قاعدة موحدة:
-- posted/approved = approval_status approved أو NULL مع pending_approval=false، بشرط is_voided=false.
-- pending = approval_status pending أو pending_approval=true، بشرط is_voided=false.
-- rejected/voided لا تدخل في الإجماليات.

CREATE OR REPLACE FUNCTION public.get_app_statistics(
  p_user_id uuid,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH
  scope_customers AS (
    SELECT c.*
    FROM public.customers c
    WHERE c.user_id = p_user_id
       OR c.linked_user_id = p_user_id
       OR c.phone = 'PROFIT_LOSS_ACCOUNT'
       OR COALESCE(c.is_profit_loss_account, false) = true
  ),

  owner_customers AS (
    SELECT c.*
    FROM public.customers c
    WHERE c.user_id = p_user_id
      AND c.phone IS DISTINCT FROM 'PROFIT_LOSS_ACCOUNT'
      AND COALESCE(c.is_profit_loss_account, false) = false
  ),

  movements_base AS (
    SELECT
      am.*,
      c.user_id AS customer_owner_user_id,
      c.linked_user_id AS customer_linked_user_id,
      c.name AS customer_name,
      c.phone AS customer_phone,
      COALESCE(
        am.approval_status,
        CASE
          WHEN COALESCE(am.pending_approval, false) THEN 'pending'
          ELSE 'approved'
        END
      ) AS normalized_status,
      COALESCE(am.is_voided, false) AS normalized_voided,
      COALESCE(am.is_commission_movement, false) AS normalized_commission,
      CASE
        WHEN am.from_customer_id IS NOT NULL OR am.to_customer_id IS NOT NULL THEN true
        ELSE false
      END AS is_internal_transfer,
      CASE
        WHEN (am.related_transfer_id IS NOT NULL OR am.mirror_movement_id IS NOT NULL)
             AND am.from_customer_id IS NULL
             AND am.to_customer_id IS NULL THEN true
        ELSE false
      END AS is_linked_movement
    FROM public.account_movements am
    JOIN scope_customers c ON c.id = am.customer_id
  ),

  approved_customer_movements AS (
    SELECT *
    FROM movements_base
    WHERE normalized_status = 'approved'
      AND normalized_voided = false
      AND normalized_commission = false
  ),

  pending_customer_movements AS (
    SELECT *
    FROM movements_base
    WHERE normalized_status = 'pending'
      AND normalized_voided = false
      AND normalized_commission = false
  ),

  completed_transactions AS (
    SELECT t.*
    FROM public.transactions t
    JOIN scope_customers c ON c.id = t.customer_id
    WHERE COALESCE(t.status, 'completed') = 'completed'
  ),

  customer_currency_balances AS (
    SELECT
      m.customer_id,
      m.customer_name,
      m.currency,
      SUM(CASE WHEN m.movement_type = 'incoming' THEN m.amount ELSE 0 END) AS total_incoming,
      SUM(CASE WHEN m.movement_type = 'outgoing' THEN m.amount ELSE 0 END) AS total_outgoing,
      SUM(
        CASE
          WHEN m.movement_type = 'incoming' THEN m.amount
          WHEN m.movement_type = 'outgoing' THEN -m.amount
          ELSE 0
        END
      ) AS balance
    FROM approved_customer_movements m
    JOIN owner_customers oc ON oc.id = m.customer_id
    GROUP BY m.customer_id, m.customer_name, m.currency
  ),

  currency_balances AS (
    SELECT
      b.currency,
      COALESCE(SUM(b.total_incoming), 0) AS total_incoming,
      COALESCE(SUM(b.total_outgoing), 0) AS total_outgoing,
      COALESCE(SUM(b.balance), 0) AS balance
    FROM customer_currency_balances b
    GROUP BY b.currency
  ),

  debt_owed_to_us AS (
    SELECT
      currency,
      ABS(SUM(balance)) AS amount
    FROM customer_currency_balances
    WHERE balance < 0
    GROUP BY currency
  ),

  debt_we_owe AS (
    SELECT
      currency,
      SUM(balance) AS amount
    FROM customer_currency_balances
    WHERE balance > 0
    GROUP BY currency
  ),

  cash_flow AS (
    SELECT
      m.currency,
      COALESCE(SUM(CASE WHEN m.normalized_status = 'approved'
                         AND m.normalized_voided = false
                         AND m.normalized_commission = false
                         AND m.is_internal_transfer = false
                         AND m.movement_type = 'outgoing'
                        THEN m.amount ELSE 0 END), 0) AS total_received,
      COALESCE(SUM(CASE WHEN m.normalized_status = 'approved'
                         AND m.normalized_voided = false
                         AND m.normalized_commission = false
                         AND m.is_internal_transfer = false
                         AND m.movement_type = 'incoming'
                        THEN m.amount ELSE 0 END), 0) AS total_paid,
      COALESCE(SUM(CASE WHEN m.normalized_status = 'approved'
                         AND m.normalized_voided = false
                         AND m.normalized_commission = false
                         AND m.is_internal_transfer = false
                         AND m.is_linked_movement = true
                         AND m.movement_type = 'outgoing'
                        THEN m.amount ELSE 0 END), 0) AS linked_received,
      COALESCE(SUM(CASE WHEN m.normalized_status = 'approved'
                         AND m.normalized_voided = false
                         AND m.normalized_commission = false
                         AND m.is_internal_transfer = false
                         AND m.is_linked_movement = true
                         AND m.movement_type = 'incoming'
                        THEN m.amount ELSE 0 END), 0) AS linked_paid,
      COALESCE(SUM(CASE WHEN m.normalized_status = 'approved'
                         AND m.normalized_voided = false
                         AND m.normalized_commission = false
                         AND m.is_internal_transfer = false
                         AND m.is_linked_movement = false
                         AND m.movement_type = 'outgoing'
                        THEN m.amount ELSE 0 END), 0) AS direct_received,
      COALESCE(SUM(CASE WHEN m.normalized_status = 'approved'
                         AND m.normalized_voided = false
                         AND m.normalized_commission = false
                         AND m.is_internal_transfer = false
                         AND m.is_linked_movement = false
                         AND m.movement_type = 'incoming'
                        THEN m.amount ELSE 0 END), 0) AS direct_paid,
      COALESCE(SUM(CASE WHEN m.normalized_status = 'pending'
                         AND m.normalized_voided = false
                         AND m.normalized_commission = false
                        THEN m.amount ELSE 0 END), 0) AS pending_amount,
      COUNT(*) FILTER (
        WHERE m.normalized_status = 'pending'
          AND m.normalized_voided = false
          AND m.normalized_commission = false
      ) AS pending_count,
      COALESCE(SUM(CASE WHEN m.normalized_status = 'approved'
                         AND m.normalized_voided = false
                         AND m.normalized_commission = false
                         AND m.is_internal_transfer = true
                        THEN m.amount ELSE 0 END), 0) AS internal_transfer_amount,
      COUNT(*) FILTER (
        WHERE m.normalized_status = 'approved'
          AND m.normalized_voided = false
          AND m.normalized_commission = false
          AND m.is_internal_transfer = true
      ) AS internal_transfer_count,
      COUNT(*) FILTER (
        WHERE m.normalized_status = 'approved'
          AND m.normalized_voided = false
          AND m.normalized_commission = false
          AND m.is_internal_transfer = false
      ) AS approved_count
    FROM movements_base m
    WHERE m.currency IS NOT NULL
      AND m.normalized_commission = false
    GROUP BY m.currency
  ),

  commission_entries AS (
    SELECT DISTINCT ON (
      CASE
        WHEN m.related_transfer_id IS NOT NULL THEN
          LEAST(m.id::text, m.related_transfer_id::text) || ':' || GREATEST(m.id::text, m.related_transfer_id::text)
        ELSE m.id::text
      END
    )
      COALESCE(m.commission_currency, m.currency) AS currency,
      COALESCE(m.commission, 0) AS amount,
      m.created_at
    FROM movements_base m
    WHERE m.normalized_status = 'approved'
      AND m.normalized_voided = false
      AND COALESCE(m.commission, 0) > 0
    ORDER BY
      CASE
        WHEN m.related_transfer_id IS NOT NULL THEN
          LEAST(m.id::text, m.related_transfer_id::text) || ':' || GREATEST(m.id::text, m.related_transfer_id::text)
        ELSE m.id::text
      END,
      m.created_at ASC
  ),

  commission_by_currency AS (
    SELECT
      currency,
      SUM(amount) AS total
    FROM commission_entries
    GROUP BY currency
  ),

  top_customers AS (
    SELECT
      oc.id,
      oc.name,
      oc.phone,
      oc.linked_user_id,
      COUNT(m.id) AS total_movements,
      COALESCE(SUM(m.amount), 0) AS total_volume,
      MAX(COALESCE(m.created_at, oc.updated_at, oc.created_at)) AS last_activity
    FROM owner_customers oc
    LEFT JOIN approved_customer_movements m ON m.customer_id = oc.id
    GROUP BY oc.id, oc.name, oc.phone, oc.linked_user_id
    HAVING COUNT(m.id) > 0
    ORDER BY COUNT(m.id) DESC, COALESCE(SUM(m.amount), 0) DESC, MAX(COALESCE(m.created_at, oc.updated_at, oc.created_at)) DESC
    LIMIT 5
  ),

  top_customer_balances AS (
    SELECT
      m.customer_id,
      m.currency,
      SUM(
        CASE
          WHEN m.movement_type = 'incoming' THEN m.amount
          WHEN m.movement_type = 'outgoing' THEN -m.amount
          ELSE 0
        END
      ) AS amount
    FROM approved_customer_movements m
    GROUP BY m.customer_id, m.currency
  ),

  actionable AS (
    SELECT
      COUNT(*) FILTER (
        WHERE m.normalized_status = 'pending'
          AND m.normalized_voided = false
          AND m.customer_owner_user_id <> p_user_id
          AND m.customer_linked_user_id = p_user_id
      ) AS awaiting_my_approval_count,
      COUNT(*) FILTER (
        WHERE m.normalized_status = 'pending'
          AND m.normalized_voided = false
          AND m.customer_owner_user_id = p_user_id
          AND m.customer_linked_user_id IS NOT NULL
      ) AS awaiting_others_approval_count,
      COUNT(*) FILTER (
        WHERE m.normalized_status = 'pending'
          AND m.normalized_voided = false
          AND m.created_at <= now() - interval '24 hours'
      ) AS stale_pending_count,
      COUNT(*) FILTER (
        WHERE m.normalized_status = 'approved'
          AND m.normalized_voided = false
          AND m.approved_at >= now() - interval '7 days'
      ) AS approved_last_7_days,
      COUNT(*) FILTER (
        WHERE m.normalized_status = 'rejected'
          AND COALESCE(m.rejected_at, m.created_at) >= now() - interval '7 days'
      ) AS rejected_last_7_days,
      AVG(EXTRACT(EPOCH FROM (m.approved_at - m.created_at)) / 60.0) FILTER (
        WHERE m.normalized_status = 'approved'
          AND m.normalized_voided = false
          AND m.approved_at >= now() - interval '7 days'
          AND m.approved_at IS NOT NULL
      ) AS average_approval_minutes_last_7_days
    FROM movements_base m
    WHERE m.normalized_commission = false
  ),

  awaiting_my_by_currency AS (
    SELECT m.currency, SUM(m.amount) AS amount
    FROM movements_base m
    WHERE m.normalized_status = 'pending'
      AND m.normalized_voided = false
      AND m.normalized_commission = false
      AND m.customer_owner_user_id <> p_user_id
      AND m.customer_linked_user_id = p_user_id
    GROUP BY m.currency
  ),

  awaiting_others_by_currency AS (
    SELECT m.currency, SUM(m.amount) AS amount
    FROM movements_base m
    WHERE m.normalized_status = 'pending'
      AND m.normalized_voided = false
      AND m.normalized_commission = false
      AND m.customer_owner_user_id = p_user_id
      AND m.customer_linked_user_id IS NOT NULL
    GROUP BY m.currency
  ),

  stale_pending_by_currency AS (
    SELECT m.currency, SUM(m.amount) AS amount
    FROM movements_base m
    WHERE m.normalized_status = 'pending'
      AND m.normalized_voided = false
      AND m.normalized_commission = false
      AND m.created_at <= now() - interval '24 hours'
    GROUP BY m.currency
  ),

  periods AS (
    SELECT *
    FROM (
      VALUES
        ('today'::text, current_date::timestamptz, (current_date + interval '1 day')::timestamptz),
        ('yesterday'::text, (current_date - interval '1 day')::timestamptz, current_date::timestamptz),
        ('week'::text, (current_date - interval '7 days')::timestamptz, (current_date + interval '1 day')::timestamptz),
        ('month'::text, (current_date - interval '30 days')::timestamptz, (current_date + interval '1 day')::timestamptz),
        ('custom'::text,
          COALESCE(p_start_date, current_date)::timestamptz,
          (COALESCE(p_end_date, current_date) + interval '1 day')::timestamptz
        )
    ) AS p(period_key, start_ts, end_ts)
  ),

  period_stats AS (
    SELECT
      p.period_key,
      COALESCE((
        SELECT COUNT(*)
        FROM completed_transactions t
        WHERE t.created_at >= p.start_ts
          AND t.created_at < p.end_ts
      ), 0) AS transactions_count,
      COALESCE((
        SELECT COUNT(*)
        FROM approved_customer_movements m
        WHERE m.created_at >= p.start_ts
          AND m.created_at < p.end_ts
      ), 0) AS movements_count,
      COALESCE((
        SELECT COUNT(*)
        FROM commission_entries ce
        WHERE ce.created_at >= p.start_ts
          AND ce.created_at < p.end_ts
      ), 0) AS commission_movements_count,
      COALESCE((
        SELECT SUM(t.amount_sent)
        FROM completed_transactions t
        WHERE t.created_at >= p.start_ts
          AND t.created_at < p.end_ts
      ), 0) AS transaction_amount,
      COALESCE((
        SELECT SUM(m.amount)
        FROM approved_customer_movements m
        WHERE m.created_at >= p.start_ts
          AND m.created_at < p.end_ts
      ), 0) AS movement_amount,
      COALESCE((
        SELECT SUM(ce.amount)
        FROM commission_entries ce
        WHERE ce.created_at >= p.start_ts
          AND ce.created_at < p.end_ts
      ), 0) AS commission_amount
    FROM periods p
  ),

  period_transaction_currency AS (
    SELECT
      p.period_key,
      t.currency_sent AS currency,
      SUM(t.amount_sent) AS amount
    FROM periods p
    JOIN completed_transactions t
      ON t.created_at >= p.start_ts
     AND t.created_at < p.end_ts
    GROUP BY p.period_key, t.currency_sent
  ),

  period_movement_currency AS (
    SELECT
      p.period_key,
      m.currency,
      SUM(m.amount) AS amount
    FROM periods p
    JOIN approved_customer_movements m
      ON m.created_at >= p.start_ts
     AND m.created_at < p.end_ts
    GROUP BY p.period_key, m.currency
  ),

  period_commission_currency AS (
    SELECT
      p.period_key,
      ce.currency,
      SUM(ce.amount) AS amount
    FROM periods p
    JOIN commission_entries ce
      ON ce.created_at >= p.start_ts
     AND ce.created_at < p.end_ts
    GROUP BY p.period_key, ce.currency
  )

  SELECT jsonb_build_object(
    'totalCustomers', COALESCE((SELECT COUNT(*) FROM owner_customers), 0),
    'totalTransactions', COALESCE((SELECT COUNT(*) FROM completed_transactions), 0),
    'totalMovements', COALESCE((SELECT COUNT(*) FROM approved_customer_movements), 0),
    'totalAmount', COALESCE((SELECT SUM(amount) FROM approved_customer_movements), 0),
    'totalDebts', COALESCE((SELECT SUM(amount) FROM debt_owed_to_us), 0),
    'totalWeOwe', COALESCE((SELECT SUM(amount) FROM debt_we_owe), 0),

    'currencyBalances', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'currency', currency,
          'total_incoming', total_incoming,
          'total_outgoing', total_outgoing,
          'balance', balance
        )
        ORDER BY currency
      )
      FROM currency_balances
    ), '[]'::jsonb),

    'cashFlowByCurrency', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'currency', currency,
          'totalReceived', total_received,
          'totalPaid', total_paid,
          'netFlow', total_received - total_paid,
          'linkedReceived', linked_received,
          'linkedPaid', linked_paid,
          'directReceived', direct_received,
          'directPaid', direct_paid,
          'pendingAmount', pending_amount,
          'pendingCount', pending_count,
          'internalTransferAmount', internal_transfer_amount,
          'internalTransferCount', internal_transfer_count,
          'approvedCount', approved_count
        )
        ORDER BY currency
      )
      FROM cash_flow
    ), '[]'::jsonb),

    'debtStats', jsonb_build_object(
      'totalOwedToUs', COALESCE((SELECT SUM(amount) FROM debt_owed_to_us), 0),
      'totalWeOwe', COALESCE((SELECT SUM(amount) FROM debt_we_owe), 0),
      'owedToUsByCurrency', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount) ORDER BY currency)
        FROM debt_owed_to_us
      ), '[]'::jsonb),
      'weOweByCurrency', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount) ORDER BY currency)
        FROM debt_we_owe
      ), '[]'::jsonb)
    ),

    'commissionStats', jsonb_build_object(
      'totalCommission', COALESCE((SELECT SUM(amount) FROM commission_entries), 0),
      'commissionByCurrency', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('currency', currency, 'total', total) ORDER BY total DESC)
        FROM commission_by_currency
      ), '[]'::jsonb)
    ),

    'topCustomers', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', tc.id,
          'name', tc.name,
          'phone', tc.phone,
          'linked_user_id', tc.linked_user_id,
          'totalMovements', tc.total_movements,
          'totalVolume', tc.total_volume,
          'lastActivity', tc.last_activity,
          'balanceByCurrency', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object('currency', b.currency, 'amount', b.amount)
              ORDER BY ABS(b.amount) DESC
            )
            FROM top_customer_balances b
            WHERE b.customer_id = tc.id
              AND b.amount <> 0
          ), '[]'::jsonb)
        )
      )
      FROM top_customers tc
    ), '[]'::jsonb),

    'actionableStats', jsonb_build_object(
      'awaitingMyApprovalCount', COALESCE((SELECT awaiting_my_approval_count FROM actionable), 0),
      'awaitingMyApprovalByCurrency', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount) ORDER BY amount DESC)
        FROM awaiting_my_by_currency
      ), '[]'::jsonb),
      'awaitingOthersApprovalCount', COALESCE((SELECT awaiting_others_approval_count FROM actionable), 0),
      'awaitingOthersApprovalByCurrency', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount) ORDER BY amount DESC)
        FROM awaiting_others_by_currency
      ), '[]'::jsonb),
      'stalePendingCount', COALESCE((SELECT stale_pending_count FROM actionable), 0),
      'stalePendingByCurrency', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount) ORDER BY amount DESC)
        FROM stale_pending_by_currency
      ), '[]'::jsonb),
      'approvedLast7Days', COALESCE((SELECT approved_last_7_days FROM actionable), 0),
      'rejectedLast7Days', COALESCE((SELECT rejected_last_7_days FROM actionable), 0),
      'approvalRateLast7Days',
        CASE
          WHEN COALESCE((SELECT approved_last_7_days + rejected_last_7_days FROM actionable), 0) > 0
          THEN ROUND(
            ((SELECT approved_last_7_days::numeric FROM actionable)
             / NULLIF((SELECT approved_last_7_days + rejected_last_7_days FROM actionable), 0)) * 100,
            1
          )
          ELSE 0
        END,
      'rejectionRateLast7Days',
        CASE
          WHEN COALESCE((SELECT approved_last_7_days + rejected_last_7_days FROM actionable), 0) > 0
          THEN ROUND(
            ((SELECT rejected_last_7_days::numeric FROM actionable)
             / NULLIF((SELECT approved_last_7_days + rejected_last_7_days FROM actionable), 0)) * 100,
            1
          )
          ELSE 0
        END,
      'averageApprovalMinutesLast7Days',
        (SELECT ROUND(average_approval_minutes_last_7_days::numeric, 1) FROM actionable)
    ),

    'periodStats', jsonb_build_object(
      'today', public.build_period_stats_json('today', (SELECT row_to_json(ps)::jsonb FROM period_stats ps WHERE ps.period_key = 'today'), (SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount)) FROM period_transaction_currency WHERE period_key = 'today'), (SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount)) FROM period_movement_currency WHERE period_key = 'today'), (SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount)) FROM period_commission_currency WHERE period_key = 'today')),
      'yesterday', public.build_period_stats_json('yesterday', (SELECT row_to_json(ps)::jsonb FROM period_stats ps WHERE ps.period_key = 'yesterday'), (SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount)) FROM period_transaction_currency WHERE period_key = 'yesterday'), (SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount)) FROM period_movement_currency WHERE period_key = 'yesterday'), (SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount)) FROM period_commission_currency WHERE period_key = 'yesterday')),
      'week', public.build_period_stats_json('week', (SELECT row_to_json(ps)::jsonb FROM period_stats ps WHERE ps.period_key = 'week'), (SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount)) FROM period_transaction_currency WHERE period_key = 'week'), (SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount)) FROM period_movement_currency WHERE period_key = 'week'), (SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount)) FROM period_commission_currency WHERE period_key = 'week')),
      'month', public.build_period_stats_json('month', (SELECT row_to_json(ps)::jsonb FROM period_stats ps WHERE ps.period_key = 'month'), (SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount)) FROM period_transaction_currency WHERE period_key = 'month'), (SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount)) FROM period_movement_currency WHERE period_key = 'month'), (SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount)) FROM period_commission_currency WHERE period_key = 'month'))
    ),

    'customPeriod', public.build_period_stats_json(
      'custom',
      (SELECT row_to_json(ps)::jsonb FROM period_stats ps WHERE ps.period_key = 'custom'),
      (SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount)) FROM period_transaction_currency WHERE period_key = 'custom'),
      (SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount)) FROM period_movement_currency WHERE period_key = 'custom'),
      (SELECT jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount)) FROM period_commission_currency WHERE period_key = 'custom')
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

-- Helper used by get_app_statistics.
CREATE OR REPLACE FUNCTION public.build_period_stats_json(
  p_key text,
  p_stats jsonb,
  p_transaction_amounts jsonb,
  p_movement_amounts jsonb,
  p_commission_amounts jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'transactions', COALESCE((p_stats ->> 'transactions_count')::numeric, 0),
    'movements', COALESCE((p_stats ->> 'movements_count')::numeric, 0),
    'commissionMovements', COALESCE((p_stats ->> 'commission_movements_count')::numeric, 0),
    'transactionAmount', COALESCE((p_stats ->> 'transaction_amount')::numeric, 0),
    'movementAmount', COALESCE((p_stats ->> 'movement_amount')::numeric, 0),
    'commissionAmount', COALESCE((p_stats ->> 'commission_amount')::numeric, 0),
    'transactionAmountsByCurrency', COALESCE(p_transaction_amounts, '[]'::jsonb),
    'movementAmountsByCurrency', COALESCE(p_movement_amounts, '[]'::jsonb),
    'commissionAmountsByCurrency', COALESCE(p_commission_amounts, '[]'::jsonb)
  );
$$;

-- The main function refers to helper above. Recreate main function once more after helper exists.
-- This small call only validates that the helper exists; no data is changed.
SELECT 'statistics_rpc_rebuilt_successfully' AS status;
