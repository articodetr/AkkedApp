import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  RefreshControl,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowRight, Users, Trash2, Shield, User, Info } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import * as Haptics from 'expo-haptics';
import { format } from 'date-fns';

interface UserData {
  id: string;
  user_name: string | null;
  email: string | null;
  full_name: string | null;
  account_number: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_login: string | null;
}

export default function UsersManagement() {
  const router = useRouter();
  const { currentUser } = useAuth();
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const isAdmin = currentUser?.role === 'admin';

  const loadUsers = useCallback(async () => {
    try {
      let query = supabase
        .from('app_security')
        .select(
          'id, user_name, email, full_name, account_number, role, is_active, created_at, updated_at, last_login'
        );

      // غير المدير يرى حسابه فقط
      if (!isAdmin && currentUser) {
        query = query.eq('id', currentUser.userId);
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) throw error;
      setUsers((data as UserData[]) || []);
    } catch (error) {
      console.error('Error loading users:', error);
      Alert.alert('خطأ', 'فشل تحميل المستخدمين');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isAdmin, currentUser]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadUsers();
  }, [loadUsers]);

  const handleDeleteUser = (user: UserData) => {
    if (currentUser?.userId === user.id) {
      Alert.alert('غير مسموح', 'لا يمكنك حذف حسابك الحالي');
      return;
    }

    if (!isAdmin) {
      Alert.alert('غير مصرح', 'ليس لديك صلاحية حذف المستخدمين');
      return;
    }

    Alert.alert(
      'تأكيد الحذف',
      `هل أنت متأكد من حذف ملف المستخدم "${user.full_name || user.email || user.user_name}"؟\n\n` +
        'ملاحظة: هذا يحذف ملف المستخدم وبياناته فقط. لحذف حساب الدخول نهائياً ' +
        'يجب حذفه من لوحة تحكم Supabase.',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'حذف',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('app_security')
                .delete()
                .eq('id', user.id);

              if (error) throw error;

              if (Platform.OS !== 'web') {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }

              Alert.alert('نجح', 'تم حذف ملف المستخدم بنجاح');
              await loadUsers();
            } catch (error) {
              console.error('Error deleting user:', error);
              Alert.alert('خطأ', 'فشل حذف المستخدم');
            }
          },
        },
      ]
    );
  };

  const renderUserCard = (user: UserData) => {
    const isOwnAccount = currentUser?.userId === user.id;
    const canDelete = isAdmin && !isOwnAccount;

    return (
      <View key={user.id} style={styles.userCard}>
        <View style={styles.userCardHeader}>
          <View style={styles.userIconContainer}>
            {user.role === 'admin' ? (
              <Shield size={24} color="#10B981" />
            ) : (
              <User size={24} color="#6B7280" />
            )}
          </View>
          <View style={styles.userInfo}>
            <View style={styles.userNameRow}>
              <Text style={styles.userName}>{user.full_name || 'مستخدم'}</Text>
              {user.role === 'admin' && (
                <View style={styles.adminBadge}>
                  <Text style={styles.adminBadgeText}>مدير</Text>
                </View>
              )}
              {isOwnAccount && (
                <View style={[styles.adminBadge, { backgroundColor: '#3B82F6' }]}>
                  <Text style={styles.adminBadgeText}>أنت</Text>
                </View>
              )}
            </View>
            <Text style={styles.userSubtitle}>
              {user.email || user.user_name || '—'}
              {user.account_number ? ` • رقم الحساب: ${user.account_number}` : ''}
            </Text>
            <Text style={styles.userDate}>
              تاريخ الإنشاء: {format(new Date(user.created_at), 'yyyy/MM/dd')}
            </Text>
            {user.last_login && (
              <Text style={styles.userDate}>
                آخر دخول: {format(new Date(user.last_login), 'yyyy/MM/dd HH:mm')}
              </Text>
            )}
          </View>
        </View>

        {canDelete && (
          <View style={styles.userActions}>
            <TouchableOpacity
              style={[styles.actionButton, styles.deleteButton]}
              onPress={() => handleDeleteUser(user)}
            >
              <Trash2 size={18} color="#EF4444" />
              <Text style={styles.deleteButtonText}>حذف الملف</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <ArrowRight size={24} color="#111827" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>إدارة المستخدمين</Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4F46E5" />
          <Text style={styles.loadingText}>جاري التحميل...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowRight size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>إدارة المستخدمين</Text>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.statsCard}>
          <Users size={32} color="#4F46E5" />
          <Text style={styles.statsNumber}>{users.length}</Text>
          <Text style={styles.statsLabel}>{isAdmin ? 'مستخدم مسجل' : 'حسابي'}</Text>
        </View>

        <View style={styles.infoCard}>
          <Info size={20} color="#3730A3" />
          <Text style={styles.infoText}>
            أصبح إنشاء الحسابات يتم عبر التسجيل بالبريد الإلكتروني أو Google.
            لتغيير كلمة المرور استخدم "نسيت كلمة المرور؟" في شاشة الدخول.
          </Text>
        </View>

        {users.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Users size={64} color="#D1D5DB" />
            <Text style={styles.emptyText}>لا يوجد مستخدمين</Text>
          </View>
        ) : (
          <View style={styles.usersContainer}>{users.map(renderUserCard)}</View>
        )}
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
    alignItems: 'center',
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
    flex: 1,
    textAlign: 'right',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    color: '#6B7280',
  },
  content: {
    flex: 1,
  },
  statsCard: {
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
  statsNumber: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#111827',
    marginTop: 12,
  },
  statsLabel: {
    fontSize: 16,
    color: '#6B7280',
    marginTop: 4,
  },
  infoCard: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    backgroundColor: '#EEF2FF',
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 14,
    borderRadius: 12,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: '#3730A3',
    lineHeight: 21,
    textAlign: 'right',
  },
  usersContainer: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  userCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  userCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  userInfo: {
    flex: 1,
  },
  userNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  userName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#111827',
  },
  userSubtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 4,
    textAlign: 'right',
  },
  adminBadge: {
    backgroundColor: '#10B981',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  adminBadgeText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  userDate: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'right',
  },
  userActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 8,
  },
  deleteButton: {
    backgroundColor: '#FEE2E2',
  },
  deleteButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#EF4444',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
    marginTop: 16,
  },
});
