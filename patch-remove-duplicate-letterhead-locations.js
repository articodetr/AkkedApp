const fs = require('fs');
const path = require('path');

const root = process.cwd();

const settingsPath = path.join(root, 'app', '(tabs)', 'settings.tsx');
const shopSettingsPath = path.join(root, 'app', 'shop-settings.tsx');

const backupDir = path.join(root, '.letterhead-duplicate-fix-backup');

function ensureBackupDir() {
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
}

function backup(filePath) {
  ensureBackupDir();

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const backupName = `${path.basename(filePath)}.${Date.now()}.bak`;
  const backupPath = path.join(backupDir, backupName);

  fs.copyFileSync(filePath, backupPath);
  console.log(`Backup created: ${backupPath}`);

  return backupPath;
}

function writeFile(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Updated: ${filePath}`);
}

function patchSettingsScreen() {
  if (!fs.existsSync(settingsPath)) {
    throw new Error(`Missing file: ${settingsPath}`);
  }

  backup(settingsPath);

  let content = fs.readFileSync(settingsPath, 'utf8');

  content = content.replace(
    /title:\s*'إعدادات المحل',\s*subtitle:\s*'اسم المحل والشعار'/g,
    `title: 'إعدادات المحل', subtitle: 'اسم المحل والهاتف والعنوان'`
  );

  content = content.replace(
    /title:\s*'ترويسة السندات',\s*subtitle:\s*'تخصيص الشعار والرقم وألوان الترويسة'/g,
    `title: 'الترويسة والطباعة', subtitle: 'الشعار والألوان والترويسة الكاملة للسندات'`
  );

  writeFile(settingsPath, content);
}

function replaceShopSettingsFile() {
  if (!fs.existsSync(shopSettingsPath)) {
    throw new Error(`Missing file: ${shopSettingsPath}`);
  }

  backup(shopSettingsPath);

  const newContent = `import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowRight, Save, Building2, Phone, MapPin } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';

export default function ShopSettingsScreen() {
  const router = useRouter();
  const { settings, updateSettings, refreshSettings } = useAuth();

  const [shopName, setShopName] = useState(settings?.shop_name || '');
  const [shopPhone, setShopPhone] = useState(settings?.shop_phone || '');
  const [shopAddress, setShopAddress] = useState(settings?.shop_address || '');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (settings) {
      setShopName(settings.shop_name || '');
      setShopPhone(settings.shop_phone || '');
      setShopAddress(settings.shop_address || '');
    }
  }, [settings]);

  const handleSave = async () => {
    if (!shopName.trim()) {
      Alert.alert('خطأ', 'الرجاء إدخال اسم المحل');
      return;
    }

    setIsSaving(true);

    try {
      const success = await updateSettings({
        shop_name: shopName.trim(),
        shop_phone: shopPhone.trim() || null,
        shop_address: shopAddress.trim() || null,
      });

      if (success) {
        await refreshSettings();
        Alert.alert('نجح', 'تم حفظ بيانات المحل بنجاح', [
          { text: 'حسنًا', onPress: () => router.back() },
        ]);
      } else {
        Alert.alert('خطأ', 'فشل حفظ بيانات المحل');
      }
    } catch (error) {
      console.error('Error saving shop settings:', error);
      Alert.alert('خطأ', 'حدث خطأ أثناء حفظ البيانات');
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

        <View style={styles.headerTextWrap}>
          <Text style={styles.headerTitle}>إعدادات المحل</Text>
          <Text style={styles.headerSubtitle}>اسم المحل والهاتف والعنوان فقط</Text>
        </View>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <View style={styles.cardTitleRow}>
            <Building2 size={20} color="#4F46E5" />
            <Text style={styles.cardTitle}>معلومات المحل</Text>
          </View>

          <Text style={styles.label}>اسم المحل *</Text>
          <TextInput
            style={styles.input}
            value={shopName}
            onChangeText={setShopName}
            placeholder="أدخل اسم المحل"
            placeholderTextColor="#9CA3AF"
            textAlign="right"
          />

          <Text style={styles.label}>رقم الهاتف</Text>
          <View style={styles.inputIconWrap}>
            <Phone size={18} color="#94A3B8" />
            <TextInput
              style={styles.inputWithIcon}
              value={shopPhone}
              onChangeText={setShopPhone}
              placeholder="أدخل رقم الهاتف"
              placeholderTextColor="#9CA3AF"
              keyboardType="phone-pad"
              textAlign="right"
            />
          </View>

          <Text style={styles.label}>العنوان</Text>
          <View style={styles.inputIconWrap}>
            <MapPin size={18} color="#94A3B8" />
            <TextInput
              style={[styles.inputWithIcon, styles.multilineInput]}
              value={shopAddress}
              onChangeText={setShopAddress}
              placeholder="أدخل عنوان المحل"
              placeholderTextColor="#9CA3AF"
              textAlign="right"
              multiline
            />
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={isSaving}
        >
          {isSaving ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <>
              <Save size={18} color="#FFFFFF" />
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
    backgroundColor: '#F8FAFC',
  },
  header: {
    backgroundColor: '#FFFFFF',
    paddingTop: 16,
    paddingBottom: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  headerTextWrap: {
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
    marginTop: 4,
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'right',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 120,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  cardTitleRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'right',
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 8,
    marginTop: 12,
    textAlign: 'right',
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    minHeight: 52,
    paddingHorizontal: 14,
    fontSize: 16,
    color: '#111827',
    textAlign: 'right',
  },
  inputIconWrap: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    paddingHorizontal: 14,
    minHeight: 52,
    gap: 10,
  },
  inputWithIcon: {
    flex: 1,
    fontSize: 16,
    color: '#111827',
    textAlign: 'right',
    minHeight: 52,
  },
  multilineInput: {
    minHeight: 90,
    textAlignVertical: 'top',
    paddingTop: 14,
  },
  footer: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
  },
  saveButton: {
    height: 56,
    borderRadius: 16,
    backgroundColor: '#4F46E5',
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#4F46E5',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 6,
  },
  saveButtonDisabled: {
    opacity: 0.7,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
});
`;

  writeFile(shopSettingsPath, newContent);
}

try {
  patchSettingsScreen();
  replaceShopSettingsFile();

  console.log('');
  console.log('Done. Duplicate letterhead editing has been removed from shop settings.');
  console.log('');
  console.log('Now run:');
  console.log('npm run typecheck');
  console.log('npx expo start -c --port 8082');
} catch (error) {
  console.error('');
  console.error('Patch failed:');
  console.error(error.message || error);
  process.exit(1);
}