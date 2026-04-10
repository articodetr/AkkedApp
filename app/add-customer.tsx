import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  FlatList,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowRight, Save, Search, UserPlus, User, Link as LinkIcon } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { KeyboardAwareView } from '@/components/KeyboardAwareView';
import { useAuth } from '@/contexts/AuthContext';
import { SearchUserResult } from '@/types/database';
import {
  generateRegularCustomerAccountNumber,
  isCustomerAccountNumberConflict,
} from '@/utils/customerAccountNumber';

type CustomerType = 'regular' | 'linked';

export default function AddCustomerScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const { currentUser } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(!!id);
  const [isEditMode, setIsEditMode] = useState(!!id);
  const [customerType, setCustomerType] = useState<CustomerType>('regular');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchUserResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<SearchUserResult | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    notes: '',
  });

  useEffect(() => {
    if (id) {
      loadCustomerData();
    }
  }, [id]);

  const loadCustomerData = async () => {
    try {
      setIsLoadingData(true);
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error || !data) {
        Alert.alert('خطأ', 'لم يتم العثور على العميل');
        router.back();
        return;
      }

      setFormData({
        name: data.name || '',
        phone: data.phone || '',
        email: data.email || '',
        address: data.address || '',
        notes: data.notes || '',
      });
    } catch (error) {
      console.error('Error loading customer:', error);
      Alert.alert('خطأ', 'حدث خطأ أثناء تحميل البيانات');
    } finally {
      setIsLoadingData(false);
    }
  };

  const searchUsers = async (query: string) => {
    if (!query.trim() || query.length < 1) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const { data, error } = await supabase.rpc('search_users_by_account_number', {
        p_account_number: query.trim(),
        p_current_user_id: currentUser?.userId,
      });

      if (error) throw error;
      setSearchResults(data || []);
    } catch (error) {
      console.error('Error searching users:', error);
      Alert.alert('خطأ', 'حدث خطأ أثناء البحث');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearchQueryChange = (text: string) => {
    setSearchQuery(text);
    if (text.trim()) {
      searchUsers(text);
    } else {
      setSearchResults([]);
    }
  };

  const handleSelectUser = (user: SearchUserResult) => {
    if (user.is_already_linked) {
      Alert.alert('تنبيه', 'هذا المستخدم مربوط بالفعل في قائمة عملائك');
      return;
    }

    setSelectedUser(user);
    setFormData({
      ...formData,
      name: user.full_name,
    });
    setSearchResults([]);
  };

  const getCustomerSaveErrorMessage = (error: unknown, isEdit: boolean) => {
    if (
      !isEdit &&
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === '42883'
    ) {
      return 'يوجد خلل في دوال قاعدة البيانات الخاصة بتوليد رقم الحساب. بعد تطبيق آخر migrations ستعمل إضافة العميل المحلي بشكل طبيعي.';
    }

    return `حدث خطأ أثناء ${isEdit ? 'تحديث' : 'إضافة'} العميل`;
  };

  const createRegularCustomer = async () => {
    const customerPayload = {
      name: formData.name.trim(),
      phone: formData.phone.trim(),
      email: formData.email.trim() || null,
      address: formData.address.trim() || null,
      notes: formData.notes.trim() || null,
      user_id: currentUser!.userId,
    };

    let lastError: unknown;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const { error } = await supabase.from('customers').insert([
        {
          ...customerPayload,
          account_number: generateRegularCustomerAccountNumber(),
        },
      ]);

      if (!error) {
        return;
      }

      if (!isCustomerAccountNumberConflict(error)) {
        throw error;
      }

      lastError = error;
    }

    throw lastError ?? new Error('Failed to generate a unique customer account number');
  };

  const handleSubmit = async () => {
    // التحقق من وجود المستخدم الحالي
    if (!currentUser?.userId) {
      Alert.alert('خطأ', 'يجب تسجيل الدخول أولاً');
      return;
    }

    if (customerType === 'linked') {
      if (!selectedUser) {
        Alert.alert('خطأ', 'الرجاء اختيار مستخدم من نتائج البحث');
        return;
      }

      setIsLoading(true);
      try {
        const { data, error } = await supabase.rpc('create_linked_customer', {
          p_owner_user_id: currentUser.userId,
          p_linked_user_id: selectedUser.id,
          p_customer_name: formData.name.trim() || selectedUser.full_name,
        });

        if (error) throw error;

        const result = data?.[0];
        if (result?.success) {
          Alert.alert('نجح', result.message, [
            {
              text: 'حسناً',
              onPress: () => router.back(),
            },
          ]);
        } else {
          Alert.alert('خطأ', result?.message || 'حدث خطأ أثناء ربط المستخدم');
        }
      } catch (error) {
        console.error('Error linking user:', error);
        Alert.alert('خطأ', 'حدث خطأ أثناء ربط المستخدم كعميل');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    if (!formData.name.trim() || !formData.phone.trim()) {
      Alert.alert('خطأ', 'الرجاء إدخال الاسم ورقم الهاتف');
      return;
    }

    setIsLoading(true);
    try {
      if (isEditMode && id) {
        const { error } = await supabase
          .from('customers')
          .update({
            name: formData.name.trim(),
            phone: formData.phone.trim(),
            email: formData.email.trim() || null,
            address: formData.address.trim() || null,
            notes: formData.notes.trim() || null,
          })
          .eq('id', id);

        if (error) throw error;

        Alert.alert('نجح', 'تم تحديث بيانات العميل بنجاح', [
          {
            text: 'حسناً',
            onPress: () => router.back(),
          },
        ]);
      } else {
        await createRegularCustomer();

        Alert.alert('نجح', 'تم إضافة العميل بنجاح', [
          {
            text: 'حسناً',
            onPress: () => router.back(),
          },
        ]);
      }
    } catch (error) {
      console.error('Error saving customer:', error);
      return Alert.alert('خطأ', getCustomerSaveErrorMessage(error, isEditMode));
      Alert.alert('خطأ', `حدث خطأ أثناء ${isEditMode ? 'تحديث' : 'إضافة'} العميل`);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoadingData) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <ArrowRight size={24} color="#111827" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{isEditMode ? 'تعديل العميل' : 'إضافة عميل جديد'}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4F46E5" />
          <Text style={styles.loadingText}>جاري التحميل...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ArrowRight size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{isEditMode ? 'تعديل العميل' : 'إضافة عميل جديد'}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAwareView
        contentContainerStyle={styles.contentContainer}
        extraScrollHeight={180}
      >
        {!isEditMode && (
          <View style={styles.typeSelector}>
            <TouchableOpacity
              style={[
                styles.typeButton,
                customerType === 'regular' && styles.typeButtonActive,
              ]}
              onPress={() => {
                setCustomerType('regular');
                setSelectedUser(null);
                setSearchQuery('');
                setSearchResults([]);
              }}
            >
              <UserPlus
                size={20}
                color={customerType === 'regular' ? '#FFFFFF' : '#6B7280'}
              />
              <Text
                style={[
                  styles.typeButtonText,
                  customerType === 'regular' && styles.typeButtonTextActive,
                ]}
              >
                عميل محلي
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.typeButton,
                customerType === 'linked' && styles.typeButtonActive,
              ]}
              onPress={() => {
                setCustomerType('linked');
                setFormData({
                  name: '',
                  phone: '',
                  email: '',
                  address: '',
                  notes: '',
                });
              }}
            >
              <LinkIcon
                size={20}
                color={customerType === 'linked' ? '#FFFFFF' : '#6B7280'}
              />
              <Text
                style={[
                  styles.typeButtonText,
                  customerType === 'linked' && styles.typeButtonTextActive,
                ]}
              >
                ربط مستخدم موجود
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {!isEditMode && customerType === 'linked' && (
          <View style={styles.searchSection}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>
                البحث برقم الحساب <Text style={styles.required}>*</Text>
              </Text>
              <View style={styles.searchInputContainer}>
                <Search size={20} color="#6B7280" style={styles.searchIcon} />
                <TextInput
                  style={styles.searchInput}
                  value={searchQuery}
                  onChangeText={handleSearchQueryChange}
                  placeholder="ابحث برقم حساب المستخدم"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="number-pad"
                  textAlign="right"
                />
                {isSearching && (
                  <ActivityIndicator
                    size="small"
                    color="#4F46E5"
                    style={styles.searchLoader}
                  />
                )}
              </View>
            </View>

            {searchResults.length > 0 && (
              <View style={styles.searchResults}>
                <Text style={styles.searchResultsTitle}>نتائج البحث:</Text>
                {searchResults.map((user) => (
                  <TouchableOpacity
                    key={user.id}
                    style={[
                      styles.searchResultItem,
                      user.is_already_linked && styles.searchResultItemDisabled,
                      selectedUser?.id === user.id && styles.searchResultItemSelected,
                    ]}
                    onPress={() => handleSelectUser(user)}
                    disabled={user.is_already_linked}
                  >
                    <View style={styles.searchResultInfo}>
                      <User size={20} color={user.is_already_linked ? '#9CA3AF' : '#4F46E5'} />
                      <View style={styles.searchResultText}>
                        <Text
                          style={[
                            styles.searchResultName,
                            user.is_already_linked && styles.searchResultTextDisabled,
                          ]}
                        >
                          {user.full_name}
                        </Text>
                        <Text style={styles.searchResultAccount}>
                          رقم الحساب: {user.account_number}
                        </Text>
                        {user.is_already_linked && (
                          <Text style={styles.searchResultLinked}>مربوط بالفعل</Text>
                        )}
                      </View>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {selectedUser && (
              <View style={styles.selectedUserCard}>
                <Text style={styles.selectedUserTitle}>المستخدم المحدد:</Text>
                <View style={styles.selectedUserInfo}>
                  <User size={24} color="#4F46E5" />
                  <View style={styles.selectedUserText}>
                    <Text style={styles.selectedUserName}>{selectedUser.full_name}</Text>
                    <Text style={styles.selectedUserAccount}>
                      رقم الحساب: {selectedUser.account_number}
                    </Text>
                  </View>
                </View>
              </View>
            )}
          </View>
        )}

        {(isEditMode || customerType === 'regular' || selectedUser) && (
          <View style={styles.inputGroup}>
            <Text style={styles.label}>
              الاسم <Text style={styles.required}>*</Text>
            </Text>
            <TextInput
              style={styles.input}
              value={formData.name}
              onChangeText={(text) => setFormData({ ...formData, name: text })}
              placeholder={
                customerType === 'linked'
                  ? 'اسم العرض (اختياري - سيتم استخدام اسم المستخدم افتراضياً)'
                  : 'أدخل اسم العميل'
              }
              placeholderTextColor="#9CA3AF"
              textAlign="right"
              editable={customerType === 'regular' || isEditMode}
            />
          </View>
        )}

        {(isEditMode || customerType === 'regular') && (
          <>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>
                رقم الهاتف <Text style={styles.required}>*</Text>
              </Text>
              <TextInput
                style={styles.input}
                value={formData.phone}
                onChangeText={(text) => setFormData({ ...formData, phone: text })}
                placeholder="أدخل رقم الهاتف"
                placeholderTextColor="#9CA3AF"
                keyboardType="phone-pad"
                textAlign="right"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>البريد الإلكتروني</Text>
              <TextInput
                style={styles.input}
                value={formData.email}
                onChangeText={(text) => setFormData({ ...formData, email: text })}
                placeholder="أدخل البريد الإلكتروني"
                placeholderTextColor="#9CA3AF"
                keyboardType="email-address"
                textAlign="right"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>العنوان</Text>
              <TextInput
                style={styles.input}
                value={formData.address}
                onChangeText={(text) => setFormData({ ...formData, address: text })}
                placeholder="أدخل العنوان"
                placeholderTextColor="#9CA3AF"
                textAlign="right"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>ملاحظات</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={formData.notes}
                onChangeText={(text) => setFormData({ ...formData, notes: text })}
                placeholder="أدخل ملاحظات إضافية"
                placeholderTextColor="#9CA3AF"
                multiline
                numberOfLines={4}
                textAlign="right"
                textAlignVertical="top"
              />
            </View>
          </>
        )}

        <TouchableOpacity
          style={[styles.submitButton, isLoading && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={isLoading}
        >
          <Save size={20} color="#FFFFFF" />
          <Text style={styles.submitButtonText}>
            {isLoading ? 'جاري الحفظ...' : (isEditMode ? 'حفظ التعديلات' : 'حفظ العميل')}
          </Text>
        </TouchableOpacity>
      </KeyboardAwareView>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    color: '#6B7280',
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
  keyboardView: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 50,
  },
  typeSelector: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  typeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingVertical: 16,
  },
  typeButtonActive: {
    backgroundColor: '#4F46E5',
    borderColor: '#4F46E5',
  },
  typeButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  typeButtonTextActive: {
    color: '#FFFFFF',
  },
  searchSection: {
    marginBottom: 20,
  },
  searchInputContainer: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 48,
    paddingVertical: 14,
    fontSize: 16,
    color: '#111827',
  },
  searchIcon: {
    position: 'absolute',
    right: 16,
    zIndex: 1,
  },
  searchLoader: {
    position: 'absolute',
    left: 16,
  },
  searchResults: {
    marginTop: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
  },
  searchResultsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    textAlign: 'right',
  },
  searchResultItem: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  searchResultItemDisabled: {
    opacity: 0.5,
  },
  searchResultItemSelected: {
    backgroundColor: '#EEF2FF',
  },
  searchResultInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  searchResultText: {
    flex: 1,
  },
  searchResultName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'right',
    marginBottom: 4,
  },
  searchResultAccount: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'right',
    marginBottom: 2,
  },
  searchResultLinked: {
    fontSize: 12,
    color: '#EF4444',
    textAlign: 'right',
  },
  searchResultTextDisabled: {
    color: '#9CA3AF',
  },
  selectedUserCard: {
    backgroundColor: '#EEF2FF',
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
  },
  selectedUserTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4F46E5',
    marginBottom: 12,
    textAlign: 'right',
  },
  selectedUserInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  selectedUserText: {
    flex: 1,
  },
  selectedUserName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'right',
    marginBottom: 4,
  },
  selectedUserAccount: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'right',
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
  required: {
    color: '#EF4444',
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
  textArea: {
    height: 100,
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
});
