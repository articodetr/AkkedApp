import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowRight, FolderInput, User, CheckCircle } from 'lucide-react-native';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

interface LegacyAccount {
  id: string;
  user_name: string | null;
  full_name: string | null;
  account_number: string | null;
  role: string | null;
  created_at: string;
}

export default function LinkLegacyDataScreen() {
  const router = useRouter();
  const { currentUser } = useAuth();
  const [accounts, setAccounts] = useState<LegacyAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('get_legacy_accounts');
      if (error) throw error;
      setAccounts((data as LegacyAccount[]) || []);
    } catch (error) {
      console.error('Error loading legacy accounts:', error);
      Alert.alert('خطأ', 'تعذّر تحميل الحسابات القديمة');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadAccounts();
  }, [loadAccounts]);

  const handleLink = (account: LegacyAccount) => {
    if (!currentUser?.userId) {
      Alert.alert('خطأ', 'لم يتم تحديد حسابك الحالي');
      return;
    }

    Alert.alert(
      'تأكيد ربط البيانات',
      `سيتم نقل جميع بيانات الحساب القديم "${account.full_name || account.user_name}" ` +
        `(رقم ${account.account_number}) إلى حسابك الحالي.\n\n` +
        'هذا الإجراء يشمل العملاء والحركات والإعدادات. لا يمكن التراجع عنه بسهولة.',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'ربط البيانات',
          style: 'destructive',
          onPress: async () => {
            setLinkingId(account.id);
            try {
              const { data, error } = await supabase.rpc('admin_relink_user_data', {
                p_old_user_id: account.id,
                p_new_user_id: currentUser.userId,
              });

              if (error) throw error;

              const result = data as { success: boolean; message?: string; updated_rows?: number };
              if (result?.success) {
                Alert.alert(
                  'تم بنجاح',
                  `تم ربط البيانات بحسابك.\nعدد السجلات المنقولة: ${result.updated_rows ?? 0}`,
                  [{ text: 'حسناً', onPress: () => loadAccounts() }]
                );
              } else {
                Alert.alert('خطأ', result?.message || 'تعذّر ربط البيانات');
              }
            } catch (error) {
              console.error('Error linking data:', error);
              Alert.alert('خطأ', 'حدث خطأ أثناء ربط البيانات');
            } finally {
              setLinkingId(null);
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowRight size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>ربط البيانات القديمة</Text>
      </View>

      {loading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color="#4F46E5" />
          <Text style={styles.loadingText}>جاري التحميل...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <View style={styles.infoCard}>
            <FolderInput size={28} color="#4F46E5" />
            <Text style={styles.infoText}>
              إذا كان لديك حساب قديم في التطبيق (باسم مستخدم)، اختره من القائمة لنقل
              عملائك وحركاتك وإعداداتك إلى حسابك الجديد.
            </Text>
          </View>

          <View style={styles.currentCard}>
            <Text style={styles.currentLabel}>حسابك الحالي</Text>
            <Text style={styles.currentName}>{currentUser?.fullName || 'المستخدم'}</Text>
            <Text style={styles.currentSub}>
              {currentUser?.email}
              {currentUser?.accountNumber ? `  •  رقم ${currentUser.accountNumber}` : ''}
            </Text>
          </View>

          {accounts.length === 0 ? (
            <View style={styles.emptyBox}>
              <CheckCircle size={56} color="#10B981" />
              <Text style={styles.emptyTitle}>لا توجد حسابات قديمة</Text>
              <Text style={styles.emptySub}>
                جميع الحسابات مرتبطة بنظام تسجيل الدخول الجديد.
              </Text>
            </View>
          ) : (
            <View style={styles.list}>
              <Text style={styles.listTitle}>الحسابات القديمة المتاحة</Text>
              {accounts.map((account) => (
                <View key={account.id} style={styles.accountCard}>
                  <View style={styles.accountIcon}>
                    <User size={22} color="#6B7280" />
                  </View>
                  <View style={styles.accountInfo}>
                    <Text style={styles.accountName}>
                      {account.full_name || account.user_name || 'مستخدم'}
                    </Text>
                    <Text style={styles.accountSub}>
                      {account.user_name ? `${account.user_name}  •  ` : ''}
                      رقم {account.account_number || '—'}
                    </Text>
                    <Text style={styles.accountDate}>
                      أُنشئ في {format(new Date(account.created_at), 'yyyy/MM/dd')}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.linkButton, linkingId === account.id && styles.linkButtonDisabled]}
                    onPress={() => handleLink(account)}
                    disabled={linkingId !== null}
                  >
                    {linkingId === account.id ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={styles.linkButtonText}>ربط</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
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
    alignItems: 'center',
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#111827',
    flex: 1,
    textAlign: 'right',
  },
  centerBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 15,
    color: '#6B7280',
  },
  content: {
    flex: 1,
  },
  infoCard: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: '#EEF2FF',
    margin: 16,
    padding: 16,
    borderRadius: 12,
    alignItems: 'flex-start',
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    color: '#3730A3',
    lineHeight: 22,
    textAlign: 'right',
  },
  currentCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  currentLabel: {
    fontSize: 13,
    color: '#9CA3AF',
    marginBottom: 4,
    textAlign: 'right',
  },
  currentName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#111827',
    textAlign: 'right',
  },
  currentSub: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
    textAlign: 'right',
  },
  emptyBox: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#111827',
  },
  emptySub: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 21,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  listTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 12,
    textAlign: 'right',
  },
  accountCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    gap: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  accountIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  accountInfo: {
    flex: 1,
  },
  accountName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'right',
  },
  accountSub: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
    textAlign: 'right',
  },
  accountDate: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 2,
    textAlign: 'right',
  },
  linkButton: {
    backgroundColor: '#4F46E5',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 64,
    alignItems: 'center',
  },
  linkButtonDisabled: {
    opacity: 0.6,
  },
  linkButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
