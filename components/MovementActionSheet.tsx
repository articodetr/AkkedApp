import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Easing,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CheckCircle2,
  XCircle,
  FileText,
  X,
  Send,
  ChevronRight,
  Clock3,
  CheckCheck,
  Ban,
} from 'lucide-react-native';

import { supabase } from '@/lib/supabase';
import { AccountMovement, CURRENCIES } from '@/types/database';
import {
  isPendingMovement,
  isMovementCreator,
  isRejectedMovement,
} from '@/utils/movementApproval';
import { formatSmartNumber } from '@/utils/arabicFormat';

interface Props {
  movement: AccountMovement | null;
  currentUserId: string | null;
  currentUserName: string | null;
  onClose: () => void;
  onViewDetails: (movement: AccountMovement) => void;
  onActionDone: () => void;
}

function getCurrencySymbol(code?: string) {
  return CURRENCIES.find((c) => c.code === code)?.symbol || code || '';
}

function formatDate(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mn = String(d.getMinutes()).padStart(2, '0');
  return `${dd}-${mm}-${yyyy}  ${hh}:${mn}`;
}

export function MovementActionSheet({
  movement,
  currentUserId,
  currentUserName,
  onClose,
  onViewDetails,
  onActionDone,
}: Props) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'menu' | 'reject'>('menu');
  const [rejectReason, setRejectReason] = useState('');
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;

  const visible = !!movement;

  useEffect(() => {
    if (visible) {
      setMode('menu');
      setRejectReason('');
      Animated.timing(slideAnim, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else {
      slideAnim.setValue(0);
    }
  }, [visible, slideAnim]);

  if (!movement) return null;

  const isPending = isPendingMovement(movement);
  const isRejected = isRejectedMovement(movement);
  const iAmCreator = isMovementCreator(movement, currentUserId);
  const canActOnIt = isPending && !iAmCreator;

  const isOutgoing = movement.movement_type === 'outgoing';
  const typeLabel = isOutgoing ? 'عليه' : 'له';
  const typeColor = isOutgoing ? '#DC2626' : '#16A34A';
  const typeBg = isOutgoing ? '#FEE2E2' : '#ECFDF5';
  const amount = formatSmartNumber(Number(movement.amount));
  const currencySymbol = getCurrencySymbol(movement.currency);

  let statusLabel = '';
  let statusColor = '#6B7280';
  let statusBg = '#F3F4F6';
  let StatusIcon = Clock3;

  if (isPending) {
    statusLabel = iAmCreator ? 'بانتظار موافقة الطرف الآخر' : 'بانتظار موافقتك';
    statusColor = '#B45309';
    statusBg = '#FEF3C7';
    StatusIcon = Clock3;
  } else if (isRejected) {
    statusLabel = 'مرفوضة';
    statusColor = '#B91C1C';
    statusBg = '#FEE2E2';
    StatusIcon = Ban;
  } else {
    statusLabel = 'مؤكَّدة';
    statusColor = '#047857';
    statusBg = '#ECFDF5';
    StatusIcon = CheckCheck;
  }

  const handleApprove = async () => {
    if (!currentUserName) {
      Alert.alert('خطأ', 'لم يتم التعرف على المستخدم الحالي');
      return;
    }
    setIsApproving(true);
    try {
      const { error } = await supabase.rpc('approve_movement', {
        p_movement_id: movement.id,
        p_user_name: currentUserName,
      });
      if (error) throw error;
      onActionDone();
      onClose();
    } catch (error: any) {
      console.error('Error approving movement:', error);
      Alert.alert('خطأ', error?.message || 'حدث خطأ أثناء التأكيد');
    } finally {
      setIsApproving(false);
    }
  };

  const handleSendReject = async () => {
    if (!currentUserName) {
      Alert.alert('خطأ', 'لم يتم التعرف على المستخدم الحالي');
      return;
    }
    if (!rejectReason.trim()) {
      Alert.alert('تنبيه', 'سبب الرفض مطلوب');
      return;
    }
    setIsRejecting(true);
    try {
      const { error } = await supabase.rpc('reject_movement_with_reason', {
        p_movement_id: movement.id,
        p_user_name: currentUserName,
        p_reject_reason: rejectReason.trim(),
      });
      if (error) throw error;
      onActionDone();
      onClose();
    } catch (error: any) {
      console.error('Error rejecting movement:', error);
      Alert.alert('خطأ', error?.message || 'حدث خطأ أثناء الرفض');
    } finally {
      setIsRejecting(false);
    }
  };

  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [400, 0],
  });

  const isBusy = isApproving || isRejecting;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => !isBusy && onClose()}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableWithoutFeedback onPress={() => !isBusy && onClose()}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>

        <Animated.View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom + 12, 20) },
            { transform: [{ translateY }] },
          ]}
        >
          <View style={styles.handle} />

          <View style={styles.summaryRow}>
            <View style={[styles.typeChip, { backgroundColor: typeBg }]}>
              <Text style={[styles.typeChipText, { color: typeColor }]}>{typeLabel}</Text>
            </View>
            <View style={styles.summaryTextWrap}>
              <Text style={styles.summaryAmount}>
                {amount} <Text style={styles.summaryCurrency}>{currencySymbol}</Text>
              </Text>
              <Text style={styles.summaryDate}>{formatDate(movement.created_at)}</Text>
            </View>
          </View>

          <View style={[styles.statusRow, { backgroundColor: statusBg }]}>
            <StatusIcon size={14} color={statusColor} />
            <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>

          {movement.notes ? (
            <View style={styles.notesBox}>
              <Text style={styles.notesLabel}>ملاحظة</Text>
              <Text style={styles.notesText} numberOfLines={3}>
                {movement.notes}
              </Text>
            </View>
          ) : null}

          {mode === 'menu' ? (
            <View style={styles.actions}>
              {canActOnIt ? (
                <>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnApprove, isBusy && styles.btnDisabled]}
                    onPress={handleApprove}
                    disabled={isBusy}
                    activeOpacity={0.85}
                  >
                    {isApproving ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <>
                        <CheckCircle2 size={18} color="#FFFFFF" />
                        <Text style={styles.btnText}>أكد</Text>
                      </>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.btn, styles.btnReject, isBusy && styles.btnDisabled]}
                    onPress={() => setMode('reject')}
                    disabled={isBusy}
                    activeOpacity={0.85}
                  >
                    <XCircle size={18} color="#FFFFFF" />
                    <Text style={styles.btnText}>أرفض</Text>
                  </TouchableOpacity>
                </>
              ) : null}

              <TouchableOpacity
                style={[styles.btn, styles.btnNeutral]}
                onPress={() => onViewDetails(movement)}
                disabled={isBusy}
                activeOpacity={0.85}
              >
                <FileText size={18} color="#374151" />
                <Text style={[styles.btnText, styles.btnTextNeutral]}>عرض التفاصيل</Text>
                <ChevronRight size={16} color="#9CA3AF" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.btnClose}
                onPress={onClose}
                disabled={isBusy}
                activeOpacity={0.7}
              >
                <Text style={styles.btnCloseText}>إغلاق</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.actions}>
              <Text style={styles.rejectLabel}>سبب الرفض</Text>
              <TextInput
                style={styles.rejectInput}
                placeholder="اكتب سبب الرفض..."
                placeholderTextColor="#9CA3AF"
                value={rejectReason}
                onChangeText={setRejectReason}
                multiline
                numberOfLines={3}
                textAlign="right"
                textAlignVertical="top"
                autoFocus
                editable={!isBusy}
              />

              <TouchableOpacity
                style={[styles.btn, styles.btnReject, isBusy && styles.btnDisabled]}
                onPress={handleSendReject}
                disabled={isBusy}
                activeOpacity={0.85}
              >
                {isRejecting ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Send size={18} color="#FFFFFF" />
                    <Text style={styles.btnText}>إرسال الرفض</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.btnClose}
                onPress={() => setMode('menu')}
                disabled={isBusy}
                activeOpacity={0.7}
              >
                <Text style={styles.btnCloseText}>رجوع</Text>
              </TouchableOpacity>
            </View>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(17, 24, 39, 0.55)',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  handle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#E5E7EB',
    marginBottom: 14,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  typeChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  typeChipText: {
    fontSize: 13,
    fontWeight: '900',
  },
  summaryTextWrap: { flex: 1, alignItems: 'flex-end' },
  summaryAmount: {
    fontSize: 22,
    fontWeight: '900',
    color: '#111827',
    writingDirection: 'rtl',
  },
  summaryCurrency: {
    fontSize: 14,
    fontWeight: '700',
    color: '#6B7280',
  },
  summaryDate: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
    fontWeight: '600',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    alignSelf: 'flex-end',
    marginBottom: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '800',
    writingDirection: 'rtl',
  },
  notesBox: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  notesLabel: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '700',
    marginBottom: 4,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  notesText: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '600',
    textAlign: 'right',
    lineHeight: 20,
    writingDirection: 'rtl',
  },
  actions: { gap: 10 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
  },
  btnApprove: { backgroundColor: '#10B981' },
  btnReject: { backgroundColor: '#EF4444' },
  btnNeutral: {
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  btnDisabled: { opacity: 0.6 },
  btnText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
    writingDirection: 'rtl',
  },
  btnTextNeutral: { color: '#374151', flex: 1, textAlign: 'right' },
  btnClose: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnCloseText: {
    fontSize: 14,
    color: '#6B7280',
    fontWeight: '700',
  },
  rejectLabel: {
    fontSize: 13,
    color: '#374151',
    fontWeight: '700',
    textAlign: 'right',
    writingDirection: 'rtl',
    marginBottom: 4,
  },
  rejectInput: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 12,
    minHeight: 90,
    fontSize: 14,
    color: '#111827',
  },
});
