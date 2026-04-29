const fs = require('fs');
const path = require('path');

const root = process.cwd();
const backupDir = path.join(root, '.repair-settings-clean-backup');

const settingsPath = path.join(root, 'app', '(tabs)', 'settings.tsx');
const shopSettingsPath = path.join(root, 'app', 'shop-settings.tsx');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function backupFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  ensureDir(backupDir);
  const backupPath = path.join(
    backupDir,
    `${path.basename(filePath)}.${Date.now()}.bak`
  );
  fs.copyFileSync(filePath, backupPath);
  console.log(`Backup created: ${backupPath}`);
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Updated: ${filePath}`);
}

const settingsContent = String.raw`import { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  LogOut,
  Lock,
  Database,
  Info,
  ChevronLeft,
  Building2,
  MessageCircle,
  Link as LinkIcon,
} from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';

export default function SettingsScreen() {
  const router = useRouter();
  const { logout, settings, refreshSettings, currentUser } = useAuth();

  useEffect(() => {
    if (!settings) {
      refreshSettings();
    }
  }, [settings, refreshSettings]);

  const handleLogout = () => {
    Alert.alert('تسجيل الخروج', 'هل أنت متأكد من تسجيل الخروج؟', [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'خروج',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/(auth)/login' as any);
        },
      },
    ]);
  };

  const menuItems = [
    {
      icon: Building2,
      title: 'إعدادات المحل',
      subtitle: 'اسم المحل والهاتف والعنوان والترويسة والطباعة',
      color: '#4F46E5',
      onPress: () => router.push('/shop-settings' as any),
    },
    {
      icon: LinkIcon,
      title: 'الحسابات المتبادلة',
      subtitle: 'المستخدمون المربوطون بك كعملاء',
      color: '#3B82F6',
      onPress: () => router.push('/linked-accounts' as any),
    },
    {
      icon: MessageCircle,
      title: 'قوالب رسائل الواتساب',
      subtitle: 'تخصيص قوالب الرسائل المرسلة',
      color: '#25D366',
      onPress: () => router.push('/whatsapp-templates' as any),
    },
    {
      icon: Lock,
      title: 'إدارة رمز PIN',
      subtitle: 'تعيين أو تغيير رمز الأمان',
      color: '#EF4444',
      onPress: () => router.push('/pin-settings' as any),
    },
    {
      icon: Database,
      title: 'النسخ الاحتياطي',
      subtitle: 'نسخ واستعادة البيانات',
      color: '#10B981',
      onPress: () => router.push('/backup' as any),
    },
    {
      icon: Info,
      title: 'حول التطبيق',
      subtitle: 'الإصدار والمعلومات',
      color: '#6B7280',
      onPress: () =>
        Alert.alert(
          'ArtiCode',
          'الإصدار 1.0.0\n\nتطبيق ArtiCode لإدارة الحوالات المالية والعملاء'
        ),
    },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>الإعدادات</Text>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        <View style={styles.profileCard}>
          <Text style={styles.profileName}>
            {currentUser?.fullName || 'المستخدم'}
          </Text>
          {currentUser?.accountNumber ? (
            <Text style={styles.profilePhone}>
              رقم الحساب: {currentUser.accountNumber}
            </Text>
          ) : null}
        </View>

        <View style={styles.menuSection}>
          {menuItems.map((item, index) => {
            const IconComponent = item.icon as any;

            return (
              <TouchableOpacity
                key={item.title}
                style={[
                  styles.menuItem,
                  index === menuItems.length - 1 && styles.lastMenuItem,
                ]}
                onPress={item.onPress}
                activeOpacity={0.85}
              >
                <ChevronLeft size={20} color="#9CA3AF" />
                <View style={styles.menuItemContent}>
                  <View style={[styles.menuIcon, { backgroundColor: item.color + '15' }]}>
                    <IconComponent size={22} color={item.color} />
                  </View>

                  <View style={styles.menuTextContainer}>
                    <Text style={styles.menuTitle}>{item.title}</Text>
                    <Text style={styles.menuSubtitle}>{item.subtitle}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <LogOut size={20} color="#EF4444" />
          <Text style={styles.logoutText}>تسجيل الخروج</Text>
        </TouchableOpacity>

        <View style={styles.footer}>
          <Text style={styles.footerText}>ArtiCode</Text>
          <Text style={styles.footerVersion}>الإصدار 1.0.0</Text>
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
  header: {
    backgroundColor: '#FFFFFF',
    paddingTop: 16,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#111827',
    textAlign: 'right',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: 24,
  },
  profileCard: {
    backgroundColor: '#FFFFFF',
    margin: 16,
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  profileName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 4,
    textAlign: 'center',
  },
  profilePhone: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
  },
  menuSection: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  lastMenuItem: {
    borderBottomWidth: 0,
  },
  menuItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  menuIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  menuTextContainer: {
    flex: 1,
  },
  menuTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
    textAlign: 'right',
  },
  menuSubtitle: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'right',
  },
  logoutButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FEE2E2',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#EF4444',
    marginLeft: 8,
  },
  footer: {
    padding: 24,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 14,
    color: '#9CA3AF',
    marginBottom: 4,
  },
  footerVersion: {
    fontSize: 12,
    color: '#D1D5DB',
  },
});
`;

const shopSettingsContent = String.raw`import { useEffect, useState } from 'react';
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
import {
  ArrowRight,
  Save,
  Building2,
  Phone,
  MapPin,
  FileText,
  Printer,
} from 'lucide-react-native';
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
          {
            text: 'حسنًا',
            onPress: () => router.back(),
          },
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
          <ArrowRight size={22} color="#111827" />
        </TouchableOpacity>

        <View style={styles.headerTextWrap}>
          <Text style={styles.headerTitle}>إعدادات المحل</Text>
          <Text style={styles.headerSubtitle}>
            اسم المحل والهاتف والعنوان والترويسة والطباعة
          </Text>
        </View>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
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
            <Phone size={18} color="#6B7280" />
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
            <MapPin size={18} color="#6B7280" />
            <TextInput
              style={[styles.inputWithIcon, styles.multilineInput]}
              value={shopAddress}
              onChangeText={setShopAddress}
              placeholder="أدخل عنوان المحل"
              placeholderTextColor="#9CA3AF"
              multiline
              textAlign="right"
            />
          </View>
        </View>

        <View style={styles.extraCard}>
          <Text style={styles.extraCardTitle}>الترويسة والطباعة</Text>
          <Text style={styles.extraCardSubtitle}>
            تم نقل إعدادات الترويسة والطباعة إلى داخل إعدادات المحل لتكون أسهل وأوضح.
          </Text>

          <TouchableOpacity
            style={styles.extraLinkRow}
            onPress={() => router.push('/customer-header-settings' as any)}
          >
            <View style={styles.extraIconWrap}>
              <FileText size={18} color="#2563EB" />
            </View>
            <View style={styles.extraTextWrap}>
              <Text style={styles.extraLinkTitle}>إعدادات الترويسة</Text>
              <Text style={styles.extraLinkSubtitle}>
                تعديل الترويسة والعناصر الظاهرة أعلى الصفحة
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.extraLinkRow}
            onPress={() => router.push('/letterhead-settings' as any)}
          >
            <View style={[styles.extraIconWrap, styles.extraIconWrapGreen]}>
              <Printer size={18} color="#16A34A" />
            </View>
            <View style={styles.extraTextWrap}>
              <Text style={styles.extraLinkTitle}>إعدادات الطباعة</Text>
              <Text style={styles.extraLinkSubtitle}>
                التحكم في شكل الطباعة والتنسيق العام للسندات
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={isSaving}
          activeOpacity={0.9}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
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
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'right',
    marginRight: 8,
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
  },
  inputWithIcon: {
    flex: 1,
    fontSize: 16,
    color: '#111827',
    textAlign: 'right',
    minHeight: 52,
    marginRight: 10,
  },
  multilineInput: {
    minHeight: 90,
    textAlignVertical: 'top',
    paddingTop: 14,
  },
  extraCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  extraCardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'right',
    marginBottom: 6,
  },
  extraCardSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'right',
    lineHeight: 20,
    marginBottom: 12,
  },
  extraLinkRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginTop: 10,
  },
  extraIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  extraIconWrapGreen: {
    backgroundColor: '#ECFDF5',
  },
  extraTextWrap: {
    flex: 1,
  },
  extraLinkTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'right',
    marginBottom: 4,
  },
  extraLinkSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'right',
    lineHeight: 18,
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
    marginRight: 8,
  },
});
`;

try {
  backupFile(settingsPath);
  backupFile(shopSettingsPath);

  writeFile(settingsPath, settingsContent);
  writeFile(shopSettingsPath, shopSettingsContent);

  console.log('');
  console.log('Done successfully.');
  console.log('Next steps:');
  console.log('1) npm run typecheck');
  console.log('2) npx expo start -c');
} catch (error) {
  console.error('Patch failed:', error.message);
  process.exit(1);
}