import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  ArrowRight,
  ImageIcon,
  Palette,
  RotateCcw,
  Save,
  Trash2,
  Upload,
} from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { LetterheadPreview } from '@/components/LetterheadPreview';
import {
  DEFAULT_LETTERHEAD_SETTINGS,
  LETTERHEAD_COLOR_PRESETS,
  LetterheadSettings,
  deleteLetterheadLogo,
  getLetterheadSettings,
  normalizeLetterheadSettings,
  pickLetterheadLogoFromGallery,
  saveLetterheadSettings,
  uploadLetterheadLogo,
} from '@/services/letterheadService';

const screenWidth = Dimensions.get('window').width;
const previewWidth = Math.min(screenWidth - 32, 534);

export default function LetterheadSettingsScreen() {
  const router = useRouter();
  const { currentUser, settings: appSettings } = useAuth();

  const [letterhead, setLetterhead] = useState<LetterheadSettings>(
    normalizeLetterheadSettings({
      ...DEFAULT_LETTERHEAD_SETTINGS,
      business_name: appSettings?.shop_name || DEFAULT_LETTERHEAD_SETTINGS.business_name,
      phone_number: appSettings?.shop_phone || '',
    })
  );
  const [savedLogoUrl, setSavedLogoUrl] = useState<string | null>(null);
  const [pendingLogoUri, setPendingLogoUri] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const previewSettings = useMemo(
    () => normalizeLetterheadSettings({
      ...letterhead,
      logo_url: pendingLogoUri || letterhead.logo_url,
    }),
    [letterhead, pendingLogoUri]
  );

  useEffect(() => {
    loadLetterhead();
  }, [currentUser?.userId]);

  const loadLetterhead = async () => {
    if (!currentUser?.userId) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const data = await getLetterheadSettings(currentUser.userId);
      const next = normalizeLetterheadSettings({
        ...data,
        business_name:
          data.business_name === DEFAULT_LETTERHEAD_SETTINGS.business_name && appSettings?.shop_name
            ? appSettings.shop_name
            : data.business_name,
        phone_number: data.phone_number || appSettings?.shop_phone || '',
      });
      setLetterhead(next);
      setSavedLogoUrl(next.logo_url);
      setPendingLogoUri(null);
    } catch (error) {
      console.error('[LetterheadSettings] Load error:', error);
      Alert.alert('خطأ', error instanceof Error ? error.message : 'فشل تحميل إعدادات الترويسة');
    } finally {
      setIsLoading(false);
    }
  };

  const updateField = <K extends keyof LetterheadSettings>(key: K, value: LetterheadSettings[K]) => {
    setLetterhead((current) => ({ ...current, [key]: value }));
  };

  const handlePickLogo = async () => {
    try {
      const uri = await pickLetterheadLogoFromGallery();
      if (uri) {
        setPendingLogoUri(uri);
        updateField('show_logo', true);
      }
    } catch (error) {
      Alert.alert('خطأ', error instanceof Error ? error.message : 'فشل اختيار الشعار');
    }
  };

  const handleRemoveLogo = () => {
    Alert.alert('إزالة الشعار', 'سيتم إزالة الشعار من الترويسة بعد الضغط على حفظ. هل تريد المتابعة؟', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'إزالة',
        style: 'destructive',
        onPress: () => {
          setPendingLogoUri(null);
          updateField('logo_url', null);
        },
      },
    ]);
  };

  const applyPreset = (preset: (typeof LETTERHEAD_COLOR_PRESETS)[number]) => {
    setLetterhead((current) => ({
      ...current,
      background_color: preset.background_color,
      primary_color: preset.primary_color,
      text_color: preset.text_color,
      border_color: preset.border_color,
      accent_color: preset.accent_color,
    }));
  };

  const handleReset = () => {
    Alert.alert('إعادة التصميم الافتراضي', 'هل تريد إعادة ألوان الترويسة للوضع الافتراضي؟', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'إعادة',
        onPress: () => {
          setLetterhead((current) => ({
            ...normalizeLetterheadSettings({
              ...DEFAULT_LETTERHEAD_SETTINGS,
              business_name: current.business_name,
              phone_number: current.phone_number,
              logo_url: current.logo_url,
            }),
          }));
        },
      },
    ]);
  };

  const handleSave = async () => {
    if (!currentUser?.userId) {
      Alert.alert('خطأ', 'لم يتم العثور على المستخدم الحالي');
      return;
    }

    if (!letterhead.business_name.trim()) {
      Alert.alert('تنبيه', 'الرجاء إدخال اسم الشركة أو الصراف');
      return;
    }

    try {
      setIsSaving(true);
      let logoUrl = letterhead.logo_url;

      if (pendingLogoUri) {
        logoUrl = await uploadLetterheadLogo(pendingLogoUri, currentUser.userId);
      }

      const saved = await saveLetterheadSettings(currentUser.userId, {
        ...letterhead,
        logo_url: logoUrl,
      });

      if (savedLogoUrl && savedLogoUrl !== saved.logo_url) {
        await deleteLetterheadLogo(savedLogoUrl);
      }

      setLetterhead(saved);
      setSavedLogoUrl(saved.logo_url);
      setPendingLogoUri(null);
      Alert.alert('تم الحفظ', 'تم حفظ إعدادات الترويسة بنجاح');
    } catch (error) {
      console.error('[LetterheadSettings] Save error:', error);
      Alert.alert('خطأ', error instanceof Error ? error.message : 'فشل حفظ إعدادات الترويسة');
    } finally {
      setIsSaving(false);
    }
  };

  const renderColorInput = (
    label: string,
    key: 'background_color' | 'primary_color' | 'text_color' | 'border_color' | 'accent_color'
  ) => (
    <View style={styles.colorInputRow}>
      <Text style={styles.colorInputLabel}>{label}</Text>
      <View style={styles.colorInputBox}>
        <View style={[styles.colorPreviewDot, { backgroundColor: letterhead[key] }]} />
        <TextInput
          value={letterhead[key]}
          onChangeText={(value) => updateField(key, value.toUpperCase() as any)}
          placeholder="#FFFFFF"
          autoCapitalize="characters"
          style={styles.colorInput}
          textAlign="left"
        />
      </View>
    </View>
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0EA5E9" />
        <Text style={styles.loadingText}>جاري تحميل إعدادات الترويسة...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ArrowRight size={24} color="#111827" />
        </TouchableOpacity>
        <View style={styles.headerTextBox}>
          <Text style={styles.headerTitle}>ترويسة السندات</Text>
          <Text style={styles.headerSubtitle}>تخصيص الشعار والرقم والألوان</Text>
        </View>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        <View style={styles.previewCard}>
          <Text style={styles.sectionTitle}>المعاينة المباشرة</Text>
          <Text style={styles.sectionSubtitle}>المقاس المعتمد للترويسة هو 534 × 106</Text>
          <LetterheadPreview settings={previewSettings} previewWidth={previewWidth} showSizeLabel />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>بيانات الترويسة</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>اسم الشركة / الصراف</Text>
            <TextInput
              value={letterhead.business_name}
              onChangeText={(value) => updateField('business_name', value)}
              placeholder="مثال: ArtiCode Exchange"
              style={styles.input}
              textAlign="right"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>الرقم الذي يظهر في الترويسة</Text>
            <TextInput
              value={letterhead.phone_number}
              onChangeText={(value) => updateField('phone_number', value)}
              placeholder="مثال: +90 535 000 00 00"
              keyboardType="phone-pad"
              style={styles.input}
              textAlign="right"
            />
          </View>

          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>إظهار الشعار</Text>
            <Switch
              value={letterhead.show_logo}
              onValueChange={(value) => updateField('show_logo', value)}
              trackColor={{ false: '#D1D5DB', true: '#BAE6FD' }}
              thumbColor={letterhead.show_logo ? '#0EA5E9' : '#F9FAFB'}
            />
          </View>

          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>إظهار الرقم</Text>
            <Switch
              value={letterhead.show_phone}
              onValueChange={(value) => updateField('show_phone', value)}
              trackColor={{ false: '#D1D5DB', true: '#BAE6FD' }}
              thumbColor={letterhead.show_phone ? '#0EA5E9' : '#F9FAFB'}
            />
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <View style={styles.cardHeaderText}>
              <Text style={styles.sectionTitle}>الشعار</Text>
              <Text style={styles.sectionSubtitle}>يمكن رفع شعار خاص بالترويسة</Text>
            </View>
            <ImageIcon size={24} color="#0EA5E9" />
          </View>

          <TouchableOpacity style={styles.uploadButton} onPress={handlePickLogo} disabled={isSaving}>
            <Upload size={20} color="#FFFFFF" />
            <Text style={styles.uploadButtonText}>اختيار شعار</Text>
          </TouchableOpacity>

          {(letterhead.logo_url || pendingLogoUri) && (
            <TouchableOpacity style={styles.removeButton} onPress={handleRemoveLogo} disabled={isSaving}>
              <Trash2 size={18} color="#EF4444" />
              <Text style={styles.removeButtonText}>إزالة الشعار</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <View style={styles.cardHeaderText}>
              <Text style={styles.sectionTitle}>الألوان الجاهزة</Text>
              <Text style={styles.sectionSubtitle}>اختر تصميمًا سريعًا ثم عدّل الألوان إذا أردت</Text>
            </View>
            <Palette size={24} color="#0EA5E9" />
          </View>

          <View style={styles.presetsGrid}>
            {LETTERHEAD_COLOR_PRESETS.map((preset) => (
              <TouchableOpacity
                key={preset.name}
                style={[styles.presetCard, { borderColor: preset.border_color }]}
                onPress={() => applyPreset(preset)}
              >
                <View style={styles.presetDots}>
                  <View style={[styles.presetDot, { backgroundColor: preset.background_color }]} />
                  <View style={[styles.presetDot, { backgroundColor: preset.primary_color }]} />
                  <View style={[styles.presetDot, { backgroundColor: preset.accent_color }]} />
                </View>
                <Text style={styles.presetName}>{preset.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>تعديل الألوان يدويًا</Text>
          <Text style={styles.sectionSubtitle}>استخدم صيغة HEX مثل #0EA5E9</Text>

          {renderColorInput('لون الخلفية', 'background_color')}
          {renderColorInput('لون الاسم الرئيسي', 'primary_color')}
          {renderColorInput('لون الرقم', 'text_color')}
          {renderColorInput('لون الإطار', 'border_color')}
          {renderColorInput('لون الشعار الافتراضي', 'accent_color')}
        </View>

        <View style={styles.actionsRow}>
          <TouchableOpacity style={styles.resetButton} onPress={handleReset} disabled={isSaving}>
            <RotateCcw size={18} color="#6B7280" />
            <Text style={styles.resetButtonText}>إعادة الألوان</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={isSaving}>
            {isSaving ? <ActivityIndicator color="#FFFFFF" /> : <Save size={20} color="#FFFFFF" />}
            <Text style={styles.saveButtonText}>{isSaving ? 'جاري الحفظ...' : 'حفظ الترويسة'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
    color: '#6B7280',
  },
  header: {
    backgroundColor: '#FFFFFF',
    paddingTop: 16,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  headerTextBox: {
    flex: 1,
    alignItems: 'flex-end',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'right',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'right',
    marginTop: 2,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 32,
  },
  previewCard: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 18,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  card: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 18,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardHeaderText: {
    flex: 1,
    alignItems: 'flex-end',
    marginLeft: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'right',
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'right',
    marginBottom: 14,
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#374151',
    textAlign: 'right',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111827',
    writingDirection: 'rtl',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  switchLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#374151',
  },
  uploadButton: {
    backgroundColor: '#0EA5E9',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  uploadButtonText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  removeButton: {
    marginTop: 10,
    borderRadius: 12,
    paddingVertical: 12,
    backgroundColor: '#FEF2F2',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  removeButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#EF4444',
  },
  presetsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  presetCard: {
    width: '47%',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    backgroundColor: '#FFFFFF',
  },
  presetDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  presetDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  presetName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
    textAlign: 'right',
  },
  colorInputRow: {
    marginTop: 12,
  },
  colorInputLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#374151',
    textAlign: 'right',
    marginBottom: 8,
  },
  colorInputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  colorPreviewDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginRight: 8,
  },
  colorInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111827',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  saveButton: {
    flex: 1,
    backgroundColor: '#0EA5E9',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  resetButton: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  resetButtonText: {
    color: '#6B7280',
    fontSize: 15,
    fontWeight: '800',
  },
});
