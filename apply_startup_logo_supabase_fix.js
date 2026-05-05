const fs = require('fs');
const path = require('path');

const root = process.cwd();
const report = [];
const appJsonPath = path.join(root, 'app.json');
const supabasePath = path.join(root, 'lib', 'supabase.ts');
const assetsDir = path.join(root, 'assets', 'images');
const patchAssetsDir = path.join(__dirname, 'patch-assets');

const DEFAULT_SUPABASE_URL = 'https://hnaudgieczuzuduplhkp.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuYXVkZ2llY3p1enVkdXBsaGtwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MTE3OTYsImV4cCI6MjA5MDM4Nzc5Nn0.alA4zTeQLwEPcepUVrfyAPaneJNtNaN9QmQJrNJRqm8';

function isValidAnonKey(value) {
  return typeof value === 'string' && value.split('.').length === 3 && value.length > 100;
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  report.push(`تم نسخ: ${path.relative(root, dest)}`);
}

try {
  if (!fs.existsSync(appJsonPath)) {
    throw new Error('لم يتم العثور على app.json. ضع هذا الملف داخل جذر مشروع AkkedApp ثم شغله مرة أخرى.');
  }

  let appConfig = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  appConfig.expo = appConfig.expo || {};
  const expo = appConfig.expo;

  expo.name = 'أكِّد';
  expo.slug = 'akkedapp';
  expo.icon = './assets/images/icon.png';
  expo.splash = {
    ...(expo.splash || {}),
    image: './assets/images/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#FFFFFF',
  };

  expo.android = expo.android || {};
  expo.android.adaptiveIcon = {
    ...(expo.android.adaptiveIcon || {}),
    foregroundImage: './assets/images/icon.png',
    backgroundColor: '#FFFFFF',
  };

  expo.web = expo.web || {};
  expo.web.favicon = './assets/images/favicon.png';

  expo.extra = expo.extra || {};
  if (!expo.extra.EXPO_PUBLIC_SUPABASE_URL) {
    expo.extra.EXPO_PUBLIC_SUPABASE_URL = DEFAULT_SUPABASE_URL;
    report.push('تمت إضافة رابط Supabase داخل app.json.');
  }
  if (!isValidAnonKey(expo.extra.EXPO_PUBLIC_SUPABASE_ANON_KEY)) {
    expo.extra.EXPO_PUBLIC_SUPABASE_ANON_KEY = DEFAULT_SUPABASE_ANON_KEY;
    report.push('تمت إضافة anon key الصحيح داخل app.json.');
  }

  const plugins = Array.isArray(expo.plugins) ? expo.plugins : [];
  let splashPluginUpdated = false;
  expo.plugins = plugins.map((plugin) => {
    if (Array.isArray(plugin) && plugin[0] === 'expo-splash-screen') {
      splashPluginUpdated = true;
      return [
        'expo-splash-screen',
        {
          ...(plugin[1] || {}),
          image: './assets/images/splash-icon.png',
          imageWidth: 220,
          resizeMode: 'contain',
          backgroundColor: '#FFFFFF',
        },
      ];
    }
    return plugin;
  });
  if (!splashPluginUpdated) {
    expo.plugins.push([
      'expo-splash-screen',
      {
        image: './assets/images/splash-icon.png',
        imageWidth: 220,
        resizeMode: 'contain',
        backgroundColor: '#FFFFFF',
      },
    ]);
  }

  fs.writeFileSync(appJsonPath, JSON.stringify(appConfig, null, 2) + '\n', 'utf8');
  report.push('تم تعديل app.json: الاسم والشعار وشاشة البداية وبيانات Supabase.');

  fs.mkdirSync(assetsDir, { recursive: true });
  copyFile(path.join(patchAssetsDir, 'akked-icon.png'), path.join(assetsDir, 'icon.png'));
  copyFile(path.join(patchAssetsDir, 'akked-splash-icon.png'), path.join(assetsDir, 'splash-icon.png'));
  copyFile(path.join(patchAssetsDir, 'akked-favicon.png'), path.join(assetsDir, 'favicon.png'));

  const supabaseSource = `import 'react-native-url-polyfill/auto';
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
  /^https:\\/\\/[a-z0-9-]+\\.supabase\\.co$/i.test(value);

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
`;
  fs.mkdirSync(path.dirname(supabasePath), { recursive: true });
  fs.writeFileSync(supabasePath, supabaseSource, 'utf8');
  report.push('تم تعديل lib/supabase.ts لمنع استخدام مفتاح Supabase تالف من .env.');

  const expoCache = path.join(root, '.expo');
  if (fs.existsSync(expoCache)) {
    fs.rmSync(expoCache, { recursive: true, force: true });
    report.push('تم حذف مجلد .expo لمسح كاش الإعدادات المحلي.');
  }

  report.push('استخدم بعد التعديل: npx expo start -c --port 8081');
  fs.writeFileSync(path.join(root, 'PATCH_STARTUP_LOGO_SUPABASE_REPORT.txt'), report.join('\n') + '\n', 'utf8');
  console.log(report.join('\n'));
} catch (error) {
  const message = `فشل التعديل: ${error.message}`;
  fs.writeFileSync(path.join(root, 'PATCH_STARTUP_LOGO_SUPABASE_REPORT.txt'), message + '\n', 'utf8');
  console.error(message);
  process.exit(1);
}
