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
  Image,
} from 'react-native';
import { router } from 'expo-router';
import { UserPlus, Mail, Lock, Eye, EyeOff } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';

const ENABLE_GOOGLE_AUTH = false;

export default function RegisterScreen() {
  const { register, signInWithGoogle } = useAuth();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [error, setError] = useState('');

  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

  const handleRegister = async () => {
    setError('');

    if (!fullName.trim() || fullName.trim().length < 2) {
      setError('الاسم الكامل يجب أن يكون حرفين على الأقل');
      return;
    }

    if (!isValidEmail(email)) {
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
      const result = await register(fullName.trim(), email.trim(), password);

      if (result.success) {
        if (result.needsEmailConfirmation) {
          router.replace({
            pathname: '/(auth)/check-email',
            params: { email: email.trim().toLowerCase() },
          });
        } else {
          router.replace('/(tabs)');
        }
      } else {
        setError(result.error || 'حدث خطأ أثناء إنشاء الحساب');
      }
    } catch (err) {
      console.error('[Register] exception:', err);
      setError('حدث خطأ أثناء إنشاء الحساب');
    } finally {
      setIsLoading(false);
    }
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

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom + 32, 40) },
          ]}
          contentInsetAdjustmentBehavior="automatic"
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.logoContainer}>
            <Image
              source={require('../../assets/images/icon.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
          </View>

          <Text style={styles.title}>إنشاء حساب جديد</Text>
          <Text style={styles.subtitle}>
            {ENABLE_GOOGLE_AUTH
              ? 'سجّل بسرعة عبر Google أو ببريدك الإلكتروني'
              : 'سجّل حساباً جديداً ببريدك الإلكتروني'}
          </Text>

          {error ? (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {ENABLE_GOOGLE_AUTH && (
            <>
              <TouchableOpacity
                style={[styles.googleButton, busy && styles.buttonDisabled]}
                onPress={handleGoogleRegister}
                disabled={busy}
                activeOpacity={0.8}
              >
                {isGoogleLoading ? (
                  <ActivityIndicator color="#4F46E5" />
                ) : (
                  <>
                    <View style={styles.googleIcon}>
                      <Text style={styles.googleIconText}>G</Text>
                    </View>
                    <Text style={styles.googleButtonText}>التسجيل عبر Google</Text>
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
            <UserPlus size={20} color="#6B7280" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="الاسم الكامل"
              placeholderTextColor="#9CA3AF"
              value={fullName}
              onChangeText={setFullName}
              textAlign="right"
              autoCapitalize="words"
              editable={!busy}
            />
          </View>

          <View style={styles.inputContainer}>
            <Mail size={20} color="#6B7280" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="البريد الإلكتروني"
              placeholderTextColor="#9CA3AF"
              value={email}
              onChangeText={setEmail}
              textAlign="right"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              editable={!busy}
            />
          </View>

          <View style={styles.inputContainer}>
            <Lock size={20} color="#6B7280" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="كلمة المرور (6 أحرف على الأقل)"
              placeholderTextColor="#9CA3AF"
              value={password}
              onChangeText={setPassword}
              onFocus={() => scrollRef.current?.scrollToEnd({ animated: true })}
              secureTextEntry={!showPassword}
              textAlign="right"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
            />
            <TouchableOpacity
              onPress={() => setShowPassword(!showPassword)}
              style={styles.eyeIcon}
            >
              {showPassword ? (
                <EyeOff size={20} color="#6B7280" />
              ) : (
                <Eye size={20} color="#6B7280" />
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.inputContainer}>
            <Lock size={20} color="#6B7280" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="تأكيد كلمة المرور"
              placeholderTextColor="#9CA3AF"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              onFocus={() => scrollRef.current?.scrollToEnd({ animated: true })}
              secureTextEntry={!showConfirmPassword}
              textAlign="right"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
            />
            <TouchableOpacity
              onPress={() => setShowConfirmPassword(!showConfirmPassword)}
              style={styles.eyeIcon}
            >
              {showConfirmPassword ? (
                <EyeOff size={20} color="#6B7280" />
              ) : (
                <Eye size={20} color="#6B7280" />
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
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  logoImage: {
    width: '100%',
    height: '100%',
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
});
