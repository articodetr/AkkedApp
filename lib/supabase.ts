import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

type ExtraConfig = Record<string, unknown>;

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
    detectSessionInUrl: false,
  },
});
