import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  ChevronLeft,
  Search,
  Calendar,
  Clock3,
  Users,
  ArrowLeftRight,
  TrendingUp,
} from 'lucide-react-native';

import { useAuth } from '@/contexts/AuthContext';
import { useDataRefresh } from '@/contexts/DataRefreshContext';
import { CURRENCIES } from '@/types/database';
import { StatisticsData, StatisticsService } from '@/services/statisticsService';

// ============================================================
// Types
// ============================================================
type CurrencyLedgerRow = {
  currency: string;
  totalForMe: number;
  totalOnMe: number;
  countForMe: number;
  countOnMe: number;
  netAmount: number;
  finalAmount: number;
  direction: 'for_me' | 'on_me' | 'balanced';
};

type TopCustomerRow = {
  id: string | number;
  name: string;
  initials: string;
  amount: number;
  currency: string;
  count: number;
  lastActivity: string;
  direction: 'for_me' | 'on_me';
};

type TransactionsCountData = {
  today: number;
  week: number;
  month: number;
  yesterday?: number;
  previousMonth?: number;
  weeklyTrend?: number[]; // last 7 days
};

// ============================================================
// Theme
// ============================================================
const C = {
  text: '#111827',
  muted: '#6B7280',
  faint: '#9CA3AF',
  border: '#E5E7EB',
  bg: '#FFFFFF',
  bgSoft: '#F9FAFB',
  bgSofter: '#FAFBFC',
  green: '#047857',
  greenSoft: '#ECFDF5',
  red: '#B91C1C',
  redSoft: '#FEE2E2',
  yellow: '#B45309',
  yellowSoft: '#FEF3C7',
  blue: '#1D4ED8',
  blueLink: '#2563EB',
  blueSoft: '#DBEAFE',
  purple: '#3C3489',
  purpleSoft: '#EEEDFE',
  avatarBg: '#F3F4F6',
  avatarText: '#4B5563',
};

// ============================================================
// Helpers
// ============================================================
function toArabicDigits(input: number | string): string {
  const map = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  return String(input ?? '').replace(/\d/g, (d) => map[Number(d)]);
}

function formatAmount(amount: number): string {
  return Number(amount || 0).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function getCurrencyInfo(code: string) {
  return (
    CURRENCIES.find((currency) => currency.code === code) || {
      code,
      name: code,
      symbol: code,
    }
  );
}

function sumCurrencyList(items?: { currency: string; amount?: number; total?: number }[]) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, item) => {
    const value = Number(item.amount ?? item.total ?? 0);
    return sum + value;
  }, 0);
}

function getInitials(name: string): string {
  if (!name) return '؟';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2);
  return `${parts[0][0] || ''} ${parts[1][0] || ''}`.trim();
}

function buildCurrencyLedgerRows(stats: StatisticsData | null): CurrencyLedgerRow[] {
  if (!stats) return [];

  const map = new Map<
    string,
    { totalForMe: number; totalOnMe: number; countForMe: number; countOnMe: number }
  >();

  (stats.debtStats?.owedToUsByCurrency || []).forEach((item: any) => {
    const c = map.get(item.currency) || {
      totalForMe: 0,
      totalOnMe: 0,
      countForMe: 0,
      countOnMe: 0,
    };
    c.totalForMe += Number(item.amount || 0);
    c.countForMe += Number(item.count || 0);
    map.set(item.currency, c);
  });

  (stats.debtStats?.weOweByCurrency || []).forEach((item: any) => {
    const c = map.get(item.currency) || {
      totalForMe: 0,
      totalOnMe: 0,
      countForMe: 0,
      countOnMe: 0,
    };
    c.totalOnMe += Number(item.amount || 0);
    c.countOnMe += Number(item.count || 0);
    map.set(item.currency, c);
  });

  return Array.from(map.entries())
    .map(([currency, t]) => {
      const netAmount = t.totalForMe - t.totalOnMe;
      return {
        currency,
        totalForMe: t.totalForMe,
        totalOnMe: t.totalOnMe,
        countForMe: t.countForMe,
        countOnMe: t.countOnMe,
        netAmount,
        finalAmount: Math.abs(netAmount),
        direction: netAmount > 0 ? 'for_me' : netAmount < 0 ? 'on_me' : 'balanced',
      } as CurrencyLedgerRow;
    })
    .sort((a, b) => b.finalAmount - a.finalAmount);
}

function buildTopCustomers(stats: StatisticsData | null): TopCustomerRow[] {
  const list: any[] = (stats as any)?.topCustomers || [];
  if (!Array.isArray(list)) return [];
  return list.slice(0, 3).map((item: any, index: number) => ({
    id: item.id ?? index,
    name: item.name ?? 'عميل',
    initials: getInitials(item.name ?? ''),
    amount: Number(item.amount || 0),
    currency: item.currency || 'USD',
    count: Number(item.count || 0),
    lastActivity: item.lastActivity || '',
    direction: Number(item.amount) >= 0 ? 'for_me' : 'on_me',
  }));
}

function buildTxCount(stats: StatisticsData | null): TransactionsCountData {
  const t: any = (stats as any)?.transactionsCount || {};
  return {
    today: Number(t.today || 0),
    week: Number(t.week || 0),
    month: Number(t.month || 0),
    yesterday: t.yesterday != null ? Number(t.yesterday) : undefined,
    previousMonth: t.previousMonth != null ? Number(t.previousMonth) : undefined,
    weeklyTrend: Array.isArray(t.weeklyTrend) ? t.weeklyTrend.map(Number) : undefined,
  };
}

function getCurrentArabicMonthRange(): string {
  const months = [
    'كانون الثاني',
    'شباط',
    'آذار',
    'نيسان',
    'أيار',
    'حزيران',
    'تموز',
    'آب',
    'أيلول',
    'تشرين الأول',
    'تشرين الثاني',
    'كانون الأول',
  ];
  const now = new Date();
  const m = months[now.getMonth()];
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return `${toArabicDigits(1)} - ${toArabicDigits(lastDay)} ${m} ${toArabicDigits(now.getFullYear())}`;
}

// ============================================================
// Sub components
// ============================================================
function SectionHeader({
  title,
  rightSlot,
}: {
  title: string;
  rightSlot?: React.ReactNode;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderTitle}>{title}</Text>
      {rightSlot ?? <View />}
    </View>
  );
}

function TopBar({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.topBar}>
      <TouchableOpacity style={styles.iconBtn} onPress={onBack} activeOpacity={0.7}>
        <ChevronLeft size={14} color={C.text} />
      </TouchableOpacity>

      <View style={styles.topTitleWrap}>
        <Text style={styles.topTitle}>دفتر الأستاذ</Text>
        <Text style={styles.topSubtitle}>الإحصائيات والمستحقات</Text>
      </View>

      <TouchableOpacity style={styles.iconBtn} activeOpacity={0.7}>
        <Search size={14} color={C.text} />
      </TouchableOpacity>
    </View>
  );
}

function PeriodBar({ label, onChange }: { label: string; onChange: () => void }) {
  return (
    <View style={styles.periodBar}>
      <View style={styles.periodLeftWrap}>
        <Calendar size={13} color={C.text} />
        <Text style={styles.periodLabel}>{label}</Text>
      </View>

      <TouchableOpacity style={styles.periodChangeWrap} onPress={onChange} activeOpacity={0.7}>
        <Text style={styles.periodChangeText}>تغيير الفترة</Text>
        <ChevronLeft size={11} color={C.blueLink} />
      </TouchableOpacity>
    </View>
  );
}

function KPISummary({
  totalForMe,
  totalOnMe,
  customersForMe,
  customersOnMe,
}: {
  totalForMe: number;
  totalOnMe: number;
  customersForMe: number;
  customersOnMe: number;
}) {
  return (
    <View style={styles.kpiRow}>
      <View style={[styles.kpiBox, styles.kpiBoxLeftBorder]}>
        <Text style={styles.kpiLabel}>إجمالي مستحقاتي (لنا)</Text>
        <Text style={[styles.kpiValue, { color: C.green }]}>$ {formatAmount(totalForMe)}</Text>
        <Text style={styles.kpiHint}>من {toArabicDigits(customersForMe)} عميل</Text>
      </View>

      <View style={styles.kpiBox}>
        <Text style={styles.kpiLabel}>إجمالي ديوني (علينا)</Text>
        <Text style={[styles.kpiValue, { color: C.red }]}>$ {formatAmount(totalOnMe)}</Text>
        <Text style={styles.kpiHint}>إلى {toArabicDigits(customersOnMe)} عميل</Text>
      </View>
    </View>
  );
}

function TransactionsCount({ data }: { data: TransactionsCountData }) {
  const { today, week, month, yesterday, previousMonth, weeklyTrend } = data;

  const total = (today || 0) + (week || 0) + (month || 0);
  const yesterdayDelta =
    yesterday != null ? today - yesterday : null;
  const monthDeltaPct =
    previousMonth && previousMonth > 0
      ? Math.round(((month - previousMonth) / previousMonth) * 100)
      : null;
  const weekAvg = week > 0 ? (week / 7).toFixed(1) : '0';

  // Sparkline values (height ratios). Fallback to a neutral pattern.
  const trend =
    weeklyTrend && weeklyTrend.length > 0
      ? weeklyTrend
      : [3, 5, 4, 7, 5, 8, today || 0];
  const trendMax = Math.max(...trend, 1);

  return (
    <View>
      <SectionHeader
        title="عدد الحوالات"
        rightSlot={
          <View style={styles.sectionHeaderIconWrap}>
            <View style={styles.sectionHeaderIconCircle}>
              <ArrowLeftRight size={12} color={C.purple} />
            </View>
          </View>
        }
      />

      <View style={styles.cardOutlined}>
        <View style={styles.txCountRow}>
          <View style={[styles.txCountCol, styles.txCountColBorder, styles.txCountColToday]}>
            <Text style={styles.txCountLabel}>اليوم</Text>
            <Text style={styles.txCountValue}>{toArabicDigits(today)}</Text>
            {yesterdayDelta != null ? (
              <Text
                style={[
                  styles.txCountHint,
                  { color: yesterdayDelta >= 0 ? C.green : C.red },
                ]}
              >
                {yesterdayDelta >= 0 ? '+' : '−'}
                {toArabicDigits(Math.abs(yesterdayDelta))} عن أمس
              </Text>
            ) : (
              <Text style={styles.txCountHint}>—</Text>
            )}
          </View>

          <View style={[styles.txCountCol, styles.txCountColBorder]}>
            <Text style={styles.txCountLabel}>هذا الأسبوع</Text>
            <Text style={styles.txCountValue}>{toArabicDigits(week)}</Text>
            <Text style={styles.txCountHint}>معدل {toArabicDigits(weekAvg)} / يوم</Text>
          </View>

          <View style={styles.txCountCol}>
            <Text style={styles.txCountLabel}>هذا الشهر</Text>
            <Text style={styles.txCountValue}>{toArabicDigits(month)}</Text>
            {monthDeltaPct != null ? (
              <Text
                style={[
                  styles.txCountHint,
                  { color: monthDeltaPct >= 0 ? C.green : C.red },
                ]}
              >
                {monthDeltaPct >= 0 ? '+' : '−'}
                {toArabicDigits(Math.abs(monthDeltaPct))}٪ عن السابق
              </Text>
            ) : (
              <Text style={styles.txCountHint}>—</Text>
            )}
          </View>
        </View>

        <View style={styles.sparkRow}>
          {trend.slice(-7).map((v, i, arr) => {
            const isLast = i === arr.length - 1;
            const heightPct = Math.max(8, Math.round((v / trendMax) * 100));
            return (
              <View
                key={i}
                style={{
                  flex: 1,
                  height: `${heightPct}%`,
                  backgroundColor: isLast ? C.blueLink : C.blueSoft,
                  borderTopLeftRadius: 2,
                  borderTopRightRadius: 2,
                  marginHorizontal: 1.5,
                }}
              />
            );
          })}
        </View>
      </View>

      <View style={styles.txCountFooter}>
        <Text style={styles.txCountFooterText}>
          إجمالي الفترة {toArabicDigits(total)}
        </Text>
      </View>
    </View>
  );
}

function CurrencyLedger({ rows }: { rows: CurrencyLedgerRow[] }) {
  if (rows.length === 0) {
    return (
      <View>
        <SectionHeader title="حركة الحساب حسب العملة" />
        <View style={styles.cardOutlined}>
          <Text style={styles.emptyText}>لا توجد حركات حسابية في الفترة المحددة</Text>
        </View>
      </View>
    );
  }

  return (
    <View>
      <SectionHeader
        title="حركة الحساب حسب العملة"
        rightSlot={
          <TouchableOpacity activeOpacity={0.7}>
            <Text style={styles.linkText}>عرض الكل</Text>
          </TouchableOpacity>
        }
      />

      <View style={styles.cardOutlined}>
        {/* Table header */}
        <View style={styles.ledgerHeaderRow}>
          <Text style={[styles.ledgerHeaderCell, styles.colCurrency]}>العملة</Text>
          <Text style={[styles.ledgerHeaderCell, styles.colFlex]}>لنا</Text>
          <Text style={[styles.ledgerHeaderCell, styles.colFlex]}>علينا</Text>
          <Text style={[styles.ledgerHeaderCell, styles.colFlex]}>الصافي</Text>
          <View style={styles.colChevron} />
        </View>

        {rows.map((row, idx) => {
          const netColor =
            row.direction === 'for_me'
              ? C.green
              : row.direction === 'on_me'
                ? C.red
                : C.muted;
          const sign =
            row.direction === 'for_me' ? '+ ' : row.direction === 'on_me' ? '− ' : '';

          return (
            <TouchableOpacity
              key={row.currency}
              activeOpacity={0.7}
              style={[
                styles.ledgerDataRow,
                idx !== rows.length - 1 && styles.ledgerRowDivider,
              ]}
            >
              <View style={styles.colCurrency}>
                <Text style={styles.ledgerCurrencyCode}>{row.currency}</Text>
              </View>

              <View style={styles.colFlex}>
                <Text style={[styles.ledgerNumber, { color: C.green }]}>
                  {formatAmount(row.totalForMe)}
                </Text>
                <Text style={styles.ledgerSubNumber}>
                  {toArabicDigits(row.countForMe)}{' '}
                  {row.countForMe === 1 ? 'حركة' : 'حركات'}
                </Text>
              </View>

              <View style={styles.colFlex}>
                <Text style={[styles.ledgerNumber, { color: C.red }]}>
                  {formatAmount(row.totalOnMe)}
                </Text>
                <Text style={styles.ledgerSubNumber}>
                  {toArabicDigits(row.countOnMe)}{' '}
                  {row.countOnMe === 1 ? 'حركة' : 'حركات'}
                </Text>
              </View>

              <View style={styles.colFlex}>
                <Text style={[styles.ledgerNet, { color: netColor }]}>
                  {row.direction === 'balanced'
                    ? '0'
                    : `${sign}${formatAmount(row.finalAmount)}`}
                </Text>
              </View>

              <View style={styles.colChevron}>
                <ChevronLeft size={9} color={C.faint} />
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function PendingOperations({
  awaitingMineCount,
  awaitingMineAmount,
  awaitingMineCustomers,
  awaitingMineOldest,
  awaitingOthersCount,
  awaitingOthersAmount,
  awaitingOthersCustomers,
  awaitingOthersOldest,
  onPress,
}: {
  awaitingMineCount: number;
  awaitingMineAmount: number;
  awaitingMineCustomers: number;
  awaitingMineOldest: string;
  awaitingOthersCount: number;
  awaitingOthersAmount: number;
  awaitingOthersCustomers: number;
  awaitingOthersOldest: string;
  onPress: () => void;
}) {
  const totalPending = awaitingMineCount + awaitingOthersCount;

  return (
    <View>
      <SectionHeader
        title="الحركات بانتظار المراجعة"
        rightSlot={
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingBadgeText}>
              {toArabicDigits(totalPending)} معلّق
            </Text>
          </View>
        }
      />

      <View style={styles.cardOutlined}>
        <TouchableOpacity
          style={[styles.pendingRow, styles.ledgerRowDivider]}
          activeOpacity={0.7}
          onPress={onPress}
        >
          <View style={[styles.pendingIconCircle, { backgroundColor: C.yellowSoft }]}>
            <Clock3 size={15} color={C.yellow} />
          </View>

          <View style={styles.pendingTextWrap}>
            <Text style={styles.pendingTitle}>بانتظار موافقتي</Text>
            <Text style={styles.pendingSubtitle}>
              {toArabicDigits(awaitingMineCount)} عمليات • {toArabicDigits(awaitingMineCustomers)} عملاء
              {awaitingMineOldest ? ` • أقدمها ${awaitingMineOldest}` : ''}
            </Text>
          </View>

          <View style={styles.pendingAmountWrap}>
            <Text style={[styles.pendingAmount, { color: C.yellow }]}>
              $ {formatAmount(awaitingMineAmount)}
            </Text>
          </View>

          <ChevronLeft size={10} color={C.faint} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.pendingRow} activeOpacity={0.7} onPress={onPress}>
          <View style={[styles.pendingIconCircle, { backgroundColor: C.blueSoft }]}>
            <Users size={15} color={C.blue} />
          </View>

          <View style={styles.pendingTextWrap}>
            <Text style={styles.pendingTitle}>بانتظار العملاء</Text>
            <Text style={styles.pendingSubtitle}>
              {toArabicDigits(awaitingOthersCount)} عملية • {toArabicDigits(awaitingOthersCustomers)} عملاء
              {awaitingOthersOldest ? ` • أقدمها ${awaitingOthersOldest}` : ''}
            </Text>
          </View>

          <View style={styles.pendingAmountWrap}>
            <Text style={[styles.pendingAmount, { color: C.blue }]}>
              $ {formatAmount(awaitingOthersAmount)}
            </Text>
          </View>

          <ChevronLeft size={10} color={C.faint} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function TopCustomers({ customers }: { customers: TopCustomerRow[] }) {
  if (customers.length === 0) return null;

  return (
    <View>
      <SectionHeader
        title="أعلى ٣ أرصدة عملاء"
        rightSlot={
          <TouchableOpacity activeOpacity={0.7}>
            <Text style={styles.linkText}>عرض الكل</Text>
          </TouchableOpacity>
        }
      />

      <View style={[styles.cardOutlined, { marginBottom: 16 }]}>
        {customers.map((c, idx) => {
          const color = c.direction === 'for_me' ? C.green : C.red;
          const sign = c.direction === 'for_me' ? '+ ' : '− ';
          return (
            <TouchableOpacity
              key={c.id}
              style={[
                styles.customerRow,
                idx !== customers.length - 1 && styles.ledgerRowDivider,
              ]}
              activeOpacity={0.7}
            >
              <View style={styles.customerAvatar}>
                <Text style={styles.customerAvatarText}>{c.initials}</Text>
              </View>

              <View style={styles.customerTextWrap}>
                <Text style={styles.customerName}>{c.name}</Text>
                <Text style={styles.customerSub}>
                  {toArabicDigits(c.count)} حركات
                  {c.lastActivity ? ` • آخر حركة ${c.lastActivity}` : ''}
                </Text>
              </View>

              <View style={styles.customerAmountWrap}>
                <Text style={[styles.customerAmount, { color }]}>
                  {sign}
                  {formatAmount(Math.abs(c.amount))} {c.currency}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ============================================================
// Main screen
// ============================================================
export default function StatisticsScreen() {
  const router = useRouter();
  const { currentUser } = useAuth();
  const { lastRefreshTime } = useDataRefresh();

  const [stats, setStats] = useState<StatisticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadStats = useCallback(async () => {
    if (!currentUser?.userId) {
      setStats(null);
      setLoading(false);
      return;
    }

    try {
      const data = await StatisticsService.fetchAllStatistics(currentUser.userId);
      setStats(data);
    } catch (error) {
      console.error('[StatisticsScreen] loadStats failed:', error);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastRefreshTime, currentUser?.userId]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadStats();
    setRefreshing(false);
  };

  const ledgerRows = useMemo(() => buildCurrencyLedgerRows(stats), [stats]);
  const topCustomers = useMemo(() => buildTopCustomers(stats), [stats]);
  const txCount = useMemo(() => buildTxCount(stats), [stats]);

  const totalForMe = useMemo(
    () => sumCurrencyList(stats?.debtStats?.owedToUsByCurrency as any),
    [stats],
  );
  const totalOnMe = useMemo(
    () => sumCurrencyList(stats?.debtStats?.weOweByCurrency as any),
    [stats],
  );

  const customersForMe = Number((stats?.debtStats as any)?.customersOwingUsCount || 0);
  const customersOnMe = Number((stats?.debtStats as any)?.customersWeOweCount || 0);

  const pendingMineAmount = useMemo(
    () => sumCurrencyList(stats?.actionableStats?.awaitingMyApprovalByCurrency as any),
    [stats],
  );
  const pendingOthersAmount = useMemo(
    () => sumCurrencyList(stats?.actionableStats?.awaitingOthersApprovalByCurrency as any),
    [stats],
  );

  const pendingMineCustomers = Number(
    (stats?.actionableStats as any)?.awaitingMyApprovalCustomersCount || 0,
  );
  const pendingOthersCustomers = Number(
    (stats?.actionableStats as any)?.awaitingOthersApprovalCustomersCount || 0,
  );
  const pendingMineOldest = String(
    (stats?.actionableStats as any)?.awaitingMyApprovalOldestLabel || '',
  );
  const pendingOthersOldest = String(
    (stats?.actionableStats as any)?.awaitingOthersApprovalOldestLabel || '',
  );

  const goToSettings = () => {
    router.push('/settings' as any);
  };

  const onChangePeriod = () => {
    // hook your period picker here
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={C.purple} />
        <Text style={styles.loadingText}>جاري تحميل الإحصائيات...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TopBar onBack={() => router.back()} />

      <PeriodBar label={getCurrentArabicMonthRange()} onChange={onChangePeriod} />

      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.contentContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        <KPISummary
          totalForMe={totalForMe}
          totalOnMe={totalOnMe}
          customersForMe={customersForMe}
          customersOnMe={customersOnMe}
        />

        <TransactionsCount data={txCount} />

        <CurrencyLedger rows={ledgerRows} />

        <PendingOperations
          awaitingMineCount={Number(stats?.actionableStats?.awaitingMyApprovalCount || 0)}
          awaitingMineAmount={pendingMineAmount}
          awaitingMineCustomers={pendingMineCustomers}
          awaitingMineOldest={pendingMineOldest}
          awaitingOthersCount={Number(stats?.actionableStats?.awaitingOthersApprovalCount || 0)}
          awaitingOthersAmount={pendingOthersAmount}
          awaitingOthersCustomers={pendingOthersCustomers}
          awaitingOthersOldest={pendingOthersOldest}
          onPress={goToSettings}
        />

        <TopCustomers customers={topCustomers} />
      </ScrollView>
    </View>
  );
}

// ============================================================
// Styles
// ============================================================
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  screen: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: 24,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: C.bg,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: C.muted,
    fontWeight: '500',
    writingDirection: 'rtl',
  },

  // Top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: C.border,
  },
  iconBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitleWrap: {
    alignItems: 'center',
  },
  topTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: C.text,
    writingDirection: 'rtl',
  },
  topSubtitle: {
    fontSize: 11,
    color: C.muted,
    marginTop: 1,
    writingDirection: 'rtl',
  },

  // Period bar
  periodBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: C.bgSoft,
    borderBottomWidth: 0.5,
    borderBottomColor: C.border,
  },
  periodLeftWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  periodLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: C.text,
    writingDirection: 'rtl',
  },
  periodChangeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  periodChangeText: {
    fontSize: 11,
    color: C.blueLink,
    fontWeight: '500',
    writingDirection: 'rtl',
  },

  // KPI summary
  kpiRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: C.border,
  },
  kpiBox: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  kpiBoxLeftBorder: {
    borderLeftWidth: 0.5,
    borderLeftColor: C.border,
  },
  kpiLabel: {
    fontSize: 11,
    color: C.muted,
    marginBottom: 4,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  kpiValue: {
    fontSize: 17,
    fontWeight: '500',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  kpiHint: {
    fontSize: 11,
    color: C.muted,
    marginTop: 2,
    textAlign: 'right',
    writingDirection: 'rtl',
  },

  // Section header
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  sectionHeaderTitle: {
    fontSize: 13,
    fontWeight: '500',
    color: C.text,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  sectionHeaderIconWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionHeaderIconCircle: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: C.purpleSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkText: {
    fontSize: 11,
    color: C.blueLink,
    fontWeight: '500',
    writingDirection: 'rtl',
  },
  emptyText: {
    fontSize: 13,
    color: C.muted,
    textAlign: 'center',
    padding: 16,
    writingDirection: 'rtl',
  },

  // Generic card outlined
  cardOutlined: {
    marginHorizontal: 16,
    borderWidth: 0.5,
    borderColor: C.border,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: C.bg,
  },

  // Transactions count
  txCountRow: {
    flexDirection: 'row',
  },
  txCountCol: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  txCountColBorder: {
    borderLeftWidth: 0.5,
    borderLeftColor: C.border,
  },
  txCountColToday: {
    backgroundColor: C.bgSofter,
  },
  txCountLabel: {
    fontSize: 11,
    color: C.muted,
    writingDirection: 'rtl',
  },
  txCountValue: {
    fontSize: 22,
    fontWeight: '500',
    color: C.text,
    marginTop: 6,
    marginBottom: 2,
  },
  txCountHint: {
    fontSize: 10,
    color: C.muted,
    fontWeight: '500',
    writingDirection: 'rtl',
  },
  sparkRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 28,
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 8,
    borderTopWidth: 0.5,
    borderTopColor: C.border,
    backgroundColor: C.bgSofter,
  },
  txCountFooter: {
    paddingHorizontal: 16,
    paddingTop: 6,
    alignItems: 'flex-start',
  },
  txCountFooterText: {
    fontSize: 11,
    color: C.muted,
    writingDirection: 'rtl',
  },

  // Currency ledger
  ledgerHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: C.bgSoft,
    borderBottomWidth: 0.5,
    borderBottomColor: C.border,
  },
  ledgerHeaderCell: {
    fontSize: 10,
    color: C.muted,
    fontWeight: '500',
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  colCurrency: {
    width: 38,
    alignItems: 'center',
  },
  colFlex: {
    flex: 1,
    alignItems: 'center',
  },
  colChevron: {
    width: 12,
    alignItems: 'center',
  },
  ledgerDataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  ledgerRowDivider: {
    borderBottomWidth: 0.5,
    borderBottomColor: C.border,
  },
  ledgerCurrencyCode: {
    fontSize: 10,
    fontWeight: '500',
    color: C.muted,
    textAlign: 'center',
  },
  ledgerNumber: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },
  ledgerSubNumber: {
    fontSize: 9,
    color: C.faint,
    marginTop: 1,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  ledgerNet: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },

  // Pending
  pendingBadge: {
    backgroundColor: C.redSoft,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  pendingBadgeText: {
    fontSize: 10,
    color: C.red,
    fontWeight: '500',
    writingDirection: 'rtl',
  },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 10,
  },
  pendingIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  pendingTitle: {
    fontSize: 12,
    fontWeight: '500',
    color: C.text,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  pendingSubtitle: {
    fontSize: 10,
    color: C.muted,
    marginTop: 1,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  pendingAmountWrap: {
    alignItems: 'flex-start',
  },
  pendingAmount: {
    fontSize: 13,
    fontWeight: '500',
  },

  // Top customers
  customerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  customerAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: C.avatarBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customerAvatarText: {
    fontSize: 10,
    fontWeight: '500',
    color: C.avatarText,
  },
  customerTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  customerName: {
    fontSize: 12,
    fontWeight: '500',
    color: C.text,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  customerSub: {
    fontSize: 10,
    color: C.muted,
    marginTop: 1,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  customerAmountWrap: {
    alignItems: 'flex-start',
  },
  customerAmount: {
    fontSize: 12,
    fontWeight: '500',
  },
});