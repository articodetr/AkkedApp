import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Mail,
  ArrowRight,
  CheckCircle2,
  KeyRound,
  Send,
  ShieldCheck,
} from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const isValidEmail = (value: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

  const handleReset = async () => {
    setError('');

    if (!isValidEmail(email)) {
      setError('يرجى إدخال بريد إلكتروني صحيح');
      return;
    }

    setIsLoading(true);
    const result = await resetPassword(email);
    setIsLoading(false);

    if (result.success) {
      setSent(true);
    } else {
      setError(result.error || 'تعذّر إرسال رابط الاستعادة');
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#4F46E5" />

      <LinearGradient
        colors={['#6366F1', '#4F46E5', '#4338CA']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.gradientHeader, { paddingTop: insets.top + 8 }]}
      >
        <View style={styles.headerTopRow}>
          <TouchableOpacity
            style={styles.backCircle}
            onPress={() => router.back()}
            activeOpacity={0.85}
            disabled={isLoading}
          >
            <ArrowRight size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={styles.brandWrap}>
            <Text style={styles.brandText}>أكِّد</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.heroBlock}>
          <View style={styles.iconOuterRing}>
            <View style={styles.iconInnerCircle}>
              {sent ? (
                <CheckCircle2 size={42} color="#10B981" />
              ) : (
                <KeyRound size={40} color="#4F46E5" />
              )}
            </View>
          </View>

          <Text style={styles.heroTitle}>
            {sent ? 'تم الإرسال بنجاح' : 'هل نسيت كلمة المرور؟'}
          </Text>
          <Text style={styles.heroSubtitle}>
            {sent
              ? 'افتح بريدك الإلكتروني واتبع الرابط لاختيار كلمة مرور جديدة'
              : 'أدخل بريدك الإلكتروني وسنرسل لك رابطاً لإعادة تعيين كلمة المرور'}
          </Text>
        </View>
      </LinearGradient>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardWrap}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: insets.bottom + 32 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            {sent ? (
              <>
                <View style={styles.successEmailBox}>
                  <Mail size={18} color="#4F46E5" />
                  <Text style={styles.successEmailText} numberOfLines={1}>
                    {email.trim().toLowerCase()}
                  </Text>
                </View>

                <View style={styles.tipsBox}>
                  <View style={styles.tipRow}>
                    <View style={[styles.tipDot, { backgroundColor: '#10B981' }]} />
                    <Text style={styles.tipText}>
                      تحقّق من صندوق الوارد خلال دقائق قليلة
                    </Text>
                  </View>
                  <View style={styles.tipRow}>
                    <View style={[styles.tipDot, { backgroundColor: '#F59E0B' }]} />
                    <Text style={styles.tipText}>
                      إذا لم تجد الرسالة، افحص مجلد الرسائل غير المرغوب فيها (Spam)
                    </Text>
                  </View>
                  <View style={styles.tipRow}>
                    <View style={[styles.tipDot, { backgroundColor: '#6366F1' }]} />
                    <Text style={styles.tipText}>
                      افتح الرابط من نفس الجهاز الذي عليه التطبيق
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={() => router.replace('/(auth)/login')}
                  activeOpacity={0.85}
                >
                  <Text style={styles.primaryButtonText}>العودة لتسجيل الدخول</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => {
                    setSent(false);
                    setError('');
                  }}
                  activeOpacity={0.85}
                >
                  <Text style={styles.secondaryButtonText}>
                    لم تصلك الرسالة؟ أعد المحاولة
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={styles.sectionHeaderRow}>
                  <View style={styles.sectionDot} />
                  <Text style={styles.sectionTitle}>البريد الإلكتروني</Text>
                </View>

                {error ? (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                ) : null}

                <View style={styles.inputCard}>
                  <View style={styles.inputIconWrap}>
                    <Mail size={20} color="#4F46E5" />
                  </View>
                  <TextInput
                    style={styles.input}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="name@example.com"
                    placeholderTextColor="#9CA3AF"
                    textAlign="right"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    editable={!isLoading}
                  />
                </View>

                <View style={styles.assuranceRow}>
                  <ShieldCheck size={16} color="#10B981" />
                  <Text style={styles.assuranceText}>
                    الرابط آمن وصالح لمدة 60 دقيقة فقط
                  </Text>
                </View>

                <TouchableOpacity
                  style={[styles.primaryButton, isLoading && styles.buttonDisabled]}
                  onPress={handleReset}
                  disabled={isLoading}
                  activeOpacity={0.85}
                >
                  {isLoading ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <>
                      <Send size={18} color="#FFFFFF" />
                      <Text style={styles.primaryButtonText}>
                        إرسال رابط الاستعادة
                      </Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => router.back()}
                  disabled={isLoading}
                  activeOpacity={0.85}
                >
                  <Text style={styles.secondaryButtonText}>
                    تذكّرت كلمة المرور؟ تسجيل الدخول
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  gradientHeader: {
    paddingHorizontal: 20,
    paddingBottom: 80,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  backCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandWrap: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
  },
  brandText: {
    fontSize: 16,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    lineHeight: 22,
    includeFontPadding: false,
  },
  heroBlock: {
    alignItems: 'center',
    paddingTop: 8,
  },
  iconOuterRing: {
    width: 108,
    height: 108,
    borderRadius: 54,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  iconInnerCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 10,
    lineHeight: 36,
  },
  heroSubtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.88)',
    textAlign: 'center',
    paddingHorizontal: 16,
    lineHeight: 24,
  },
  keyboardWrap: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 16,
    marginTop: -20,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingTop: 36,
    paddingHorizontal: 24,
    paddingBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 6,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  sectionDot: {
    width: 6,
    height: 22,
    backgroundColor: '#4F46E5',
    borderRadius: 3,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#111827',
  },
  inputCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    paddingHorizontal: 14,
    height: 60,
    marginBottom: 14,
  },
  inputIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#111827',
  },
  assuranceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ECFDF5',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 20,
  },
  assuranceText: {
    flex: 1,
    fontSize: 12,
    color: '#047857',
    fontWeight: '600',
    textAlign: 'right',
  },
  errorBox: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  errorText: {
    color: '#DC2626',
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '600',
  },
  primaryButton: {
    width: '100%',
    height: 56,
    backgroundColor: '#4F46E5',
    borderRadius: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#4F46E5',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  secondaryButton: {
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  secondaryButtonText: {
    fontSize: 14,
    color: '#6366F1',
    fontWeight: '600',
  },
  successEmailBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#EEF2FF',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 18,
  },
  successEmailText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'right',
  },
  tipsBox: {
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
    gap: 10,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  tipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 8,
  },
  tipText: {
    flex: 1,
    fontSize: 13,
    color: '#374151',
    lineHeight: 20,
    textAlign: 'right',
  },
});
