import { supabase } from '@/lib/supabase';
import { CustomerBalanceByCurrency, TotalBalanceByCurrency } from '@/types/database';

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

const EMPTY_STATISTICS: StatisticsData = {
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
};

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function normalizeAmountList(
  items: any,
): { currency: string; amount: number }[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .filter((item) => item && item.currency)
    .map((item) => ({
      currency: String(item.currency),
      amount: toNumber(item.amount),
    }));
}

function normalizePeriodStats(value: any): PeriodStats {
  if (!value) {
    return { ...EMPTY_PERIOD_STATS };
  }

  return {
    transactions: toNumber(value.transactions),
    movements: toNumber(value.movements),
    commissionMovements: toNumber(value.commissionMovements),
    transactionAmount: toNumber(value.transactionAmount),
    movementAmount: toNumber(value.movementAmount),
    commissionAmount: toNumber(value.commissionAmount),
    transactionAmountsByCurrency: normalizeAmountList(
      value.transactionAmountsByCurrency,
    ),
    movementAmountsByCurrency: normalizeAmountList(
      value.movementAmountsByCurrency,
    ),
    commissionAmountsByCurrency: normalizeAmountList(
      value.commissionAmountsByCurrency,
    ),
  };
}

function normalizeStatistics(value: any): StatisticsData {
  if (!value) {
    return { ...EMPTY_STATISTICS };
  }

  return {
    totalCustomers: toNumber(value.totalCustomers),
    totalTransactions: toNumber(value.totalTransactions),
    totalMovements: toNumber(value.totalMovements),
    totalAmount: toNumber(value.totalAmount),
    totalDebts: toNumber(value.totalDebts),
    totalWeOwe: toNumber(value.totalWeOwe),

    periodStats: {
      today: normalizePeriodStats(value.periodStats?.today),
      yesterday: normalizePeriodStats(value.periodStats?.yesterday),
      week: normalizePeriodStats(value.periodStats?.week),
      month: normalizePeriodStats(value.periodStats?.month),
    },

    currencyBalances: Array.isArray(value.currencyBalances)
      ? value.currencyBalances.map(
          (item: any): TotalBalanceByCurrency => ({
            currency: String(item.currency),
            total_incoming: toNumber(item.total_incoming),
            total_outgoing: toNumber(item.total_outgoing),
            balance: toNumber(item.balance),
          }),
        )
      : [],

    cashFlowByCurrency: Array.isArray(value.cashFlowByCurrency)
      ? value.cashFlowByCurrency.map(
          (item: any): CashFlowByCurrency => ({
            currency: String(item.currency),
            totalReceived: toNumber(item.totalReceived),
            totalPaid: toNumber(item.totalPaid),
            netFlow: toNumber(item.netFlow),
            linkedReceived: toNumber(item.linkedReceived),
            linkedPaid: toNumber(item.linkedPaid),
            directReceived: toNumber(item.directReceived),
            directPaid: toNumber(item.directPaid),
            pendingAmount: toNumber(item.pendingAmount),
            pendingCount: toNumber(item.pendingCount),
            internalTransferAmount: toNumber(item.internalTransferAmount),
            internalTransferCount: toNumber(item.internalTransferCount),
            approvedCount: toNumber(item.approvedCount),
          }),
        )
      : [],

    topCustomers: Array.isArray(value.topCustomers)
      ? value.topCustomers.map(
          (item: any): TopCustomer => ({
            id: String(item.id),
            name: String(item.name || ''),
            phone: String(item.phone || ''),
            linked_user_id: item.linked_user_id || null,
            totalMovements: toNumber(item.totalMovements),
            totalVolume: toNumber(item.totalVolume),
            balanceByCurrency: normalizeAmountList(item.balanceByCurrency),
            lastActivity: String(item.lastActivity || new Date().toISOString()),
          }),
        )
      : [],

    commissionStats: {
      totalCommission: toNumber(value.commissionStats?.totalCommission),
      commissionByCurrency: Array.isArray(
        value.commissionStats?.commissionByCurrency,
      )
        ? value.commissionStats.commissionByCurrency.map((item: any) => ({
            currency: String(item.currency),
            total: toNumber(item.total),
          }))
        : [],
    },

    debtStats: {
      totalOwedToUs: toNumber(value.debtStats?.totalOwedToUs),
      totalWeOwe: toNumber(value.debtStats?.totalWeOwe),
      owedToUsByCurrency: normalizeAmountList(
        value.debtStats?.owedToUsByCurrency,
      ),
      weOweByCurrency: normalizeAmountList(value.debtStats?.weOweByCurrency),
    },

    actionableStats: {
      awaitingMyApprovalCount: toNumber(
        value.actionableStats?.awaitingMyApprovalCount,
      ),
      awaitingMyApprovalByCurrency: normalizeAmountList(
        value.actionableStats?.awaitingMyApprovalByCurrency,
      ),
      awaitingOthersApprovalCount: toNumber(
        value.actionableStats?.awaitingOthersApprovalCount,
      ),
      awaitingOthersApprovalByCurrency: normalizeAmountList(
        value.actionableStats?.awaitingOthersApprovalByCurrency,
      ),
      stalePendingCount: toNumber(value.actionableStats?.stalePendingCount),
      stalePendingByCurrency: normalizeAmountList(
        value.actionableStats?.stalePendingByCurrency,
      ),
      approvedLast7Days: toNumber(value.actionableStats?.approvedLast7Days),
      rejectedLast7Days: toNumber(value.actionableStats?.rejectedLast7Days),
      approvalRateLast7Days: toNumber(
        value.actionableStats?.approvalRateLast7Days,
      ),
      rejectionRateLast7Days: toNumber(
        value.actionableStats?.rejectionRateLast7Days,
      ),
      averageApprovalMinutesLast7Days:
        value.actionableStats?.averageApprovalMinutesLast7Days == null
          ? null
          : toNumber(value.actionableStats.averageApprovalMinutesLast7Days),
    },
  };
}

function toSqlDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export class StatisticsService {
  static async fetchAllStatistics(userId: string): Promise<StatisticsData> {
    try {
      const { data, error } = await supabase.rpc('get_app_statistics', {
        p_user_id: userId,
      });

      if (error) {
        console.error('[StatisticsService] RPC get_app_statistics failed:', error);
        throw error;
      }

      return normalizeStatistics(data);
    } catch (error) {
      console.error('Error in fetchAllStatistics:', error);
      throw error;
    }
  }

  static async fetchCustomDateRangeStats(
    userId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<PeriodStats> {
    try {
      const { data, error } = await supabase.rpc('get_app_statistics', {
        p_user_id: userId,
        p_start_date: toSqlDate(startDate),
        p_end_date: toSqlDate(endDate),
      });

      if (error) {
        console.error('[StatisticsService] Custom stats RPC failed:', error);
        throw error;
      }

      return normalizePeriodStats(data?.customPeriod);
    } catch (error) {
      console.error('Error in fetchCustomDateRangeStats:', error);
      throw error;
    }
  }
}

export type { CustomerBalanceByCurrency };
