import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Stack, router } from 'expo-router';
import { ArrowLeftRight, ArrowLeft, AlertCircle, Plus, X, Printer, Save } from 'lucide-react-native';
import PartySelector from '@/components/PartySelector';
import { supabase } from '@/lib/supabase';
import { Currency, CURRENCIES } from '@/types/database';
import { KeyboardAwareView } from '@/components/KeyboardAwareView';
import { useAuth } from '@/contexts/AuthContext';
import { useDataRefresh } from '@/contexts/DataRefreshContext';

interface TransferFormData {
  fromType: 'shop' | 'customer' | null;
  fromCustomerId?: string;
  fromCustomerName?: string;
  fromCustomerAccount?: string;
  toType: 'shop' | 'customer' | null;
  toCustomerId?: string;
  toCustomerName?: string;
  toCustomerAccount?: string;
  amount: string;
  currency: Currency;
  notes: string;
  commission: string;
  commissionCurrency: Currency;
  commissionRecipient: 'to' | null;
}

export default function InternalTransferScreen() {
  const { currentUser } = useAuth();
  const { triggerRefresh } = useDataRefresh();
  const [formData, setFormData] = useState<TransferFormData>({
    fromType: null,
    toType: null,
    amount: '',
    currency: 'USD',
    notes: '',
    commission: '',
    commissionCurrency: 'USD',
    commissionRecipient: null,
  });
  const [loading, setLoading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showCommission, setShowCommission] = useState(false);

  React.useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      commissionCurrency: prev.currency,
    }));
  }, [formData.currency]);

  const validateTransfer = (): string | null => {
    if (!formData.fromType) {
      return 'يرجى اختيار الطرف المُحوِّل';
    }

    if (!formData.toType) {
      return 'يرجى اختيار الطرف المُحوَّل إليه';
    }

    if (
      formData.fromType === 'shop' &&
      formData.toType === 'shop'
    ) {
      return 'لا يمكن التحويل من المحل إلى المحل';
    }

    if (
      formData.fromType === 'customer' &&
      formData.toType === 'customer' &&
      formData.fromCustomerId === formData.toCustomerId
    ) {
      return 'لا يمكن التحويل لنفس العميل';
    }

    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      return 'يرجى إدخال مبلغ صحيح';
    }

    if (!formData.notes.trim()) {
      return 'يرجى إدخال ملاحظة واضحة للحركة';
    }

    if (formData.commission && parseFloat(formData.commission) < 0) {
      return 'العمولة يجب أن تكون صفر أو أكبر';
    }

    return null;
  };

  const handleSubmit = async (withPrint: boolean = false) => {
    const error = validateTransfer();
    if (error) {
      setValidationError(error);
      return;
    }

    setValidationError(null);
    setLoading(true);

    try {
      if (!currentUser?.userName) {
        Alert.alert('خطأ', 'يجب تسجيل الدخول أولاً');
        return;
      }

      let commissionRecipientId = null;
      if (formData.commission && parseFloat(formData.commission) > 0 && formData.commissionRecipient === 'to') {
        commissionRecipientId = formData.toCustomerId;
      }

      const { data, error: rpcError } = await supabase.rpc(
        'create_internal_transfer',
        {
          p_from_customer_id: formData.fromType === 'customer' ? formData.fromCustomerId : null,
          p_to_customer_id: formData.toType === 'customer' ? formData.toCustomerId : null,
          p_amount: parseFloat(formData.amount),
          p_currency: formData.currency,
          p_notes: formData.notes.trim(),
          p_commission: formData.commission && parseFloat(formData.commission) > 0 ? parseFloat(formData.commission) : null,
          p_commission_currency: formData.commission && parseFloat(formData.commission) > 0 ? formData.commissionCurrency : null,
          p_commission_recipient_id: commissionRecipientId,
          p_user_name: currentUser.userName,
        }
      );

      if (rpcError) throw rpcError;

      if (data && data.length > 0) {
        const result = data[0];
        if (result.success) {
          triggerRefresh('movements');
          const movementId = result.to_movement_id || result.from_movement_id;

          if (withPrint && movementId) {
            const customerName = formData.toType === 'customer' ? formData.toCustomerName : formData.fromCustomerName;
            const customerAccountNumber = formData.toType === 'customer' ? formData.toCustomerAccount : formData.fromCustomerAccount;

            router.push({
              pathname: '/receipt-preview',
              params: {
                movementId: movementId,
                customerName: customerName,
                customerAccountNumber: customerAccountNumber || '000000',
              },
            });
          } else {
            Alert.alert(
              'نجح التحويل',
              result.message,
              [
                {
                  text: 'حسناً',
                  onPress: () => router.back(),
                },
              ]
            );
          }
        } else {
          Alert.alert('خطأ', result.message);
        }
      }
    } catch (error: any) {
      console.error('Error creating transfer:', error);
      Alert.alert('خطأ', error.message || 'حدث خطأ أثناء التحويل');
    } finally {
      setLoading(false);
    }
  };

  const getTransferSummary = () => {
    const fromLabel = formData.fromType === 'shop'
      ? 'المحل'
      : formData.fromCustomerName || 'عميل';

    const toLabel = formData.toType === 'shop'
      ? 'المحل'
      : formData.toCustomerName || 'عميل';

    return `من ${fromLabel} إلى ${toLabel}`;
  };

  const getBalanceImpact = () => {
    if (!formData.fromType || !formData.toType || !formData.amount) {
      return null;
    }

    const amount = parseFloat(formData.amount);
    if (isNaN(amount) || amount <= 0) return null;

    const currencySymbol = CURRENCIES.find(c => c.code === formData.currency)?.symbol || '';
    const commission = formData.commission ? parseFloat(formData.commission) : 0;
    const commissionSymbol = CURRENCIES.find(c => c.code === formData.commissionCurrency)?.symbol || '';

    if (formData.fromType === 'customer' && formData.toType === 'customer') {
      // حساب التأثير بناءً على من يستلم العمولة
      let fromAmount = amount;
      let toAmount = amount;
      let profitLossImpact = null;

      if (commission > 0) {
        if (formData.commissionRecipient === null) {
          // الأرباح والخسائر تحصل على العمولة
          // المبلغ المستلم ينقص بمقدار العمولة
          toAmount = amount - commission;
          profitLossImpact = `الأرباح والخسائر: سيزيد رصيده بمقدار +${commission} ${commissionSymbol}`;
        } else if (formData.commissionRecipient === 'to') {
          // العمولة للمستلم
          // الأرباح تدفع العمولة للمستلم
          toAmount = amount + commission;
          profitLossImpact = `الأرباح والخسائر: سينقص بمقدار -${commission} ${commissionSymbol} (يدفع للمستلم)`;
        }
      }

      return {
        from: `${formData.fromCustomerName}: سينقص رصيده بمقدار -${fromAmount} ${currencySymbol}`,
        to: `${formData.toCustomerName}: سيزيد رصيده بمقدار +${toAmount} ${currencySymbol}`,
        profitLossImpact: profitLossImpact,
        note: 'تحويل داخلي - لا يؤثر على رصيد المحل',
      };
    } else if (formData.fromType === 'shop') {
      return {
        to: `${formData.toCustomerName}: سيزيد رصيده بمقدار +${amount} ${currencySymbol}`,
        note: 'دفع من المحل للعميل',
      };
    } else if (formData.toType === 'shop') {
      return {
        from: `${formData.fromCustomerName}: سينقص رصيده بمقدار -${amount} ${currencySymbol}`,
        note: 'قبض من العميل للمحل',
      };
    }

    return null;
  };

  const balanceImpact = getBalanceImpact();

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'تحويل داخلي',
          headerTitleAlign: 'center',
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()}>
              <ArrowLeft size={24} color="#1F2937" />
            </TouchableOpacity>
          ),
        }}
      />

      <KeyboardAwareView contentContainerStyle={{ paddingBottom: 40 }}>
          <View style={styles.header}>
            <View style={styles.iconContainer}>
              <ArrowLeftRight size={32} color="#3B82F6" />
            </View>
            <Text style={styles.headerTitle}>تحويل داخلي</Text>
            <Text style={styles.headerSubtitle}>
              قم بتحويل الأموال بين العملاء أو بين العميل والمحل
            </Text>
          </View>

        {validationError && (
          <View style={styles.errorContainer}>
            <AlertCircle size={20} color="#EF4444" />
            <Text style={styles.errorText}>{validationError}</Text>
          </View>
        )}

        <View style={styles.form}>
          <PartySelector
            label="من (المُحوِّل)"
            selectedType={formData.fromType}
            selectedCustomerId={formData.fromCustomerId}
            selectedCustomerName={formData.fromCustomerName}
            onSelect={(type, customerId, customerName, accountNumber) => {
              setFormData({
                ...formData,
                fromType: type,
                fromCustomerId: customerId,
                fromCustomerName: customerName,
                fromCustomerAccount: accountNumber,
              });
              setValidationError(null);
            }}
            excludeCustomerId={formData.toCustomerId}
          />

          <View style={styles.arrowContainer}>
            <View style={styles.arrowLine} />
            <View style={styles.arrowCircle}>
              <ArrowLeftRight size={20} color="#3B82F6" />
            </View>
            <View style={styles.arrowLine} />
          </View>

          <PartySelector
            label="إلى (المُحوَّل إليه)"
            selectedType={formData.toType}
            selectedCustomerId={formData.toCustomerId}
            selectedCustomerName={formData.toCustomerName}
            onSelect={(type, customerId, customerName, accountNumber) => {
              setFormData({
                ...formData,
                toType: type,
                toCustomerId: customerId,
                toCustomerName: customerName,
                toCustomerAccount: accountNumber,
              });
              setValidationError(null);
            }}
            excludeCustomerId={formData.fromCustomerId}
          />

          <View style={styles.amountSection}>
            <Text style={styles.label}>المبلغ</Text>
            <View style={styles.amountInputContainer}>
              <TextInput
                style={styles.amountInput}
                placeholder="0.00"
                keyboardType="decimal-pad"
                value={formData.amount}
                onChangeText={(text) => {
                  setFormData({ ...formData, amount: text });
                  setValidationError(null);
                }}
                placeholderTextColor="#9CA3AF"
              />
            </View>

            <Text style={styles.label}>العملة</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.currencyScroll}
            >
              {CURRENCIES.map((curr) => (
                <TouchableOpacity
                  key={curr.code}
                  style={[
                    styles.currencyButton,
                    formData.currency === curr.code && styles.currencyButtonActive,
                  ]}
                  onPress={() => setFormData({ ...formData, currency: curr.code })}
                >
                  <Text
                    style={[
                      styles.currencyButtonText,
                      formData.currency === curr.code && styles.currencyButtonTextActive,
                    ]}
                  >
                    {curr.symbol} {curr.code}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {!showCommission ? (
            <TouchableOpacity
              style={styles.addCommissionButton}
              onPress={() => setShowCommission(true)}
            >
              <Plus size={16} color="#3B82F6" />
              <Text style={styles.addCommissionText}>إضافة عمولة</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.commissionSection}>
              <View style={styles.commissionHeader}>
                <TouchableOpacity
                  onPress={() => {
                    setShowCommission(false);
                    setFormData({ ...formData, commission: '', commissionRecipient: null });
                  }}
                >
                  <X size={20} color="#EF4444" />
                </TouchableOpacity>
                <Text style={styles.label}>عمولة (اختياري)</Text>
              </View>
              <View style={styles.commissionRow}>
                <View style={styles.commissionCurrencyDisplay}>
                  <Text style={styles.commissionCurrencyText}>{formData.commissionCurrency}</Text>
                  <Text style={styles.commissionCurrencySymbol}>
                    {CURRENCIES.find(c => c.code === formData.commissionCurrency)?.symbol || formData.commissionCurrency}
                  </Text>
                </View>
                <TextInput
                  style={styles.commissionInput}
                  placeholder="0.00"
                  keyboardType="decimal-pad"
                  value={formData.commission}
                  onChangeText={(text) => {
                    setFormData({ ...formData, commission: text });
                    setValidationError(null);
                  }}
                  placeholderTextColor="#9CA3AF"
                />
              </View>
            </View>
          )}

          {showCommission && formData.commission && parseFloat(formData.commission) > 0 && (
            <View style={styles.commissionRecipientSection}>
              <Text style={styles.label}>من يستلم العمولة؟</Text>
              <Text style={styles.commissionRecipientSubtitle}>
                اختر من سيستفيد من العمولة
              </Text>

              <View style={styles.commissionRecipientButtons}>
                {formData.toType === 'customer' && (
                  <TouchableOpacity
                    style={[
                      styles.recipientButton,
                      styles.recipientButtonTo,
                      formData.commissionRecipient === 'to' && styles.recipientButtonToActive,
                    ]}
                    onPress={() => setFormData({ ...formData, commissionRecipient: 'to' })}
                  >
                    <Text
                      style={[
                        styles.recipientButtonText,
                        formData.commissionRecipient === 'to' && styles.recipientButtonTextActive,
                      ]}
                    >
                      {formData.toCustomerName || 'المُحوَّل إليه'}
                    </Text>
                    <Text
                      style={[
                        styles.recipientButtonSubtext,
                        formData.commissionRecipient === 'to' && styles.recipientButtonSubtextActive,
                      ]}
                    >
                      يحصل على العمولة
                    </Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={[
                    styles.recipientButton,
                    styles.recipientButtonDefault,
                    formData.commissionRecipient === null && styles.recipientButtonDefaultActive,
                  ]}
                  onPress={() => setFormData({ ...formData, commissionRecipient: null })}
                >
                  <Text
                    style={[
                      styles.recipientButtonText,
                      formData.commissionRecipient === null && styles.recipientButtonTextActive,
                    ]}
                  >
                    الأرباح والخسائر
                  </Text>
                  <Text
                    style={[
                      styles.recipientButtonSubtext,
                      formData.commissionRecipient === null && styles.recipientButtonSubtextActive,
                    ]}
                  >
                    تحصل على العمولة
                  </Text>
                </TouchableOpacity>
              </View>

              {formData.commissionRecipient === 'to' ? (
                <View style={styles.commissionImpactInfo}>
                  <AlertCircle size={16} color="#3B82F6" />
                  <Text style={styles.commissionImpactText}>
                    حساب الأرباح والخسائر سيدفع عمولة {formData.commission} {CURRENCIES.find(c => c.code === formData.commissionCurrency)?.symbol} إلى {formData.toCustomerName}
                  </Text>
                </View>
              ) : (
                formData.commission && parseFloat(formData.commission) > 0 && (
                  <View style={styles.commissionImpactInfo}>
                    <AlertCircle size={16} color="#10B981" />
                    <Text style={[styles.commissionImpactText, { color: '#065F46' }]}>
                      حساب الأرباح والخسائر سيحصل على عمولة {formData.commission} {CURRENCIES.find(c => c.code === formData.commissionCurrency)?.symbol} من المبلغ المحول
                    </Text>
                  </View>
                )
              )}
            </View>
          )}

          <View style={styles.notesSection}>
            <Text style={styles.label}>ملاحظات <Text style={{ color: '#EF4444' }}>*</Text></Text>
            <TextInput
              style={styles.notesInput}
              placeholder="أضف ملاحظة توضح سبب التحويل"
              multiline
              numberOfLines={3}
              value={formData.notes}
              onChangeText={(text) => setFormData({ ...formData, notes: text })}
              placeholderTextColor="#9CA3AF"
              textAlign="right"
            />
          </View>

          {balanceImpact && (
            <View style={styles.impactContainer}>
              <Text style={styles.impactTitle}>تأثير التحويل:</Text>
              {balanceImpact.from && (
                <Text style={styles.impactText}>{balanceImpact.from}</Text>
              )}
              {balanceImpact.to && (
                <Text style={styles.impactText}>{balanceImpact.to}</Text>
              )}
              {balanceImpact.profitLossImpact && (
                <Text style={styles.impactCommissionText}>{balanceImpact.profitLossImpact}</Text>
              )}
              {balanceImpact.note && (
                <Text style={styles.impactNote}>{balanceImpact.note}</Text>
              )}
            </View>
          )}

          <View style={styles.buttonsContainer}>
            <TouchableOpacity
              style={[styles.submitButton, loading && styles.submitButtonDisabled]}
              onPress={() => handleSubmit(false)}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Save size={20} color="#FFFFFF" />
                  <Text style={styles.submitButtonText}>حفظ فقط</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.printButton, loading && styles.submitButtonDisabled]}
              onPress={() => handleSubmit(true)}
              disabled={loading}
            >
              <Printer size={18} color="#3B82F6" />
              <Text style={styles.printButtonText}>حفظ + طباعة</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAwareView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  header: {
    padding: 24,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 8,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEE2E2',
    padding: 12,
    marginHorizontal: 20,
    marginTop: 16,
    borderRadius: 12,
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 14,
    color: '#DC2626',
    textAlign: 'right',
  },
  form: {
    padding: 20,
  },
  arrowContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
  },
  arrowLine: {
    flex: 1,
    height: 2,
    backgroundColor: '#E5E7EB',
  },
  arrowCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 8,
  },
  amountSection: {
    marginTop: 8,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 8,
    textAlign: 'right',
  },
  amountInputContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    marginBottom: 20,
  },
  amountInput: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1F2937',
    padding: 16,
    textAlign: 'center',
  },
  currencyScroll: {
    marginBottom: 20,
  },
  currencyButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    marginRight: 8,
  },
  currencyButtonActive: {
    backgroundColor: '#3B82F6',
  },
  currencyButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  currencyButtonTextActive: {
    color: '#FFFFFF',
  },
  notesSection: {
    marginBottom: 20,
  },
  notesInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    padding: 16,
    fontSize: 16,
    color: '#1F2937',
    minHeight: 80,
    textAlignVertical: 'top',
  },
  impactContainer: {
    backgroundColor: '#FFFBEB',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FCD34D',
    marginBottom: 20,
  },
  impactTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#92400E',
    marginBottom: 8,
    textAlign: 'right',
  },
  impactText: {
    fontSize: 14,
    color: '#78350F',
    marginBottom: 4,
    textAlign: 'right',
  },
  impactCommissionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#DC2626',
    marginBottom: 4,
    textAlign: 'right',
  },
  impactNote: {
    fontSize: 12,
    color: '#A16207',
    marginTop: 8,
    fontStyle: 'italic',
    textAlign: 'right',
  },
  addCommissionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    marginBottom: 16,
  },
  addCommissionText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#3B82F6',
  },
  commissionSection: {
    marginBottom: 20,
  },
  commissionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  commissionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  commissionCurrencyDisplay: {
    backgroundColor: '#4F46E5',
    borderRadius: 12,
    padding: 14,
    width: 90,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commissionCurrencyText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  commissionCurrencySymbol: {
    fontSize: 12,
    color: '#E0E7FF',
  },
  commissionInput: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 20,
    fontWeight: '600',
    color: '#1F2937',
    textAlign: 'center',
  },
  buttonsContainer: {
    gap: 10,
  },
  submitButton: {
    backgroundColor: '#10B981',
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  printButton: {
    backgroundColor: '#EFF6FF',
    padding: 14,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  printButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#3B82F6',
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
  commissionRecipientSection: {
    marginBottom: 20,
  },
  commissionRecipientSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 12,
    textAlign: 'right',
  },
  commissionRecipientButtons: {
    gap: 10,
  },
  recipientButton: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
  },
  recipientButtonFrom: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  recipientButtonFromActive: {
    backgroundColor: '#3B82F6',
    borderColor: '#3B82F6',
  },
  recipientButtonTo: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  recipientButtonToActive: {
    backgroundColor: '#10B981',
    borderColor: '#10B981',
  },
  recipientButtonDefault: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FCD34D',
  },
  recipientButtonDefaultActive: {
    backgroundColor: '#F59E0B',
    borderColor: '#F59E0B',
  },
  recipientButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 4,
  },
  recipientButtonTextActive: {
    color: '#FFFFFF',
  },
  recipientButtonSubtext: {
    fontSize: 13,
    color: '#6B7280',
  },
  recipientButtonSubtextActive: {
    color: '#F3F4F6',
  },
  commissionImpactInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EFF6FF',
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
  },
  commissionImpactText: {
    flex: 1,
    fontSize: 14,
    color: '#1E40AF',
    textAlign: 'right',
  },
});
