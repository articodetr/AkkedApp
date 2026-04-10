import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  Modal,
  Platform,
  ActivityIndicator,
  Keyboard,
  TouchableWithoutFeedback,
  FlatList,
  KeyboardAvoidingView,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowRight, Save, ArrowDownCircle, ArrowUpCircle, CheckCircle, X, FileText, Download, Search } from 'lucide-react-native';
import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system/legacy';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { Customer, Currency, CURRENCIES } from '@/types/database';
import { generateReceiptHTML, generateQRCodeData } from '@/utils/receiptGenerator';
import { getReceiptLogoBase64 } from '@/utils/logoHelper';
import { KeyboardAwareView } from '@/components/KeyboardAwareView';
import { useDataRefresh } from '@/contexts/DataRefreshContext';
import { useAuth } from '@/contexts/AuthContext';
import { CustomerStatusBadge } from '@/components/customer/CustomerStatusBadge';
import { sortCustomersByDisplayPriority } from '@/utils/customerDisplay';
import { isPendingMovement } from '@/utils/movementApproval';

type OperationType = 'shop_to_customer' | 'customer_to_shop' | '';

export default function NewMovementScreen() {
  const router = useRouter();
  const { customerId, customerName } = useLocalSearchParams();
  const { triggerRefresh } = useDataRefresh();
  const { currentUser } = useAuth();
  const insets = useSafeAreaInsets();
  const qrRef = useRef<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [showFromCustomerPicker, setShowFromCustomerPicker] = useState(false);
  const [showToCustomerPicker, setShowToCustomerPicker] = useState(false);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [savedMovementData, setSavedMovementData] = useState<any>(null);
  const [isSavingPdf, setIsSavingPdf] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [formData, setFormData] = useState({
    operation_type: '' as OperationType,
    from_customer_id: '',
    from_customer_name: '',
    from_customer_account: '',
    from_customer_linked_user_id: '',
    to_customer_id: '',
    to_customer_name: '',
    to_customer_account: '',
    to_customer_linked_user_id: '',
    amount: '',
    commission: '',
    commission_currency: 'USD' as Currency,
    commissionRecipient: null as 'customer' | null,
    currency: 'USD' as Currency,
    notes: '',
    sender_name: '',
    beneficiary_name: '',
    transfer_number: '',
  });

  useEffect(() => {
    loadCustomers();
    generateTransferNumber();
  }, []);

  const generateTransferNumber = async () => {
    try {
      const { data, error } = await supabase.rpc('generate_transfer_number');
      if (!error && data) {
        setFormData((prev) => ({ ...prev, transfer_number: data }));
      }
    } catch (error) {
      console.error('Error generating transfer number:', error);
    }
  };

  useEffect(() => {
    if (customerId && customerName) {
      const selectedCustomer = customers.find((customer) => customer.id === customerId);
      setFormData((prev) => ({
        ...prev,
        from_customer_id: customerId as string,
        from_customer_name: customerName as string,
        from_customer_account: selectedCustomer?.account_number || prev.from_customer_account,
        from_customer_linked_user_id:
          selectedCustomer?.linked_user_id || prev.from_customer_linked_user_id,
        operation_type: 'customer_to_shop',
      }));
    }
  }, [customerId, customerName, customers]);

  useEffect(() => {
    const shopName = 'علي هادي علي الرازحي';

    if (formData.operation_type === 'customer_to_shop') {
      setFormData((prev) => ({
        ...prev,
        sender_name: prev.from_customer_name,
        beneficiary_name: shopName,
      }));
    } else if (formData.operation_type === 'shop_to_customer') {
      setFormData((prev) => ({
        ...prev,
        sender_name: shopName,
        beneficiary_name: prev.to_customer_name,
      }));
    }
  }, [formData.operation_type, formData.from_customer_name, formData.to_customer_name]);

  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      commission_currency: prev.currency,
    }));
  }, [formData.currency]);

  useEffect(() => {
    if (formData.operation_type === 'customer_to_shop') {
      setFormData((prev) => ({
        ...prev,
        commission: '',
        commissionRecipient: null,
      }));
    }
  }, [formData.operation_type]);

  const loadCustomers = async () => {
    try {
      // التحقق من وجود المستخدم الحالي
      if (!currentUser?.userId) {
        console.warn('[NewMovement] No current user found');
        setCustomers([]);
        return;
      }

      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .neq('phone', 'PROFIT_LOSS_ACCOUNT')
        .or(`user_id.eq.${currentUser.userId},linked_user_id.eq.${currentUser.userId}`)
        .order('name', { ascending: true });

      if (!error && data) {
        setCustomers(sortCustomersByDisplayPriority(data));
      }
    } catch (error) {
      console.error('Error loading customers:', error);
    }
  };

  const handleSubmit = async () => {
    const trimmedNotes = formData.notes.trim();

    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      Alert.alert('خطأ', 'الرجاء إدخال مبلغ صحيح');
      return;
    }

    if (parseFloat(formData.amount) < 0) {
      Alert.alert('خطأ', 'المبلغ لا يمكن أن يكون سالباً');
      return;
    }

    if (formData.commission && parseFloat(formData.commission) < 0) {
      Alert.alert('خطأ', 'العمولة لا يمكن أن تكون سالبة');
      return;
    }

    if (formData.commission && parseFloat(formData.commission) >= parseFloat(formData.amount)) {
      Alert.alert('خطأ', 'العمولة لا يمكن أن تكون أكبر من أو تساوي المبلغ');
      return;
    }

    if (formData.operation_type === 'customer_to_shop' && !formData.from_customer_id) {
      Alert.alert('خطأ', 'الرجاء اختيار العميل المُرسل');
      return;
    }

    if (formData.operation_type === 'shop_to_customer' && !formData.to_customer_id) {
      Alert.alert('خطأ', 'الرجاء اختيار العميل المُستفيد');
      return;
    }

    if (!formData.operation_type) {
      Alert.alert('خطأ', 'الرجاء اختيار نوع العملية');
      return;
    }

    if (!trimmedNotes) {
      Alert.alert('خطأ', 'الملاحظة مطلوبة لكل حركة');
      return;
    }

    setIsLoading(true);
    try {
      const { data: movementNumber } = await supabase.rpc('generate_movement_number');

      const customerId = formData.operation_type === 'customer_to_shop'
        ? formData.from_customer_id
        : formData.to_customer_id;

      const movementType = formData.operation_type === 'customer_to_shop'
        ? 'outgoing'
        : 'incoming';

      let commissionRecipientId = null;
      if (movementType === 'incoming' && formData.commission && parseFloat(formData.commission) > 0 && formData.commissionRecipient === 'customer') {
        commissionRecipientId = customerId;
      }

      // حساب المبلغ الفعلي بعد خصم/إضافة العمولة
      const baseAmount = Number(formData.amount);
      const commissionAmount = movementType === 'incoming' && formData.commission ? Number(formData.commission) : 0;
      let actualAmount = baseAmount;

      // إذا كانت العمولة من نفس العملة، نطبق الخصم/الإضافة
      if (commissionAmount > 0 && formData.commission_currency === formData.currency && movementType === 'incoming') {
        // له: نخصم العمولة من المبلغ
        actualAmount = baseAmount - commissionAmount;
      }

      if (!currentUser) {
        Alert.alert('خطأ', 'يجب تسجيل الدخول أولاً');
        return;
      }

      const { data: insertedData, error } = await supabase.rpc(
        'insert_movement_with_user',
        {
          p_user_name: currentUser.userName,
          p_customer_id: customerId,
          p_movement_type: movementType,
          p_amount: actualAmount,
          p_currency: formData.currency,
          p_notes: trimmedNotes,
          p_sender_name: formData.sender_name.trim() || null,
          p_beneficiary_name: formData.beneficiary_name.trim() || null,
          p_commission: movementType === 'incoming' && formData.commission ? Number(formData.commission) : null,
          p_commission_currency: formData.commission_currency,
          p_commission_recipient_id: commissionRecipientId,
        }
      );

      if (error) throw error;

      if (!insertedData || insertedData.length === 0) {
        throw new Error('لم يتم إرجاع بيانات الحركة');
      }

      let movement = Array.isArray(insertedData) ? insertedData[0] : insertedData;

      if (movement?.id) {
        const { data: latestMovement } = await supabase
          .from('account_movements')
          .select('id, movement_number, amount, currency, pending_approval, approval_status, receipt_number, created_at')
          .eq('id', movement.id)
          .maybeSingle();

        if (latestMovement) {
          movement = {
            ...movement,
            ...latestMovement,
          };
        }
      }

      const customerName = formData.operation_type === 'customer_to_shop'
        ? formData.from_customer_name
        : formData.to_customer_name;

      const customerAccountNumber = formData.operation_type === 'customer_to_shop'
        ? formData.from_customer_account
        : formData.to_customer_account;

      triggerRefresh('movements');

      setSavedMovementData({
        ...movement,
        customerName: customerName,
        customerAccountNumber: customerAccountNumber,
      });
      setShowSuccessModal(true);
    } catch (error) {
      console.error('Error adding movement:', error);
      Alert.alert('خطأ', 'حدث خطأ أثناء إضافة الحركة');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenReceipt = () => {
    setShowSuccessModal(false);
    router.push({
      pathname: '/receipt-preview',
      params: {
        movementId: savedMovementData.id,
        customerName: savedMovementData.customerName,
        customerAccountNumber: savedMovementData.customerAccountNumber,
      },
    });
  };

  const handleDownloadReceipt = async (movementData: any) => {
    try {
      const receiptData = {
        ...movementData,
        customerName: movementData.customerName,
        customerAccountNumber: movementData.customerAccountNumber,
      };

      const qrData = generateQRCodeData(receiptData);
      const qrCodeDataUrl = await new Promise<string>((resolve) => {
        setTimeout(async () => {
          if (qrRef.current) {
            qrRef.current.toDataURL((dataUrl: string) => {
              resolve(`data:image/png;base64,${dataUrl}`);
            });
          } else {
            resolve('');
          }
        }, 100);
      });

      const logoDataUrl = await getReceiptLogoBase64();
      const html = generateReceiptHTML(receiptData, qrCodeDataUrl, logoDataUrl);

      const { uri } = await Print.printToFileAsync({
        html: html,
        base64: false,
      });

      const pdfName = `receipt_${receiptData.receipt_number || receiptData.movement_number}.pdf`;
      const pdfPath = `${FileSystem.documentDirectory}${pdfName}`;

      await FileSystem.moveAsync({
        from: uri,
        to: pdfPath,
      });

      return pdfPath;
    } catch (error) {
      console.error('Error saving PDF:', error);
      throw error;
    }
  };

  const handleDownloadFromSuccess = async () => {
    if (!savedMovementData) return;

    setIsSavingPdf(true);
    try {
      const pdfPath = await handleDownloadReceipt(savedMovementData);
      const fileName = pdfPath.split('/').pop();
      Alert.alert('نجح', `تم حفظ الملف بنجاح:\n${fileName}\n\nالمسار:\n${pdfPath}`);
    } catch (error) {
      Alert.alert('خطأ', 'حدث خطأ أثناء حفظ الملف');
    } finally {
      setIsSavingPdf(false);
    }
  };

  const handleCloseSuccessModal = () => {
    setShowSuccessModal(false);
    router.back();
  };

  const selectFromCustomer = (customer: Customer) => {
    setFormData((prev) => ({
      ...prev,
      from_customer_id: customer.id,
      from_customer_name: customer.name,
      from_customer_account: customer.account_number,
      from_customer_linked_user_id: customer.linked_user_id || '',
    }));
    setShowFromCustomerPicker(false);
    setSearchQuery('');
  };

  const selectToCustomer = (customer: Customer) => {
    setFormData((prev) => ({
      ...prev,
      to_customer_id: customer.id,
      to_customer_name: customer.name,
      to_customer_account: customer.account_number,
      to_customer_linked_user_id: customer.linked_user_id || '',
    }));
    setShowToCustomerPicker(false);
    setSearchQuery('');
  };

  const filteredCustomers = customers.filter((customer) => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return true;

    return (
      customer.name.toLowerCase().includes(query) ||
      customer.phone.toLowerCase().includes(query) ||
      customer.account_number.toLowerCase().includes(query)
    );
  });

  const filteredFromCustomers = filteredCustomers.filter(
    (c) => c.id !== formData.to_customer_id
  );

  const filteredToCustomers = filteredCustomers.filter(
    (c) => c.id !== formData.from_customer_id
  );

  const selectCurrency = (currency: Currency) => {
    setFormData({ ...formData, currency });
    setShowCurrencyPicker(false);
  };

  const getCurrencySymbol = (code: string) => {
    const currency = CURRENCIES.find((c) => c.code === code);
    return currency?.symbol || code;
  };

  const renderCustomerItem = ({ item, onSelect }: { item: Customer; onSelect: (customer: Customer) => void }) => (
    <TouchableOpacity
      style={styles.modalItem}
      onPress={() => onSelect(item)}
    >
      <View style={styles.modalItemHeader}>
        <CustomerStatusBadge customer={item} />
        <Text style={styles.modalItemText}>{item.name}</Text>
      </View>
      <View style={styles.modalItemInfo}>
        <Text style={styles.modalItemSubtext}>{item.phone}</Text>
        <Text style={[styles.modalItemSubtext, { color: '#4F46E5', fontWeight: '600' }]}>
          رقم الحساب: {item.account_number}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ArrowRight size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>حركة مالية جديدة</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAwareView
        contentContainerStyle={styles.contentContainer}
        extraScrollHeight={180}
      >
          <View style={styles.operationTypeSection}>
            <Text style={styles.sectionTitle}>
              نوع العملية <Text style={styles.required}>*</Text>
            </Text>
            <View style={styles.operationTypeButtons}>
              <TouchableOpacity
                style={[
                  styles.operationTypeButton,
                  formData.operation_type === 'shop_to_customer' && styles.operationTypeButtonActive,
                  { backgroundColor: formData.operation_type === 'shop_to_customer' ? '#3B82F6' : '#F3F4F6' },
                ]}
                onPress={() => setFormData({ ...formData, operation_type: 'shop_to_customer' })}
              >
                <ArrowUpCircle
                  size={28}
                  color={formData.operation_type === 'shop_to_customer' ? '#FFFFFF' : '#6B7280'}
                />
                <Text
                  style={[
                    styles.operationTypeButtonText,
                    { color: formData.operation_type === 'shop_to_customer' ? '#FFFFFF' : '#6B7280' },
                  ]}
                >
                  من المحل إلى عميل
                </Text>
                <Text
                  style={[
                    styles.operationTypeButtonSubtext,
                    { color: formData.operation_type === 'shop_to_customer' ? '#DBEAFE' : '#9CA3AF' },
                  ]}
                >
                  دفع للعميل
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.operationTypeButton,
                  formData.operation_type === 'customer_to_shop' && styles.operationTypeButtonActive,
                  { backgroundColor: formData.operation_type === 'customer_to_shop' ? '#10B981' : '#F3F4F6' },
                ]}
                onPress={() => setFormData({ ...formData, operation_type: 'customer_to_shop' })}
              >
                <ArrowDownCircle
                  size={28}
                  color={formData.operation_type === 'customer_to_shop' ? '#FFFFFF' : '#6B7280'}
                />
                <Text
                  style={[
                    styles.operationTypeButtonText,
                    { color: formData.operation_type === 'customer_to_shop' ? '#FFFFFF' : '#6B7280' },
                  ]}
                >
                  من عميل إلى المحل
                </Text>
                <Text
                  style={[
                    styles.operationTypeButtonSubtext,
                    { color: formData.operation_type === 'customer_to_shop' ? '#D1FAE5' : '#9CA3AF' },
                  ]}
                >
                  قبض من العميل
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {formData.operation_type === 'customer_to_shop' && (
            <TouchableOpacity
              style={[
                styles.customerSelector,
                formData.from_customer_id && styles.customerSelectorSelected,
              ]}
              onPress={() => setShowFromCustomerPicker(true)}
            >
              <View style={styles.customerLabelRow}>
                <Text style={styles.customerLabel}>
                  العميل <Text style={styles.required}>*</Text>
                </Text>
                {customerId && formData.operation_type === 'customer_to_shop' && (
                  <View style={styles.autoBadge}>
                    <Text style={styles.autoBadgeText}>تم الاختيار تلقائياً</Text>
                  </View>
                )}
              </View>
              <View style={styles.customerValueBlock}>
                <View style={styles.customerValueHeader}>
                  {formData.from_customer_id ? (
                    <CustomerStatusBadge
                      linkedUserId={formData.from_customer_linked_user_id}
                    />
                  ) : null}
                  <Text style={styles.customerValue}>
                    {formData.from_customer_name || 'اختر عميل'}
                  </Text>
                </View>
                {formData.from_customer_account && (
                  <Text style={styles.customerAccountText}>
                    رقم الحساب: {formData.from_customer_account}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          )}

          {formData.operation_type === 'shop_to_customer' && (
            <TouchableOpacity
              style={[
                styles.customerSelector,
                formData.to_customer_id && styles.customerSelectorSelected,
              ]}
              onPress={() => setShowToCustomerPicker(true)}
            >
              <Text style={styles.customerLabel}>
                العميل <Text style={styles.required}>*</Text>
              </Text>
              <View style={styles.customerValueBlock}>
                <View style={styles.customerValueHeader}>
                  {formData.to_customer_id ? (
                    <CustomerStatusBadge
                      linkedUserId={formData.to_customer_linked_user_id}
                    />
                  ) : null}
                  <Text style={styles.customerValue}>
                    {formData.to_customer_name || 'اختر عميل'}
                  </Text>
                </View>
                {formData.to_customer_account && (
                  <Text style={styles.customerAccountText}>
                    رقم الحساب: {formData.to_customer_account}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          )}

          <View style={styles.amountSection}>
            <Text style={styles.sectionTitle}>
              المبلغ <Text style={styles.required}>*</Text>
            </Text>
            <View style={styles.amountRow}>
              <TouchableOpacity
                style={styles.currencyButton}
                onPress={() => setShowCurrencyPicker(true)}
              >
                <Text style={styles.currencyButtonText}>{formData.currency}</Text>
                <Text style={styles.currencySymbol}>{getCurrencySymbol(formData.currency)}</Text>
              </TouchableOpacity>
              <TextInput
                style={styles.amountInput}
                value={formData.amount}
                onChangeText={(text) => setFormData({ ...formData, amount: text })}
                placeholder="0.00"
                placeholderTextColor="#9CA3AF"
                keyboardType="decimal-pad"
                textAlign="center"
              />
            </View>
          </View>

          {formData.operation_type === 'shop_to_customer' && (
            <>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>عمولة الحوالة (اختياري)</Text>
                <View style={styles.commissionRow}>
                  <View style={styles.commissionCurrencyDisplay}>
                    <Text style={styles.commissionCurrencyText}>{formData.commission_currency}</Text>
                    <Text style={styles.commissionCurrencySymbol}>
                      {getCurrencySymbol(formData.commission_currency)}
                    </Text>
                  </View>
                  <TextInput
                    style={styles.commissionInput}
                    value={formData.commission}
                    onChangeText={(text) => setFormData({ ...formData, commission: text })}
                    placeholder="0.00"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="decimal-pad"
                    textAlign="right"
                  />
                </View>
              </View>

              {formData.commission && parseFloat(formData.commission) > 0 && (
                <View style={styles.commissionRecipientSection}>
                  <Text style={styles.label}>من يستلم العمولة؟</Text>
                  <Text style={styles.commissionRecipientSubtitle}>
                    اختر من سيستفيد من العمولة
                  </Text>

                  <View style={styles.commissionRecipientButtons}>
                    <TouchableOpacity
                      style={[
                        styles.recipientButton,
                        styles.recipientButtonCustomer,
                        formData.commissionRecipient === 'customer' && styles.recipientButtonCustomerActive,
                      ]}
                      onPress={() => setFormData({ ...formData, commissionRecipient: 'customer' })}
                    >
                      <Text
                        style={[
                          styles.recipientButtonText,
                          formData.commissionRecipient === 'customer' && styles.recipientButtonTextActive,
                        ]}
                      >
                        {formData.to_customer_name || 'العميل'}
                      </Text>
                      <Text
                        style={[
                          styles.recipientButtonSubtext,
                          formData.commissionRecipient === 'customer' && styles.recipientButtonSubtextActive,
                        ]}
                      >
                        يحصل على العمولة
                      </Text>
                    </TouchableOpacity>

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
                </View>
              )}
            </>
          )}

          <View style={styles.inputGroup}>
            <Text style={styles.label}>اسم المرسل</Text>
            <TextInput
              style={styles.input}
              value={formData.sender_name}
              onChangeText={(text) => setFormData({ ...formData, sender_name: text })}
              placeholder="اسم المرسل"
              placeholderTextColor="#9CA3AF"
              textAlign="right"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>اسم المستفيد</Text>
            <TextInput
              style={styles.input}
              value={formData.beneficiary_name}
              onChangeText={(text) => setFormData({ ...formData, beneficiary_name: text })}
              placeholder="اسم المستفيد (اختياري)"
              placeholderTextColor="#9CA3AF"
              textAlign="right"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>رقم الحوالة</Text>
            <TextInput
              style={styles.input}
              value={formData.transfer_number}
              onChangeText={(text) => setFormData({ ...formData, transfer_number: text })}
              placeholder="رقم الحوالة (اختياري)"
              placeholderTextColor="#9CA3AF"
              textAlign="right"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>ملاحظات <Text style={styles.required}>*</Text></Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={formData.notes}
              onChangeText={(text) => setFormData({ ...formData, notes: text })}
              placeholder="أدخل ملاحظة توضح سبب الحركة"
              placeholderTextColor="#9CA3AF"
              multiline
              numberOfLines={3}
              textAlign="right"
              textAlignVertical="top"
            />
          </View>

          <TouchableOpacity
            style={[styles.submitButton, isLoading && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={isLoading}
          >
            <Save size={20} color="#FFFFFF" />
            <Text style={styles.submitButtonText}>
              {isLoading ? 'جاري الحفظ...' : 'حفظ الحركة'}
            </Text>
          </TouchableOpacity>
      </KeyboardAwareView>

      <Modal
        visible={showFromCustomerPicker}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setShowFromCustomerPicker(false);
          setSearchQuery('');
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
          style={styles.modalContainer}
          keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 20}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => {
              Keyboard.dismiss();
              setShowFromCustomerPicker(false);
              setSearchQuery('');
            }}
          >
            <TouchableWithoutFeedback>
              <View
                style={[
                  styles.modalContent,
                  { paddingBottom: Math.max(insets.bottom, 20) },
                ]}
              >
                <Text style={styles.modalTitle}>اختر العميل المُرسل</Text>

                <View style={styles.searchContainer}>
                  <Search size={20} color="#9CA3AF" style={styles.searchIcon} />
                  <TextInput
                    style={styles.searchInput}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder="ابحث بالاسم، الهاتف، أو رقم الحساب"
                    placeholderTextColor="#9CA3AF"
                    textAlign="right"
                    autoFocus={false}
                  />
                  {searchQuery.length > 0 && (
                    <TouchableOpacity
                      onPress={() => setSearchQuery('')}
                      style={styles.clearSearchButton}
                    >
                      <X size={18} color="#6B7280" />
                    </TouchableOpacity>
                  )}
                </View>

                <FlatList
                  data={filteredFromCustomers}
                  renderItem={({ item }) => renderCustomerItem({ item, onSelect: selectFromCustomer })}
                  keyExtractor={(item) => item.id}
                  style={styles.modalList}
                  contentContainerStyle={[
                    styles.modalListContent,
                    { paddingBottom: Math.max(insets.bottom + 20, 32) },
                  ]}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={true}
                  ListEmptyComponent={
                    <View style={styles.emptySearchResult}>
                      <Text style={styles.emptySearchText}>لا توجد نتائج مطابقة</Text>
                      <Text style={styles.emptySearchSubtext}>جرب البحث بكلمات أخرى</Text>
                    </View>
                  }
                />

                <TouchableOpacity
                  style={styles.modalCloseButton}
                  onPress={() => {
                    setShowFromCustomerPicker(false);
                    setSearchQuery('');
                  }}
                >
                  <Text style={styles.modalCloseButtonText}>إغلاق</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={showToCustomerPicker}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setShowToCustomerPicker(false);
          setSearchQuery('');
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
          style={styles.modalContainer}
          keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 20}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => {
              Keyboard.dismiss();
              setShowToCustomerPicker(false);
              setSearchQuery('');
            }}
          >
            <TouchableWithoutFeedback>
              <View
                style={[
                  styles.modalContent,
                  { paddingBottom: Math.max(insets.bottom, 20) },
                ]}
              >
                <Text style={styles.modalTitle}>اختر العميل المُستفيد</Text>

                <View style={styles.searchContainer}>
                  <Search size={20} color="#9CA3AF" style={styles.searchIcon} />
                  <TextInput
                    style={styles.searchInput}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholder="ابحث بالاسم، الهاتف، أو رقم الحساب"
                    placeholderTextColor="#9CA3AF"
                    textAlign="right"
                    autoFocus={false}
                  />
                  {searchQuery.length > 0 && (
                    <TouchableOpacity
                      onPress={() => setSearchQuery('')}
                      style={styles.clearSearchButton}
                    >
                      <X size={18} color="#6B7280" />
                    </TouchableOpacity>
                  )}
                </View>

                <FlatList
                  data={filteredToCustomers}
                  renderItem={({ item }) => renderCustomerItem({ item, onSelect: selectToCustomer })}
                  keyExtractor={(item) => item.id}
                  style={styles.modalList}
                  contentContainerStyle={[
                    styles.modalListContent,
                    { paddingBottom: Math.max(insets.bottom + 20, 32) },
                  ]}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={true}
                  ListEmptyComponent={
                    <View style={styles.emptySearchResult}>
                      <Text style={styles.emptySearchText}>لا توجد نتائج مطابقة</Text>
                      <Text style={styles.emptySearchSubtext}>جرب البحث بكلمات أخرى</Text>
                    </View>
                  }
                />

                <TouchableOpacity
                  style={styles.modalCloseButton}
                  onPress={() => {
                    setShowToCustomerPicker(false);
                    setSearchQuery('');
                  }}
                >
                  <Text style={styles.modalCloseButtonText}>إغلاق</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={showCurrencyPicker}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowCurrencyPicker(false)}
      >
        <View style={styles.modalContainer}>
          <View
            style={[
              styles.modalContent,
              { paddingBottom: Math.max(insets.bottom, 20) },
            ]}
          >
            <Text style={styles.modalTitle}>اختر عملة</Text>
            <ScrollView style={styles.modalList}>
              {CURRENCIES.map((currency) => (
                <TouchableOpacity
                  key={currency.code}
                  style={styles.modalItem}
                  onPress={() => selectCurrency(currency.code)}
                >
                  <Text style={styles.modalItemText}>
                    {currency.code} - {currency.name}
                  </Text>
                  <Text style={styles.modalItemSubtext}>{currency.symbol}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={() => setShowCurrencyPicker(false)}
            >
              <Text style={styles.modalCloseButtonText}>إغلاق</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showSuccessModal}
        animationType="fade"
        transparent={true}
        onRequestClose={handleCloseSuccessModal}
      >
        <View style={styles.successModalContainer}>
          <View style={styles.successModalCard}>
            <View style={styles.successIconContainer}>
              <CheckCircle size={64} color="#10B981" />
            </View>
            <Text style={styles.successTitle}>تم الحفظ بنجاح</Text>
            <Text style={styles.successSubtitle}>
              {isPendingMovement(savedMovementData)
                ? 'تم تسجيل الحركة بانتظار موافقة الطرف الآخر، ولن تؤثر في الإجماليات قبل القبول.'
                : 'تم إضافة الحركة المالية إلى النظام'}
            </Text>

            <View style={styles.successButtonsContainer}>
              <TouchableOpacity
                style={styles.openReceiptButton}
                onPress={() => handleOpenReceipt()}
              >
                <FileText size={20} color="#FFFFFF" />
                <Text style={styles.openReceiptButtonText}>فتح السند</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.saveButton, isSavingPdf && styles.saveButtonDisabled]}
                onPress={() => handleDownloadFromSuccess()}
                disabled={isSavingPdf}
              >
                {isSavingPdf ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Download size={20} color="#FFFFFF" />
                    <Text style={styles.saveButtonText}>حفظ في الجهاز</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.closeModalButton}
                onPress={handleCloseSuccessModal}
              >
                <X size={20} color="#6B7280" />
                <Text style={styles.closeModalButtonText}>إغلاق</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <View style={styles.hidden}>
        {savedMovementData && (
          <QRCode
            value={generateQRCodeData(savedMovementData)}
            size={120}
            getRef={(ref) => (qrRef.current = ref)}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  header: {
    backgroundColor: '#FFFFFF',
    paddingTop: 16,
    paddingHorizontal: 20,
    paddingBottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
  },
  contentContainer: {
    padding: 20,
  },
  operationTypeSection: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 12,
    textAlign: 'right',
  },
  operationTypeButtons: {
    gap: 10,
  },
  operationTypeButton: {
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 100,
  },
  operationTypeButtonActive: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  operationTypeButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 8,
    marginBottom: 2,
    textAlign: 'center',
  },
  operationTypeButtonSubtext: {
    fontSize: 13,
    textAlign: 'center',
  },
  customerSelector: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#4F46E5',
  },
  customerSelectorSelected: {
    borderColor: '#10B981',
    backgroundColor: '#F0FDF4',
  },
  customerLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  customerLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
    textAlign: 'right',
  },
  customerValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#111827',
    textAlign: 'right',
  },
  customerValueBlock: {
    alignItems: 'flex-end',
  },
  customerValueHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    flexWrap: 'wrap',
  },
  customerAccountText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4F46E5',
    marginTop: 6,
    textAlign: 'right',
  },
  autoBadge: {
    backgroundColor: '#10B981',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  autoBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  required: {
    color: '#EF4444',
  },
  amountSection: {
    marginBottom: 20,
  },
  amountRow: {
    flexDirection: 'row',
    gap: 12,
  },
  currencyButton: {
    backgroundColor: '#4F46E5',
    borderRadius: 12,
    padding: 16,
    width: 100,
    alignItems: 'center',
  },
  currencyButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  currencySymbol: {
    fontSize: 14,
    color: '#E0E7FF',
  },
  amountInput: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
    textAlign: 'right',
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#111827',
  },
  commissionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  commissionCurrencyDisplay: {
    backgroundColor: '#4F46E5',
    borderRadius: 12,
    padding: 16,
    width: 100,
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
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#111827',
  },
  textArea: {
    height: 80,
    paddingTop: 14,
  },
  submitButton: {
    backgroundColor: '#4F46E5',
    borderRadius: 12,
    paddingVertical: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 16,
    textAlign: 'center',
  },
  modalList: {
    flexGrow: 0,
    flexShrink: 1,
    maxHeight: 400,
  },
  modalListContent: {
    paddingBottom: 20,
  },
  modalItem: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  modalItemHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    marginBottom: 6,
  },
  modalItemText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'right',
  },
  modalItemInfo: {
    gap: 4,
  },
  modalItemSubtext: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'right',
  },
  modalCloseButton: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingVertical: 16,
    marginTop: 16,
  },
  modalCloseButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#374151',
    textAlign: 'center',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  searchIcon: {
    marginLeft: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111827',
  },
  clearSearchButton: {
    padding: 4,
    marginRight: 4,
  },
  emptySearchResult: {
    paddingVertical: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptySearchText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySearchSubtext: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
  },
  successModalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  successModalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 32,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  successIconContainer: {
    marginBottom: 20,
  },
  successTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 8,
    textAlign: 'center',
  },
  successSubtitle: {
    fontSize: 16,
    color: '#6B7280',
    marginBottom: 32,
    textAlign: 'center',
  },
  successButtonsContainer: {
    width: '100%',
    gap: 12,
  },
  openReceiptButton: {
    backgroundColor: '#3B82F6',
    borderRadius: 12,
    paddingVertical: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  openReceiptButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  saveButton: {
    backgroundColor: '#10B981',
    borderRadius: 12,
    paddingVertical: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  closeModalButton: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingVertical: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  closeModalButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#374151',
  },
  commissionRecipientSection: {
    marginTop: 16,
  },
  commissionRecipientSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 12,
    textAlign: 'right',
    marginTop: 4,
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
  recipientButtonCustomer: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  recipientButtonCustomerActive: {
    backgroundColor: '#3B82F6',
    borderColor: '#3B82F6',
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
  hidden: {
    position: 'absolute',
    left: -1000,
    top: -1000,
    opacity: 0,
  },
});
