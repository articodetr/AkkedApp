import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { AppSettings } from '@/types/database';

// مطلوب لإكمال جلسة المصادقة على الويب بعد العودة من المتصفح
WebBrowser.maybeCompleteAuthSession();

export interface CurrentUser {
  userName: string;
  email: string;
  role: string;
  userId: string;
  fullName: string;
  accountNumber: string;
}

type AuthResult = { success: boolean; error?: string };
type RegisterResult = { success: boolean; needsEmailConfirmation?: boolean; error?: string };

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  currentUser: CurrentUser | null;
  login: (userNameOrEmail: string, password: string) => Promise<AuthResult>;
  register: (
    fullName: string,
    userName: string,
    email: string,
    password: string
  ) => Promise<RegisterResult>;
  signInWithGoogle: () => Promise<AuthResult>;
  completeAuthFromUrl: (url: string) => Promise<AuthResult>;
  verifyEmailOtp: (email: string, token: string) => Promise<AuthResult>;
  resendEmailOtp: (email: string) => Promise<AuthResult>;
  resetPassword: (email: string) => Promise<AuthResult>;
  logout: () => Promise<void>;
  refreshCurrentUser: () => Promise<void>;
  settings: AppSettings | null;
  refreshSettings: () => Promise<void>;
  updateSettings: (settings: Partial<AppSettings>) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const CUSTOM_AUTH_USER_ID_KEY = 'akked.customAuth.userId';

// رابط العودة الموحّد لتسجيل الدخول عبر Google واستعادة كلمة المرور
const getRedirectUrl = () => Linking.createURL('auth-callback');

const isEmailAddress = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const normalizeUserName = (value: string) => value.trim().replace(/\s+/g, '').toLowerCase();

const isValidUserName = (value: string) =>
  /^[A-Za-z0-9_.\-\u0621-\u064A\u0660-\u0669\u06F0-\u06F9]+$/.test(value);

type AppSecurityProfile = {
  id: string;
  user_name: string | null;
  role: string | null;
  full_name: string | null;
  account_number: string | null;
  email: string | null;
};

const profileToCurrentUser = (profile: AppSecurityProfile): CurrentUser => ({
  userId: profile.id,
  email: profile.email || '',
  userName: profile.user_name || profile.email || profile.id,
  role: profile.role || 'user',
  fullName: profile.full_name || profile.user_name || 'مستخدم',
  accountNumber: profile.account_number || '',
});

const normalizeOtpCode = (value: string) => {
  return value
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/\D/g, '')
    .trim()
    .slice(0, 6);
};

// ترجمة رسائل أخطاء Supabase Auth إلى العربية
function translateAuthError(message?: string): string {
  const msg = (message || '').toLowerCase();

  if (msg.includes('invalid login credentials')) {
    return 'اسم المستخدم أو كلمة المرور غير صحيحة';
  }

  if (msg.includes('email not confirmed')) {
    return 'تأكيد البريد ما زال مفعّلاً في Supabase. عطّل خيار Confirm email من إعدادات المصادقة ثم حاول التسجيل مرة أخرى';
  }

  if (msg.includes('user already registered') || msg.includes('already been registered')) {
    return 'هذا البريد الإلكتروني مسجّل بالفعل';
  }

  if (msg.includes('user_name_or_email_exists')) {
    return 'اسم المستخدم أو البريد مستخدم بالفعل';
  }

  if (msg.includes('full_name_too_short')) {
    return 'الاسم الكامل يجب أن يكون حرفين على الأقل';
  }

  if (msg.includes('user_name_too_short')) {
    return 'اسم المستخدم يجب أن يكون 3 أحرف على الأقل';
  }

  if (msg.includes('invalid_email')) {
    return 'يرجى إدخال بريد إلكتروني صحيح';
  }

  if (msg.includes('password_too_short')) {
    return 'كلمة المرور يجب أن تكون 6 أحرف على الأقل';
  }

  if (
    msg.includes('duplicate key') ||
    msg.includes('unique constraint') ||
    msg.includes('database error saving new user')
  ) {
    return 'اسم المستخدم أو البريد مستخدم بالفعل';
  }

  if (msg.includes('password should be at least')) {
    return 'كلمة المرور يجب أن تكون 6 أحرف على الأقل';
  }

  if (msg.includes('unable to validate email') || msg.includes('invalid email')) {
    return 'صيغة البريد الإلكتروني غير صحيحة';
  }

  if (msg.includes('rate limit') || msg.includes('too many requests')) {
    return 'محاولات كثيرة جداً. يرجى المحاولة بعد قليل';
  }

  if (msg.includes('network')) {
    return 'تعذّر الاتصال بالخادم. تحقّق من اتصالك بالإنترنت';
  }

  return message || 'حدث خطأ غير متوقّع';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);

  const buildDefaultSettings = (): AppSettings => ({
    id: '',
    shop_name: 'Akked',
    shop_phone: '',
    shop_address: '',
    header_layout: 'centered',
    header_primary_color: '#4F46E5',
    shop_name_en: 'Akked',
    shop_phone_en: '',
    shop_address_en: '',
    selected_receipt_logo: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const loadSettings = async (userId?: string) => {
    try {
      if (!userId) {
        setSettings(buildDefaultSettings());
        return;
      }

      const { data, error } = await supabase.rpc('get_or_create_user_settings', {
        p_user_id: userId,
      });

      if (!error && data) {
        setSettings(data);
        return;
      }

      console.error('Error loading user settings:', error);
      setSettings(buildDefaultSettings());
    } catch (error) {
      console.error('Error loading settings:', error);
      setSettings(buildDefaultSettings());
    }
  };

  const loadProfileById = async (userId: string): Promise<CurrentUser | null> => {
    try {
      const { data, error } = await supabase
        .from('app_security')
        .select('id, user_name, role, full_name, account_number, email')
        .eq('id', userId)
        .maybeSingle();

      if (error || !data) {
        if (error) console.error('[Auth] loadProfileById error:', error);
        return null;
      }

      return profileToCurrentUser(data as AppSecurityProfile);
    } catch (error) {
      console.error('[Auth] loadProfileById exception:', error);
      return null;
    }
  };

  const loadStoredCustomSession = async (): Promise<CurrentUser | null> => {
    try {
      const storedUserId = await AsyncStorage.getItem(CUSTOM_AUTH_USER_ID_KEY);
      if (!storedUserId) return null;

      const profile = await loadProfileById(storedUserId);
      if (!profile) {
        await AsyncStorage.removeItem(CUSTOM_AUTH_USER_ID_KEY);
      }

      return profile;
    } catch (error) {
      console.error('[Auth] loadStoredCustomSession error:', error);
      return null;
    }
  };

  // تحميل ملف تعريف المستخدم من app_security (يُنشأ تلقائياً عبر trigger)
  const loadProfile = async (authUser: User): Promise<CurrentUser | null> => {
    try {
      const { data } = await supabase
        .from('app_security')
        .select('id, user_name, role, full_name, account_number, email')
        .eq('id', authUser.id)
        .maybeSingle();

      const meta = authUser.user_metadata || {};
      const fallbackName =
        (meta.full_name as string) ||
        (meta.name as string) ||
        (authUser.email ? authUser.email.split('@')[0] : '') ||
        'مستخدم';
      const fallbackUserName =
        normalizeUserName((meta.user_name as string) || (meta.username as string) || '') ||
        (authUser.email ? authUser.email.split('@')[0] : '') ||
        authUser.id;

      if (data) {
        return {
          userId: data.id,
          email: data.email || authUser.email || '',
          userName: data.user_name || fallbackUserName,
          role: data.role || 'user',
          fullName: data.full_name || fallbackName,
          accountNumber: data.account_number || '',
        };
      }

      // احتياط: إنشاء الملف إذا لم يُنشئه الـ trigger لأي سبب.
      // user_name إلزامي لأن دوال RPC القديمة تبحث عن المستخدم عبره.
      const { data: created } = await supabase
        .from('app_security')
        .upsert(
          {
            id: authUser.id,
            email: authUser.email,
            user_name: fallbackUserName,
            full_name: fallbackName,
            role: 'user',
            is_active: true,
            auth_provider: (authUser.app_metadata?.provider as string) || 'email',
          },
          { onConflict: 'id' }
        )
        .select('id, user_name, role, full_name, account_number, email')
        .maybeSingle();

      if (created) {
        return {
          userId: created.id,
          email: created.email || authUser.email || '',
          userName: created.user_name || fallbackUserName,
          role: created.role || 'user',
          fullName: created.full_name || fallbackName,
          accountNumber: created.account_number || '',
        };
      }

      return null;
    } catch (error) {
      console.error('[Auth] loadProfile error:', error);
      return null;
    }
  };

  // معالجة روابط العودة (Google / استعادة كلمة المرور)
  const handleDeepLink = async (url: string): Promise<AuthResult> => {
    try {
      if (!url) return { success: false, error: 'رابط العودة غير صالح' };

      const params: Record<string, string> = {};
      const parsed = Linking.parse(url);

      Object.entries(parsed.queryParams || {}).forEach(([k, v]) => {
        if (typeof v === 'string') params[k] = v;
      });

      // بعض المزوّدين يضعون القيم في جزء الـ fragment (#...)
      const hashIndex = url.indexOf('#');
      if (hashIndex !== -1) {
        url
          .substring(hashIndex + 1)
          .split('&')
          .forEach((kv) => {
            const [k, v] = kv.split('=');
            if (k && v) params[k] = decodeURIComponent(v);
          });
      }

      if (params.error) {
        console.warn('[Auth] deep link error:', params.error_description || params.error);
        return {
          success: false,
          error: params.error_description || 'تعذّر إكمال تسجيل الدخول',
        };
      }

      if (params.access_token && params.refresh_token) {
        const { error } = await supabase.auth.setSession({
          access_token: params.access_token,
          refresh_token: params.refresh_token,
        });
        return error
          ? { success: false, error: translateAuthError(error.message) }
          : { success: true };
      }

      if (params.code) {
        const { error } = await supabase.auth.exchangeCodeForSession(params.code);
        return error
          ? { success: false, error: translateAuthError(error.message) }
          : { success: true };
      }

      if (params.token_hash && params.type) {
        const { error } = await supabase.auth.verifyOtp({
          token_hash: params.token_hash,
          type: params.type as any,
        });
        return error
          ? { success: false, error: translateAuthError(error.message) }
          : { success: true };
      }

      return { success: false, error: 'تعذّر قراءة رابط العودة' };
    } catch (error) {
      console.error('[Auth] handleDeepLink error:', error);
      return { success: false, error: 'حدث خطأ أثناء إكمال تسجيل الدخول' };
    }
  };

  useEffect(() => {
    let mounted = true;

    const applySessionState = async (authUser?: User | null) => {
      if (authUser) {
        const profile = await loadProfile(authUser);
        if (!mounted) return;

        setCurrentUser(profile);
        setIsAuthenticated(Boolean(profile));
        return;
      }

      const customProfile = await loadStoredCustomSession();
      if (!mounted) return;

      setCurrentUser(customProfile);
      setIsAuthenticated(Boolean(customProfile));
    };

    const initSession = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        await applySessionState(session?.user ?? null);
      } catch (error) {
        console.error('[Auth] initSession error:', error);
        await applySessionState(null);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    initSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setTimeout(async () => {
        if (!mounted) return;
        await applySessionState(session?.user ?? null);
        if (mounted) setIsLoading(false);
      }, 0);
    });

    const linkSub = Linking.addEventListener('url', ({ url }) => {
      handleDeepLink(url);
    });

    Linking.getInitialURL().then((url) => {
      if (url) handleDeepLink(url);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
      linkSub.remove();
    };
  }, []);

  // تحميل/تفريغ الإعدادات حسب المستخدم الحالي
  useEffect(() => {
    if (currentUser?.userId) {
      loadSettings(currentUser.userId);
    } else {
      setSettings(buildDefaultSettings());
    }
  }, [currentUser?.userId]);

  const resolveEmailForLogin = async (userNameOrEmail: string): Promise<string | null> => {
    const cleanLogin = userNameOrEmail.trim();

    if (!cleanLogin) return null;
    if (isEmailAddress(cleanLogin)) return cleanLogin.toLowerCase();

    const normalizedUserName = normalizeUserName(cleanLogin);

    try {
      const { data: loginEmail, error: rpcError } = await supabase.rpc('get_login_email', {
        p_login: normalizedUserName,
      });

      if (!rpcError && typeof loginEmail === 'string' && loginEmail) {
        return loginEmail.trim().toLowerCase();
      }
    } catch (error) {
      console.warn('[Auth] get_login_email fallback:', error);
    }

    const candidates = Array.from(new Set([cleanLogin, normalizedUserName])).filter(Boolean);
    const { data, error } = await supabase
      .from('app_security')
      .select('email')
      .in('user_name', candidates)
      .limit(1)
      .maybeSingle();

    if (error || !data?.email) {
      return null;
    }

    return data.email.trim().toLowerCase();
  };

  const isUserNameTaken = async (userName: string): Promise<boolean> => {
    const candidates = Array.from(new Set([userName, normalizeUserName(userName)])).filter(Boolean);

    try {
      const { data: loginEmail, error: rpcError } = await supabase.rpc('get_login_email', {
        p_login: normalizeUserName(userName),
      });

      if (!rpcError && typeof loginEmail === 'string' && loginEmail) {
        return true;
      }
    } catch (error) {
      console.warn('[Auth] username RPC availability check skipped:', error);
    }

    const { data, error } = await supabase
      .from('app_security')
      .select('id')
      .in('user_name', candidates)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn('[Auth] username availability check skipped:', error);
      return false;
    }

    return Boolean(data?.id);
  };

  const login = async (userNameOrEmail: string, password: string): Promise<AuthResult> => {
    try {
      const { data, error } = await supabase.rpc('login_app_user', {
        p_login: userNameOrEmail.trim(),
        p_password: password,
      });

      if (error) {
        console.error('[Auth] custom login RPC error:', error);
        return {
          success: false,
          error: error.message?.includes('login_app_user')
            ? 'تحديثات قاعدة البيانات غير مطبقة. طبّق migration ثم حاول مرة أخرى'
            : translateAuthError(error.message),
        };
      }

      const profileRow = Array.isArray(data) ? data[0] : data;
      if (!profileRow?.id) {
        return { success: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
      }

      const profile = profileToCurrentUser(profileRow as AppSecurityProfile);
      await AsyncStorage.setItem(CUSTOM_AUTH_USER_ID_KEY, profile.userId);
      setCurrentUser(profile);
      setIsAuthenticated(true);

      return { success: true };
    } catch (error) {
      console.error('[Auth] login error:', error);
      return { success: false, error: 'حدث خطأ أثناء تسجيل الدخول' };
    }
  };

  const register = async (
    fullName: string,
    userName: string,
    email: string,
    password: string
  ): Promise<RegisterResult> => {
    try {
      const cleanFullName = fullName.trim();
      const cleanUserName = normalizeUserName(userName);
      const cleanEmail = email.trim().toLowerCase();

      if (!fullName || fullName.trim().length < 2) {
        return { success: false, error: 'الاسم الكامل يجب أن يكون حرفين على الأقل' };
      }

      if (cleanUserName.length < 3) {
        return { success: false, error: 'اسم المستخدم يجب أن يكون 3 أحرف على الأقل' };
      }

      if (!isValidUserName(cleanUserName)) {
        return { success: false, error: 'اسم المستخدم يقبل الحروف والأرقام والرموز . _ - فقط' };
      }

      if (!isEmailAddress(cleanEmail)) {
        return { success: false, error: 'يرجى إدخال بريد إلكتروني صحيح' };
      }

      if (!password || password.length < 6) {
        return { success: false, error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' };
      }

      const { data, error } = await supabase.rpc('register_app_user', {
        p_full_name: cleanFullName,
        p_user_name: cleanUserName,
        p_email: cleanEmail,
        p_password: password,
      });

      if (error) {
        console.error('[Auth] custom register RPC error:', error);
        return {
          success: false,
          error:
            error.message?.includes('register_app_user')
              ? 'تحديثات قاعدة البيانات غير مطبقة. طبّق migration ثم حاول مرة أخرى'
              : translateAuthError(error.message),
        };
      }

      const profileRow = Array.isArray(data) ? data[0] : data;
      if (!profileRow?.id) {
        return { success: false, error: 'تعذّر إنشاء الحساب' };
      }

      const profile = profileToCurrentUser(profileRow as AppSecurityProfile);
      await AsyncStorage.setItem(CUSTOM_AUTH_USER_ID_KEY, profile.userId);
      setCurrentUser(profile);
      setIsAuthenticated(true);

      return { success: true, needsEmailConfirmation: false };
    } catch (error) {
      console.error('[Auth] register error:', error);
      return { success: false, error: 'حدث خطأ أثناء إنشاء الحساب' };
    }
  };

  const signInWithGoogle = async (): Promise<AuthResult> => {
    return { success: false, error: 'تسجيل الدخول عبر Google معطّل' };
  };

  const completeAuthFromUrl = async (url: string): Promise<AuthResult> => {
    return await handleDeepLink(url);
  };

  const verifyEmailOtp = async (email: string, token: string): Promise<AuthResult> => {
    try {
      const cleanEmail = email.trim().toLowerCase();
      const code = normalizeOtpCode(token);

      if (code.length !== 6) {
        return { success: false, error: 'رمز التأكيد يجب أن يكون 6 أرقام' };
      }

      console.log('[Auth] verifyEmailOtp email:', cleanEmail);
      console.log('[Auth] verifyEmailOtp code:', code);

      // الطريقة الأحدث للتحقق من كود الإيميل
      let result = await supabase.auth.verifyOtp({
        email: cleanEmail,
        token: code,
        type: 'email',
      });

      // احتياط لبعض مشاريع Supabase القديمة التي ما زالت تستخدم signup لتأكيد التسجيل
      if (result.error) {
        console.log('[Auth] verifyOtp email type error:', result.error);

        result = await supabase.auth.verifyOtp({
          email: cleanEmail,
          token: code,
          type: 'signup' as any,
        });
      }

      if (result.error) {
        console.log('[Auth] verifyOtp final error:', result.error);

        return {
          success: false,
          error:
            'الرمز غير صحيح أو تم استخدامه أو انتهت صلاحيته. اطلب رمزاً جديداً واستخدم آخر رمز وصلك.',
        };
      }

      // onAuthStateChange سيتكفّل بتعيين currentUser بعد نجاح التحقق
      return { success: true };
    } catch (error) {
      console.error('[Auth] verifyEmailOtp error:', error);
      return { success: false, error: 'حدث خطأ أثناء التحقق من الرمز' };
    }
  };

  const resendEmailOtp = async (email: string): Promise<AuthResult> => {
    return { success: false, error: 'تم تعطيل رسائل البريد الإلكتروني في التطبيق' };
  };

  const resetPassword = async (email: string): Promise<AuthResult> => {
    return {
      success: false,
      error: 'تم تعطيل إرسال رسائل البريد الإلكتروني. تواصل مع المدير لتغيير كلمة المرور',
    };
  };

  const refreshCurrentUser = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const profile = user ? await loadProfile(user) : await loadStoredCustomSession();
      if (profile) {
        setCurrentUser(profile);
        setIsAuthenticated(true);
      } else {
        setCurrentUser(null);
        setIsAuthenticated(false);
      }
    } catch (error) {
      console.error('[Auth] refreshCurrentUser error:', error);
    }
  };

  const logout = async () => {
    try {
      await AsyncStorage.removeItem(CUSTOM_AUTH_USER_ID_KEY);
      await supabase.auth.signOut();
      setIsAuthenticated(false);
      setCurrentUser(null);
    } catch (error) {
      console.error('[Auth] logout error:', error);
    }
  };

  const refreshSettings = async () => {
    await loadSettings(currentUser?.userId);
  };

  const updateSettings = async (newSettings: Partial<AppSettings>): Promise<boolean> => {
    try {
      if ((newSettings as any).shop_logo !== undefined && currentUser?.role !== 'admin') {
        console.error('[AuthContext] Non-admin user attempted to update shop logo');
        return false;
      }

      const activeUserId = currentUser?.userId;
      if (!activeUserId) {
        console.error('[AuthContext] updateSettings called without an active user');
        return false;
      }

      const { error: upsertError } = await supabase
        .from('app_settings')
        .upsert(
          {
            user_id: activeUserId,
            ...newSettings,
          },
          { onConflict: 'user_id', ignoreDuplicates: false }
        )
        .select();

      if (upsertError) {
        console.error('[AuthContext] Upsert error:', upsertError);
        throw upsertError;
      }

      await loadSettings(activeUserId);
      return true;
    } catch (error) {
      console.error('[AuthContext] Error updating settings:', error);
      return false;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isLoading,
        currentUser,
        login,
        register,
        signInWithGoogle,
        completeAuthFromUrl,
        verifyEmailOtp,
        resendEmailOtp,
        resetPassword,
        logout,
        refreshCurrentUser,
        settings,
        refreshSettings,
        updateSettings,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (context === undefined) {
    // قيم افتراضية أثناء التهيئة
    return {
      isAuthenticated: false,
      isLoading: true,
      currentUser: null,
      login: async (_email: string, _password: string) => ({
        success: false,
        error: 'Initializing...',
      }),
      register: async (
        _fullName: string,
        _userName: string,
        _email: string,
        _password: string
      ) => ({
        success: false,
        error: 'Initializing...',
      }),
      signInWithGoogle: async () => ({ success: false, error: 'Initializing...' }),
      completeAuthFromUrl: async (_url: string) => ({ success: false, error: 'Initializing...' }),
      verifyEmailOtp: async (_email: string, _token: string) => ({
        success: false,
        error: 'Initializing...',
      }),
      resendEmailOtp: async (_email: string) => ({ success: false, error: 'Initializing...' }),
      resetPassword: async (_email: string) => ({ success: false, error: 'Initializing...' }),
      logout: async () => {},
      refreshCurrentUser: async () => {},
      settings: null,
      refreshSettings: async () => {},
      updateSettings: async () => false,
    } as AuthContextType;
  }

  return context;
}
