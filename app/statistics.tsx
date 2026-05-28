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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, G } from 'react-native-svg';
import {
  ArrowRight,
  Clock3,
  ArrowLeftRight,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Plus,
  RefreshCw,
  UserPlus,
  Sun,
  Sunset,
  Moon,
  Wallet,
  BarChart3,
  CheckCircle2,
  XCircle,
  Timer,
} from 'lucide-react-native';

import { useAuth } from '@/contexts/AuthContext';
import { useDataRefresh } from '@/contexts/DataRefreshContext';
import {
  PeriodStats,
  StatisticsData,
  StatisticsService,
  TopCustomer,
} from '@/services/statisticsService';

// ============================================================
// Types
// ============================================================

type CurrencyAmount = { currency: string; amount: number };

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
  id: string;
  name: string;
  initials: string;
  amount: number;
  currency: string;
  count: number;
  lastActivity: string;
  direction: 'for_me' | 'on_me' | 'balanced';
};

type TransactionsCountData = {
  today: number;
  yesterday: number;
  week: number;
  month: number;
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

function toLatinDigits(input: number | string): string {
  return String(input ?? '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

function formatAmount(amount: number): string {
  return Number(amount || 0).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatActivityDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getInitials(name: string): string {
  if (!name) return '؟';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2);
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.trim();
}

function joinMetaParts(parts: Array<string | null | undefined | false>): string {
  return parts.filter(Boolean).join(' • ');
}

function pickDominantBalance(list: CurrencyAmount[]): CurrencyAmount | null {
  if (!list || list.length === 0) return null;
  return list.reduce((best, item) =>
    Math.abs(item.amount) > Math.abs(best.amount) ? item : best
  );
}

function buildCurrencyLedgerRows(stats: StatisticsData | null): CurrencyLedgerRow[] {
  if (!stats) return [];

  const map = new Map<
    string,
    { totalForMe: number; totalOnMe: number; countForMe: number; countOnMe: number }
  >();

  (stats.debtStats?.owedToUsByCurrency || []).forEach((item) => {
    const c = map.get(item.currency) || {
      totalForMe: 0,
      totalOnMe: 0,
      countForMe: 0,
      countOnMe: 0,
    };
    c.totalForMe += Number(item.amount || 0);
    map.set(item.currency, c);
  });

  (stats.debtStats?.weOweByCurrency || []).forEach((item) => {
    const c = map.get(item.currency) || {
      totalForMe: 0,
      totalOnMe: 0,
      countForMe: 0,
      countOnMe: 0,
    };
    c.totalOnMe += Number(item.amount || 0);
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

function buildTopCustomers(customers: TopCustomer[]): TopCustomerRow[] {
  return customers.slice(0, 3).map((c) => {
    const dominant = pickDominantBalance(c.balanceByCurrency);
    const amount = dominant?.amount ?? 0;
    const currency = dominant?.currency ?? '';
    return {
      id: String(c.id),
      name: c.name,
      initials: getInitials(c.name),
      amount,
      currency,
      count: c.totalMovements,
      lastActivity: formatActivityDate(c.lastActivity),
      direction: amount > 0 ? 'for_me' : amount < 0 ? 'on_me' : 'balanced',
    };
  });
}

function buildTxCount(period: StatisticsData['periodStats'] | undefined): TransactionsCountData {
  const get = (p: PeriodStats | undefined) => Number(p?.movements || 0);
  return {
    today: get(period?.today),
    yesterday: get(period?.yesterday),
    week: get(period?.week),
    month: get(period?.month),
  };
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
        <ArrowRight size={20} color={C.text} />
      </TouchableOpacity>

      <View style={styles.topTitleWrap}>
        <Text style={styles.topTitle}>الإحصاءات</Text>
        <Text style={styles.topSubtitle}>الإحصائيات والمستحقات</Text>
      </View>

      <View style={styles.iconBtnPlaceholder} />
    </View>
  );
}

const ARABIC_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const ARABIC_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

function getGreeting(now: Date): { text: string; Icon: typeof Sun } {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return { text: 'صباح الخير', Icon: Sun };
  if (hour >= 12 && hour < 18) return { text: 'مساء الخير', Icon: Sunset };
  return { text: 'مساء الخير', Icon: Moon };
}

function GreetingHeader({
  userName,
  lastUpdatedAt,
  onRefresh,
}: {
  userName: string;
  lastUpdatedAt: Date | null;
  onRefresh: () => void;
}) {
  const now = new Date();
  const { text: greetingText, Icon: GreetingIcon } = getGreeting(now);
  const dateLabel = `${ARABIC_DAYS[now.getDay()]} ${now.getDate()} ${ARABIC_MONTHS[now.getMonth()]} ${now.getFullYear()}`;

  let lastUpdatedText = '';
  if (lastUpdatedAt) {
    const hh = String(lastUpdatedAt.getHours()).padStart(2, '0');
    const mm = String(lastUpdatedAt.getMinutes()).padStart(2, '0');
    lastUpdatedText = `آخر تحديث ${hh}:${mm}`;
  }

  return (
    <View style={styles.greetingWrap}>
      <LinearGradient
        colors={['#4F46E5', '#7C3AED']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.greetingCard}
      >
        <View style={styles.greetingTopRow}>
          <View style={styles.greetingIconCircle}>
            <GreetingIcon size={22} color="#FBBF24" />
          </View>
          <View style={styles.greetingTextWrap}>
            <Text style={styles.greetingHello}>
              {greetingText}{userName ? `، ${userName}` : ''}
            </Text>
            <Text style={styles.greetingDate}>{dateLabel}</Text>
          </View>
        </View>

        {lastUpdatedText ? (
          <View style={styles.greetingFooter}>
            <Text style={styles.greetingFooterText}>{lastUpdatedText}</Text>
            <TouchableOpacity onPress={onRefresh} activeOpacity={0.7} style={styles.greetingRefresh}>
              <RefreshCw size={13} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        ) : null}
      </LinearGradient>
    </View>
  );
}

function CommissionsCard({
  total,
  byCurrency,
}: {
  total: number;
  byCurrency: { currency: string; total: number }[];
}) {
  if (total === 0 && byCurrency.length === 0) {
    return null;
  }

  const sorted = [...byCurrency]
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);
  const dominant = sorted[0];
  const rest = sorted.slice(1, 4);

  return (
    <View>
      <SectionHeader
        title="العمولات المُحصّلة"
        rightSlot={
          <View style={[styles.sectionIcon, { backgroundColor: C.greenSoft }]}>
            <Wallet size={14} color={C.green} />
          </View>
        }
      />

      <View style={[styles.cardOutlined, styles.commissionsCard]}>
        {dominant ? (
          <Text style={styles.commissionsPrimary}>
            {formatAmount(dominant.total)}{' '}
            <Text style={styles.commissionsCurrency}>{dominant.currency}</Text>
          </Text>
        ) : (
          <Text style={styles.commissionsPrimaryEmpty}>لم تُحصّل عمولات بعد</Text>
        )}

        {rest.length > 0 ? (
          <View style={styles.commissionsRest}>
            {rest.map((c) => (
              <View key={c.currency} style={styles.commissionsChip}>
                <Text style={styles.commissionsChipAmount}>{formatAmount(c.total)}</Text>
                <Text style={styles.commissionsChipCode}>{c.currency}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function PerformanceCard({
  approved,
  rejected,
  approvalRate,
  averageMinutes,
}: {
  approved: number;
  rejected: number;
  approvalRate: number;
  averageMinutes: number | null;
}) {
  if (approved === 0 && rejected === 0) {
    return null;
  }

  const ratePct = Math.round(approvalRate * (approvalRate <= 1 ? 100 : 1));
  const avgText = averageMinutes != null && averageMinutes > 0
    ? `${toLatinDigits(Math.round(averageMinutes))} د`
    : '—';

  return (
    <View>
      <SectionHeader
        title="أداء التأكيدات (آخر 7 أيام)"
        rightSlot={
          <View style={[styles.sectionIcon, { backgroundColor: C.blueSoft }]}>
            <BarChart3 size={14} color={C.blue} />
          </View>
        }
      />

      <View style={[styles.cardOutlined, styles.perfCard]}>
        <View style={styles.perfRow}>
          <View style={styles.perfStat}>
            <Text style={[styles.perfValue, { color: C.green }]}>
              {toLatinDigits(ratePct)}%
            </Text>
            <Text style={styles.perfLabel}>معدل التأكيد</Text>
          </View>
          <View style={styles.perfDivider} />
          <View style={styles.perfStat}>
            <View style={styles.perfIconRow}>
              <Timer size={14} color={C.purple} />
              <Text style={[styles.perfValue, { color: C.purple }]}>{avgText}</Text>
            </View>
            <Text style={styles.perfLabel}>متوسط الرد</Text>
          </View>
        </View>

        <View style={styles.perfBreakdown}>
          <View style={styles.perfBreakdownItem}>
            <CheckCircle2 size={14} color={C.green} />
            <Text style={[styles.perfBreakdownText, { color: C.green }]}>
              {toLatinDigits(approved)} معتمدة
            </Text>
          </View>
          <View style={styles.perfBreakdownDot} />
          <View style={styles.perfBreakdownItem}>
            <XCircle size={14} color={C.red} />
            <Text style={[styles.perfBreakdownText, { color: C.red }]}>
              {toLatinDigits(rejected)} مرفوضة
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

type KPICardProps = {
  label: string;
  icon: React.ReactNode;
  iconBg: string;
  primary: string;
  primaryColor: string;
  secondary?: string;
  onPress: () => void;
};

function KPICard({ label, icon, iconBg, primary, primaryColor, secondary, onPress }: KPICardProps) {
  return (
    <TouchableOpacity style={styles.kpiCard} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.kpiCardTop}>
        <Text style={styles.kpiCardLabel}>{label}</Text>
        <View style={[styles.kpiCardIcon, { backgroundColor: iconBg }]}>{icon}</View>
      </View>
      <Text style={[styles.kpiCardPrimary, { color: primaryColor }]} numberOfLines={1}>
        {primary}
      </Text>
      <Text style={styles.kpiCardSecondary} numberOfLines={1}>
        {secondary || ' '}
      </Text>
    </TouchableOpacity>
  );
}

function KPIGrid({
  forMe,
  onMe,
  pendingMineCount,
  pendingOthersCount,
  todayCount,
  yesterdayCount,
  onForMePress,
  onOnMePress,
  onPendingPress,
  onTodayPress,
}: {
  forMe: CurrencyAmount[];
  onMe: CurrencyAmount[];
  pendingMineCount: number;
  pendingOthersCount: number;
  todayCount: number;
  yesterdayCount: number;
  onForMePress: () => void;
  onOnMePress: () => void;
  onPendingPress: () => void;
  onTodayPress: () => void;
}) {
  const forMeDom = pickDominantBalance(forMe);
  const forMeExtra = Math.max(0, forMe.length - 1);
  const onMeDom = pickDominantBalance(onMe);
  const onMeExtra = Math.max(0, onMe.length - 1);

  const totalPending = pendingMineCount + pendingOthersCount;
  const yesterdayDelta = todayCount - yesterdayCount;

  return (
    <View style={styles.kpiGrid}>
      <KPICard
        label="مستحقاتي (لنا)"
        icon={<TrendingUp size={16} color={C.green} />}
        iconBg={C.greenSoft}
        primary={forMeDom ? `+ ${formatAmount(forMeDom.amount)} ${forMeDom.currency}` : '—'}
        primaryColor={C.green}
        secondary={
          forMeDom
            ? forMeExtra > 0
              ? `+ ${toLatinDigits(forMeExtra)} عملة أخرى`
              : ''
            : 'لا توجد مستحقات'
        }
        onPress={onForMePress}
      />
      <KPICard
        label="ديوني (علينا)"
        icon={<TrendingDown size={16} color={C.red} />}
        iconBg={C.redSoft}
        primary={onMeDom ? `− ${formatAmount(onMeDom.amount)} ${onMeDom.currency}` : '—'}
        primaryColor={C.red}
        secondary={
          onMeDom
            ? onMeExtra > 0
              ? `+ ${toLatinDigits(onMeExtra)} عملة أخرى`
              : ''
            : 'لا توجد ديون'
        }
        onPress={onOnMePress}
      />
      <KPICard
        label="بانتظار المراجعة"
        icon={<Clock3 size={16} color={C.yellow} />}
        iconBg={C.yellowSoft}
        primary={totalPending > 0 ? toLatinDigits(totalPending) : '0'}
        primaryColor={totalPending > 0 ? C.yellow : C.muted}
        secondary={
          totalPending > 0
            ? `${toLatinDigits(pendingMineCount)} لي • ${toLatinDigits(pendingOthersCount)} للعملاء`
            : 'لا شيء بانتظارك'
        }
        onPress={onPendingPress}
      />
      <KPICard
        label="حوالات اليوم"
        icon={<ArrowLeftRight size={16} color={C.blue} />}
        iconBg={C.blueSoft}
        primary={toLatinDigits(todayCount)}
        primaryColor={C.text}
        secondary={
          yesterdayCount > 0 || todayCount > 0
            ? `${yesterdayDelta >= 0 ? '+' : '−'}${toLatinDigits(Math.abs(yesterdayDelta))} عن أمس`
            : 'ابدأ يومك بحوالة'
        }
        onPress={onTodayPress}
      />
    </View>
  );
}

function NetDonut({
  forMe,
  onMe,
  size = 96,
  strokeWidth = 11,
}: {
  forMe: number;
  onMe: number;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = forMe + onMe;

  const forMePct = total > 0 ? forMe / total : 0;
  const onMePct = total > 0 ? onMe / total : 0;
  const forMeLength = circumference * forMePct;
  const onMeLength = circumference * onMePct;

  const net = forMe - onMe;
  const isBalanced = total > 0 && net === 0;
  const isEmpty = total === 0;
  const isForMeDom = net > 0;
  const isOnMeDom = net < 0;

  const centerColor = isForMeDom ? C.green : isOnMeDom ? C.red : C.muted;
  const sign = isForMeDom ? '+ ' : isOnMeDom ? '− ' : '';

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <G transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={C.border}
            strokeWidth={strokeWidth}
            fill="none"
          />
          {!isEmpty && forMeLength > 0 ? (
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={C.green}
              strokeWidth={strokeWidth}
              strokeDasharray={`${forMeLength} ${circumference - forMeLength}`}
              fill="none"
              strokeLinecap="butt"
            />
          ) : null}
          {!isEmpty && onMeLength > 0 ? (
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={C.red}
              strokeWidth={strokeWidth}
              strokeDasharray={`${onMeLength} ${circumference - onMeLength}`}
              strokeDashoffset={-forMeLength}
              fill="none"
              strokeLinecap="butt"
            />
          ) : null}
        </G>
      </Svg>
      <View style={styles.donutCenter}>
        {isEmpty ? (
          <Text style={styles.donutEmpty}>—</Text>
        ) : isBalanced ? (
          <Text style={styles.donutBalanced}>متساوي</Text>
        ) : (
          <Text style={[styles.donutNet, { color: centerColor }]}>
            {sign}
            {formatAmount(Math.abs(net))}
          </Text>
        )}
      </View>
    </View>
  );
}

function CurrencyLedger({
  rows,
  onAddMovement,
}: {
  rows: CurrencyLedgerRow[];
  onAddMovement: () => void;
}) {
  if (rows.length === 0) {
    return (
      <View>
        <SectionHeader title="حركة الحساب حسب العملة" />
        <View style={[styles.cardOutlined, styles.emptyCard]}>
          <Text style={styles.emptyText}>لا توجد حركات حسابية بعد</Text>
          <TouchableOpacity style={styles.emptyAction} onPress={onAddMovement} activeOpacity={0.85}>
            <Plus size={16} color="#FFFFFF" />
            <Text style={styles.emptyActionText}>إضافة حوالة</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View>
      <SectionHeader title="حركة الحساب حسب العملة" />

      <View style={styles.currencyCardsWrap}>
        {rows.map((row) => {
          const isForMe = row.direction === 'for_me';
          const isOnMe = row.direction === 'on_me';
          const netColor = isForMe ? C.green : isOnMe ? C.red : C.muted;
          const chipBg = isForMe ? C.greenSoft : isOnMe ? C.redSoft : C.bgSoft;
          const statusLabel = isForMe ? 'لنا' : isOnMe ? 'علينا' : 'متساوي';

          return (
            <View key={row.currency} style={styles.currencyCard}>
              <View style={styles.currencyCardHeader}>
                <View style={styles.currencyBadge}>
                  <Text style={styles.currencyBadgeText}>{row.currency}</Text>
                </View>
                <View style={[styles.statusChip, { backgroundColor: chipBg }]}>
                  <View style={[styles.statusDot, { backgroundColor: netColor }]} />
                  <Text style={[styles.statusChipText, { color: netColor }]}>
                    {statusLabel}
                  </Text>
                </View>
              </View>

              <View style={styles.currencyBody}>
                <NetDonut forMe={row.totalForMe} onMe={row.totalOnMe} />

                <View style={styles.currencyBreakdownCol}>
                  <View style={styles.breakdownLine}>
                    <Text style={styles.breakdownLabel}>لنا</Text>
                    <Text style={[styles.breakdownValue, { color: C.green }]}>
                      {formatAmount(row.totalForMe)} {row.currency}
                    </Text>
                  </View>
                  <View style={styles.breakdownDividerH} />
                  <View style={styles.breakdownLine}>
                    <Text style={styles.breakdownLabel}>علينا</Text>
                    <Text style={[styles.breakdownValue, { color: C.red }]}>
                      {formatAmount(row.totalOnMe)} {row.currency}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function TopCustomers({
  customers,
  onCustomerPress,
  onViewAll,
  onAddCustomer,
}: {
  customers: TopCustomerRow[];
  onCustomerPress: (id: string) => void;
  onViewAll: () => void;
  onAddCustomer: () => void;
}) {
  if (customers.length === 0) {
    return (
      <View>
        <SectionHeader title="أعلى 3 أرصدة عملاء" />
        <View style={[styles.cardOutlined, styles.emptyCard]}>
          <Text style={styles.emptyText}>لا توجد بيانات عملاء بعد</Text>
          <TouchableOpacity style={styles.emptyAction} onPress={onAddCustomer} activeOpacity={0.85}>
            <UserPlus size={16} color="#FFFFFF" />
            <Text style={styles.emptyActionText}>إضافة عميل</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View>
      <SectionHeader
        title="أعلى 3 أرصدة عملاء"
        rightSlot={
          <TouchableOpacity activeOpacity={0.7} onPress={onViewAll}>
            <Text style={styles.linkText}>عرض الكل</Text>
          </TouchableOpacity>
        }
      />

      <View style={[styles.cardOutlined, { marginBottom: 16 }]}>
        {customers.map((c, idx) => {
          const color =
            c.direction === 'for_me' ? C.green : c.direction === 'on_me' ? C.red : C.muted;
          const sign = c.direction === 'for_me' ? '+ ' : c.direction === 'on_me' ? '− ' : '';

          const subtitle = joinMetaParts([
            c.count > 0 && `${toLatinDigits(c.count)} حركات`,
            c.lastActivity && `آخر حركة ${c.lastActivity}`,
          ]);

          return (
            <TouchableOpacity
              key={c.id}
              style={[
                styles.customerRow,
                idx !== customers.length - 1 && styles.ledgerRowDivider,
              ]}
              activeOpacity={0.7}
              onPress={() => onCustomerPress(c.id)}
            >
              <View style={styles.customerAvatar}>
                <Text style={styles.customerAvatarText}>{c.initials}</Text>
              </View>

              <View style={styles.customerTextWrap}>
                <Text style={styles.customerName} numberOfLines={1}>
                  {c.name}
                </Text>
                {subtitle ? <Text style={styles.customerSub}>{subtitle}</Text> : null}
              </View>

              <View style={styles.customerAmountWrap}>
                <Text style={[styles.customerAmount, { color }]}>
                  {c.currency
                    ? `${sign}${formatAmount(Math.abs(c.amount))} ${c.currency}`
                    : '—'}
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
  const insets = useSafeAreaInsets();
  const { currentUser } = useAuth();
  const { lastRefreshTime } = useDataRefresh();

  const [stats, setStats] = useState<StatisticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

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
      setLastUpdatedAt(new Date());
    } catch (err) {
      console.error('[StatisticsScreen] loadStats failed:', err);
      setError(err instanceof Error ? err.message : 'فشل تحميل الإحصاءات');
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
  const topCustomers = useMemo(
    () => buildTopCustomers(stats?.topCustomers || []),
    [stats],
  );
  const txCount = useMemo(() => buildTxCount(stats?.periodStats), [stats]);

  const goToNotifications = () => router.push('/(tabs)/notifications' as any);
  const goToCustomers = () => router.push('/(tabs)/customers' as any);
  const goToCustomer = (id: string) => router.push(`/customer-details?id=${id}` as any);
  const goToTransactions = () => router.push('/(tabs)/transactions' as any);
  const goToNewMovement = () => router.push('/new-movement' as any);
  const goToAddCustomer = () => router.push('/add-customer' as any);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <TopBar onBack={() => router.back()} />

      {loading ? (
        <View style={styles.centerArea}>
          <ActivityIndicator size="large" color={C.purple} />
          <Text style={styles.loadingText}>جاري تحميل الإحصائيات...</Text>
        </View>
      ) : error ? (
        <View style={styles.centerArea}>
          <AlertCircle size={36} color={C.red} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={loadStats} activeOpacity={0.8}>
            <Text style={styles.retryBtnText}>إعادة المحاولة</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          style={styles.screen}
          contentContainerStyle={[
            styles.contentContainer,
            { paddingBottom: insets.bottom + 28 },
          ]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          showsVerticalScrollIndicator={false}
        >
          <GreetingHeader
            userName={currentUser?.fullName || currentUser?.userName || ''}
            lastUpdatedAt={lastUpdatedAt}
            onRefresh={onRefresh}
          />

          <KPIGrid
            forMe={stats?.debtStats?.owedToUsByCurrency || []}
            onMe={stats?.debtStats?.weOweByCurrency || []}
            pendingMineCount={Number(stats?.actionableStats?.awaitingMyApprovalCount || 0)}
            pendingOthersCount={Number(stats?.actionableStats?.awaitingOthersApprovalCount || 0)}
            todayCount={txCount.today}
            yesterdayCount={txCount.yesterday}
            onForMePress={goToCustomers}
            onOnMePress={goToCustomers}
            onPendingPress={goToNotifications}
            onTodayPress={goToTransactions}
          />

          <CommissionsCard
            total={stats?.commissionStats?.totalCommission || 0}
            byCurrency={stats?.commissionStats?.commissionByCurrency || []}
          />

          <PerformanceCard
            approved={stats?.actionableStats?.approvedLast7Days || 0}
            rejected={stats?.actionableStats?.rejectedLast7Days || 0}
            approvalRate={stats?.actionableStats?.approvalRateLast7Days || 0}
            averageMinutes={stats?.actionableStats?.averageApprovalMinutesLast7Days ?? null}
          />

          <CurrencyLedger
            rows={ledgerRows}
            onAddMovement={goToCustomers}
          />

          <TopCustomers
            customers={topCustomers}
            onCustomerPress={goToCustomer}
            onViewAll={goToCustomers}
            onAddCustomer={goToAddCustomer}
          />
        </ScrollView>
      )}
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
    paddingBottom: 28,
  },
  centerArea: {
    flex: 1,
    backgroundColor: C.bg,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
    padding: 24,
  },
  loadingText: {
    fontSize: 14,
    color: C.muted,
    fontWeight: '600',
    writingDirection: 'rtl',
  },
  errorText: {
    fontSize: 14,
    color: C.red,
    fontWeight: '600',
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  retryBtn: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: C.purple,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    writingDirection: 'rtl',
  },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.bg,
  },
  iconBtnPlaceholder: {
    width: 38,
    height: 38,
  },
  topTitleWrap: {
    alignItems: 'center',
  },
  topTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: C.text,
    writingDirection: 'rtl',
  },
  topSubtitle: {
    fontSize: 12,
    color: C.muted,
    marginTop: 2,
    fontWeight: '500',
    writingDirection: 'rtl',
  },

  greetingWrap: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  greetingCard: {
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  greetingTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  greetingIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  greetingTextWrap: {
    flexShrink: 1,
    alignItems: 'center',
  },
  greetingHello: {
    fontSize: 17,
    fontWeight: '900',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  greetingDate: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.85)',
    marginTop: 2,
    fontWeight: '600',
    textAlign: 'center',
  },
  greetingFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.18)',
  },
  greetingFooterText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.85)',
    fontWeight: '600',
    textAlign: 'center',
  },
  greetingRefresh: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },

  sectionIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },

  commissionsCard: {
    padding: 16,
  },
  commissionsPrimary: {
    fontSize: 28,
    fontWeight: '900',
    color: C.green,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginBottom: 10,
  },
  commissionsCurrency: {
    fontSize: 14,
    fontWeight: '700',
    color: C.muted,
  },
  commissionsPrimaryEmpty: {
    fontSize: 14,
    color: C.muted,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: 14,
    writingDirection: 'rtl',
  },
  commissionsRest: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  commissionsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: C.greenSoft,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  commissionsChipAmount: {
    fontSize: 13,
    fontWeight: '800',
    color: C.green,
  },
  commissionsChipCode: {
    fontSize: 11,
    fontWeight: '700',
    color: C.muted,
  },

  perfCard: {
    padding: 0,
  },
  perfRow: {
    flexDirection: 'row',
    paddingVertical: 16,
  },
  perfStat: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  perfDivider: {
    width: 1,
    backgroundColor: C.border,
  },
  perfIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  perfValue: {
    fontSize: 22,
    fontWeight: '900',
  },
  perfLabel: {
    fontSize: 12,
    color: C.muted,
    fontWeight: '600',
    writingDirection: 'rtl',
  },
  perfBreakdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingVertical: 12,
    backgroundColor: C.bgSoft,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  perfBreakdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  perfBreakdownText: {
    fontSize: 13,
    fontWeight: '800',
    writingDirection: 'rtl',
  },
  perfBreakdownDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.faint,
  },

  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingTop: 8,
    gap: 10,
  },
  kpiCard: {
    width: '47.5%',
    flexGrow: 1,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    padding: 14,
    backgroundColor: C.bg,
    minHeight: 110,
  },
  kpiCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 10,
  },
  kpiCardLabel: {
    fontSize: 12,
    color: C.muted,
    fontWeight: '700',
    flexShrink: 1,
    textAlign: 'center',
  },
  kpiCardIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kpiCardPrimary: {
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 4,
  },
  kpiCardSecondary: {
    fontSize: 11,
    color: C.muted,
    fontWeight: '600',
    textAlign: 'center',
  },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 10,
  },
  sectionHeaderTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: C.text,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  linkText: {
    fontSize: 13,
    color: C.blueLink,
    fontWeight: '700',
    writingDirection: 'rtl',
  },
  emptyText: {
    fontSize: 13,
    color: C.muted,
    textAlign: 'center',
    fontWeight: '500',
    writingDirection: 'rtl',
  },
  emptyCard: {
    paddingVertical: 28,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 14,
  },
  emptyAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.purple,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
  },
  emptyActionText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    writingDirection: 'rtl',
  },

  cardOutlined: {
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: C.bg,
  },

  ledgerRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },

  currencyCardsWrap: {
    paddingHorizontal: 16,
    gap: 10,
  },
  currencyCard: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 16,
    padding: 14,
    backgroundColor: C.bg,
  },
  currencyCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  currencyBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: C.bgSoft,
    borderWidth: 1,
    borderColor: C.border,
  },
  currencyBadgeText: {
    fontSize: 13,
    fontWeight: '900',
    color: C.text,
    letterSpacing: 0.5,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusChipText: {
    fontSize: 12,
    fontWeight: '800',
    writingDirection: 'rtl',
  },
  currencyBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  donutCenter: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  donutNet: {
    fontSize: 14,
    fontWeight: '900',
    textAlign: 'center',
  },
  donutBalanced: {
    fontSize: 13,
    fontWeight: '800',
    color: C.muted,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  donutEmpty: {
    fontSize: 18,
    color: C.faint,
    fontWeight: '700',
  },
  currencyBreakdownCol: {
    flex: 1,
    gap: 8,
  },
  breakdownLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  breakdownLabel: {
    fontSize: 12,
    color: C.muted,
    fontWeight: '700',
    writingDirection: 'rtl',
  },
  breakdownValue: {
    fontSize: 14,
    fontWeight: '900',
  },
  breakdownDividerH: {
    height: 1,
    backgroundColor: C.border,
  },

  customerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 12,
  },
  customerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.avatarBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customerAvatarText: {
    fontSize: 12,
    fontWeight: '800',
    color: C.avatarText,
  },
  customerTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  customerName: {
    fontSize: 14,
    fontWeight: '800',
    color: C.text,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  customerSub: {
    fontSize: 11,
    color: C.muted,
    marginTop: 3,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  customerAmountWrap: {
    alignItems: 'flex-start',
  },
  customerAmount: {
    fontSize: 14,
    fontWeight: '900',
  },
});
