import React, { useEffect, useMemo, useState } from 'react';
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
import {
  ArrowDownLeft,
  ArrowUpRight,
  BadgePercent,
  Check,
  ChevronDown,
  Save,
  Search,
  WalletCards,
  X,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { useDataRefresh } from '@/contexts/DataRefreshContext';
import { supabase } from '@/lib/supabase';
import {
  CURRENCIES,
  Currency,
  Customer,
  EntityTransferDirection,
  TransferCommissionCalculationType,
} from '@/types/database';
import { formatSmartNumber } from '@/utils/arabicFormat';
import { validateNumericInput } from '@/utils/numericValidation';
import {
  calculateTransferCommissionSummary,
  getTransferCommissionQuoteKey,
  roundMoney,
} from '@/utils/transferCommission';

type PickerKind = 'currency' | 'debit' | 'credit' | null;

interface EntityTransferFormSheetProps {
  visible: boolean;
  accounts: Customer[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

interface PickerOption {
  id: string;
  title: string;
  subtitle?: string;
}

interface CommissionRuleQuote {
  matched: boolean;
  rule_id?: string;
  calculation_type?: TransferCommissionCalculationType;
  customer_value?: number;
  network_value?: number;
  calculated_customer_commission?: number;
  calculated_network_commission?: number;
}

const LAST_ENTITY_TRANSFER_CURRENCY = '@last_entity_transfer_currency';

const COMMISSION_TYPE_LABELS: Record<TransferCommissionCalculationType, string> = {
  fixed: 'مبلغ ثابت',
  percentage: 'نسبة مئوية',
  per_thousand: 'لكل ألف',
  per_million: 'لكل مليون',
};

function commissionValueToInput(value: number | string | null | undefined) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? String(roundMoney(numericValue)) : '0';
}

export default function EntityTransferFormSheet({
  visible,
  accounts,
  onClose,
  onSaved,
}: EntityTransferFormSheetProps) {
  const { currentUser } = useAuth();
  const { triggerRefresh } = useDataRefresh();
  const insets = useSafeAreaInsets();

  const [direction, setDirection] = useState<EntityTransferDirection>('send');
  const [senderName, setSenderName] = useState('');
  const [senderPhone, setSenderPhone] = useState('');
  const [beneficiaryName, setBeneficiaryName] = useState('');
  const [beneficiaryPhone, setBeneficiaryPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<Currency>('SAR');
  const [debitCustomerId, setDebitCustomerId] = useState('');
  const [creditCustomerId, setCreditCustomerId] = useState('');
  const [notes, setNotes] = useState('');
  const [commissionEnabled, setCommissionEnabled] = useState(true);
  const [customerCommission, setCustomerCommission] = useState('0');
  const [networkCommission, setNetworkCommission] = useState('0');
  const [matchedCommissionRule, setMatchedCommissionRule] =
    useState<CommissionRuleQuote | null>(null);
  const [resolvedCommissionQuoteKey, setResolvedCommissionQuoteKey] =
    useState<string | null>(null);
  const [commissionRuleError, setCommissionRuleError] = useState('');
  const [isLoadingCommissionRule, setIsLoadingCommissionRule] = useState(false);
  const [operationId, setOperationId] = useState('');
  const [pickerKind, setPickerKind] = useState<PickerKind>(null);
  const [accountSearchQuery, setAccountSearchQuery] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const pickerSearchInputRef = React.useRef<TextInput>(null);

  useEffect(() => {
    if (!visible) return;

    setDirection('send');
    setSenderName('');
    setSenderPhone('');
    setBeneficiaryName('');
    setBeneficiaryPhone('');
    setAmount('');
    setDebitCustomerId('');
    setCreditCustomerId('');
    setNotes('');
    setCommissionEnabled(true);
    setCustomerCommission('0');
    setNetworkCommission('0');
    setMatchedCommissionRule(null);
    setResolvedCommissionQuoteKey(null);
    setCommissionRuleError('');
    setIsLoadingCommissionRule(false);
    setOperationId(Crypto.randomUUID());
    setPickerKind(null);
    setAccountSearchQuery('');

    AsyncStorage.getItem(LAST_ENTITY_TRANSFER_CURRENCY)
      .then((savedCurrency) => {
        if (CURRENCIES.some((item) => item.code === savedCurrency)) {
          setCurrency(savedCurrency as Currency);
        }
      })
      .catch((error) => console.warn('Unable to load transfer currency:', error));
  }, [visible]);

  useEffect(() => {
    if (!visible || !commissionEnabled) {
      setMatchedCommissionRule(null);
      setResolvedCommissionQuoteKey(null);
      setCommissionRuleError('');
      setIsLoadingCommissionRule(false);
      return;
    }

    const parsedAmount = Number(amount);
    if (
      !currentUser?.userId ||
      !Number.isFinite(parsedAmount) ||
      parsedAmount <= 0
    ) {
      setMatchedCommissionRule(null);
      setResolvedCommissionQuoteKey(null);
      setCommissionRuleError('');
      setCustomerCommission('0');
      setNetworkCommission('0');
      setIsLoadingCommissionRule(false);
      return;
    }

    const requestQuoteKey = getTransferCommissionQuoteKey(
      currentUser.userId,
      direction,
      currency,
      parsedAmount,
    );
    let isCurrentRequest = true;
    setResolvedCommissionQuoteKey(null);
    setMatchedCommissionRule(null);
    setCustomerCommission('0');
    setNetworkCommission('0');
    setIsLoadingCommissionRule(true);

    const timer = setTimeout(async () => {
      setCommissionRuleError('');

      try {
        const { data, error } = await supabase.rpc(
          'get_matching_transfer_commission_rule',
          {
            p_user_id: currentUser.userId,
            p_direction: direction,
            p_currency: currency,
            p_amount: parsedAmount,
          },
        );

        if (!isCurrentRequest) return;
        if (error) throw error;

        const quote = data as CommissionRuleQuote | null;
        if (quote?.matched && quote.rule_id) {
          setMatchedCommissionRule(quote);
          setCustomerCommission(
            commissionValueToInput(quote.calculated_customer_commission),
          );
          setNetworkCommission(
            commissionValueToInput(quote.calculated_network_commission),
          );
        } else {
          setMatchedCommissionRule(null);
          setCustomerCommission('0');
          setNetworkCommission('0');
        }
        setResolvedCommissionQuoteKey(requestQuoteKey);
      } catch (error) {
        if (!isCurrentRequest) return;
        console.error('Error loading transfer commission rule:', error);
        setMatchedCommissionRule(null);
        setCustomerCommission('0');
        setNetworkCommission('0');
        setCommissionRuleError(
          'تعذر تحميل القاعدة تلقائياً؛ يمكنك إدخال العمولة يدوياً.',
        );
        setResolvedCommissionQuoteKey(requestQuoteKey);
      } finally {
        if (isCurrentRequest) setIsLoadingCommissionRule(false);
      }
    }, 300);

    return () => {
      isCurrentRequest = false;
      clearTimeout(timer);
    };
  }, [
    amount,
    commissionEnabled,
    currency,
    currentUser?.userId,
    direction,
    visible,
  ]);

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (pickerKind !== 'currency' && pickerKind !== null) {
      const timer = setTimeout(() => {
        pickerSearchInputRef.current?.focus();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [pickerKind]);

  const selectedDebitAccount = accounts.find((account) => account.id === debitCustomerId);
  const selectedCreditAccount = accounts.find((account) => account.id === creditCustomerId);
  const selectedCurrency = CURRENCIES.find((item) => item.code === currency);
  const hasValidTransferAmount = Number.isFinite(Number(amount)) && Number(amount) > 0;
  const currentCommissionQuoteKey = getTransferCommissionQuoteKey(
    currentUser?.userId,
    direction,
    currency,
    Number(amount),
  );
  const isCommissionQuotePending = Boolean(
    commissionEnabled &&
      currentCommissionQuoteKey &&
      (isLoadingCommissionRule ||
        resolvedCommissionQuoteKey !== currentCommissionQuoteKey),
  );
  const commissionSummary = calculateTransferCommissionSummary(
    Number(amount),
    Number(customerCommission),
    Number(networkCommission),
  );
  const commissionWasEdited = Boolean(
    matchedCommissionRule?.matched &&
      (roundMoney(Number(customerCommission)) !==
        roundMoney(Number(matchedCommissionRule.calculated_customer_commission)) ||
        roundMoney(Number(networkCommission)) !==
          roundMoney(Number(matchedCommissionRule.calculated_network_commission))),
  );

  const pickerConfig = useMemo(() => {
    if (pickerKind === 'currency') {
      return {
        title: 'اختر العملة',
        selectedId: currency,
        emptyText: 'لا توجد عملات',
        options: CURRENCIES.map<PickerOption>((item) => ({
          id: item.code,
          title: `${item.code} - ${item.name}`,
          subtitle: item.symbol,
        })),
      };
    }

    return {
      title:
        pickerKind === 'debit'
          ? 'اختر الحساب المدين'
          : 'اختر الحساب الدائن',
      selectedId: pickerKind === 'debit' ? debitCustomerId : creditCustomerId,
      emptyText: 'لا توجد حسابات غير مرتبطة متاحة',
      options: accounts.map<PickerOption>((account) => ({
        id: account.id,
        title: account.name,
        subtitle: account.account_number ? `حساب ${account.account_number}` : 'حساب غير مرتبط',
      })),
    };
  }, [pickerKind, currency, accounts, debitCustomerId, creditCustomerId]);

  const filteredPickerOptions = useMemo(() => {
    if (pickerKind === 'currency') return pickerConfig.options;

    const normalizedQuery = accountSearchQuery.trim().toLocaleLowerCase('ar');
    if (!normalizedQuery) return pickerConfig.options;

    return pickerConfig.options.filter((option) =>
      option.title.toLocaleLowerCase('ar').includes(normalizedQuery),
    );
  }, [accountSearchQuery, pickerConfig.options, pickerKind]);

  const handlePickerSelect = (id: string) => {
    if (pickerKind === 'currency') {
      setCurrency(id as Currency);
    } else if (pickerKind === 'debit') {
      if (id === creditCustomerId) {
        Alert.alert('تنبيه', 'الحساب المدين يجب أن يختلف عن الحساب الدائن');
        return;
      }
      setDebitCustomerId(id);
    } else if (pickerKind === 'credit') {
      if (id === debitCustomerId) {
        Alert.alert('تنبيه', 'الحساب الدائن يجب أن يختلف عن الحساب المدين');
        return;
      }
      setCreditCustomerId(id);
    }

    setAccountSearchQuery('');
    setPickerKind(null);
  };

  const handleCommissionToggle = (enabled: boolean) => {
    setCommissionEnabled(enabled);
    setResolvedCommissionQuoteKey(null);
    setCommissionRuleError('');

    if (!enabled) {
      setMatchedCommissionRule(null);
      setCustomerCommission('0');
      setNetworkCommission('0');
    }
  };

  const validateForm = () => {
    if (!senderName.trim() || !senderPhone.trim()) {
      return 'اسم المرسل وهاتفه مطلوبان';
    }

    if (!beneficiaryName.trim() || !beneficiaryPhone.trim()) {
      return 'اسم المستلم وهاتفه مطلوبان';
    }

    const parsedAmount = Number(amount);
    if (!amount.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return 'أدخل مبلغاً صحيحاً أكبر من صفر';
    }

    if (!debitCustomerId) return 'اختر الحساب المدين';
    if (!creditCustomerId) return 'اختر الحساب الدائن';
    if (debitCustomerId === creditCustomerId) {
      return 'الحساب المدين يجب أن يختلف عن الحساب الدائن';
    }

    if (commissionEnabled) {
      if (isCommissionQuotePending) {
        return 'انتظر اكتمال احتساب العمولة التلقائية';
      }

      const parsedCustomerCommission = customerCommission.trim()
        ? Number(customerCommission)
        : 0;
      const parsedNetworkCommission = networkCommission.trim()
        ? Number(networkCommission)
        : 0;

      if (
        !Number.isFinite(parsedCustomerCommission) ||
        parsedCustomerCommission < 0
      ) {
        return 'أدخل عمولة العميل بشكل صحيح';
      }

      if (
        !Number.isFinite(parsedNetworkCommission) ||
        parsedNetworkCommission < 0
      ) {
        return 'أدخل عمولة الشبكة بشكل صحيح';
      }
    }

    return null;
  };

  const handleSave = async () => {
    const validationMessage = validateForm();
    if (validationMessage) {
      Alert.alert('بيانات ناقصة', validationMessage);
      return;
    }

    if (!currentUser?.userId) {
      Alert.alert('خطأ', 'يجب تسجيل الدخول أولاً');
      return;
    }

    setIsSaving(true);

    try {
      const currentOperationId = operationId || Crypto.randomUUID();
      if (!operationId) setOperationId(currentOperationId);

      const { error } = await supabase.rpc('create_entity_transfer', {
        p_operation_id: currentOperationId,
        p_user_id: currentUser.userId,
        p_entity_id: null,
        p_direction: direction,
        p_sender_name: senderName.trim(),
        p_sender_phone: senderPhone.trim(),
        p_beneficiary_name: beneficiaryName.trim(),
        p_beneficiary_phone: beneficiaryPhone.trim(),
        p_amount: Number(amount),
        p_currency: currency,
        p_debit_customer_id: debitCustomerId,
        p_credit_customer_id: creditCustomerId,
        p_notes: notes.trim() || null,
        p_commission_enabled: commissionEnabled,
        p_commission_rule_id: matchedCommissionRule?.rule_id || null,
        p_customer_commission: commissionEnabled ? Number(customerCommission) : null,
        p_network_commission: commissionEnabled ? Number(networkCommission) : null,
      });

      if (error) throw error;

      await AsyncStorage.setItem(LAST_ENTITY_TRANSFER_CURRENCY, currency);
      triggerRefresh('all');
      await Promise.resolve(onSaved());
      onClose();

      setTimeout(() => {
        Alert.alert(
          'تم الحفظ',
          direction === 'send'
              ? `تم تسجيل حوالة الإرسال والقيد المحاسبي${commissionEnabled ? ' والعمولة' : ''} بنجاح`
              : `تم تسجيل حوالة الاستلام والقيد المحاسبي${commissionEnabled ? ' والعمولة' : ''} بنجاح`,
        );
      }, 250);
    } catch (error: any) {
      console.error('Error creating entity transfer:', error);
      const rawMessage = typeof error?.message === 'string' ? error.message : '';
      const arabicMessage = rawMessage.match(/[\u0600-\u06FF][\u0600-\u06FF\s،؛\-]+/u)?.[0];

      if (rawMessage.includes('create_entity_transfer')) {
        Alert.alert(
          'قاعدة البيانات غير محدثة',
          'يجب تطبيق آخر تحديث لقاعدة البيانات ثم إعادة المحاولة.',
        );
      } else {
        Alert.alert('تعذر الحفظ', arabicMessage?.trim() || 'حدث خطأ أثناء تسجيل الحوالة');
      }
    } finally {
      setIsSaving(false);
    }
  };

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
            <TouchableOpacity
              activeOpacity={1}
              onPress={(event) => event.stopPropagation()}
              style={styles.sheet}
            >
              <View style={styles.header}>
                <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                  <X size={22} color="#6B7280" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>حوالة جديدة</Text>
                <View style={styles.headerPlaceholder} />
              </View>

              <ScrollView
                style={styles.scrollView}
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>
                    نوع الحوالة <Text style={styles.required}>*</Text>
                  </Text>
                  <View style={styles.typeButtons}>
                    <TouchableOpacity
                      style={[
                        styles.typeButton,
                        direction === 'send' && styles.typeButtonActiveRed,
                      ]}
                      onPress={() => setDirection('send')}
                    >
                      <ArrowUpRight
                        size={22}
                        color={direction === 'send' ? '#FFFFFF' : '#EF4444'}
                      />
                      <Text
                        style={[
                          styles.typeButtonText,
                          direction === 'send' && styles.typeButtonTextActive,
                        ]}
                      >
                        إرسال
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.typeButton,
                        direction === 'receive' && styles.typeButtonActiveGreen,
                      ]}
                      onPress={() => setDirection('receive')}
                    >
                      <ArrowDownLeft
                        size={22}
                        color={direction === 'receive' ? '#FFFFFF' : '#10B981'}
                      />
                      <Text
                        style={[
                          styles.typeButtonText,
                          direction === 'receive' && styles.typeButtonTextActive,
                        ]}
                      >
                        استلام
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>
                    بيانات المرسل <Text style={styles.required}>*</Text>
                  </Text>
                  <View style={styles.fieldGroup}>
                    <FormInput
                      value={senderName}
                      onChangeText={setSenderName}
                      placeholder="اسم المرسل"
                    />
                    <FormInput
                      value={senderPhone}
                      onChangeText={setSenderPhone}
                      placeholder="هاتف المرسل"
                      keyboardType="phone-pad"
                    />
                  </View>
                </View>

                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>
                    بيانات المستلم <Text style={styles.required}>*</Text>
                  </Text>
                  <View style={styles.fieldGroup}>
                    <FormInput
                      value={beneficiaryName}
                      onChangeText={setBeneficiaryName}
                      placeholder="اسم المستلم"
                    />
                    <FormInput
                      value={beneficiaryPhone}
                      onChangeText={setBeneficiaryPhone}
                      placeholder="هاتف المستلم"
                      keyboardType="phone-pad"
                    />
                  </View>
                </View>

                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>
                    المبلغ والعملة <Text style={styles.required}>*</Text>
                  </Text>
                  <View style={styles.amountRow}>
                    <TouchableOpacity
                      style={styles.currencyButton}
                      onPress={() => setPickerKind('currency')}
                    >
                      <Text style={styles.currencyCode}>{currency}</Text>
                      <Text style={styles.currencySymbol}>{selectedCurrency?.symbol}</Text>
                    </TouchableOpacity>
                    <TextInput
                      style={styles.amountInput}
                      value={amount}
                      onChangeText={(value) =>
                        setAmount(validateNumericInput(value, { allowDecimal: true }).cleanedValue)
                      }
                      placeholder="0.00"
                      placeholderTextColor="#9CA3AF"
                      keyboardType="decimal-pad"
                      textAlign="center"
                    />
                  </View>
                </View>

                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>
                    القيد المحاسبي <Text style={styles.required}>*</Text>
                  </Text>
                  <View style={styles.fieldGroup}>
                    <SelectorField
                      label="الحساب المدين"
                      value={selectedDebitAccount?.name || 'اختر الحساب المدين'}
                      subtitle={selectedDebitAccount?.account_number}
                      onPress={() => setPickerKind('debit')}
                      color="#EF4444"
                    />
                    <SelectorField
                      label="الحساب الدائن"
                      value={selectedCreditAccount?.name || 'اختر الحساب الدائن'}
                      subtitle={selectedCreditAccount?.account_number}
                      onPress={() => setPickerKind('credit')}
                      color="#10B981"
                    />
                  </View>
                </View>

                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>العمولة</Text>
                  <View style={styles.commissionToggleRow}>
                    <TouchableOpacity
                      style={[
                        styles.commissionToggleButton,
                        !commissionEnabled && styles.commissionToggleButtonActive,
                      ]}
                      onPress={() => handleCommissionToggle(false)}
                      activeOpacity={0.85}
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
                      onPress={() => handleCommissionToggle(true)}
                      activeOpacity={0.85}
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

                  {commissionEnabled ? (
                    <View style={styles.commissionContent}>
                      <View
                        style={[
                          styles.ruleStatus,
                          commissionRuleError
                            ? styles.ruleStatusError
                            : !hasValidTransferAmount
                              ? styles.ruleStatusPending
                            : matchedCommissionRule
                              ? styles.ruleStatusMatched
                              : styles.ruleStatusManual,
                        ]}
                      >
                        {isLoadingCommissionRule ? (
                          <>
                            <ActivityIndicator size="small" color="#4F46E5" />
                            <Text style={styles.ruleStatusText}>
                              جاري البحث عن القاعدة المطابقة...
                            </Text>
                          </>
                        ) : (
                          <>
                            <BadgePercent
                              size={18}
                              color={
                                commissionRuleError
                                  ? '#DC2626'
                                  : !hasValidTransferAmount
                                    ? '#64748B'
                                  : matchedCommissionRule
                                    ? '#4F46E5'
                                    : '#D97706'
                              }
                            />
                            <Text style={styles.ruleStatusText}>
                              {commissionRuleError ||
                                (!hasValidTransferAmount
                                  ? 'أدخل مبلغ الحوالة لتطبيق قاعدة العمولة تلقائياً.'
                                  : matchedCommissionRule
                                  ? `تم تطبيق قاعدة ${
                                      COMMISSION_TYPE_LABELS[
                                        matchedCommissionRule.calculation_type || 'fixed'
                                      ]
                                    } تلقائياً${
                                      commissionWasEdited ? ' — تم تعديل القيم' : ''
                                    }`
                                  : 'لا توجد قاعدة مطابقة؛ أدخل العمولة يدوياً أو أضف قاعدة من الإعدادات.')}
                            </Text>
                          </>
                        )}
                      </View>

                      <View style={styles.commissionInputsRow}>
                        <CommissionInput
                          label="عمولة العميل"
                          value={customerCommission}
                          currency={currency}
                          color="#4F46E5"
                          onChangeText={setCustomerCommission}
                        />
                        <CommissionInput
                          label="عمولة الشبكة"
                          value={networkCommission}
                          currency={currency}
                          color="#0EA5E9"
                          onChangeText={setNetworkCommission}
                        />
                      </View>

                      <View style={styles.commissionPreview}>
                        <PreviewRow
                          label="إجمالي الحساب المدين"
                          value={commissionSummary.debitTotal}
                          currency={currency}
                        />
                        <PreviewRow
                          label="مستحق الحساب الدائن"
                          value={commissionSummary.networkTotal}
                          currency={currency}
                        />
                        <View style={styles.previewDivider} />
                        <PreviewRow
                          label={
                            commissionSummary.netProfit < 0
                              ? 'صافي الخسارة'
                              : 'صافي الربح'
                          }
                          value={Math.abs(commissionSummary.netProfit)}
                          currency={currency}
                          valueColor={
                            commissionSummary.netProfit < 0 ? '#DC2626' : '#059669'
                          }
                          strong
                        />
                      </View>

                      <Text style={styles.accountingHint}>
                        يُسجل المبلغ المستحق في الحساب الدائن، وصافي الفرق يُسجل
                        تلقائياً في حساب الأرباح والخسائر الخاص بك.
                      </Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>ملاحظات</Text>
                  <TextInput
                    style={styles.notesInput}
                    value={notes}
                    onChangeText={setNotes}
                    placeholder="ملاحظات اختيارية"
                    placeholderTextColor="#9CA3AF"
                    multiline
                    textAlign="right"
                    textAlignVertical="top"
                  />
                </View>

                {accounts.length < 2 ? (
                  <View style={styles.infoBox}>
                    <Text style={styles.infoText}>
                      تحتاج إلى حسابين غير مرتبطين على الأقل لتسجيل القيد المدين والدائن.
                    </Text>
                  </View>
                ) : null}
              </ScrollView>

              <View
                style={[
                  styles.footer,
                  { paddingBottom: keyboardHeight > 0 ? 12 : Math.max(insets.bottom, 12) },
                ]}
              >
                <TouchableOpacity
                  style={[
                    styles.saveButton,
                    (isSaving || isCommissionQuotePending) &&
                      styles.saveButtonDisabled,
                  ]}
                  onPress={handleSave}
                  disabled={isSaving || isCommissionQuotePending}
                >
                  {isSaving ? (
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

      <Modal
        visible={pickerKind !== null}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setAccountSearchQuery('');
          setPickerKind(null);
        }}
      >
        <TouchableOpacity
          style={styles.pickerOverlay}
          activeOpacity={1}
          onPress={() => {
            setAccountSearchQuery('');
            setPickerKind(null);
          }}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.pickerKeyboardContainer}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 40 : 0}
            enabled={Platform.OS === 'ios'}
          >
            <TouchableOpacity
              activeOpacity={1}
              onPress={(event) => event.stopPropagation()}
              style={[styles.pickerContent, { paddingBottom: Math.max(insets.bottom + keyboardHeight, 18) }]}
            >
              <View style={styles.pickerHeader}>
                <TouchableOpacity
                  onPress={() => {
                    setAccountSearchQuery('');
                    setPickerKind(null);
                  }}
                  style={styles.closeButton}
                >
                  <X size={21} color="#6B7280" />
                </TouchableOpacity>
                <Text style={styles.pickerTitle}>{pickerConfig.title}</Text>
                <View style={styles.headerPlaceholder} />
              </View>

              {pickerKind !== 'currency' ? (
                <View style={styles.pickerSearchBox}>
                  <Search size={19} color="#9CA3AF" />
                  <TextInput
                    ref={pickerSearchInputRef}
                    value={accountSearchQuery}
                    onChangeText={setAccountSearchQuery}
                    style={styles.pickerSearchInput}
                    placeholder="ابحث باسم الحساب"
                    placeholderTextColor="#9CA3AF"
                    textAlign="right"
                    returnKeyType="search"
                    accessibilityLabel="البحث باسم الحساب"
                  />
                  {accountSearchQuery ? (
                    <TouchableOpacity
                      onPress={() => setAccountSearchQuery('')}
                      style={styles.clearSearchButton}
                      accessibilityRole="button"
                      accessibilityLabel="مسح البحث"
                    >
                      <X size={17} color="#6B7280" />
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}

              <ScrollView
                style={styles.pickerList}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {filteredPickerOptions.length === 0 ? (
                  <Text style={styles.pickerEmpty}>
                    {accountSearchQuery.trim()
                      ? 'لا توجد حسابات مطابقة للاسم المدخل'
                      : pickerConfig.emptyText}
                  </Text>
                ) : (
                  filteredPickerOptions.map((option) => {
                    const isSelected = option.id === pickerConfig.selectedId;
                    return (
                      <TouchableOpacity
                        key={option.id}
                        style={[styles.pickerOption, isSelected && styles.pickerOptionSelected]}
                        onPress={() => handlePickerSelect(option.id)}
                      >
                        <View style={styles.pickerOptionText}>
                          <Text
                            style={[
                              styles.pickerOptionTitle,
                              isSelected && styles.pickerOptionTitleSelected,
                            ]}
                          >
                            {option.title}
                          </Text>
                          {option.subtitle ? (
                            <Text style={styles.pickerOptionSubtitle}>{option.subtitle}</Text>
                          ) : null}
                        </View>
                        {isSelected ? <Check size={20} color="#4F46E5" /> : null}
                      </TouchableOpacity>
                    );
                  })
                )}
              </ScrollView>
            </TouchableOpacity>
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

function FormInput({
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: 'default' | 'phone-pad';
}) {
  return (
    <TextInput
      style={styles.input}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor="#9CA3AF"
      keyboardType={keyboardType}
      textAlign="right"
    />
  );
}

function CommissionInput({
  label,
  value,
  currency,
  color,
  onChangeText,
}: {
  label: string;
  value: string;
  currency: string;
  color: string;
  onChangeText: (value: string) => void;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const isZeroValue = value.trim() !== '' && Number(value) === 0;

  return (
    <View style={styles.commissionInputColumn}>
      <View style={styles.commissionInputLabelRow}>
        <View style={[styles.commissionDot, { backgroundColor: color }]} />
        <Text style={styles.commissionInputLabel}>{label}</Text>
      </View>
      <View style={styles.commissionInputBox}>
        <TextInput
          style={[
            styles.commissionInput,
            isZeroValue && !isFocused && styles.commissionInputZero,
          ]}
          value={value}
          onChangeText={(nextValue) =>
            onChangeText(
              validateNumericInput(nextValue, { allowDecimal: true }).cleanedValue,
            )
          }
          onFocus={() => {
            setIsFocused(true);
            if (isZeroValue) onChangeText('');
          }}
          onBlur={() => setIsFocused(false)}
          placeholder={isFocused ? '' : '0'}
          placeholderTextColor="rgba(156, 163, 175, 0.65)"
          keyboardType="decimal-pad"
          textAlign="center"
        />
        <Text style={styles.commissionCurrency}>{currency}</Text>
      </View>
    </View>
  );
}

function PreviewRow({
  label,
  value,
  currency,
  valueColor = '#111827',
  strong = false,
}: {
  label: string;
  value: number;
  currency: string;
  valueColor?: string;
  strong?: boolean;
}) {
  return (
    <View style={styles.previewRow}>
      <Text
        style={[
          styles.previewValue,
          { color: valueColor },
          strong && styles.previewValueStrong,
        ]}
      >
        {formatSmartNumber(value)} {currency}
      </Text>
      <Text style={[styles.previewLabel, strong && styles.previewLabelStrong]}>
        {label}
      </Text>
    </View>
  );
}

function SelectorField({
  label,
  value,
  subtitle,
  onPress,
  color,
}: {
  label: string;
  value: string;
  subtitle?: string;
  onPress: () => void;
  color: string;
}) {
  return (
    <TouchableOpacity style={styles.selector} onPress={onPress} activeOpacity={0.8}>
      <ChevronDown size={18} color="#6B7280" />
      <View style={styles.selectorBody}>
        <Text style={styles.selectorLabel}>{label}</Text>
        <Text style={styles.selectorValue} numberOfLines={1}>
          {value}
        </Text>
        {subtitle ? <Text style={styles.selectorSubtitle}>رقم الحساب: {subtitle}</Text> : null}
      </View>
      <View style={[styles.selectorIcon, { backgroundColor: `${color}15` }]}>
        <WalletCards size={18} color={color} />
      </View>
    </TouchableOpacity>
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
    flex: 1,
    maxHeight: '92%',
    direction: 'rtl',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
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
  headerPlaceholder: {
    width: 30,
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
    paddingBottom: 24,
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
    paddingVertical: 10,
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
    color: '#111827',
    marginTop: 4,
  },
  typeButtonTextActive: {
    color: '#FFFFFF',
  },
  fieldGroup: {
    gap: 8,
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
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
    justifyContent: 'center',
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
  },
  selector: {
    minHeight: 58,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  selectorBody: {
    flex: 1,
    alignItems: 'flex-end',
  },
  selectorLabel: {
    fontSize: 11,
    color: '#6B7280',
    marginBottom: 1,
  },
  selectorValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'right',
  },
  selectorSubtitle: {
    fontSize: 10,
    color: '#9CA3AF',
    marginTop: 1,
  },
  selectorIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
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
  commissionContent: {
    marginTop: 9,
    gap: 10,
  },
  ruleStatus: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ruleStatusMatched: {
    backgroundColor: '#EEF2FF',
    borderColor: '#C7D2FE',
  },
  ruleStatusPending: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
  },
  ruleStatusManual: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  ruleStatusError: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  ruleStatusText: {
    flex: 1,
    color: '#374151',
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'right',
  },
  commissionInputsRow: {
    flexDirection: 'row',
    gap: 9,
  },
  commissionInputColumn: {
    flex: 1,
    gap: 6,
  },
  commissionInputLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  commissionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  commissionInputLabel: {
    color: '#4B5563',
    fontSize: 12,
    fontWeight: '600',
  },
  commissionInputBox: {
    minHeight: 50,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
  },
  commissionInput: {
    flex: 1,
    color: '#111827',
    fontSize: 16,
    fontWeight: '700',
    paddingVertical: 9,
  },
  commissionInputZero: {
    color: 'rgba(156, 163, 175, 0.65)',
  },
  commissionCurrency: {
    color: '#6B7280',
    fontSize: 10,
    fontWeight: '700',
    marginLeft: 5,
  },
  commissionPreview: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 13,
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 7,
  },
  previewRow: {
    minHeight: 23,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  previewLabel: {
    color: '#64748B',
    fontSize: 12,
    textAlign: 'right',
  },
  previewLabelStrong: {
    color: '#374151',
    fontWeight: '700',
  },
  previewValue: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'left',
  },
  previewValueStrong: {
    fontSize: 14,
    fontWeight: '800',
  },
  previewDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
  },
  accountingHint: {
    color: '#166534',
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'right',
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
  infoBox: {
    backgroundColor: '#FFF7ED',
    borderRadius: 12,
    padding: 11,
    borderWidth: 1,
    borderColor: '#FED7AA',
    marginBottom: 10,
  },
  infoText: {
    fontSize: 12,
    lineHeight: 19,
    color: '#9A3412',
    textAlign: 'right',
  },
  footer: {
    paddingHorizontal: 18,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
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
  pickerOverlay: {
    flex: 1,
    direction: 'rtl',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  pickerKeyboardContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  pickerContent: {
    direction: 'rtl',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '72%',
    overflow: 'hidden',
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#111827',
  },
  pickerSearchBox: {
    minHeight: 48,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    paddingHorizontal: 12,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pickerSearchInput: {
    flex: 1,
    color: '#111827',
    fontSize: 15,
    paddingVertical: 10,
  },
  clearSearchButton: {
    padding: 3,
  },
  pickerList: {
    paddingHorizontal: 16,
  },
  pickerOption: {
    minHeight: 58,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pickerOptionSelected: {
    backgroundColor: '#EEF2FF',
    borderRadius: 12,
  },
  pickerOptionText: {
    flex: 1,
    alignItems: 'flex-end',
  },
  pickerOptionTitle: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'right',
  },
  pickerOptionTitleSelected: {
    color: '#4F46E5',
    fontWeight: '800',
  },
  pickerOptionSubtitle: {
    color: '#9CA3AF',
    fontSize: 11,
    marginTop: 2,
    textAlign: 'right',
  },
  pickerEmpty: {
    color: '#6B7280',
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 38,
  },
});
