import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowRight, Download, Upload, Database, Calendar } from 'lucide-react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { fetchAccessibleCustomerIds } from '@/services/userScopeService';
import { formatDateArabic } from '@/utils/arabicFormat';

type BackupTableKey =
  | 'customers'
  | 'transactions'
  | 'debts'
  | 'account_movements'
  | 'exchange_rates';

type BackupPayload = {
  version?: string;
  timestamp?: string;
  generated_by?: Record<string, unknown>;
  data?: Partial<Record<BackupTableKey, any[]>>;
};

function asArray(payload: BackupPayload, key: BackupTableKey): any[] {
  const value = payload?.data?.[key];
  return Array.isArray(value) ? value : [];
}

function cleanRow(row: any) {
  const cleaned = { ...(row || {}) };
  delete cleaned.linked_user;
  delete cleaned.customers;
  delete cleaned.customer;
  delete cleaned.commission_recipient;
  return cleaned;
}

async function upsertRows(
  tableName: BackupTableKey,
  rows: any[],
  transform?: (row: any) => any,
) {
  const preparedRows = rows.map((row) => {
    const cleaned = cleanRow(row);
    return transform ? transform(cleaned) : cleaned;
  });

  if (preparedRows.length === 0) {
    return 0;
  }

  const chunkSize = 250;
  for (let i = 0; i < preparedRows.length; i += chunkSize) {
    const chunk = preparedRows.slice(i, i + chunkSize);
    const { error } = await supabase.from(tableName).upsert(chunk, {
      onConflict: 'id',
    });

    if (error) {
      throw error;
    }
  }

  return preparedRows.length;
}

export default function BackupScreen() {
  const router = useRouter();
  const { currentUser } = useAuth();
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [lastBackup, setLastBackup] = useState<string | null>(null);

  const handleExportData = async () => {
    setIsExporting(true);

    try {
      if (!currentUser?.userId) {
        Alert.alert('خطأ', 'يجب تسجيل الدخول أولاً');
        return;
      }

      const accessibleCustomerIds = await fetchAccessibleCustomerIds(currentUser.userId, true);

      const [customers, transactions, debts, movements, exchangeRates] = await Promise.all([
        accessibleCustomerIds.length > 0
          ? supabase.from('customers').select('*').in('id', accessibleCustomerIds)
          : Promise.resolve({ data: [], error: null } as any),
        accessibleCustomerIds.length > 0
          ? supabase.from('transactions').select('*').in('customer_id', accessibleCustomerIds)
          : Promise.resolve({ data: [], error: null } as any),
        accessibleCustomerIds.length > 0
          ? supabase.from('debts').select('*').in('customer_id', accessibleCustomerIds)
          : Promise.resolve({ data: [], error: null } as any),
        accessibleCustomerIds.length > 0
          ? supabase.from('account_movements').select('*').in('customer_id', accessibleCustomerIds)
          : Promise.resolve({ data: [], error: null } as any),
        supabase.from('exchange_rates').select('*'),
      ]);

      const firstError = [
        customers.error,
        transactions.error,
        debts.error,
        movements.error,
        exchangeRates.error,
      ].find(Boolean);

      if (firstError) {
        throw firstError;
      }

      const backupData: BackupPayload = {
        version: '2.0',
        timestamp: new Date().toISOString(),
        generated_by: {
          user_id: currentUser.userId,
          user_name: currentUser.userName,
          account_number: currentUser.accountNumber,
        },
        data: {
          customers: customers.data || [],
          transactions: transactions.data || [],
          debts: debts.data || [],
          account_movements: movements.data || [],
          exchange_rates: exchangeRates.data || [],
        },
      };

      if (!FileSystem.documentDirectory) {
        throw new Error('تعذر الوصول إلى مساحة التخزين المحلية');
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `backup_${currentUser.userName || 'user'}_${timestamp}.json`;
      const fileUri = `${FileSystem.documentDirectory}${fileName}`;

      await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(backupData, null, 2), {
        encoding: FileSystem.EncodingType.UTF8,
      });

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'application/json',
          dialogTitle: 'مشاركة النسخة الاحتياطية',
          UTI: 'public.json',
        });
      }

      Alert.alert(
        'نجح',
        canShare
          ? 'تم إنشاء النسخة الاحتياطية ومشاركتها بنجاح.'
          : `تم إنشاء النسخة الاحتياطية بنجاح.\n\nمسار الملف:\n${fileUri}`,
        [{ text: 'حسنًا' }],
      );

      setLastBackup(new Date().toISOString());
      console.log('Backup data created:', fileUri);
    } catch (error) {
      console.error('Error exporting data:', error);
      Alert.alert('خطأ', 'حدث خطأ أثناء تصدير البيانات');
    } finally {
      setIsExporting(false);
    }
  };

  const importBackupFile = async () => {
    if (!currentUser?.userId) {
      Alert.alert('خطأ', 'يجب تسجيل الدخول أولاً');
      return;
    }

    setIsImporting(true);

    try {
      const pickerResult = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (pickerResult.canceled) {
        return;
      }

      const selectedFile = pickerResult.assets?.[0];
      if (!selectedFile?.uri) {
        Alert.alert('خطأ', 'لم يتم اختيار ملف صالح');
        return;
      }

      const fileContent = await FileSystem.readAsStringAsync(selectedFile.uri, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      const backupData = JSON.parse(fileContent) as BackupPayload;

      if (!backupData?.data || typeof backupData.data !== 'object') {
        Alert.alert('خطأ', 'ملف النسخة الاحتياطية غير صالح');
        return;
      }

      const customers = asArray(backupData, 'customers');
      const transactions = asArray(backupData, 'transactions');
      const debts = asArray(backupData, 'debts');
      const movements = asArray(backupData, 'account_movements');
      const exchangeRates = asArray(backupData, 'exchange_rates');

      const importedCustomers = await upsertRows('customers', customers, (row) => ({
        ...row,
        user_id: currentUser.userId,
      }));

      const importedExchangeRates = await upsertRows('exchange_rates', exchangeRates);
      const importedMovements = await upsertRows('account_movements', movements);
      const importedTransactions = await upsertRows('transactions', transactions);
      const importedDebts = await upsertRows('debts', debts);

      Alert.alert(
        'تم الاستيراد',
        `تم استيراد البيانات بنجاح:\n\n` +
          `• العملاء: ${importedCustomers}\n` +
          `• الحركات: ${importedMovements}\n` +
          `• الحوالات: ${importedTransactions}\n` +
          `• الديون: ${importedDebts}\n` +
          `• أسعار الصرف: ${importedExchangeRates}`,
        [{ text: 'حسنًا' }],
      );
    } catch (error: any) {
      console.error('Error importing data:', error);
      Alert.alert(
        'خطأ',
        error?.message
          ? `حدث خطأ أثناء استيراد البيانات:\n${error.message}`
          : 'حدث خطأ أثناء استيراد البيانات',
      );
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportData = () => {
    Alert.alert(
      'استيراد البيانات',
      'سيتم اختيار ملف JSON واستيراد البيانات منه. إذا كانت بعض البيانات موجودة مسبقًا سيتم تحديثها بدل تكرارها. هل تريد المتابعة؟',
      [
        { text: 'إلغاء', style: 'cancel' },
        { text: 'اختيار ملف', onPress: importBackupFile },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ArrowRight size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>النسخ الاحتياطي</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.content}>
        <View style={styles.infoCard}>
          <Database size={48} color="#4F46E5" />
          <Text style={styles.infoTitle}>النسخ الاحتياطي للبيانات</Text>
          <Text style={styles.infoText}>
            يمكنك الآن تصدير نسخة JSON فعلية من بياناتك أو استيراد نسخة محفوظة سابقًا.
            يتم تضمين واستعادة البيانات التابعة للحساب الحالي فقط.
          </Text>

          {lastBackup && (
            <View style={styles.lastBackupContainer}>
              <Calendar size={16} color="#6B7280" />
              <Text style={styles.lastBackupText}>
                آخر نسخة احتياطية: {formatDateArabic(lastBackup)}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.actionsSection}>
          <TouchableOpacity
            style={[styles.actionCard, { backgroundColor: '#EEF2FF' }]}
            onPress={handleExportData}
            disabled={isExporting || isImporting}
          >
            {isExporting ? (
              <ActivityIndicator color="#4F46E5" />
            ) : (
              <Download size={40} color="#4F46E5" />
            )}
            <Text style={styles.actionTitle}>تصدير البيانات</Text>
            <Text style={styles.actionDescription}>
              {isExporting ? 'جاري التصدير...' : 'تصدير ومشاركة نسخة JSON'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionCard, { backgroundColor: '#ECFDF5' }]}
            onPress={handleImportData}
            disabled={isExporting || isImporting}
          >
            {isImporting ? (
              <ActivityIndicator color="#10B981" />
            ) : (
              <Upload size={40} color="#10B981" />
            )}
            <Text style={styles.actionTitle}>استيراد البيانات</Text>
            <Text style={styles.actionDescription}>
              {isImporting ? 'جاري الاستيراد...' : 'استعادة البيانات من نسخة احتياطية'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.warningCard}>
          <Text style={styles.warningTitle}>تنبيه هام</Text>
          <Text style={styles.warningText}>
            • احتفظ بنسخ احتياطية منتظمة من بياناتك{`\n`}
            • احفظ الملفات في مكان آمن{`\n`}
            • تأكد من صحة البيانات قبل الاستيراد{`\n`}
            • الاستيراد يحدّث البيانات الموجودة ولا يكررها إذا كانت بنفس المعرف{`\n`}
            • لا تشارك ملفات النسخ الاحتياطي مع جهات غير موثوقة
          </Text>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
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
  infoCard: {
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
  infoTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
    marginTop: 16,
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
  },
  lastBackupContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    padding: 12,
    backgroundColor: '#F9FAFB',
    borderRadius: 8,
  },
  lastBackupText: {
    fontSize: 14,
    color: '#6B7280',
  },
  actionsSection: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  actionCard: {
    flex: 1,
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#111827',
    marginTop: 12,
    marginBottom: 8,
    textAlign: 'center',
  },
  actionDescription: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
  },
  warningCard: {
    backgroundColor: '#FEF3C7',
    margin: 16,
    padding: 20,
    borderRadius: 16,
  },
  warningTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#92400E',
    marginBottom: 12,
    textAlign: 'right',
  },
  warningText: {
    fontSize: 14,
    color: '#78350F',
    lineHeight: 22,
    textAlign: 'right',
  },
});
