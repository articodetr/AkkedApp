import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import type { GestureResponderEvent } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { Bell, Check, X, Clock, Trash2 } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { isPendingMovement } from '@/utils/movementApproval';

interface NotificationItem {
  id: string;
  user_id?: string | null;
  movement_id: string | null;
  notification_type: string;
  message: string;
  is_read: boolean;
  status?: string | null;
  action_required?: boolean | null;
  created_at: string;
  movement_number?: string;
  amount?: number;
  currency?: string;
  movement_type?: string;
  customer_name?: string;
  actor_name?: string;
  sender_user_id?: string | null;
  recipient_user_id?: string | null;
  title?: string | null;
  read_at?: string | null;
  acted_at?: string | null;
  extra_data?: {
    reason?: string;
    reject_reason?: string;
    created_by_name?: string;
    created_by_user_id?: string;
    source_user_id?: string;
    creator_user_name?: string;
    creator_full_name?: string;
    approval_status?: string;
    requires_action?: boolean;
  };
  movement?: {
    movement_number: string;
    amount: number;
    currency: string;
    movement_type?: string | null;
    is_voided?: boolean;
    approval_status?: string;
    pending_approval?: boolean;
    created_by_user_id?: string | null;
    created_by_user_name?: string | null;
    source_user_id?: string | null;
    customer: {
      name: string;
      user_id?: string | null;
      linked_user_id?: string | null;
    };
  } | null;
}

type NotificationTab = 'all' | 'unread' | 'action';

type CurrentUserInfo = {
  userName: string;
  role: string;
  userId: string;
  fullName: string;
  accountNumber: string;
} | null;

type NotificationVisualState = 'action' | 'pending' | 'approved' | 'rejected' | 'info';

type CompactNotificationMeta = {
  amountText: string;
  directionLabel: string;
  directionColor: string;
  actorLabel: string;
  customerName: string;
  statusText: string;
  statusColor: string;
  statusBg: string;
  rowBorderColor: string;
  rowBg: string;
  dateText: string;
  timeText: string;
  isUnread: boolean;
  canTakeAction: boolean;
  isPending: boolean;
  isCreatedByMe: boolean;
  visualState: NotificationVisualState;
  rejectReason?: string;
};

function formatAmount(amount?: number, currency?: string) {
  if (amount == null) return 'بدون مبلغ';
  return `${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency || ''}`.trim();
}

function getRawStatus(item: NotificationItem) {
  return String(item.status || item.movement?.approval_status || '').toLowerCase();
}

function isUnreadNotification(item: NotificationItem) {
  const rawStatus = getRawStatus(item);
  return !item.is_read || rawStatus === 'unread';
}

function normalizeText(value?: string | null) {
  return String(value || '').trim().toLowerCase();
}

function isSameUserId(a?: string | null, b?: string | null) {
  return Boolean(a && b && String(a).toLowerCase() === String(b).toLowerCase());
}

function isNotificationCreatedByCurrentUser(item: NotificationItem, currentUser: CurrentUserInfo) {
  if (!currentUser) return false;

  const movement = item.movement as any;
  const possibleCreatorIds = [
    movement?.source_user_id,
    movement?.created_by_user_id,
    item.extra_data?.source_user_id,
    item.extra_data?.created_by_user_id,
    item.sender_user_id,
  ].filter(Boolean);

  const possibleCreatorNames = [
    movement?.created_by_user_name,
    item.actor_name,
    item.extra_data?.created_by_name,
    item.extra_data?.creator_user_name,
    item.extra_data?.creator_full_name,
  ]
    .map((value) => normalizeText(value))
    .filter(Boolean);

  const currentUserName = normalizeText(currentUser.userName);
  const currentFullName = normalizeText(currentUser.fullName);

  return (
    possibleCreatorIds.some((id) => isSameUserId(id as string, currentUser.userId)) ||
    (Boolean(currentUserName) && possibleCreatorNames.includes(currentUserName)) ||
    (Boolean(currentFullName) && possibleCreatorNames.includes(currentFullName))
  );
}

function isSelfPendingInfoNotification(item: NotificationItem, currentUser: CurrentUserInfo) {
  if (!currentUser?.userId) return false;

  const movement = item.movement as any;
  const belongsToCurrentUser =
    isSameUserId(item.user_id, currentUser.userId) ||
    isSameUserId(item.recipient_user_id, currentUser.userId);

  if (!belongsToCurrentUser || !getMovementPending(item)) {
    return false;
  }

  if (item.action_required === false) {
    return true;
  }

  if (
    item.notification_type === 'movement_added' ||
    item.notification_type === 'movement_created' ||
    item.notification_type === 'pending_response' ||
    item.notification_type === 'approval_waiting'
  ) {
    return true;
  }

  return (
    isSameUserId(movement?.customer?.user_id, currentUser.userId) &&
    item.notification_type !== 'approval_needed'
  );
}

function getMovementPending(item: NotificationItem) {
  const movement = item.movement as any;
  const rawStatus = getRawStatus(item);

  if (movement && isPendingMovement(movement)) return true;

  return (
    rawStatus === 'pending' ||
    item.notification_type === 'approval_needed' ||
    item.notification_type === 'movement_added'
  ) && rawStatus !== 'approved' && rawStatus !== 'rejected';
}

function getCreatorDisplayName(item: NotificationItem, currentUser: CurrentUserInfo) {
  const movement = item.movement as any;

  if (
    isNotificationCreatedByCurrentUser(item, currentUser) ||
    isSelfPendingInfoNotification(item, currentUser)
  ) {
    return 'أنشأها: أنا';
  }

  const name =
    movement?.created_by_user_name ||
    item.actor_name ||
    item.extra_data?.created_by_name ||
    item.extra_data?.creator_full_name ||
    item.extra_data?.creator_user_name ||
    'الطرف الآخر';

  return `أنشأها: ${name}`;
}

function canTakeApprovalAction(item: NotificationItem, currentUser: CurrentUserInfo) {
  if (item.notification_type !== 'approval_needed' || !item.movement_id) {
    return false;
  }

  if (
    isNotificationCreatedByCurrentUser(item, currentUser) ||
    isSelfPendingInfoNotification(item, currentUser)
  ) {
    return false;
  }

  const rawStatus = getRawStatus(item);
  const movementPending = getMovementPending(item);
  const stillNeedsAction = item.action_required !== false;

  return stillNeedsAction
    && movementPending
    && rawStatus !== 'approved'
    && rawStatus !== 'rejected'
    && rawStatus !== 'done';
}

function getCompactNotificationMeta(item: NotificationItem, currentUser: CurrentUserInfo): CompactNotificationMeta {
  const movement = item.movement as any;
  const amount = item.amount ?? movement?.amount;
  const currency = item.currency || movement?.currency;
  const movementType = item.movement_type || movement?.movement_type;
  const rawStatus = getRawStatus(item);
  const isUnread = isUnreadNotification(item);
  const rejectReason = item.extra_data?.reject_reason || item.extra_data?.reason;
  const customerName = item.customer_name || movement?.customer?.name || 'العميل';
  const isCreatedByMe = isNotificationCreatedByCurrentUser(item, currentUser);
  const isPending = getMovementPending(item);
  const canTakeAction = canTakeApprovalAction(item, currentUser);
  const actorLabel = getCreatorDisplayName(item, currentUser);
  const isIncoming = movementType === 'incoming';
  const isOutgoing = movementType === 'outgoing';

  let directionLabel = 'حركة';
  let directionColor = '#2563EB';

  if (isIncoming) {
    directionLabel = 'له';
    directionColor = '#059669';
  } else if (isOutgoing) {
    directionLabel = 'عليه';
    directionColor = '#DC2626';
  }

  let statusText = 'معلومات';
  let statusColor = '#475569';
  let statusBg = '#F1F5F9';
  let rowBorderColor = '#E5E7EB';
  let rowBg = '#FFFFFF';
  let visualState: NotificationVisualState = 'info';

  if (canTakeAction) {
    statusText = 'تحتاج إجراء';
    statusColor = '#B45309';
    statusBg = '#FEF3C7';
    rowBorderColor = '#F59E0B';
    rowBg = '#FFFBEB';
    visualState = 'action';
  } else if (isPending) {
    statusText = 'معلقة';
    statusColor = '#B45309';
    statusBg = '#FEF3C7';
    rowBorderColor = '#FBBF24';
    rowBg = '#FFFBEB';
    visualState = 'pending';
  } else if (item.notification_type === 'movement_rejected' || rawStatus === 'rejected') {
    statusText = 'مرفوضة';
    statusColor = '#B91C1C';
    statusBg = '#FEE2E2';
    rowBorderColor = '#FECACA';
    rowBg = '#FEF2F2';
    visualState = 'rejected';
  } else if (item.notification_type === 'movement_approved' || rawStatus === 'approved') {
    statusText = 'مقبولة';
    statusColor = '#047857';
    statusBg = '#DCFCE7';
    rowBorderColor = '#BBF7D0';
    rowBg = '#F0FDF4';
    visualState = 'approved';
  }

  const createdDate = new Date(item.created_at);

  return {
    amountText: formatAmount(amount, currency),
    directionLabel,
    directionColor,
    actorLabel,
    customerName,
    statusText,
    statusColor,
    statusBg,
    rowBorderColor,
    rowBg,
    dateText: format(createdDate, 'dd/MM/yyyy'),
    timeText: format(createdDate, 'HH:mm', { locale: ar }),
    isUnread,
    canTakeAction,
    isPending,
    isCreatedByMe,
    visualState,
    rejectReason,
  };
}

function stopPressPropagation(event?: GestureResponderEvent) {
  event?.stopPropagation?.();
}

export default function NotificationsTabScreen() {
  const router = useRouter();
  const { currentUser } = useAuth();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<NotificationTab>('all');
  const [processingNotificationId, setProcessingNotificationId] = useState<string | null>(null);
  const [processingAction, setProcessingAction] = useState<'approve' | 'reject' | 'delete' | null>(null);
  const [rejectTarget, setRejectTarget] = useState<NotificationItem | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const loadNotifications = useCallback(async () => {
    if (!currentUser?.userId) return;

    try {
      const { data, error } = await supabase
        .from('movement_notifications')
        .select(
          `
          *,
          movement:account_movements!movement_id(
            movement_number,
            amount,
            currency,
            movement_type,
            is_voided,
            approval_status,
            pending_approval,
            created_by_user_id,
            created_by_user_name,
            source_user_id,
            customer:customers!customer_id(name, user_id, linked_user_id)
          )
        `,
        )
        .eq('user_id', currentUser.userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setNotifications(data || []);
    } catch (error) {
      console.error('Error loading notifications:', error);
      Alert.alert('خطأ', 'تعذر تحميل الإشعارات');
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

  useEffect(() => {
    if (!currentUser?.userId) return;

    const channel = supabase
      .channel('tab-notifications-compact-list')
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
  }, [currentUser?.userId, loadNotifications]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadNotifications();
  };

  const markAsRead = useCallback(async (item: NotificationItem) => {
    if (!item.id || !isUnreadNotification(item)) return;

    const { error } = await supabase
      .from('movement_notifications')
      .update({
        is_read: true,
        status: item.status === 'unread' ? 'read' : item.status,
        read_at: new Date().toISOString(),
      })
      .eq('id', item.id);

    if (!error) {
      setNotifications((current) =>
        current.map((notification) =>
          notification.id === item.id
            ? {
                ...notification,
                is_read: true,
                status: notification.status === 'unread' ? 'read' : notification.status,
                read_at: new Date().toISOString(),
              }
            : notification,
        ),
      );
    }
  }, []);

  const openNotificationDetail = useCallback(async (item: NotificationItem) => {
    await markAsRead(item);
    router.push({
      pathname: '/notification-detail',
      params: { id: item.id },
    });
  }, [markAsRead, router]);

  const handleApproveFromList = useCallback(async (item: NotificationItem) => {
    if (!item.movement_id || !currentUser?.userName) {
      return;
    }

    try {
      setProcessingNotificationId(item.id);
      setProcessingAction('approve');

      const { error } = await supabase.rpc('approve_movement', {
        p_movement_id: item.movement_id,
        p_user_name: currentUser.userName,
      });

      if (error) {
        throw error;
      }

      await loadNotifications();
      Alert.alert('تم القبول', 'تم اعتماد الحركة بنجاح. سيبقى الإشعار في القائمة حتى تحذفه يدويًا.');
    } catch (error: any) {
      console.error('Error approving movement from notifications:', error);
      Alert.alert('خطأ', error.message || 'حدث خطأ أثناء قبول الحركة');
    } finally {
      setProcessingNotificationId(null);
      setProcessingAction(null);
    }
  }, [currentUser?.userName, loadNotifications]);

  const openRejectModal = useCallback((item: NotificationItem) => {
    setRejectTarget(item);
    setRejectReason('');
  }, []);

  const closeRejectModal = useCallback(() => {
    if (processingNotificationId) return;
    setRejectTarget(null);
    setRejectReason('');
  }, [processingNotificationId]);

  const handleRejectFromList = useCallback(async () => {
    if (!rejectTarget?.movement_id || !currentUser?.userName) {
      return;
    }

    const trimmedRejectReason = rejectReason.trim();

    if (!trimmedRejectReason) {
      Alert.alert('تنبيه', 'يرجى كتابة سبب الرفض');
      return;
    }

    try {
      setProcessingNotificationId(rejectTarget.id);
      setProcessingAction('reject');

      const { error } = await supabase.rpc('reject_movement_with_reason', {
        p_movement_id: rejectTarget.movement_id,
        p_user_name: currentUser.userName,
        p_reject_reason: trimmedRejectReason,
      });

      if (error) {
        throw error;
      }

      setRejectTarget(null);
      setRejectReason('');
      await loadNotifications();
      Alert.alert('تم الرفض', 'تم رفض الحركة. سيبقى الإشعار في القائمة حتى تحذفه يدويًا.');
    } catch (error: any) {
      console.error('Error rejecting movement from notifications:', error);
      Alert.alert('خطأ', error.message || 'حدث خطأ أثناء رفض الحركة');
    } finally {
      setProcessingNotificationId(null);
      setProcessingAction(null);
    }
  }, [currentUser?.userName, loadNotifications, rejectReason, rejectTarget]);

  const deleteNotification = useCallback(async (item: NotificationItem) => {
    Alert.alert(
      'حذف الإشعار',
      'سيتم حذف هذا الإشعار من القائمة فقط، ولن يتم حذف الحركة المالية نفسها. هل تريد المتابعة؟',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'حذف',
          style: 'destructive',
          onPress: async () => {
            try {
              setProcessingNotificationId(item.id);
              setProcessingAction('delete');

              const { error } = await supabase
                .from('movement_notifications')
                .delete()
                .eq('id', item.id);

              if (error) throw error;

              setNotifications((current) => current.filter((notification) => notification.id !== item.id));
            } catch (error: any) {
              console.error('Error deleting notification:', error);
              Alert.alert('خطأ', error.message || 'تعذر حذف الإشعار');
            } finally {
              setProcessingNotificationId(null);
              setProcessingAction(null);
            }
          },
        },
      ],
    );
  }, []);

  const summary = useMemo(() => {
    return notifications.reduce(
      (acc, item) => {
        if (isUnreadNotification(item)) acc.unread += 1;
        if (canTakeApprovalAction(item, currentUser)) acc.action += 1;
        acc.all += 1;
        return acc;
      },
      { all: 0, unread: 0, action: 0 },
    );
  }, [notifications, currentUser]);

  const filteredNotifications = useMemo(() => {
    if (activeTab === 'unread') {
      return notifications.filter(isUnreadNotification);
    }

    if (activeTab === 'action') {
      return notifications.filter((item) => canTakeApprovalAction(item, currentUser));
    }

    return notifications;
  }, [activeTab, notifications, currentUser]);

  const filterTabs: { key: NotificationTab; label: string; count: number }[] = [
    { key: 'all', label: 'الكل', count: summary.all },
    { key: 'unread', label: 'غير مقروء', count: summary.unread },
    { key: 'action', label: 'تحتاج إجراء', count: summary.action },
  ];

  const renderHeader = () => (
    <View style={styles.headerBlock}>
      <View style={styles.headerTitleRow}>
        <Text style={styles.headerTitle}>الإشعارات</Text>
        <View style={styles.unreadCounterPill}>
          <Bell size={15} color="#FFFFFF" />
          <Text style={styles.unreadCounterText}>{summary.unread} غير مقروء</Text>
        </View>
      </View>

      <Text style={styles.headerHint}>اضغط على الإشعار لفتح التفاصيل. القبول والرفض والحذف تظهر كأزرار مختصرة فقط.</Text>

      <View style={styles.filterTabs}>
        {filterTabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.filterTab, isActive && styles.filterTabActive]}
              onPress={() => setActiveTab(tab.key)}
              activeOpacity={0.85}
            >
              <Text style={[styles.filterTabText, isActive && styles.filterTabTextActive]}>{tab.label}</Text>
              <View style={[styles.filterCount, isActive && styles.filterCountActive]}>
                <Text style={[styles.filterCountText, isActive && styles.filterCountTextActive]}>{tab.count}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  const renderNotification = ({ item }: { item: NotificationItem }) => {
    const meta = getCompactNotificationMeta(item, currentUser);
    const isProcessingThisRow = processingNotificationId === item.id;

    return (
      <TouchableOpacity
        style={[
          styles.notificationRow,
          {
            backgroundColor: meta.rowBg,
            borderColor: meta.rowBorderColor,
          },
          meta.isUnread && styles.notificationRowUnread,
        ]}
        activeOpacity={0.82}
        onPress={() => openNotificationDetail(item)}
      >
        <View style={styles.actionsRail}>
          {meta.canTakeAction && (
            <>
              <TouchableOpacity
                style={[styles.iconActionButton, styles.acceptIconButton, isProcessingThisRow && styles.buttonDisabled]}
                onPress={(event) => {
                  stopPressPropagation(event);
                  handleApproveFromList(item);
                }}
                disabled={isProcessingThisRow}
              >
                {isProcessingThisRow && processingAction === 'approve' ? (
                  <ActivityIndicator size="small" color="#059669" />
                ) : (
                  <Check size={18} color="#059669" />
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.iconActionButton, styles.rejectIconButton, isProcessingThisRow && styles.buttonDisabled]}
                onPress={(event) => {
                  stopPressPropagation(event);
                  openRejectModal(item);
                }}
                disabled={isProcessingThisRow}
              >
                <X size={18} color="#DC2626" />
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity
            style={[styles.iconActionButton, styles.deleteIconButton, isProcessingThisRow && styles.buttonDisabled]}
            onPress={(event) => {
              stopPressPropagation(event);
              deleteNotification(item);
            }}
            disabled={isProcessingThisRow}
          >
            {isProcessingThisRow && processingAction === 'delete' ? (
              <ActivityIndicator size="small" color="#DC2626" />
            ) : (
              <Trash2 size={17} color="#DC2626" />
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.rowBody}>
          <View style={styles.rowTopLine}>
            <View style={[styles.statusBadge, { backgroundColor: meta.statusBg }]}> 
              <Text style={[styles.statusBadgeText, { color: meta.statusColor }]}>{meta.statusText}</Text>
            </View>
            <View style={styles.dateLine}>
              <Clock size={12} color="#94A3B8" />
              <Text style={styles.dateText}>{meta.dateText}</Text>
              <Text style={styles.timeText}>{meta.timeText}</Text>
            </View>
          </View>

          <View style={styles.mainInfoLine}>
            <View style={styles.amountBlock}>
              <Text style={[styles.amountText, { color: meta.directionColor }]} numberOfLines={1}>{meta.amountText}</Text>
              <Text style={[styles.directionText, { color: meta.directionColor }]}>{meta.directionLabel}</Text>
            </View>
            <View style={styles.creatorBlock}>
              <View style={styles.creatorLine}>
                {meta.isUnread && <View style={styles.unreadDot} />}
                <Text style={styles.creatorText} numberOfLines={1}>{meta.actorLabel}</Text>
              </View>
              <Text style={styles.customerText} numberOfLines={1}>{meta.customerName}</Text>
            </View>
          </View>

          {meta.rejectReason ? (
            <Text style={styles.rejectReasonText} numberOfLines={1}>سبب الرفض: {meta.rejectReason}</Text>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#2563EB" />
          <Text style={styles.loadingText}>جاري تحميل الإشعارات...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredNotifications}
          keyExtractor={(item) => item.id}
          renderItem={renderNotification}
          contentContainerStyle={[
            styles.listContent,
            filteredNotifications.length === 0 && styles.listContentEmpty,
          ]}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
          ListHeaderComponent={renderHeader}
          ListEmptyComponent={
            notifications.length === 0 ? (
              <View style={styles.centerContainer}>
                <View style={styles.emptyIcon}>
                  <Bell size={40} color="#D1D5DB" />
                </View>
                <Text style={styles.emptyTitle}>لا توجد إشعارات</Text>
                <Text style={styles.emptySubtitle}>ستظهر هنا الحركات التي تحتاج مراجعة أو متابعة.</Text>
              </View>
            ) : (
              <View style={styles.filteredEmptyContainer}>
                <Text style={styles.filteredEmptyTitle}>لا توجد إشعارات هنا</Text>
                <Text style={styles.filteredEmptySubtitle}>جرّب تبويبًا آخر.</Text>
              </View>
            )
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      <Modal
        visible={!!rejectTarget}
        transparent
        animationType="fade"
        onRequestClose={closeRejectModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>سبب الرفض</Text>
            <Text style={styles.modalSubtitle}>اكتب توضيحًا مختصرًا حتى يعرف الطرف الآخر سبب الرفض.</Text>
            <TextInput
              style={styles.modalInput}
              multiline
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder="مثال: المبلغ غير صحيح"
              placeholderTextColor="#9CA3AF"
              textAlign="right"
            />
            <View style={styles.modalActionsRow}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={closeRejectModal}
                disabled={processingNotificationId === rejectTarget?.id}
              >
                <Text style={styles.modalCancelButtonText}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalConfirmButton,
                  processingNotificationId === rejectTarget?.id && styles.buttonDisabled,
                ]}
                onPress={handleRejectFromList}
                disabled={processingNotificationId === rejectTarget?.id}
              >
                {processingNotificationId === rejectTarget?.id && processingAction === 'reject' ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalConfirmButtonText}>تأكيد الرفض</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  listContent: {
    padding: 14,
    paddingBottom: 32,
  },
  listContentEmpty: {
    flexGrow: 1,
  },
  headerBlock: {
    marginBottom: 10,
  },
  headerTitleRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: '#111827',
    textAlign: 'right',
  },
  unreadCounterPill: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#111827',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  unreadCounterText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  headerHint: {
    marginTop: 8,
    fontSize: 12,
    color: '#64748B',
    lineHeight: 20,
    textAlign: 'right',
  },
  filterTabs: {
    flexDirection: 'row-reverse',
    gap: 8,
    marginTop: 12,
    marginBottom: 2,
  },
  filterTab: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#EEF2F7',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  filterTabActive: {
    backgroundColor: '#111827',
  },
  filterTabText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#475569',
  },
  filterTabTextActive: {
    color: '#FFFFFF',
  },
  filterCount: {
    minWidth: 21,
    height: 21,
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  filterCountActive: {
    backgroundColor: '#1F2937',
  },
  filterCountText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#111827',
  },
  filterCountTextActive: {
    color: '#FFFFFF',
  },
  notificationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingVertical: 9,
    paddingHorizontal: 10,
    marginBottom: 8,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.035,
    shadowRadius: 5,
    elevation: 1,
    gap: 8,
  },
  notificationRowUnread: {
    borderLeftWidth: 4,
    borderLeftColor: '#2563EB',
  },
  actionsRail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 40,
  },
  iconActionButton: {
    width: 31,
    height: 31,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  acceptIconButton: {
    backgroundColor: '#ECFDF5',
  },
  rejectIconButton: {
    backgroundColor: '#FEF2F2',
  },
  deleteIconButton: {
    backgroundColor: '#FFF1F2',
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  rowBody: {
    flex: 1,
  },
  rowTopLine: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    minWidth: 74,
    alignItems: 'center',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '900',
  },
  dateLine: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 5,
  },
  dateText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '800',
  },
  timeText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
  },
  mainInfoLine: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  amountBlock: {
    alignItems: 'flex-start',
    minWidth: 118,
  },
  amountText: {
    fontSize: 16,
    fontWeight: '900',
  },
  directionText: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '900',
  },
  creatorBlock: {
    flex: 1,
    alignItems: 'flex-end',
  },
  creatorLine: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
  },
  creatorText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#111827',
    textAlign: 'right',
  },
  customerText: {
    marginTop: 3,
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '700',
    textAlign: 'right',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2563EB',
  },
  rejectReasonText: {
    marginTop: 6,
    fontSize: 11,
    color: '#991B1B',
    fontWeight: '700',
    textAlign: 'right',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
    color: '#64748B',
  },
  emptyIcon: {
    width: 82,
    height: 82,
    borderRadius: 41,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: '#334155',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 22,
  },
  filteredEmptyContainer: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  filteredEmptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#334155',
    marginBottom: 6,
  },
  filteredEmptySubtitle: {
    fontSize: 13,
    color: '#94A3B8',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#111827',
    textAlign: 'right',
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'right',
    lineHeight: 22,
    marginTop: 8,
  },
  modalInput: {
    minHeight: 110,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#111827',
    textAlignVertical: 'top',
    marginTop: 16,
    backgroundColor: '#F8FAFC',
  },
  modalActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  modalCancelButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelButtonText: {
    color: '#374151',
    fontSize: 14,
    fontWeight: '800',
  },
  modalConfirmButton: {
    flex: 1,
    backgroundColor: '#DC2626',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalConfirmButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
});
