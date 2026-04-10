import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight, Save, RotateCcw, Eye } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import {
  fetchWhatsAppTemplates,
  getAccountStatementVariables,
  getShareAccountVariables,
  generatePreviewMessage,
  WhatsAppTemplates,
} from '@/utils/whatsappTemplates';

export default function WhatsAppTemplatesScreen() {
  const router = useRouter();
  const [templates, setTemplates] = useState<WhatsAppTemplates>({
    account_statement: '',
    share_account: '',
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    try {
      const loadedTemplates = await fetchWhatsAppTemplates();
      setTemplates(loadedTemplates);
    } catch (error) {
      console.error('Error loading templates:', error);
      Alert.alert('خطأ', 'حدث خطأ أثناء تحميل القوالب');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!templates.account_statement.trim() || !templates.share_account.trim()) {
      Alert.alert('تنبيه', 'يجب ملء جميع القوالب');
      return;
    }

    setIsSaving(true);
    try {
      const FIXED_SETTINGS_ID = '00000000-0000-0000-0000-000000000000';
      const { error } = await supabase
        .from('app_settings')
        .upsert({
          id: FIXED_SETTINGS_ID,
          whatsapp_account_statement_template: templates.account_statement,
          whatsapp_share_account_template: templates.share_account,
        }, {
          onConflict: 'id'
        });

      if (error) throw error;

      Alert.alert('نجح', 'تم حفظ القوالب بنجاح', [
        { text: 'موافق', onPress: () => router.back() },
      ]);
    } catch (error) {
      console.error('Error saving templates:', error);
      Alert.alert('خطأ', 'حدث خطأ أثناء حفظ القوالب');
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetAccountStatement = () => {
    Alert.alert(
      'تأكيد',
      'هل تريد استعادة القالب الافتراضي لكشف الحساب؟',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'استعادة',
          style: 'destructive',
          onPress: () => {
            setTemplates((prev) => ({
              ...prev,
              account_statement: `مرحباً {customer_name}،

كشف حساب رقم: {account_number}
التاريخ: {date}

الأرصدة:
{balance}

شكراً لك`,
            }));
          },
        },
      ]
    );
  };

  const handleResetShareAccount = () => {
    Alert.alert(
      'تأكيد',
      'هل تريد استعادة القالب الافتراضي لمشاركة الحساب؟',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'استعادة',
          style: 'destructive',
          onPress: () => {
            setTemplates((prev) => ({
              ...prev,
              share_account: `مرحباً {customer_name}،

كشف حساب تفصيلي
رقم الحساب: {account_number}
التاريخ: {date}

{balances}

الحركات المالية:
{movements}

{shop_name}`,
            }));
          },
        },
      ]
    );
  };

  const handlePreview = (type: 'account_statement' | 'share_account') => {
    const template = type === 'account_statement' ? templates.account_statement : templates.share_account;
    const preview = generatePreviewMessage(template, type);

    Alert.alert('معاينة الرسالة', preview, [{ text: 'موافق' }], {
      cancelable: true,
    });
  };

  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <ChevronRight size={24} color="#007AFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>قوالب رسائل الواتساب</Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
        </View>
      </View>
    );
  }

  const accountStatementVars = getAccountStatementVariables();
  const shareAccountVars = getShareAccountVariables();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ChevronRight size={24} color="#007AFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>قوالب رسائل الواتساب</Text>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Account Statement Template */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>قالب كشف الحساب السريع</Text>
            <Text style={styles.sectionSubtitle}>
              يُستخدم عند إرسال رسالة واتساب سريعة من صفحة العميل
            </Text>
          </View>

          <View style={styles.templateCard}>
            <TextInput
              style={styles.textArea}
              value={templates.account_statement}
              onChangeText={(text) =>
                setTemplates((prev) => ({ ...prev, account_statement: text }))
              }
              multiline
              numberOfLines={10}
              textAlignVertical="top"
              placeholder="أدخل قالب الرسالة..."
            />

            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={styles.previewButton}
                onPress={() => handlePreview('account_statement')}
              >
                <Eye size={18} color="#007AFF" />
                <Text style={styles.previewButtonText}>معاينة</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.resetButton}
                onPress={handleResetAccountStatement}
              >
                <RotateCcw size={18} color="#FF3B30" />
                <Text style={styles.resetButtonText}>استعادة الافتراضي</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.variablesCard}>
            <Text style={styles.variablesTitle}>المتغيرات المتاحة:</Text>
            {accountStatementVars.map((variable, index) => (
              <View key={index} style={styles.variableItem}>
                <Text style={styles.variableKey}>{variable.key}</Text>
                <Text style={styles.variableDescription}>{variable.description}</Text>
                <Text style={styles.variableExample}>مثال: {variable.example}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Share Account Template */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>قالب مشاركة الحساب الكامل</Text>
            <Text style={styles.sectionSubtitle}>
              يُستخدم عند مشاركة كشف حساب تفصيلي مع جميع الحركات
            </Text>
          </View>

          <View style={styles.templateCard}>
            <TextInput
              style={styles.textArea}
              value={templates.share_account}
              onChangeText={(text) =>
                setTemplates((prev) => ({ ...prev, share_account: text }))
              }
              multiline
              numberOfLines={10}
              textAlignVertical="top"
              placeholder="أدخل قالب الرسالة..."
            />

            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={styles.previewButton}
                onPress={() => handlePreview('share_account')}
              >
                <Eye size={18} color="#007AFF" />
                <Text style={styles.previewButtonText}>معاينة</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.resetButton}
                onPress={handleResetShareAccount}
              >
                <RotateCcw size={18} color="#FF3B30" />
                <Text style={styles.resetButtonText}>استعادة الافتراضي</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.variablesCard}>
            <Text style={styles.variablesTitle}>المتغيرات المتاحة:</Text>
            {shareAccountVars.map((variable, index) => (
              <View key={index} style={styles.variableItem}>
                <Text style={styles.variableKey}>{variable.key}</Text>
                <Text style={styles.variableDescription}>{variable.description}</Text>
                <Text style={styles.variableExample}>مثال: {variable.example}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.bottomPadding} />
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={isSaving}
        >
          {isSaving ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <>
              <Save size={20} color="#FFF" />
              <Text style={styles.saveButtonText}>حفظ القوالب</Text>
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
    backgroundColor: '#F5F5F5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
    paddingTop: 16,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
    marginRight: 32,
  },
  content: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  section: {
    marginTop: 16,
  },
  sectionHeader: {
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
    textAlign: 'right',
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'right',
  },
  templateCard: {
    backgroundColor: '#FFF',
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  textArea: {
    minHeight: 200,
    maxHeight: 300,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    textAlign: 'right',
    backgroundColor: '#FAFAFA',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    gap: 12,
  },
  previewButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#007AFF',
    backgroundColor: '#F0F8FF',
  },
  previewButtonText: {
    color: '#007AFF',
    fontSize: 15,
    fontWeight: '500',
  },
  resetButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FF3B30',
    backgroundColor: '#FFF5F5',
  },
  resetButtonText: {
    color: '#FF3B30',
    fontSize: 15,
    fontWeight: '500',
  },
  variablesCard: {
    backgroundColor: '#FFF',
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 16,
  },
  variablesTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    textAlign: 'right',
  },
  variableItem: {
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  variableKey: {
    fontSize: 15,
    fontWeight: '600',
    color: '#007AFF',
    textAlign: 'right',
    marginBottom: 4,
  },
  variableDescription: {
    fontSize: 14,
    color: '#333',
    textAlign: 'right',
    marginBottom: 2,
  },
  variableExample: {
    fontSize: 13,
    color: '#666',
    textAlign: 'right',
    fontStyle: 'italic',
  },
  bottomPadding: {
    height: 100,
  },
  footer: {
    backgroundColor: '#FFF',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#E5E5E5',
  },
  saveButton: {
    backgroundColor: '#34C759',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: '#FFF',
    fontSize: 17,
    fontWeight: '600',
  },
});
