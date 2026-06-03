CREATE TABLE IF NOT EXISTS public.device_push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.app_security(id) ON DELETE CASCADE,
  expo_push_token text NOT NULL UNIQUE,
  device_id text NOT NULL,
  platform text NOT NULL DEFAULT 'unknown',
  app_version text,
  is_active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT device_push_tokens_platform_check
    CHECK (platform IN ('android', 'ios', 'web', 'unknown'))
);

CREATE INDEX IF NOT EXISTS device_push_tokens_user_active_idx
  ON public.device_push_tokens (user_id, is_active, last_seen_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS device_push_tokens_user_device_active_uidx
  ON public.device_push_tokens (user_id, device_id)
  WHERE is_active = true;

ALTER TABLE public.device_push_tokens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.device_push_tokens FROM anon, authenticated;

DROP POLICY IF EXISTS "service role manages device push tokens" ON public.device_push_tokens;
CREATE POLICY "service role manages device push tokens"
  ON public.device_push_tokens
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.set_device_push_tokens_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_device_push_tokens_updated_at ON public.device_push_tokens;
CREATE TRIGGER trg_device_push_tokens_updated_at
  BEFORE UPDATE ON public.device_push_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.set_device_push_tokens_updated_at();

CREATE OR REPLACE FUNCTION public.register_device_push_token(
  p_expo_push_token text,
  p_device_id text,
  p_platform text DEFAULT 'unknown',
  p_app_version text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_platform text := lower(coalesce(nullif(btrim(p_platform), ''), 'unknown'));
  v_token text := nullif(btrim(p_expo_push_token), '');
  v_device_id text := nullif(btrim(p_device_id), '');
  v_user_exists boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'missing_auth_session',
      'message', 'Missing authenticated Supabase session'
    );
  END IF;

  IF v_token IS NULL OR v_token !~ '^ExpoPushToken\[[^]]+\]$' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'invalid_push_token',
      'message', 'Invalid Expo push token'
    );
  END IF;

  IF v_device_id IS NULL THEN
    v_device_id := v_token;
  END IF;

  IF v_platform NOT IN ('android', 'ios', 'web') THEN
    v_platform := 'unknown';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.app_security
    WHERE id = v_user_id
      AND coalesce(is_active, true) = true
  )
  INTO v_user_exists;

  IF NOT v_user_exists THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'inactive_or_missing_user',
      'message', 'User profile is missing or inactive'
    );
  END IF;

  UPDATE public.device_push_tokens
  SET is_active = false
  WHERE user_id = v_user_id
    AND device_id = v_device_id
    AND expo_push_token <> v_token
    AND is_active = true;

  INSERT INTO public.device_push_tokens (
    user_id,
    expo_push_token,
    device_id,
    platform,
    app_version,
    is_active,
    last_seen_at
  )
  VALUES (
    v_user_id,
    v_token,
    v_device_id,
    v_platform,
    nullif(btrim(p_app_version), ''),
    true,
    now()
  )
  ON CONFLICT (expo_push_token)
  DO UPDATE SET
    user_id = EXCLUDED.user_id,
    device_id = EXCLUDED.device_id,
    platform = EXCLUDED.platform,
    app_version = EXCLUDED.app_version,
    is_active = true,
    last_seen_at = now();

  RETURN jsonb_build_object(
    'success', true,
    'code', 'registered',
    'expoPushToken', v_token
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.unregister_current_device_push_token(
  p_device_id text DEFAULT NULL,
  p_expo_push_token text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_device_id text := nullif(btrim(p_device_id), '');
  v_token text := nullif(btrim(p_expo_push_token), '');
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'missing_auth_session',
      'message', 'Missing authenticated Supabase session'
    );
  END IF;

  UPDATE public.device_push_tokens
  SET is_active = false
  WHERE user_id = v_user_id
    AND (
      (v_token IS NOT NULL AND expo_push_token = v_token)
      OR (v_device_id IS NOT NULL AND device_id = v_device_id)
    );

  RETURN jsonb_build_object('success', true, 'code', 'unregistered');
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_device_push_token(text, text, text, text)
  TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.unregister_current_device_push_token(text, text)
  TO anon, authenticated;
