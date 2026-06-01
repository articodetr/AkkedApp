import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import { router } from 'expo-router';
import {
  UserPlus,
  Mail,
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  Copy,
  Check,
} from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';
import { useKeyboardAwareScroll } from '@/hooks/useKeyboardAwareScroll';

const ENABLE_GOOGLE_AUTH = true;

export default function RegisterScreen() {
  const { register, signInWithGoogle } = useAuth();
  const insets = useSafeAreaInsets();
  const { scrollRef, handleScroll, handleInputFocus, focusInput, keyboardHeight } = useKeyboardAwareScroll({
    keyboardGap: 24,
  });
  const fullNameInputRef = useRef<TextInput>(null);
  const emailInputRef = useRef<TextInput>(null);
  const passwordInputRef = useRef<TextInput>(null);
  const confirmPasswordInputRef = useRef<TextInput>(null);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [error, setError] = useState('');
  const [successAccountNumber, setSuccessAccountNumber] = useState<string | null>(null);
  const [successNeedsEmailConfirmation, setSuccessNeedsEmailConfirmation] = useState(false);
  const [copied, setCopied] = useState(false);

  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

  const handleRegister = async () => {
    setError('');

    const cleanFullName = fullName.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanFullName || cleanFullName.length < 2) {
      setError('الاسم الكامل يجب أن يكون حرفين على الأقل');
      return;
    }

    if (!isValidEmail(cleanEmail)) {
      setError('يرجى إدخال بريد إلكتروني صحيح');
      return;
    }

    if (password.length < 6) {
      setError('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      return;
    }

    if (password !== confirmPassword) {
      setError('كلمتا المرور غير متطابقتين');
      return;
    }

    setIsLoading(true);

    try {
      const result = await register(cleanFullName, cleanEmail, password);

      if (result.success) {
        if (result.needsEmailConfirmation) {
          router.replace({
            pathname: '/(auth)/check-email',
            params: { email: cleanEmail },
          });
          return;
        }

        if (result.accountNumber) {
          setSuccessAccountNumber(result.accountNumber);
          setSuccessNeedsEmailConfirmation(false);
          setCopied(false);
        } else {
          Alert.alert(
            'تم إنشاء الحساب',
            'تم إنشاء الحساب بنجاح. سجّل الدخول الآن بالبريد الإلكتروني وكلمة المرور.',
            [{ text: 'تسجيل الدخول', onPress: () => router.replace('/(auth)/login') }]
          );
        }
        return;
      }

      if (result.errorCode === 'EMAIL_EXISTS') {
        Alert.alert(
          'البريد مسجَّل مسبقاً',
          'هذا البريد الإلكتروني لديه حساب بالفعل. هل تريد الانتقال إلى تسجيل الدخول؟',
          [
            { text: 'إلغاء', style: 'cancel' },
            {
              text: 'تسجيل الدخول',
              onPress: () => router.replace('/(auth)/login'),
            },
          ]
        );
        return;
      }

      setError(result.error || 'حدث خطأ أثناء إنشاء الحساب');
    } catch (err) {
      console.error('[Register] exception:', err);
      setError('حدث خطأ أثناء إنشاء الحساب');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyAccountNumber = async () => {
    if (!successAccountNumber) return;
    try {
      await Clipboard.setStringAsync(successAccountNumber);
      setCopied(true);
    } catch (err) {
      console.error('[Register] copy account number failed:', err);
      Alert.alert('تعذّر النسخ', 'حدث خطأ أثناء نسخ رقم الحساب. حاول مرة أخرى.');
    }
  };

  const handleGoToLogin = () => {
    setSuccessAccountNumber(null);
    setSuccessNeedsEmailConfirmation(false);
    setCopied(false);
    router.replace('/(auth)/login');
  };

  const handleGoogleRegister = async () => {
    setError('');
    setIsGoogleLoading(true);

    const result = await signInWithGoogle();

    setIsGoogleLoading(false);

    if (result.success) {
      router.replace('/(tabs)');
    } else if (result.error && result.error !== 'تم إلغاء تسجيل الدخول') {
      setError(result.error);
    }
  };

  const busy = isLoading || isGoogleLoading;
  const contentBottomPadding = insets.bottom + (
    Platform.OS === 'android' && keyboardHeight > 0 ? keyboardHeight + 96 : 72
  );

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
        style={styles.keyboardView}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: contentBottomPadding }]}
          contentInsetAdjustmentBehavior="automatic"
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          onScroll={handleScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.logoContainer}>
            <UserPlus size={54} color="#4F46E5" />
          </View>

          <Text style={styles.title}>إنشاء حساب جديد</Text>
          <Text style={styles.subtitle}>
            أدخل بياناتك لإنشاء الحساب. البريد يُستخدم لتسجيل الدخول واستعادة كلمة المرور
          </Text>

          {error ? (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {ENABLE_GOOGLE_AUTH && (
            <>
              <TouchableOpacity
                style={styles.googleButton}
                onPress={handleGoogleRegister}
                disabled={busy}
                activeOpacity={0.85}
              >
                {isGoogleLoading ? (
                  <ActivityIndicator color="#4F46E5" />
                ) : (
                  <>
                    <View style={styles.googleIcon}>
                      <Text style={styles.googleIconText}>G</Text>
                    </View>
                    <Text style={styles.googleButtonText}>إنشاء حساب عبر Google</Text>
                  </>
                )}
              </TouchableOpacity>

              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>أو</Text>
                <View style={styles.dividerLine} />
              </View>
            </>
          )}

          <View style={styles.inputContainer}>
            <UserPlus size={22} color="#9CA3AF" style={styles.inputIcon} />
            <TextInput
              ref={fullNameInputRef}
              style={styles.input}
              placeholder="الاسم الكامل"
              placeholderTextColor="#9CA3AF"
              value={fullName}
              onChangeText={setFullName}
              onFocus={() => handleInputFocus(fullNameInputRef.current)}
              textAlign="right"
              editable={!busy}
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={() => focusInput(emailInputRef.current)}
            />
          </View>

          <View style={styles.inputContainer}>
            <Mail size={22} color="#9CA3AF" style={styles.inputIcon} />
            <TextInput
              ref={emailInputRef}
              style={styles.input}
              placeholder="البريد الإلكتروني"
              placeholderTextColor="#9CA3AF"
              value={email}
              onChangeText={setEmail}
              onFocus={() => handleInputFocus(emailInputRef.current)}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              textAlign="right"
              editable={!busy}
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={() => focusInput(passwordInputRef.current)}
            />
          </View>

          <View style={styles.inputContainer}>
            <Lock size={22} color="#9CA3AF" style={styles.inputIcon} />
            <TextInput
              ref={passwordInputRef}
              style={styles.input}
              placeholder="كلمة المرور"
              placeholderTextColor="#9CA3AF"
              value={password}
              onChangeText={setPassword}
              onFocus={() => handleInputFocus(passwordInputRef.current)}
              secureTextEntry={!showPassword}
              textAlign="right"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={() => focusInput(confirmPasswordInputRef.current)}
            />
            <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeIcon}>
              {showPassword ? <EyeOff size={22} color="#6B7280" /> : <Eye size={22} color="#6B7280" />}
            </TouchableOpacity>
          </View>

          <View style={styles.inputContainer}>
            <Lock size={22} color="#9CA3AF" style={styles.inputIcon} />
            <TextInput
              ref={confirmPasswordInputRef}
              style={styles.input}
              placeholder="تأكيد كلمة المرور"
              placeholderTextColor="#9CA3AF"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              onFocus={() => handleInputFocus(confirmPasswordInputRef.current)}
              secureTextEntry={!showConfirmPassword}
              textAlign="right"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
              returnKeyType="done"
              onSubmitEditing={handleRegister}
            />
            <TouchableOpacity
              onPress={() => setShowConfirmPassword(!showConfirmPassword)}
              style={styles.eyeIcon}
            >
              {showConfirmPassword ? (
                <EyeOff size={22} color="#6B7280" />
              ) : (
                <Eye size={22} color="#6B7280" />
              )}
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.button, busy && styles.buttonDisabled]}
            onPress={handleRegister}
            disabled={busy}
            activeOpacity={0.85}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.buttonText}>إنشاء حساب</Text>
            )}
          </TouchableOpacity>

          <View style={styles.footerDivider} />

          <View style={styles.loginRow}>
            <Text style={styles.loginText}>لديك حساب بالفعل؟</Text>
            <TouchableOpacity onPress={() => router.back()} disabled={busy}>
              <Text style={styles.loginLink}>تسجيل الدخول</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={!!successAccountNumber}
        transparent
        animationType="fade"
        onRequestClose={handleGoToLogin}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalIconWrap}>
              <CheckCircle2 size={56} color="#10B981" />
            </View>

            <Text style={styles.modalTitle}>تم إنشاء الحساب بنجاح</Text>
            <Text style={styles.modalSubtitle}>
              هذا هو رقم حسابك. احتفظ به في مكان آمن — ستحتاجه للتواصل مع الدعم.
            </Text>

            <View style={styles.accountNumberBox}>
              <Text style={styles.accountNumberLabel}>رقم الحساب</Text>
              <Text style={styles.accountNumberValue} selectable>
                {successAccountNumber}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.copyButton, copied && styles.copyButtonCopied]}
              onPress={handleCopyAccountNumber}
              activeOpacity={0.85}
            >
              {copied ? (
                <>
                  <Check size={20} color="#FFFFFF" />
                  <Text style={styles.copyButtonText}>تم النسخ</Text>
                </>
              ) : (
                <>
                  <Copy size={20} color="#FFFFFF" />
                  <Text style={styles.copyButtonText}>نسخ الرقم</Text>
                </>
              )}
            </TouchableOpacity>

            {successNeedsEmailConfirmation ? (
              <Text style={styles.modalNote}>
                افتح بريدك الإلكتروني لتأكيد الحساب قبل تسجيل الدخول.
              </Text>
            ) : null}

            <TouchableOpacity
              style={styles.modalPrimaryButton}
              onPress={handleGoToLogin}
              activeOpacity={0.85}
            >
              <Text style={styles.modalPrimaryButtonText}>الذهاب لتسجيل الدخول</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 48,
  },
  logoContainer: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: '#EEF2FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 24,
    textAlign: 'center',
    lineHeight: 22,
  },
  errorContainer: {
    width: '100%',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#DC2626',
    fontSize: 14,
    textAlign: 'center',
  },
  googleButton: {
    width: '100%',
    height: 58,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  googleIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  googleIconText: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#4285F4',
  },
  googleButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#374151',
  },
  dividerRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 18,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E5E7EB',
  },
  dividerText: {
    marginHorizontal: 12,
    fontSize: 13,
    color: '#9CA3AF',
    fontWeight: '600',
  },
  inputContainer: {
    width: '100%',
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    paddingHorizontal: 16,
    height: 60,
  },
  inputIcon: {
    marginLeft: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#111827',
  },
  eyeIcon: {
    padding: 4,
  },
  button: {
    width: '100%',
    height: 58,
    backgroundColor: '#4F46E5',
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 6,
    shadowColor: '#4F46E5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  footerDivider: {
    width: '100%',
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 22,
  },
  loginRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  loginText: {
    fontSize: 15,
    color: '#6B7280',
  },
  loginLink: {
    fontSize: 15,
    fontWeight: '700',
    color: '#4F46E5',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(17, 24, 39, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 22,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 18,
    elevation: 12,
  },
  modalIconWrap: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#ECFDF5',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 6,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 18,
  },
  accountNumberBox: {
    width: '100%',
    backgroundColor: '#F3F4F6',
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    paddingVertical: 16,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 14,
  },
  accountNumberLabel: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 6,
    fontWeight: '600',
  },
  accountNumberValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#111827',
    letterSpacing: 4,
  },
  copyButton: {
    width: '100%',
    height: 52,
    backgroundColor: '#4F46E5',
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  copyButtonCopied: {
    backgroundColor: '#10B981',
  },
  copyButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalNote: {
    fontSize: 13,
    color: '#92400E',
    backgroundColor: '#FEF3C7',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    textAlign: 'center',
    width: '100%',
    marginBottom: 12,
    lineHeight: 20,
  },
  modalPrimaryButton: {
    width: '100%',
    height: 52,
    backgroundColor: '#111827',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalPrimaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
