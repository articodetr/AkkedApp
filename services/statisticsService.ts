import { supabase } from '@/lib/supabase';
import { TotalBalanceByCurrency } from '@/types/database';

export interface PeriodStats {
  transactions: number;
  movements: number;
  commissionMovements: number;
  transactionAmount: number;
  movementAmount: number;
  commissionAmount: number;
  transactionAmountsByCurrency: { currency: string; amount: number }[];
  movementAmountsByCurrency: { currency: string; amount: number }[];
  commissionAmountsByCurrency: { currency: string; amount: number }[];
}

export interface TopCustomer {
  id: string;
  name: string;
  phone: string;
  linked_user_id?: string | null;
  totalMovements: number;
  totalVolume: number;
  balanceByCurrency: { currency: string; amount: number }[];
  lastActivity: string;
}

export interface CommissionStats {
  totalCommission: number;
  commissionByCurrency: { currency: string; total: number }[];
}

export interface CashFlowByCurrency {
  currency: string;
  totalReceived: number;
  totalPaid: number;
  netFlow: number;
  linkedReceived: number;
  linkedPaid: number;
  directReceived: number;
  directPaid: number;
  pendingAmount: number;
  pendingCount: number;
  internalTransferAmount: number;
  internalTransferCount: number;
  approvedCount: number;
}

export interface DebtStats {
  totalOwedToUs: number;
  totalWeOwe: number;
  owedToUsByCurrency: { currency: string; amount: number }[];
  weOweByCurrency: { currency: string; amount: number }[];
}

export interface ActionableStats {
  awaitingMyApprovalCount: number;
  awaitingMyApprovalByCurrency: { currency: string; amount: number }[];
  awaitingOthersApprovalCount: number;
  awaitingOthersApprovalByCurrency: { currency: string; amount: number }[];
  stalePendingCount: number;
  stalePendingByCurrency: { currency: string; amount: number }[];
  approvedLast7Days: number;
  rejectedLast7Days: number;
  approvalRateLast7Days: number;
  rejectionRateLast7Days: number;
  averageApprovalMinutesLast7Days: number | null;
}

export interface StatisticsDebugData {
  inputUserId?: string;
  selectedUser?: {
    id?: string;
    user_name?: string;
    role?: string;
    is_active?: boolean;
  } | null;
  allUsers: number;
  allCustomers: number;
  scopedCustomers: number;
  allMovements: number;
  scopedMovements: number;
  allNotificationsForUser: number;
  functionSignatures: string[];
  movementStatusCounts: Array<{
    status: string;
    is_voided: boolean;
    is_commission: boolean;
    count: number;
    amount: number;
  }>;
  currencyCounts: Array<{
    currency: string;
    count: number;
    amount: number;
  }>;
  latestScopedMovements: Array<Record<string, unknown>>;
}

export interface StatisticsData {
  totalCustomers: number;
  totalTransactions: number;
  totalMovements: number;
  totalAmount: number;
  totalDebts: number;
  totalWeOwe: number;
  periodStats: {
    today: PeriodStats;
    yesterday: PeriodStats;
    week: PeriodStats;
    month: PeriodStats;
  };
  currencyBalances: TotalBalanceByCurrency[];
  cashFlowByCurrency: CashFlowByCurrency[];
  topCustomers: TopCustomer[];
  commissionStats: CommissionStats;
  debtStats: DebtStats;
  actionableStats: ActionableStats;
  debug?: StatisticsDebugData | null;
}

const EMPTY_PERIOD_STATS: PeriodStats = {
  transactions: 0,
  movements: 0,
  commissionMovements: 0,
  transactionAmount: 0,
  movementAmount: 0,
  commissionAmount: 0,
  transactionAmountsByCurrency: [],
  movementAmountsByCurrency: [],
  commissionAmountsByCurrency: [],
};

const EMPTY_DEBT_STATS: DebtStats = {
  totalOwedToUs: 0,
  totalWeOwe: 0,
  owedToUsByCurrency: [],
  weOweByCurrency: [],
};

const EMPTY_ACTIONABLE_STATS: ActionableStats = {
  awaitingMyApprovalCount: 0,
  awaitingMyApprovalByCurrency: [],
  awaitingOthersApprovalCount: 0,
  awaitingOthersApprovalByCurrency: [],
  stalePendingCount: 0,
  stalePendingByCurrency: [],
  approvedLast7Days: 0,
  rejectedLast7Days: 0,
  approvalRateLast7Days: 0,
  rejectionRateLast7Days: 0,
  averageApprovalMinutesLast7Days: null,
};

type LooseRecord = Record<string, any>;

function asNumber(value: unknown, fallback = 0): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asArray<T = LooseRecord>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeCurrencyAmountList(value: unknown): { currency: string; amount: number }[] {
  return asArray<LooseRecord>(value)
    .map((item) => ({
      currency: asString(item?.currency),
      amount: asNumber(item?.amount),
    }))
    .filter((item) => item.currency.length > 0);
}

function normalizePeriodStats(value: unknown): PeriodStats {
  const item = (value || {}) as LooseRecord;

  return {
    transactions: asNumber(item.transactions),
    movements: asNumber(item.movements),
    commissionMovements: asNumber(item.commissionMovements),
    transactionAmount: asNumber(item.transactionAmount),
    movementAmount: asNumber(item.movementAmount),
    commissionAmount: asNumber(item.commissionAmount),
    transactionAmountsByCurrency: normalizeCurrencyAmountList(item.transactionAmountsByCurrency),
    movementAmountsByCurrency: normalizeCurrencyAmountList(item.movementAmountsByCurrency),
    commissionAmountsByCurrency: normalizeCurrencyAmountList(item.commissionAmountsByCurrency),
  };
}

function normalizeDebugPayload(value: unknown): StatisticsDebugData | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const item = value as LooseRecord;
  const selectedUser = item.selectedUser && typeof item.selectedUser === 'object'
    ? (item.selectedUser as LooseRecord)
    : null;

  return {
    inputUserId: asString(item.inputUserId),
    selectedUser: selectedUser
      ? {
          id: asString(selectedUser.id),
          user_name: asString(selectedUser.user_name),
          role: asString(selectedUser.role),
          is_active: asBoolean(selectedUser.is_active),
        }
      : null,
    allUsers: asNumber(item.allUsers),
    allCustomers: asNumber(item.allCustomers),
    scopedCustomers: asNumber(item.scopedCustomers),
    allMovements: asNumber(item.allMovements),
    scopedMovements: asNumber(item.scopedMovements),
    allNotificationsForUser: asNumber(item.allNotificationsForUser),
    functionSignatures: asArray<string>(item.functionSignatures),
    movementStatusCounts: asArray<LooseRecord>(item.movementStatusCounts).map((row) => ({
      status: asString(row.status),
      is_voided: asBoolean(row.is_voided),
      is_commission: asBoolean(row.is_commission),
      count: asNumber(row.count),
      amount: asNumber(row.amount),
    })),
    currencyCounts: asArray<LooseRecord>(item.currencyCounts).map((row) => ({
      currency: asString(row.currency),
      count: asNumber(row.count),
      amount: asNumber(row.amount),
    })),
    latestScopedMovements: asArray<Record<string, unknown>>(item.latestScopedMovements),
  };
}

function normalizeStatisticsPayload(value: unknown, debug?: StatisticsDebugData | null): StatisticsData {
  const item = (value || {}) as LooseRecord;
  const periodStats = item.periodStats || {};
  const commissionStats = item.commissionStats || {};
  const debtStats = item.debtStats || {};
  const actionableStats = item.actionableStats || {};

  return {
    totalCustomers: asNumber(item.totalCustomers),
    totalTransactions: asNumber(item.totalTransactions),
    totalMovements: asNumber(item.totalMovements),
    totalAmount: asNumber(item.totalAmount),
    totalDebts: asNumber(item.totalDebts),
    totalWeOwe: asNumber(item.totalWeOwe),
    periodStats: {
      today: normalizePeriodStats(periodStats.today || EMPTY_PERIOD_STATS),
      yesterday: normalizePeriodStats(periodStats.yesterday || EMPTY_PERIOD_STATS),
      week: normalizePeriodStats(periodStats.week || EMPTY_PERIOD_STATS),
      month: normalizePeriodStats(periodStats.month || EMPTY_PERIOD_STATS),
    },
    currencyBalances: asArray<LooseRecord>(item.currencyBalances)
      .map((balance) => ({
        currency: asString(balance?.currency),
        total_incoming: asNumber(balance?.total_incoming),
        total_outgoing: asNumber(balance?.total_outgoing),
        balance: asNumber(balance?.balance),
      }))
      .filter((balance) => balance.currency.length > 0),
    cashFlowByCurrency: asArray<LooseRecord>(item.cashFlowByCurrency)
      .map((flow) => ({
        currency: asString(flow?.currency),
        totalReceived: asNumber(flow?.totalReceived),
        totalPaid: asNumber(flow?.totalPaid),
        netFlow: asNumber(flow?.netFlow),
        linkedReceived: asNumber(flow?.linkedReceived),
        linkedPaid: asNumber(flow?.linkedPaid),
        directReceived: asNumber(flow?.directReceived),
        directPaid: asNumber(flow?.directPaid),
        pendingAmount: asNumber(flow?.pendingAmount),
        pendingCount: asNumber(flow?.pendingCount),
        internalTransferAmount: asNumber(flow?.internalTransferAmount),
        internalTransferCount: asNumber(flow?.internalTransferCount),
        approvedCount: asNumber(flow?.approvedCount),
      }))
      .filter((flow) => flow.currency.length > 0),
    topCustomers: asArray<LooseRecord>(item.topCustomers).map((customer) => ({
      id: asString(customer?.id),
      name: asString(customer?.name, 'عميل'),
      phone: asString(customer?.phone),
      linked_user_id: customer?.linked_user_id || null,
      totalMovements: asNumber(customer?.totalMovements),
      totalVolume: asNumber(customer?.totalVolume),
      balanceByCurrency: normalizeCurrencyAmountList(customer?.balanceByCurrency),
      lastActivity: asString(customer?.lastActivity, new Date().toISOString()),
    })),
    commissionStats: {
      totalCommission: asNumber(commissionStats.totalCommission),
      commissionByCurrency: asArray<LooseRecord>(commissionStats.commissionByCurrency)
        .map((entry) => ({
          currency: asString(entry?.currency),
          total: asNumber(entry?.total),
        }))
        .filter((entry) => entry.currency.length > 0),
    },
    debtStats: {
      totalOwedToUs: asNumber(debtStats.totalOwedToUs),
      totalWeOwe: asNumber(debtStats.totalWeOwe),
      owedToUsByCurrency: normalizeCurrencyAmountList(debtStats.owedToUsByCurrency),
      weOweByCurrency: normalizeCurrencyAmountList(debtStats.weOweByCurrency),
    },
    actionableStats: {
      awaitingMyApprovalCount: asNumber(actionableStats.awaitingMyApprovalCount),
      awaitingMyApprovalByCurrency: normalizeCurrencyAmountList(actionableStats.awaitingMyApprovalByCurrency),
      awaitingOthersApprovalCount: asNumber(actionableStats.awaitingOthersApprovalCount),
      awaitingOthersApprovalByCurrency: normalizeCurrencyAmountList(actionableStats.awaitingOthersApprovalByCurrency),
      stalePendingCount: asNumber(actionableStats.stalePendingCount),
      stalePendingByCurrency: normalizeCurrencyAmountList(actionableStats.stalePendingByCurrency),
      approvedLast7Days: asNumber(actionableStats.approvedLast7Days),
      rejectedLast7Days: asNumber(actionableStats.rejectedLast7Days),
      approvalRateLast7Days: asNumber(actionableStats.approvalRateLast7Days),
      rejectionRateLast7Days: asNumber(actionableStats.rejectionRateLast7Days),
      averageApprovalMinutesLast7Days:
        actionableStats.averageApprovalMinutesLast7Days === null ||
        actionableStats.averageApprovalMinutesLast7Days === undefined
          ? null
          : asNumber(actionableStats.averageApprovalMinutesLast7Days),
    },
    debug: debug || null,
  };
}

function toSqlDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export class StatisticsService {
  private static getEmptyStatistics(): StatisticsData {
    return {
      totalCustomers: 0,
      totalTransactions: 0,
      totalMovements: 0,
      totalAmount: 0,
      totalDebts: 0,
      totalWeOwe: 0,
      periodStats: {
        today: EMPTY_PERIOD_STATS,
        yesterday: EMPTY_PERIOD_STATS,
        week: EMPTY_PERIOD_STATS,
        month: EMPTY_PERIOD_STATS,
      },
      currencyBalances: [],
      cashFlowByCurrency: [],
      topCustomers: [],
      commissionStats: {
        totalCommission: 0,
        commissionByCurrency: [],
      },
      debtStats: EMPTY_DEBT_STATS,
      actionableStats: EMPTY_ACTIONABLE_STATS,
      debug: null,
    };
  }

  static async fetchStatisticsDebug(userId: string): Promise<StatisticsDebugData | null> {
    if (!userId) {
      return null;
    }

    const { data, error } = await supabase.rpc('get_app_statistics_debug', {
      p_user_id: userId,
    });

    if (error) {
      console.warn('[StatisticsService] get_app_statistics_debug failed:', error);
      return null;
    }

    return normalizeDebugPayload(data);
  }

  static async fetchAllStatistics(userId: string): Promise<StatisticsData> {
    if (!userId) {
      return this.getEmptyStatistics();
    }

    const { data, error } = await supabase.rpc('get_app_statistics', {
      p_user_id: userId,
    });

    if (error) {
      const debug = await this.fetchStatisticsDebug(userId);
      console.error('[StatisticsService] get_app_statistics failed:', error, debug);
      throw new Error(`فشل تحميل الإحصاءات من قاعدة البيانات: ${error.message}`);
    }

    const debug = await this.fetchStatisticsDebug(userId);
    const normalized = normalizeStatisticsPayload(data, debug);

    if (
      normalized.totalMovements === 0 &&
      normalized.cashFlowByCurrency.length === 0 &&
      debug &&
      debug.scopedMovements > 0
    ) {
      console.warn('[StatisticsService] Statistics returned zero, but debug found scoped movements:', debug);
    }

    return normalized;
  }

  static async fetchCustomDateRangeStats(
    userId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<PeriodStats> {
    if (!userId) {
      return EMPTY_PERIOD_STATS;
    }

    const { data, error } = await supabase.rpc('get_app_period_statistics', {
      p_user_id: userId,
      p_start_date: toSqlDate(startDate),
      p_end_date: toSqlDate(endDate),
    });

    if (error) {
      console.error('[StatisticsService] get_app_period_statistics failed:', error);
      throw new Error(`فشل تحميل إحصائيات الفترة من قاعدة البيانات: ${error.message}`);
    }

    return normalizePeriodStats(data);
  }
}
