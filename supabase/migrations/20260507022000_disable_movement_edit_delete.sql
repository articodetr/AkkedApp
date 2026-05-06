-- Disable movement edit/delete features from RPC entry points.

CREATE OR REPLACE FUNCTION public.request_movement_update(
  p_movement_id uuid,
  p_user_name text,
  p_movement_type text,
  p_amount numeric,
  p_currency text,
  p_notes text,
  p_sender_name text DEFAULT NULL,
  p_beneficiary_name text DEFAULT NULL,
  p_transfer_number text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN json_build_object(
    'success', false,
    'error', 'Movement editing is disabled',
    'feature_disabled', true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_movement_update(
  uuid,
  text,
  text,
  numeric,
  text,
  text,
  text,
  text,
  text
) TO anon, authenticated;

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
BEGIN
  RETURN jsonb_build_object(
    'success', false,
    'error', 'Movement editing is disabled',
    'feature_disabled', true
  );
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

CREATE OR REPLACE FUNCTION public.request_movement_deletion(
  p_movement_id uuid,
  p_user_name text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN json_build_object(
    'success', false,
    'deleted', false,
    'error', 'Movement deletion is disabled',
    'feature_disabled', true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_movement_deletion(uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.force_delete_pending_movement(
  p_movement_id text,
  p_user_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'success', false,
    'deleted', false,
    'error', 'Movement deletion is disabled',
    'feature_disabled', true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.force_delete_pending_movement(text, text) TO anon, authenticated;
