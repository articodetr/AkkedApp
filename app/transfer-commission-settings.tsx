import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BadgePercent,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react-native';

import TransferCommissionRuleFormSheet from '@/components/TransferCommissionRuleFormSheet';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  CURRENCIES,
  TransferCommissionCalculationType,
  TransferCommissionRule,
} from '@/types/database';

const CALCULATION_LABELS: Record<TransferCommissionCalculationType, string> = {
  fixed: 'مبلغ ثابت',
  percentage: 'نسبة مئوية',
  per_thousand: 'لكل ألف',
  per_million: 'لكل مليون',
};

function formatNumber(value: number | null | undefined) {
  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue)) return '0';

  return numericValue.toLocaleString('en-US', {
    maximumFractionDigits: 4,
  });
}

function getValueUnit(rule: TransferCommissionRule) {
  if (rule.calculation_type === 'fixed') {
    return CURRENCIES.find((item) => item.code === rule.currency)?.symbol || rule.currency;
  }

  if (rule.calculation_type === 'percentage') return '%';
  if (rule.calculation_type === 'per_thousand') return 'لكل ألف';
  return 'لكل مليون';
}

function getRangeLabel(rule: TransferCommissionRule) {
  const min = formatNumber(rule.min_amount);
  const max =
    rule.max_amount === null || rule.max_amount === undefined
      ? 'بدون حد أعلى'
      : formatNumber(rule.max_amount);

  return `من ${min} إلى ${max} ${rule.currency}`;
}

export default function TransferCommissionSettingsScreen() {
  const router = useRouter();
  const { currentUser } = useAuth();

  const [rules, setRules] = useState<TransferCommissionRule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<TransferCommissionRule | null>(null);
  const [updatingRuleId, setUpdatingRuleId] = useState<string | null>(null);

  const activeRulesCount = useMemo(
    () => rules.filter((rule) => rule.is_active).length,
    [rules],
  );

  const loadRules = useCallback(async () => {
    if (!currentUser?.userId) {
      setRules([]);
      setIsLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('transfer_commission_rules')
        .select('*')
        .eq('user_id', currentUser.userId)
        .order('is_active', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;
      setRules((data as TransferCommissionRule[]) || []);
    } catch (error) {
      console.error('Error loading transfer commission rules:', error);
      Alert.alert('خطأ', 'حدث خطأ أثناء تحميل قواعد العمولة');
    } finally {
      setIsLoading(false);
    }
  }, [currentUser?.userId]);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadRules();
    setRefreshing(false);
  };

  const openAddForm = () => {
    setEditingRule(null);
    setShowForm(true);
  };

  const openEditForm = (rule: TransferCommissionRule) => {
    setEditingRule(rule);
    setShowForm(true);
  };

  const toggleRule = async (rule: TransferCommissionRule) => {
    if (!currentUser?.userId || updatingRuleId) return;

    setUpdatingRuleId(rule.id);

    try {
      const { error } = await supabase
        .from('transfer_commission_rules')
        .update({ is_active: !rule.is_active })
        .eq('id', rule.id)
        .eq('user_id', currentUser.userId);

      if (error) throw error;
      setRules((currentRules) =>
        currentRules.map((currentRule) =>
          currentRule.id === rule.id
            ? { ...currentRule, is_active: !currentRule.is_active }
            : currentRule,
        ),
      );
    } catch (error: any) {
      if (
        error?.code === '23P01' ||
        error?.code === '23505' ||
        error?.code === 'P0001' ||
        String(error?.message || '').includes('تداخل')
      ) {
        Alert.alert(
          'تعذر التفعيل',
          'توجد قاعدة فعّالة تتداخل مع هذه القاعدة في الاتجاه والعملة ونطاق المبلغ.',
        );
      } else {
        console.error('Error toggling transfer commission rule:', error);
        Alert.alert('خطأ', 'حدث خطأ أثناء تغيير حالة القاعدة');
      }
    } finally {
      setUpdatingRuleId(null);
    }
  };

  const deleteRule = async (rule: TransferCommissionRule) => {
    if (!currentUser?.userId || updatingRuleId) return;

    setUpdatingRuleId(rule.id);

    try {
      const { error } = await supabase
        .from('transfer_commission_rules')
        .delete()
        .eq('id', rule.id)
        .eq('user_id', currentUser.userId);

      if (error) throw error;
      setRules((currentRules) => currentRules.filter((item) => item.id !== rule.id));
    } catch (error: any) {
      if (error?.code === '23503') {
        Alert.alert(
          'لا يمكن الحذف',
          'هذه القاعدة مستخدمة في حوالات سابقة. يمكنك إيقافها بدلاً من حذفها.',
        );
      } else {
        console.error('Error deleting transfer commission rule:', error);
        Alert.alert('خطأ', 'حدث خطأ أثناء حذف قاعدة العمولة');
      }
    } finally {
      setUpdatingRuleId(null);
    }
  };

  const confirmDelete = (rule: TransferCommissionRule) => {
    Alert.alert(
      'حذف قاعدة العمولة',
      'هل تريد حذف هذه القاعدة نهائياً؟ يمكنك إيقافها إذا كنت تريد الاحتفاظ بها.',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'حذف',
          style: 'destructive',
          onPress: () => deleteRule(rule),
        },
      ],
    );
  };

  const renderRule = ({ item }: { item: TransferCommissionRule }) => {
    const DirectionIcon = item.direction === 'send' ? ArrowUpRight : ArrowDownLeft;
    const directionLabel = item.direction === 'send' ? 'إرسال' : 'استلام';
    const unit = getValueUnit(item);
    const isUpdating = updatingRuleId === item.id;
    const actionsDisabled = Boolean(updatingRuleId);

    return (
      <View style={[styles.ruleCard, !item.is_active && styles.ruleCardInactive]}>
        <View style={styles.cardHeader}>
          <View
            style={[
              styles.directionIcon,
              item.direction === 'send'
                ? styles.sendDirectionIcon
                : styles.receiveDirectionIcon,
            ]}
          >
            <DirectionIcon
              size={21}
              color={item.direction === 'send' ? '#EF4444' : '#10B981'}
            />
          </View>

          <View style={styles.cardTitleContainer}>
            <View style={styles.titleRow}>
              <Text style={styles.cardTitle}>
                {directionLabel} • {item.currency}
              </Text>
              {!item.is_active ? (
                <View style={styles.inactiveBadge}>
                  <Text style={styles.inactiveBadgeText}>متوقفة</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.rangeText}>{getRangeLabel(item)}</Text>
          </View>

          {isUpdating ? (
            <View style={styles.switchPlaceholder}>
              <ActivityIndicator size="small" color="#4F46E5" />
            </View>
          ) : (
            <Switch
              value={item.is_active}
              onValueChange={() => toggleRule(item)}
              disabled={actionsDisabled}
              trackColor={{ false: '#D1D5DB', true: '#4F46E5' }}
              thumbColor="#FFFFFF"
            />
          )}
        </View>

        <View style={styles.calculationBadge}>
          <BadgePercent size={15} color="#4F46E5" />
          <Text style={styles.calculationBadgeText}>
            {CALCULATION_LABELS[item.calculation_type]}
          </Text>
        </View>

        <View style={styles.valuesContainer}>
          <View style={styles.valueBox}>
            <Text style={styles.valueLabel}>عمولة العميل</Text>
            <Text style={styles.customerValue}>
              {formatNumber(item.customer_value)} {unit}
            </Text>
          </View>

          <View style={styles.valueDivider} />

          <View style={styles.valueBox}>
            <Text style={styles.valueLabel}>عمولة الشبكة</Text>
            <Text style={styles.networkValue}>
              {formatNumber(item.network_value)} {unit}
            </Text>
          </View>
        </View>

        <View style={styles.cardActions}>
          <TouchableOpacity
            style={styles.editButton}
            onPress={() => openEditForm(item)}
            disabled={actionsDisabled}
            activeOpacity={0.8}
          >
            <Pencil size={17} color="#4F46E5" />
            <Text style={styles.editButtonText}>تعديل</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.deleteButton}
            onPress={() => confirmDelete(item)}
            disabled={actionsDisabled}
            activeOpacity={0.8}
          >
            <Trash2 size={17} color="#EF4444" />
            <Text style={styles.deleteButtonText}>حذف</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const listHeader = (
    <View>
      <View style={styles.summaryCard}>
        <View style={styles.summaryIcon}>
          <BadgePercent size={27} color="#4F46E5" />
        </View>
        <View style={styles.summaryText}>
          <Text style={styles.summaryTitle}>قواعد عمولة الحوالات</Text>
          <Text style={styles.summaryDescription}>
            تُطبّق القاعدة المطابقة تلقائياً حسب نوع الحوالة والعملة ونطاق المبلغ.
          </Text>
          {rules.length > 0 ? (
            <Text style={styles.summaryCount}>
              {activeRulesCount} مفعّلة من أصل {rules.length}
            </Text>
          ) : null}
        </View>
      </View>

      {rules.length > 0 ? <Text style={styles.listTitle}>القواعد المحفوظة</Text> : null}
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ArrowRight size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>عمولات الحوالات</Text>
        <TouchableOpacity style={styles.headerAddButton} onPress={openAddForm}>
          <Plus size={22} color="#4F46E5" />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4F46E5" />
          <Text style={styles.loadingText}>جاري تحميل قواعد العمولة...</Text>
        </View>
      ) : (
        <FlatList
          data={rules}
          renderItem={renderRule}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.itemSeparator} />}
          ListHeaderComponent={listHeader}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#4F46E5"
              colors={['#4F46E5']}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconCircle}>
                <BadgePercent size={38} color="#4F46E5" />
              </View>
              <Text style={styles.emptyTitle}>لا توجد قواعد عمولة</Text>
              <Text style={styles.emptyText}>
                أضف قاعدة ليتم اقتراح عمولة العميل والشبكة تلقائياً عند إنشاء حوالة.
              </Text>
              <TouchableOpacity style={styles.addButton} onPress={openAddForm} activeOpacity={0.85}>
                <Plus size={20} color="#FFFFFF" />
                <Text style={styles.addButtonText}>إضافة أول قاعدة</Text>
              </TouchableOpacity>
            </View>
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      {!isLoading && rules.length > 0 ? (
        <View style={styles.footer}>
          <TouchableOpacity style={styles.addButton} onPress={openAddForm} activeOpacity={0.85}>
            <Plus size={20} color="#FFFFFF" />
            <Text style={styles.addButtonText}>إضافة قاعدة جديدة</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <TransferCommissionRuleFormSheet
        visible={showForm}
        rule={editingRule}
        onClose={() => {
          setShowForm(false);
          setEditingRule(null);
        }}
        onSaved={loadRules}
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
    minHeight: 66,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 18,
    paddingVertical: 12,
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
    fontSize: 19,
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
    backgroundColor: '#EEF2FF',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#6B7280',
    fontSize: 14,
  },
  listContent: {
    padding: 16,
    paddingBottom: 28,
    flexGrow: 1,
  },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 18,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  summaryIcon: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryText: {
    flex: 1,
  },
  summaryTitle: {
    color: '#111827',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  summaryDescription: {
    color: '#6B7280',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'right',
    marginTop: 4,
  },
  summaryCount: {
    color: '#4F46E5',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
    marginTop: 7,
  },
  listTitle: {
    color: '#374151',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'right',
    marginBottom: 10,
  },
  itemSeparator: {
    height: 10,
  },
  ruleCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  ruleCardInactive: {
    opacity: 0.72,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  directionIcon: {
    width: 43,
    height: 43,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDirectionIcon: {
    backgroundColor: '#FEE2E2',
  },
  receiveDirectionIcon: {
    backgroundColor: '#ECFDF5',
  },
  cardTitleContainer: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  cardTitle: {
    color: '#111827',
    fontSize: 15,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  rangeText: {
    color: '#6B7280',
    fontSize: 11,
    textAlign: 'right',
    marginTop: 3,
  },
  inactiveBadge: {
    backgroundColor: '#FEF3C7',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  inactiveBadgeText: {
    color: '#B45309',
    fontSize: 9,
    fontWeight: '700',
  },
  switchPlaceholder: {
    width: 48,
    alignItems: 'center',
  },
  calculationBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#EEF2FF',
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 5,
    marginTop: 12,
  },
  calculationBadgeText: {
    color: '#4338CA',
    fontSize: 11,
    fontWeight: '700',
  },
  valuesContainer: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    paddingVertical: 11,
    marginTop: 10,
  },
  valueBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  valueDivider: {
    width: 1,
    backgroundColor: '#E5E7EB',
  },
  valueLabel: {
    color: '#6B7280',
    fontSize: 11,
    textAlign: 'center',
  },
  customerValue: {
    color: '#4338CA',
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 4,
  },
  networkValue: {
    color: '#0369A1',
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 4,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  editButton: {
    flex: 1,
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#EEF2FF',
    borderRadius: 10,
  },
  editButtonText: {
    color: '#4338CA',
    fontSize: 13,
    fontWeight: '700',
  },
  deleteButton: {
    minWidth: 94,
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
  },
  deleteButtonText: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '700',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 36,
  },
  emptyIconCircle: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 15,
  },
  emptyTitle: {
    color: '#111827',
    fontSize: 17,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  emptyText: {
    color: '#6B7280',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 7,
    marginBottom: 18,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
    backgroundColor: '#F9FAFB',
  },
  addButton: {
    minHeight: 49,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#4F46E5',
    borderRadius: 13,
    paddingHorizontal: 22,
  },
  addButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: 'bold',
  },
});
