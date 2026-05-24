import '@/utils/arabicRTL';
import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { DataRefreshProvider } from '@/contexts/DataRefreshContext';
import { setupArabicRTL } from '@/utils/rtl';
import { DailyStartupAd } from '@/components/DailyStartupAd';
import { useSystemNotifications } from '@/hooks/useSystemNotifications';

setupArabicRTL();

function RootLayoutNav() {
  const { currentUser, isAuthenticated, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useSystemNotifications(currentUser);

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';
    const authRoute = segments[1];
    const inRecoveryFlow = authRoute === 'auth-callback' || authRoute === 'reset-password';

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup && !inRecoveryFlow) {
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, isLoading, segments]);

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="pin-settings" />
        <Stack.Screen name="add-customer" />
        <Stack.Screen name="customer-details" />
        <Stack.Screen name="customer-notifications" />
        <Stack.Screen name="new-transaction" />
        <Stack.Screen name="transaction-details" />
        <Stack.Screen name="new-movement" />
        <Stack.Screen name="edit-movement" />
        <Stack.Screen name="movement-details" />
        <Stack.Screen name="receipt-preview" />
        <Stack.Screen name="debt-summary" />
        <Stack.Screen name="shop-settings" />
        <Stack.Screen name="exchange-rates" />
        <Stack.Screen name="calculator" />
        <Stack.Screen name="statistics" />
        <Stack.Screen name="ai-assistant" />
        <Stack.Screen name="backup" />
        <Stack.Screen name="reports" />
        <Stack.Screen name="+not-found" />
      </Stack>
      <DailyStartupAd enabled={isAuthenticated && !isLoading} />
    </>
  );
}

export default function RootLayout() {
  useFrameworkReady();

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <DataRefreshProvider>
          <SafeAreaView style={styles.safeArea} edges={['top']}>
            <View style={styles.rtlRoot}>
              <RootLayoutNav />
            </View>
            <StatusBar style="auto" />
          </SafeAreaView>
        </DataRefreshProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    direction: 'rtl',
  },
  rtlRoot: {
    flex: 1,
    direction: 'rtl',
  },
});
