import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { ArrowDownCircle, ArrowUpCircle, Save, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { useDataRefresh } from '@/contexts/DataRefreshContext';
import { supabase } from '@/lib/supabase';
import { AccountMovement, Currency, CURRENCIES } from '@/types/database';
import { isPendingMovement } from '@/utils/movementApproval';
import { syncEditedMovementNotifications } from '@/services/movementNotificationSyncService';

interface EditMovementSheetProps {
  visible: boolean;
  onClose: () => void;
  movement: AccountMovement | null;
  customerId: string;
  customerName: string;
  currentBalances: Array<{
    currency: string;
    balance: number;
  }>;
  requiresApproval?: boolean;
  onSuccess: () => void | Promise<void>;
}

export default function EditMovementSheet({
  visible,
  onClose,
  movement,
  customerId,
  customerName,
  currentBalances,
  requiresApproval = false,
  onSuccess,
}: EditMovementSheetProps) {
  const { triggerRefresh } = useDataRefresh();
  const { currentUser } = useAuth();
  const insets = useSafeAreaInsets();

  const [movementType, setMovementType] = useState<'incoming' | 'outgoing' | ''>('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD' as Currency);
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);

  useEffect(() => {
    if (visible && movement) {
      setMovementType(movement.movement_type as 'incoming' | 'outgoing');
      setAmount(String(Number(movement.amount || 0)));
      setCurrency((movement.currency || 'USD') as Currency);
      setNotes(movement.notes || '');
    }

    if (!visible) {
      setMovementType('');
      setAmount('');
      setNotes('');
      setShowCurrencyPicker(false);
      setIsLoading(false);
    }
  }, [visible, movement?.id]);

  const getCurrencySymbol = (code: string) => {
    const curr = CURRENCIES.find((item) => item.code === code);
    return curr?.symbol || code;
  };

  const getBaseBalanceForPreview = () => {
    const currentBalance = currentBalances.find((item) => item.currency === currency)?.balance || 0;

    if (!movement || isPendingMovement(movement) || movement.currency !== currency) {
      return currentBalance;
    }

    const originalAmount = Number(movement.amount) || 0;
    if (movement.movement_type === 'incoming') {
      return currentBalance - originalAmount;
    }

    return currentBalance + originalAmount;
  };

  const calculateProjectedBalance = () => {
    const amountNum = parseFloat(amount) || 0;
    const baseBalance = getBaseBalanceForPreview();

    if (movementType === 'incoming') {
      return baseBalance + amountNum;
    }

    if (movementType === 'outgoing') {
      return baseBalance - amountNum;
    }

    return baseBalance;
  };

  const calculateAppliedBalanceAfterSave = () => {
    if (requiresApproval && movementType) {
      return getBaseBalanceForPreview();
    }

    return calculateProjectedBalance();
  };

  const formatBalance = (balance: number) => {
    const absBalance = Math.abs(balance);
    if (balance > 0) {
      return `له ${absBalance.toFixed(2)} ${getCurrencySymbol(currency)}`;
    }
    if (balance < 0) {
      return `عليه ${absBalance.toFixed(2)} ${getCurrencySymbol(currency)}`;
    }
    return 'متساوي';
  };

  const closeAfterSuccess = (message: string) => {
    Keyboard.dismiss();
    setTimeout(() => {
      Alert.alert('نجح', message, [
        {
          text: 'حسناً',
          onPress: onClose,
        },
      ]);
    }, 350);
  };

  const handleSave = async () => {
    const trimmedNotes = notes.trim();
    const parsedAmount = parseFloat(amount);

    if (!movement?.id) {
      Alert.alert('خطأ', 'لم يتم العثور على الحركة المراد تعديلها');
      return;
    }

    if (!movementType || !amount || parsedAmount <= 0) {
      Alert.alert('خطأ', 'الرجاء إدخال نوع الحركة والمبلغ');
      return;
    }

    if (parsedAmount < 0) {
      Alert.alert('خطأ', 'المبلغ لا يمكن أن يكون سالباً');
      return;
    }

    if (!trimmedNotes) {
      Alert.alert('خطأ', 'الملاحظة مطلوبة لكل حركة');
      return;
    }

    if (!currentUser?.userName) {
      Alert.alert('خطأ', 'يجب تسجيل الدخول أولاً');
      return;
    }

    setIsLoading(true);

    try {
      const senderName =
        movementType === 'outgoing'
          ? customerName
          : currentUser.fullName || currentUser.userName;
      const beneficiaryName =
        movementType === 'outgoing'
          ? currentUser.fullName || currentUser.userName
          : customerName;

      {
        const { data: rpcUpdateResult, error: rpcUpdateError } = await supabase.rpc(
          'force_update_movement_for_user',
          {
            p_movement_id: String(movement.id),
            p_user_name: currentUser.userName,
            p_movement_type: movementType,
            p_amount: parsedAmount,
            p_currency: currency,
            p_notes: trimmedNotes,
            p_sender_name: senderName,
            p_beneficiary_name: beneficiaryName,
            p_transfer_number: (movement as any).transfer_number || null,
          },
        );

        if (rpcUpdateError) throw rpcUpdateError;

        const rpcResult = rpcUpdateResult as any;
        if (rpcResult?.success === false) {
          throw new Error(rpcResult?.error || 'حدث خطأ أثناء تعديل الحركة');
        }
      }

      await syncEditedMovementNotifications({
        movementId: String(movement.id),
        movement,
        snapshot: {
          movement_type: movementType,
          amount: parsedAmount,
          currency,
          notes: trimmedNotes,
          sender_name: senderName,
          beneficiary_name: beneficiaryName,
          transfer_number: (movement as any).transfer_number || null,
        },
      });

      closeAfterSuccess('تم تعديل الحركة بنجاح');
      setTimeout(() => {
        triggerRefresh('all');
        Promise.resolve(onSuccess()).catch((refreshError) => {
          console.warn('Movement updated, but refresh failed:', refreshError);
        });
      }, 450);
    } catch (error: any) {
      console.error('Error editing movement:', error);
      Alert.alert('خطأ', error?.message || 'حدث خطأ أثناء تعديل الحركة');
    } finally {
      setIsLoading(false);
    }
  };

  const baseBalance = getBaseBalanceForPreview();
  const appliedBalanceAfterSave = calculateAppliedBalanceAfterSave();
  const projectedBalanceIfApproved = calculateProjectedBalance();
  const isPendingApproval = requiresApproval && !!movementType;

  const title = useMemo(() => {
    if (!movement) return 'تعديل حركة';
    const number = movement.movement_number ? ` #${movement.movement_number}` : '';
    return `تعديل حركة${number}`;
  }, [movement]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity activeOpacity={1} style={styles.overlay} onPress={onClose}>
          <View style={[styles.sheetContainer, { paddingBottom: insets.bottom }]}>
            <TouchableOpacity activeOpacity={1} onPress={(event) => event.stopPropagation()} style={styles.sheet}>
              <View style={styles.header}>
                <TouchableOpacity style={styles.closeButton} onPress={onClose}>
                  <X size={24} color="#6B7280" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>{title}</Text>
                <View style={styles.closeButton} />
              </View>

              <ScrollView style={styles.scrollView} keyboardShouldPersistTaps="handled">
                <View style={styles.content}>
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>
                      نوع الحركة <Text style={styles.required}>*</Text>
                    </Text>
                    <View style={styles.typeButtons}>
                      <TouchableOpacity
                        style={[
                          styles.typeButton,
                          movementType === 'outgoing' && styles.typeButtonActiveRed,
                        ]}
                        onPress={() => setMovementType('outgoing')}
                      >
                        <ArrowDownCircle
                          size={28}
                          color={movementType === 'outgoing' ? '#FFFFFF' : '#EF4444'}
                        />
                        <Text
                          style={[
                            styles.typeButtonText,
                            { color: movementType === 'outgoing' ? '#FFFFFF' : '#111827' },
                          ]}
                        >
                          عليه
                        </Text>
                        <Text
                          style={[
                            styles.typeButtonSubtext,
                            { color: movementType === 'outgoing' ? '#FEE2E2' : '#6B7280' },
                          ]}
                        >
                          قبض
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.typeButton,
                          movementType === 'incoming' && styles.typeButtonActiveGreen,
                        ]}
                        onPress={() => setMovementType('incoming')}
                      >
                        <ArrowUpCircle
                          size={28}
                          color={movementType === 'incoming' ? '#FFFFFF' : '#10B981'}
                        />
                        <Text
                          style={[
                            styles.typeButtonText,
                            { color: movementType === 'incoming' ? '#FFFFFF' : '#111827' },
                          ]}
                        >
                          له
                        </Text>
                        <Text
                          style={[
                            styles.typeButtonSubtext,
                            { color: movementType === 'incoming' ? '#D1FAE5' : '#6B7280' },
                          ]}
                        >
                          صرف
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>
                      المبلغ <Text style={styles.required}>*</Text>
                    </Text>
                    <View style={styles.amountRow}>
                      <TextInput
                        style={styles.amountInput}
                        value={amount}
                        onChangeText={setAmount}
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        placeholderTextColor="#9CA3AF"
                      />
                      <TouchableOpacity
                        style={styles.currencyButton}
                        onPress={() => setShowCurrencyPicker(true)}
                      >
                        <Text style={styles.currencyCode}>{currency}</Text>
                        <Text style={styles.currencySymbol}>{getCurrencySymbol(currency)}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>
                      ملاحظة <Text style={styles.required}>*</Text>
                    </Text>
                    <TextInput
                      style={styles.notesInput}
                      value={notes}
                      onChangeText={setNotes}
                      placeholder="اكتب ملاحظة الحركة"
                      placeholderTextColor="#9CA3AF"
                      multiline
                    />
                  </View>

                  {!!amount && !!movementType && (
                    <View style={styles.previewSection}>
                      <Text style={styles.previewTitle}>معاينة الأثر بعد التعديل</Text>
                      <View style={styles.previewRow}>
                        <Text style={styles.previewValue}>{formatBalance(baseBalance)}</Text>
                        <Text style={styles.previewLabel}>الرصيد قبل التعديل:</Text>
                      </View>
                      <View style={styles.previewRow}>
                        <Text
                          style={[
                            styles.previewValueBold,
                            {
                              color:
                                appliedBalanceAfterSave > 0
                                  ? '#10B981'
                                  : appliedBalanceAfterSave < 0
                                    ? '#EF4444'
                                    : '#6B7280',
                            },
                          ]}
                        >
                          {formatBalance(appliedBalanceAfterSave)}
                        </Text>
                        <Text style={styles.previewLabel}>
                          {isPendingApproval ? 'الرصيد بعد الحفظ:' : 'الرصيد بعد التعديل:'}
                        </Text>
                      </View>
                      {isPendingApproval && (
                        <>
                          <View style={styles.previewRow}>
                            <Text
                              style={[
                                styles.previewValueBold,
                                {
                                  color:
                                    projectedBalanceIfApproved > 0
                                      ? '#10B981'
                                      : projectedBalanceIfApproved < 0
                                        ? '#EF4444'
                                        : '#6B7280',
                                },
                              ]}
                            >
                              {formatBalance(projectedBalanceIfApproved)}
                            </Text>
                            <Text style={styles.previewLabel}>الرصيد اذا وافق:</Text>
                          </View>
                          <Text style={styles.previewPendingNote}>
                            هذه الحركة مرتبطة بحساب آخر؛ قد تبقى معلقة ولا يتغير الرصيد الفعلي إلا بعد الموافقة.
                          </Text>
                        </>
                      )}
                    </View>
                  )}
                </View>
              </ScrollView>

              <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
                <TouchableOpacity
                  style={[styles.saveButton, isLoading && styles.saveButtonDisabled]}
                  onPress={handleSave}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <>
                      <Save size={22} color="#FFFFFF" />
                      <Text style={styles.saveButtonText}>حفظ التعديل</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </KeyboardAvoidingView>

      <Modal
        visible={showCurrencyPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCurrencyPicker(false)}
      >
        <TouchableOpacity style={styles.pickerContainer} onPress={() => setShowCurrencyPicker(false)}>
          <TouchableOpacity activeOpacity={1} onPress={(event) => event.stopPropagation()} style={styles.pickerContent}>
            <Text style={styles.pickerTitle}>اختر العملة</Text>
            <ScrollView style={styles.pickerList}>
              {CURRENCIES.map((curr) => (
                <TouchableOpacity
                  key={curr.code}
                  style={styles.pickerItem}
                  onPress={() => {
                    setCurrency(curr.code as Currency);
                    setShowCurrencyPicker(false);
                  }}
                >
                  <Text style={styles.pickerItemText}>{curr.code} - {curr.name}</Text>
                  <Text style={styles.pickerItemSymbol}>{curr.symbol}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.pickerCloseButton} onPress={() => setShowCurrencyPicker(false)}>
              <Text style={styles.pickerCloseButtonText}>إغلاق</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    height: '92%',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: '100%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  closeButton: {
    padding: 4,
    minWidth: 32,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
    textAlign: 'center',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 104,
  },
  section: {
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
    textAlign: 'right',
  },
  required: {
    color: '#EF4444',
  },
  typeButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  typeButton: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#E5E7EB',
  },
  typeButtonActiveRed: {
    backgroundColor: '#EF4444',
    borderColor: '#EF4444',
  },
  typeButtonActiveGreen: {
    backgroundColor: '#10B981',
    borderColor: '#10B981',
  },
  typeButtonText: {
    fontSize: 15,
    fontWeight: 'bold',
    marginTop: 4,
  },
  typeButtonSubtext: {
    fontSize: 11,
    marginTop: 1,
  },
  amountRow: {
    flexDirection: 'row',
    gap: 10,
  },
  currencyButton: {
    backgroundColor: '#4F46E5',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    width: 76,
    alignItems: 'center',
  },
  currencyCode: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  currencySymbol: {
    fontSize: 11,
    color: '#E0E7FF',
    marginTop: 2,
  },
  amountInput: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    fontSize: 19,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'center',
  },
  notesInput: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
    minHeight: 84,
    textAlignVertical: 'top',
    textAlign: 'right',
  },
  previewSection: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  previewTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 12,
    textAlign: 'center',
  },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  previewLabel: {
    fontSize: 14,
    color: '#6B7280',
  },
  previewValue: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
  },
  previewValueBold: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  previewPendingNote: {
    marginTop: 12,
    fontSize: 13,
    color: '#D97706',
    textAlign: 'right',
    lineHeight: 20,
  },
  footer: {
    paddingHorizontal: 18,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    gap: 8,
  },
  saveButton: {
    backgroundColor: '#10B981',
    borderRadius: 12,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  pickerContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  pickerContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '60%',
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 16,
    textAlign: 'center',
  },
  pickerList: {
    flexGrow: 0,
    flexShrink: 1,
  },
  pickerItem: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pickerItemText: {
    fontSize: 15,
    color: '#111827',
    textAlign: 'right',
  },
  pickerItemSymbol: {
    fontSize: 14,
    color: '#6B7280',
  },
  pickerCloseButton: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 16,
  },
  pickerCloseButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    textAlign: 'center',
  },
});
