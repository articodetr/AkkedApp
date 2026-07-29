import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BadgePercent,
  Calendar,
  Plus,
} from 'lucide-react-native';

import EntityTransferFormSheet from '@/components/EntityTransferFormSheet';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  CURRENCIES,
  Customer,
  EntityTransfer,
  EntityTransferDirection,
} from '@/types/database';
import { formatSmartNumber } from '@/utils/arabicFormat';

type TransferFilter = 'all' | EntityTransferDirection;

export default function EntitiesNetworksScreen() {
  const router = useRouter();
  const { currentUser } = useAuth();

  const [transfers, setTransfers] = useState<EntityTransfer[]>([]);
  const [accounts, setAccounts] = useState<Customer[]>([]);
  const [filter, setFilter] = useState<TransferFilter>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [databaseReady, setDatabaseReady] = useState(true);

  const loadData = useCallback(
    async (showLoading = true) => {
      if (!currentUser?.userId) {
        setTransfers([]);
        setAccounts([]);
        setIsLoading(false);
        return;
      }

      if (showLoading) setIsLoading(true);

      try {
        const accountsResult = await supabase
          .from('customers')
          .select('*')
          .eq('user_id', currentUser.userId)
          .is('linked_user_id', null)
          .eq('is_profit_loss_account', false)
          .eq('is_entity_settlement_account', false)
          .order('name', { ascending: true });

        if (accountsResult.error) throw accountsResult.error;
        setAccounts((accountsResult.data as Customer[]) || []);

        const transfersResult = await supabase
          .from('entity_transfers')
          .select('*')
          .eq('user_id', currentUser.userId)
          .order('created_at', { ascending: false });

        if (transfersResult.error) {
          const missingTable =
            transfersResult.error.code === '42P01' ||
            transfersResult.error.code === 'PGRST205' ||
            transfersResult.error.message?.includes('entity_transfers');

          if (missingTable) {
            setTransfers([]);
            setDatabaseReady(false);
          } else {
            throw transfersResult.error;
          }
        } else {
          setTransfers((transfersResult.data as EntityTransfer[]) || []);
          setDatabaseReady(true);
        }
      } catch (error) {
        console.error('Error loading entity transfers:', error);
      } finally {
        setIsLoading(false);
      }
    },
    [currentUser?.userId],
  );

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData(false);
    setRefreshing(false);
  };

  const filteredTransfers = useMemo(
    () =>
      filter === 'all'
        ? transfers
        : transfers.filter((transfer) => transfer.direction === filter),
    [filter, transfers],
  );

  const accountNames = useMemo(
    () => new Map(accounts.map((account) => [account.id, account.name])),
    [accounts],
  );

  const sendCount = transfers.filter((transfer) => transfer.direction === 'send').length;
  const receiveCount = transfers.length - sendCount;

  const renderTransfer = ({ item }: { item: EntityTransfer }) => {
    const isSend = item.direction === 'send';
    const DirectionIcon = isSend ? ArrowUpRight : ArrowDownLeft;
    const directionColor = isSend ? '#EF4444' : '#10B981';
    const directionBackground = isSend ? '#FEE2E2' : '#ECFDF5';
    const currency = CURRENCIES.find((entry) => entry.code === item.currency);
    const debitName = accountNames.get(item.debit_customer_id) || 'الحساب المدين';
    const creditName = accountNames.get(item.credit_customer_id) || 'الحساب الدائن';

    return (
      <View style={styles.transferCard}>
        <View style={styles.cardHeader}>
          <View style={styles.cardInfo}>
            <Text style={styles.transferNumber}>#{item.transfer_number}</Text>
            <Text style={styles.partyNames} numberOfLines={1}>
              {item.sender_name} ← {item.beneficiary_name}
            </Text>
          </View>

          <View style={[styles.directionIcon, { backgroundColor: directionBackground }]}>
            <DirectionIcon size={24} color={directionColor} />
          </View>
        </View>

        <View style={styles.cardBody}>
          <Text style={[styles.amountValue, { color: directionColor }]}>
            {formatSmartNumber(Number(item.amount))} {currency?.symbol || item.currency}
          </Text>
          <Text style={styles.transferType}>{isSend ? 'حوالة إرسال' : 'حوالة استلام'}</Text>
          <Text style={styles.accountText} numberOfLines={1}>
            مدين: {debitName}
          </Text>
          <Text style={styles.accountText} numberOfLines={1}>
            دائن: {creditName}
          </Text>
          {item.commission_enabled ? (
            <View style={styles.commissionSummary}>
              <View style={styles.commissionSummaryRow}>
                <Text style={styles.commissionSummaryValue}>
                  {formatSmartNumber(Number(item.customer_commission))} {item.currency}
                </Text>
                <Text style={styles.commissionSummaryLabel}>عمولة العميل</Text>
              </View>
              <View style={styles.commissionSummaryRow}>
                <Text style={styles.commissionSummaryValue}>
                  {formatSmartNumber(Number(item.network_commission))} {item.currency}
                </Text>
                <Text style={styles.commissionSummaryLabel}>عمولة الشبكة</Text>
              </View>
              <View style={styles.commissionSummaryDivider} />
              <View style={styles.commissionSummaryRow}>
                <Text
                  style={[
                    styles.commissionProfitValue,
                    Number(item.net_profit) < 0 && styles.commissionLossValue,
                  ]}
                >
                  {formatSmartNumber(Math.abs(Number(item.net_profit)))} {item.currency}
                </Text>
                <Text style={styles.commissionProfitLabel}>
                  {Number(item.net_profit) < 0 ? 'صافي الخسارة' : 'صافي الربح'}
                </Text>
              </View>
            </View>
          ) : null}
          {item.notes ? (
            <Text style={styles.notesText} numberOfLines={2}>
              {item.notes}
            </Text>
          ) : null}
        </View>

        <View style={styles.cardFooter}>
          <View style={styles.dateRow}>
            <Calendar size={14} color="#9CA3AF" />
            <Text style={styles.dateText}>{formatTransferDate(item.created_at)}</Text>
          </View>
          <Text style={styles.phoneText}>
            {item.sender_phone} · {item.beneficiary_phone}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerButton} onPress={() => router.back()}>
          <ArrowRight size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>الحوالات</Text>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={() => router.push('/transfer-commission-settings' as any)}
        >
          <BadgePercent size={22} color="#4F46E5" />
        </TouchableOpacity>
      </View>

      <View style={styles.statisticsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{transfers.length}</Text>
          <Text style={styles.statLabel}>الكل</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, styles.sendValue]}>{sendCount}</Text>
          <Text style={styles.statLabel}>إرسال</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, styles.receiveValue]}>{receiveCount}</Text>
          <Text style={styles.statLabel}>استلام</Text>
        </View>
      </View>

      {!databaseReady ? (
        <View style={styles.databaseBanner}>
          <Text style={styles.databaseBannerText}>
            يلزم تحديث قاعدة البيانات لتفعيل حفظ الحوالات.
          </Text>
        </View>
      ) : null}

      <View style={styles.segmentBox}>
        {(
          [
            { key: 'all', label: 'الكل' },
            { key: 'send', label: 'إرسال' },
            { key: 'receive', label: 'استلام' },
          ] as const
        ).map((item) => {
          const active = filter === item.key;
          return (
            <TouchableOpacity
              key={item.key}
              style={[styles.segmentItem, active && styles.segmentItemActive]}
              onPress={() => setFilter(item.key)}
              activeOpacity={0.85}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4F46E5" />
          <Text style={styles.loadingText}>جاري تحميل الحوالات...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredTransfers}
          renderItem={renderTransfer}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listContent,
            filteredTransfers.length === 0 && styles.emptyListContent,
          ]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                {filter === 'all' ? 'لا توجد حوالات حتى الآن' : 'لا توجد حوالات بهذا النوع'}
              </Text>
              <Text style={styles.emptyHint}>اضغط زر الإضافة لتسجيل حوالة جديدة</Text>
            </View>
          }
        />
      )}

      <TouchableOpacity
        style={styles.floatingButton}
        onPress={() => setShowForm(true)}
        activeOpacity={0.8}
      >
        <Plus size={32} color="#FFFFFF" />
      </TouchableOpacity>

      <EntityTransferFormSheet
        visible={showForm}
        accounts={accounts}
        onClose={() => setShowForm(false)}
        onSaved={() => loadData(false)}
      />
    </View>
  );
}

function formatTransferDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('ar', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
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
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F9FAFB',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#111827',
    textAlign: 'center',
  },
  statisticsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#4F46E5',
  },
  sendValue: {
    color: '#EF4444',
  },
  receiveValue: {
    color: '#10B981',
  },
  statLabel: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
  },
  databaseBanner: {
    marginHorizontal: 16,
    marginTop: 10,
    backgroundColor: '#FFF7ED',
    borderColor: '#FED7AA',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  databaseBannerText: {
    color: '#9A3412',
    fontSize: 12,
    textAlign: 'center',
  },
  segmentBox: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    padding: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  },
  segmentItemActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
  },
  segmentTextActive: {
    color: '#111827',
    fontWeight: '800',
  },
  listContent: {
    padding: 16,
    paddingBottom: 104,
  },
  emptyListContent: {
    flexGrow: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    fontSize: 14,
    color: '#6B7280',
  },
  transferCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardInfo: {
    flex: 1,
    alignItems: 'flex-start',
  },
  transferNumber: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#4F46E5',
    marginBottom: 4,
    textAlign: 'right',
  },
  partyNames: {
    width: '100%',
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'right',
  },
  directionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  cardBody: {
    marginBottom: 12,
  },
  amountValue: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  transferType: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'right',
    marginTop: 3,
    marginBottom: 7,
  },
  accountText: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'right',
    marginTop: 2,
  },
  commissionSummary: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 9,
    gap: 5,
  },
  commissionSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  commissionSummaryLabel: {
    color: '#64748B',
    fontSize: 11,
    textAlign: 'right',
  },
  commissionSummaryValue: {
    color: '#334155',
    fontSize: 11,
    fontWeight: '700',
  },
  commissionSummaryDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
  },
  commissionProfitLabel: {
    color: '#374151',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'right',
  },
  commissionProfitValue: {
    color: '#059669',
    fontSize: 12,
    fontWeight: '800',
  },
  commissionLossValue: {
    color: '#DC2626',
  },
  notesText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#9CA3AF',
    textAlign: 'right',
    fontStyle: 'italic',
    marginTop: 6,
  },
  cardFooter: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    gap: 7,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dateText: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  phoneText: {
    fontSize: 11,
    color: '#9CA3AF',
    textAlign: 'right',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 64,
  },
  emptyText: {
    fontSize: 16,
    color: '#9CA3AF',
    textAlign: 'center',
  },
  emptyHint: {
    fontSize: 13,
    color: '#CBD5E1',
    marginTop: 7,
    textAlign: 'center',
  },
  floatingButton: {
    position: 'absolute',
    bottom: 24,
    end: 24,
    width: 64,
    height: 64,
    backgroundColor: '#10B981',
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
});
