import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Bell,
  Check,
  Clock,
  Trash2,
  X,
} from 'lucide-react-native';
import {
  CurrentUserLike,
  getNotificationMeta,
  MovementNotification,
} from '../services/notificationService';

interface NotificationCardProps {
  notification: MovementNotification;
  currentUser?: CurrentUserLike | null;
  onPress: () => void;
  onDelete: (item: MovementNotification) => void | Promise<void>;
  onAccept?: (item: MovementNotification) => void | Promise<void>;
  onReject?: (item: MovementNotification, reason: string) => void | Promise<void>;
  isDeleting?: boolean;
  isProcessing?: boolean;
  showCustomer?: boolean;
  unreadColor?: string;
}

export default function NotificationCard({
  notification,
  currentUser,
  onPress,
  onDelete,
  onAccept,
  onReject,
  isDeleting = false,
  isProcessing = false,
  unreadColor = '#10B981',
}: NotificationCardProps) {
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const meta = getNotificationMeta(notification, currentUser);
  const canUseQuickAction = meta.canTakeAction && Boolean(onAccept && onReject);

  // اتجاه الحركة من نفس منطق المشروع
  const movementType =
    notification.movement_type || notification.movement?.movement_type || '';
  const isIncoming = movementType === 'incoming';
  const isOutgoing = movementType === 'outgoing';
  const isInternal = movementType === 'internal_transfer';

  const iconBg = isIncoming
    ? '#DCFCE7'
    : isOutgoing
      ? '#FEE2E2'
      : isInternal
        ? '#EDE9FE'
        : '#DBEAFE';
  const badgeBg = iconBg;
  const badgeText = isIncoming
    ? '#047857'
    : isOutgoing
      ? '#B91C1C'
      : isInternal
        ? '#5B21B6'
        : '#1E40AF';

  const DirectionIcon = isIncoming
    ? ArrowUp
    : isOutgoing
      ? ArrowDown
      : isInternal
        ? ArrowLeftRight
        : Bell;

  const handleAcceptPress = () => {
    if (!onAccept || isProcessing) return;
    Alert.alert('قبول الحركة', 'هل تريد قبول هذه الحركة واعتمادها؟', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'قبول',
        onPress: async () => {
          try {
            await onAccept(notification);
            Alert.alert('تم القبول', 'تم اعتماد الحركة بنجاح.');
          } catch (error: any) {
            Alert.alert('خطأ', error?.message || 'تعذر قبول الحركة');
          }
        },
      },
    ]);
  };

  const handleRejectConfirm = async () => {
    if (!onReject || isProcessing) return;
    const trimmed = rejectReason.trim();
    if (!trimmed) {
      Alert.alert('تنبيه', 'يرجى كتابة سبب الرفض');
      return;
    }
    try {
      await onReject(notification, trimmed);
      setShowRejectModal(false);
      setRejectReason('');
      Alert.alert('تم الرفض', 'تم رفض الحركة وحفظ سبب الرفض.');
    } catch (error: any) {
      Alert.alert('خطأ', error?.message || 'تعذر رفض الحركة');
    }
  };

  // أيقونة الحالة في الشريط السفلي
  const renderStatusIcon = () => {
    const txt = meta.statusText;
    if (txt === 'مقبولة') return <Check size={14} color={meta.statusColor} strokeWidth={2.5} />;
    if (txt === 'مرفوضة') return <X size={14} color={meta.statusColor} strokeWidth={2.5} />;
    if (txt === 'تحتاج إجراء' || txt === 'معلقة')
      return <Clock size={14} color={meta.statusColor} strokeWidth={2.5} />;
    return null;
  };

  return (
    <>
      <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={styles.card}>
        {/* الصف العلوي: أيقونة + مبلغ + منشئ + شارة + حذف */}
        <View style={styles.topRow}>
          {meta.isUnread && (
            <View style={[styles.unreadDot, { backgroundColor: unreadColor }]} />
          )}

          <View style={[styles.iconCircle, { backgroundColor: iconBg }]}>
            <DirectionIcon size={20} color={badgeText} strokeWidth={2.5} />
          </View>

          <View style={styles.middle}>
            <Text
              style={[styles.amount, { color: meta.directionColor }]}
              numberOfLines={1}
            >
              {meta.amountText}
            </Text>
            <Text style={styles.creator} numberOfLines={1}>
              المنشئ: {meta.actorName}
            </Text>
          </View>

          <View style={[styles.directionBadge, { backgroundColor: badgeBg }]}>
            <Text style={[styles.directionText, { color: badgeText }]}>
              {meta.directionLabel}
            </Text>
          </View>

          <TouchableOpacity
            style={styles.deleteIcon}
            onPress={() => onDelete(notification)}
            disabled={isDeleting || isProcessing}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {isDeleting ? (
              <ActivityIndicator size="small" color="#EF4444" />
            ) : (
              <Trash2 size={16} color="#9CA3AF" />
            )}
          </TouchableOpacity>
        </View>

        {/* الشريط السفلي: حالة العملية + أزرار قبول/رفض */}
        <View
          style={[
            styles.statusRow,
            {
              backgroundColor: meta.statusBg,
              borderTopColor: meta.rowBorderColor,
            },
          ]}
        >
          <View style={styles.statusLeft}>
            {renderStatusIcon()}
            <Text style={[styles.statusText, { color: meta.statusColor }]}>
              {meta.statusText}
            </Text>
          </View>

          {canUseQuickAction ? (
            <View style={styles.actionButtons}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.acceptBtn]}
                onPress={handleAcceptPress}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Check size={12} color="#FFFFFF" strokeWidth={3} />
                    <Text style={styles.actionText}>قبول</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.rejectBtn]}
                onPress={() => setShowRejectModal(true)}
                disabled={isProcessing}
              >
                <X size={12} color="#FFFFFF" strokeWidth={3} />
                <Text style={styles.actionText}>رفض</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </TouchableOpacity>

      {/* مودال سبب الرفض */}
      <Modal
        visible={showRejectModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRejectModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>سبب الرفض</Text>
            <Text style={styles.modalSubtitle}>
              يرجى كتابة سبب رفض هذه الحركة لإبلاغ المنشئ
            </Text>
            <TextInput
              style={styles.reasonInput}
              placeholder="اكتب سبب الرفض هنا..."
              placeholderTextColor="#9CA3AF"
              multiline
              numberOfLines={4}
              value={rejectReason}
              onChangeText={setRejectReason}
              textAlignVertical="top"
              textAlign="right"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalCancelBtn]}
                onPress={() => {
                  setShowRejectModal(false);
                  setRejectReason('');
                }}
                disabled={isProcessing}
              >
                <Text style={styles.modalCancelText}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalConfirmBtn]}
                onPress={handleRejectConfirm}
                disabled={isProcessing || !rejectReason.trim()}
              >
                {isProcessing ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalConfirmText}>تأكيد الرفض</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
    marginBottom: 8,
  },
  topRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: -4,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  middle: {
    flex: 1,
    minWidth: 0,
  },
  amount: {
    fontSize: 22,
    fontWeight: '500',
    textAlign: 'right',
  },
  creator: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 4,
    textAlign: 'right',
  },
  directionBadge: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  directionText: {
    fontSize: 13,
    fontWeight: '500',
  },
  deleteIcon: {
    padding: 4,
  },
  statusRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderTopWidth: 1,
    minHeight: 36,
  },
  statusLeft: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  actionButtons: {
    flexDirection: 'row-reverse',
    gap: 8,
  },
  actionBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
    gap: 4,
    minWidth: 60,
    justifyContent: 'center',
  },
  acceptBtn: {
    backgroundColor: '#059669',
  },
  rejectBtn: {
    backgroundColor: '#DC2626',
  },
  actionText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '500',
    color: '#0F172A',
    textAlign: 'right',
    marginBottom: 6,
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'right',
    marginBottom: 12,
  },
  reasonInput: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    minHeight: 100,
    color: '#0F172A',
    backgroundColor: '#F9FAFB',
  },
  modalActions: {
    flexDirection: 'row-reverse',
    gap: 10,
    marginTop: 16,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalCancelBtn: {
    backgroundColor: '#F3F4F6',
  },
  modalCancelText: {
    color: '#374151',
    fontSize: 14,
    fontWeight: '500',
  },
  modalConfirmBtn: {
    backgroundColor: '#DC2626',
  },
  modalConfirmText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
  },
});