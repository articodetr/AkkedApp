import { useCallback, useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { setBadgeCountAsync } from 'expo-notifications/build/setBadgeCountAsync';
import {
  addNotificationResponseReceivedListener,
  clearLastNotificationResponse,
  getLastNotificationResponse,
} from 'expo-notifications/build/NotificationsEmitter';
import {
  AndroidNotificationPriority,
  SchedulableTriggerInputTypes,
} from 'expo-notifications/build/Notifications.types';
import {
  AndroidImportance,
  AndroidNotificationVisibility,
} from 'expo-notifications/build/NotificationChannelManager.types';
import {
  getPermissionsAsync,
  requestPermissionsAsync,
} from 'expo-notifications/build/NotificationPermissions';
import { scheduleNotificationAsync } from 'expo-notifications/build/scheduleNotificationAsync';
import { setNotificationChannelAsync } from 'expo-notifications/build/setNotificationChannelAsync';
import { setNotificationHandler } from 'expo-notifications/build/NotificationsHandler';

import { supabase } from '@/lib/supabase';
import { CurrentUser } from '@/contexts/AuthContext';
import {
  getNotificationById,
  getNotificationMeta,
  MovementNotification,
} from '@/services/notificationService';

const ANDROID_CHANNEL_ID = 'akked-alerts-v2';
const MAX_TEXT_LENGTH = 170;
const NEW_NOTIFICATION_POLL_MS = 8000;

type BadgeNotificationRow = {
  id: string;
  is_read?: boolean | null;
  status?: string | null;
  created_at?: string | null;
};

setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    priority: AndroidNotificationPriority.MAX,
  }),
});

function cleanNotificationText(value?: string | null) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= MAX_TEXT_LENGTH) return text;
  return `${text.slice(0, MAX_TEXT_LENGTH - 1).trim()}...`;
}

function canShowSystemNotification(item: MovementNotification) {
  return Boolean(item.id && !(item as any).deleted_at);
}

function getNotificationId(value: unknown) {
  return String((value as { id?: unknown })?.id || '').trim();
}

function isBadgeUnread(item: BadgeNotificationRow) {
  const status = String(item.status || '').toLowerCase();
  return item.is_read === false || status === 'unread';
}

function getNotificationTrigger() {
  if (Platform.OS !== 'android') return null;

  return {
    type: SchedulableTriggerInputTypes.TIME_INTERVAL,
    seconds: 1,
    channelId: ANDROID_CHANNEL_ID,
  } as const;
}

async function ensureSystemNotificationsReady() {
  if (Platform.OS === 'web') return false;

  if (Platform.OS === 'android') {
    await setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: 'إشعارات أكِّد',
      importance: AndroidImportance.MAX,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#2563EB',
      enableVibrate: true,
      enableLights: true,
      lockscreenVisibility: AndroidNotificationVisibility.PUBLIC,
    });
  }

  const currentPermissions = await getPermissionsAsync();
  const finalPermissions = currentPermissions.granted
    ? currentPermissions
    : await requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
        },
      });

  return finalPermissions.granted;
}

async function getUnreadNotificationRows(userId: string) {
  const { data, error } = await supabase
    .from('movement_notifications')
    .select('id, is_read, status, created_at')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return ((data || []) as BadgeNotificationRow[]).filter(isBadgeUnread);
}

async function getRecentNotificationRows(userId: string, since: string) {
  const { data, error } = await supabase
    .from('movement_notifications')
    .select('id, is_read, status, created_at')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .gte('created_at', since)
    .order('created_at', { ascending: true });

  if (error) throw error;

  return (data || []) as BadgeNotificationRow[];
}

async function updateAppIconBadge(userId?: string | null) {
  if (Platform.OS === 'web') return;

  try {
    if (!userId) {
      await setBadgeCountAsync(0);
      return;
    }

    const unreadCount = (await getUnreadNotificationRows(userId)).length;
    await setBadgeCountAsync(unreadCount);
  } catch (error) {
    console.warn('[SystemNotifications] Unable to update app icon badge:', error);
  }
}

async function showSystemNotification(
  item: MovementNotification,
  currentUser: CurrentUser,
) {
  if (!canShowSystemNotification(item)) return;

  let title = item.title || 'أكِّد';
  let body = item.message || 'لديك إشعار جديد';

  try {
    const meta = getNotificationMeta(item, currentUser);
    title = meta.title || title;
    body = meta.subtitle || body;
  } catch (error) {
    console.warn('[SystemNotifications] Unable to build rich notification text:', error);
  }

  await scheduleNotificationAsync({
    identifier: `movement-notification-${item.id}`,
    content: {
      title: cleanNotificationText(title),
      body: cleanNotificationText(body),
      sound: 'default',
      priority: AndroidNotificationPriority.MAX,
      color: '#2563EB',
      data: {
        notificationId: item.id,
        movementId: item.movement_id,
        customerId: item.customer_id || item.movement?.customer_id || null,
      },
    },
    trigger: getNotificationTrigger(),
  });
}

export async function scheduleSystemNotificationTest() {
  const hasPermission = await ensureSystemNotificationsReady();
  if (!hasPermission) {
    throw new Error('Notifications permission is not granted');
  }

  await scheduleNotificationAsync({
    identifier: `akked-notification-test-${Date.now()}`,
    content: {
      title: 'أكِّد',
      body: 'هذا إشعار تجريبي',
      sound: 'default',
      priority: AndroidNotificationPriority.MAX,
      color: '#2563EB',
    },
    trigger: getNotificationTrigger(),
  });
}

async function showNotificationById(
  notificationId: string,
  currentUser: CurrentUser,
  fallbackItem?: MovementNotification | null,
) {
  const notification = await getNotificationById(notificationId).catch((error) => {
    console.warn('[SystemNotifications] Unable to load notification details:', error);
    return null;
  });

  await showSystemNotification(notification || fallbackItem || {
    id: notificationId,
    movement_id: null,
    notification_type: 'info',
    message: 'You have a new notification',
    is_read: false,
    created_at: new Date().toISOString(),
  }, currentUser);
}

export function useSystemNotifications(currentUser: CurrentUser | null) {
  const router = useRouter();
  const notifiedIdsRef = useRef<Set<string>>(new Set());
  const startedAtRef = useRef(new Date().toISOString());

  const showNewNotifications = useCallback(async () => {
    if (!currentUser?.userId || Platform.OS === 'web') return;

    try {
      const hasPermission = await ensureSystemNotificationsReady();
      if (!hasPermission) {
        console.warn('[SystemNotifications] Notification permission is not granted.');
        return;
      }

      const rows = await getRecentNotificationRows(currentUser.userId, startedAtRef.current);

      for (const row of rows) {
        const notificationId = getNotificationId(row);
        if (!notificationId || notifiedIdsRef.current.has(notificationId)) continue;

        notifiedIdsRef.current.add(notificationId);
        await showNotificationById(notificationId, currentUser);
      }
    } catch (error) {
      console.warn('[SystemNotifications] Unable to poll new notifications:', error);
    }
  }, [currentUser]);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    const subscription = addNotificationResponseReceivedListener(() => {
      router.push('/(tabs)/notifications' as any);
    });

    const lastResponse = getLastNotificationResponse();
    if (lastResponse) {
      router.push('/(tabs)/notifications' as any);
      clearLastNotificationResponse();
    }

    return () => {
      subscription.remove();
    };
  }, [router]);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    if (!currentUser?.userId) {
      updateAppIconBadge(null);
      return;
    }

    let isActive = true;

    ensureSystemNotificationsReady().catch((error) => {
      console.warn('[SystemNotifications] Unable to enable system notifications:', error);
    });
    updateAppIconBadge(currentUser.userId);
    showNewNotifications();

    const channelName = `system-notifications-${currentUser.userId}-${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'movement_notifications',
          filter: `user_id=eq.${currentUser.userId}`,
        },
        async (payload) => {
          updateAppIconBadge(currentUser.userId);

          if ((payload as any).eventType !== 'INSERT') return;

          const notificationId = String((payload.new as any)?.id || '');
          if (!notificationId || notifiedIdsRef.current.has(notificationId)) return;

          notifiedIdsRef.current.add(notificationId);

          try {
            const hasPermission = await ensureSystemNotificationsReady();
            if (!hasPermission || !isActive) return;

            await showNotificationById(
              notificationId,
              currentUser,
              (payload.new as MovementNotification) || null,
            );
          } catch (error) {
            console.warn('[SystemNotifications] Unable to show system notification:', error);
          }
        },
      )
      .subscribe();

    const pollTimer = setInterval(() => {
      showNewNotifications();
      updateAppIconBadge(currentUser.userId);
    }, NEW_NOTIFICATION_POLL_MS);

    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        showNewNotifications();
        updateAppIconBadge(currentUser.userId);
      }
    });

    return () => {
      isActive = false;
      clearInterval(pollTimer);
      appStateSubscription.remove();
      try {
        void supabase.removeChannel(channel);
      } catch {
        // Ignore duplicate cleanup.
      }
    };
  }, [currentUser, showNewNotifications]);
}
