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
import { ArrowRight, Lock, User, Save, ShieldCheck, Phone, Mail, Printer, ChevronDown, ChevronUp, Trash2, AlertTriangle, Scale, Send, IdCard } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { CURRENCIES } from '@/types/database';
import { formatCompactNumber } from '@/utils/arabicFormat';
import { LetterheadEditor } from '@/components/LetterheadEditor';
import * as Haptics from 'expo-haptics';
import * as Crypto from 'expo-crypto';

function getInitials(fullName?: string | null, fallback?: string | null): string {
  const source = (fullName && fullName.trim()) || fallback || '';
  const cleaned = source.replace(/[^\p{L}\p{N}\s]/gu, '').trim();
  if (!cleaned) return '؟';
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  const first = parts[0] || '';
  return (first.slice(0, 2) || '؟').toUpperCase();
}

interface UnsettledBalance {
  customer_id: string;
  customer_name: string;
  linked_user_id: string | null;
  currency: string;
  balance: number;
}

function getCurrencySymbol(code: string) {
  return CURRENCIES.find((c) => c.code === code)?.symbol || code;
}

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
  const [showSettlementModal, setShowSettlementModal] = useState(false);
  const [isCheckingDeletable, setIsCheckingDeletable] = useState(false);
  const [isAutoSettling, setIsAutoSettling] = useState(false);
  const [unsettledBalances, setUnsettledBalances] = useState<UnsettledBalance[]>([]);
  const [pendingMovementsCount, setPendingMovementsCount] = useState(0);
  const [infoExpanded, setInfoExpanded] = useState(false);
  const [passwordExpanded, setPasswordExpanded] = useState(false);
  const [letterheadExpanded, setLetterheadExpanded] = useState(false);
  const [dangerExpanded, setDangerExpanded] = useState(false);

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

  const runDeletableCheck = async (): Promise<
    | { canDelete: true }
    | {
        canDelete: false;
        unsettled: UnsettledBalance[];
        pendingCount: number;
        message: string;
      }
  > => {
    if (!currentUser?.userId) {
      return {
        canDelete: false,
        unsettled: [],
        pendingCount: 0,
        message: 'لم يتم التعرف على المستخدم الحالي',
      };
    }

    const { data, error } = await supabase.rpc('check_user_can_be_deleted', {
      p_user_id: currentUser.userId,
    });

    if (error) throw error;

    const result = data as {
      can_delete: boolean;
      message: string;
      unsettled?: UnsettledBalance[];
      pending_count?: number;
    };

    if (result?.can_delete) return { canDelete: true };

    return {
      canDelete: false,
      unsettled: result?.unsettled || [],
      pendingCount: result?.pending_count || 0,
      message: result?.message || 'لا يمكن حذف الحساب',
    };
  };

  const handleDeleteAccountPress = async () => {
    if (!currentUser?.userId) {
      Alert.alert('خطأ', 'لم يتم التعرف على المستخدم الحالي');
      return;
    }
    setIsCheckingDeletable(true);
    try {
      const check = await runDeletableCheck();
      if (check.canDelete) {
        Alert.alert(
          'حذف الحساب',
          'الحساب مُسوّى مع جميع الأطراف. سيتم حذف الحساب نهائياً ولن تتمكن من تسجيل الدخول مرة أخرى.\n\nالحركات التاريخية ستبقى ظاهرة عند الأطراف الأخرى لكن لن يستطيع أحد إضافة حركات جديدة على حسابك.',
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
        return;
      }

      setUnsettledBalances(check.unsettled);
      setPendingMovementsCount(check.pendingCount);
      setShowSettlementModal(true);
    } catch (error: any) {
      console.error('Error checking deletable:', error);
      Alert.alert('خطأ', error?.message || 'تعذّر فحص حالة الحساب');
    } finally {
      setIsCheckingDeletable(false);
    }
  };

  const handleAutoSettle = async () => {
    if (!currentUser?.userId || !currentUser?.userName) {
      Alert.alert('خطأ', 'لم يتم التعرف على المستخدم الحالي');
      return;
    }
    if (unsettledBalances.length === 0) return;

    const linkedCount = unsettledBalances.filter((b) => !!b.linked_user_id).length;
    const unlinkedCount = unsettledBalances.length - linkedCount;
    const confirmMsg =
      `سيتم إنشاء ${unsettledBalances.length} حركة تسوية لتصفير الأرصدة.` +
      (linkedCount > 0
        ? `\n\n${linkedCount} منها مع حسابات مرتبطة وستكون بانتظار موافقة الطرف الآخر قبل أن تستطيع الحذف.`
        : '') +
      (unlinkedCount > 0 ? `\n\n${unlinkedCount} منها ستُصفَّر مباشرةً.` : '');

    Alert.alert('تأكيد التسوية التلقائية', confirmMsg, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'تسوية',
        onPress: async () => {
          setIsAutoSettling(true);
          let succeeded = 0;
          const failures: string[] = [];
          try {
            for (const item of unsettledBalances) {
              const balanceValue = Number(item.balance);
              if (Math.abs(balanceValue) < 0.005) continue;

              const movementType: 'incoming' | 'outgoing' =
                balanceValue > 0 ? 'outgoing' : 'incoming';
              const amount = Math.abs(balanceValue);

              const senderName =
                movementType === 'outgoing'
                  ? item.customer_name
                  : currentUser.fullName || currentUser.userName;
              const beneficiaryName =
                movementType === 'outgoing'
                  ? currentUser.fullName || currentUser.userName
                  : item.customer_name;

              const { error } = await supabase.rpc('insert_movement_with_user', {
                p_user_name: currentUser.userName,
                p_customer_id: item.customer_id,
                p_movement_type: movementType,
                p_amount: amount,
                p_currency: item.currency,
                p_notes: 'تسوية الرصيد قبل حذف الحساب',
                p_sender_name: senderName,
                p_beneficiary_name: beneficiaryName,
                p_commission: null,
                p_commission_currency: item.currency,
                p_commission_recipient_id: null,
              });

              if (error) {
                failures.push(`${item.customer_name} (${item.currency}): ${error.message}`);
              } else {
                succeeded += 1;
              }
            }

            // Refresh state from DB
            const recheck = await runDeletableCheck();
            if (recheck.canDelete) {
              setShowSettlementModal(false);
              Alert.alert(
                'تمت التسوية',
                `تم إنشاء ${succeeded} حركة بنجاح. الحساب جاهز للحذف.`,
                [
                  {
                    text: 'متابعة الحذف',
                    onPress: () => {
                      setDeletePassword('');
                      setShowDeleteModal(true);
                    },
                  },
                ],
              );
            } else {
              setUnsettledBalances(recheck.unsettled);
              setPendingMovementsCount(recheck.pendingCount);
              const detail = failures.length
                ? `\n\nأخطاء:\n${failures.join('\n')}`
                : recheck.pendingCount > 0
                ? '\n\nبعض الحركات بانتظار موافقة الطرف الآخر — حاول الحذف مجدداً بعد موافقتهم.'
                : '';
              Alert.alert(
                'تسوية جزئية',
                `تم إنشاء ${succeeded} حركة. ${recheck.message}${detail}`,
              );
            }
          } catch (error: any) {
            console.error('Error auto-settling:', error);
            Alert.alert('خطأ', error?.message || 'حدث خطأ أثناء التسوية التلقائية');
          } finally {
            setIsAutoSettling(false);
          }
        },
      },
    ]);
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

      const { data, error } = await supabase.rpc('soft_delete_user_account', {
        p_user_id: currentUser.userId,
      });

      if (error) throw error;

      const result = data as { success: boolean; message: string; code?: string };
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

  const initials = getInitials(currentUser?.fullName, currentUser?.userName);
  const roleLabel = currentUser?.role === 'admin' ? 'مدير' : 'مستخدم';

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#4F46E5', '#7C3AED']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.profileBanner, { paddingTop: insets.top + 8 }]}
      >
        <View style={styles.bannerTopRow}>
          <Text style={styles.bannerTopTitle}>الحساب</Text>
          <TouchableOpacity
            style={styles.backButtonLight}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <ArrowRight size={22} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <View style={styles.profileBlock}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <Text style={styles.profileName} numberOfLines={1}>
            {currentUser?.fullName || currentUser?.userName || 'مستخدم'}
          </Text>
          <Text style={styles.profileUsername} numberOfLines={1}>
            @{currentUser?.userName ?? ''}
          </Text>
          <View style={styles.profileMetaRow}>
            {currentUser?.accountNumber ? (
              <View style={styles.profileChip}>
                <IdCard size={12} color="#FFFFFF" />
                <Text style={styles.profileChipText}>{currentUser.accountNumber}</Text>
              </View>
            ) : null}
            <View style={styles.profileChip}>
              <ShieldCheck size={12} color="#FFFFFF" />
              <Text style={styles.profileChipText}>{roleLabel}</Text>
            </View>
          </View>
        </View>
      </LinearGradient>

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
          <View style={styles.collapsibleCard}>
            <TouchableOpacity
              style={styles.collapsibleHeader}
              onPress={() => setInfoExpanded((v) => !v)}
              activeOpacity={0.7}
            >
              <View style={styles.collapsibleHeaderLeft}>
                {infoExpanded ? (
                  <ChevronUp size={18} color="#9CA3AF" />
                ) : (
                  <ChevronDown size={18} color="#9CA3AF" />
                )}
              </View>
              <View style={styles.collapsibleHeaderRight}>
                <View style={styles.collapsibleTitleWrap}>
                  <Text style={styles.collapsibleTitle}>البيانات الشخصية</Text>
                  <Text style={styles.collapsibleSubtitle}>الاسم والجوال والإيميل</Text>
                </View>
                <View style={[styles.collapsibleIconCircle, { backgroundColor: '#EEF2FF' }]}>
                  <User size={18} color="#4F46E5" />
                </View>
              </View>
            </TouchableOpacity>

            {infoExpanded ? (
              <View style={styles.collapsibleBody}>
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
            ) : null}
          </View>

          <View style={styles.collapsibleCard}>
            <TouchableOpacity
              style={styles.collapsibleHeader}
              onPress={() => setLetterheadExpanded((v) => !v)}
              activeOpacity={0.7}
            >
              <View style={styles.collapsibleHeaderLeft}>
                {letterheadExpanded ? (
                  <ChevronUp size={18} color="#9CA3AF" />
                ) : (
                  <ChevronDown size={18} color="#9CA3AF" />
                )}
              </View>
              <View style={styles.collapsibleHeaderRight}>
                <View style={styles.collapsibleTitleWrap}>
                  <Text style={styles.collapsibleTitle}>إعدادات الترويسة والطباعة</Text>
                  <Text style={styles.collapsibleSubtitle}>
                    الشعار والترويسة وتنسيق السندات
                  </Text>
                </View>
                <View style={[styles.collapsibleIconCircle, { backgroundColor: '#ECFEFF' }]}>
                  <Printer size={18} color="#0891B2" />
                </View>
              </View>
            </TouchableOpacity>

            {letterheadExpanded ? (
              <View style={styles.collapsibleBody}>
                <LetterheadEditor
                  userId={currentUser?.userId}
                  shopName={settings?.shop_name}
                  shopPhone={settings?.shop_phone}
                />
              </View>
            ) : null}
          </View>

          <View style={styles.collapsibleCard}>
            <TouchableOpacity
              style={styles.collapsibleHeader}
              onPress={() => setPasswordExpanded((v) => !v)}
              activeOpacity={0.7}
            >
              <View style={styles.collapsibleHeaderLeft}>
                {passwordExpanded ? (
                  <ChevronUp size={18} color="#9CA3AF" />
                ) : (
                  <ChevronDown size={18} color="#9CA3AF" />
                )}
              </View>
              <View style={styles.collapsibleHeaderRight}>
                <View style={styles.collapsibleTitleWrap}>
                  <Text style={styles.collapsibleTitle}>كلمة المرور</Text>
                  <Text style={styles.collapsibleSubtitle}>تغيير كلمة المرور الحالية</Text>
                </View>
                <View style={[styles.collapsibleIconCircle, { backgroundColor: '#ECFDF5' }]}>
                  <ShieldCheck size={18} color="#10B981" />
                </View>
              </View>
            </TouchableOpacity>

            {passwordExpanded ? (
              <View style={styles.collapsibleBody}>
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
            ) : null}
          </View>

          <View style={[styles.collapsibleCard, styles.collapsibleCardDanger]}>
            <TouchableOpacity
              style={styles.collapsibleHeader}
              onPress={() => setDangerExpanded((v) => !v)}
              activeOpacity={0.7}
            >
              <View style={styles.collapsibleHeaderLeft}>
                {dangerExpanded ? (
                  <ChevronUp size={18} color="#9CA3AF" />
                ) : (
                  <ChevronDown size={18} color="#9CA3AF" />
                )}
              </View>
              <View style={styles.collapsibleHeaderRight}>
                <View style={styles.collapsibleTitleWrap}>
                  <Text style={[styles.collapsibleTitle, { color: '#B91C1C' }]}>حذف الحساب</Text>
                  <Text style={styles.collapsibleSubtitle}>إزالة الحساب نهائياً بعد التسوية</Text>
                </View>
                <View style={[styles.collapsibleIconCircle, { backgroundColor: '#FEE2E2' }]}>
                  <AlertTriangle size={18} color="#B91C1C" />
                </View>
              </View>
            </TouchableOpacity>

            {dangerExpanded ? (
              <View style={styles.collapsibleBody}>
                <Text style={styles.dangerText}>
                  لا يمكن حذف الحساب إلا بعد تصفية جميع الأرصدة مع باقي الحسابات.
                  بعد الحذف لن تتمكن من تسجيل الدخول، وستبقى الحركات التاريخية ظاهرة عند الأطراف الأخرى دون إمكانية إضافة حركات جديدة على حسابك.
                </Text>
                <TouchableOpacity
                  style={[styles.dangerButton, isCheckingDeletable && styles.saveButtonDisabled]}
                  onPress={handleDeleteAccountPress}
                  activeOpacity={0.85}
                  disabled={isCheckingDeletable}
                >
                  {isCheckingDeletable ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Trash2 size={18} color="#FFFFFF" />
                      <Text style={styles.dangerButtonText}>حذف الحساب</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            ) : null}
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

      <Modal
        visible={showSettlementModal}
        transparent
        animationType="fade"
        onRequestClose={() => !isAutoSettling && setShowSettlementModal(false)}
        statusBarTranslucent
      >
        <KeyboardAvoidingView
          style={styles.modalContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableWithoutFeedback
            onPress={() => !isAutoSettling && setShowSettlementModal(false)}
          >
            <View style={styles.modalBackdrop} />
          </TouchableWithoutFeedback>

          <View
            style={[styles.modalContent, { paddingBottom: Math.max(insets.bottom + 12, 20) }]}
          >
            <View style={styles.modalHandle} />

            <View style={[styles.modalIconCircle, { backgroundColor: '#FEF3C7' }]}>
              <Scale size={26} color="#B45309" />
            </View>

            <Text style={styles.modalTitle}>تسوية مطلوبة قبل الحذف</Text>
            <Text style={styles.modalSubtitle}>
              يجب أن تكون أرصدتك صفر مع جميع الأطراف قبل أن تستطيع حذف حسابك.
            </Text>

            <ScrollView
              style={styles.settlementList}
              contentContainerStyle={styles.settlementListContent}
              showsVerticalScrollIndicator={false}
            >
              {unsettledBalances.map((item, idx) => {
                const balanceValue = Number(item.balance);
                const isPositive = balanceValue > 0;
                const directionLabel = isPositive ? 'له عندك' : 'لك عنده';
                const chipColor = isPositive ? '#DC2626' : '#16A34A';
                const chipBg = isPositive ? '#FEE2E2' : '#ECFDF5';

                return (
                  <View
                    key={`${item.customer_id}-${item.currency}-${idx}`}
                    style={styles.settlementRow}
                  >
                    <View style={styles.settlementRowLeft}>
                      <View style={[styles.directionChip, { backgroundColor: chipBg }]}>
                        <Text style={[styles.directionChipText, { color: chipColor }]}>
                          {directionLabel}
                        </Text>
                      </View>
                      <Text style={styles.settlementAmount}>
                        {formatCompactNumber(Math.abs(balanceValue))}{' '}
                        <Text style={styles.settlementCurrency}>
                          {getCurrencySymbol(item.currency)}
                        </Text>
                      </Text>
                    </View>
                    <View style={styles.settlementRowRight}>
                      <Text style={styles.settlementCustomerName} numberOfLines={1}>
                        {item.customer_name}
                      </Text>
                      {item.linked_user_id ? (
                        <Text style={styles.settlementLinkedTag}>حساب مرتبط</Text>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </ScrollView>

            {pendingMovementsCount > 0 ? (
              <View style={styles.settlementWarn}>
                <AlertTriangle size={14} color="#B45309" />
                <Text style={styles.settlementWarnText}>
                  لديك {pendingMovementsCount} حركة معلّقة بانتظار الموافقة
                </Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[
                styles.dangerButton,
                styles.modalDeleteBtn,
                { backgroundColor: '#4F46E5' },
                isAutoSettling && styles.saveButtonDisabled,
              ]}
              onPress={handleAutoSettle}
              disabled={isAutoSettling || unsettledBalances.length === 0}
              activeOpacity={0.85}
            >
              {isAutoSettling ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Send size={18} color="#FFFFFF" />
                  <Text style={styles.dangerButtonText}>تسوية تلقائية الآن</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalCancelBtn}
              onPress={() => !isAutoSettling && setShowSettlementModal(false)}
              disabled={isAutoSettling}
              activeOpacity={0.7}
            >
              <Text style={styles.modalCancelText}>سأسوّي يدوياً لاحقاً</Text>
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
    paddingTop: 16,
    paddingBottom: 24,
  },
  profileBanner: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  bannerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  backButtonLight: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerTopTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    writingDirection: 'rtl',
    textAlign: 'right',
  },
  profileBlock: {
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 4,
  },
  avatarCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  avatarText: {
    fontSize: 30,
    fontWeight: '900',
    color: '#4F46E5',
    letterSpacing: 1,
  },
  profileName: {
    fontSize: 20,
    fontWeight: '900',
    color: '#FFFFFF',
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  profileUsername: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.85)',
    marginTop: 4,
  },
  profileMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  profileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  profileChipText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FFFFFF',
    writingDirection: 'rtl',
  },
  collapsibleCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
  },
  collapsibleCardDanger: {
    borderColor: '#FECACA',
    backgroundColor: '#FFF5F5',
  },
  collapsibleHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  collapsibleHeaderRight: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  collapsibleHeaderLeft: {
    paddingLeft: 6,
  },
  collapsibleIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  collapsibleTitleWrap: {
    flex: 1,
    alignItems: 'flex-start',
  },
  collapsibleTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'right',
  },
  collapsibleSubtitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    marginTop: 2,
    textAlign: 'right',
  },
  collapsibleBody: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
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
    flexDirection: 'row',
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
    width: '100%',
    alignSelf: 'stretch',
    writingDirection: 'rtl',
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
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  inputWithIcon: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  inputDisabled: {
    color: '#6B7280',
  },
  helper: {
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'right',
    width: '100%',
    alignSelf: 'stretch',
    writingDirection: 'rtl',
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
    flexDirection: 'row',
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
    flexDirection: 'row',
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
    flexDirection: 'row',
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
  settlementList: {
    maxHeight: 240,
    width: '100%',
    borderRadius: 12,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 12,
  },
  settlementListContent: {
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  settlementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  settlementRowRight: {
    flex: 1,
    alignItems: 'flex-end',
    paddingLeft: 12,
  },
  settlementRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  settlementCustomerName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  settlementLinkedTag: {
    fontSize: 11,
    color: '#4F46E5',
    fontWeight: '700',
    marginTop: 2,
  },
  directionChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  directionChipText: {
    fontSize: 11,
    fontWeight: '900',
    writingDirection: 'rtl',
  },
  settlementAmount: {
    fontSize: 15,
    fontWeight: '900',
    color: '#111827',
  },
  settlementCurrency: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '700',
  },
  settlementWarn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF3C7',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 4,
    width: '100%',
  },
  settlementWarnText: {
    flex: 1,
    fontSize: 12,
    color: '#92400E',
    fontWeight: '700',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
});
