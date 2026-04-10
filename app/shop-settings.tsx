import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Image,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { ArrowRight, Camera, ImageIcon, Trash2, Save, Check, FileUp } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import {
  pickImageFromGallery,
  pickImageFromCamera,
  pickPngFile,
  uploadLogo,
} from '@/services/logoService';
import { getLogoUrl, clearLogoCache } from '@/utils/logoHelper';
import { KeyboardAwareView } from '@/components/KeyboardAwareView';
import { supabase } from '@/lib/supabase';

export default function ShopSettingsScreen() {
  const router = useRouter();
  const { settings, updateSettings, refreshSettings, currentUser } = useAuth();

  const [shopName, setShopName] = useState(settings?.shop_name || '');
  const [shopPhone, setShopPhone] = useState(settings?.shop_phone || '');
  const [shopAddress, setShopAddress] = useState(settings?.shop_address || '');
  const [logoUri, setLogoUri] = useState<string | null>(null);
  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null);
  const [selectedReceiptLogo, setSelectedReceiptLogo] = useState<'uploaded' | 'default'>('uploaded');
  const [imageLoadError, setImageLoadError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadCurrentLogo();
    loadReceiptLogoSettings();
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshSettings();
      loadCurrentLogo();
      loadReceiptLogoSettings();
    }, [])
  );

  useEffect(() => {
    if (settings) {
      setShopName(settings.shop_name || '');
      setShopPhone(settings.shop_phone || '');
      setShopAddress(settings.shop_address || '');
    }
  }, [settings]);

  const loadCurrentLogo = async () => {
    try {
      setIsLoading(true);
      const url = await getLogoUrl();
      setLogoUri(url);
    } catch (error) {
      console.error('Error loading logo:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadReceiptLogoSettings = async () => {
    try {
      const FIXED_SETTINGS_ID = '00000000-0000-0000-0000-000000000000';
      const { data, error } = await supabase
        .from('app_settings')
        .select('selected_receipt_logo, shop_logo')
        .eq('id', FIXED_SETTINGS_ID)
        .maybeSingle();

      if (!error && data) {
        // If selected_receipt_logo is 'DEFAULT', use default logo
        if (data.selected_receipt_logo === 'DEFAULT') {
          setSelectedReceiptLogo('default');
        }
        // If selected_receipt_logo is null or empty, check shop_logo for backward compatibility
        else if (!data.selected_receipt_logo) {
          // If there's a shop_logo, default to uploaded, otherwise default
          setSelectedReceiptLogo(data.shop_logo ? 'uploaded' : 'default');
        }
        // If selected_receipt_logo has a URL value, it's uploaded
        else {
          setSelectedReceiptLogo('uploaded');
        }
      }
    } catch (error) {
      console.error('Error loading receipt logo settings:', error);
    }
  };

  const handlePickFromGallery = async () => {
    if (currentUser?.role !== 'admin') {
      Alert.alert('غير مصرح', 'رفع الشعار متاح فقط للمدير');
      return;
    }
    try {
      setImageLoadError(false);
      const uri = await pickImageFromGallery();
      if (uri) {
        setSelectedImageUri(uri);
      }
    } catch (error) {
      Alert.alert('خطأ', error instanceof Error ? error.message : 'فشل اختيار الصورة');
    }
  };

  const handlePickFromCamera = async () => {
    if (currentUser?.role !== 'admin') {
      Alert.alert('غير مصرح', 'رفع الشعار متاح فقط للمدير');
      return;
    }
    try {
      setImageLoadError(false);
      const uri = await pickImageFromCamera();
      if (uri) {
        setSelectedImageUri(uri);
      }
    } catch (error) {
      Alert.alert('خطأ', error instanceof Error ? error.message : 'فشل التقاط الصورة');
    }
  };

  const handlePickPngFile = async () => {
    if (currentUser?.role !== 'admin') {
      Alert.alert('غير مصرح', 'رفع الشعار متاح فقط للمدير');
      return;
    }
    try {
      setImageLoadError(false);
      const uri = await pickPngFile();
      if (uri) {
        setSelectedImageUri(uri);
      }
    } catch (error) {
      Alert.alert('خطأ', error instanceof Error ? error.message : 'فشل اختيار الملف');
    }
  };

  const handleRemoveLogo = () => {
    Alert.alert('حذف الشعار', 'هل أنت متأكد من حذف الشعار الحالي؟', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'حذف',
        style: 'destructive',
        onPress: async () => {
          setIsSaving(true);
          try {
            console.log('[ShopSettings] Removing logo');
            const success = await updateSettings({ shop_logo: null });
            if (success) {
              setLogoUri(null);
              setSelectedImageUri(null);
              await clearLogoCache();
              await loadCurrentLogo();
              Alert.alert('نجح', 'تم حذف الشعار بنجاح');
            } else {
              Alert.alert('خطأ', 'فشل حذف الشعار');
            }
          } catch (error) {
            console.error('[ShopSettings] Error removing logo:', error);
            Alert.alert('خطأ', 'فشل حذف الشعار');
          } finally {
            setIsSaving(false);
          }
        },
      },
    ]);
  };

  const handleSave = async () => {
    if (!shopName.trim()) {
      Alert.alert('خطأ', 'الرجاء إدخال اسم المحل');
      return;
    }

    setIsSaving(true);

    try {
      let logoUrl: string | null = null;

      if (selectedImageUri) {
        if (currentUser?.role !== 'admin') {
          Alert.alert('غير مصرح', 'رفع الشعار متاح فقط للمدير');
          setIsSaving(false);
          return;
        }
        console.log('Uploading new logo from URI:', selectedImageUri);
        const result = await uploadLogo(selectedImageUri);
        console.log('Upload result:', result);

        if (result.success && result.url) {
          logoUrl = result.url;
          console.log('Logo uploaded successfully');
        } else {
          const errorMsg = result.error || 'فشل رفع الشعار';
          console.error('Upload failed:', errorMsg);
          Alert.alert('خطأ في رفع الصورة', errorMsg);
          setIsSaving(false);
          return;
        }
      }

      const settingsUpdate: any = {
        shop_name: shopName,
        shop_phone: shopPhone || null,
        shop_address: shopAddress || null,
      };

      if (logoUrl) {
        console.log('[ShopSettings] Adding new logo URL to settings:', logoUrl);
        settingsUpdate.shop_logo = logoUrl;
      }

      if (selectedReceiptLogo === 'uploaded') {
        if (logoUrl) {
          console.log('[ShopSettings] Using new logo for receipts');
          settingsUpdate.selected_receipt_logo = logoUrl;
        } else if (settings?.shop_logo) {
          console.log('[ShopSettings] Using existing shop logo for receipts');
          settingsUpdate.selected_receipt_logo = settings.shop_logo;
        } else {
          console.log('[ShopSettings] No logo available, setting to null');
          settingsUpdate.selected_receipt_logo = null;
        }
      } else {
        console.log('[ShopSettings] Using default logo for receipts');
        settingsUpdate.selected_receipt_logo = 'DEFAULT';
      }

      console.log('[ShopSettings] Final settings update:', JSON.stringify(settingsUpdate, null, 2));
      const success = await updateSettings(settingsUpdate);

      if (success) {
        setSelectedImageUri(null);
        setImageLoadError(false);

        if (logoUrl) {
          console.log('Logo changed, clearing cache...');
          await clearLogoCache();
        }

        await refreshSettings();
        await loadCurrentLogo();
        await loadReceiptLogoSettings();

        const message = logoUrl
          ? 'تم حفظ الإعدادات والشعار بنجاح'
          : 'تم حفظ الإعدادات بنجاح';

        const detailedMessage = logoUrl
          ? `${message}\n\nملاحظة: السندات الجديدة ستستخدم الشعار الجديد.\n\nلتحديث السندات القديمة، افتح كل سند واضغط على زر "إعادة الإنشاء" 🔄`
          : message;

        Alert.alert('نجح', detailedMessage, [
          {
            text: 'حسناً',
            onPress: () => router.back(),
          },
        ]);
      } else {
        Alert.alert('خطأ', 'فشل حفظ الإعدادات في قاعدة البيانات');
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'حدث خطأ غير معروف';
      console.error('Error saving settings:', error);
      Alert.alert('خطأ في الحفظ', errorMsg);
    } finally {
      setIsSaving(false);
    }
  };


  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ArrowRight size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>إعدادات المحل</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAwareView contentContainerStyle={{ paddingBottom: 100 }}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>صورة ترويسة المحل</Text>
          <Text style={styles.sectionDescription}>
            قم برفع صورة ترويسة بمقاسات 2048×405 بكسل تحتوي على الشعار والعنوان والأرقام. الحد الأقصى للحجم 5 MB
          </Text>
          {selectedImageUri && (
            <View style={styles.infoBox}>
              <Text style={styles.infoText}>
                ✓ تم اختيار صورة جديدة بنجاح
              </Text>
              <Text style={[styles.infoText, { fontSize: 12, marginTop: 4 }]}>
                المعاينة ستظهر بعد الحفظ
              </Text>
            </View>
          )}

          <View style={styles.logoContainer}>
            {isLoading ? (
              <View style={styles.logoPlaceholder}>
                <ActivityIndicator size="large" color="#4F46E5" />
              </View>
            ) : selectedImageUri ? (
              <View style={styles.logoPlaceholder}>
                <Check size={48} color="#10B981" />
                <Text style={[styles.placeholderText, { color: '#10B981', fontWeight: '600' }]}>
                  تم اختيار الصورة بنجاح
                </Text>
                <Text style={[styles.placeholderText, { fontSize: 12 }]}>
                  اضغط "حفظ التغييرات" لرؤية الصورة
                </Text>
              </View>
            ) : logoUri && !imageLoadError ? (
              <View style={styles.logoImageWrapper}>
                <Image
                  source={{ uri: logoUri }}
                  style={styles.logoImage}
                  resizeMode="contain"
                  onError={() => setImageLoadError(true)}
                />
              </View>
            ) : (
              <View style={styles.logoPlaceholder}>
                <ImageIcon size={48} color="#9CA3AF" />
                <Text style={styles.placeholderText}>
                  {imageLoadError ? 'فشل تحميل الصورة' : 'لا يوجد شعار'}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.logoActions}>
            <TouchableOpacity
              style={styles.logoActionButton}
              onPress={handlePickFromGallery}
              disabled={isSaving}
            >
              <ImageIcon size={20} color="#4F46E5" />
              <Text style={styles.logoActionText}>اختر من المعرض</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.logoActionButton}
              onPress={handlePickFromCamera}
              disabled={isSaving}
            >
              <Camera size={20} color="#4F46E5" />
              <Text style={styles.logoActionText}>التقاط صورة</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.logoActionButton, styles.pngFileButton]}
              onPress={handlePickPngFile}
              disabled={isSaving}
            >
              <FileUp size={20} color="#10B981" />
              <Text style={[styles.logoActionText, styles.pngFileText]}>رفع ملف PNG</Text>
            </TouchableOpacity>

            {(logoUri || selectedImageUri) && (
              <TouchableOpacity
                style={[styles.logoActionButton, styles.deleteButton]}
                onPress={handleRemoveLogo}
                disabled={isSaving}
              >
                <Trash2 size={20} color="#EF4444" />
                <Text style={[styles.logoActionText, styles.deleteText]}>حذف</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>الترويسة في السندات</Text>
          <Text style={styles.sectionDescription}>اختر الترويسة التي ستظهر في جميع السندات والتقارير</Text>

          <View style={styles.logoOptionsContainer}>
            <TouchableOpacity
              style={[
                styles.logoOptionCard,
                selectedReceiptLogo === 'uploaded' && styles.logoOptionCardSelected,
              ]}
              onPress={() => setSelectedReceiptLogo('uploaded')}
              disabled={isSaving}
            >
              <View style={styles.logoOptionImageContainer}>
                {logoUri && !imageLoadError ? (
                  <Image
                    source={{ uri: logoUri }}
                    style={styles.logoOptionImage}
                    resizeMode="contain"
                  />
                ) : (
                  <View style={styles.logoOptionPlaceholder}>
                    <ImageIcon size={32} color="#9CA3AF" />
                  </View>
                )}
              </View>
              <View style={styles.logoOptionContent}>
                <Text style={styles.logoOptionTitle}>الترويسة المرفوعة</Text>
                <Text style={styles.logoOptionDescription}>
                  {logoUri
                    ? 'استخدام الترويسة الحالية'
                    : selectedImageUri
                    ? 'احفظ التغييرات أولاً'
                    : 'لم يتم رفع ترويسة بعد'}
                </Text>
              </View>
              {selectedReceiptLogo === 'uploaded' && (
                <View style={styles.logoOptionCheck}>
                  <Check size={20} color="#10B981" />
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.logoOptionCard,
                selectedReceiptLogo === 'default' && styles.logoOptionCardSelected,
              ]}
              onPress={() => setSelectedReceiptLogo('default')}
              disabled={isSaving}
            >
              <View style={styles.logoOptionImageContainer}>
                <View style={[styles.logoOptionImage, { backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' }]}>
                  <Text style={{ fontSize: 32, color: '#9CA3AF' }}>🏪</Text>
                </View>
              </View>
              <View style={styles.logoOptionContent}>
                <Text style={styles.logoOptionTitle}>بدون ترويسة</Text>
                <Text style={styles.logoOptionDescription}>السند بدون ترويسة مخصصة</Text>
              </View>
              {selectedReceiptLogo === 'default' && (
                <View style={styles.logoOptionCheck}>
                  <Check size={20} color="#10B981" />
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>معلومات المحل</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>اسم المحل *</Text>
            <TextInput
              style={styles.input}
              value={shopName}
              onChangeText={setShopName}
              placeholder="أدخل اسم المحل"
              placeholderTextColor="#9CA3AF"
              editable={!isSaving}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>رقم الهاتف</Text>
            <TextInput
              style={styles.input}
              value={shopPhone}
              onChangeText={setShopPhone}
              placeholder="أدخل رقم الهاتف"
              placeholderTextColor="#9CA3AF"
              keyboardType="phone-pad"
              editable={!isSaving}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>العنوان</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={shopAddress}
              onChangeText={setShopAddress}
              placeholder="أدخل عنوان المحل"
              placeholderTextColor="#9CA3AF"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              editable={!isSaving}
            />
          </View>
        </View>
      </KeyboardAwareView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={isSaving}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Save size={20} color="#FFFFFF" />
              <Text style={styles.saveButtonText}>حفظ التغييرات</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  header: {
    backgroundColor: '#FFFFFF',
    paddingTop: 16,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
  },
  content: {
    flex: 1,
  },
  section: {
    backgroundColor: '#FFFFFF',
    margin: 16,
    padding: 20,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 8,
    textAlign: 'right',
  },
  sectionDescription: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 16,
    textAlign: 'right',
  },
  logoOptionsContainer: {
    gap: 12,
  },
  logoOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 12,
    gap: 12,
  },
  logoOptionCardSelected: {
    borderColor: '#10B981',
    backgroundColor: '#ECFDF5',
  },
  logoOptionImageContainer: {
    width: 60,
    height: 60,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  logoOptionImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'contain',
  },
  logoOptionPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
  },
  logoOptionContent: {
    flex: 1,
    gap: 4,
  },
  logoOptionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'right',
  },
  logoOptionDescription: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'right',
  },
  logoOptionCheck: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#D1FAE5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoContainer: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#F3F4F6',
    marginBottom: 16,
  },
  logoImageWrapper: {
    width: '100%',
    height: '100%',
    position: 'relative',
    backgroundColor: '#FFFFFF',
  },
  logoImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'contain',
    backgroundColor: '#FFFFFF',
  },
  newBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#10B981',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  newBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  logoPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  placeholderText: {
    fontSize: 14,
    color: '#9CA3AF',
  },
  infoBox: {
    backgroundColor: '#DBEAFE',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#3B82F6',
  },
  infoText: {
    fontSize: 14,
    color: '#1E40AF',
    textAlign: 'center',
    fontWeight: '600',
  },
  logoActions: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  logoActionButton: {
    flex: 1,
    minWidth: 100,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#EEF2FF',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#4F46E5',
  },
  pngFileButton: {
    backgroundColor: '#ECFDF5',
    borderColor: '#10B981',
  },
  deleteButton: {
    backgroundColor: '#FEE2E2',
    borderColor: '#EF4444',
  },
  logoActionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4F46E5',
  },
  pngFileText: {
    color: '#10B981',
  },
  deleteText: {
    color: '#EF4444',
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
    textAlign: 'right',
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    color: '#111827',
    textAlign: 'right',
  },
  textArea: {
    minHeight: 80,
    paddingTop: 12,
  },
  footer: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  saveButton: {
    backgroundColor: '#4F46E5',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
    borderRadius: 12,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
});
