import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { useAuth } from '@/contexts/AuthContext';

/**
 * شاشة وسيطة تستقبل رابط العودة (akked://auth-callback) بعد تسجيل الدخول عبر Google
 * أو استعادة كلمة المرور. AuthContext يتكفّل بتبادل الرمز وتحديث الجلسة،
 * وهذه الشاشة تنتظر استقرار حالة المصادقة ثم تنقل المستخدم.
 */
export default function AuthCallbackScreen() {
  const router = useRouter();
  const callbackUrl = Linking.useURL();
  const { isAuthenticated, isLoading, completeAuthFromUrl } = useAuth();
  const [timedOut, setTimedOut] = useState(false);
  const [error, setError] = useState('');
  const [handledUrl, setHandledUrl] = useState<string | null>(null);

  const isRecoveryUrl = (url: string) =>
    url.includes('type=recovery') ||
    url.includes('type%3Drecovery') ||
    url.includes('recovery');

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), 15000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const handleUrl = async () => {
      const url = callbackUrl || (await Linking.getInitialURL());
      if (!url || url === handledUrl) return;

      setHandledUrl(url);
      setError('');

      const result = await completeAuthFromUrl(url);
      if (cancelled) return;

      if (result.success) {
        router.replace(isRecoveryUrl(url) ? '/(auth)/reset-password' : '/(tabs)');
      } else if (result.error) {
        setError(result.error);
      }
    };

    handleUrl();

    return () => {
      cancelled = true;
    };
  }, [callbackUrl, handledUrl]);

  useEffect(() => {
    if (isLoading) return;

    if (isAuthenticated) {
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, isLoading, timedOut]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#4F46E5" />
      <Text style={styles.text}>جارٍ إكمال تسجيل الدخول...</Text>
      {error || timedOut ? (
        <Text style={styles.errorText}>
          {error || 'لم يصل رابط جلسة Google إلى التطبيق. تأكد من رابط الرجوع في Supabase.'}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  text: {
    fontSize: 16,
    color: '#6B7280',
  },
  errorText: {
    maxWidth: 300,
    fontSize: 13,
    color: '#DC2626',
    lineHeight: 20,
    textAlign: 'center',
  },
});
