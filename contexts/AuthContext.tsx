import React, { createContext, useContext, useState, useEffect } from 'react';
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
  login: (email: string, password: string) => Promise<AuthResult>;
  register: (fullName: string, email: string, password: string) => Promise<RegisterResult>;
  signInWithGoogle: () => Promise<AuthResult>;
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

// رابط العودة الموحّد لتأكيد الإيميل وتسجيل الدخول عبر Google
const getRedirectUrl = () => Linking.createURL('auth-callback');

const normalizeOtpCode = (value: string) => {
  return value
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/\D/g, '')
    .trim()
    .slice(0, 6);
};

const EMAIL_OTP_TYPES = ['email', 'signup'] as const;

// ترجمة رسائل أخطاء Supabase Auth إلى العربية
function translateAuthError(message?: string): string {
  const msg = (message || '').toLowerCase();

  if (msg.includes('invalid login credentials')) {
    return 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
  }

  if (msg.includes('email not confirmed')) {
    return 'يجب تأكيد بريدك الإلكتروني أولاً. تحقّق من صندوق الوارد';
  }

  if (msg.includes('user already registered') || msg.includes('already been registered')) {
    return 'هذا البريد الإلكتروني مسجّل بالفعل';
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

      if (data) {
        return {
          userId: data.id,
          email: data.email || authUser.email || '',
          userName: data.email || data.user_name || authUser.email || '',
          role: data.role || 'user',
          fullName: data.full_name || fallbackName,
          accountNumber: data.account_number || '',
        };
      }

      // احتياط: إنشاء الملف إذا لم يُنشئه الـ trigger لأي سبب.
      // user_name إلزامي لأن دوال RPC القديمة تبحث عن المستخدم عبره (نستخدم البريد).
      const { data: created } = await supabase
        .from('app_security')
        .upsert(
          {
            id: authUser.id,
            email: authUser.email,
            user_name: authUser.email,
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
          userName: created.email || created.user_name || authUser.email || '',
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

  // معالجة روابط العودة (تأكيد الإيميل / Google / استعادة كلمة المرور)
  const handleDeepLink = async (url: string) => {
    try {
      if (!url) return;

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
        return;
      }

      if (params.access_token && params.refresh_token) {
        await supabase.auth.setSession({
          access_token: params.access_token,
          refresh_token: params.refresh_token,
        });
        return;
      }

      if (params.code) {
        await supabase.auth.exchangeCodeForSession(params.code);
        return;
      }

      if (params.token_hash && params.type) {
        await supabase.auth.verifyOtp({
          token_hash: params.token_hash,
          type: params.type as any,
        });
      }
    } catch (error) {
      console.error('[Auth] handleDeepLink error:', error);
    }
  };

  useEffect(() => {
    let mounted = true;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      // تأجيل أي استدعاء آخر لـ supabase خارج هذا الـ callback (توصية رسمية)
      setTimeout(async () => {
        if (!mounted) return;

        if (session?.user) {
          const profile = await loadProfile(session.user);
          if (!mounted) return;

          if (profile) {
            setCurrentUser(profile);
            setIsAuthenticated(true);
          } else {
            setCurrentUser(null);
            setIsAuthenticated(false);
          }
        } else {
          setCurrentUser(null);
          setIsAuthenticated(false);
        }

        if (mounted) setIsLoading(false);
      }, 0);
    });

    // التقاط رابط العودة (التطبيق مفتوح أو يُفتح من رابط)
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

  const login = async (email: string, password: string): Promise<AuthResult> => {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) {
        return { success: false, error: translateAuthError(error.message) };
      }

      // onAuthStateChange سيتكفّل بتعيين currentUser
      return { success: true };
    } catch (error) {
      console.error('[Auth] login error:', error);
      return { success: false, error: 'حدث خطأ أثناء تسجيل الدخول' };
    }
  };

  const register = async (
    fullName: string,
    email: string,
    password: string
  ): Promise<RegisterResult> => {
    try {
      if (!fullName || fullName.trim().length < 2) {
        return { success: false, error: 'الاسم الكامل يجب أن يكون حرفين على الأقل' };
      }

      if (!email || !email.includes('@')) {
        return { success: false, error: 'يرجى إدخال بريد إلكتروني صحيح' };
      }

      if (!password || password.length < 6) {
        return { success: false, error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' };
      }

      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: { full_name: fullName.trim() },
          emailRedirectTo: getRedirectUrl(),
        },
      });

      if (error) {
        return { success: false, error: translateAuthError(error.message) };
      }

      // عند تفعيل تأكيد الإيميل: إذا كان البريد مسجّلاً مسبقاً يرجع Supabase
      // مستخدماً بدون identities لأسباب أمنية.
      if (data.user && data.user.identities && data.user.identities.length === 0) {
        return { success: false, error: 'هذا البريد الإلكتروني مسجّل بالفعل' };
      }

      // تأكيد الإيميل مُفعّل: لا توجد جلسة حتى يؤكّد المستخدم بريده
      if (data.user && !data.session) {
        return { success: true, needsEmailConfirmation: true };
      }

      return { success: true, needsEmailConfirmation: false };
    } catch (error) {
      console.error('[Auth] register error:', error);
      return { success: false, error: 'حدث خطأ أثناء إنشاء الحساب' };
    }
  };

  const signInWithGoogle = async (): Promise<AuthResult> => {
    try {
      const redirectTo = getRedirectUrl();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true },
      });

      if (error || !data?.url) {
        return { success: false, error: 'تعذّر بدء تسجيل الدخول عبر Google' };
      }

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

      if (result.type === 'success' && result.url) {
        await handleDeepLink(result.url);
        return { success: true };
      }

      if (result.type === 'cancel' || result.type === 'dismiss') {
        return { success: false, error: 'تم إلغاء تسجيل الدخول' };
      }

      return { success: false, error: 'تعذّر إكمال تسجيل الدخول عبر Google' };
    } catch (error) {
      console.error('[Auth] Google sign-in error:', error);
      return { success: false, error: 'حدث خطأ أثناء تسجيل الدخول عبر Google' };
    }
  };

  const verifyEmailOtp = async (email: string, token: string): Promise<AuthResult> => {
    try {
      const cleanEmail = email.trim().toLowerCase();
      const code = normalizeOtpCode(token);

      if (code.length !== 6) {
        return { success: false, error: 'رمز التأكيد يجب أن يكون 6 أرقام' };
      }

      let lastErrorMessage = '';

      for (const type of EMAIL_OTP_TYPES) {
        const { data, error } = await supabase.auth.verifyOtp({
          email: cleanEmail,
          token: code,
          type,
          options: { redirectTo: getRedirectUrl() },
        });

        if (!error) {
          const authUser = data.user;

          if (authUser) {
            const profile = await loadProfile(authUser);
            if (profile) {
              setCurrentUser(profile);
              setIsAuthenticated(true);
            }
          }

          return { success: true };
        }

        lastErrorMessage = error.message || '';
        console.warn(`[Auth] verifyOtp failed with type ${type}:`, lastErrorMessage);
      }

      const normalizedError = lastErrorMessage.toLowerCase();
      if (normalizedError.includes('expired')) {
        return { success: false, error: 'انتهت صلاحية الرمز. اطلب رمزاً جديداً واستخدم آخر رمز وصلك.' };
      }
      if (normalizedError.includes('invalid') || normalizedError.includes('token')) {
        return {
          success: false,
          error:
            'الرمز غير صحيح أو تم استخدامه أو انتهت صلاحيته. اطلب رمزاً جديداً واستخدم آخر رمز وصلك.',
        };
      }

      return { success: false, error: translateAuthError(lastErrorMessage) };
    } catch (error) {
      console.error('[Auth] verifyEmailOtp error:', error);
      return { success: false, error: 'حدث خطأ أثناء التحقق من الرمز' };
    }
  };

  const resendEmailOtp = async (email: string): Promise<AuthResult> => {
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim().toLowerCase(),
        options: { emailRedirectTo: getRedirectUrl() },
      });

      if (error) {
        return { success: false, error: translateAuthError(error.message) };
      }

      return { success: true };
    } catch (error) {
      console.error('[Auth] resendEmailOtp error:', error);
      return { success: false, error: 'تعذّر إعادة إرسال الرمز' };
    }
  };

  const resetPassword = async (email: string): Promise<AuthResult> => {
    try {
      if (!email || !email.includes('@')) {
        return { success: false, error: 'يرجى إدخال بريد إلكتروني صحيح' };
      }

      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: getRedirectUrl(),
      });

      if (error) {
        return { success: false, error: translateAuthError(error.message) };
      }

      return { success: true };
    } catch (error) {
      console.error('[Auth] resetPassword error:', error);
      return { success: false, error: 'حدث خطأ أثناء إرسال رابط الاستعادة' };
    }
  };

  const refreshCurrentUser = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setCurrentUser(null);
        setIsAuthenticated(false);
        return;
      }

      const profile = await loadProfile(user);
      if (profile) {
        setCurrentUser(profile);
        setIsAuthenticated(true);
      }
    } catch (error) {
      console.error('[Auth] refreshCurrentUser error:', error);
    }
  };

  const logout = async () => {
    try {
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
      register: async (_fullName: string, _email: string, _password: string) => ({
        success: false,
        error: 'Initializing...',
      }),
      signInWithGoogle: async () => ({ success: false, error: 'Initializing...' }),
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
