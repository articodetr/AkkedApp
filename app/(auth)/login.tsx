import { useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { Lock, User, Eye, EyeOff } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardAwareScroll } from '@/hooks/useKeyboardAwareScroll';

const ENABLE_GOOGLE_AUTH = false;

export default function LoginScreen() {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const { login, signInWithGoogle } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { scrollRef, handleScroll, handleInputFocus, focusInput, keyboardHeight } = useKeyboardAwareScroll({
    keyboardGap: 24,
  });
  const loginIdInputRef = useRef<TextInput>(null);
  const passwordInputRef = useRef<TextInput>(null);

  const handleLogin = async () => {
    if (loginId.trim().length < 3) {
      Alert.alert('خطأ', 'الرجاء إدخال اسم المستخدم');
      return;
    }

    if (password.length < 6) {
      Alert.alert('خطأ', 'كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      return;
    }

    setIsLoading(true);
    const result = await login(loginId, password);
    setIsLoading(false);

    if (result.success) {
      router.replace('/(tabs)');
    } else {
      Alert.alert('خطأ', result.error || 'اسم المستخدم أو كلمة المرور غير صحيحة');
      setPassword('');
    }
  };

  const handleGoogleLogin = async () => {
    setIsGoogleLoading(true);
    const result = await signInWithGoogle();
    setIsGoogleLoading(false);

    if (result.success) {
      router.replace('/(tabs)');
    } else if (result.error && result.error !== 'تم إلغاء تسجيل الدخول') {
      Alert.alert('خطأ', result.error);
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
          contentContainerStyle={[styles.content, { paddingBottom: contentBottomPadding }]}
          contentInsetAdjustmentBehavior="automatic"
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          onScroll={handleScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
        >
        <View style={styles.logoContainer}>
          <Image
            source={require('../../assets/images/icon.png')}
            style={styles.logoImage}
            resizeMode="contain"
          />
        </View>

        <Text style={styles.title}>Akked</Text>
        <Text style={styles.subtitle}>أهلاً بك، سجّل الدخول باسم المستخدم للمتابعة</Text>

        {ENABLE_GOOGLE_AUTH && (
          <>
            <TouchableOpacity
              style={[styles.googleButton, busy && styles.buttonDisabled]}
              onPress={handleGoogleLogin}
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
                  <Text style={styles.googleButtonText}>الدخول عبر Google</Text>
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
          <User size={20} color="#6B7280" style={styles.inputIcon} />
          <TextInput
            ref={loginIdInputRef}
            style={styles.input}
            value={loginId}
            onChangeText={setLoginId}
            onFocus={() => handleInputFocus(loginIdInputRef.current)}
            placeholder="اسم المستخدم"
            placeholderTextColor="#9CA3AF"
            textAlign="right"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            returnKeyType="next"
            blurOnSubmit={false}
            onSubmitEditing={() => focusInput(passwordInputRef.current)}
          />
        </View>

        <View style={styles.inputContainer}>
          <Lock size={20} color="#6B7280" style={styles.inputIcon} />
          <TextInput
            ref={passwordInputRef}
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            onFocus={() => handleInputFocus(passwordInputRef.current)}
            placeholder="كلمة المرور"
            placeholderTextColor="#9CA3AF"
            secureTextEntry={!showPassword}
            textAlign="right"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            returnKeyType="done"
            onSubmitEditing={handleLogin}
          />
          <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeIcon}>
            {showPassword ? (
              <EyeOff size={20} color="#6B7280" />
            ) : (
              <Eye size={20} color="#6B7280" />
            )}
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.button, busy && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={busy}
          activeOpacity={0.85}
        >
          {isLoading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.buttonText}>دخول</Text>
          )}
        </TouchableOpacity>

        <View style={styles.footerDivider} />

        <View style={styles.registerRow}>
          <Text style={styles.registerText}>ليس لديك حساب؟</Text>
          <TouchableOpacity
            onPress={() => router.push('/(auth)/register')}
            disabled={busy}
          >
            <Text style={styles.registerLink}>إنشاء حساب جديد</Text>
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
  content: {
    flexGrow: 1,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 56,
    paddingBottom: 32,
    backgroundColor: '#F9FAFB',
  },
  logoContainer: {
    width: 110,
    height: 110,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  title: {
    fontSize: 30,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: '#6B7280',
    marginBottom: 28,
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
    marginVertical: 20,
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
  forgotButton: {
    width: '100%',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  forgotButtonText: {
    fontSize: 14,
    color: '#4F46E5',
    fontWeight: '600',
  },
  button: {
    width: '100%',
    height: 58,
    backgroundColor: '#4F46E5',
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
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
    marginVertical: 24,
  },
  registerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  registerText: {
    fontSize: 15,
    color: '#6B7280',
  },
  registerLink: {
    fontSize: 15,
    fontWeight: '700',
    color: '#4F46E5',
  },
});
