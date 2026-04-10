import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Platform,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { useRouter } from 'expo-router';
import { useDataRefresh } from '@/contexts/DataRefreshContext';
import {
  Users,
  Receipt,
  ArrowRight,
  TrendingUp,
  AlertCircle,
  Calendar,
  TrendingDown,
  Trophy,
  Percent,
  Activity,
  Wallet,
  Clock,
} from 'lucide-react-native';
import { CURRENCIES } from '@/types/database';
import { StatisticsService, StatisticsData, PeriodStats } from '@/services/statisticsService';
import { useAuth } from '@/contexts/AuthContext';
import { CustomerStatusBadge } from '@/components/customer/CustomerStatusBadge';

type PresetPeriod = 'today' | 'yesterday' | 'week' | 'month';
type PeriodFilter = PresetPeriod | 'custom';
type PickerTarget = 'start' | 'end' | null;

export default function StatisticsScreen() {
  const router = useRouter();
  const { lastRefreshTime } = useDataRefresh();
  const { currentUser } = useAuth();
  const [stats, setStats] = useState<StatisticsData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodFilter>('today');
  const [showCustomRangeModal, setShowCustomRangeModal] = useState(false);
  const [customStartDate, setCustomStartDate] = useState<Date | null>(null);
  const [customEndDate, setCustomEndDate] = useState<Date | null>(null);
  const [customPeriodStats, setCustomPeriodStats] = useState<PeriodStats | null>(null);
  const [customStatsLoading, setCustomStatsLoading] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<PickerTarget>(null);

  useEffect(() => {
    if (currentUser?.userId) {
      loadStats();
    } else {
      setStats(null);
      setLoading(false);
    }
  }, [currentUser?.userId]);

  useEffect(() => {
    if (!loading && currentUser?.userId) {
      console.log('[Statistics] Auto-refreshing due to data change');
      loadStats();
    }
  }, [lastRefreshTime, currentUser?.userId]);

  const loadStats = async () => {
    try {
      if (!currentUser?.userId) {
        setStats(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      const data = await StatisticsService.fetchAllStatistics(currentUser.userId);
      setStats(data);
    } catch (error) {
      console.error('Error loading stats:', error);
      setError(error instanceof Error ? error.message : 'حدث خطأ أثناء تحميل الإحصاءات');
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadStats();

    if (selectedPeriod === 'custom' && customStartDate && customEndDate && currentUser?.userId) {
      await loadCustomRangeStats(customStartDate, customEndDate, false);
    }

    setRefreshing(false);
  };

  const formatAmount = (amount: number) =>
    amount.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const formatRangeDate = (date: Date | null) => {
    if (!date) {
      return 'غير محدد';
    }

    return format(date, 'dd MMM yyyy', { locale: ar });
  };

  const getCurrencyInfo = (code: string) => {
    const currency = CURRENCIES.find((c) => c.code === code);
    return currency || { code, name: code, symbol: code };
  };

  const getPeriodLabel = (period: PeriodFilter) => {
    switch (period) {
      case 'today':
        return 'اليوم';
      case 'yesterday':
        return 'أمس';
      case 'week':
        return 'آخر 7 أيام';
      case 'month':
        return 'آخر 30 يومًا';
      case 'custom':
        if (customStartDate && customEndDate) {
          return `${formatRangeDate(customStartDate)} - ${formatRangeDate(customEndDate)}`;
        }

        return 'فترة مخصصة';
    }
  };

  const getPeriodColor = (period: PeriodFilter) => {
    switch (period) {
      case 'today':
        return '#4F46E5';
      case 'yesterday':
        return '#8B5CF6';
      case 'week':
        return '#10B981';
      case 'month':
        return '#F59E0B';
      case 'custom':
        return '#2563EB';
    }
  };

  const openCustomRangeModal = () => {
    const today = new Date();
    setCustomStartDate((current) => current || today);
    setCustomEndDate((current) => current || today);
    setShowCustomRangeModal(true);
  };

  const loadCustomRangeStats = async (
    startDate: Date,
    endDate: Date,
    closeModal: boolean = true,
  ) => {
    if (!currentUser?.userId) {
      return;
    }

    try {
      setCustomStatsLoading(true);
      setError(null);
      const data = await StatisticsService.fetchCustomDateRangeStats(
        currentUser.userId,
        startDate,
        endDate,
      );

      setCustomStartDate(startDate);
      setCustomEndDate(endDate);
      setCustomPeriodStats(data);
      setSelectedPeriod('custom');

      if (closeModal) {
        setShowCustomRangeModal(false);
      }
    } catch (rangeError) {
      console.error('Error loading custom stats:', rangeError);
      setError(rangeError instanceof Error ? rangeError.message : 'تعذر تحميل الفترة المحددة');
    } finally {
      setCustomStatsLoading(false);
      setPickerTarget(null);
    }
  };

  const handleDateChange = (event: DateTimePickerEvent, date?: Date) => {
    const activeTarget = pickerTarget;

    if (Platform.OS !== 'ios') {
      setPickerTarget(null);
    }

    if (!activeTarget || event.type === 'dismissed' || !date) {
      return;
    }

    if (activeTarget === 'start') {
      setCustomStartDate(date);
      if (customEndDate && date > customEndDate) {
        setCustomEndDate(date);
      }
      return;
    }

    setCustomEndDate(date);
  };

  const renderCurrencyBreakdown = (items: { currency: string; amount: number }[]) => {
    if (items.length === 0) {
      return <Text style={styles.periodStatHint}>لا توجد مبالغ</Text>;
    }

    return (
      <View style={styles.periodAmountsList}>
        {items.map((item) => {
          const currencyInfo = getCurrencyInfo(item.currency);
          return (
            <View key={`${item.currency}-${item.amount}`} style={styles.periodAmountChip}>
              <Text style={styles.periodAmountChipText}>
                {formatAmount(item.amount)} {currencyInfo.symbol}
              </Text>
            </View>
          );
        })}
      </View>
    );
  };

  const formatApprovalTime = (minutes: number | null) => {
    if (minutes == null) {
      return 'لا توجد موافقات كافية';
    }

    if (minutes < 60) {
      return `${formatAmount(minutes)} دقيقة`;
    }

    const hours = minutes / 60;
    if (hours < 24) {
      return `${formatAmount(hours)} ساعة`;
    }

    return `${formatAmount(hours / 24)} يوم`;
  };

  const summarizeCurrencyList = (
    items: { currency: string; amount: number }[],
    emptyText: string = 'لا توجد مبالغ',
  ) => {
    if (items.length === 0) {
      return emptyText;
    }

    const primary = items[0];
    const currencyInfo = getCurrencyInfo(primary.currency);
    const restCount = items.length - 1;

    return `${formatAmount(primary.amount)} ${currencyInfo.symbol}${restCount > 0 ? ` +${restCount}` : ''}`;
  };

  const renderBalanceBreakdown = (
    items: { currency: string; amount: number }[],
    maxItems: number = 2,
  ) => {
    if (items.length === 0) {
      return <Text style={styles.periodStatHint}>الحساب متساوي</Text>;
    }

    return (
      <View style={styles.periodAmountsList}>
        {items.slice(0, maxItems).map((item) => {
          const currencyInfo = getCurrencyInfo(item.currency);
          const isPositive = item.amount > 0;

          return (
            <View
              key={`${item.currency}-${item.amount}`}
              style={[
                styles.customerBalanceChip,
                isPositive ? styles.customerBalanceChipPositive : styles.customerBalanceChipNegative,
              ]}
            >
              <Text
                style={[
                  styles.customerBalanceChipText,
                  isPositive
                    ? styles.customerBalanceChipTextPositive
                    : styles.customerBalanceChipTextNegative,
                ]}
              >
                {isPositive ? 'له' : 'عليه'} {formatAmount(Math.abs(item.amount))}{' '}
                {currencyInfo.symbol}
              </Text>
            </View>
          );
        })}

        {items.length > maxItems && (
          <View style={styles.customerBalanceChipMore}>
            <Text style={styles.customerBalanceChipMoreText}>+{items.length - maxItems}</Text>
          </View>
        )}
      </View>
    );
  };

  const summaryCards = stats
    ? [
        {
          key: 'customers',
          title: 'العملاء',
          value: stats.totalCustomers,
          icon: Users,
          color: '#4F46E5',
        },
        {
          key: 'transactions',
          title: 'الحوالات',
          value: stats.totalTransactions,
          icon: Receipt,
          color: '#0EA5E9',
        },
        {
          key: 'movements',
          title: 'الحركات',
          value: stats.totalMovements,
          icon: Activity,
          color: '#10B981',
        },
        {
          key: 'currencies',
          title: 'العملات',
          value: stats.currencyBalances.length,
          icon: Wallet,
          color: '#F59E0B',
        },
      ]
    : [];

  const actionableCards = stats
    ? [
        {
          key: 'awaitingMine',
          title: 'بانتظار موافقتي',
          value: stats.actionableStats.awaitingMyApprovalCount,
          subtitle: summarizeCurrencyList(
            stats.actionableStats.awaitingMyApprovalByCurrency,
            'لا يوجد شيء بانتظارك',
          ),
          icon: Clock,
          color: '#D97706',
        },
        {
          key: 'awaitingOthers',
          title: 'بانتظار رد الطرف الآخر',
          value: stats.actionableStats.awaitingOthersApprovalCount,
          subtitle: summarizeCurrencyList(
            stats.actionableStats.awaitingOthersApprovalByCurrency,
            'لا توجد طلبات معلّقة',
          ),
          icon: Activity,
          color: '#2563EB',
        },
        {
          key: 'stalePending',
          title: 'متأخر أكثر من 24 ساعة',
          value: stats.actionableStats.stalePendingCount,
          subtitle: summarizeCurrencyList(
            stats.actionableStats.stalePendingByCurrency,
            'لا يوجد تأخير',
          ),
          icon: AlertCircle,
          color: '#DC2626',
        },
        {
          key: 'approvalRate',
          title: 'نسبة القبول آخر 7 أيام',
          value: `${stats.actionableStats.approvalRateLast7Days}%`,
          subtitle: `${stats.actionableStats.approvedLast7Days} قبول / ${stats.actionableStats.rejectedLast7Days} رفض`,
          icon: TrendingUp,
          color: '#059669',
        },
      ]
    : [];

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
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4F46E5" />
          <Text style={styles.loadingText}>جاري تحميل الإحصائيات...</Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <ArrowRight size={24} color="#111827" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>الإحصائيات</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.errorContainer}>
          <AlertCircle size={64} color="#EF4444" />
          <Text style={styles.errorTitle}>خطأ في تحميل الإحصاءات</Text>
          <Text style={styles.errorMessage}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={loadStats}>
            <Text style={styles.retryButtonText}>إعادة المحاولة</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const currentPeriodStats = stats
    ? selectedPeriod === 'custom'
      ? customPeriodStats
      : stats.periodStats[selectedPeriod as PresetPeriod]
    : null;

  if (!stats || !currentPeriodStats) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <ArrowRight size={24} color="#111827" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>الإحصائيات</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.emptyStateContainer}>
          <AlertCircle size={64} color="#9CA3AF" />
          <Text style={styles.emptyStateTitle}>لا توجد بيانات</Text>
          <Text style={styles.emptyStateMessage}>
            لم يتم العثور على أي إحصاءات. يرجى المحاولة مرة أخرى.
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={loadStats}>
            <Text style={styles.retryButtonText}>تحديث</Text>
          </TouchableOpacity>
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
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.summarySection}>
          <View style={styles.sectionHeader}>
            <Users size={24} color="#4F46E5" />
            <Text style={styles.sectionTitle}>ملخص سريع</Text>
          </View>

          <View style={styles.summaryGrid}>
            {summaryCards.map((card) => (
              <View key={card.key} style={styles.summaryCard}>
                <View style={[styles.summaryIcon, { backgroundColor: `${card.color}15` }]}>
                  <card.icon size={20} color={card.color} />
                </View>
                <Text style={styles.summaryValue}>{card.value}</Text>
                <Text style={styles.summaryTitle}>{card.title}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.actionableSection}>
          <View style={styles.sectionHeader}>
            <Clock size={24} color="#D97706" />
            <Text style={styles.sectionTitle}>ما يحتاج متابعة الآن</Text>
          </View>

          <View style={styles.summaryGrid}>
            {actionableCards.map((card) => (
              <View key={card.key} style={styles.actionableCard}>
                <View style={[styles.summaryIcon, { backgroundColor: `${card.color}15` }]}>
                  <card.icon size={20} color={card.color} />
                </View>
                <Text style={styles.actionableValue}>{card.value}</Text>
                <Text style={styles.summaryTitle}>{card.title}</Text>
                <Text style={styles.actionableSubtitle}>{card.subtitle}</Text>
              </View>
            ))}
          </View>

          <View style={styles.actionableBreakdownCard}>
            <Text style={styles.actionableBreakdownTitle}>تفصيل المبالغ المعلّقة</Text>

            <View style={styles.actionableBreakdownBlock}>
              <Text style={styles.actionableBreakdownLabel}>بانتظار موافقتك</Text>
              {renderCurrencyBreakdown(stats.actionableStats.awaitingMyApprovalByCurrency)}
            </View>

            <View style={styles.actionableBreakdownDivider} />

            <View style={styles.actionableBreakdownBlock}>
              <Text style={styles.actionableBreakdownLabel}>بانتظار رد الطرف الآخر</Text>
              {renderCurrencyBreakdown(stats.actionableStats.awaitingOthersApprovalByCurrency)}
            </View>

            <View style={styles.actionableBreakdownDivider} />

            <View style={styles.actionableBreakdownBlock}>
              <Text style={styles.actionableBreakdownLabel}>متأخر أكثر من 24 ساعة</Text>
              {renderCurrencyBreakdown(stats.actionableStats.stalePendingByCurrency)}
            </View>
          </View>

          <View style={styles.actionablePerformanceCard}>
            <View style={styles.sectionHeader}>
              <Activity size={22} color="#059669" />
              <Text style={styles.actionablePerformanceTitle}>أداء الموافقات</Text>
            </View>

            <View style={styles.actionablePerformanceGrid}>
              <View style={styles.actionablePerformanceItem}>
                <Text style={styles.actionablePerformanceLabel}>تم قبوله</Text>
                <Text style={[styles.actionablePerformanceValue, { color: '#059669' }]}>
                  {stats.actionableStats.approvedLast7Days}
                </Text>
              </View>

              <View style={styles.topCustomerStatDivider} />

              <View style={styles.actionablePerformanceItem}>
                <Text style={styles.actionablePerformanceLabel}>تم رفضه</Text>
                <Text style={[styles.actionablePerformanceValue, { color: '#DC2626' }]}>
                  {stats.actionableStats.rejectedLast7Days}
                </Text>
              </View>

              <View style={styles.topCustomerStatDivider} />

              <View style={styles.actionablePerformanceItem}>
                <Text style={styles.actionablePerformanceLabel}>متوسط زمن الموافقة</Text>
                <Text style={[styles.actionablePerformanceValue, { color: '#111827', fontSize: 17 }]}>
                  {formatApprovalTime(stats.actionableStats.averageApprovalMinutesLast7Days)}
                </Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.balancesSection}>
          <View style={styles.sectionHeader}>
            <Wallet size={24} color="#4F46E5" />
            <Text style={styles.sectionTitle}>التدفق النقدي حسب العملة</Text>
          </View>

          {stats.cashFlowByCurrency.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>لا توجد حركات بعد</Text>
            </View>
          ) : (
            stats.cashFlowByCurrency.map((flow, index) => {
              const currencyInfo = getCurrencyInfo(flow.currency);
              const netIsOnCustomer = flow.netFlow > 0;
              const netIsForCustomer = flow.netFlow < 0;

              return (
                <View key={index} style={styles.balanceCard}>
                  <View style={styles.balanceCardHeader}>
                    <View style={styles.currencyInfo}>
                      <Text style={styles.currencySymbol}>{currencyInfo.symbol}</Text>
                      <Text style={styles.currencyName}>{currencyInfo.name}</Text>
                    </View>
                  </View>

                  <View style={styles.balanceDetails}>
                    <View style={styles.balanceRow}>
                      <View style={styles.balanceItem}>
                        <View style={styles.balanceItemHeader}>
                          <TrendingDown size={18} color="#EF4444" />
                          <Text style={styles.balanceItemLabel}>عليه</Text>
                        </View>
                        <Text style={[styles.balanceItemValue, { color: '#EF4444' }]}>
                          {formatAmount(flow.totalReceived)}
                        </Text>
                      </View>

                      <View style={styles.balanceDivider} />

                      <View style={styles.balanceItem}>
                        <View style={styles.balanceItemHeader}>
                          <TrendingUp size={18} color="#10B981" />
                          <Text style={styles.balanceItemLabel}>له</Text>
                        </View>
                        <Text style={[styles.balanceItemValue, { color: '#10B981' }]}>
                          {formatAmount(flow.totalPaid)}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.balanceSeparator} />

                    <View style={styles.netBalanceContainer}>
                      <Text style={styles.netBalanceLabel}>الصافي</Text>
                      <View style={styles.netBalanceValueContainer}>
                        <Text
                          style={[
                            styles.netBalanceValue,
                            {
                              color: netIsOnCustomer
                                ? '#EF4444'
                                : netIsForCustomer
                                  ? '#10B981'
                                  : '#6B7280',
                            },
                          ]}
                        >
                          {formatAmount(Math.abs(flow.netFlow))} {currencyInfo.symbol}
                        </Text>
                      </View>
                      <Text style={styles.netBalanceDescription}>
                        {netIsOnCustomer
                          ? 'الصافي عليه'
                          : netIsForCustomer
                            ? 'الصافي له'
                            : 'متوازن'}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </View>

        {(stats.debtStats.owedToUsByCurrency.length > 0 ||
          stats.debtStats.weOweByCurrency.length > 0) && (
          <View style={styles.debtSection}>
            <View style={styles.sectionHeader}>
              <AlertCircle size={24} color="#EF4444" />
              <Text style={styles.sectionTitle}>ملخص الديون</Text>
            </View>

            {stats.debtStats.owedToUsByCurrency.length > 0 && (
              <View style={styles.debtCard}>
                <Text style={styles.debtCardTitle}>لنا</Text>
                {stats.debtStats.owedToUsByCurrency.map((item, index) => {
                  const currencyInfo = getCurrencyInfo(item.currency);
                  return (
                    <View key={index} style={styles.debtRow}>
                      <Text style={styles.debtCurrency}>{currencyInfo.name}</Text>
                      <Text style={[styles.debtAmount, { color: '#10B981' }]}>
                        {formatAmount(item.amount)} {currencyInfo.symbol}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}

            {stats.debtStats.weOweByCurrency.length > 0 && (
              <View style={styles.debtCard}>
                <Text style={styles.debtCardTitle}>علينا</Text>
                {stats.debtStats.weOweByCurrency.map((item, index) => {
                  const currencyInfo = getCurrencyInfo(item.currency);
                  return (
                    <View key={index} style={styles.debtRow}>
                      <Text style={styles.debtCurrency}>{currencyInfo.name}</Text>
                      <Text style={[styles.debtAmount, { color: '#EF4444' }]}>
                        {formatAmount(item.amount)} {currencyInfo.symbol}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {stats.topCustomers.length > 0 && (
          <View style={styles.topCustomersSection}>
            <View style={styles.sectionHeader}>
              <Trophy size={24} color="#F59E0B" />
              <Text style={styles.sectionTitle}>أكثر العملاء نشاطاً</Text>
            </View>

            {stats.topCustomers.map((customer, index) => (
              <View key={customer.id} style={styles.topCustomerCard}>
                <View style={styles.topCustomerRank}>
                  <Text style={styles.topCustomerRankText}>{index + 1}</Text>
                </View>

                <View style={styles.topCustomerInfo}>
                  <View style={styles.topCustomerHeader}>
                    <CustomerStatusBadge linkedUserId={customer.linked_user_id} />
                    <Text style={styles.topCustomerName}>{customer.name}</Text>
                  </View>
                  <Text style={styles.topCustomerPhone}>{customer.phone}</Text>
                  <View style={styles.topCustomerBalances}>
                    {renderBalanceBreakdown(customer.balanceByCurrency)}
                  </View>
                </View>

                <View style={styles.topCustomerStats}>
                  <View style={styles.topCustomerStatItem}>
                    <Text style={styles.topCustomerStatLabel}>الحركات</Text>
                    <Text style={styles.topCustomerStatValue}>{customer.totalMovements}</Text>
                  </View>
                  <View style={styles.topCustomerStatDivider} />
                  <View style={styles.topCustomerStatItem}>
                    <Text style={styles.topCustomerStatLabel}>الحجم</Text>
                    <Text style={styles.topCustomerStatValue}>
                      {formatAmount(customer.totalVolume)}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.periodSection}>
          <View style={styles.sectionHeader}>
            <Activity size={24} color="#4F46E5" />
            <Text style={styles.sectionTitle}>إحصائيات الفترات</Text>
          </View>

          <View style={styles.periodFilterContainer}>
            {(['today', 'yesterday', 'week', 'month'] as PresetPeriod[]).map((period) => (
              <TouchableOpacity
                key={period}
                style={[
                  styles.periodFilterButton,
                  selectedPeriod === period && {
                    backgroundColor: getPeriodColor(period),
                  },
                ]}
                onPress={() => setSelectedPeriod(period)}
              >
                <Text
                  style={[
                    styles.periodFilterText,
                    selectedPeriod === period && styles.periodFilterTextActive,
                  ]}
                >
                  {getPeriodLabel(period)}
                </Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={[
                styles.periodFilterButton,
                styles.customPeriodButton,
                selectedPeriod === 'custom' && {
                  backgroundColor: getPeriodColor('custom'),
                  borderColor: getPeriodColor('custom'),
                },
              ]}
              onPress={openCustomRangeModal}
            >
              <Calendar
                size={16}
                color={selectedPeriod === 'custom' ? '#FFFFFF' : getPeriodColor('custom')}
              />
              <Text
                style={[
                  styles.periodFilterText,
                  selectedPeriod === 'custom' && styles.periodFilterTextActive,
                ]}
              >
                {selectedPeriod === 'custom' ? 'الفترة المحددة' : 'تخصيص'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.periodCard}>
            <View style={styles.periodHeader}>
              <Text style={styles.periodTitle}>{getPeriodLabel(selectedPeriod)}</Text>
              <View
                style={[
                  styles.periodBadge,
                  { backgroundColor: `${getPeriodColor(selectedPeriod)}15` },
                ]}
              >
                <Calendar size={16} color={getPeriodColor(selectedPeriod)} />
              </View>
            </View>

            <View style={styles.periodStatsGrid}>
              <View style={styles.periodStatBox}>
                <Text style={styles.periodStatLabel}>الحوالات</Text>
                <Text
                  style={[styles.periodStatValue, { color: getPeriodColor(selectedPeriod) }]}
                >
                  {currentPeriodStats.transactions}
                </Text>
                {renderCurrencyBreakdown(currentPeriodStats.transactionAmountsByCurrency)}
              </View>

              <View style={styles.periodDivider} />

              <View style={styles.periodStatBox}>
                <Text style={styles.periodStatLabel}>الحركات</Text>
                <Text
                  style={[styles.periodStatValue, { color: getPeriodColor(selectedPeriod) }]}
                >
                  {currentPeriodStats.movements}
                </Text>
                {renderCurrencyBreakdown(currentPeriodStats.movementAmountsByCurrency)}
              </View>

              <View style={styles.periodDivider} />

              <View style={styles.periodStatBox}>
                <Text style={styles.periodStatLabel}>العمولات</Text>
                <Text
                  style={[styles.periodStatValue, { color: getPeriodColor(selectedPeriod) }]}
                >
                  {currentPeriodStats.commissionMovements > 0
                    ? currentPeriodStats.commissionMovements
                    : '-'}
                </Text>
                {renderCurrencyBreakdown(currentPeriodStats.commissionAmountsByCurrency)}
              </View>
            </View>
          </View>
        </View>

        {stats.commissionStats.commissionByCurrency.length > 0 && (
          <View style={styles.commissionSection}>
            <View style={styles.sectionHeader}>
              <Percent size={24} color="#06B6D4" />
              <Text style={styles.sectionTitle}>العمولات حسب العملة</Text>
            </View>

            <View style={styles.commissionGrid}>
              {stats.commissionStats.commissionByCurrency.map((item, index) => {
                const currencyInfo = getCurrencyInfo(item.currency);
                return (
                  <View key={index} style={styles.commissionCard}>
                    <Text style={styles.commissionCurrency}>{currencyInfo.symbol}</Text>
                    <Text style={styles.commissionAmount}>{formatAmount(item.total)}</Text>
                    <Text style={styles.commissionLabel}>{currencyInfo.name}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      <Modal
        visible={showCustomRangeModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCustomRangeModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>فترة مخصصة</Text>
            <Text style={styles.modalDescription}>
              اختر تاريخ البداية والنهاية لعرض إحصائيات هذه الفترة فقط.
            </Text>

            <TouchableOpacity style={styles.dateField} onPress={() => setPickerTarget('start')}>
              <Calendar size={18} color="#2563EB" />
              <View>
                <Text style={styles.dateFieldLabel}>من</Text>
                <Text style={styles.dateFieldValue}>{formatRangeDate(customStartDate)}</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={styles.dateField} onPress={() => setPickerTarget('end')}>
              <Calendar size={18} color="#2563EB" />
              <View>
                <Text style={styles.dateFieldLabel}>إلى</Text>
                <Text style={styles.dateFieldValue}>{formatRangeDate(customEndDate)}</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.retryButton,
                (!customStartDate || !customEndDate || customStatsLoading) &&
                  styles.disabledButton,
              ]}
              disabled={!customStartDate || !customEndDate || customStatsLoading}
              onPress={() => {
                if (customStartDate && customEndDate) {
                  loadCustomRangeStats(customStartDate, customEndDate);
                }
              }}
            >
              <Text style={styles.retryButtonText}>
                {customStatsLoading ? 'جاري التحميل...' : 'تطبيق الفترة'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalCancelButton}
              onPress={() => setShowCustomRangeModal(false)}
            >
              <Text style={styles.modalCancelText}>إغلاق</Text>
            </TouchableOpacity>

            {pickerTarget && (
              <DateTimePicker
                value={
                  pickerTarget === 'start'
                    ? customStartDate || new Date()
                    : customEndDate || customStartDate || new Date()
                }
                mode="date"
                display="default"
                maximumDate={new Date()}
                minimumDate={pickerTarget === 'end' && customStartDate ? customStartDate : undefined}
                onChange={handleDateChange}
              />
            )}
          </View>
        </View>
      </Modal>
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
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
  },
  content: {
    flex: 1,
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
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    gap: 16,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
    textAlign: 'center',
  },
  errorMessage: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  retryButton: {
    backgroundColor: '#4F46E5',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 8,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    gap: 16,
  },
  emptyStateTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
    textAlign: 'center',
  },
  emptyStateMessage: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  summarySection: {
    padding: 16,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  summaryCard: {
    width: '47%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  summaryIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  summaryValue: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'right',
  },
  summaryTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#475569',
    textAlign: 'right',
    marginTop: 4,
  },
  periodSection: {
    padding: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
    textAlign: 'right',
  },
  periodFilterContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  periodFilterButton: {
    flex: 1,
    minWidth: 88,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
  },
  customPeriodButton: {
    flexDirection: 'row',
    gap: 6,
  },
  periodFilterText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  periodFilterTextActive: {
    color: '#FFFFFF',
  },
  periodCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  periodHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  periodTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#111827',
  },
  periodBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  periodStatsGrid: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  periodStatBox: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
  },
  periodStatLabel: {
    fontSize: 13,
    color: '#6B7280',
  },
  periodStatValue: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  periodAmountsList: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
  },
  periodAmountChip: {
    backgroundColor: '#F3F4F6',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  periodAmountChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  periodStatHint: {
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'center',
  },
  periodDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: '#E5E7EB',
  },
  commissionSection: {
    padding: 16,
  },
  commissionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  commissionCard: {
    flex: 1,
    minWidth: '30%',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  commissionCurrency: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#06B6D4',
    marginBottom: 8,
  },
  commissionAmount: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 4,
  },
  commissionLabel: {
    fontSize: 12,
    color: '#6B7280',
  },
  topCustomersSection: {
    padding: 16,
  },
  topCustomerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  topCustomerRank: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F59E0B',
    justifyContent: 'center',
    alignItems: 'center',
  },
  topCustomerRankText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  topCustomerInfo: {
    flex: 1,
  },
  topCustomerHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    marginBottom: 4,
    flexWrap: 'wrap',
  },
  topCustomerName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'right',
  },
  topCustomerPhone: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'right',
  },
  topCustomerBalances: {
    marginTop: 10,
  },
  topCustomerStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  topCustomerStatItem: {
    alignItems: 'center',
  },
  topCustomerStatLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 4,
  },
  topCustomerStatValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#111827',
  },
  topCustomerStatDivider: {
    width: 1,
    height: 40,
    backgroundColor: '#E5E7EB',
  },
  customerBalanceChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  customerBalanceChipPositive: {
    backgroundColor: '#ECFDF5',
  },
  customerBalanceChipNegative: {
    backgroundColor: '#FEF2F2',
  },
  customerBalanceChipText: {
    fontSize: 11,
    fontWeight: '700',
  },
  customerBalanceChipTextPositive: {
    color: '#047857',
  },
  customerBalanceChipTextNegative: {
    color: '#B91C1C',
  },
  customerBalanceChipMore: {
    backgroundColor: '#E2E8F0',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  customerBalanceChipMoreText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  actionableSection: {
    padding: 16,
    paddingTop: 0,
  },
  actionableCard: {
    width: '47%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  actionableValue: {
    fontSize: 24,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'right',
  },
  actionableSubtitle: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'right',
    marginTop: 8,
    lineHeight: 18,
  },
  actionableBreakdownCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    marginTop: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  actionableBreakdownTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'right',
    marginBottom: 16,
  },
  actionableBreakdownBlock: {
    alignItems: 'flex-end',
    gap: 10,
  },
  actionableBreakdownLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#475569',
  },
  actionableBreakdownDivider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 14,
  },
  actionablePerformanceCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    marginTop: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  actionablePerformanceTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
  },
  actionablePerformanceGrid: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  actionablePerformanceItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  actionablePerformanceLabel: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
  },
  actionablePerformanceValue: {
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  balancesSection: {
    padding: 16,
  },
  emptyState: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyStateText: {
    fontSize: 16,
    color: '#9CA3AF',
    textAlign: 'center',
  },
  balanceCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  balanceCardHeader: {
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  currencyInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  currencySymbol: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#4F46E5',
  },
  currencyName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
  },
  balanceDetails: {
    gap: 16,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  balanceItem: {
    flex: 1,
    alignItems: 'center',
  },
  balanceItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  balanceItemLabel: {
    fontSize: 14,
    color: '#6B7280',
  },
  balanceItemValue: {
    fontSize: 22,
    fontWeight: 'bold',
  },
  balanceDivider: {
    width: 1,
    height: 60,
    backgroundColor: '#E5E7EB',
  },
  balanceSeparator: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 8,
  },
  netBalanceContainer: {
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 16,
  },
  netBalanceLabel: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 8,
  },
  netBalanceValueContainer: {
    marginBottom: 4,
  },
  netBalanceValue: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  netBalanceDescription: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
  },
  debtSection: {
    padding: 16,
  },
  debtCard: {
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
  debtCardTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 12,
    textAlign: 'right',
  },
  debtRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  debtCurrency: {
    fontSize: 14,
    color: '#6B7280',
  },
  debtAmount: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 8,
  },
  modalDescription: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 16,
  },
  dateField: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 12,
  },
  dateFieldLabel: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'right',
    marginBottom: 4,
  },
  dateFieldValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'right',
  },
  disabledButton: {
    opacity: 0.5,
  },
  modalCancelButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalCancelText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2563EB',
  },
});
