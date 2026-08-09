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
import * as Crypto from 'expo-crypto';
import { ArrowDownCircle, ArrowUpCircle, Save, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { useDataRefresh } from '@/contexts/DataRefreshContext';
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';
import { supabase } from '@/lib/supabase';
import { Currency, CURRENCIES } from '@/types/database';
import { isPendingMovement } from '@/utils/movementApproval';
import {
  CommissionOwner,
  computeMovementEffects,
  getCommissionOwnerLabel,
  getProfitLossEffectLabel,
} from '@/utils/movementEffects';
import { validateNumericInput } from '@/utils/numericValidation';

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
  initialMovementType?: 'incoming' | 'outgoing';
}

export default function QuickAddMovementSheet({
  visible,
  onClose,
  customerId,
  customerName,
  currentBalances,
  requiresApproval = false,
  onSuccess,
  initialMovementType,
}: QuickAddMovementSheetProps) {
  const { triggerRefresh } = useDataRefresh();
  const { currentUser } = useAuth();
  const insets = useSafeAreaInsets();

  const [movementType, setMovementType] = useState<'incoming' | 'outgoing' | ''>('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<Currency>('USD' as Currency);
  const [notes, setNotes] = useState('');
  const [commissionEnabled, setCommissionEnabled] = useState(false);
  const [commissionAmount, setCommissionAmount] = useState('');
  const [commissionOwner, setCommissionOwner] = useState<CommissionOwner | null>(null);
  const [commissionError, setCommissionError] = useState<string | null>(null);
  const [operationId, setOperationId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const keyboardHeight = useKeyboardHeight();

  useEffect(() => {
    if (visible) {
      loadLastUsedCurrency();
      // مفتاح منع التكرار: يثبت طوال جلسة الإدخال حتى تنجح العملية،
      // فإعادة المحاولة بعد انقطاع الشبكة لا تنشئ حركة مكررة.
      setOperationId(Crypto.randomUUID());
      if (initialMovementType) {
        setMovementType(initialMovementType);
      }
    } else {
      resetForm();
    }
  }, [visible, initialMovementType]);

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
    setCommissionEnabled(false);
    setCommissionAmount('');
    setCommissionOwner(null);
    setCommissionError(null);
    setOperationId('');
  };

  const getCurrencySymbol = (code: string) => {
    const curr = CURRENCIES.find((item) => item.code === code);
    return curr?.symbol || code;
  };

  const parsedBaseAmount = parseFloat(amount) || 0;
  const parsedCommissionAmount = commissionEnabled ? parseFloat(commissionAmount) || 0 : 0;
  const movementEffects = movementType
    ? computeMovementEffects({
        movementType,
        baseAmount: parsedBaseAmount,
        commissionAmount: parsedCommissionAmount,
        commissionOwner: commissionEnabled ? commissionOwner : null,
      })
    : null;

  const calculateProjectedBalance = () => {
    const currentBalance = currentBalances.find((item) => item.currency === currency)?.balance || 0;

    if (movementEffects?.valid) {
      return currentBalance + movementEffects.customerSignedEffect;
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

    if (commissionEnabled) {
      const parsedCommission = parseFloat(commissionAmount);
      if (!commissionAmount || !(parsedCommission > 0)) {
        Alert.alert('خطأ', 'قيمة العمولة يجب أن تكون أكبر من صفر');
        return;
      }
      if (!commissionOwner) {
        Alert.alert('خطأ', 'يجب تحديد صاحب العمولة');
        return;
      }
      if (movementEffects && !movementEffects.valid) {
        Alert.alert('خطأ', movementEffects.error || 'بيانات العمولة غير صالحة');
        return;
      }
    }

    setIsLoading(true);

    try {
      if (!currentUser) {
        Alert.alert('خطأ', 'يجب تسجيل الدخول أولاً');
        return;
      }

      await ensureReciprocalLinkedCustomer();

      const { data: insertedData, error } = await supabase.rpc('create_movement_with_commission', {
        p_user_name: currentUser.userName,
        p_customer_id: customerId,
        p_movement_type: movementType,
        p_base_amount: parsedAmount,
        p_currency: currency,
        p_notes: trimmedNotes,
        p_commission_amount: commissionEnabled ? parseFloat(commissionAmount) : null,
        p_commission_owner: commissionEnabled ? commissionOwner : null,
        p_operation_id: operationId || null,
        p_sender_name: movementType === 'outgoing' ? customerName : currentUser.fullName || currentUser.userName,
        p_beneficiary_name: movementType === 'outgoing' ? currentUser.fullName || currentUser.userName : customerName,
      });

      if (error) throw error;

      if (!insertedData) {
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
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={() => {
            if (keyboardHeight > 0) {
              Keyboard.dismiss();
              return;
            }
            onClose();
          }}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.sheetContainer}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}
            enabled={Platform.OS === 'ios'}
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

                <View style={styles.section}>
                  <View style={styles.commissionToggleRow}>
                    <TouchableOpacity
                      style={[
                        styles.commissionToggleButton,
                        !commissionEnabled && styles.commissionToggleButtonActive,
                      ]}
                      onPress={() => {
                        setCommissionEnabled(false);
                        setCommissionAmount('');
                        setCommissionOwner(null);
                        setCommissionError(null);
                      }}
                    >
                      <Text
                        style={[
                          styles.commissionToggleText,
                          !commissionEnabled && styles.commissionToggleTextActive,
                        ]}
                      >
                        بدون عمولة
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.commissionToggleButton,
                        commissionEnabled && styles.commissionToggleButtonActive,
                      ]}
                      onPress={() => setCommissionEnabled(true)}
                    >
                      <Text
                        style={[
                          styles.commissionToggleText,
                          commissionEnabled && styles.commissionToggleTextActive,
                        ]}
                      >
                        إضافة عمولة
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {commissionEnabled && (
                    <>
                      <View style={styles.commissionAmountRow}>
                        <View style={styles.commissionCurrencyChip}>
                          <Text style={styles.commissionCurrencyChipText}>{currency}</Text>
                          <Text style={styles.commissionCurrencyChipSymbol}>
                            {getCurrencySymbol(currency)}
                          </Text>
                        </View>
                        <TextInput
                          style={[styles.commissionInput, commissionError ? styles.commissionInputError : null]}
                          value={commissionAmount}
                          onChangeText={(text) => {
                            const validation = validateNumericInput(text, { allowDecimal: true });
                            setCommissionAmount(validation.cleanedValue);
                            setCommissionError(validation.error);
                          }}
                          placeholder="قيمة العمولة"
                          placeholderTextColor="#9CA3AF"
                          keyboardType="decimal-pad"
                          textAlign="center"
                        />
                      </View>
                      {commissionError ? (
                        <Text style={styles.commissionErrorText}>{commissionError}</Text>
                      ) : null}
                      <Text style={styles.commissionCurrencyNote}>
                        العمولة بنفس عملة الحركة دائماً
                      </Text>

                      <View style={styles.commissionOwnerRow}>
                        <TouchableOpacity
                          style={[
                            styles.commissionOwnerButton,
                            commissionOwner === 'account_owner' && styles.commissionOwnerButtonActive,
                          ]}
                          onPress={() => setCommissionOwner('account_owner')}
                        >
                          <Text
                            style={[
                              styles.commissionOwnerText,
                              commissionOwner === 'account_owner' && styles.commissionOwnerTextActive,
                            ]}
                          >
                            العمولة للعميل
                          </Text>
                          <Text
                            style={[
                              styles.commissionOwnerSubtext,
                              commissionOwner === 'account_owner' && styles.commissionOwnerTextActive,
                            ]}
                          >
                            تُحسب لصالح {customerName || 'العميل'}
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[
                            styles.commissionOwnerButton,
                            commissionOwner === 'current_user' && styles.commissionOwnerButtonActive,
                          ]}
                          onPress={() => setCommissionOwner('current_user')}
                        >
                          <Text
                            style={[
                              styles.commissionOwnerText,
                              commissionOwner === 'current_user' && styles.commissionOwnerTextActive,
                            ]}
                          >
                            العمولة لي
                          </Text>
                          <Text
                            style={[
                              styles.commissionOwnerSubtext,
                              commissionOwner === 'current_user' && styles.commissionOwnerTextActive,
                            ]}
                          >
                            ربح لحسابي
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  )}
                </View>

                {!!amount && !!movementType && (
                  <View style={styles.previewSection}>
                    <Text style={styles.previewTitle}>معاينة الأثر</Text>

                    {commissionEnabled && movementEffects && !movementEffects.valid && (
                      <Text style={styles.previewErrorText}>{movementEffects.error}</Text>
                    )}

                    {commissionEnabled && movementEffects?.valid && movementEffects.commissionAmount > 0 && (
                      <>
                        <View style={styles.previewRow}>
                          <Text style={styles.previewValue}>
                            {movementEffects.baseAmount.toFixed(2)} {getCurrencySymbol(currency)}
                          </Text>
                          <Text style={styles.previewLabel}>المبلغ الأساسي:</Text>
                        </View>

                        <View style={styles.previewRow}>
                          <Text style={styles.previewValue}>
                            {movementEffects.commissionAmount.toFixed(2)} {getCurrencySymbol(currency)} (
                            {getCommissionOwnerLabel(movementEffects.commissionOwner)})
                          </Text>
                          <Text style={styles.previewLabel}>العمولة:</Text>
                        </View>

                        <View style={styles.previewRow}>
                          <Text style={[styles.previewValue, styles.previewValueBold]}>
                            {movementEffects.customerTotalAmount.toFixed(2)} {getCurrencySymbol(currency)}{' '}
                            {movementEffects.customerType === 'incoming' ? 'له' : 'عليه'}
                          </Text>
                          <Text style={styles.previewLabel}>إجمالي حركة العميل:</Text>
                        </View>

                        <View style={styles.previewRow}>
                          <Text
                            style={[
                              styles.previewValue,
                              {
                                color:
                                  movementEffects.profitLossType === 'incoming' ? '#10B981' : '#EF4444',
                              },
                            ]}
                          >
                            {movementEffects.profitLossAmount.toFixed(2)} {getCurrencySymbol(currency)}{' '}
                            {getProfitLossEffectLabel(movementEffects.profitLossType)}
                          </Text>
                          <Text style={styles.previewLabel}>الأرباح والخسائر:</Text>
                        </View>
                      </>
                    )}

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
    direction: 'rtl',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    flex: 1,
    direction: 'rtl',
    justifyContent: 'flex-end',
  },
  sheet: {
    direction: 'rtl',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    flex: 1,
    maxHeight: '92%',
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
    direction: 'rtl',
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
  commissionToggleRow: {
    flexDirection: 'row',
    gap: 10,
  },
  commissionToggleButton: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#E5E7EB',
  },
  commissionToggleButtonActive: {
    backgroundColor: '#4F46E5',
    borderColor: '#4F46E5',
  },
  commissionToggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  commissionToggleTextActive: {
    color: '#FFFFFF',
  },
  commissionAmountRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  commissionCurrencyChip: {
    backgroundColor: '#EEF2FF',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    width: 76,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commissionCurrencyChipText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#4F46E5',
  },
  commissionCurrencyChipSymbol: {
    fontSize: 11,
    color: '#6366F1',
    marginTop: 2,
  },
  commissionInput: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    fontSize: 17,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'center',
  },
  commissionInputError: {
    borderColor: '#EF4444',
  },
  commissionErrorText: {
    marginTop: 6,
    fontSize: 12,
    color: '#EF4444',
    textAlign: 'right',
  },
  commissionCurrencyNote: {
    marginTop: 6,
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'right',
  },
  commissionOwnerRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  commissionOwnerButton: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 10,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#E5E7EB',
  },
  commissionOwnerButtonActive: {
    backgroundColor: '#0EA5E9',
    borderColor: '#0EA5E9',
  },
  commissionOwnerText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#111827',
  },
  commissionOwnerSubtext: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
  },
  commissionOwnerTextActive: {
    color: '#FFFFFF',
  },
  previewErrorText: {
    fontSize: 13,
    color: '#EF4444',
    textAlign: 'right',
    marginBottom: 8,
    lineHeight: 20,
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
    direction: 'rtl',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  pickerContent: {
    direction: 'rtl',
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
