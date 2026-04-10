import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  ArrowRight,
  Check,
  X,
  TrendingUp,
  TrendingDown,
  ArrowLeftRight,
  Clock,
  User,
  FileText,
  Trash2,
  Bell,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { CustomerStatusBadge } from '@/components/customer/CustomerStatusBadge';
import { isPendingMovement } from '@/utils/movementApproval';

interface NotificationDetail {
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

function formatAmount(amount?: number, currency?: string) {
  if (amount == null) return null;
  return `${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency || ''}`.trim();
}

function getNotificationMeta(notification: NotificationDetail) {
  const movement = notification.movement as any;
  const customerName = notification.customer_name || movement?.customer?.name || 'العميل';
  const actorName = notification.actor_name || 'الطرف الآخر';
  const amount = notification.amount ?? movement?.amount;
  const currency = notification.currency || movement?.currency;
  const amountText = formatAmount(amount, currency);
  const isIncoming = notification.movement_type === 'incoming';
  const isOutgoing = notification.movement_type === 'outgoing';
  const isTransfer = notification.movement_type === 'internal_transfer';
  const isPending = isPendingMovement(movement);

  if (notification.notification_type === 'approval_needed') {
    return {
      title: 'حركة بانتظار الموافقة',
      subtitle: isOutgoing
        ? `قيّد عليك ${actorName} مبلغ ${amountText || ''}`.trim()
        : `قيّد لك ${actorName} مبلغ ${amountText || ''}`.trim(),
      statusText: 'بانتظار الموافقة',
      statusColor: '#B45309',
      statusBg: '#FEF3C7',
      helperText: 'هذه الحركة لن تؤثر في الإجماليات قبل أن تقبلها أو ترفضها.',
      actionTitle: 'المطلوب الآن',
      actionText: 'راجع المبلغ والتفاصيل، ثم اختر قبول لاعتماد الحركة أو رفض لإبقائها خارج الحساب مع توضيح السبب للطرف الآخر.',
      primaryText: 'قبول واعتماد الحركة',
      secondaryText: 'رفض الطلب',
      infoTone: '#F59E0B',
      iconBg: isOutgoing ? '#FEE2E2' : '#DBEAFE',
      icon: isTransfer ? 'transfer' : isIncoming ? 'incoming' : 'outgoing',
      directionLabel: isTransfer ? 'تحويل داخلي' : isIncoming ? 'له' : 'عليه',
      amountTone: isOutgoing ? '#EF4444' : '#10B981',
      isAction: true,
    };
  }

  if (notification.notification_type === 'deletion_request') {
    return {
      title: 'طلب حذف يحتاج موافقتك',
      subtitle: `يوجد طلب لحذف الحركة ${notification.movement_number || movement?.movement_number || ''}`.trim(),
      statusText: 'بحاجة موافقتك',
      statusColor: '#C2410C',
      statusBg: '#FFEDD5',
      helperText: 'راجع تفاصيل الحركة قبل الموافقة على حذفها.',
      actionTitle: 'المطلوب الآن',
      actionText: 'إذا كانت الحركة يجب أن تُحذف فعلًا فوافق على الحذف، وإلا يمكنك تجاهل الطلب.',
      primaryText: 'الموافقة على الحذف',
      secondaryText: 'تجاهل',
      infoTone: '#F97316',
      iconBg: '#FFEDD5',
      icon: 'deletion',
      directionLabel: 'طلب حذف',
      amountTone: '#F97316',
      isAction: true,
    };
  }

  if (notification.notification_type === 'movement_rejected') {
    return {
      title: `تم رفض الحركة من ${actorName}`,
      subtitle: amountText
        ? `تم رفض مبلغ ${amountText} ${isOutgoing ? 'عليه' : 'له'}`
        : 'تم رفض الطلب المرسل',
      statusText: 'مرفوضة',
      statusColor: '#B91C1C',
      statusBg: '#FEE2E2',
      helperText: 'تم رفض هذه الحركة، ولم تدخل في الإجماليات.',
      actionTitle: 'النتيجة',
      actionText: 'يمكنك مراجعة سبب الرفض واتخاذ الإجراء المناسب إذا احتجت ذلك.',
      primaryText: 'تمت القراءة',
      secondaryText: '',
      infoTone: '#EF4444',
      iconBg: '#FEE2E2',
      icon: 'rejected',
      directionLabel: isTransfer ? 'تحويل داخلي' : isIncoming ? 'له' : 'عليه',
      amountTone: '#EF4444',
      isAction: false,
    };
  }

  if (notification.notification_type === 'movement_approved') {
    return {
      title: `تم اعتماد الحركة من ${actorName}`,
      subtitle: amountText
        ? `تم اعتماد مبلغ ${amountText} ${isOutgoing ? 'عليه' : 'له'} مع ${customerName}`
        : `تم اعتماد الحركة مع ${customerName}`,
      statusText: 'مقبولة',
      statusColor: '#15803D',
      statusBg: '#DCFCE7',
      helperText: 'تمت الموافقة على هذه الحركة وأصبحت مؤثرة في الإجماليات.',
      actionTitle: 'النتيجة',
      actionText: 'أصبحت هذه الحركة الآن جزءًا من الإجماليات ويمكنك الرجوع إليها من كشف الحركات في أي وقت.',
      primaryText: 'تمت القراءة',
      secondaryText: '',
      infoTone: '#10B981',
      iconBg: '#DCFCE7',
      icon: isTransfer ? 'transfer' : isIncoming ? 'incoming' : 'outgoing',
      directionLabel: isTransfer ? 'تحويل داخلي' : isIncoming ? 'له' : 'عليه',
      amountTone: isOutgoing ? '#EF4444' : '#10B981',
      isAction: false,
    };
  }

  if (notification.notification_type === 'movement_added' && isPending) {
    return {
      title: 'حركة بانتظار الموافقة',
      subtitle: amountText
        ? `تم تسجيل مبلغ ${amountText} ${isOutgoing ? 'عليه' : 'له'} على ${customerName}`
        : `تم إرسال الطلب إلى ${customerName}`,
      statusText: 'بانتظار الموافقة',
      statusColor: '#B45309',
      statusBg: '#FEF3C7',
      helperText: 'تم إرسال الطلب للطرف الآخر، ولن تؤثر الحركة في الإجماليات حتى يوافق عليها.',
      actionTitle: 'ماذا يعني ذلك؟',
      actionText: 'الطلب مسجل بانتظار قرار الطرف الآخر. إذا تمت الموافقة فستظهر الحركة في الحساب، وإذا رُفضت فستبقى خارج الإجماليات.',
      primaryText: 'تمت القراءة',
      secondaryText: '',
      infoTone: '#F59E0B',
      iconBg: '#FEF3C7',
      icon: isTransfer ? 'transfer' : isIncoming ? 'incoming' : 'outgoing',
      directionLabel: isTransfer ? 'تحويل داخلي' : isIncoming ? 'له' : 'عليه',
      amountTone: isOutgoing ? '#EF4444' : '#10B981',
      isAction: false,
    };
  }

  if (notification.notification_type === 'movement_added') {
    return {
      title: 'تم تسجيل حركة جديدة',
      subtitle: amountText
        ? `تم تسجيل مبلغ ${amountText} ${isOutgoing ? 'عليه' : 'له'} مع ${customerName}`
        : `تم تسجيل حركة جديدة مع ${customerName}`,
      statusText: 'مقبولة',
      statusColor: '#1D4ED8',
      statusBg: '#DBEAFE',
      helperText: 'يمكنك مراجعة تفاصيل الحركة في أي وقت.',
      actionTitle: 'النتيجة',
      actionText: 'تم حفظ الحركة بنجاح ويمكنك الرجوع إليها لاحقًا من كشف الحركات.',
      primaryText: 'تمت القراءة',
      secondaryText: '',
      infoTone: '#3B82F6',
      iconBg: '#DBEAFE',
      icon: isTransfer ? 'transfer' : isIncoming ? 'incoming' : 'outgoing',
      directionLabel: isTransfer ? 'تحويل داخلي' : isIncoming ? 'له' : 'عليه',
      amountTone: isOutgoing ? '#EF4444' : '#10B981',
      isAction: false,
    };
  }

  return {
    title: 'إشعار جديد',
    subtitle: notification.message,
    statusText: 'معلومات',
    statusColor: '#4B5563',
    statusBg: '#F3F4F6',
    helperText: 'راجع التفاصيل لمعرفة المزيد.',
    actionTitle: 'معلومات إضافية',
    actionText: 'هذا إشعار معلوماتي فقط.',
    primaryText: 'تمت القراءة',
    secondaryText: '',
    infoTone: '#6B7280',
    iconBg: '#F3F4F6',
    icon: 'default',
    directionLabel: 'إشعار',
    amountTone: '#6B7280',
    isAction: false,
  };
}

function DetailIcon({ icon, color }: { icon: string; color: string }) {
  switch (icon) {
    case 'incoming':
      return <TrendingUp size={32} color={color} />;
    case 'outgoing':
      return <TrendingDown size={32} color={color} />;
    case 'transfer':
      return <ArrowLeftRight size={32} color={color} />;
    case 'rejected':
      return <X size={32} color={color} />;
    case 'deletion':
      return <Trash2 size={32} color={color} />;
    default:
      return <Bell size={32} color={color} />;
  }
}

export default function NotificationDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { currentUser } = useAuth();

  const [notification, setNotification] = useState<NotificationDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const loadNotification = useCallback(async () => {
    if (!id) return;

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
        .eq('id', id)
        .maybeSingle();

      if (error) throw error;
      setNotification(data);
    } catch (error) {
      console.error('Error loading notification:', error);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadNotification();
  }, [loadNotification]);

  const markAsReadAndRemove = async (notificationId: string) => {
    try {
      await supabase.from('movement_notifications').delete().eq('id', notificationId);
    } catch (error) {
      console.error('Error deleting notification:', error);
    }
  };

  const handleApprove = async () => {
    if (!notification?.movement_id || !currentUser?.userName) return;

    try {
      setIsProcessing(true);

      const { error } = await supabase.rpc('approve_movement', {
        p_movement_id: notification.movement_id,
        p_user_name: currentUser.userName,
      });

      if (error) throw error;

      await markAsReadAndRemove(notification.id);
      Alert.alert('تم القبول', 'تم اعتماد الحركة، وأصبحت مؤثرة في الإجماليات.', [
        { text: 'حسنًا', onPress: () => router.back() },
      ]);
    } catch (error: any) {
      console.error('Error approving:', error);
      Alert.alert('خطأ', error.message || 'حدث خطأ أثناء القبول');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!notification?.movement_id || !currentUser?.userName) return;
    const trimmedRejectReason = rejectReason.trim();

    if (!trimmedRejectReason) {
      Alert.alert('تنبيه', 'يرجى كتابة سبب الرفض');
      return;
    }

    try {
      setIsProcessing(true);
      setShowRejectModal(false);

      const { data, error } = await supabase.rpc('reject_movement_with_reason', {
        p_movement_id: notification.movement_id,
        p_user_name: currentUser.userName,
        p_reject_reason: trimmedRejectReason,
      });

      if (error) throw error;

      await markAsReadAndRemove(notification.id);
      Alert.alert(
        'تم الرفض',
        `تم رفض الحركة، ولن تؤثر في الإجماليات.\n\nسبب الرفض: ${trimmedRejectReason}`,
        [{ text: 'حسنًا', onPress: () => router.back() }],
      );
    } catch (error: any) {
      console.error('Error rejecting:', error);
      Alert.alert('خطأ', error.message || 'حدث خطأ أثناء الرفض');
    } finally {
      setIsProcessing(false);
      setRejectReason('');
    }
  };

  const handleApproveDeletion = async () => {
    if (!notification?.movement_id || !currentUser?.userName) return;

    Alert.alert('الموافقة على الحذف', 'هل أنت متأكد من الموافقة على حذف هذه الحركة؟', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'موافقة',
        style: 'destructive',
        onPress: async () => {
          try {
            setIsProcessing(true);
            const { error } = await supabase.rpc('approve_movement_deletion', {
              p_movement_id: notification.movement_id,
              p_user_name: currentUser.userName,
            });

            if (error) throw error;

            await markAsReadAndRemove(notification.id);
            Alert.alert('تمت الموافقة', 'تمت الموافقة على حذف الحركة بنجاح.', [
              { text: 'حسنًا', onPress: () => router.back() },
            ]);
          } catch (error: any) {
            console.error('Error approving deletion:', error);
            Alert.alert('خطأ', error.message || 'حدث خطأ أثناء الموافقة');
          } finally {
            setIsProcessing(false);
          }
        },
      },
    ]);
  };

  const handleAcknowledge = async () => {
    if (!notification) return;
    setIsProcessing(true);
    await markAsReadAndRemove(notification.id);
    router.back();
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563EB" />
        <Text style={styles.loadingText}>جاري تحميل تفاصيل الإشعار...</Text>
      </View>
    );
  }

  if (!notification) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.emptyText}>الإشعار غير موجود أو تم حذفه</Text>
        <TouchableOpacity style={styles.goBackBtn} onPress={() => router.back()}>
          <Text style={styles.goBackText}>العودة</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const movement = notification.movement as any;
  const customerName = notification.customer_name || movement?.customer?.name || 'عميل';
  const customerLinkedUserId = movement?.customer?.linked_user_id || null;
  const amount = notification.amount ?? movement?.amount;
  const currency = notification.currency || movement?.currency;
  const amountText = formatAmount(amount, currency);
  const meta = getNotificationMeta(notification);
  const needsApproval = notification.notification_type === 'approval_needed';
  const isDeletionRequest = notification.notification_type === 'deletion_request';
  const showInfoAcknowledge = !needsApproval && !isDeletionRequest;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ArrowRight size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>تفاصيل الإشعار</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent}>
        <View style={styles.heroCard}>
          <View style={[styles.heroIcon, { backgroundColor: meta.iconBg }]}>
            <DetailIcon icon={meta.icon} color={meta.infoTone} />
          </View>

          <View style={[styles.statusBadge, { backgroundColor: meta.statusBg }]}> 
            <Text style={[styles.statusText, { color: meta.statusColor }]}>{meta.statusText}</Text>
          </View>

          <Text style={styles.heroTitle}>{meta.title}</Text>
          <Text style={styles.heroSubtitle}>{meta.subtitle}</Text>

          {amountText && (
            <View style={styles.heroAmountBox}>
              <Text style={[styles.heroDirection, { color: meta.amountTone }]}>{meta.directionLabel}</Text>
              <Text style={[styles.heroAmount, { color: meta.amountTone }]}>{amountText}</Text>
            </View>
          )}
        </View>

        <View style={styles.noticeBox}>
          <Bell size={16} color="#92400E" />
          <Text style={styles.noticeText}>{meta.helperText}</Text>
        </View>

        <View style={styles.actionInfoCard}>
          <Text style={styles.sectionTitle}>{meta.actionTitle}</Text>
          <Text style={styles.sectionBody}>{meta.actionText}</Text>
        </View>

        <View style={styles.detailsCard}>
          <View style={styles.detailRow}>
            <View style={styles.detailValueBlock}>
              <View style={styles.detailValueHeader}>
                <CustomerStatusBadge linkedUserId={customerLinkedUserId} />
                <Text style={styles.detailValue}>{customerName}</Text>
              </View>
            </View>
            <View style={styles.detailLabel}>
              <Text style={styles.detailLabelText}>العميل</Text>
              <User size={16} color="#6B7280" />
            </View>
          </View>

          {(notification.movement_number || movement?.movement_number) && (
            <View style={styles.detailRow}>
              <Text style={styles.detailValue}>{notification.movement_number || movement?.movement_number}</Text>
              <View style={styles.detailLabel}>
                <Text style={styles.detailLabelText}>رقم الحركة</Text>
                <FileText size={16} color="#6B7280" />
              </View>
            </View>
          )}

          {notification.actor_name && (
            <View style={styles.detailRow}>
              <Text style={styles.detailValue}>{notification.actor_name}</Text>
              <View style={styles.detailLabel}>
                <Text style={styles.detailLabelText}>بواسطة</Text>
                <User size={16} color="#6B7280" />
              </View>
            </View>
          )}

          <View style={styles.detailRow}>
            <Text style={styles.detailValue}>
              {format(new Date(notification.created_at), 'dd MMMM yyyy - HH:mm', { locale: ar })}
            </Text>
            <View style={styles.detailLabel}>
              <Text style={styles.detailLabelText}>التاريخ</Text>
              <Clock size={16} color="#6B7280" />
            </View>
          </View>
        </View>

        <View style={styles.messageCard}>
          <Text style={styles.sectionTitle}>نص الإشعار</Text>
          <Text style={styles.sectionBody}>{notification.message}</Text>
        </View>

        {(notification.extra_data?.reason || notification.extra_data?.reject_reason) && (
          <View style={styles.reasonCard}>
            <Text style={styles.reasonTitle}>سبب الرفض</Text>
            <Text style={styles.reasonBody}>
              {notification.extra_data.reason || notification.extra_data.reject_reason}
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.actionsBar}>
        {needsApproval && notification.movement_id && (
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.approveBtn, isProcessing && styles.btnDisabled]}
              onPress={handleApprove}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Check size={20} color="#FFFFFF" />
                  <Text style={styles.approveBtnText}>{meta.primaryText}</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.rejectBtn, isProcessing && styles.btnDisabled]}
              onPress={() => setShowRejectModal(true)}
              disabled={isProcessing}
            >
              <X size={20} color="#FFFFFF" />
              <Text style={styles.rejectBtnText}>{meta.secondaryText}</Text>
            </TouchableOpacity>
          </View>
        )}

        {isDeletionRequest && notification.movement_id && (
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.approveBtn, isProcessing && styles.btnDisabled]}
              onPress={handleApproveDeletion}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Check size={20} color="#FFFFFF" />
                  <Text style={styles.approveBtnText}>{meta.primaryText}</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.acknowledgeOutlineBtn, isProcessing && styles.btnDisabled]}
              onPress={handleAcknowledge}
              disabled={isProcessing}
            >
              <Text style={styles.acknowledgeOutlineText}>{meta.secondaryText}</Text>
            </TouchableOpacity>
          </View>
        )}

        {showInfoAcknowledge && (
          <TouchableOpacity
            style={[styles.fullAcknowledgeBtn, isProcessing && styles.btnDisabled]}
            onPress={handleAcknowledge}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.fullAcknowledgeText}>{meta.primaryText}</Text>
            )}
          </TouchableOpacity>
        )}
      </View>

      <Modal visible={showRejectModal} transparent animationType="fade" onRequestClose={() => setShowRejectModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>سبب الرفض</Text>
            <Text style={styles.modalSubtitle}>اكتب سببًا واضحًا حتى يفهم الطرف الآخر سبب رفض الطلب.</Text>
            <TextInput
              style={styles.rejectInput}
              multiline
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder="اكتب سبب الرفض هنا"
              placeholderTextColor="#9CA3AF"
              textAlign="right"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShowRejectModal(false)}>
                <Text style={styles.modalCancelText}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirmBtn} onPress={handleReject}>
                <Text style={styles.modalConfirmText}>تأكيد الرفض</Text>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
    color: '#6B7280',
  },
  emptyText: {
    fontSize: 16,
    color: '#6B7280',
    marginBottom: 16,
  },
  goBackBtn: {
    backgroundColor: '#111827',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
  },
  goBackText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  header: {
    backgroundColor: '#FFFFFF',
    paddingTop: 16,
    paddingBottom: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
    gap: 12,
  },
  heroCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  heroIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    marginBottom: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '800',
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 8,
  },
  heroSubtitle: {
    fontSize: 14,
    color: '#4B5563',
    textAlign: 'center',
    lineHeight: 24,
  },
  heroAmountBox: {
    width: '100%',
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginTop: 16,
    alignItems: 'center',
  },
  heroDirection: {
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 6,
  },
  heroAmount: {
    fontSize: 24,
    fontWeight: '800',
  },
  noticeBox: {
    backgroundColor: '#FFFBEB',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  noticeText: {
    flex: 1,
    fontSize: 13,
    color: '#92400E',
    textAlign: 'right',
    lineHeight: 22,
    fontWeight: '700',
  },
  actionInfoCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'right',
    marginBottom: 8,
  },
  sectionBody: {
    fontSize: 14,
    color: '#4B5563',
    textAlign: 'right',
    lineHeight: 24,
  },
  detailsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    gap: 14,
  },
  detailRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  detailValue: {
    flex: 1,
    fontSize: 14,
    color: '#111827',
    textAlign: 'right',
    fontWeight: '600',
  },
  detailValueBlock: {
    flex: 1,
    alignItems: 'flex-end',
  },
  detailValueHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    flexWrap: 'wrap',
  },
  detailLabel: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
  },
  detailLabelText: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '700',
  },
  messageCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  reasonCard: {
    backgroundColor: '#FEF2F2',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  reasonTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#991B1B',
    textAlign: 'right',
    marginBottom: 8,
  },
  reasonBody: {
    fontSize: 14,
    color: '#991B1B',
    textAlign: 'right',
    lineHeight: 24,
  },
  actionsBar: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 18,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  actionRow: {
    flexDirection: 'row-reverse',
    gap: 10,
  },
  approveBtn: {
    flex: 1,
    backgroundColor: '#10B981',
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  approveBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  rejectBtn: {
    flex: 1,
    backgroundColor: '#EF4444',
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  rejectBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  acknowledgeOutlineBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#FFFFFF',
  },
  acknowledgeOutlineText: {
    color: '#374151',
    fontSize: 14,
    fontWeight: '700',
  },
  fullAcknowledgeBtn: {
    backgroundColor: '#111827',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullAcknowledgeText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'right',
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'right',
    lineHeight: 22,
    marginBottom: 12,
  },
  rejectInput: {
    minHeight: 120,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 14,
    padding: 12,
    fontSize: 14,
    color: '#111827',
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row-reverse',
    gap: 10,
    marginTop: 16,
  },
  modalCancelBtn: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalCancelText: {
    color: '#374151',
    fontWeight: '700',
  },
  modalConfirmBtn: {
    flex: 1,
    backgroundColor: '#EF4444',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalConfirmText: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
});
