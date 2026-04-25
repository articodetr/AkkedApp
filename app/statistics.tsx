import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ComponentType } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Bell,
  CheckCircle2,
  ChevronLeft,
  Clock,
  RefreshCcw,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { useDataRefresh } from '@/contexts/DataRefreshContext';
import { supabase } from '@/lib/supabase';
import { CURRENCIES } from '@/types/database';
import { StatisticsData, StatisticsService } from '@/services/statisticsService';

type CurrencyAmount = { currency: string; amount: number };

type NetDebtByCurrency = {
  currency: string;
  totalForMe: number;
  totalOnMe: number;
  netAmount: number;
  finalAmount: number;
  direction: 'for_me' | 'on_me' | 'balanced';
};

type CustomerBalanceLine = {
  customerId: string;
  customerName: string;
  currency: string;
  amount: number;
  direction: 'for_me' | 'on_me';
};

type IconComponent = ComponentType<{ size: number; color: string }>;

function formatAmount(amount: number): string {
  return Number(amount || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getCurrencyInfo(code: string) {
  return CURRENCIES.find((currency) => currency.code === code) || {
    code,
    name: code,
    symbol: code,
  };
}

function getPrimaryAmount(items: CurrencyAmount[]) {
  const visibleItems = items.filter((item) => Math.abs(item.amount) > 0);
  if (visibleItems.length === 0) {
    return {
      amount: 0,
      currency: '',
      symbol: '',
      extraText: 'لا توجد مبالغ',
    };
  }

  const first = visibleItems[0];
  const currencyInfo = getCurrencyInfo(first.currency);
  return {
    amount: first.amount,
    currency: first.currency,
    symbol: currencyInfo.symbol,
    extraText:
      visibleItems.length > 1 ? `+${visibleItems.length - 1} عملة أخرى` : currencyInfo.name,
  };
}

function buildNetDebtByCurrency(stats: StatisticsData | null): NetDebtByCurrency[] {
  if (!stats) return [];

  const backendNet = (stats.debtStats as any)?.netByCurrency;
  if (Array.isArray(backendNet) && backendNet.length > 0) {
    return backendNet
      .map((item: any) => {
        const totalForMe = Number(item.totalForMe ?? item.total_for_me ?? 0) || 0;
        const totalOnMe = Number(item.totalOnMe ?? item.total_on_me ?? 0) || 0;
        const netAmount = Number(item.netAmount ?? item.net_amount ?? totalForMe - totalOnMe) || 0;
        const finalAmount = Math.abs(Number(item.finalAmount ?? item.final_amount ?? netAmount) || 0);
        const rawDirection = item.direction;
        const direction: NetDebtByCurrency['direction'] =
          rawDirection === 'for_me' || rawDirection === 'on_me' || rawDirection === 'balanced'
            ? rawDirection
            : netAmount > 0
              ? 'for_me'
              : netAmount < 0
                ? 'on_me'
                : 'balanced';

        return {
          currency: String(item.currency || ''),
          totalForMe,
          totalOnMe,
          netAmount,
          finalAmount,
          direction,
        };
      })
      .filter((item: NetDebtByCurrency) => item.currency);
  }

  const currencyMap = new Map<string, { totalForMe: number; totalOnMe: number }>();

  stats.debtStats.owedToUsByCurrency.forEach((item) => {
    const current = currencyMap.get(item.currency) || { totalForMe: 0, totalOnMe: 0 };
    current.totalForMe += Number(item.amount || 0);
    currencyMap.set(item.currency, current);
  });

  stats.debtStats.weOweByCurrency.forEach((item) => {
    const current = currencyMap.get(item.currency) || { totalForMe: 0, totalOnMe: 0 };
    current.totalOnMe += Number(item.amount || 0);
    currencyMap.set(item.currency, current);
  });

  return Array.from(currencyMap.entries())
    .map(([currency, totals]) => {
      const netAmount = totals.totalForMe - totals.totalOnMe;
      return {
        currency,
        totalForMe: totals.totalForMe,
        totalOnMe: totals.totalOnMe,
        netAmount,
        finalAmount: Math.abs(netAmount),
        direction: netAmount > 0 ? 'for_me' : netAmount < 0 ? 'on_me' : 'balanced',
      } as NetDebtByCurrency;
    })
    .sort((a, b) => b.finalAmount - a.finalAmount);
}

function buildTopCustomerLines(stats: StatisticsData | null): {
  forMe: CustomerBalanceLine[];
  onMe: CustomerBalanceLine[];
} {
  const forMe: CustomerBalanceLine[] = [];
  const onMe: CustomerBalanceLine[] = [];

  if (!stats) return { forMe, onMe };

  stats.topCustomers.forEach((customer) => {
    customer.balanceByCurrency.forEach((balance) => {
      const amount = Number(balance.amount || 0);
      if (amount > 0) {
        forMe.push({
          customerId: customer.id,
          customerName: customer.name,
          currency: balance.currency,
          amount,
          direction: 'for_me',
        });
      } else if (amount < 0) {
        onMe.push({
          customerId: customer.id,
          customerName: customer.name,
          currency: balance.currency,
          amount: Math.abs(amount),
          direction: 'on_me',
        });
      }
    });
  });

  return {
    forMe: forMe.sort((a, b) => b.amount - a.amount).slice(0, 3),
    onMe: onMe.sort((a, b) => b.amount - a.amount).slice(0, 3),
  };
}

function StatSummaryCard({
  title,
  amount,
  symbol,
  note,
  color,
  icon: Icon,
}: {
  title: string;
  amount: string | number;
  symbol?: string;
  note?: string;
  color: string;
  icon: IconComponent;
}) {
  return (
    <View style={styles.summaryCard}>
      <View style={[styles.summaryIcon, { backgroundColor: `${color}14` }]}> 
        <Icon size={22} color={color} />
      </View>
      <View style={styles.summaryTextBlock}>
        <Text style={styles.summaryTitle}>{title}</Text>
        <View style={styles.summaryAmountRow}>
          {symbol ? <Text style={[styles.summarySymbol, { color }]}>{symbol}</Text> : null}
          <Text style={[styles.summaryAmount, { color }]}>{amount}</Text>
        </View>
        {note ? <Text style={styles.summaryNote}>{note}</Text> : null}
      </View>
    </View>
  );
}

function SectionHeader({ title, icon: Icon, color }: { title: string; icon: IconComponent; color: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Icon size={21} color={color} />
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

function NetCurrencyRow({ item }: { item: NetDebtByCurrency }) {
  const currencyInfo = getCurrencyInfo(item.currency);
  const isForMe = item.direction === 'for_me';
  const isOnMe = item.direction === 'on_me';
  const netColor = isForMe ? '#059669' : isOnMe ? '#DC2626' : '#64748B';
  const netLabel = isForMe ? 'لك' : isOnMe ? 'عليك' : 'متوازن';

  return (
    <View style={styles.currencyRow}>
      <View style={styles.currencyBadge}>
        <Text style={styles.currencyCode}>{item.currency}</Text>
        <Text style={styles.currencyName}>{currencyInfo.name}</Text>
      </View>

      <View style={styles.currencyValuesGroup}>
        <View style={styles.currencyValueBox}>
          <Text style={[styles.currencyValueLabel, { color: '#059669' }]}>لك</Text>
          <Text style={[styles.currencyValue, { color: '#059669' }]}>
            {formatAmount(item.totalForMe)}
          </Text>
        </View>

        <View style={styles.currencyDivider} />

        <View style={styles.currencyValueBox}>
          <Text style={[styles.currencyValueLabel, { color: '#DC2626' }]}>عليك</Text>
          <Text style={[styles.currencyValue, { color: '#DC2626' }]}>
            {formatAmount(item.totalOnMe)}
          </Text>
        </View>

        <View style={styles.currencyDivider} />

        <View style={styles.currencyValueBox}>
          <Text style={styles.currencyValueLabel}>الصافي</Text>
          <Text style={[styles.currencyValue, { color: netColor }]}> 
            {netLabel} {formatAmount(item.finalAmount)} {currencyInfo.symbol}
          </Text>
        </View>
      </View>
    </View>
  );
}

function AttentionTile({
  title,
  value,
  color,
  icon: Icon,
  onPress,
}: {
  title: string;
  value: number;
  color: string;
  icon: IconComponent;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity style={styles.attentionTile} activeOpacity={0.75} onPress={onPress}>
      <View style={[styles.attentionIcon, { backgroundColor: `${color}14` }]}> 
        <Icon size={20} color={color} />
      </View>
      <Text style={styles.attentionTitle}>{title}</Text>
      <Text style={[styles.attentionValue, { color }]}>{value}</Text>
    </TouchableOpacity>
  );
}

function TopCustomersCard({
  title,
  color,
  customers,
  onOpenCustomer,
}: {
  title: string;
  color: string;
  customers: CustomerBalanceLine[];
  onOpenCustomer: (customerId: string) => void;
}) {
  return (
    <View style={[styles.topCustomersCard, { backgroundColor: `${color}0C` }]}> 
      <Text style={[styles.topCustomersTitle, { color }]}>{title}</Text>
      {customers.length === 0 ? (
        <Text style={styles.emptySmallText}>لا توجد مبالغ</Text>
      ) : (
        customers.map((customer) => {
          const currencyInfo = getCurrencyInfo(customer.currency);
          return (
            <TouchableOpacity
              key={`${customer.customerId}-${customer.currency}-${customer.direction}`}
              style={styles.customerLine}
              activeOpacity={0.75}
              onPress={() => onOpenCustomer(customer.customerId)}
            >
              <View style={styles.customerAvatarSmall}>
                <Users size={15} color="#64748B" />
              </View>
              <Text style={styles.customerLineName} numberOfLines={1}>{customer.customerName}</Text>
              <Text style={[styles.customerLineAmount, { color }]}> 
                {formatAmount(customer.amount)} {currencyInfo.symbol}
              </Text>
            </TouchableOpacity>
          );
        })
      )}
    </View>
  );
}

export default function StatisticsScreen() {
  const router = useRouter();
  const { currentUser } = useAuth();
  const { lastRefreshTime } = useDataRefresh();
  const [stats, setStats] = useState<StatisticsData | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadUnreadCount = useCallback(async () => {
    if (!currentUser?.userId) {
      setUnreadCount(0);
      return;
    }

    const { count, error: unreadError } = await supabase
      .from('movement_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', currentUser.userId)
      .eq('is_read', false);

    if (!unreadError && typeof count === 'number') {
      setUnreadCount(count);
    }
  }, [currentUser?.userId]);

  const loadStats = useCallback(async () => {
    if (!currentUser?.userId) {
      setStats(null);
      setUnreadCount(0);
      setLoading(false);
      return;
    }

    try {
      setError(null);
      const data = await StatisticsService.fetchAllStatistics(currentUser.userId);
      setStats(data);
      await loadUnreadCount();
    } catch (loadError) {
      console.error('[StatisticsScreen] loadStats failed:', loadError);
      setError(loadError instanceof Error ? loadError.message : 'حدث خطأ أثناء تحميل الإحصائيات');
    } finally {
      setLoading(false);
    }
  }, [currentUser?.userId, loadUnreadCount]);

  useEffect(() => {
    setLoading(true);
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    if (!loading && currentUser?.userId) {
      loadStats();
    }
  }, [lastRefreshTime, currentUser?.userId]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadStats();
    setRefreshing(false);
  };

  const netDebts = useMemo(() => buildNetDebtByCurrency(stats), [stats]);
  const topCustomers = useMemo(() => buildTopCustomerLines(stats), [stats]);

  const primaryForMe = getPrimaryAmount(stats?.debtStats.owedToUsByCurrency || []);
  const primaryOnMe = getPrimaryAmount(stats?.debtStats.weOweByCurrency || []);
  const primaryNet = netDebts.find((item) => item.direction !== 'balanced') || netDebts[0];
  const primaryNetCurrency = primaryNet ? getCurrencyInfo(primaryNet.currency) : null;
  const primaryNetColor = primaryNet?.direction === 'on_me' ? '#DC2626' : primaryNet?.direction === 'for_me' ? '#2563EB' : '#64748B';
  const primaryNetLabel = !primaryNet
    ? 'متوازن'
    : primaryNet.direction === 'on_me'
      ? 'عليك'
      : primaryNet.direction === 'for_me'
        ? 'لك'
        : 'متوازن';

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerButton} onPress={() => router.back()}>
            <ArrowRight size={23} color="#0F172A" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>الإحصاءات</Text>
          <View style={styles.headerButton} />
        </View>
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color="#2563EB" />
          <Text style={styles.centerText}>جاري تحميل الإحصاءات...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerButton} onPress={() => router.back()}>
          <ArrowRight size={23} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>الإحصاءات</Text>
        <TouchableOpacity style={styles.headerButton} onPress={loadStats}>
          <RefreshCcw size={20} color="#2563EB" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {error ? (
          <View style={styles.errorBox}>
            <AlertCircle size={22} color="#DC2626" />
            <View style={{ flex: 1 }}>
              <Text style={styles.errorTitle}>تعذر تحميل الإحصاءات</Text>
              <Text style={styles.errorMessage}>{error}</Text>
            </View>
          </View>
        ) : null}

        <View style={styles.summaryGrid}>
          <StatSummaryCard
            title="ما لي"
            amount={formatAmount(primaryForMe.amount)}
            symbol={primaryForMe.symbol}
            note={primaryForMe.extraText}
            color="#059669"
            icon={Wallet}
          />
          <StatSummaryCard
            title="ما عليّ"
            amount={formatAmount(primaryOnMe.amount)}
            symbol={primaryOnMe.symbol}
            note={primaryOnMe.extraText}
            color="#DC2626"
            icon={TrendingDown}
          />
          <StatSummaryCard
            title="الصافي"
            amount={primaryNet ? `${primaryNetLabel} ${formatAmount(primaryNet.finalAmount)}` : 'متوازن'}
            symbol={primaryNetCurrency?.symbol}
            note={primaryNet ? 'بعد تصفية كل العملاء' : 'لا توجد ديون صافية'}
            color={primaryNetColor}
            icon={BarChart3}
          />
          <StatSummaryCard
            title="بانتظار موافقتي"
            amount={stats?.actionableStats.awaitingMyApprovalCount || 0}
            note="حركات تحتاج قرارك"
            color="#D97706"
            icon={Clock}
          />
        </View>

        <SectionHeader title="الصافي النهائي حسب العملة" icon={BarChart3} color="#2563EB" />
        <View style={styles.cardBlock}>
          {netDebts.length ? (
            netDebts.map((item) => <NetCurrencyRow key={item.currency} item={item} />)
          ) : (
            <View style={styles.emptyBlock}>
              <CheckCircle2 size={26} color="#059669" />
              <Text style={styles.emptyTitle}>لا توجد ديون صافية</Text>
              <Text style={styles.emptyText}>كل الحسابات متوازنة في الوقت الحالي.</Text>
            </View>
          )}
        </View>

        <SectionHeader title="يحتاج انتباهك" icon={Bell} color="#D97706" />
        <View style={styles.attentionGrid}>
          <AttentionTile
            title="بانتظار موافقتي"
            value={stats?.actionableStats.awaitingMyApprovalCount || 0}
            color="#D97706"
            icon={Clock}
            onPress={() => router.push('/(tabs)/notifications')}
          />
          <AttentionTile
            title="بانتظار الطرف الآخر"
            value={stats?.actionableStats.awaitingOthersApprovalCount || 0}
            color="#2563EB"
            icon={RefreshCcw}
            onPress={() => router.push('/(tabs)/notifications')}
          />
          <AttentionTile
            title="غير مقروءة"
            value={unreadCount}
            color="#7C3AED"
            icon={Bell}
            onPress={() => router.push('/(tabs)/notifications')}
          />
        </View>

        <SectionHeader title="أكبر العملاء" icon={Users} color="#2563EB" />
        <View style={styles.topCustomersGrid}>
          <TopCustomersCard
            title="أكبر المبالغ لك"
            color="#059669"
            customers={topCustomers.forMe}
            onOpenCustomer={(customerId) => router.push(`/customer-details?id=${customerId}` as any)}
          />
          <TopCustomersCard
            title="أكبر المبالغ عليك"
            color="#DC2626"
            customers={topCustomers.onMe}
            onOpenCustomer={(customerId) => router.push(`/customer-details?id=${customerId}` as any)}
          />
        </View>

        <SectionHeader title="ملخص الحركات" icon={CheckCircle2} color="#059669" />
        <View style={styles.movementSummaryCard}>
          <View style={styles.movementMetric}>
            <Text style={styles.movementMetricLabel}>معتمدة</Text>
            <Text style={[styles.movementMetricValue, { color: '#059669' }]}>{stats?.totalMovements || 0}</Text>
          </View>
          <View style={styles.metricDivider} />
          <View style={styles.movementMetric}>
            <Text style={styles.movementMetricLabel}>معلقة</Text>
            <Text style={[styles.movementMetricValue, { color: '#D97706' }]}> 
              {(stats?.actionableStats.awaitingMyApprovalCount || 0) +
                (stats?.actionableStats.awaitingOthersApprovalCount || 0)}
            </Text>
          </View>
          <View style={styles.metricDivider} />
          <View style={styles.movementMetric}>
            <Text style={styles.movementMetricLabel}>آخر 7 أيام</Text>
            <Text style={[styles.movementMetricValue, { color: '#2563EB' }]}> 
              {stats?.periodStats.week.movements || 0}
            </Text>
          </View>
        </View>

        <View style={styles.footerSpace} />
      </ScrollView>
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
    paddingHorizontal: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#0F172A',
    fontSize: 21,
    fontWeight: '900',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 34,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  centerText: {
    color: '#475569',
    fontSize: 15,
    fontWeight: '700',
  },
  errorBox: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    flexDirection: 'row-reverse',
    gap: 10,
    marginBottom: 14,
  },
  errorTitle: {
    color: '#991B1B',
    fontSize: 14,
    fontWeight: '900',
    textAlign: 'right',
  },
  errorMessage: {
    color: '#7F1D1D',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
    textAlign: 'right',
  },
  summaryGrid: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 12,
  },
  summaryCard: {
    width: '48%',
    minHeight: 142,
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 15,
    shadowColor: '#0F172A',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  summaryIcon: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  summaryTextBlock: {
    alignItems: 'flex-end',
  },
  summaryTitle: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '900',
    textAlign: 'right',
  },
  summaryAmountRow: {
    marginTop: 7,
    flexDirection: 'row-reverse',
    alignItems: 'baseline',
    gap: 5,
  },
  summaryAmount: {
    fontSize: 23,
    fontWeight: '900',
    textAlign: 'right',
  },
  summarySymbol: {
    fontSize: 14,
    fontWeight: '900',
  },
  summaryNote: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 5,
    textAlign: 'right',
  },
  sectionHeader: {
    marginTop: 24,
    marginBottom: 12,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'right',
  },
  cardBlock: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
    shadowColor: '#0F172A',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  currencyRow: {
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
  },
  currencyBadge: {
    width: 82,
    alignItems: 'center',
  },
  currencyCode: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '900',
  },
  currencyName: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
    textAlign: 'center',
  },
  currencyValuesGroup: {
    flex: 1,
    flexDirection: 'row-reverse',
    alignItems: 'center',
  },
  currencyValueBox: {
    flex: 1,
    alignItems: 'center',
  },
  currencyValueLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '900',
    marginBottom: 5,
  },
  currencyValue: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'center',
  },
  currencyDivider: {
    width: 1,
    height: 38,
    backgroundColor: '#E2E8F0',
  },
  emptyBlock: {
    padding: 20,
    alignItems: 'center',
  },
  emptyTitle: {
    marginTop: 8,
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '900',
  },
  emptyText: {
    marginTop: 4,
    color: '#64748B',
    fontSize: 12,
    textAlign: 'center',
  },
  attentionGrid: {
    flexDirection: 'row-reverse',
    gap: 10,
  },
  attentionTile: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: 'center',
    minHeight: 124,
  },
  attentionIcon: {
    width: 38,
    height: 38,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 9,
  },
  attentionTitle: {
    color: '#0F172A',
    fontSize: 12,
    fontWeight: '900',
    minHeight: 32,
    textAlign: 'center',
  },
  attentionValue: {
    fontSize: 22,
    fontWeight: '900',
  },
  topCustomersGrid: {
    flexDirection: 'row-reverse',
    gap: 12,
  },
  topCustomersCard: {
    flex: 1,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 13,
    minHeight: 166,
  },
  topCustomersTitle: {
    fontSize: 14,
    fontWeight: '900',
    textAlign: 'right',
    marginBottom: 10,
  },
  customerLine: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  customerAvatarSmall: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  customerLineName: {
    flex: 1,
    color: '#0F172A',
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'right',
  },
  customerLineAmount: {
    fontSize: 11,
    fontWeight: '900',
    textAlign: 'left',
  },
  emptySmallText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 28,
  },
  movementSummaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 18,
    paddingHorizontal: 10,
    flexDirection: 'row-reverse',
    alignItems: 'center',
  },
  movementMetric: {
    flex: 1,
    alignItems: 'center',
  },
  movementMetricLabel: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '800',
  },
  movementMetricValue: {
    marginTop: 6,
    fontSize: 22,
    fontWeight: '900',
  },
  metricDivider: {
    width: 1,
    height: 44,
    backgroundColor: '#E2E8F0',
  },
  footerSpace: {
    height: 40,
  },
});
