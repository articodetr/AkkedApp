import { supabase } from '@/lib/supabase';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';

const BUCKET_NAME = 'shop-logos';

export interface LetterheadSettings {
  id?: string;
  user_id?: string;
  logo_url: string | null;
  business_name: string;
  phone_number: string;
  background_color: string;
  primary_color: string;
  text_color: string;
  border_color: string;
  accent_color: string;
  layout: 'logo_right';
  show_logo: boolean;
  show_phone: boolean;
  created_at?: string;
  updated_at?: string;
}

export const DEFAULT_LETTERHEAD_SETTINGS: LetterheadSettings = {
  logo_url: null,
  business_name: 'ArtiCode',
  phone_number: '',
  background_color: '#FFFFFF',
  primary_color: '#111827',
  text_color: '#374151',
  border_color: '#E5E7EB',
  accent_color: '#0EA5E9',
  layout: 'logo_right',
  show_logo: true,
  show_phone: true,
};

export const LETTERHEAD_COLOR_PRESETS = [
  {
    name: 'أزرق هادئ',
    background_color: '#FFFFFF',
    primary_color: '#0F172A',
    text_color: '#475569',
    border_color: '#BAE6FD',
    accent_color: '#0EA5E9',
  },
  {
    name: 'ذهبي رسمي',
    background_color: '#FFFBEB',
    primary_color: '#78350F',
    text_color: '#92400E',
    border_color: '#FCD34D',
    accent_color: '#D97706',
  },
  {
    name: 'أخضر مالي',
    background_color: '#F0FDF4',
    primary_color: '#064E3B',
    text_color: '#047857',
    border_color: '#86EFAC',
    accent_color: '#10B981',
  },
  {
    name: 'أسود فاخر',
    background_color: '#111827',
    primary_color: '#FFFFFF',
    text_color: '#D1D5DB',
    border_color: '#374151',
    accent_color: '#F59E0B',
  },
  {
    name: 'رمادي بسيط',
    background_color: '#F9FAFB',
    primary_color: '#111827',
    text_color: '#4B5563',
    border_color: '#D1D5DB',
    accent_color: '#6B7280',
  },
];

function sanitizeHexColor(value: string, fallback: string): string {
  const trimmed = value.trim();
  return /^#[0-9A-Fa-f]{6}$/.test(trimmed) ? trimmed.toUpperCase() : fallback;
}

export function normalizeLetterheadSettings(
  settings?: Partial<LetterheadSettings> | null
): LetterheadSettings {
  return {
    ...DEFAULT_LETTERHEAD_SETTINGS,
    ...(settings || {}),
    background_color: sanitizeHexColor(
      settings?.background_color || DEFAULT_LETTERHEAD_SETTINGS.background_color,
      DEFAULT_LETTERHEAD_SETTINGS.background_color
    ),
    primary_color: sanitizeHexColor(
      settings?.primary_color || DEFAULT_LETTERHEAD_SETTINGS.primary_color,
      DEFAULT_LETTERHEAD_SETTINGS.primary_color
    ),
    text_color: sanitizeHexColor(
      settings?.text_color || DEFAULT_LETTERHEAD_SETTINGS.text_color,
      DEFAULT_LETTERHEAD_SETTINGS.text_color
    ),
    border_color: sanitizeHexColor(
      settings?.border_color || DEFAULT_LETTERHEAD_SETTINGS.border_color,
      DEFAULT_LETTERHEAD_SETTINGS.border_color
    ),
    accent_color: sanitizeHexColor(
      settings?.accent_color || DEFAULT_LETTERHEAD_SETTINGS.accent_color,
      DEFAULT_LETTERHEAD_SETTINGS.accent_color
    ),
    layout: 'logo_right',
    show_logo: settings?.show_logo ?? DEFAULT_LETTERHEAD_SETTINGS.show_logo,
    show_phone: settings?.show_phone ?? DEFAULT_LETTERHEAD_SETTINGS.show_phone,
  };
}

export async function getLetterheadSettings(userId: string): Promise<LetterheadSettings> {
  const { data, error } = await supabase
    .from('letterhead_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('[letterheadService] Error loading settings:', error);
    throw new Error('فشل تحميل إعدادات الترويسة');
  }

  return normalizeLetterheadSettings(data);
}

export async function saveLetterheadSettings(
  userId: string,
  settings: Partial<LetterheadSettings>
): Promise<LetterheadSettings> {
  const normalized = normalizeLetterheadSettings(settings);

  const payload = {
    user_id: userId,
    logo_url: normalized.logo_url,
    business_name: normalized.business_name.trim() || DEFAULT_LETTERHEAD_SETTINGS.business_name,
    phone_number: normalized.phone_number.trim(),
    background_color: normalized.background_color,
    primary_color: normalized.primary_color,
    text_color: normalized.text_color,
    border_color: normalized.border_color,
    accent_color: normalized.accent_color,
    layout: normalized.layout,
    show_logo: normalized.show_logo,
    show_phone: normalized.show_phone,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('letterhead_settings')
    .upsert(payload, { onConflict: 'user_id' })
    .select('*')
    .single();

  if (error) {
    console.error('[letterheadService] Error saving settings:', error);
    throw new Error('فشل حفظ إعدادات الترويسة');
  }

  return normalizeLetterheadSettings(data);
}

export async function pickLetterheadLogoFromGallery(): Promise<string | null> {
  const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (!permissionResult.granted) {
    throw new Error('تم رفض صلاحية الوصول إلى المعرض');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.8,
    base64: false,
  });

  if (!result.canceled && result.assets[0]) {
    return result.assets[0].uri;
  }

  return null;
}

export async function uploadLetterheadLogo(imageUri: string, userId: string): Promise<string> {
  const base64 = await FileSystem.readAsStringAsync(imageUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const fileSizeInBytes = (base64.length * 3) / 4;
  const maxFileSize = 5 * 1024 * 1024;

  if (fileSizeInBytes > maxFileSize) {
    throw new Error('حجم الشعار كبير جدًا. الحد الأقصى 5 MB');
  }

  const rawExt = imageUri.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
  const supportedFormats = ['jpg', 'jpeg', 'png', 'webp'];
  const fileExt = supportedFormats.includes(rawExt) ? rawExt : 'jpg';
  const normalizedExt = fileExt === 'jpg' ? 'jpeg' : fileExt;
  const filePath = `letterheads/${userId}_${Date.now()}.${fileExt}`;
  const arrayBuffer = decode(base64);

  const { error: uploadError } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(filePath, arrayBuffer, {
      contentType: `image/${normalizedExt}`,
      upsert: true,
    });

  if (uploadError) {
    console.error('[letterheadService] Upload error:', uploadError);
    throw new Error(`فشل رفع الشعار: ${uploadError.message}`);
  }

  const { data } = supabase.storage.from(BUCKET_NAME).getPublicUrl(filePath);
  return data.publicUrl;
}

export async function deleteLetterheadLogo(logoUrl: string | null): Promise<void> {
  if (!logoUrl || !logoUrl.includes(BUCKET_NAME)) {
    return;
  }

  try {
    const publicMarker = `/storage/v1/object/public/${BUCKET_NAME}/`;
    const markerIndex = logoUrl.indexOf(publicMarker);
    if (markerIndex === -1) return;

    const filePath = decodeURIComponent(logoUrl.substring(markerIndex + publicMarker.length));

    await supabase.storage.from(BUCKET_NAME).remove([filePath]);
  } catch (error) {
    console.warn('[letterheadService] Could not delete old logo:', error);
  }
}
