import { useCallback, useEffect, useMemo, useState } from 'react';
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
  CheckCircle2,
  Clock,
  RefreshCcw,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { useDataRefresh } from '@/contexts/DataRefreshContext';
import { CURRENCIES } from '@/types/database';
import {
  CashFlowByCurrency,
  NetDebtByCurrency,
  PeriodStats,
  StatisticsData,
  StatisticsService,
} from '@/services/statisticsService';

type PeriodKey = 'today' | 'yesterday' | 'week' | 'month';

const periodLabels: Record<PeriodKey, string> = {
  today: 'اليوم',
  yesterday: 'أمس',
  week: 'آخر 7 أيام',
  month: 'آخر 30 يومًا',
};

function formatAmount(amount: number): string {
  return Number(amount || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getCurrencySymbol(code: string): string {
  return CURRENCIES.find((currency) => currency.code === code)?.symbol || code;
}

function currencyLine(items: { currency: string; amount: number }[]): string {
  if (!items.length) return 'لا توجد مبالغ';
  return items
    .slice(0, 3)
    .map((item) => `${formatAmount(item.amount)} ${getCurrencySymbol(item.currency)}`)
    .join('  •  ');
}

function StatCard({
  title,
  value,
  subtitle,
  color,
  icon: Icon,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  color: string;
  icon: React.ComponentType<{ size: number; color: string }>;
}) {
  return (
    <View style={styles.statCard}>
      <View style={[styles.iconCircle, { backgroundColor: `${color}14` }]}>
        <Icon size={20} color={color} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statTitle}>{title}</Text>
      {subtitle ? <Text style={styles.statSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

function SectionHeader({ title, icon: Icon, color }: { title: string; icon: React.ComponentType<{ size: number; color: string }>; color: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Icon size={22} color={color} />
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

function PeriodCard({ label, data }: { label: string; data: PeriodStats }) {
  return (
    <View style={styles.periodCard}>
      <Text style={styles.periodTitle}>{label}</Text>
      <View style={styles.periodRow}>
        <View style={styles.periodMetric}>
          <Text style={styles.periodMetricLabel}>الحوالات</Text>
          <Text style={styles.periodMetricValue}>{data.transactions}</Text>
          <Text style={styles.periodMetricHint}>{currencyLine(data.transactionAmountsByCurrency)}</Text>
        </View>
        <View style={styles.verticalDivider} />
        <View style={styles.periodMetric}>
          <Text style={styles.periodMetricLabel}>الحركات</Text>
          <Text style={styles.periodMetricValue}>{data.movements}</Text>
          <Text style={styles.periodMetricHint}>{currencyLine(data.movementAmountsByCurrency)}</Text>
        </View>
      </View>
    </View>
  );
}

function CashFlowCard({ flow }: { flow: CashFlowByCurrency }) {
  const symbol = getCurrencySymbol(flow.currency);
  const netColor = flow.netFlow > 0 ? '#DC2626' : flow.netFlow < 0 ? '#059669' : '#6B7280';
  const netLabel = flow.netFlow > 0 ? 'الصافي عليه' : flow.netFlow < 0 ? 'الصافي له' : 'متوازن';

  return (
    <View style={styles.flowCard}>
      <View style={styles.flowHeader}>
        <View>
          <Text style={styles.flowCurrency}>{flow.currency}</Text>
          <Text style={styles.flowHint}>معتمد: {flow.approvedCount} حركة</Text>
        </View>
        <View style={[styles.netPill, { backgroundColor: `${netColor}14` }]}>
          <Text style={[styles.netPillText, { color: netColor }]}>{netLabel}</Text>
        </View>
      </View>

      <View style={styles.flowMainRow}>
        <View style={styles.flowBox}>
          <TrendingDown size={18} color="#DC2626" />
          <Text style={styles.flowBoxLabel}>عليه</Text>
          <Text style={[styles.flowBoxValue, { color: '#DC2626' }]}>{formatAmount(flow.totalReceived)} {symbol}</Text>
        </View>
        <View style={styles.flowBox}>
          <TrendingUp size={18} color="#059669" />
          <Text style={styles.flowBoxLabel}>له</Text>
          <Text style={[styles.flowBoxValue, { color: '#059669' }]}>{formatAmount(flow.totalPaid)} {symbol}</Text>
        </View>
      </View>

      <View style={styles.netBox}>
        <Text style={styles.netLabel}>الصافي الفعلي</Text>
        <Text style={[styles.netValue, { color: netColor }]}>{formatAmount(Math.abs(flow.netFlow))} {symbol}</Text>
      </View>

      <View style={styles.smallGrid}>
        <View style={styles.smallInfoBox}>
          <Text style={styles.smallInfoTitle}>مرتبطة</Text>
          <Text style={styles.smallInfoText}>عليه {formatAmount(flow.linkedReceived)} / له {formatAmount(flow.linkedPaid)}</Text>
        </View>
        <View style={styles.smallInfoBox}>
          <Text style={styles.smallInfoTitle}>غير مرتبطة</Text>
          <Text style={styles.smallInfoText}>عليه {formatAmount(flow.directReceived)} / له {formatAmount(flow.directPaid)}</Text>
        </View>
      </View>

      <View style={styles.chipRow}>
        <Text style={[styles.chip, styles.pendingChip]}>معلّق: {flow.pendingCount} / {formatAmount(flow.pendingAmount)} {symbol}</Text>
        <Text style={[styles.chip, styles.internalChip]}>داخلي: {flow.internalTransferCount} / {formatAmount(flow.internalTransferAmount)} {symbol}</Text>
      </View>
    </View>
  );
}


function NetDebtCard({ item }: { item: NetDebtByCurrency }) {
  const symbol = getCurrencySymbol(item.currency);
  const color = item.direction === 'for_me' ? '#059669' : item.direction === 'on_me' ? '#DC2626' : '#6B7280';
  const label = item.direction === 'for_me' ? 'الصافي لك' : item.direction === 'on_me' ? 'الصافي عليك' : 'متوازن';
  const hint = item.direction === 'balanced'
    ? 'كل ما لك وما عليك متساوٍ في هذه العملة'
    : 'بعد تصفية جميع العملاء في نفس العملة';

  return (
    <View style={styles.flowCard}>
      <View style={styles.flowHeader}>
        <View>
          <Text style={styles.flowCurrency}>{item.currency}</Text>
          <Text style={styles.flowHint}>{hint}</Text>
        </View>
        <View style={[styles.netPill, { backgroundColor: `${color}14` }]}> 
          <Text style={[styles.netPillText, { color }]}>{label}</Text>
        </View>
      </View>

      <View style={styles.netBox}>
        <Text style={styles.netLabel}>النتيجة النهائية</Text>
        <Text style={[styles.netValue, { color }]}>{formatAmount(item.finalAmount)} {symbol}</Text>
      </View>

      <View style={styles.smallGrid}>
        <View style={styles.smallInfoBox}>
          <Text style={styles.smallInfoTitle}>إجمالي الذي لك</Text>
          <Text style={[styles.smallInfoText, { color: '#059669', fontWeight: '900' }]}>
            {formatAmount(item.totalForMe)} {symbol}
          </Text>
        </View>
        <View style={styles.smallInfoBox}>
          <Text style={styles.smallInfoTitle}>إجمالي الذي عليك</Text>
          <Text style={[styles.smallInfoText, { color: '#DC2626', fontWeight: '900' }]}>
            {formatAmount(item.totalOnMe)} {symbol}
          </Text>
        </View>
      </View>
    </View>
  );
}

export default function StatisticsScreen() {
  const router = useRouter();
  const { currentUser } = useAuth();
  const { lastRefreshTime } = useDataRefresh();
  const [stats, setStats] = useState<StatisticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    if (!currentUser?.userId) {
      setStats(null);
      setLoading(false);
      return;
    }

    try {
      setError(null);
      const data = await StatisticsService.fetchAllStatistics(currentUser.userId);
      setStats(data);
    } catch (loadError) {
      console.error('[StatisticsScreen] loadStats failed:', loadError);
      setError(loadError instanceof Error ? loadError.message : 'حدث خطأ أثناء تحميل الإحصائيات');
    } finally {
      setLoading(false);
    }
  }, [currentUser?.userId]);

  useEffect(() => {
    setLoading(true);
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    if (!loading && currentUser?.userId) {
      loadStats();
    }
  }, [lastRefreshTime]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadStats();
    setRefreshing(false);
  };

  const zeroButDataExists = useMemo(() => {
    if (!stats?.debug) return false;
    return stats.totalMovements === 0 && stats.debug.scopedMovements > 0;
  }, [stats]);

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <ArrowRight size={24} color="#111827" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>الإحصائيات</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color="#2563EB" />
          <Text style={styles.centerText}>جاري تحميل الإحصائيات...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ArrowRight size={24} color="#111827" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>الإحصائيات</Text>
        <TouchableOpacity style={styles.backButton} onPress={loadStats}>
          <RefreshCcw size={21} color="#2563EB" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {error ? (
          <View style={styles.errorBox}>
            <AlertCircle size={24} color="#DC2626" />
            <View style={{ flex: 1 }}>
              <Text style={styles.errorTitle}>تعذر تحميل الإحصائيات</Text>
              <Text style={styles.errorMessage}>{error}</Text>
            </View>
          </View>
        ) : null}

        {zeroButDataExists ? (
          <View style={styles.warningBox}>
            <AlertCircle size={24} color="#D97706" />
            <View style={{ flex: 1 }}>
              <Text style={styles.warningTitle}>تنبيه تشخيصي</Text>
              <Text style={styles.warningMessage}>
                توجد حركات في نطاق المستخدم ({stats?.debug?.scopedMovements}) لكن المعتمد منها صفر. راجع حالة approval_status أو is_voided في Supabase.
              </Text>
            </View>
          </View>
        ) : null}

        <SectionHeader title="ملخص عام" icon={BarChart3} color="#2563EB" />
        <View style={styles.statsGrid}>
          <StatCard title="العملاء" value={stats?.totalCustomers || 0} color="#2563EB" icon={Users} />
          <StatCard title="الحركات المعتمدة" value={stats?.totalMovements || 0} color="#059669" icon={CheckCircle2} />
          <StatCard title="الحوالات" value={stats?.totalTransactions || 0} color="#7C3AED" icon={BarChart3} />
          <StatCard title="العملات" value={stats?.cashFlowByCurrency.length || 0} color="#D97706" icon={Wallet} />
        </View>

        <SectionHeader title="ما يحتاج متابعة" icon={Clock} color="#D97706" />
        <View style={styles.statsGrid}>
          <StatCard
            title="بانتظار موافقتي"
            value={stats?.actionableStats.awaitingMyApprovalCount || 0}
            subtitle={currencyLine(stats?.actionableStats.awaitingMyApprovalByCurrency || [])}
            color="#D97706"
            icon={Clock}
          />
          <StatCard
            title="بانتظار الطرف الآخر"
            value={stats?.actionableStats.awaitingOthersApprovalCount || 0}
            subtitle={currencyLine(stats?.actionableStats.awaitingOthersApprovalByCurrency || [])}
            color="#2563EB"
            icon={RefreshCcw}
          />
          <StatCard
            title="متأخر 24 ساعة"
            value={stats?.actionableStats.stalePendingCount || 0}
            subtitle={currencyLine(stats?.actionableStats.stalePendingByCurrency || [])}
            color="#DC2626"
            icon={AlertCircle}
          />
          <StatCard
            title="نسبة القبول"
            value={`${stats?.actionableStats.approvalRateLast7Days || 0}%`}
            subtitle={`${stats?.actionableStats.approvedLast7Days || 0} قبول / ${stats?.actionableStats.rejectedLast7Days || 0} رفض`}
            color="#059669"
            icon={CheckCircle2}
          />
        </View>

        <SectionHeader title="الصافي النهائي حسب العملة" icon={Wallet} color="#2563EB" />
        {stats?.debtStats.netByCurrency.length ? (
          stats.debtStats.netByCurrency.map((item) => <NetDebtCard key={item.currency} item={item} />)
        ) : (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>لا توجد ديون صافية</Text>
            <Text style={styles.emptyMessage}>لا يوجد فرق بين ما لك وما عليك في العملات الحالية.</Text>
          </View>
        )}

        <SectionHeader title="تفاصيل الديون قبل التصفية" icon={AlertCircle} color="#DC2626" />
        <View style={styles.debtBox}>
          <View style={styles.debtColumn}>
            <Text style={styles.debtLabel}>إجمالي الذي لك</Text>
            <Text style={[styles.debtValue, { color: '#059669' }]}>{currencyLine(stats?.debtStats.owedToUsByCurrency || [])}</Text>
          </View>
          <View style={styles.verticalDivider} />
          <View style={styles.debtColumn}>
            <Text style={styles.debtLabel}>إجمالي الذي عليك</Text>
            <Text style={[styles.debtValue, { color: '#DC2626' }]}>{currencyLine(stats?.debtStats.weOweByCurrency || [])}</Text>
          </View>
        </View>

        <SectionHeader title="التدفق المالي حسب الحركة" icon={Wallet} color="#2563EB" />
        {stats?.cashFlowByCurrency.length ? (
          stats.cashFlowByCurrency.map((flow) => <CashFlowCard key={flow.currency} flow={flow} />)
        ) : (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>لا يوجد تدفق مالي ظاهر</Text>
            <Text style={styles.emptyMessage}>إذا كانت هناك حركات فعلية، افتح قسم التشخيص أسفل الصفحة لمعرفة هل المشكلة من النطاق أو من حالة الموافقة.</Text>
          </View>
        )}

        <SectionHeader title="إحصائيات الفترات" icon={BarChart3} color="#7C3AED" />
        {(Object.keys(periodLabels) as PeriodKey[]).map((key) => (
          <PeriodCard key={key} label={periodLabels[key]} data={stats?.periodStats[key] || {
            transactions: 0,
            movements: 0,
            commissionMovements: 0,
            transactionAmount: 0,
            movementAmount: 0,
            commissionAmount: 0,
            transactionAmountsByCurrency: [],
            movementAmountsByCurrency: [],
            commissionAmountsByCurrency: [],
          }} />
        ))}

        {stats?.topCustomers.length ? (
          <>
            <SectionHeader title="أكثر العملاء نشاطًا" icon={Users} color="#059669" />
            {stats.topCustomers.map((customer, index) => (
              <View key={customer.id} style={styles.customerCard}>
                <View style={styles.rankCircle}>
                  <Text style={styles.rankText}>{index + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.customerName}>{customer.name}</Text>
                  <Text style={styles.customerMeta}>{customer.totalMovements} حركة • {formatAmount(customer.totalVolume)}</Text>
                  <Text style={styles.customerMeta}>{currencyLine(customer.balanceByCurrency)}</Text>
                </View>
              </View>
            ))}
          </>
        ) : null}

        {stats?.debug ? (
          <View style={styles.debugBox}>
            <Text style={styles.debugTitle}>تشخيص مصدر البيانات</Text>
            <Text style={styles.debugText}>المستخدم: {stats.debug.selectedUser?.user_name || 'غير معروف'} / {stats.debug.selectedUser?.role || '-'}</Text>
            <Text style={styles.debugText}>كل العملاء: {stats.debug.allCustomers} • عملاء النطاق: {stats.debug.scopedCustomers}</Text>
            <Text style={styles.debugText}>كل الحركات: {stats.debug.allMovements} • حركات النطاق: {stats.debug.scopedMovements}</Text>
            <Text style={styles.debugText}>إشعارات المستخدم: {stats.debug.allNotificationsForUser}</Text>
            <Text style={styles.debugText}>الدوال: {stats.debug.functionSignatures.join(' | ')}</Text>
          </View>
        ) : null}

        <View style={{ height: 36 }} />
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  centerText: {
    color: '#4B5563',
    fontSize: 15,
  },
  sectionHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    marginTop: 22,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'right',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  statCard: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    minHeight: 138,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  statValue: {
    fontSize: 26,
    fontWeight: '900',
    color: '#111827',
    textAlign: 'right',
  },
  statTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4B5563',
    textAlign: 'right',
    marginTop: 4,
  },
  statSubtitle: {
    fontSize: 11,
    color: '#6B7280',
    textAlign: 'right',
    marginTop: 6,
    lineHeight: 16,
  },
  errorBox: {
    marginTop: 16,
    backgroundColor: '#FEF2F2',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FECACA',
    padding: 14,
    flexDirection: 'row-reverse',
    gap: 12,
  },
  errorTitle: {
    color: '#991B1B',
    fontWeight: '800',
    textAlign: 'right',
  },
  errorMessage: {
    color: '#7F1D1D',
    marginTop: 4,
    lineHeight: 20,
    textAlign: 'right',
  },
  warningBox: {
    marginTop: 16,
    backgroundColor: '#FFFBEB',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FDE68A',
    padding: 14,
    flexDirection: 'row-reverse',
    gap: 12,
  },
  warningTitle: {
    color: '#92400E',
    fontWeight: '800',
    textAlign: 'right',
  },
  warningMessage: {
    color: '#92400E',
    marginTop: 4,
    lineHeight: 20,
    textAlign: 'right',
  },
  flowCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 12,
  },
  flowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  flowCurrency: {
    fontSize: 20,
    fontWeight: '900',
    color: '#111827',
  },
  flowHint: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  netPill: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  netPillText: {
    fontSize: 12,
    fontWeight: '800',
  },
  flowMainRow: {
    flexDirection: 'row',
    gap: 10,
  },
  flowBox: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  flowBoxLabel: {
    color: '#4B5563',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 8,
    textAlign: 'right',
  },
  flowBoxValue: {
    fontSize: 17,
    fontWeight: '900',
    textAlign: 'right',
    marginTop: 4,
  },
  netBox: {
    marginTop: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
  },
  netLabel: {
    color: '#6B7280',
    fontWeight: '700',
  },
  netValue: {
    marginTop: 4,
    fontSize: 23,
    fontWeight: '900',
  },
  smallGrid: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  smallInfoBox: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    padding: 10,
  },
  smallInfoTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'right',
  },
  smallInfoText: {
    fontSize: 11,
    color: '#4B5563',
    textAlign: 'right',
    marginTop: 5,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  chip: {
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 11,
    fontWeight: '700',
  },
  pendingChip: {
    backgroundColor: '#FEF3C7',
    color: '#92400E',
  },
  internalChip: {
    backgroundColor: '#DBEAFE',
    color: '#1D4ED8',
  },
  emptyBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  emptyTitle: {
    fontWeight: '800',
    color: '#111827',
    textAlign: 'center',
  },
  emptyMessage: {
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 20,
  },
  debtBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  debtColumn: {
    flex: 1,
    alignItems: 'center',
  },
  debtLabel: {
    color: '#6B7280',
    fontWeight: '800',
    marginBottom: 6,
  },
  debtValue: {
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
  verticalDivider: {
    width: 1,
    backgroundColor: '#E5E7EB',
    marginHorizontal: 10,
  },
  periodCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 14,
    marginBottom: 10,
  },
  periodTitle: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '900',
    textAlign: 'right',
    marginBottom: 10,
  },
  periodRow: {
    flexDirection: 'row',
  },
  periodMetric: {
    flex: 1,
    alignItems: 'center',
  },
  periodMetricLabel: {
    color: '#6B7280',
    fontWeight: '700',
  },
  periodMetricValue: {
    color: '#2563EB',
    fontSize: 23,
    fontWeight: '900',
    marginTop: 5,
  },
  periodMetricHint: {
    color: '#6B7280',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 4,
  },
  customerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 10,
    flexDirection: 'row-reverse',
    gap: 12,
    alignItems: 'center',
  },
  rankCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: {
    color: '#059669',
    fontWeight: '900',
  },
  customerName: {
    color: '#111827',
    fontWeight: '900',
    textAlign: 'right',
  },
  customerMeta: {
    color: '#6B7280',
    fontSize: 12,
    marginTop: 3,
    textAlign: 'right',
  },
  debugBox: {
    marginTop: 20,
    backgroundColor: '#111827',
    borderRadius: 18,
    padding: 14,
  },
  debugTitle: {
    color: '#FFFFFF',
    fontWeight: '900',
    textAlign: 'right',
    marginBottom: 8,
  },
  debugText: {
    color: '#D1D5DB',
    fontSize: 12,
    textAlign: 'right',
    marginTop: 4,
    lineHeight: 18,
  },
});
