import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  ArrowDownLeft,
  ArrowUpRight,
  BadgePercent,
  Check,
  ChevronDown,
  Save,
  X,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { useFocusedInputScroll } from '@/hooks/useFocusedInputScroll';
import { supabase } from '@/lib/supabase';
import {
  CURRENCIES,
  Currency,
  TransferCommissionCalculationType,
  TransferCommissionRule,
} from '@/types/database';

interface TransferCommissionRuleFormSheetProps {
  visible: boolean;
  rule?: TransferCommissionRule | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

type TransferDirection = 'send' | 'receive';
type PickerKind = 'currency' | 'calculation' | null;

interface PickerOption {
  id: string;
  title: string;
  subtitle?: string;
}

const CALCULATION_TYPES: {
  value: TransferCommissionCalculationType;
  label: string;
  hint: string;
}[] = [
  { value: 'fixed', label: 'مبلغ ثابت', hint: 'قيمة ثابتة لكل حوالة' },
  { value: 'percentage', label: 'نسبة مئوية', hint: 'من قيمة الحوالة' },
  { value: 'per_thousand', label: 'لكل ألف', hint: 'عن كل 1,000' },
  { value: 'per_million', label: 'لكل مليون', hint: 'عن كل 1,000,000' },
];

function normalizeNumber(value: string) {
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  const easternDigits = '۰۱۲۳۴۵۶۷۸۹';
  let normalized = value
    .trim()
    .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(easternDigits.indexOf(digit)))
    .replace(/٬/g, '')
    .replace(/٫/g, '.')
    .replace(/\s/g, '');

  if (normalized.includes('.') && normalized.includes(',')) {
    normalized = normalized.replace(/,/g, '');
  } else if (normalized.includes(',')) {
    normalized = normalized.replace(',', '.');
  }

  return normalized;
}

function parseAmount(value: string) {
  const normalized = normalizeNumber(value);
  if (!normalized || !/^(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return null;

  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function numberToInput(value: number | null | undefined) {
  if (value === null || value === undefined) return '';
  return String(Number(value));
}

export default function TransferCommissionRuleFormSheet({
  visible,
  rule = null,
  onClose,
  onSaved,
}: TransferCommissionRuleFormSheetProps) {
  const { currentUser } = useAuth();
  const insets = useSafeAreaInsets();

  const [direction, setDirection] = useState<TransferDirection>('send');
  const [currency, setCurrency] = useState<Currency>('SAR');
  const [minAmount, setMinAmount] = useState('0');
  const [maxAmount, setMaxAmount] = useState('');
  const [calculationType, setCalculationType] =
    useState<TransferCommissionCalculationType>('fixed');
  const [customerValue, setCustomerValue] = useState('0');
  const [networkValue, setNetworkValue] = useState('0');
  const [isActive, setIsActive] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [pickerKind, setPickerKind] = useState<PickerKind>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const { scrollRef, scrollAreaRef, handleScroll, scrollInputIntoView } =
    useFocusedInputScroll();
  const minAmountRef = useRef<TextInput>(null);
  const maxAmountRef = useRef<TextInput>(null);
  const customerValueRef = useRef<TextInput>(null);
  const networkValueRef = useRef<TextInput>(null);

  const isEditing = Boolean(rule?.id);
  const selectedCurrency = CURRENCIES.find((item) => item.code === currency);
  const selectedCalculation = CALCULATION_TYPES.find(
    (item) => item.value === calculationType,
  );

  useEffect(() => {
    if (!visible) return;

    setDirection(rule?.direction === 'receive' ? 'receive' : 'send');
    setCurrency(
      CURRENCIES.some((item) => item.code === rule?.currency)
        ? (rule?.currency as Currency)
        : 'SAR',
    );
    setMinAmount(numberToInput(rule?.min_amount) || '0');
    setMaxAmount(numberToInput(rule?.max_amount));
    setCalculationType(rule?.calculation_type || 'fixed');
    setCustomerValue(numberToInput(rule?.customer_value) || '0');
    setNetworkValue(numberToInput(rule?.network_value) || '0');
    setIsActive(rule?.is_active ?? true);
    setIsSaving(false);
    setPickerKind(null);
  }, [rule, visible]);

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const pickerOptions: PickerOption[] =
    pickerKind === 'currency'
      ? CURRENCIES.map((item) => ({
          id: item.code,
          title: `${item.code} - ${item.name}`,
          subtitle: item.symbol,
        }))
      : CALCULATION_TYPES.map((item) => ({
          id: item.value,
          title: item.label,
          subtitle: item.hint,
        }));

  const pickerTitle =
    pickerKind === 'currency' ? 'اختر العملة' : 'اختر طريقة احتساب العمولة';
  const pickerSelectedId = pickerKind === 'currency' ? currency : calculationType;

  const handlePickerSelect = (id: string) => {
    if (pickerKind === 'currency') {
      setCurrency(id as Currency);
    } else if (pickerKind === 'calculation') {
      setCalculationType(id as TransferCommissionCalculationType);
    }

    setPickerKind(null);
  };

  const handleSave = async () => {
    if (!currentUser?.userId) {
      Alert.alert('خطأ', 'يجب تسجيل الدخول أولاً');
      return;
    }

    const parsedMinAmount = parseAmount(minAmount);
    const parsedMaxAmount = maxAmount.trim() ? parseAmount(maxAmount) : null;
    const parsedCustomerValue = parseAmount(customerValue);
    const parsedNetworkValue = parseAmount(networkValue);

    if (parsedMinAmount === null) {
      Alert.alert('بيانات غير صحيحة', 'أدخل الحد الأدنى للمبلغ بشكل صحيح');
      return;
    }

    if (maxAmount.trim() && parsedMaxAmount === null) {
      Alert.alert('بيانات غير صحيحة', 'أدخل الحد الأعلى للمبلغ بشكل صحيح');
      return;
    }

    if (parsedMaxAmount !== null && parsedMaxAmount < parsedMinAmount) {
      Alert.alert('بيانات غير صحيحة', 'يجب أن يكون الحد الأعلى أكبر من أو يساوي الحد الأدنى');
      return;
    }

    if (parsedCustomerValue === null || parsedNetworkValue === null) {
      Alert.alert('بيانات غير صحيحة', 'أدخل عمولة العميل وعمولة الشبكة بشكل صحيح');
      return;
    }

    setIsSaving(true);

    try {
      const payload = {
        direction,
        currency,
        min_amount: parsedMinAmount,
        max_amount: parsedMaxAmount,
        calculation_type: calculationType,
        customer_value: parsedCustomerValue,
        network_value: parsedNetworkValue,
        is_active: isActive,
      };

      if (isEditing && rule) {
        const { error } = await supabase
          .from('transfer_commission_rules')
          .update(payload)
          .eq('id', rule.id)
          .eq('user_id', currentUser.userId);

        if (error) throw error;
      } else {
        const { error } = await supabase.from('transfer_commission_rules').insert([
          {
            ...payload,
            user_id: currentUser.userId,
          },
        ]);

        if (error) throw error;
      }

      await Promise.resolve(onSaved());
      onClose();
    } catch (error: any) {
      if (
        error?.code === '23P01' ||
        error?.code === '23505' ||
        error?.code === 'P0001' ||
        String(error?.message || '').includes('تداخل')
      ) {
        Alert.alert(
          'تعارض في النطاق',
          'توجد قاعدة فعّالة لنفس الاتجاه والعملة تتداخل مع نطاق المبلغ المحدد.',
        );
      } else if (typeof error?.message === 'string' && /[؀-ۿ]/.test(error.message)) {
        Alert.alert('تعذر الحفظ', error.message);
      } else {
        console.error('Error saving transfer commission rule:', error);
        Alert.alert('خطأ', 'حدث خطأ أثناء حفظ قاعدة العمولة');
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

                <View style={styles.headerTitleContainer}>
                  <BadgePercent size={22} color="#4F46E5" />
                  <Text style={styles.headerTitle}>
                    {isEditing ? 'تعديل قاعدة العمولة' : 'قاعدة عمولة جديدة'}
                  </Text>
                </View>

                <View style={styles.headerSpacer} />
              </View>

              {/* collapsable={false} يضمن وجود عرض أصلي يمكن قياسه على أندرويد */}
              <View ref={scrollAreaRef} collapsable={false} style={styles.scrollArea}>
              <ScrollView
                ref={scrollRef}
                style={styles.scrollView}
                contentContainerStyle={[
                  styles.content,
                  // مساحة إضافية تسمح برفع آخر حقل فوق اللوحة بدل أن يقف عند نهاية المحتوى
                  keyboardHeight > 0 && styles.contentWithKeyboard,
                ]}
                onScroll={handleScroll}
                scrollEventThrottle={16}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>نوع الحوالة</Text>
                <View style={styles.segmentedControl}>
                  <TouchableOpacity
                    style={[
                      styles.segmentButton,
                      direction === 'send' && styles.sendSegmentButtonActive,
                    ]}
                    onPress={() => setDirection('send')}
                  >
                    <ArrowUpRight
                      size={18}
                      color={direction === 'send' ? '#FFFFFF' : '#6B7280'}
                    />
                    <Text
                      style={[
                        styles.segmentText,
                        direction === 'send' && styles.segmentTextActive,
                      ]}
                    >
                      إرسال
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.segmentButton,
                      direction === 'receive' && styles.receiveSegmentButtonActive,
                    ]}
                    onPress={() => setDirection('receive')}
                  >
                    <ArrowDownLeft
                      size={18}
                      color={direction === 'receive' ? '#FFFFFF' : '#6B7280'}
                    />
                    <Text
                      style={[
                        styles.segmentText,
                        direction === 'receive' && styles.segmentTextActive,
                      ]}
                    >
                      استلام
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>العملة</Text>
                <TouchableOpacity
                  style={styles.dropdownField}
                  onPress={() => setPickerKind('currency')}
                  activeOpacity={0.8}
                >
                  <ChevronDown size={20} color="#6B7280" />
                  <View style={styles.dropdownTextContainer}>
                    <Text style={styles.dropdownValue}>
                      {currency} - {selectedCurrency?.name}
                    </Text>
                    <Text style={styles.dropdownHint}>عملة قاعدة العمولة</Text>
                  </View>
                  <View style={styles.currencySymbolBox}>
                    <Text style={styles.currencySymbolText}>
                      {selectedCurrency?.symbol || currency}
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>نطاق مبلغ الحوالة</Text>
                <View style={styles.inputRow}>
                  <View style={styles.inputColumn}>
                    <Text style={styles.inputLabel}>من</Text>
                    <View style={styles.inputWithSuffix}>
                      <TextInput
                        ref={minAmountRef}
                        style={styles.numericInput}
                        value={minAmount}
                        onChangeText={setMinAmount}
                        onFocus={() => scrollInputIntoView(minAmountRef.current)}
                        placeholder="0"
                        placeholderTextColor="#9CA3AF"
                        keyboardType="decimal-pad"
                      />
                      <Text style={styles.inputSuffix}>{currency}</Text>
                    </View>
                  </View>

                  <View style={styles.inputColumn}>
                    <Text style={styles.inputLabel}>إلى (اختياري)</Text>
                    <View style={styles.inputWithSuffix}>
                      <TextInput
                        ref={maxAmountRef}
                        style={styles.numericInput}
                        value={maxAmount}
                        onChangeText={setMaxAmount}
                        onFocus={() => scrollInputIntoView(maxAmountRef.current)}
                        placeholder="بدون حد"
                        placeholderTextColor="#9CA3AF"
                        keyboardType="decimal-pad"
                      />
                      <Text style={styles.inputSuffix}>{currency}</Text>
                    </View>
                  </View>
                </View>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>طريقة احتساب العمولة</Text>
                <TouchableOpacity
                  style={styles.dropdownField}
                  onPress={() => setPickerKind('calculation')}
                  activeOpacity={0.8}
                >
                  <ChevronDown size={20} color="#6B7280" />
                  <View style={styles.dropdownTextContainer}>
                    <Text style={styles.dropdownValue}>
                      {selectedCalculation?.label || 'اختر الطريقة'}
                    </Text>
                    <Text style={styles.dropdownHint}>
                      {selectedCalculation?.hint}
                    </Text>
                  </View>
                  <View style={styles.calculationIconBox}>
                    <BadgePercent size={19} color="#4F46E5" />
                  </View>
                </TouchableOpacity>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>قيم العمولة</Text>
                <Text style={styles.sectionHint}>
                  أدخل قيمة {selectedCalculation?.label || 'العمولة'} للعميل وللشبكة
                </Text>

                <View style={styles.commissionCard}>
                  <View style={styles.commissionField}>
                    <View style={styles.commissionLabelRow}>
                      <View style={[styles.dot, styles.customerDot]} />
                      <Text style={styles.commissionLabel}>عمولة العميل</Text>
                    </View>
                    <View style={styles.inputWithSuffix}>
                      <TextInput
                        ref={customerValueRef}
                        style={styles.numericInput}
                        value={customerValue}
                        onChangeText={setCustomerValue}
                        onFocus={() => scrollInputIntoView(customerValueRef.current)}
                        placeholder="0"
                        placeholderTextColor="#9CA3AF"
                        keyboardType="decimal-pad"
                      />
                      <Text style={styles.inputSuffix}>
                        {calculationType === 'fixed'
                          ? selectedCurrency?.symbol || currency
                          : calculationType === 'percentage'
                            ? '%'
                            : calculationType === 'per_thousand'
                              ? 'لكل ألف'
                              : 'لكل مليون'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.commissionDivider} />

                  <View style={styles.commissionField}>
                    <View style={styles.commissionLabelRow}>
                      <View style={[styles.dot, styles.networkDot]} />
                      <Text style={styles.commissionLabel}>عمولة الشبكة</Text>
                    </View>
                    <View style={styles.inputWithSuffix}>
                      <TextInput
                        ref={networkValueRef}
                        style={styles.numericInput}
                        value={networkValue}
                        onChangeText={setNetworkValue}
                        onFocus={() => scrollInputIntoView(networkValueRef.current)}
                        placeholder="0"
                        placeholderTextColor="#9CA3AF"
                        keyboardType="decimal-pad"
                      />
                      <Text style={styles.inputSuffix}>
                        {calculationType === 'fixed'
                          ? selectedCurrency?.symbol || currency
                          : calculationType === 'percentage'
                            ? '%'
                            : calculationType === 'per_thousand'
                              ? 'لكل ألف'
                              : 'لكل مليون'}
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={styles.infoBox}>
                  <Text style={styles.infoText}>
                    عند تنفيذ الحوالة يُحتسب صافي الربح من الفرق بين عمولة العميل
                    وعمولة الشبكة، ثم يُسجل في حساب الأرباح والخسائر.
                  </Text>
                </View>
              </View>

              <View style={styles.activeCard}>
                <View style={styles.activeTextContainer}>
                  <Text style={styles.activeTitle}>القاعدة مفعّلة</Text>
                  <Text style={styles.activeSubtitle}>
                    ستظهر تلقائياً عند تطابق الاتجاه والعملة والمبلغ
                  </Text>
                </View>
                <Switch
                  value={isActive}
                  onValueChange={setIsActive}
                  trackColor={{ false: '#D1D5DB', true: '#4F46E5' }}
                  thumbColor="#FFFFFF"
                />
              </View>
              </ScrollView>
              </View>

              <View
                style={[
                  styles.footer,
                  { paddingBottom: keyboardHeight > 0 ? 12 : Math.max(insets.bottom, 12) },
                ]}
              >
                <TouchableOpacity
                  style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
                  onPress={handleSave}
                  disabled={isSaving}
                  activeOpacity={0.85}
                >
                  {isSaving ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <>
                      <Save size={19} color="#FFFFFF" />
                      <Text style={styles.saveButtonText}>
                        {isEditing ? 'حفظ التعديلات' : 'إضافة القاعدة'}
                      </Text>
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
        onRequestClose={() => setPickerKind(null)}
      >
        <TouchableOpacity
          style={styles.pickerOverlay}
          activeOpacity={1}
          onPress={() => setPickerKind(null)}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={(event) => event.stopPropagation()}
            style={[
              styles.pickerSheet,
              { paddingBottom: Math.max(insets.bottom, 18) },
            ]}
          >
            <View style={styles.pickerHeader}>
              <TouchableOpacity
                onPress={() => setPickerKind(null)}
                style={styles.closeButton}
              >
                <X size={21} color="#6B7280" />
              </TouchableOpacity>
              <Text style={styles.pickerTitle}>{pickerTitle}</Text>
              <View style={styles.headerSpacer} />
            </View>

            <ScrollView
              style={styles.pickerList}
              showsVerticalScrollIndicator={false}
            >
              {pickerOptions.map((option) => {
                const selected = option.id === pickerSelectedId;
                return (
                  <TouchableOpacity
                    key={option.id}
                    style={[
                      styles.pickerOption,
                      selected && styles.pickerOptionSelected,
                    ]}
                    onPress={() => handlePickerSelect(option.id)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.pickerOptionText}>
                      <Text
                        style={[
                          styles.pickerOptionTitle,
                          selected && styles.pickerOptionTitleSelected,
                        ]}
                      >
                        {option.title}
                      </Text>
                      {option.subtitle ? (
                        <Text style={styles.pickerOptionSubtitle}>
                          {option.subtitle}
                        </Text>
                      ) : null}
                    </View>
                    {selected ? <Check size={20} color="#4F46E5" /> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
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
    backgroundColor: 'rgba(17, 24, 39, 0.5)',
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
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
  },
  headerTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    color: '#111827',
    fontSize: 19,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  headerSpacer: {
    width: 36,
  },
  scrollArea: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    direction: 'rtl',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 32,
  },
  contentWithKeyboard: {
    paddingBottom: 260,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    color: '#374151',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'right',
    marginBottom: 9,
  },
  sectionHint: {
    color: '#6B7280',
    fontSize: 12,
    textAlign: 'right',
    marginTop: -4,
    marginBottom: 10,
  },
  segmentedControl: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#F3F4F6',
    borderRadius: 14,
    padding: 4,
  },
  segmentButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  sendSegmentButtonActive: {
    backgroundColor: '#EF4444',
  },
  receiveSegmentButtonActive: {
    backgroundColor: '#10B981',
  },
  segmentText: {
    color: '#6B7280',
    fontSize: 15,
    fontWeight: '700',
  },
  segmentTextActive: {
    color: '#FFFFFF',
  },
  dropdownField: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  dropdownTextContainer: {
    flex: 1,
    alignItems: 'flex-end',
  },
  dropdownValue: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'right',
  },
  dropdownHint: {
    color: '#6B7280',
    fontSize: 11,
    marginTop: 3,
    textAlign: 'right',
  },
  currencySymbolBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  currencySymbolText: {
    color: '#4F46E5',
    fontSize: 13,
    fontWeight: '800',
  },
  calculationIconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputRow: {
    flexDirection: 'row',
    gap: 10,
  },
  inputColumn: {
    flex: 1,
  },
  inputLabel: {
    color: '#6B7280',
    fontSize: 12,
    textAlign: 'right',
    marginBottom: 6,
  },
  inputWithSuffix: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  numericInput: {
    flex: 1,
    color: '#111827',
    fontSize: 15,
    paddingVertical: 10,
    textAlign: 'right',
    writingDirection: 'ltr',
  },
  inputSuffix: {
    color: '#6B7280',
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 8,
  },
  commissionCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    padding: 14,
  },
  commissionField: {
    gap: 8,
  },
  commissionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  customerDot: {
    backgroundColor: '#4F46E5',
  },
  networkDot: {
    backgroundColor: '#0EA5E9',
  },
  commissionLabel: {
    color: '#374151',
    fontSize: 14,
    fontWeight: '700',
  },
  commissionDivider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginVertical: 13,
  },
  infoBox: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 12,
    padding: 11,
    marginTop: 10,
  },
  infoText: {
    color: '#166534',
    fontSize: 12,
    lineHeight: 19,
    textAlign: 'right',
  },
  activeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
  },
  activeTextContainer: {
    flex: 1,
  },
  activeTitle: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'right',
  },
  activeSubtitle: {
    color: '#6B7280',
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'right',
    marginTop: 3,
  },
  footer: {
    paddingHorizontal: 18,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  saveButton: {
    minHeight: 50,
    backgroundColor: '#4F46E5',
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  pickerOverlay: {
    flex: 1,
    direction: 'rtl',
    backgroundColor: 'rgba(17, 24, 39, 0.5)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    direction: 'rtl',
    maxHeight: '72%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  pickerHeader: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  pickerTitle: {
    color: '#111827',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  pickerList: {
    paddingHorizontal: 14,
  },
  pickerOption: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
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
    marginTop: 3,
    textAlign: 'right',
  },
});
