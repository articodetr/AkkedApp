import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import * as ExpoCrypto from 'expo-crypto';
import { Platform } from 'react-native';

type ExtraConfig = Record<string, unknown>;
type DigestAlgorithm = string | { name?: string };

const normalizeDigestAlgorithm = (algorithm: DigestAlgorithm) => {
  const name = typeof algorithm === 'string' ? algorithm : algorithm.name || 'SHA-256';
  return name.toUpperCase().replace('SHA256', 'SHA-256');
};

const installCryptoPolyfill = () => {
  const crypto = ((globalThis as any).crypto ?? {}) as Crypto & {
    subtle?: {
      digest?: (algorithm: DigestAlgorithm, data: BufferSource) => Promise<ArrayBuffer>;
    };
  };

  if (!crypto.getRandomValues) {
    (crypto as any).getRandomValues = ExpoCrypto.getRandomValues;
  }

  if (!crypto.subtle?.digest) {
    (crypto as any).subtle = {
      ...(crypto.subtle ?? {}),
      digest: (algorithm: DigestAlgorithm, data: BufferSource) =>
        ExpoCrypto.digest(normalizeDigestAlgorithm(algorithm) as any, data),
    };
  }

  (globalThis as any).crypto = crypto;
};

installCryptoPolyfill();

const readString = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

const extra = ((Constants.expoConfig?.extra ??
  (Constants as any).manifest?.extra ??
  {}) as ExtraConfig);

const envSupabaseUrl = readString(process.env.EXPO_PUBLIC_SUPABASE_URL);
const envSupabaseAnonKey = readString(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
const extraSupabaseUrl = readString(extra.EXPO_PUBLIC_SUPABASE_URL);
const extraSupabaseAnonKey = readString(extra.EXPO_PUBLIC_SUPABASE_ANON_KEY);

const isValidSupabaseUrl = (value: string) =>
  /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(value);

const isValidSupabaseAnonKey = (value: string) => {
  const parts = value.split('.');
  return parts.length === 3 && value.length > 100;
};

const supabaseUrl = isValidSupabaseUrl(envSupabaseUrl)
  ? envSupabaseUrl
  : isValidSupabaseUrl(extraSupabaseUrl)
    ? extraSupabaseUrl
    : '';

const supabaseAnonKey = isValidSupabaseAnonKey(envSupabaseAnonKey)
  ? envSupabaseAnonKey
  : isValidSupabaseAnonKey(extraSupabaseAnonKey)
    ? extraSupabaseAnonKey
    : '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[supabase] إعدادات Supabase غير صحيحة. تأكد من EXPO_PUBLIC_SUPABASE_URL و EXPO_PUBLIC_SUPABASE_ANON_KEY، واستخدم anon key فقط وليس service_role key.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // على الويب نسمح باكتشاف الجلسة من رابط العودة، وعلى الموبايل
    // نتعامل مع رابط العودة يدوياً عبر expo-linking في AuthContext.
    detectSessionInUrl: Platform.OS === 'web',
    // Native deep links return the session tokens directly. Web callback routes
    // keep PKCE so the browser can exchange the returned authorization code.
    flowType: Platform.OS === 'web' ? 'pkce' : 'implicit',
  },
});
