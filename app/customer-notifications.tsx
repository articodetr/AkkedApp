import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowRight, Bell } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useDataRefresh } from '@/contexts/DataRefreshContext';
import NotificationCard from '../components/NotificationCard';
import {
  approveMovementNotification,
  filterNotifications,
  getCustomerNotifications,
  MovementNotification,
  NotificationFilter,
  rejectMovementNotification,
  softDeleteNotification,
} from '../services/notificationService';

const FILTERS: Array<{ key: NotificationFilter; label: string }> = [
  { key: 'all', label: 'الكل' },
  { key: 'action', label: 'بحاجة إجراء' },
  { key: 'unread', label: 'غير مقروءة' },
];

function getParamValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

export default function CustomerNotificationsScreen() {
  const router = useRouter();
  const { currentUser } = useAuth();
  const { triggerRefresh } = useDataRefresh();
  const params = useLocalSearchParams<{ customerId?: string; customerName?: string }>();
  const customerId = getParamValue(params.customerId);
  const customerName = getParamValue(params.customerName) || 'العميل';

  const [notifications, setNotifications] = useState<MovementNotification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<NotificationFilter>('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [processingActionId, setProcessingActionId] = useState<string | null>(null);

  const loadNotifications = useCallback(async () => {
    if (!currentUser?.userId || !customerId) {
      setNotifications([]);
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }

    try {
      const nextNotifications = await getCustomerNotifications(currentUser.userId, customerId);
      setNotifications(nextNotifications);
    } catch (error) {
      console.error('[CustomerNotifications] Error loading customer notifications:', error);
      Alert.alert('خطأ', 'تعذر تحميل إشعارات هذا العميل');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [currentUser?.userId, customerId]);

  useFocusEffect(
    useCallback(() => {
      loadNotifications();
    }, [loadNotifications]),
  );

  useEffect(() => {
    if (!currentUser?.userId || !customerId) return;

    const channel = supabase
      .channel(`customer-notifications-${currentUser.userId}-${customerId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'movement_notifications',
          filter: `user_id=eq.${currentUser.userId}`,
        },
        () => {
          loadNotifications();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser?.userId, customerId, loadNotifications]);

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
    router.push({
      pathname: '/notification-detail',
      params: {
        id: item.id,
        from: 'customer',
        customerId: customerId || '',
        customerName,
      },
    });
  };

  const confirmDelete = (item: MovementNotification) => {
    if (!currentUser?.userId) return;

    Alert.alert(
      'حذف الإشعار',
      'سيتم إخفاء الإشعار من صفحة هذا العميل فقط، ولن يتم حذف الحركة المالية. هل تريد المتابعة؟',
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
              console.error('[CustomerNotifications] Error deleting notification:', error);
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
        <Text style={styles.loadingText}>جاري تحميل إشعارات العميل...</Text>
      </View>
    );
  }

  if (!customerId) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.emptyTitle}>لم يتم تحديد العميل</Text>
        <TouchableOpacity style={styles.backHomeButton} onPress={() => router.back()}>
          <Text style={styles.backHomeText}>العودة</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ArrowRight size={22} color="#0F172A" />
        </TouchableOpacity>
        <View style={styles.headerTextWrap}>
          <Text style={styles.headerTitle}>إشعارات العميل</Text>
          <Text style={styles.headerSubtitle}>{customerName}</Text>
        </View>
        <View style={styles.headerIcon}>
          <Bell size={22} color="#B45309" />
        </View>
      </View>

      <View style={styles.noticeBox}>
        <Text style={styles.noticeText}>
          هذه الصفحة تعرض إشعارات هذا العميل فقط. يمكنك قبول أو رفض الحركات المعلقة مباشرة من الكرت، أو الدخول للتفاصيل.
        </Text>
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
            showCustomer={false}
            unreadColor="#B45309"
          />
        )}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Bell size={42} color="#CBD5E1" />
            <Text style={styles.emptyTitle}>لا توجد إشعارات لهذا العميل</Text>
            <Text style={styles.emptySubtitle}>أي إشعار جديد يخص هذا العميل سيظهر هنا فقط.</Text>
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
    padding: 24,
    backgroundColor: '#F8FAFC',
  },
  loadingText: {
    marginTop: 12,
    color: '#64748B',
    fontSize: 15,
  },
  header: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
  },
  headerIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 21,
    color: '#0F172A',
    fontWeight: '900',
    textAlign: 'right',
  },
  headerSubtitle: {
    marginTop: 4,
    fontSize: 13,
    color: '#64748B',
    textAlign: 'right',
    fontWeight: '700',
  },
  noticeBox: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  noticeText: {
    color: '#92400E',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
    lineHeight: 20,
  },
  filtersRow: {
    flexDirection: 'row-reverse',
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
    backgroundColor: '#B45309',
    borderColor: '#B45309',
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
    minHeight: 320,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyTitle: {
    marginTop: 12,
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
  },
  emptySubtitle: {
    marginTop: 6,
    color: '#64748B',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
  },
  backHomeButton: {
    marginTop: 16,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  backHomeText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
});
