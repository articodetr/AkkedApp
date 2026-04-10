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
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import {
  Bell,
  TrendingUp,
  TrendingDown,
  ChevronLeft,
  ArrowLeftRight,
  Clock,
  Check,
  X,
  Trash2,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { CustomerStatusBadge } from '@/components/customer/CustomerStatusBadge';
import { isPendingMovement } from '@/utils/movementApproval';

interface NotificationItem {
  id: string;
  movement_id: string | null;
  notification_type: string;
  message: string;
  is_read: boolean;
  created_at: string;
  movement_number?: string;
  amount?: number;
  currency?: string;
  movement_type?: string;
  customer_name?: string;
  actor_name?: string;
  extra_data?: {
    reason?: string;
    reject_reason?: string;
  };
  movement?: {
    movement_number: string;
    amount: number;
    currency: string;
    is_voided?: boolean;
    approval_status?: string;
    pending_approval?: boolean;
    customer: {
      name: string;
      linked_user_id?: string | null;
    };
  } | null;
}

type NotificationTab = 'all' | 'action' | 'pending' | 'done';

function formatAmount(amount?: number, currency?: string) {
  if (amount == null) return null;
  return `${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency || ''}`.trim();
}

function getNotificationMeta(item: NotificationItem) {
  const movement = item.movement as any;
  const customerName = item.customer_name || movement?.customer?.name || 'العميل';
  const actorName = item.actor_name || 'الطرف الآخر';
  const amount = item.amount ?? movement?.amount;
  const currency = item.currency || movement?.currency;
  const amountText = formatAmount(amount, currency);
  const isIncoming = item.movement_type === 'incoming';
  const isOutgoing = item.movement_type === 'outgoing';
  const isTransfer = item.movement_type === 'internal_transfer';
  const isPending = isPendingMovement(movement);

  if (item.notification_type === 'approval_needed') {
    return {
      category: 'action' as const,
      title: 'حركة بانتظار الموافقة',
      subtitle: isOutgoing
        ? `قيّد عليك ${actorName} مبلغ ${amountText || ''}`.trim()
        : `قيّد لك ${actorName} مبلغ ${amountText || ''}`.trim(),
      statusText: 'بانتظار الموافقة',
      statusColor: '#B45309',
      statusBg: '#FEF3C7',
      helperText: 'هذه الحركة لن تؤثر في الإجماليات قبل أن تقبلها أو ترفضها.',
      footerText: 'يمكنك القبول أو الرفض مباشرة من هنا أو فتح التفاصيل.',
      ctaText: 'فتح التفاصيل',
      tone: '#F59E0B',
      amountTone: '#EF4444',
      directionLabel: isTransfer ? 'تحويل' : isIncoming ? 'له' : 'عليه',
      iconBg: isOutgoing ? '#FEE2E2' : '#DBEAFE',
      icon: isTransfer ? 'transfer' : isIncoming ? 'incoming' : 'outgoing',
    };
  }

  if (item.notification_type === 'deletion_request') {
    return {
      category: 'action' as const,
      title: 'طلب حذف يحتاج موافقتك',
      subtitle: `يوجد طلب لحذف الحركة ${item.movement_number || movement?.movement_number || ''}`.trim(),
      statusText: 'بحاجة موافقتك',
      statusColor: '#C2410C',
      statusBg: '#FFEDD5',
      helperText: 'راجع تفاصيل الحركة قبل الموافقة على حذفها.',
      footerText: 'يمكنك الموافقة على الحذف أو تجاهل الطلب.',
      ctaText: 'مراجعة الطلب',
      tone: '#F97316',
      amountTone: '#F97316',
      directionLabel: 'حذف',
      iconBg: '#FFEDD5',
      icon: 'deletion',
    };
  }

  if (item.notification_type === 'movement_rejected') {
    return {
      category: 'done' as const,
      title: `تم رفض الحركة من ${actorName}`,
      subtitle: amountText
        ? `تم رفض مبلغ ${amountText} ${isOutgoing ? 'عليه' : 'له'}`
        : 'تم رفض الطلب المرسل',
      statusText: 'مرفوضة',
      statusColor: '#B91C1C',
      statusBg: '#FEE2E2',
      helperText: 'تم رفض هذه الحركة، ولم تدخل في الإجماليات.',
      footerText: item.extra_data?.reject_reason
        ? `سبب الرفض: ${item.extra_data.reject_reason}`
        : 'يمكنك مراجعة التفاصيل لمعرفة سبب الرفض.',
      ctaText: 'عرض التفاصيل',
      tone: '#EF4444',
      amountTone: '#EF4444',
      directionLabel: isTransfer ? 'تحويل' : isIncoming ? 'له' : 'عليه',
      iconBg: '#FEE2E2',
      icon: 'rejected',
    };
  }

  if (item.notification_type === 'movement_approved') {
    return {
      category: 'done' as const,
      title: `تم اعتماد الحركة من ${actorName}`,
      subtitle: amountText
        ? `تم اعتماد مبلغ ${amountText} ${isOutgoing ? 'عليه' : 'له'} مع ${customerName}`
        : `تم اعتماد الحركة مع ${customerName}`,
      statusText: 'مقبولة',
      statusColor: '#15803D',
      statusBg: '#DCFCE7',
      helperText: 'تمت الموافقة على هذه الحركة وأصبحت مؤثرة في الإجماليات.',
      footerText: 'تم اعتماد الطلب بنجاح.',
      ctaText: 'عرض التفاصيل',
      tone: '#10B981',
      amountTone: isOutgoing ? '#EF4444' : '#10B981',
      directionLabel: isTransfer ? 'تحويل' : isIncoming ? 'له' : 'عليه',
      iconBg: '#DCFCE7',
      icon: isTransfer ? 'transfer' : isIncoming ? 'incoming' : 'outgoing',
    };
  }

  if (item.notification_type === 'movement_added' && isPending) {
    return {
      category: 'pending' as const,
      title: 'حركة بانتظار الموافقة',
      subtitle: amountText
        ? `تم تسجيل مبلغ ${amountText} ${isOutgoing ? 'عليه' : 'له'} على ${customerName}`
        : `تم إرسال الطلب إلى ${customerName}`,
      statusText: 'بانتظار الموافقة',
      statusColor: '#B45309',
      statusBg: '#FEF3C7',
      helperText: 'تم إرسال الطلب للطرف الآخر، ولن تؤثر الحركة في الإجماليات حتى يوافق عليها.',
      footerText: 'بانتظار رد الطرف الآخر.',
      ctaText: 'عرض التفاصيل',
      tone: '#F59E0B',
      amountTone: isOutgoing ? '#EF4444' : '#10B981',
      directionLabel: isTransfer ? 'تحويل' : isIncoming ? 'له' : 'عليه',
      iconBg: '#FEF3C7',
      icon: isTransfer ? 'transfer' : isIncoming ? 'incoming' : 'outgoing',
    };
  }

  if (item.notification_type === 'movement_added') {
    return {
      category: 'done' as const,
      title: 'تم تسجيل حركة جديدة',
      subtitle: amountText
        ? `تم تسجيل مبلغ ${amountText} ${isOutgoing ? 'عليه' : 'له'} مع ${customerName}`
        : `تم تسجيل حركة جديدة مع ${customerName}`,
      statusText: 'مقبولة',
      statusColor: '#1D4ED8',
      statusBg: '#DBEAFE',
      helperText: 'يمكنك مراجعة تفاصيل الحركة في أي وقت.',
      footerText: 'تم حفظ الحركة بنجاح.',
      ctaText: 'عرض التفاصيل',
      tone: '#3B82F6',
      amountTone: isOutgoing ? '#EF4444' : '#10B981',
      directionLabel: isTransfer ? 'تحويل' : isIncoming ? 'له' : 'عليه',
      iconBg: '#DBEAFE',
      icon: isTransfer ? 'transfer' : isIncoming ? 'incoming' : 'outgoing',
    };
  }

  return {
    category: 'done' as const,
    title: 'إشعار جديد',
    subtitle: item.message,
    statusText: 'معلومات',
    statusColor: '#4B5563',
    statusBg: '#F3F4F6',
    helperText: 'راجع التفاصيل لمعرفة المزيد.',
    footerText: 'إشعار معلوماتي.',
    ctaText: 'عرض الإشعار',
    tone: '#6B7280',
    amountTone: '#6B7280',
    directionLabel: 'إشعار',
    iconBg: '#F3F4F6',
    icon: 'default',
  };
}

function NotificationIcon({ icon, color }: { icon: string; color: string }) {
  switch (icon) {
    case 'incoming':
      return <TrendingUp size={20} color={color} />;
    case 'outgoing':
      return <TrendingDown size={20} color={color} />;
    case 'transfer':
      return <ArrowLeftRight size={20} color={color} />;
    case 'rejected':
      return <X size={20} color={color} />;
    case 'deletion':
      return <Trash2 size={20} color={color} />;
    default:
      return <Bell size={20} color={color} />;
  }
}

export default function NotificationsTabScreen() {
  const router = useRouter();
  const { currentUser } = useAuth();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<NotificationTab>('all');
  const [processingNotificationId, setProcessingNotificationId] = useState<string | null>(null);
  const [processingAction, setProcessingAction] = useState<'approve' | 'reject' | null>(null);
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
            is_voided,
            approval_status,
            pending_approval,
            customer:customers!customer_id(name, linked_user_id)
          )
        `,
        )
        .eq('user_id', currentUser.userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setNotifications(data || []);
    } catch (error) {
      console.error('Error loading notifications:', error);
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
      .channel('tab-notifications-list')
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

  const removeNotification = useCallback(async (notificationId: string) => {
    const { error } = await supabase.from('movement_notifications').delete().eq('id', notificationId);

    if (error) {
      throw error;
    }
  }, []);

  const closeRejectModal = useCallback(() => {
    if (processingNotificationId) {
      return;
    }

    setRejectTarget(null);
    setRejectReason('');
  }, [processingNotificationId]);

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

      await removeNotification(item.id);
      await loadNotifications();

      Alert.alert('تم القبول', 'تم اعتماد الحركة، وأصبحت مؤثرة في الإجماليات.');
    } catch (error: any) {
      console.error('Error approving movement from notifications:', error);
      Alert.alert('خطأ', error.message || 'حدث خطأ أثناء قبول الحركة');
    } finally {
      setProcessingNotificationId(null);
      setProcessingAction(null);
    }
  }, [currentUser?.userName, loadNotifications, removeNotification]);

  const openRejectModal = useCallback((item: NotificationItem) => {
    setRejectTarget(item);
    setRejectReason('');
  }, []);

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

      Alert.alert('تم الرفض', `تم رفض الحركة، ولن تؤثر في الإجماليات.\n\nسبب الرفض: ${trimmedRejectReason}`);
    } catch (error: any) {
      console.error('Error rejecting movement from notifications:', error);
      Alert.alert('خطأ', error.message || 'حدث خطأ أثناء رفض الحركة');
    } finally {
      setProcessingNotificationId(null);
      setProcessingAction(null);
    }
  }, [currentUser?.userName, loadNotifications, rejectReason, rejectTarget]);

  const summary = useMemo(() => {
    return notifications.reduce(
      (acc, item) => {
        const meta = getNotificationMeta(item);
        acc.all += 1;
        acc[meta.category] += 1;
        return acc;
      },
      { all: 0, action: 0, pending: 0, done: 0 },
    );
  }, [notifications]);

  const filteredNotifications = useMemo(() => {
    if (activeTab === 'all') return notifications;
    return notifications.filter((item) => getNotificationMeta(item).category === activeTab);
  }, [activeTab, notifications]);

  const filterTabs: { key: NotificationTab; label: string; count: number }[] = [
    { key: 'all', label: 'الكل', count: summary.all },
    { key: 'action', label: 'تحتاج إجراء', count: summary.action },
    { key: 'pending', label: 'بانتظار الموافقة', count: summary.pending },
    { key: 'done', label: 'منتهية', count: summary.done },
  ];

  const overviewMessage = useMemo(() => {
    if (summary.action > 0) {
      return {
        title: `لديك ${summary.action} ${summary.action === 1 ? 'طلب يحتاج' : 'طلبات تحتاج'} إجراء`,
        text: 'افتحها الآن. هذه الحركات ما زالت خارج الإجماليات حتى تقبلها أو ترفضها.',
        icon: 'bell' as const,
        accentColor: '#B45309',
        backgroundColor: '#FFFBEB',
        borderColor: '#FCD34D',
        iconBackground: '#FEF3C7',
        targetTab: 'action' as NotificationTab,
      };
    }

    if (summary.pending > 0) {
      return {
        title: `لديك ${summary.pending} ${summary.pending === 1 ? 'حركة معلقة' : 'حركات معلقة'}`,
        text: 'هذه الحركات بانتظار رد الطرف الآخر، ولن تؤثر في الإجماليات قبل الموافقة.',
        icon: 'clock' as const,
        accentColor: '#B45309',
        backgroundColor: '#FFFBEB',
        borderColor: '#FCD34D',
        iconBackground: '#FEF3C7',
        targetTab: 'pending' as NotificationTab,
      };
    }

    return {
      title: 'كل شيء واضح أمامك',
      text: 'ستجد هنا جميع الإشعارات وما يحتاج موافقة وما تم اعتماده بشكل واضح.',
      icon: 'check' as const,
      accentColor: '#047857',
      backgroundColor: '#ECFDF5',
      borderColor: '#A7F3D0',
      iconBackground: '#D1FAE5',
      targetTab: 'all' as NotificationTab,
    };
  }, [summary]);

  const renderHeader = () => (
    <View>
      <View style={styles.headerTopRow}>
        <Text style={styles.headerTitle}>الإشعارات</Text>
        {summary.all > 0 && (
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{summary.all}</Text>
          </View>
        )}
      </View>
      <Text style={styles.headerSubtitle}>رتبنا الإشعارات لتعرف فورًا ما الذي يحتاج إجراء وما الذي ما زال بانتظار الموافقة.</Text>

      <TouchableOpacity
        style={[
          styles.alertBanner,
          {
            backgroundColor: overviewMessage.backgroundColor,
            borderColor: overviewMessage.borderColor,
          },
        ]}
        activeOpacity={0.85}
        onPress={() => setActiveTab(overviewMessage.targetTab)}
      >
        <View
          style={[
            styles.alertBannerIcon,
            { backgroundColor: overviewMessage.iconBackground },
          ]}
        >
          {overviewMessage.icon === 'bell' ? (
            <Bell size={18} color={overviewMessage.accentColor} />
          ) : overviewMessage.icon === 'clock' ? (
            <Clock size={18} color={overviewMessage.accentColor} />
          ) : (
            <Check size={18} color={overviewMessage.accentColor} />
          )}
        </View>
        <View style={styles.alertBannerContent}>
          <Text
            style={[
              styles.alertBannerTitle,
              { color: overviewMessage.accentColor },
            ]}
          >
            {overviewMessage.title}
          </Text>
          <Text
            style={[
              styles.alertBannerText,
              { color: overviewMessage.accentColor },
            ]}
          >
            {overviewMessage.text}
          </Text>
        </View>
      </TouchableOpacity>

      <View style={styles.summaryGrid}>
        <TouchableOpacity style={[styles.summaryCard, styles.summaryAll]} onPress={() => setActiveTab('all')} activeOpacity={0.85}>
          <Text style={styles.summaryValue}>{summary.all}</Text>
          <Text style={styles.summaryLabel}>كل الإشعارات</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.summaryCard, styles.summaryAction]} onPress={() => setActiveTab('action')} activeOpacity={0.85}>
          <Text style={styles.summaryValue}>{summary.action}</Text>
          <Text style={styles.summaryLabel}>تحتاج إجراء</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.summaryCard, styles.summaryPending]} onPress={() => setActiveTab('pending')} activeOpacity={0.85}>
          <Text style={styles.summaryValue}>{summary.pending}</Text>
          <Text style={styles.summaryLabel}>معلقة</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.summaryCard, styles.summaryDone]} onPress={() => setActiveTab('done')} activeOpacity={0.85}>
          <Text style={styles.summaryValue}>{summary.done}</Text>
          <Text style={styles.summaryLabel}>منتهية</Text>
        </TouchableOpacity>
      </View>

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
    const movement = item.movement as any;
    const customerName = item.customer_name || movement?.customer?.name || 'عميل';
    const customerLinkedUserId = movement?.customer?.linked_user_id || null;
    const amount = item.amount ?? movement?.amount;
    const currency = item.currency || movement?.currency;
    const amountText = formatAmount(amount, currency);
    const meta = getNotificationMeta(item);
    const needsAttention = meta.category === 'action';
    const isProcessingThisCard = processingNotificationId === item.id;
    const canApproveFromList = item.notification_type === 'approval_needed' && !!item.movement_id;

    return (
      <TouchableOpacity
        style={[styles.card, needsAttention && styles.cardAttention]}
        activeOpacity={0.88}
        onPress={() =>
          router.push({
            pathname: '/notification-detail',
            params: { id: item.id },
          })
        }
      >
        <View style={styles.cardTop}>
          <View style={styles.cardRight}>
            <View style={[styles.iconCircle, { backgroundColor: meta.iconBg }]}> 
              <NotificationIcon icon={meta.icon} color={meta.tone} />
            </View>
            <View style={styles.cardInfo}>
              <View style={styles.titleRow}>
                <Text style={styles.cardTitle} numberOfLines={1}>{meta.title}</Text>
                {!item.is_read && <View style={styles.unreadDot} />}
              </View>
              <Text style={styles.cardSubtitle} numberOfLines={2}>{meta.subtitle}</Text>
              <Text style={styles.timeText}>
                {format(new Date(item.created_at), 'dd MMM yyyy - HH:mm', { locale: ar })}
              </Text>
            </View>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: meta.statusBg }]}> 
            <Text style={[styles.statusText, { color: meta.statusColor }]}>{meta.statusText}</Text>
          </View>
        </View>

        {amountText && (
          <View style={styles.amountRow}>
            <Text style={[styles.directionText, { color: meta.amountTone }]}>{meta.directionLabel}</Text>
            <Text style={[styles.amountValue, { color: meta.amountTone }]}>{amountText}</Text>
          </View>
        )}

        <View style={styles.helperStrip}>
          <Clock size={14} color="#92400E" />
          <Text style={styles.helperText}>{meta.helperText}</Text>
        </View>

        {(item.extra_data?.reason || item.extra_data?.reject_reason) && (
          <View style={styles.reasonStrip}>
            <Text style={styles.reasonStripText} numberOfLines={2}>
              السبب: {item.extra_data.reason || item.extra_data.reject_reason}
            </Text>
          </View>
        )}

        {canApproveFromList && (
          <View style={styles.inlineActionsRow}>
            <TouchableOpacity
              style={[
                styles.inlineApproveButton,
                isProcessingThisCard && styles.inlineButtonDisabled,
              ]}
              onPress={() => handleApproveFromList(item)}
              disabled={isProcessingThisCard}
            >
              {isProcessingThisCard && processingAction === 'approve' ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Check size={18} color="#FFFFFF" />
                  <Text style={styles.inlineApproveButtonText}>قبول</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.inlineRejectButton,
                isProcessingThisCard && styles.inlineButtonDisabled,
              ]}
              onPress={() => openRejectModal(item)}
              disabled={isProcessingThisCard}
            >
              <X size={18} color="#B91C1C" />
              <Text style={styles.inlineRejectButtonText}>رفض</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.cardFooter}>
          <View style={styles.footerLeft}>
            <Text style={styles.footerHint} numberOfLines={1}>{meta.footerText}</Text>
            {customerName ? (
              <View style={styles.footerCustomerRow}>
                <CustomerStatusBadge linkedUserId={customerLinkedUserId} />
                <Text style={styles.footerCustomer}>{customerName}</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.footerAction}>
            <Text style={styles.footerActionText}>{meta.ctaText}</Text>
            <ChevronLeft size={18} color="#9CA3AF" />
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
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
                    <Bell size={48} color="#D1D5DB" />
                  </View>
                  <Text style={styles.emptyTitle}>لا توجد إشعارات</Text>
                  <Text style={styles.emptySubtitle}>ستظهر هنا الإشعارات المهمة والحركات المعلقة بشكل واضح.</Text>
                </View>
              ) : (
                <View style={styles.filteredEmptyContainer}>
                  <Text style={styles.filteredEmptyTitle}>لا توجد عناصر في هذا القسم</Text>
                  <Text style={styles.filteredEmptySubtitle}>جرّب تبويبًا آخر لعرض بقية الإشعارات.</Text>
                </View>
              )
            }
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>

      <Modal
        visible={!!rejectTarget}
        transparent
        animationType="fade"
        onRequestClose={closeRejectModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>سبب الرفض</Text>
            <Text style={styles.modalSubtitle}>
              اكتب سببًا واضحًا حتى يعرف الطرف الآخر لماذا لم يتم اعتماد الحركة.
            </Text>
            <TextInput
              style={styles.modalInput}
              multiline
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder="اكتب سبب الرفض هنا"
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
                  processingNotificationId === rejectTarget?.id && styles.inlineButtonDisabled,
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
    backgroundColor: '#F9FAFB',
  },
  header: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingTop: 16,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    paddingHorizontal: 20,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 22,
    textAlign: 'right',
    paddingHorizontal: 20,
    marginTop: 8,
  },
  countBadge: {
    backgroundColor: '#EF4444',
    borderRadius: 12,
    minWidth: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  countText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#6B7280',
  },
  emptyIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 22,
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },
  listContentEmpty: {
    flexGrow: 1,
  },
  alertBanner: {
    marginTop: 16,
    marginHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
  },
  alertBannerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertBannerContent: {
    flex: 1,
  },
  alertBannerTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#92400E',
    textAlign: 'right',
    marginBottom: 4,
  },
  alertBannerText: {
    fontSize: 12,
    color: '#B45309',
    textAlign: 'right',
    lineHeight: 20,
  },
  summaryGrid: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 16,
    marginTop: 16,
  },
  summaryCard: {
    width: '48%',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
    borderWidth: 1,
  },
  summaryAll: {
    backgroundColor: '#F3F4F6',
    borderColor: '#D1D5DB',
  },
  summaryAction: {
    backgroundColor: '#FFF7ED',
    borderColor: '#FDBA74',
  },
  summaryPending: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FCD34D',
  },
  summaryDone: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 4,
  },
  summaryLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#374151',
  },
  filterTabs: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
  },
  filterTab: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F3F4F6',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  filterTabActive: {
    backgroundColor: '#111827',
  },
  filterTabText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4B5563',
  },
  filterTabTextActive: {
    color: '#FFFFFF',
  },
  filterCount: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 6,
  },
  filterCountActive: {
    backgroundColor: '#1F2937',
  },
  filterCountText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#111827',
  },
  filterCountTextActive: {
    color: '#FFFFFF',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  cardAttention: {
    borderColor: '#FBBF24',
    backgroundColor: '#FFFDF7',
  },
  cardTop: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  cardRight: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    gap: 10,
    flex: 1,
  },
  iconCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInfo: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'right',
  },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#2563EB',
    marginTop: 6,
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#374151',
    textAlign: 'right',
    lineHeight: 21,
    marginTop: 4,
  },
  timeText: {
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'right',
    marginTop: 6,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  amountRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 12,
  },
  amountValue: {
    fontSize: 18,
    fontWeight: '800',
  },
  directionText: {
    fontSize: 13,
    fontWeight: '800',
  },
  helperStrip: {
    marginTop: 10,
    backgroundColor: '#FFFBEB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  helperText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 20,
    color: '#92400E',
    textAlign: 'right',
    fontWeight: '600',
  },
  reasonStrip: {
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 10,
    borderRightWidth: 3,
    borderRightColor: '#EF4444',
  },
  reasonStripText: {
    fontSize: 12,
    color: '#991B1B',
    textAlign: 'right',
    lineHeight: 20,
  },
  inlineActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  inlineApproveButton: {
    flex: 1,
    backgroundColor: '#10B981',
    borderRadius: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  inlineRejectButton: {
    flex: 1,
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  inlineApproveButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  inlineRejectButtonText: {
    color: '#B91C1C',
    fontSize: 14,
    fontWeight: '800',
  },
  inlineButtonDisabled: {
    opacity: 0.7,
  },
  cardFooter: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    gap: 12,
  },
  footerLeft: {
    flex: 1,
  },
  footerHint: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'right',
    marginBottom: 2,
  },
  footerCustomer: {
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'right',
  },
  footerCustomerRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  footerAction: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
  },
  footerActionText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#111827',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(17, 24, 39, 0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'right',
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#6B7280',
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
    backgroundColor: '#F9FAFB',
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
    fontWeight: '700',
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
    fontWeight: '800',
  },
  filteredEmptyContainer: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  filteredEmptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 6,
  },
  filteredEmptySubtitle: {
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
  },
});
