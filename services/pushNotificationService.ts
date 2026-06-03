import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

export const ANDROID_NOTIFICATION_CHANNEL_ID = 'akked-alerts-v2';

const DEVICE_ID_STORAGE_KEY = 'akked.push.deviceId';

type PushStatus =
  | 'registered'
  | 'unsupported'
  | 'missing_project_id'
  | 'permission_denied'
  | 'missing_auth_session'
  | 'registration_failed'
  | 'send_failed';

export type PushResult = {
  ok: boolean;
  status: PushStatus;
  message: string;
  expoPushToken?: string;
};

let lastRegistrationOk = false;
let lastExpoPushToken: string | null = null;

function getProjectId() {
  const expoConfigProjectId =
    (Constants.expoConfig?.extra as any)?.eas?.projectId ||
    (Constants.expoConfig as any)?.extra?.eas?.projectId;
  const easConfigProjectId = (Constants as any).easConfig?.projectId;

  return String(easConfigProjectId || expoConfigProjectId || '').trim();
}

function getAppVersion() {
  return String(Constants.expoConfig?.version || '').trim() || null;
}

function getNormalizedPlatform() {
  if (Platform.OS === 'android' || Platform.OS === 'ios' || Platform.OS === 'web') {
    return Platform.OS;
  }

  return 'unknown';
}

async function getOrCreateDeviceId() {
  const stored = await AsyncStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (stored) return stored;

  const nextId = Crypto.randomUUID();
  await AsyncStorage.setItem(DEVICE_ID_STORAGE_KEY, nextId);
  return nextId;
}

export async function ensureAndroidNotificationChannel() {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync(ANDROID_NOTIFICATION_CHANNEL_ID, {
    name: 'إشعارات Akked',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#2563EB',
    enableVibrate: true,
    enableLights: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

export async function ensurePushNotificationPermission(): Promise<PushResult> {
  if (Platform.OS === 'web') {
    return {
      ok: false,
      status: 'unsupported',
      message: 'الإشعارات غير مدعومة على الويب في هذا التطبيق',
    };
  }

  await ensureAndroidNotificationChannel();

  const currentPermissions = await Notifications.getPermissionsAsync();
  const finalPermissions = currentPermissions.granted
    ? currentPermissions
    : await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
        },
      });

  if (!finalPermissions.granted) {
    return {
      ok: false,
      status: 'permission_denied',
      message: finalPermissions.canAskAgain
        ? 'لم يتم تفعيل صلاحية الإشعارات'
        : 'صلاحية الإشعارات مرفوضة من إعدادات الهاتف',
    };
  }

  return {
    ok: true,
    status: 'registered',
    message: 'صلاحية الإشعارات مفعلة',
  };
}

export async function registerDeviceForPushNotifications(): Promise<PushResult> {
  try {
    if (Platform.OS === 'web') {
      lastRegistrationOk = false;
      return {
        ok: false,
        status: 'unsupported',
        message: 'الإشعارات غير مدعومة على الويب في هذا التطبيق',
      };
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.user) {
      lastRegistrationOk = false;
      return {
        ok: false,
        status: 'missing_auth_session',
        message: 'يجب تسجيل الدخول بجلسة Supabase لتفعيل إشعارات الهاتف',
      };
    }

    const permission = await ensurePushNotificationPermission();
    if (!permission.ok) {
      lastRegistrationOk = false;
      return permission;
    }

    const projectId = getProjectId();
    if (!projectId) {
      lastRegistrationOk = false;
      return {
        ok: false,
        status: 'missing_project_id',
        message: 'لم يتم العثور على projectId الخاص بـ EAS',
      };
    }

    const expoPushToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    const deviceId = await getOrCreateDeviceId();

    const { data, error } = await supabase.rpc('register_device_push_token', {
      p_expo_push_token: expoPushToken,
      p_device_id: deviceId,
      p_platform: getNormalizedPlatform(),
      p_app_version: getAppVersion(),
    });

    if (error || data?.success === false) {
      lastRegistrationOk = false;
      return {
        ok: false,
        status: data?.code === 'missing_auth_session' ? 'missing_auth_session' : 'registration_failed',
        message: data?.message || error?.message || 'تعذر تسجيل جهازك لاستقبال الإشعارات',
      };
    }

    lastRegistrationOk = true;
    lastExpoPushToken = expoPushToken;

    return {
      ok: true,
      status: 'registered',
      message: 'تم تفعيل إشعارات الهاتف',
      expoPushToken,
    };
  } catch (error: any) {
    lastRegistrationOk = false;
    return {
      ok: false,
      status: 'registration_failed',
      message: error?.message || 'تعذر تسجيل جهازك لاستقبال الإشعارات',
    };
  }
}

export async function unregisterCurrentDevicePushToken() {
  try {
    const deviceId = await AsyncStorage.getItem(DEVICE_ID_STORAGE_KEY);

    await supabase.rpc('unregister_current_device_push_token', {
      p_device_id: deviceId,
      p_expo_push_token: lastExpoPushToken,
    });
  } catch (error) {
    console.warn('[PushNotifications] Unable to unregister device token:', error);
  } finally {
    lastRegistrationOk = false;
    lastExpoPushToken = null;
  }
}

export function isPushNotificationReady() {
  return lastRegistrationOk;
}

export async function sendPushNotificationTest(): Promise<PushResult> {
  try {
    const registration = await registerDeviceForPushNotifications();
    if (!registration.ok) return registration;

    const { data, error } = await supabase.functions.invoke('send-movement-push', {
      body: {
        type: 'test',
        title: 'اختبار الإشعارات',
        message: 'هذا إشعار اختبار من تطبيق Akked',
      },
    });

    if (error || data?.success === false) {
      return {
        ok: false,
        status: 'send_failed',
        message: data?.message || error?.message || 'تعذر إرسال إشعار الاختبار',
        expoPushToken: registration.expoPushToken,
      };
    }

    return {
      ok: true,
      status: 'registered',
      message: 'تم إرسال إشعار الاختبار',
      expoPushToken: registration.expoPushToken,
    };
  } catch (error: any) {
    return {
      ok: false,
      status: 'send_failed',
      message: error?.message || 'تعذر إرسال إشعار الاختبار',
    };
  }
}
