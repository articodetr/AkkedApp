import { useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Clock, Handshake, Plus, Search, Wallet } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { CURRENCIES, Customer, CustomerBalanceByCurrency } from '@/types/database';
import { useDataRefresh } from '@/contexts/DataRefreshContext';
import { useAuth } from '@/contexts/AuthContext';
import { buildScopedCustomerFilter } from '@/services/userScopeService';
import { sortCustomersKeepingOriginalOrder } from '@/utils/customerDisplay';

interface CustomerWithBalances extends Customer {
  balances: CustomerBalanceByCurrency[];
  last_activity?: string | null;
  pending_movements_count?: number;
}

type PendingNotificationIndicatorRow = {
  customer_id: string | null;
  status?: string | null;
  notification_type?: string | null;
  action_required?: boolean | null;
  movement?: {
    approval_status?: string | null;
    pending_approval?: boolean | null;
    is_voided?: boolean | null;
  } | null;
};

function isPendingNotificationIndicator(row: PendingNotificationIndicatorRow) {
  const status = String(row.status || row.movement?.approval_status || '').toLowerCase();

  if (status === 'approved' || status === 'rejected' || status === 'done') {
    return false;
  }

  return (
    status === 'pending' ||
    row.notification_type === 'approval_needed' ||
    row.notification_type === 'movement_pending' ||
    Boolean(row.action_required) ||
    Boolean(row.movement?.pending_approval)
  );
}

function getCustomerUniqueKey(customer: Customer): string {
  const accountNumber = String(customer.account_number || '').trim();
  return accountNumber || customer.id;
}

function removeDuplicateCustomers(customers: CustomerWithBalances[]) {
  const map = new Map<string, CustomerWithBalances>();

  customers.forEach((customer) => {
    const key = getCustomerUniqueKey(customer);
    const existing = map.get(key);

    if (!existing) {
      map.set(key, customer);
      return;
    }

    const existingUpdatedAt = new Date(existing.updated_at || existing.created_at || 0).getTime();
    const nextUpdatedAt = new Date(customer.updated_at || customer.created_at || 0).getTime();

    if (nextUpdatedAt > existingUpdatedAt) {
      map.set(key, customer);
    }
  });

  return Array.from(map.values());
}

export default function CustomersScreen() {
  const router = useRouter();
  const { lastRefreshTime } = useDataRefresh();
  const { currentUser } = useAuth();
  const [customers, setCustomers] = useState<CustomerWithBalances[]>([]);
  const [filteredCustomers, setFilteredCustomers] = useState<CustomerWithBalances[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [linkFilter, setLinkFilter] = useState<'all' | 'linked' | 'unlinked'>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadCustomers();
  }, [currentUser?.userId]);

  useEffect(() => {
    if (!isLoading) {
      console.log('[Customers] Auto-refreshing due to data change');
      loadCustomers();
    }
  }, [lastRefreshTime]);

  useEffect(() => {
    filterCustomers();
  }, [searchQuery, customers, linkFilter]);

  const loadCustomers = async () => {
    try {
      if (!currentUser?.userId) {
        console.warn('[Customers] No current user found, showing empty list');
        setCustomers([]);
        setFilteredCustomers([]);
        return;
      }

      try {
        await supabase.rpc('ensure_profit_loss_account_for_user', {
          p_user_id: currentUser.userId,
        });
      } catch (ensureError) {
        console.warn('[Customers] Unable to ensure profit/loss account:', ensureError);
      }

      const { data: customersData, error: customersError } = await supabase
        .from('customers_with_last_activity')
        .select('*')
        .or(buildScopedCustomerFilter(currentUser.userId, false))
        .order('last_activity', { ascending: false });

      if (customersError) {
        throw customersError;
      }

      const visibleCustomers = ((customersData || []) as CustomerWithBalances[]).filter(
        (customer) =>
          customer.user_id === currentUser.userId,
      );

      const visibleCustomerIds = visibleCustomers.map((customer) => customer.id);
      const balancesMap = new Map<string, CustomerBalanceByCurrency[]>();
      const pendingMovementsMap = new Map<string, number>();

      if (visibleCustomerIds.length > 0) {
        const [balancesResult, pendingNotificationsResult] = await Promise.all([
          supabase
            .from('customer_balances_by_currency')
            .select('*')
            .in('customer_id', visibleCustomerIds),
          supabase
            .from('movement_notifications')
            .select(`
              customer_id,
              status,
              notification_type,
              action_required,
              movement:account_movements!movement_id(
                approval_status,
                pending_approval,
                is_voided
              )
            `)
            .eq('user_id', currentUser.userId)
            .in('customer_id', visibleCustomerIds)
            .is('deleted_at', null),
        ]);

        if (balancesResult.error) {
          throw balancesResult.error;
        }

        ((balancesResult.data || []) as CustomerBalanceByCurrency[]).forEach((balance) => {
          if (!balancesMap.has(balance.customer_id)) {
            balancesMap.set(balance.customer_id, []);
          }
          balancesMap.get(balance.customer_id)?.push(balance);
        });

        if (pendingNotificationsResult.error) {
          console.warn('[Customers] Unable to load pending movement indicators:', pendingNotificationsResult.error);
        } else {
          ((pendingNotificationsResult.data || []) as PendingNotificationIndicatorRow[])
            .filter(isPendingNotificationIndicator)
            .forEach((notification) => {
              if (!notification.customer_id) return;
              pendingMovementsMap.set(
                notification.customer_id,
                (pendingMovementsMap.get(notification.customer_id) || 0) + 1,
              );
            });
        }
      }

      const customersWithBalances: CustomerWithBalances[] = visibleCustomers.map((customer) => ({
        ...customer,
        balances: balancesMap.get(customer.id) || [],
        pending_movements_count: pendingMovementsMap.get(customer.id) || 0,
      }));

      const regularCustomers = sortCustomersKeepingOriginalOrder(
        removeDuplicateCustomers(customersWithBalances),
      );

      setCustomers(regularCustomers);
      setFilteredCustomers(regularCustomers);
    } catch (error) {
      console.error('Error loading customers:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const filterCustomers = () => {
    let result = customers;

    if (linkFilter === 'linked') {
      result = result.filter((c) => !!c.linked_user_id && !c.is_profit_loss_account);
    } else if (linkFilter === 'unlinked') {
      result = result.filter((c) => !c.linked_user_id);
    }

    const normalizedSearch = searchQuery.toLowerCase().trim();
    if (normalizedSearch) {
      result = result.filter(
        (customer) =>
          customer.name.toLowerCase().includes(normalizedSearch) ||
          customer.phone?.includes(normalizedSearch) ||
          customer.account_number?.includes(normalizedSearch),
      );
    }

    setFilteredCustomers(result);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadCustomers();
    setRefreshing(false);
  };

  const getCurrencySymbol = (code: string) => {
    const currency = CURRENCIES.find((c) => c.code === code);
    return currency?.symbol || code;
  };

  const formatBalanceAmount = (amount: number, currencyCode: string) => {
    const rounded = Math.round(Number(amount) || 0);
    const symbol = getCurrencySymbol(currencyCode);
    return `${rounded.toLocaleString('en-US')} ${symbol}`;
  };

  const handleDeleteCustomer = async (customer: CustomerWithBalances) => {
    const hasBalances = customer.balances.length > 0;
    let message = `هل تريد حذف ${customer.name}؟\n\n`;

    if (hasBalances) {
      message += 'تحذير: العميل لديه رصيد!\n';
      customer.balances.forEach((balance) => {
        const balanceAmount = Number(balance.balance);
        const symbol = getCurrencySymbol(balance.currency);
        if (balanceAmount > 0) {
          message += `• له ${Math.round(balanceAmount)} ${symbol}\n`;
        } else {
          message += `• عليه ${Math.round(Math.abs(balanceAmount))} ${symbol}\n`;
        }
      });
      message += '\n';
    }

    message += 'سيتم حذف جميع بيانات وحركات العميل!\nلا يمكن التراجع عن هذه العملية.';

    Alert.alert('حذف العميل', message, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'حذف',
        style: 'destructive',
        onPress: async () => {
          try {
            const { data, error } = await supabase.rpc('delete_customer_completely', {
              p_customer_id: customer.id,
            });

            if (error) {
              Alert.alert('خطأ', 'حدث خطأ أثناء حذف العميل');
              console.error('Error deleting customer:', error);
              return;
            }

            const result = data as { success: boolean; message: string };
            if (result.success) {
              Alert.alert('تم الحذف', 'تم حذف العميل بنجاح');
              await loadCustomers();
            } else {
              Alert.alert('خطأ', result.message);
            }
          } catch (error) {
            console.error('Error deleting customer:', error);
            Alert.alert('خطأ', 'حدث خطأ غير متوقع');
          }
        },
      },
    ]);
  };

  const handleResetCustomerAccount = async (customer: CustomerWithBalances) => {
    Alert.alert(
      'تصفير الحساب',
      `هل تريد تصفير حساب ${customer.name}؟\n\nسيتم حذف جميع الحركات مع الاحتفاظ ببيانات العميل.`,
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'تصفير',
          style: 'destructive',
          onPress: async () => {
            try {
              const { data, error } = await supabase.rpc('reset_customer_account', {
                p_customer_id: customer.id,
              });

              if (error) {
                Alert.alert('خطأ', 'حدث خطأ أثناء تصفير الحساب');
                console.error('Error resetting account:', error);
                return;
              }

              const result = data as { success: boolean; message: string };
              if (result.success) {
                Alert.alert('تم التصفير', 'تم تصفير الحساب بنجاح');
                await loadCustomers();
              } else {
                Alert.alert('خطأ', result.message);
              }
            } catch (error) {
              console.error('Error resetting customer account:', error);
              Alert.alert('خطأ', 'حدث خطأ غير متوقع');
            }
          },
        },
      ],
    );
  };

  const handleCustomerLongPress = (customer: CustomerWithBalances) => {
    if (customer.is_profit_loss_account) {
      Alert.alert('خيارات الحساب', customer.name, [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'فتح',
          onPress: () => router.push(`/customer-details?id=${customer.id}` as any),
        },
      ]);
      return;
    }

    Alert.alert('خيارات العميل', `اختر العملية لـ ${customer.name}:`, [
      { text: 'إلغاء', style: 'cancel' },
      {
        text: 'فتح',
        onPress: () => router.push(`/customer-details?id=${customer.id}` as any),
      },
      {
        text: 'تصفير الحساب',
        onPress: () => handleResetCustomerAccount(customer),
      },
      {
        text: 'حذف العميل',
        onPress: () => handleDeleteCustomer(customer),
        style: 'destructive',
      },
    ]);
  };

  const renderCustomer = ({ item }: { item: CustomerWithBalances; index: number }) => {
    const hasBalances = item.balances.length > 0;
    const displayBalances = item.balances.slice(0, 2);
    const isLinkedUser = !!item.linked_user_id;
    const isProfitLossAccount = !!item.is_profit_loss_account;
    const pendingMovementsCount = Number(item.pending_movements_count || 0);

    return (
      <TouchableOpacity
        style={[
          styles.customerCard,
          isProfitLossAccount && styles.profitLossCard,
          isLinkedUser && !isProfitLossAccount && styles.linkedFooterCardPadding,
          isLinkedUser && !isProfitLossAccount && pendingMovementsCount > 0 &&
            styles.linkedFooterCardPaddingWithPending,
        ]}
        activeOpacity={0.8}
        onPress={() => router.push(`/customer-details?id=${item.id}` as any)}
        onLongPress={() => handleCustomerLongPress(item)}
      >
        <View style={styles.customerInfo}>
          <View style={styles.customerHeaderRow}>
            <Text
              style={styles.customerName}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {item.name}
            </Text>
            {isProfitLossAccount ? (
              <View style={styles.profitLossIndicator}>
                <Wallet size={12} color="#B45309" />
              </View>
            ) : null}
            {!isLinkedUser && pendingMovementsCount > 0 && (
              <View style={styles.pendingMovementIndicator}>
                <Clock size={11} color="#D97706" />
                <Text style={styles.pendingMovementIndicatorText}>
                  {pendingMovementsCount > 99 ? '99+' : pendingMovementsCount}
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.customerMetaText} numberOfLines={1}>
            {isProfitLossAccount
              ? `حساب ثابت • رقم الحساب: ${item.account_number}`
              : isLinkedUser
              ? `رقم الحساب: ${item.account_number}`
              : `${item.phone || ''} • رقم الحساب: ${item.account_number}`}
          </Text>
        </View>

        <View style={styles.balanceContainer}>
          {!hasBalances ? (
            <Text style={[styles.balanceText, { color: '#6B7280' }]}>متساوي</Text>
          ) : (
            <>
              {displayBalances.map((balance, idx) => {
                const balanceAmount = Number(balance.balance);
                return (
                  <Text
                    key={`${item.id}-${balance.currency}`}
                    style={[
                      styles.balanceText,
                      { color: balanceAmount >= 0 ? '#10B981' : '#EF4444' },
                      idx > 0 && { fontSize: 13 },
                    ]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {formatBalanceAmount(balanceAmount, balance.currency)}
                  </Text>
                );
              })}
              {item.balances.length > 2 && (
                <Text style={styles.moreBalancesText}>+{item.balances.length - 2} المزيد</Text>
              )}
            </>
          )}
        </View>

        {isLinkedUser && !isProfitLossAccount ? (
          <View style={styles.linkedFooter} pointerEvents="none">
            {pendingMovementsCount > 0 ? (
              <View style={styles.linkedFooterPendingBadge}>
                <Clock size={11} color="#D97706" />
                <Text style={styles.linkedFooterPendingText}>
                  {pendingMovementsCount > 99 ? '99+' : pendingMovementsCount}
                </Text>
              </View>
            ) : null}
            <View style={styles.linkedFooterLineRow}>
              <View
                style={[
                  styles.linkedFooterLine,
                  pendingMovementsCount > 0 && styles.linkedFooterLinePending,
                ]}
              />
              <Handshake
                size={18}
                color={pendingMovementsCount > 0 ? '#D97706' : '#10B981'}
              />
              <View
                style={[
                  styles.linkedFooterLine,
                  pendingMovementsCount > 0 && styles.linkedFooterLinePending,
                ]}
              />
            </View>
          </View>
        ) : null}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>العملاء</Text>
      </View>

      <View style={styles.searchContainer}>
        <Search size={20} color="#9CA3AF" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="ابحث بالاسم أو الرقم"
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholderTextColor="#9CA3AF"
        />
      </View>

      <View style={styles.segmentBox}>
        {(
          [
            { key: 'all', label: 'الكل' },
            { key: 'linked', label: 'المرتبطون' },
            { key: 'unlinked', label: 'غير المرتبطين' },
          ] as const
        ).map((opt) => {
          const active = linkFilter === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              style={[styles.segmentItem, active && styles.segmentItemActive]}
              onPress={() => setLinkFilter(opt.key)}
              activeOpacity={0.85}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <FlatList
        data={filteredCustomers}
        renderItem={renderCustomer}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>{isLoading ? 'جاري التحميل...' : 'لا يوجد عملاء'}</Text>
          </View>
        }
      />

      <TouchableOpacity
        style={styles.floatingButton}
        onPress={() => router.push('/add-customer' as any)}
        activeOpacity={0.8}
      >
        <Plus size={32} color="#FFFFFF" />
      </TouchableOpacity>
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
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#111827',
    textAlign: 'center',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  searchIcon: {
    marginLeft: 8,
  },
  searchInput: {
    flex: 1,
    height: 48,
    fontSize: 16,
    color: '#111827',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  segmentBox: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    marginHorizontal: 16,
    marginTop: 4,
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
    writingDirection: 'rtl',
  },
  segmentTextActive: {
    color: '#111827',
    fontWeight: '800',
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  customerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 92,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  profitLossCard: {
    borderColor: '#FCD34D',
    backgroundColor: '#FFFBEB',
  },
  linkedFooterCardPadding: {
    paddingBottom: 26,
  },
  linkedFooterCardPaddingWithPending: {
    paddingBottom: 50,
  },
  linkedFooter: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 8,
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
  },
  linkedFooterLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: 8,
  },
  linkedFooterLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#A7F3D0',
  },
  linkedFooterLinePending: {
    backgroundColor: '#FED7AA',
  },
  linkedFooterPendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: '#FEF3C7',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  linkedFooterPendingText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#92400E',
    writingDirection: 'rtl',
  },
  customerInfo: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  customerHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
  },
  customerName: {
    flexShrink: 1,
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'right',
  },
  customerMetaText: {
    marginTop: 6,
    fontSize: 12,
    color: '#64748B',
    textAlign: 'right',
    lineHeight: 18,
  },
  balanceContainer: {
    width: 110,
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 2,
  },
  balanceText: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  profitLossIndicator: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FCD34D',
  },
  pendingMovementIndicator: {
    minWidth: 32,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 3,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  pendingMovementIndicatorText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#B45309',
    writingDirection: 'ltr',
  },
  moreBalancesText: {
    fontSize: 11,
    color: '#94A3B8',
    textAlign: 'left',
    writingDirection: 'rtl',
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
  },
  floatingButton: {
    position: 'absolute',
    bottom: 24,
    right: 24,
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
