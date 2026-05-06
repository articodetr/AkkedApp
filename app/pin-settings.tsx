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
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowRight, Lock, User, Save, ShieldCheck } from 'lucide-react-native';
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
  const { currentUser, refreshCurrentUser } = useAuth();
  const [fullName, setFullName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  useEffect(() => {
    if (currentUser?.fullName) {
      setFullName(currentUser.fullName);
    }
  }, [currentUser?.fullName]);

  const nameChanged =
    fullName.trim().length > 0 && fullName.trim() !== (currentUser?.fullName ?? '');

  const handleSaveName = async () => {
    if (!currentUser?.userId) {
      Alert.alert('خطأ', 'لم يتم التعرف على المستخدم الحالي');
      return;
    }
    if (!fullName.trim() || fullName.trim().length < 2) {
      Alert.alert('خطأ', 'الاسم الكامل يجب أن يكون حرفين على الأقل');
      return;
    }
    if (!nameChanged) {
      Alert.alert('تنبيه', 'لم تقم بتغيير الاسم');
      return;
    }

    setIsSavingName(true);
    try {
      const { error } = await supabase
        .from('app_security')
        .update({ full_name: fullName.trim() })
        .eq('id', currentUser.userId);

      if (error) throw error;

      await refreshCurrentUser();

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      Alert.alert('نجح', 'تم حفظ الاسم بنجاح');
    } catch (error: any) {
      console.error('Error saving name:', error);
      Alert.alert('خطأ', 'حدث خطأ أثناء حفظ الاسم');
    } finally {
      setIsSavingName(false);
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
          <Text style={styles.headerTitle}>تعديل بياناتي</Text>
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

            <Text style={[styles.label, styles.labelSpaced]}>الاسم الكامل</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                value={fullName}
                onChangeText={setFullName}
                placeholder="أدخل اسمك الكامل"
                placeholderTextColor="#9CA3AF"
                textAlign="right"
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="done"
                maxLength={60}
              />
            </View>

            <TouchableOpacity
              style={[
                styles.saveButton,
                styles.saveButtonName,
                (!nameChanged || isSavingName) && styles.saveButtonDisabled,
              ]}
              onPress={handleSaveName}
              disabled={!nameChanged || isSavingName}
              activeOpacity={0.9}
            >
              {isSavingName ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Save size={18} color="#FFFFFF" />
                  <Text style={styles.saveButtonText}>حفظ الاسم</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

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
        </ScrollView>
      </KeyboardAvoidingView>
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
});
