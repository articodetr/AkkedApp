type NotificationRecord = {
  id?: string;
  user_id?: string | null;
  recipient_user_id?: string | null;
  customer_id?: string | null;
  movement_id?: string | null;
  title?: string | null;
  message?: string | null;
  notification_type?: string | null;
};

type DeviceTokenRow = {
  expo_push_token: string;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-push-webhook-secret, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || '';
const PUSH_WEBHOOK_SECRET = Deno.env.get('PUSH_WEBHOOK_SECRET') || '';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_CHUNK_SIZE = 100;
const ANDROID_CHANNEL_ID = 'akked-alerts-v2';

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

function cleanText(value: unknown, fallback: string, maxLength = 180) {
  const text = String(value || fallback).replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}...`;
}

function getWebhookSecret(req: Request) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();

  return (
    req.headers.get('x-push-webhook-secret') ||
    req.headers.get('x-webhook-secret') ||
    bearer ||
    ''
  ).trim();
}

async function createSupabaseClient(key: string, authorization?: string) {
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');

  return createClient(SUPABASE_URL, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: authorization
      ? {
          headers: {
            Authorization: authorization,
          },
        }
      : undefined,
  });
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function deactivateTokens(serviceClient: any, tokens: string[]) {
  if (!tokens.length) return;

  await serviceClient
    .from('device_push_tokens')
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .in('expo_push_token', tokens);
}

async function sendToUser(
  serviceClient: any,
  userId: string,
  notification: NotificationRecord,
) {
  const { data: tokenRows, error: tokenError } = await serviceClient
    .from('device_push_tokens')
    .select('expo_push_token')
    .eq('user_id', userId)
    .eq('is_active', true);

  if (tokenError) {
    throw new Error(tokenError.message || 'Unable to load device push tokens');
  }

  const tokens = ((tokenRows || []) as DeviceTokenRow[])
    .map((row) => row.expo_push_token)
    .filter(Boolean);

  if (!tokens.length) {
    return {
      success: true,
      sent: 0,
      disabled: 0,
      message: 'No active device tokens for this user',
    };
  }

  const title = cleanText(notification.title, 'أكِّد');
  const body = cleanText(notification.message, 'لديك إشعار جديد');
  const disabledTokens: string[] = [];
  let sent = 0;

  for (const tokenChunk of chunk(tokens, EXPO_CHUNK_SIZE)) {
    const messages = tokenChunk.map((token) => ({
      to: token,
      sound: 'default',
      title,
      body,
      priority: 'high',
      channelId: ANDROID_CHANNEL_ID,
      data: {
        notificationId: notification.id || null,
        movementId: notification.movement_id || null,
        customerId: notification.customer_id || null,
        notificationType: notification.notification_type || null,
      },
    }));

    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.errors?.[0]?.message || `Expo push request failed (${response.status})`);
    }

    const results = Array.isArray(payload?.data) ? payload.data : [];
    results.forEach((result: any, index: number) => {
      if (result?.status === 'ok') {
        sent += 1;
        return;
      }

      const errorCode = result?.details?.error || result?.message || '';
      if (errorCode === 'DeviceNotRegistered') {
        disabledTokens.push(tokenChunk[index]);
      }
    });
  }

  await deactivateTokens(serviceClient, disabledTokens);

  return {
    success: true,
    sent,
    disabled: disabledTokens.length,
  };
}

function getNotificationRecord(body: any): NotificationRecord | null {
  return body?.record || body?.new || body?.notification || body || null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ success: false, message: 'Method not allowed' }, 405);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse(
      { success: false, message: 'Missing Supabase service configuration' },
      500,
    );
  }

  const body = await req.json().catch(() => ({}));
  const serviceClient = await createSupabaseClient(SUPABASE_SERVICE_ROLE_KEY);

  try {
    if (body?.type === 'test') {
      if (!SUPABASE_ANON_KEY) {
        return jsonResponse({ success: false, message: 'Missing Supabase anon key' }, 500);
      }

      const authorization = req.headers.get('authorization') || '';
      const userClient = await createSupabaseClient(SUPABASE_ANON_KEY, authorization);
      const {
        data: { user },
        error,
      } = await userClient.auth.getUser();

      if (error || !user?.id) {
        return jsonResponse({ success: false, message: 'Missing authenticated user' }, 401);
      }

      const result = await sendToUser(serviceClient, user.id, {
        id: `test-${Date.now()}`,
        user_id: user.id,
        title: body.title || 'اختبار الإشعارات',
        message: body.message || 'هذا إشعار اختبار من تطبيق أكِّد',
        notification_type: 'test',
      });

      return jsonResponse(result);
    }

    if (!PUSH_WEBHOOK_SECRET) {
      return jsonResponse({ success: false, message: 'PUSH_WEBHOOK_SECRET is not configured' }, 500);
    }

    if (getWebhookSecret(req) !== PUSH_WEBHOOK_SECRET) {
      return jsonResponse({ success: false, message: 'Unauthorized webhook' }, 401);
    }

    const eventType = String(body?.type || body?.eventType || body?.event || '').toUpperCase();
    if (eventType && eventType !== 'INSERT') {
      return jsonResponse({ success: true, ignored: true, message: 'Only INSERT events are sent' });
    }

    const record = getNotificationRecord(body);
    const userId = String(record?.user_id || record?.recipient_user_id || '').trim();

    if (!record || !userId) {
      return jsonResponse({ success: false, message: 'Missing notification recipient' }, 400);
    }

    const result = await sendToUser(serviceClient, userId, record);
    return jsonResponse(result);
  } catch (error: any) {
    return jsonResponse(
      {
        success: false,
        message: error?.message || 'Unable to send push notification',
      },
      500,
    );
  }
});
