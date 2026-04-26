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
import { Check, Clock, Trash2, X } from 'lucide-react-native';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
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
  showCustomer = true,
  unreadColor = '#2563EB',
}: NotificationCardProps) {
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const meta = getNotificationMeta(notification, currentUser);
  const createdAt = new Date(notification.created_at);
  const canUseQuickAction = meta.canTakeAction && Boolean(onAccept && onReject);

  const handleAcceptPress = () => {
    if (!onAccept || isProcessing) return;

    Alert.alert(
      'قبول الحركة',
      'هل تريد قبول هذه الحركة واعتمادها؟ سيبقى الإشعار محفوظًا في السجل.',
      [
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
      ],
    );
  };

  const handleRejectConfirm = async () => {
    if (!onReject || isProcessing) return;

    const trimmedReason = rejectReason.trim();
    if (!trimmedReason) {
      Alert.alert('تنبيه', 'يرجى كتابة سبب الرفض');
      return;
    }

    try {
      await onReject(notification, trimmedReason);
      setShowRejectModal(false);
      setRejectReason('');
      Alert.alert('تم الرفض', 'تم رفض الحركة وحفظ سبب الرفض.');
    } catch (error: any) {
      Alert.alert('خطأ', error?.message || 'تعذر رفض الحركة');
    }
  };

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.9}
        style={[
          styles.notificationCard,
          { borderColor: meta.rowBorderColor, backgroundColor: meta.rowBg },
          meta.isUnread && styles.unreadCard,
        ]}
        onPress={onPress}
      >
        <View style={styles.cardTopRow}>
          <View style={styles.titleWrap}>
            <View style={styles.titleRow}>
              {meta.isUnread && <View style={[styles.unreadDot, { backgroundColor: unreadColor }]} />}
              <Text style={styles.cardTitle}>{meta.title}</Text>
            </View>
            <Text style={styles.cardSubtitle} numberOfLines={2}>
              {meta.subtitle}
            </Text>
          </View>

          <TouchableOpacity
            style={styles.deleteButton}
            onPress={() => onDelete(notification)}
            disabled={isDeleting || isProcessing}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {isDeleting ? <ActivityIndicator size="small" color="#EF4444" /> : <Trash2 size={18} color="#EF4444" />}
          </TouchableOpacity>
        </View>

        <View style={styles.infoGrid}>
          {showCustomer ? (
            <View style={styles.infoBox}>
              <Text style={styles.infoLabel}>العميل</Text>
              <Text style={styles.infoValue} numberOfLines={1}>{meta.customerName}</Text>
            </View>
          ) : (
            <View style={styles.infoBox}>
              <Text style={styles.infoLabel}>المنشئ</Text>
              <Text style={styles.infoValue} numberOfLines={1}>{meta.actorName}</Text>
            </View>
          )}
          <View style={styles.infoBox}>
            <Text style={styles.infoLabel}>المبلغ</Text>
            <Text style={[styles.infoValue, { color: meta.directionColor }]} numberOfLines={1}>{meta.amountText}</Text>
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.infoLabel}>النوع</Text>
            <Text style={[styles.infoValue, { color: meta.directionColor }]}>{meta.directionLabel}</Text>
          </View>
        </View>

        <View style={styles.cardFooter}>
          <View style={[styles.statusBadge, { backgroundColor: meta.statusBg }]}> 
            <Text style={[styles.statusText, { color: meta.statusColor }]}>{meta.statusText}</Text>
          </View>
          <View style={styles.dateWrap}>
            <Clock size={14} color="#6B7280" />
            <Text style={styles.dateText}>{format(createdAt, 'dd/MM/yyyy - HH:mm', { locale: ar })}</Text>
          </View>
        </View>

        {meta.rejectReason && (
          <View style={styles.reasonBox}>
            <Text style={styles.reasonText} numberOfLines={2}>سبب الرفض: {meta.rejectReason}</Text>
          </View>
        )}

        {canUseQuickAction && (
          <View style={styles.quickActionsBox}>
            <Text style={styles.quickActionsHint}>يمكنك القبول أو الرفض مباشرة، أو الضغط على الكرت لعرض التفاصيل.</Text>
            <View style={styles.quickActionsRow}>
              <TouchableOpacity
                style={[styles.acceptButton, isProcessing && styles.disabledButton]}
                onPress={handleAcceptPress}
                disabled={isProcessing}
              >
                {isProcessing ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Check size={18} color="#FFFFFF" />}
                <Text style={styles.acceptButtonText}>قبول</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.rejectButton, isProcessing && styles.disabledButton]}
                onPress={() => setShowRejectModal(true)}
                disabled={isProcessing}
              >
                <X size={18} color="#FFFFFF" />
                <Text style={styles.rejectButtonText}>رفض</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </TouchableOpacity>

      <Modal
        visible={showRejectModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRejectModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>سبب رفض الحركة</Text>
            <Text style={styles.modalSubtitle}>اكتب السبب بشكل واضح حتى يظهر في تفاصيل الإشعار.</Text>
            <TextInput
              style={styles.rejectInput}
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder="مثال: المبلغ غير صحيح"
              placeholderTextColor="#94A3B8"
              multiline
              textAlign="right"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => {
                  setShowRejectModal(false);
                  setRejectReason('');
                }}
                disabled={isProcessing}
              >
                <Text style={styles.modalCancelText}>إلغاء</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirmButton, isProcessing && styles.disabledButton]}
                onPress={handleRejectConfirm}
                disabled={isProcessing}
              >
                {isProcessing ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.modalConfirmText}>تأكيد الرفض</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  notificationCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    shadowColor: '#000000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  unreadCard: {
    borderWidth: 1.5,
  },
  cardTopRow: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    gap: 10,
  },
  titleWrap: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  unreadDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
  cardTitle: {
    flex: 1,
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '900',
    textAlign: 'right',
  },
  cardSubtitle: {
    color: '#475569',
    fontSize: 13,
    lineHeight: 21,
    textAlign: 'right',
    marginTop: 6,
  },
  deleteButton: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: '#FEF2F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoGrid: {
    flexDirection: 'row-reverse',
    gap: 8,
    marginTop: 12,
  },
  infoBox: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  infoLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'right',
    marginBottom: 4,
  },
  infoValue: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'right',
  },
  cardFooter: {
    marginTop: 12,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '900',
  },
  dateWrap: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 5,
  },
  dateText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '700',
  },
  reasonBox: {
    marginTop: 10,
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  reasonText: {
    color: '#991B1B',
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'right',
    lineHeight: 19,
  },
  quickActionsBox: {
    marginTop: 12,
    backgroundColor: '#FFFBEB',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FDE68A',
    padding: 10,
  },
  quickActionsHint: {
    color: '#92400E',
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'right',
    lineHeight: 19,
    marginBottom: 10,
  },
  quickActionsRow: {
    flexDirection: 'row-reverse',
    gap: 8,
  },
  acceptButton: {
    flex: 1,
    backgroundColor: '#059669',
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row-reverse',
    gap: 6,
  },
  rejectButton: {
    flex: 1,
    backgroundColor: '#DC2626',
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row-reverse',
    gap: 6,
  },
  acceptButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  rejectButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  disabledButton: {
    opacity: 0.65,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 22,
  },
  modalContent: {
    width: '100%',
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    padding: 18,
  },
  modalTitle: {
    color: '#0F172A',
    fontSize: 19,
    fontWeight: '900',
    textAlign: 'right',
  },
  modalSubtitle: {
    marginTop: 6,
    color: '#64748B',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 20,
    textAlign: 'right',
  },
  rejectInput: {
    marginTop: 14,
    minHeight: 95,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    padding: 12,
    color: '#0F172A',
    fontSize: 14,
    textAlignVertical: 'top',
  },
  modalActions: {
    marginTop: 14,
    flexDirection: 'row-reverse',
    gap: 10,
  },
  modalCancelButton: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalCancelText: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '900',
  },
  modalConfirmButton: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: '#DC2626',
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalConfirmText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
});
