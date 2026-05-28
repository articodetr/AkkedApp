import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Easing,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertTriangle, Scale, Send } from 'lucide-react-native';

import { supabase } from '@/lib/supabase';
import { CURRENCIES } from '@/types/database';
import { formatSmartNumber } from '@/utils/arabicFormat';

interface CurrencyBalance {
  currency: string;
  balance: number;
}

export interface SettlementLabels {
  title?: string;
  subtitle?: string;
  buttonLabel?: string;
  noteText?: string;
  infoLinked?: string;
  infoUnlinked?: string;
  successLinked?: string;
  successUnlinked?: string;
  confirmMessage?: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  customerId: string;
  customerName: string;
  customerLinkedUserId: string | null;
  currentUserName: string | null;
  currentUserFullName: string | null;
  balances: CurrencyBalance[];
  pendingMovementsCount: number;
  onSuccess: () => void;
  labels?: SettlementLabels;
}

function getCurrencySymbol(code: string) {
  return CURRENCIES.find((c) => c.code === code)?.symbol || code;
}

const DEFAULT_LABELS: Required<SettlementLabels> = {
  title: 'تسوية الرصيد قبل الحذف',
  subtitle: 'لا يمكن حذف العميل قبل تصفير الحساب',
  buttonLabel: 'إنشاء حركات التسوية',
  noteText: 'تسوية الرصيد قبل الحذف',
  infoLinked:
    'سيتم إنشاء حركة تسوية معاكسة لكل عملة. ستكون بانتظار موافقة الطرف الآخر، وعند موافقته يمكنك حذف العميل.',
  infoUnlinked:
    'سيتم إنشاء حركة تسوية معاكسة لكل عملة لتصفير الحساب فوراً.',
  successLinked:
    'الحركات بانتظار موافقة الطرف الآخر. عند موافقته يمكنك إعادة محاولة الحذف.',
  successUnlinked:
    'تم تصفير الحساب. يمكنك الآن حذف العميل.',
  confirmMessage: 'سيتم إنشاء {n} حركة تسوية لتصفير الحساب.',
};

export function PreDeleteSettlementSheet({
  visible,
  onClose,
  customerId,
  customerName,
  customerLinkedUserId,
  currentUserName,
  currentUserFullName,
  balances,
  pendingMovementsCount,
  onSuccess,
  labels,
}: Props) {
  const L = { ...DEFAULT_LABELS, ...(labels || {}) };
  const insets = useSafeAreaInsets();
  const [isCreating, setIsCreating] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
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

  const isLinked = !!customerLinkedUserId;
  const nonZeroBalances = balances.filter((b) => Number(b.balance) !== 0);

  const handleCreateSettlements = () => {
    if (!currentUserName) {
      Alert.alert('خطأ', 'لم يتم التعرف على المستخدم الحالي');
      return;
    }
    if (nonZeroBalances.length === 0) {
      onClose();
      return;
    }

    const confirmText =
      L.confirmMessage.replace('{n}', String(nonZeroBalances.length)) +
      (isLinked ? '\n\nستكون بانتظار موافقة الطرف الآخر.' : '');

    Alert.alert('تأكيد', confirmText, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'إنشاء',
        onPress: async () => {
          setIsCreating(true);
          try {
            for (const item of nonZeroBalances) {
              const balanceValue = Number(item.balance);
              const movementType: 'incoming' | 'outgoing' =
                balanceValue > 0 ? 'outgoing' : 'incoming';
              const amount = Math.abs(balanceValue);

              const senderName =
                movementType === 'outgoing'
                  ? customerName
                  : currentUserFullName || currentUserName;
              const beneficiaryName =
                movementType === 'outgoing'
                  ? currentUserFullName || currentUserName
                  : customerName;

              const { error } = await supabase.rpc('insert_movement_with_user', {
                p_user_name: currentUserName,
                p_customer_id: customerId,
                p_movement_type: movementType,
                p_amount: amount,
                p_currency: item.currency,
                p_notes: L.noteText,
                p_sender_name: senderName,
                p_beneficiary_name: beneficiaryName,
                p_commission: null,
                p_commission_currency: item.currency,
                p_commission_recipient_id: null,
              });

              if (error) throw error;
            }

            onSuccess();
            onClose();

            Alert.alert('تم', isLinked ? L.successLinked : L.successUnlinked);
          } catch (error: any) {
            console.error('Error creating settlement movements:', error);
            Alert.alert('خطأ', error?.message || 'حدث خطأ أثناء إنشاء حركات التسوية');
          } finally {
            setIsCreating(false);
          }
        },
      },
    ]);
  };

  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [400, 0],
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => !isCreating && onClose()}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableWithoutFeedback onPress={() => !isCreating && onClose()}>
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

          <View style={styles.headerRow}>
            <View style={styles.headerIconCircle}>
              <Scale size={20} color="#B45309" />
            </View>
            <View style={styles.headerTextWrap}>
              <Text style={styles.title}>{L.title}</Text>
              <Text style={styles.subtitle}>{L.subtitle}</Text>
            </View>
          </View>

          <Text style={styles.sectionLabel}>العملات غير المصفَّرة</Text>
          <View style={styles.balancesBox}>
            {nonZeroBalances.map((item) => {
              const balanceValue = Number(item.balance);
              const isPositive = balanceValue > 0;
              const label = isPositive ? 'له' : 'عليه';
              const chipColor = isPositive ? '#16A34A' : '#DC2626';
              const chipBg = isPositive ? '#ECFDF5' : '#FEE2E2';

              return (
                <View key={item.currency} style={styles.balanceRow}>
                  <View style={[styles.directionChip, { backgroundColor: chipBg }]}>
                    <Text style={[styles.directionChipText, { color: chipColor }]}>
                      {label}
                    </Text>
                  </View>
                  <Text style={styles.balanceAmount}>
                    {formatSmartNumber(Math.abs(balanceValue))}{' '}
                    <Text style={styles.balanceCurrency}>
                      {getCurrencySymbol(item.currency)}
                    </Text>
                  </Text>
                </View>
              );
            })}
          </View>

          {pendingMovementsCount > 0 ? (
            <View style={styles.warnBox}>
              <AlertTriangle size={14} color="#B45309" />
              <Text style={styles.warnText}>
                لديك {pendingMovementsCount} حركة معلّقة قد تغيّر الرصيد بعد موافقتها
              </Text>
            </View>
          ) : null}

          <View style={styles.infoBox}>
            <Text style={styles.infoText}>
              {isLinked ? L.infoLinked : L.infoUnlinked}
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary, isCreating && styles.btnDisabled]}
            onPress={handleCreateSettlements}
            disabled={isCreating}
            activeOpacity={0.85}
          >
            {isCreating ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Send size={18} color="#FFFFFF" />
                <Text style={styles.btnText}>{L.buttonLabel}</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.btnClose}
            onPress={onClose}
            disabled={isCreating}
            activeOpacity={0.7}
          >
            <Text style={styles.btnCloseText}>إغلاق</Text>
          </TouchableOpacity>
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  headerIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextWrap: { flex: 1, alignItems: 'flex-end' },
  title: {
    fontSize: 17,
    fontWeight: '900',
    color: '#111827',
    writingDirection: 'rtl',
    textAlign: 'right',
  },
  subtitle: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
    fontWeight: '600',
    writingDirection: 'rtl',
    textAlign: 'right',
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#374151',
    marginBottom: 8,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  balancesBox: {
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginBottom: 12,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  directionChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  directionChipText: {
    fontSize: 12,
    fontWeight: '900',
    writingDirection: 'rtl',
  },
  balanceAmount: {
    fontSize: 17,
    fontWeight: '900',
    color: '#111827',
    writingDirection: 'rtl',
  },
  balanceCurrency: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '700',
  },
  warnBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF3C7',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
  },
  warnText: {
    flex: 1,
    fontSize: 12,
    color: '#92400E',
    fontWeight: '700',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  infoBox: {
    backgroundColor: '#EEF2FF',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  infoText: {
    fontSize: 12,
    color: '#3730A3',
    lineHeight: 18,
    fontWeight: '600',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
  },
  btnPrimary: { backgroundColor: '#4F46E5' },
  btnDisabled: { opacity: 0.6 },
  btnText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
    writingDirection: 'rtl',
  },
  btnClose: { paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  btnCloseText: { fontSize: 14, color: '#6B7280', fontWeight: '700' },
});
