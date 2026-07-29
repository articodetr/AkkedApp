import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  ArrowRight,
  Building2,
  Pencil,
  Plus,
  Power,
  Trash2,
  Waypoints,
} from 'lucide-react-native';

import TransferEntityFormSheet from '@/components/TransferEntityFormSheet';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { TransferEntity } from '@/types/database';

export default function ManageTransferEntitiesScreen() {
  const router = useRouter();
  const { currentUser } = useAuth();

  const [entities, setEntities] = useState<TransferEntity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingEntity, setEditingEntity] = useState<TransferEntity | null>(null);

  const loadEntities = useCallback(async () => {
    if (!currentUser?.userId) {
      setEntities([]);
      setIsLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('transfer_entities')
        .select('*')
        .eq('user_id', currentUser.userId)
        .order('is_active', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;
      setEntities((data as TransferEntity[]) || []);
    } catch (error) {
      console.error('Error loading transfer entities:', error);
      Alert.alert('خطأ', 'حدث خطأ أثناء تحميل الجهات والشبكات');
    } finally {
      setIsLoading(false);
    }
  }, [currentUser?.userId]);

  useEffect(() => {
    loadEntities();
  }, [loadEntities]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadEntities();
    setRefreshing(false);
  };

  const openAddForm = () => {
    setEditingEntity(null);
    setShowForm(true);
  };

  const openEditForm = (entity: TransferEntity) => {
    setEditingEntity(entity);
    setShowForm(true);
  };

  const toggleActive = async (entity: TransferEntity) => {
    if (!currentUser?.userId) return;

    try {
      const { error } = await supabase
        .from('transfer_entities')
        .update({ is_active: !entity.is_active })
        .eq('id', entity.id)
        .eq('user_id', currentUser.userId);

      if (error) throw error;
      await loadEntities();
    } catch (error) {
      console.error('Error toggling transfer entity:', error);
      Alert.alert('خطأ', 'حدث خطأ أثناء تغيير الحالة');
    }
  };

  const confirmDelete = (entity: TransferEntity) => {
    Alert.alert(
      'حذف نهائي',
      `هل تريد حذف "${entity.name}" نهائياً؟\nإذا كنت تريد إيقافها مؤقتاً فقط، استخدم زر الإيقاف بدلاً من الحذف.`,
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'حذف',
          style: 'destructive',
          onPress: () => deleteEntity(entity),
        },
      ],
    );
  };

  const deleteEntity = async (entity: TransferEntity) => {
    if (!currentUser?.userId) return;

    try {
      const { error } = await supabase
        .from('transfer_entities')
        .delete()
        .eq('id', entity.id)
        .eq('user_id', currentUser.userId);

      if (error) throw error;
      await loadEntities();
    } catch (error: any) {
      // 23503: الجهة مرتبطة بسجلات أخرى — الحذف ممنوع.
      if (error?.code === '23503') {
        Alert.alert(
          'لا يمكن الحذف',
          'هذه الجهة مستخدمة في سجلات أخرى. يمكنك إيقافها بدلاً من حذفها.',
        );
      } else if (typeof error?.message === 'string' && /[؀-ۿ]/.test(error.message)) {
        // رسائل عربية صريحة من القاعدة (مثل منع حذف جهة لها حركات تسوية)
        Alert.alert('لا يمكن الحذف', error.message);
      } else {
        console.error('Error deleting transfer entity:', error);
        Alert.alert('خطأ', 'حدث خطأ أثناء الحذف');
      }
    }
  };

  const renderEntity = ({ item }: { item: TransferEntity }) => {
    const Icon = item.entity_type === 'network' ? Waypoints : Building2;
    const typeLabel = item.entity_type === 'network' ? 'شبكة تحويل' : 'جهة';

    return (
      <TouchableOpacity
        style={[styles.card, !item.is_active && styles.cardInactive]}
        onPress={() => openEditForm(item)}
        activeOpacity={0.8}
      >
        <View style={[styles.iconCircle, !item.is_active && styles.iconCircleInactive]}>
          <Icon size={24} color={item.is_active ? '#0EA5E9' : '#9CA3AF'} />
        </View>

        <View style={styles.cardBody}>
          <View style={styles.cardTitleRow}>
            <Text style={[styles.cardTitle, !item.is_active && styles.cardTitleInactive]}>
              {item.name}
            </Text>
            {!item.is_active && (
              <View style={styles.inactiveBadge}>
                <Text style={styles.inactiveBadgeText}>متوقفة</Text>
              </View>
            )}
          </View>
          <Text style={styles.cardSubtitle}>
            {typeLabel}
            {item.phone ? ` • ${item.phone}` : ''}
          </Text>
          {item.address ? <Text style={styles.cardMeta}>{item.address}</Text> : null}
        </View>

        <View style={styles.cardActions}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => openEditForm(item)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Pencil size={18} color="#6B7280" />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => toggleActive(item)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Power size={18} color={item.is_active ? '#10B981' : '#9CA3AF'} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => confirmDelete(item)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Trash2 size={18} color="#EF4444" />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ArrowRight size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>إدارة الجهات والشبكات</Text>
        <TouchableOpacity style={styles.headerAddButton} onPress={openAddForm}>
          <Plus size={22} color="#0EA5E9" />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#0EA5E9" />
          <Text style={styles.loadingText}>جاري التحميل...</Text>
        </View>
      ) : (
        <FlatList
          data={entities}
          renderItem={renderEntity}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconCircle}>
                <Waypoints size={40} color="#0EA5E9" />
              </View>
              <Text style={styles.emptyText}>لا توجد جهات أو شبكات مضافة حالياً</Text>
              <TouchableOpacity style={styles.addButton} onPress={openAddForm} activeOpacity={0.8}>
                <Plus size={20} color="#FFFFFF" />
                <Text style={styles.addButtonText}>إضافة جهة أو شبكة</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}

      {!isLoading && entities.length > 0 && (
        <View style={styles.footer}>
          <TouchableOpacity style={styles.addButton} onPress={openAddForm} activeOpacity={0.8}>
            <Plus size={20} color="#FFFFFF" />
            <Text style={styles.addButtonText}>إضافة جهة أو شبكة</Text>
          </TouchableOpacity>
        </View>
      )}

      <TransferEntityFormSheet
        visible={showForm}
        entity={editingEntity}
        onClose={() => {
          setShowForm(false);
          setEditingEntity(null);
        }}
        onSaved={loadEntities}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    direction: 'rtl',
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
    fontSize: 18,
    fontWeight: 'bold',
    color: '#111827',
    textAlign: 'center',
  },
  headerAddButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
    backgroundColor: '#0EA5E915',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: '#6B7280',
  },
  listContent: {
    padding: 16,
    gap: 10,
    flexGrow: 1,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardInactive: {
    opacity: 0.75,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#0EA5E915',
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconCircleInactive: {
    backgroundColor: '#F3F4F6',
  },
  cardBody: {
    flex: 1,
    gap: 2,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#111827',
    textAlign: 'right',
  },
  cardTitleInactive: {
    color: '#6B7280',
  },
  inactiveBadge: {
    backgroundColor: '#FEF3C7',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  inactiveBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#B45309',
  },
  cardSubtitle: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'right',
  },
  cardMeta: {
    fontSize: 11,
    color: '#9CA3AF',
    textAlign: 'right',
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F9FAFB',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#0EA5E915',
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
  },
  footer: {
    padding: 16,
    paddingTop: 8,
    backgroundColor: '#F9FAFB',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#0EA5E9',
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 24,
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
});
