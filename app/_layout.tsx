import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { I18nManager, View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { DataRefreshProvider } from '@/contexts/DataRefreshContext';

// ⚠️ مهم: لا تستدعي forceRTL في كل re-render.
// نستدعيها مرة واحدة فقط، وفقط إذا لم تكن RTL مفعّلة بالفعل.
// استدعاؤها كل مرة في Expo Go على Android يسبب reload-loop.
if (!I18nManager.isRTL) {
  I18nManager.allowRTL(true);
  // forceRTL على iOS يحتاج إعادة تشغيل، لذلك نتجنب حلقة لا نهائية.
  try {
    I18nManager.forceRTL(true);
  } catch {}
}

function RootLayoutNav() {
  const { isAuthenticated, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const [navReady, setNavReady] = useState(false);

  // انتظار جاهزية المسارات قبل أي router.replace لتجنب
  // "Attempted to navigate before mounting the Root Layout component"
  useEffect(() => {
    setNavReady(true);
  }, []);

  useEffect(() => {
    if (!navReady || isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, isLoading, segments, navReady]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="pin-entry" />
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
      <Stack.Screen name="debts" />
      <Stack.Screen name="statistics" />
      <Stack.Screen name="ai-assistant" />
      <Stack.Screen name="backup" />
      <Stack.Screen name="reports" />
      <Stack.Screen name="notification-detail" />
      <Stack.Screen name="+not-found" />
    </Stack>
  );
}

export default function RootLayout() {
  useFrameworkReady();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <DataRefreshProvider>
            <SafeAreaView style={{ flex: 1 }} edges={['top']}>
              <RootLayoutNav />
              <StatusBar style="auto" />
            </SafeAreaView>
          </DataRefreshProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
