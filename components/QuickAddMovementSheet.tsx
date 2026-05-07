import { useEffect, useState } from 'react';
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ArrowDownCircle, ArrowUpCircle, Save, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { useDataRefresh } from '@/contexts/DataRefreshContext';
import { supabase } from '@/lib/supabase';
import { Currency, CURRENCIES } from '@/types/database';
import { isPendingMovement } from '@/utils/movementApproval';

interface QuickAddMovementSheetProps {
  visible: boolean;
  onClose: () => void;
  customerId: string;
  customerName: string;
  customerAccountNumber: string;
  currentBalances: Array<{
    currency: string;
    balance: number;
  }>;
  requiresApproval?: boolean;
  onSuccess: () => void | Promise<void>;
}

export default function QuickAddMovementSheet({
  visible,
  onClose,
  customerId,
  customerName,
  currentBalances,
  requiresApproval = false,
  onSuccess,
}: QuickAddMovementSheetProps) {
  const { triggerRefresh } = useDataRefresh();
  const { currentUser } = useAuth();
  const insets = useSafeAreaInsets();

  const [movementType, setMovementType] = useState<'incoming' | 'outgoing' | ''>('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<Currency>('USD' as Currency);
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);

  useEffect(() => {
    if (visible) {
      loadLastUsedCurrency();
    } else {
      resetForm();
    }
  }, [visible]);

  const loadLastUsedCurrency = async () => {
    try {
      const lastCurrency = await AsyncStorage.getItem('@last_used_currency');
      if (lastCurrency) {
        setCurrency(lastCurrency as Currency);
      }
    } catch (error) {
      console.error('Error loading last currency:', error);
    }
  };

  const saveLastUsedCurrency = async (curr: Currency) => {
    try {
      await AsyncStorage.setItem('@last_used_currency', curr);
    } catch (error) {
      console.error('Error saving last currency:', error);
    }
  };

  const resetForm = () => {
    setMovementType('');
    setAmount('');
    setNotes('');
  };

  const getCurrencySymbol = (code: string) => {
    const curr = CURRENCIES.find((item) => item.code === code);
    return curr?.symbol || code;
  };

  const calculateProjectedBalance = () => {
    const amountNum = parseFloat(amount) || 0;
    const currentBalance = currentBalances.find((item) => item.currency === currency)?.balance || 0;

    if (movementType === 'incoming') {
      return currentBalance + amountNum;
    }

    if (movementType === 'outgoing') {
      return currentBalance - amountNum;
    }

    return currentBalance;
  };

  const calculateAppliedBalanceAfterSave = () => {
    const currentBalance = currentBalances.find((item) => item.currency === currency)?.balance || 0;

    if (requiresApproval && movementType) {
      return currentBalance;
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

  const showSuccessAlert = (message: string) => {
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

  const isPendingApproval = requiresApproval && !!movementType;

  const ensureReciprocalLinkedCustomer = async () => {
    if (!currentUser?.userId) return;

    const { data: customerData, error: customerError } = await supabase
      .from('customers')
      .select('id, name, account_number, user_id, linked_user_id')
      .eq('id', customerId)
      .maybeSingle();

    if (customerError) throw customerError;

    if (
      !customerData?.linked_user_id ||
      customerData.linked_user_id === customerData.user_id
    ) {
      return;
    }

    const { data: existingReciprocal, error: existingError } = await supabase
      .from('customers')
      .select('id')
      .eq('user_id', customerData.linked_user_id)
      .eq('linked_user_id', customerData.user_id)
      .limit(1)
      .maybeSingle();

    if (existingError) throw existingError;
    if (existingReciprocal?.id) return;

    const reciprocalName =
      currentUser.fullName ||
      currentUser.userName ||
      customerName ||
      'الطرف المقابل';

    const { error: insertError } = await supabase
      .from('customers')
      .insert({
        user_id: customerData.linked_user_id,
        linked_user_id: customerData.user_id,
        name: reciprocalName,
        phone: '',
        account_number: customerData.account_number,
        notes: 'تم إنشاؤه تلقائياً للحركات المرتبطة',
      });

    if (insertError) throw insertError;
  };

  const handleSave = async () => {
    const trimmedNotes = notes.trim();
    const parsedAmount = parseFloat(amount);

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

    setIsLoading(true);

    try {
      if (!currentUser) {
        Alert.alert('خطأ', 'يجب تسجيل الدخول أولاً');
        return;
      }

      await ensureReciprocalLinkedCustomer();

      const { data: insertedData, error } = await supabase.rpc('insert_movement_with_user', {
        p_user_name: currentUser.userName,
        p_customer_id: customerId,
        p_movement_type: movementType,
        p_amount: parsedAmount,
        p_currency: currency,
        p_notes: trimmedNotes,
        p_sender_name: movementType === 'outgoing' ? customerName : currentUser.fullName || currentUser.userName,
        p_beneficiary_name: movementType === 'outgoing' ? currentUser.fullName || currentUser.userName : customerName,
        p_commission: null,
        p_commission_currency: currency,
        p_commission_recipient_id: null,
      });

      if (error) throw error;

      if (!insertedData || (Array.isArray(insertedData) && insertedData.length === 0)) {
        throw new Error('لم يتم إرجاع بيانات الحركة');
      }

      const movement = Array.isArray(insertedData) ? insertedData[0] : insertedData;

      await saveLastUsedCurrency(currency);
      const pendingMessage = isPendingMovement(movement)
        ? 'تم تسجيل الحركة بانتظار تأكيد الطرف الآخر، ولن تؤثر في الإجماليات قبل التأكيد.'
        : 'تمت إضافة الحركة بنجاح';

      showSuccessAlert(pendingMessage);
      setTimeout(() => {
        triggerRefresh('all');
        Promise.resolve(onSuccess()).catch((refreshError) => {
          console.warn('Movement saved, but refresh failed:', refreshError);
        });
      }, 450);
    } catch (error) {
      console.error('Error adding movement:', error);
      Alert.alert('خطأ', 'حدث خطأ أثناء إضافة الحركة');
    } finally {
      setIsLoading(false);
    }
  };

  const currentBalance = currentBalances.find((item) => item.currency === currency)?.balance || 0;
  const appliedBalanceAfterSave = calculateAppliedBalanceAfterSave();
  const projectedBalanceIfApproved = calculateProjectedBalance();

  return (
    <>
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={styles.sheetContainer}
          >
            <TouchableOpacity activeOpacity={1} onPress={(event) => event.stopPropagation()} style={styles.sheet}>
              <View style={styles.header}>
                <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                  <X size={22} color="#6B7280" />
                </TouchableOpacity>

                <Text style={styles.headerTitle}>إضافة حركة</Text>

                <View style={{ width: 32 }} />
              </View>

              <ScrollView
                style={styles.scrollView}
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
              >
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
                        size={22}
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
                        size={22}
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
                    <TouchableOpacity style={styles.currencyButton} onPress={() => setShowCurrencyPicker(true)}>
                      <Text style={styles.currencyCode}>{currency}</Text>
                      <Text style={styles.currencySymbol}>{getCurrencySymbol(currency)}</Text>
                    </TouchableOpacity>

                    <TextInput
                      style={styles.amountInput}
                      value={amount}
                      onChangeText={setAmount}
                      placeholder="0.00"
                      placeholderTextColor="#9CA3AF"
                      keyboardType="numeric"
                      textAlign="center"
                    />
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
                    textAlign="right"
                  />
                </View>

                {!!amount && !!movementType && (
                  <View style={styles.previewSection}>
                    <Text style={styles.previewTitle}>معاينة الأثر</Text>

                    <View style={styles.previewRow}>
                      <Text style={styles.previewValue}>{formatBalance(currentBalance)}</Text>
                      <Text style={styles.previewLabel}>الرصيد قبل:</Text>
                    </View>

                    <View style={styles.previewRow}>
                      <Text
                        style={[
                          styles.previewValue,
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
                        {isPendingApproval ? 'الرصيد بعد الحفظ:' : 'الرصيد بعد الحركة:'}
                      </Text>
                    </View>

                    {isPendingApproval && (
                      <>
                        <View style={styles.previewRow}>
                          <Text
                            style={[
                              styles.previewValue,
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
                          <Text style={styles.previewLabel}>الرصيد اذا أكد:</Text>
                        </View>

                        <Text style={styles.previewPendingNote}>
                          بعد الحفظ ستبقى الحركة معلقة، ولا يتغير الرصيد الفعلي إلا بعد التأكيد.
                        </Text>
                      </>
                    )}
                  </View>
                )}
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
                      <Save size={18} color="#FFFFFF" />
                      <Text style={styles.saveButtonText}>حفظ</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showCurrencyPicker} transparent animationType="slide">
        <TouchableOpacity
          style={styles.pickerContainer}
          activeOpacity={1}
          onPress={() => setShowCurrencyPicker(false)}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={(event) => event.stopPropagation()}
            style={styles.pickerContent}
          >
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
                  <Text style={styles.pickerItemText}>
                    {curr.code} - {curr.name}
                  </Text>
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
    </>
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
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
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
  previewPendingNote: {
    marginTop: 12,
    fontSize: 13,
    color: '#D97706',
    textAlign: 'right',
    lineHeight: 20,
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
