import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '@/lib/supabase';

const BUCKET_NAME = 'shop-logos';
const FIXED_SETTINGS_ID = '00000000-0000-0000-0000-000000000000';

async function downloadAndConvertLogoToBase64(logoUrl: string): Promise<string | null> {
  try {
    console.log('[logoHelper] Downloading logo from Storage:', logoUrl);

    if (Platform.OS === 'web') {
      console.log('[logoHelper] Platform is web, returning URL directly');
      return logoUrl;
    }

    const tempPath = `${FileSystem.cacheDirectory}temp_logo_${Date.now()}.jpg`;

    const downloadResult = await FileSystem.downloadAsync(logoUrl, tempPath);

    if (downloadResult.status !== 200) {
      console.error('[logoHelper] Download failed with status:', downloadResult.status);
      return null;
    }

    console.log('[logoHelper] Logo downloaded to:', downloadResult.uri);

    const base64 = await FileSystem.readAsStringAsync(downloadResult.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    if (!base64) {
      console.error('[logoHelper] Empty base64 after download');
      return null;
    }

    const fileExt = logoUrl.split('.').pop()?.toLowerCase() || 'jpg';
    const mimeType = fileExt === 'png' ? 'image/png' : 'image/jpeg';

    console.log('[logoHelper] Successfully converted uploaded logo to base64, length:', base64.length);
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.error('[logoHelper] Error downloading/converting logo:', error);
    return null;
  }
}

export async function getReceiptLogoBase64(forceRefresh = false): Promise<string> {
  try {
    console.log('[logoHelper] getReceiptLogoBase64 called, forceRefresh:', forceRefresh);

    const { data: settings, error } = await supabase
      .from('app_settings')
      .select('selected_receipt_logo, shop_logo')
      .eq('id', FIXED_SETTINGS_ID)
      .maybeSingle();

    if (error) {
      console.error('[logoHelper] Error fetching settings:', error);
      console.log('[logoHelper] No logo available');
      return '';
    }

    if (!settings) {
      console.log('[logoHelper] No settings found, no logo available');
      return '';
    }

    console.log('[logoHelper] Settings loaded:', {
      selected_receipt_logo: settings.selected_receipt_logo,
      shop_logo: settings.shop_logo,
    });

    if (settings.selected_receipt_logo === 'DEFAULT') {
      console.log('[logoHelper] User selected DEFAULT logo, no logo available');
      return '';
    }

    const logoUrl = settings.selected_receipt_logo || settings.shop_logo;

    if (!logoUrl || logoUrl === 'DEFAULT') {
      console.log('[logoHelper] No uploaded logo URL found');
      return '';
    }

    if (logoUrl.includes(BUCKET_NAME)) {
      console.log('[logoHelper] Found uploaded logo in Supabase Storage');
      const base64Logo = await downloadAndConvertLogoToBase64(logoUrl);

      if (base64Logo) {
        return base64Logo;
      } else {
        console.log('[logoHelper] Failed to download uploaded logo');
        return '';
      }
    }

    if (logoUrl.startsWith('http://') || logoUrl.startsWith('https://')) {
      console.log('[logoHelper] Found external logo URL:', logoUrl);
      const base64Logo = await downloadAndConvertLogoToBase64(logoUrl);

      if (base64Logo) {
        return base64Logo;
      } else {
        console.log('[logoHelper] Failed to download external logo');
        return '';
      }
    }

    console.log('[logoHelper] Unrecognized logo format');
    return '';
  } catch (error) {
    console.error('[logoHelper] Error in getReceiptLogoBase64:', error);
    return '';
  }
}

export async function getLogoUrl(): Promise<string> {
  try {
    const { data: settings, error } = await supabase
      .from('app_settings')
      .select('shop_logo')
      .eq('id', FIXED_SETTINGS_ID)
      .maybeSingle();

    if (error || !settings?.shop_logo) {
      return '';
    }

    return settings.shop_logo;
  } catch (error) {
    console.error('[logoHelper] Error getting logo URL:', error);
    return '';
  }
}

export async function getLogoBase64(forceRefresh = false): Promise<string> {
  return getReceiptLogoBase64(forceRefresh);
}

export async function clearLogoCache(): Promise<void> {
  try {
    console.log('[logoHelper] Clearing logo cache');
    if (Platform.OS !== 'web') {
      const cacheDir = FileSystem.cacheDirectory;
      if (cacheDir) {
        const files = await FileSystem.readDirectoryAsync(cacheDir);
        const logoFiles = files.filter(f => f.startsWith('temp_logo_'));

        for (const file of logoFiles) {
          await FileSystem.deleteAsync(`${cacheDir}${file}`, { idempotent: true });
        }

        console.log('[logoHelper] Cleared', logoFiles.length, 'cached logo files');
      }
    }
  } catch (error) {
    console.error('[logoHelper] Error clearing logo cache:', error);
  }
}
