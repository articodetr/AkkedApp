import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';

/**
 * شاشة وسيطة تستقبل رابط العودة (akked://auth-callback) بعد تأكيد الإيميل
 * أو تسجيل الدخول عبر Google. AuthContext يتكفّل بتبادل الرمز وتحديث الجلسة،
 * وهذه الشاشة تنتظر استقرار حالة المصادقة ثم تنقل المستخدم.
 */
export default function AuthCallbackScreen() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (isLoading) return;

    if (isAuthenticated) {
      router.replace('/(tabs)');
    } else if (timedOut) {
      router.replace('/(auth)/login');
    }
  }, [isAuthenticated, isLoading, timedOut]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#4F46E5" />
      <Text style={styles.text}>جارٍ إكمال تسجيل الدخول...</Text>
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
});
