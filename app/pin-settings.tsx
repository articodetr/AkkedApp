import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  Platform,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Modal,
  TouchableWithoutFeedback,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowRight, Lock, User, Save, ShieldCheck, Phone, Mail, Printer, ChevronLeft, Trash2, AlertTriangle } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import * as Haptics from 'expo-haptics';
import * as Crypto from 'expo-crypto';

async function hashPassword(password: string): Promise<string> {
  const salt = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    Math.random().toString(36) + Date.now().toString()
  );
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    password + salt.substring(0, 16)
  );
  return salt.substring(0, 16) + ':' + hash;
}

async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  if (hashedPassword.includes(':')) {
    const [salt, storedHash] = hashedPassword.split(':');
    if (!salt || !storedHash) return false;
    const hash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      password + salt
    );
    return hash === storedHash;
  }
  const legacyHash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    password
  );
  return hashedPassword === legacyHash;
}

export default function PinSettings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { currentUser, refreshCurrentUser, settings, updateSettings, logout } = useAuth();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSavingInfo, setIsSavingInfo] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (currentUser?.fullName) setFullName(currentUser.fullName);
  }, [currentUser?.fullName]);

  useEffect(() => {
    setPhone(settings?.shop_phone || '');
    setEmail(settings?.email || '');
  }, [settings?.shop_phone, settings?.email]);

  const nameChanged =
    fullName.trim().length > 0 && fullName.trim() !== (currentUser?.fullName ?? '');
  const phoneChanged = phone.trim() !== (settings?.shop_phone ?? '');
  const emailChanged = email.trim() !== (settings?.email ?? '');
  const infoChanged = nameChanged || phoneChanged || emailChanged;

  const handleSaveInfo = async () => {
    if (!currentUser?.userId) {
      Alert.alert('خطأ', 'لم يتم التعرف على المستخدم الحالي');
      return;
    }
    if (!fullName.trim() || fullName.trim().length < 2) {
      Alert.alert('خطأ', 'الاسم يجب أن يكون حرفين على الأقل');
      return;
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      Alert.alert('خطأ', 'صيغة الإيميل غير صحيحة');
      return;
    }
    if (!infoChanged) {
      Alert.alert('تنبيه', 'لا يوجد تغييرات لحفظها');
      return;
    }

    setIsSavingInfo(true);
    try {
      if (nameChanged) {
        const { error } = await supabase
          .from('app_security')
          .update({ full_name: fullName.trim() })
          .eq('id', currentUser.userId);
        if (error) throw error;
        await refreshCurrentUser();
      }

      if (phoneChanged || emailChanged) {
        const updates: any = {};
        if (phoneChanged) updates.shop_phone = phone.trim() || null;
        if (emailChanged) updates.email = email.trim() || null;
        const ok = await updateSettings(updates);
        if (!ok) throw new Error('فشل حفظ معلومات الحساب');
      }

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      Alert.alert('نجح', 'تم حفظ المعلومات');
    } catch (error: any) {
      console.error('Error saving info:', error);
      Alert.alert('خطأ', error?.message || 'حدث خطأ أثناء الحفظ');
    } finally {
      setIsSavingInfo(false);
    }
  };

  const handleSavePassword = async () => {
    if (!currentUser?.userId) {
      Alert.alert('خطأ', 'لم يتم التعرف على المستخدم الحالي');
      return;
    }
    if (!currentPassword) {
      Alert.alert('خطأ', 'الرجاء إدخال كلمة المرور الحالية');
      return;
    }
    if (newPassword.length < 8) {
      Alert.alert('خطأ', 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل');
      return;
    }
    if (newPassword.length > 16) {
      Alert.alert('خطأ', 'كلمة المرور الجديدة يجب ألا تزيد عن 16 حرف');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('خطأ', 'كلمة المرور الجديدة وتأكيدها غير متطابقتين');
      return;
    }

    setIsSavingPassword(true);
    try {
      const { data: userRow, error: fetchError } = await supabase
        .from('app_security')
        .select('pin_hash')
        .eq('id', currentUser.userId)
        .maybeSingle();

      if (fetchError) throw fetchError;
      if (!userRow) {
        Alert.alert('خطأ', 'تعذر العثور على بيانات المستخدم');
        return;
      }

      const isCurrentValid = await verifyPassword(currentPassword, userRow.pin_hash);
      if (!isCurrentValid) {
        Alert.alert('خطأ', 'كلمة المرور الحالية غير صحيحة');
        return;
      }

      const newHash = await hashPassword(newPassword);
      const { error: updateError } = await supabase
        .from('app_security')
        .update({ pin_hash: newHash })
        .eq('id', currentUser.userId);

      if (updateError) throw updateError;

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');

      Alert.alert('نجح', 'تم تغيير كلمة المرور بنجاح');
    } catch (error: any) {
      console.error('Error saving password:', error);
      Alert.alert('خطأ', 'حدث خطأ أثناء تغيير كلمة المرور');
    } finally {
      setIsSavingPassword(false);
    }
  };

  const handleDeleteAccountPress = () => {
    Alert.alert(
      'حذف الحساب نهائياً',
      'سيتم حذف:\n• جميع بياناتك الشخصية\n• كل العملاء المرتبطين بك\n• جميع الحركات\n• كل الإعدادات\n\nهذه العملية لا يمكن التراجع عنها.',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'متابعة',
          style: 'destructive',
          onPress: () => {
            setDeletePassword('');
            setShowDeleteModal(true);
          },
        },
      ],
    );
  };

  const handleConfirmDelete = async () => {
    if (!currentUser?.userId) {
      Alert.alert('خطأ', 'لم يتم التعرف على المستخدم الحالي');
      return;
    }
    if (!deletePassword) {
      Alert.alert('خطأ', 'الرجاء إدخال كلمة المرور للتأكيد');
      return;
    }

    setIsDeleting(true);
    try {
      const { data: userRow, error: fetchError } = await supabase
        .from('app_security')
        .select('pin_hash')
        .eq('id', currentUser.userId)
        .maybeSingle();

      if (fetchError || !userRow) {
        Alert.alert('خطأ', 'تعذر التحقق من بيانات الحساب');
        return;
      }

      const isValid = await verifyPassword(deletePassword, userRow.pin_hash);
      if (!isValid) {
        Alert.alert('خطأ', 'كلمة المرور غير صحيحة');
        return;
      }

      const { data, error } = await supabase.rpc('delete_user_by_id', {
        p_user_id: currentUser.userId,
      });

      if (error) throw error;

      const result = data as { success: boolean; message: string };
      if (!result?.success) {
        Alert.alert('خطأ', result?.message || 'فشل حذف الحساب');
        return;
      }

      setShowDeleteModal(false);
      setDeletePassword('');
      await logout();
      router.replace('/(auth)/login' as any);
    } catch (error: any) {
      console.error('Error deleting account:', error);
      Alert.alert('خطأ', error?.message || 'حدث خطأ أثناء حذف الحساب');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <ArrowRight size={22} color="#111827" />
        </TouchableOpacity>
        <View style={styles.headerTextWrap}>
          <Text style={styles.headerTitle}>الحساب</Text>
          <Text style={styles.headerSubtitle}>
            الاسم وكلمة المرور
          </Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 8 : 0}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom, 16) + 16 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            <View style={styles.cardTitleRow}>
              <User size={20} color="#4F46E5" />
              <Text style={styles.cardTitle}>معلومات الحساب</Text>
            </View>

            <Text style={styles.label}>اسم المستخدم</Text>
            <View style={[styles.inputWrap, styles.inputDisabledWrap]}>
              <TextInput
                style={[styles.input, styles.inputDisabled]}
                value={currentUser?.userName ?? ''}
                editable={false}
                textAlign="right"
              />
            </View>
            <Text style={styles.helper}>اسم المستخدم لا يمكن تغييره</Text>

            <Text style={[styles.label, styles.labelSpaced]}>الاسم</Text>
            <View style={styles.inputWrap}>
              <User size={18} color="#6B7280" />
              <TextInput
                style={styles.inputWithIcon}
                value={fullName}
                onChangeText={setFullName}
                placeholder="أدخل اسمك"
                placeholderTextColor="#9CA3AF"
                textAlign="right"
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="next"
                maxLength={60}
              />
            </View>

            <Text style={[styles.label, styles.labelSpaced]}>الرقم</Text>
            <View style={styles.inputWrap}>
              <Phone size={18} color="#6B7280" />
              <TextInput
                style={styles.inputWithIcon}
                value={phone}
                onChangeText={setPhone}
                placeholder="مثال: 967xxxxxxxx+"
                placeholderTextColor="#9CA3AF"
                textAlign="right"
                keyboardType="phone-pad"
                autoCorrect={false}
                returnKeyType="next"
                maxLength={20}
              />
            </View>

            <Text style={[styles.label, styles.labelSpaced]}>الإيميل</Text>
            <View style={styles.inputWrap}>
              <Mail size={18} color="#6B7280" />
              <TextInput
                style={styles.inputWithIcon}
                value={email}
                onChangeText={setEmail}
                placeholder="example@email.com"
                placeholderTextColor="#9CA3AF"
                textAlign="right"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                maxLength={80}
              />
            </View>

            <TouchableOpacity
              style={[
                styles.saveButton,
                styles.saveButtonName,
                (!infoChanged || isSavingInfo) && styles.saveButtonDisabled,
              ]}
              onPress={handleSaveInfo}
              disabled={!infoChanged || isSavingInfo}
              activeOpacity={0.9}
            >
              {isSavingInfo ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Save size={18} color="#FFFFFF" />
                  <Text style={styles.saveButtonText}>حفظ المعلومات</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.linkCard}
            onPress={() => router.push('/letterhead-settings' as any)}
            activeOpacity={0.85}
          >
            <ChevronLeft size={20} color="#9CA3AF" />
            <View style={styles.linkCardTextWrap}>
              <Text style={styles.linkCardTitle}>إعدادات الترويسة والطباعة</Text>
              <Text style={styles.linkCardSubtitle}>
                تعديل الشعار والترويسة وتنسيق السندات
              </Text>
            </View>
            <View style={styles.linkCardIcon}>
              <Printer size={20} color="#0891B2" />
            </View>
          </TouchableOpacity>

          <View style={styles.card}>
            <View style={styles.cardTitleRow}>
              <ShieldCheck size={20} color="#10B981" />
              <Text style={styles.cardTitle}>تغيير كلمة المرور</Text>
            </View>

            <Text style={styles.label}>كلمة المرور الحالية</Text>
            <View style={styles.inputWrap}>
              <Lock size={18} color="#6B7280" />
              <TextInput
                style={styles.inputWithIcon}
                value={currentPassword}
                onChangeText={setCurrentPassword}
                placeholder="••••••••"
                placeholderTextColor="#9CA3AF"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                textAlign="right"
                textContentType="password"
                autoComplete="current-password"
                returnKeyType="next"
                maxLength={16}
              />
            </View>

            <Text style={[styles.label, styles.labelSpaced]}>كلمة المرور الجديدة</Text>
            <View style={styles.inputWrap}>
              <Lock size={18} color="#6B7280" />
              <TextInput
                style={styles.inputWithIcon}
                value={newPassword}
                onChangeText={(text) => {
                  if (text.length <= 16) setNewPassword(text);
                }}
                placeholder="8-16 حرف (أرقام أو أحرف)"
                placeholderTextColor="#9CA3AF"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                textAlign="right"
                textContentType="newPassword"
                autoComplete="password-new"
                returnKeyType="next"
                maxLength={16}
              />
            </View>
            {newPassword.length > 0 && (
              <Text
                style={[
                  styles.lengthIndicator,
                  newPassword.length >= 8
                    ? styles.lengthIndicatorValid
                    : styles.lengthIndicatorInvalid,
                ]}
              >
                {newPassword.length} / 16 حرف
              </Text>
            )}

            <Text style={[styles.label, styles.labelSpaced]}>تأكيد كلمة المرور</Text>
            <View style={styles.inputWrap}>
              <Lock size={18} color="#6B7280" />
              <TextInput
                style={styles.inputWithIcon}
                value={confirmPassword}
                onChangeText={(text) => {
                  if (text.length <= 16) setConfirmPassword(text);
                }}
                placeholder="أعد إدخال كلمة المرور"
                placeholderTextColor="#9CA3AF"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                textAlign="right"
                textContentType="newPassword"
                autoComplete="password-new"
                returnKeyType="done"
                maxLength={16}
              />
            </View>
            {confirmPassword.length > 0 && newPassword !== confirmPassword && (
              <Text style={[styles.lengthIndicator, styles.lengthIndicatorInvalid]}>
                كلمتا المرور غير متطابقتين
              </Text>
            )}

            <TouchableOpacity
              style={[
                styles.saveButton,
                styles.saveButtonPassword,
                isSavingPassword && styles.saveButtonDisabled,
              ]}
              onPress={handleSavePassword}
              disabled={isSavingPassword}
              activeOpacity={0.9}
            >
              {isSavingPassword ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Save size={18} color="#FFFFFF" />
                  <Text style={styles.saveButtonText}>تغيير كلمة المرور</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.dangerCard}>
            <View style={styles.dangerHeader}>
              <AlertTriangle size={18} color="#B91C1C" />
              <Text style={styles.dangerTitle}>حذف الحساب</Text>
            </View>
            <Text style={styles.dangerText}>
              حذف الحساب يحذف جميع بياناتك (العملاء، الحركات، الإعدادات) ولا يمكن التراجع.
            </Text>
            <TouchableOpacity
              style={styles.dangerButton}
              onPress={handleDeleteAccountPress}
              activeOpacity={0.85}
            >
              <Trash2 size={18} color="#FFFFFF" />
              <Text style={styles.dangerButtonText}>حذف الحساب</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={showDeleteModal}
        transparent
        animationType="fade"
        onRequestClose={() => !isDeleting && setShowDeleteModal(false)}
        statusBarTranslucent
      >
        <KeyboardAvoidingView
          style={styles.modalContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableWithoutFeedback onPress={() => !isDeleting && setShowDeleteModal(false)}>
            <View style={styles.modalBackdrop} />
          </TouchableWithoutFeedback>

          <View style={[styles.modalContent, { paddingBottom: Math.max(insets.bottom + 12, 20) }]}>
            <View style={styles.modalHandle} />

            <View style={styles.modalIconCircle}>
              <AlertTriangle size={26} color="#B91C1C" />
            </View>

            <Text style={styles.modalTitle}>تأكيد حذف الحساب</Text>
            <Text style={styles.modalSubtitle}>
              أدخل كلمة المرور الحالية لتأكيد الحذف. هذه العملية نهائية.
            </Text>

            <View style={styles.inputWrap}>
              <Lock size={18} color="#6B7280" />
              <TextInput
                style={styles.inputWithIcon}
                value={deletePassword}
                onChangeText={setDeletePassword}
                placeholder="كلمة المرور"
                placeholderTextColor="#9CA3AF"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                textAlign="right"
                textContentType="password"
                autoFocus
                editable={!isDeleting}
              />
            </View>

            <TouchableOpacity
              style={[styles.dangerButton, styles.modalDeleteBtn, isDeleting && styles.saveButtonDisabled]}
              onPress={handleConfirmDelete}
              disabled={isDeleting}
              activeOpacity={0.85}
            >
              {isDeleting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Trash2 size={18} color="#FFFFFF" />
                  <Text style={styles.dangerButtonText}>حذف الحساب نهائياً</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalCancelBtn}
              onPress={() => !isDeleting && setShowDeleteModal(false)}
              disabled={isDeleting}
              activeOpacity={0.7}
            >
              <Text style={styles.modalCancelText}>إلغاء</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  flex: {
    flex: 1,
  },
  header: {
    backgroundColor: '#FFFFFF',
    paddingTop: 12,
    paddingBottom: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  headerTextWrap: {
    flex: 1,
    alignItems: 'flex-end',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 24,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cardTitleRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    textAlign: 'right',
    marginBottom: 6,
  },
  labelSpaced: {
    marginTop: 14,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 14,
    minHeight: 48,
  },
  inputDisabledWrap: {
    backgroundColor: '#F3F4F6',
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
  },
  inputWithIcon: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
  },
  inputDisabled: {
    color: '#6B7280',
  },
  helper: {
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'right',
    marginTop: 4,
  },
  lengthIndicator: {
    fontSize: 12,
    marginTop: 6,
    textAlign: 'right',
    fontWeight: '500',
  },
  lengthIndicatorValid: {
    color: '#10B981',
  },
  lengthIndicatorInvalid: {
    color: '#EF4444',
  },
  saveButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 12,
    marginTop: 16,
  },
  saveButtonName: {
    backgroundColor: '#4F46E5',
  },
  saveButtonPassword: {
    backgroundColor: '#10B981',
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
    gap: 12,
  },
  linkCardTextWrap: {
    flex: 1,
    alignItems: 'flex-end',
  },
  linkCardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  linkCardSubtitle: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  linkCardIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#CFFAFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    marginTop: 4,
  },
  dangerHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  dangerTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#B91C1C',
    writingDirection: 'rtl',
  },
  dangerText: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'right',
    lineHeight: 20,
    writingDirection: 'rtl',
    marginBottom: 14,
  },
  dangerButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#DC2626',
    paddingVertical: 13,
    borderRadius: 12,
  },
  dangerButtonText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
    writingDirection: 'rtl',
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(17, 24, 39, 0.55)',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  modalHandle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#E5E7EB',
    marginBottom: 14,
  },
  modalIconCircle: {
    alignSelf: 'center',
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#111827',
    textAlign: 'center',
    writingDirection: 'rtl',
    marginBottom: 6,
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    writingDirection: 'rtl',
    lineHeight: 19,
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  modalDeleteBtn: {
    marginTop: 12,
  },
  modalCancelBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  modalCancelText: {
    fontSize: 14,
    color: '#6B7280',
    fontWeight: '700',
  },
});
