import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { MailCheck, ArrowRight } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';

const CODE_LENGTH = 6;
const RESEND_COOLDOWN = 60;

export default function CheckEmailScreen() {
  const router = useRouter();
  const { email } = useLocalSearchParams<{ email?: string }>();
  const { verifyEmailOtp, resendEmailOtp } = useAuth();

  const inputRef = useRef<TextInput>(null);
  const [code, setCode] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN);

  // عدّاد إعادة الإرسال
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleVerify = async (value?: string) => {
    const finalCode = (value ?? code).replace(/\D/g, '');
    if (finalCode.length !== CODE_LENGTH) {
      setError('أدخل رمز التأكيد المكوّن من 6 أرقام');
      return;
    }
    if (!email) {
      setError('تعذّر تحديد البريد الإلكتروني. ارجع وأعد التسجيل');
      return;
    }

    setError('');
    setIsVerifying(true);
    const result = await verifyEmailOtp(email, finalCode);
    setIsVerifying(false);

    if (result.success) {
      router.replace('/(tabs)');
    } else {
      setError(result.error || 'رمز التأكيد غير صحيح');
      setCode('');
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || !email) return;

    setError('');
    setIsResending(true);
    const result = await resendEmailOtp(email);
    setIsResending(false);

    if (result.success) {
      setCooldown(RESEND_COOLDOWN);
      Alert.alert('تم الإرسال', 'أرسلنا رمز تأكيد جديداً إلى بريدك الإلكتروني');
    } else {
      setError(result.error || 'تعذّر إعادة إرسال الرمز');
    }
  };

  const handleChange = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    if (error) setError('');
    if (digits.length === CODE_LENGTH) {
      handleVerify(digits);
    }
  };

  const busy = isVerifying || isResending;

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backLink} onPress={() => router.back()} disabled={busy}>
        <ArrowRight size={22} color="#4F46E5" />
        <Text style={styles.backLinkText}>رجوع</Text>
      </TouchableOpacity>

      <View style={styles.body}>
        <View style={styles.iconContainer}>
          <MailCheck size={64} color="#10B981" />
        </View>

        <Text style={styles.title}>تأكيد بريدك الإلكتروني</Text>
        <Text style={styles.subtitle}>
          أدخل رمز التأكيد المكوّن من 6 أرقام المُرسَل إلى{'\n'}
          <Text style={styles.emailText}>{email || 'بريدك الإلكتروني'}</Text>
        </Text>

        {/* خانات إدخال الرمز */}
        <Pressable style={styles.otpRow} onPress={() => inputRef.current?.focus()}>
          {Array.from({ length: CODE_LENGTH }).map((_, i) => {
            const filled = i < code.length;
            const active = i === code.length;
            return (
              <View
                key={i}
                style={[styles.otpBox, filled && styles.otpBoxFilled, active && styles.otpBoxActive]}
              >
                <Text style={styles.otpDigit}>{code[i] || ''}</Text>
              </View>
            );
          })}
        </Pressable>

        <TextInput
          ref={inputRef}
          style={styles.hiddenInput}
          value={code}
          onChangeText={handleChange}
          keyboardType="number-pad"
          maxLength={CODE_LENGTH}
          autoFocus
          editable={!busy}
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
        />

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.button, busy && styles.buttonDisabled]}
          onPress={() => handleVerify()}
          disabled={busy}
          activeOpacity={0.85}
        >
          {isVerifying ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.buttonText}>تأكيد</Text>
          )}
        </TouchableOpacity>

        <View style={styles.resendRow}>
          <Text style={styles.resendText}>لم يصلك الرمز؟</Text>
          <TouchableOpacity onPress={handleResend} disabled={cooldown > 0 || busy}>
            <Text style={[styles.resendLink, (cooldown > 0 || busy) && styles.resendLinkDisabled]}>
              {isResending
                ? 'جارٍ الإرسال...'
                : cooldown > 0
                  ? `إعادة الإرسال (${cooldown})`
                  : 'إعادة الإرسال'}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.note}>
          تحقّق من مجلد الرسائل غير المرغوب فيها (Spam) إذا لم تجد الرسالة.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  backLinkText: {
    fontSize: 16,
    color: '#4F46E5',
    fontWeight: '600',
  },
  body: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 32,
  },
  iconContainer: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 10,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    color: '#6B7280',
    marginBottom: 28,
    textAlign: 'center',
    lineHeight: 23,
  },
  emailText: {
    color: '#111827',
    fontWeight: '700',
  },
  otpRow: {
    flexDirection: 'row',
    direction: 'ltr',
    gap: 10,
    marginBottom: 8,
  },
  otpBox: {
    width: 48,
    height: 58,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpBoxFilled: {
    borderColor: '#A5B4FC',
  },
  otpBoxActive: {
    borderColor: '#4F46E5',
  },
  otpDigit: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
  },
  hiddenInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  errorText: {
    color: '#DC2626',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 12,
  },
  button: {
    width: '100%',
    height: 58,
    backgroundColor: '#4F46E5',
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
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
  resendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 24,
  },
  resendText: {
    fontSize: 15,
    color: '#6B7280',
  },
  resendLink: {
    fontSize: 15,
    fontWeight: '700',
    color: '#4F46E5',
  },
  resendLinkDisabled: {
    color: '#9CA3AF',
  },
  note: {
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 20,
    lineHeight: 20,
  },
});
