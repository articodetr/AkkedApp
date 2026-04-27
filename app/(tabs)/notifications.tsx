import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Bell } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useDataRefresh } from '@/contexts/DataRefreshContext';
import NotificationCard from '../../components/NotificationCard';
import {
  approveMovementNotification,
  filterNotifications,
  getGeneralNotifications,
  getNotificationCustomerId,
  MovementNotification,
  NotificationFilter,
  rejectMovementNotification,
  softDeleteNotification,
} from '../../services/notificationService';

const FILTERS: Array<{ key: NotificationFilter; label: string }> = [
  { key: 'all', label: 'الكل' },
  { key: 'action', label: 'بحاجة إجراء' },
  { key: 'unread', label: 'غير مقروءة' },
];

export default function NotificationsTabScreen() {
  const router = useRouter();
  const { currentUser } = useAuth();
  const { triggerRefresh } = useDataRefresh();
  const [notifications, setNotifications] = useState<MovementNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<NotificationFilter>('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [processingActionId, setProcessingActionId] = useState<string | null>(null);

  const loadNotifications = useCallback(async () => {
    if (!currentUser?.userId) {
      setNotifications([]);
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }

    try {
      const nextNotifications = await getGeneralNotifications(currentUser.userId);
      setNotifications(nextNotifications);
    } catch (error) {
      console.error('[Notifications] Error loading general notifications:', error);
      Alert.alert('خطأ', 'تعذر تحميل الإشعارات العامة');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [currentUser?.userId]);

  useFocusEffect(
    useCallback(() => {
      loadNotifications();
    }, [loadNotifications]),
  );

  // 🔧 ref لأحدث نسخة من loadNotifications بدون إعادة تشغيل useEffect
  const loadRef = useRef(loadNotifications);
  useEffect(() => {
    loadRef.current = loadNotifications;
  }, [loadNotifications]);

  // 🔧 إصلاح Supabase Realtime: قناة فريدة لكل mount + cleanup آمن
  useEffect(() => {
    if (!currentUser?.userId) return;

    const channelName = `general-notifications-${currentUser.userId}-${Date.now()}`;
    const channel = supabase.channel(channelName);

    channel
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'movement_notifications',
          filter: `user_id=eq.${currentUser.userId}`,
        },
        () => {
          loadRef.current?.();
        },
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        // تجاهل أخطاء الإغلاق المزدوج
      }
    };
  }, [currentUser?.userId]);

  const visibleNotifications = useMemo(
    () => filterNotifications(notifications, activeFilter, currentUser),
    [activeFilter, currentUser, notifications],
  );

  const filterCounts = useMemo<Record<NotificationFilter, number>>(
    () => ({
      all: notifications.length,
      action: filterNotifications(notifications, 'action', currentUser).length,
      unread: filterNotifications(notifications, 'unread', currentUser).length,
    }),
    [currentUser, notifications],
  );

  const onRefresh = () => {
    setIsRefreshing(true);
    loadNotifications();
  };

  const openNotification = (item: MovementNotification) => {
    const customerId = getNotificationCustomerId(item) || '';
    const customerName = item.customer_name || item.movement?.customer?.name || '';

    router.push({
      pathname: '/notification-detail',
      params: {
        id: item.id,
        from: 'general',
        customerId,
        customerName,
      },
    });
  };

  const confirmDelete = (item: MovementNotification) => {
    if (!currentUser?.userId) return;

    Alert.alert(
      'حذف الإشعار',
      'سيتم إخفاء الإشعار من هذه القائمة فقط، ولن يتم حذف الحركة المالية. هل تريد المتابعة؟',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'حذف',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeletingId(item.id);
              await softDeleteNotification(item.id, currentUser.userId);
              setNotifications((current) => current.filter((notification) => notification.id !== item.id));
            } catch (error) {
              console.error('[Notifications] Error deleting notification:', error);
              Alert.alert('خطأ', 'تعذر حذف الإشعار');
            } finally {
              setDeletingId(null);
            }
          },
        },
      ],
    );
  };

  const handleAcceptNotification = async (item: MovementNotification) => {
    if (!currentUser) {
      throw new Error('تعذر معرفة المستخدم الحالي');
    }

    try {
      setProcessingActionId(item.id);
      await approveMovementNotification(item, currentUser);
      triggerRefresh('movements');
      triggerRefresh('customers');
      await loadNotifications();
    } finally {
      setProcessingActionId(null);
    }
  };

  const handleRejectNotification = async (item: MovementNotification, reason: string) => {
    if (!currentUser) {
      throw new Error('تعذر معرفة المستخدم الحالي');
    }

    try {
      setProcessingActionId(item.id);
      await rejectMovementNotification(item, currentUser, reason);
      triggerRefresh('movements');
      triggerRefresh('customers');
      await loadNotifications();
    } finally {
      setProcessingActionId(null);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563EB" />
        <Text style={styles.loadingText}>جاري تحميل الإشعارات...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <Bell size={24} color="#2563EB" />
        </View>
        <View style={styles.headerTextWrap}>
          <Text style={styles.headerTitle}>الإشعارات العامة</Text>
          <Text style={styles.headerSubtitle}>كل إشعارات الحساب من جميع العملاء في مكان واحد.</Text>
        </View>
      </View>

      <View style={styles.filtersRow}>
        {FILTERS.map((filter) => {
          const isActive = activeFilter === filter.key;
          const count = filterCounts[filter.key];

          return (
            <TouchableOpacity
              key={filter.key}
              style={[styles.filterButton, isActive && styles.filterButtonActive]}
              onPress={() => setActiveFilter(filter.key)}
            >
              <Text style={[styles.filterText, isActive && styles.filterTextActive]}>
                {filter.label}
              </Text>
              <View style={[styles.filterCount, isActive && styles.filterCountActive]}>
                <Text style={[styles.filterCountText, isActive && styles.filterCountTextActive]}>{count}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      <FlatList
        data={visibleNotifications}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <NotificationCard
            notification={item}
            currentUser={currentUser}
            onPress={() => openNotification(item)}
            onDelete={confirmDelete}
            onAccept={handleAcceptNotification}
            onReject={handleRejectNotification}
            isDeleting={deletingId === item.id}
            isProcessing={processingActionId === item.id}
            showCustomer
            unreadColor="#2563EB"
          />
        )}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Bell size={42} color="#CBD5E1" />
            <Text style={styles.emptyTitle}>لا توجد إشعارات</Text>
            <Text style={styles.emptySubtitle}>عند وصول إشعارات جديدة ستظهر هنا.</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
  },
  loadingText: {
    marginTop: 12,
    color: '#64748B',
    fontSize: 15,
  },
  header: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 22,
    color: '#0F172A',
    fontWeight: '900',
    textAlign: 'right',
  },
  headerSubtitle: {
    marginTop: 4,
    fontSize: 13,
    color: '#64748B',
    textAlign: 'right',
    lineHeight: 20,
  },
  filtersRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  filterButton: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  filterButtonActive: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  filterText: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '800',
  },
  filterTextActive: {
    color: '#FFFFFF',
  },
  filterCount: {
    minWidth: 24,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
  },
  filterCountActive: {
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  filterCountText: {
    color: '#475569',
    fontWeight: '900',
    fontSize: 12,
  },
  filterCountTextActive: {
    color: '#FFFFFF',
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
    gap: 12,
  },
  emptyState: {
    minHeight: 340,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyTitle: {
    marginTop: 12,
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '900',
  },
  emptySubtitle: {
    marginTop: 6,
    color: '#64748B',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
  },
});