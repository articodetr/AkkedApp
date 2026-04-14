import { endOfDay, startOfDay, subDays } from 'date-fns';
import { Customer, CustomerBalanceByCurrency, TotalBalanceByCurrency } from '@/types/database';
import { supabase } from '@/lib/supabase';
import { buildScopedCustomerFilter } from '@/services/userScopeService';
import { isPostedMovement } from '@/utils/movementApproval';

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

interface StatsTransactionRow {
  customer_id: string;
  amount_sent: number;
  currency_sent: string;
  created_at: string;
  status?: 'pending' | 'completed' | 'cancelled' | null;
}

interface StatsMovementRow {
  id: string;
  customer_id: string;
  amount: number;
  commission?: number | null;
  commission_currency?: string | null;
  currency: string;
  movement_type: 'incoming' | 'outgoing';
  created_at: string;
  related_transfer_id?: string | null;
  mirror_movement_id?: string | null;
  is_commission_movement?: boolean | null;
  pending_approval?: boolean | null;
  approval_status?: 'pending' | 'approved' | 'rejected' | null;
  is_voided?: boolean | null;
  from_customer_id?: string | null;
  to_customer_id?: string | null;
  approved_at?: string | null;
}

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

interface CommissionEntry {
  currency: string;
  amount: number;
}

export class StatisticsService {
  private static mapCurrencyTotals(
    totals: Map<string, number>,
  ): { currency: string; amount: number }[] {
    return Array.from(totals.entries())
      .map(([currency, amount]) => ({ currency, amount }))
      .sort((a, b) => b.amount - a.amount);
  }

  private static mapSignedCurrencyTotals(
    totals: Map<string, number>,
  ): { currency: string; amount: number }[] {
    return Array.from(totals.entries())
      .filter(([, amount]) => amount !== 0)
      .map(([currency, amount]) => ({ currency, amount }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  }

  private static isApprovedMovement(movement: StatsMovementRow): boolean {
    return isPostedMovement(movement);
  }

  private static isApprovedCustomerMovement(movement: StatsMovementRow): boolean {
    return this.isApprovedMovement(movement) && !movement.is_commission_movement;
  }

  private static isPendingMovement(movement: StatsMovementRow): boolean {
    return Boolean(movement.pending_approval) || movement.approval_status === 'pending';
  }

  private static isRejectedMovement(movement: StatsMovementRow): boolean {
    return movement.approval_status === 'rejected';
  }

  private static isLinkedMovement(movement: StatsMovementRow): boolean {
    if (this.isInternalTransfer(movement)) {
      return false;
    }

    return Boolean(
      movement.related_transfer_id || movement.mirror_movement_id,
    );
  }

  private static isCompletedTransaction(transaction: StatsTransactionRow): boolean {
    return (transaction.status ?? 'completed') === 'completed';
  }

  private static isInternalTransfer(movement: StatsMovementRow): boolean {
    return Boolean(movement.from_customer_id || movement.to_customer_id);
  }

  private static getCommissionGroupKey(movement: StatsMovementRow): string {
    if (movement.related_transfer_id) {
      return [movement.id, movement.related_transfer_id].sort().join(':');
    }

    return movement.id;
  }

  private static buildCommissionEntries(movements: StatsMovementRow[]): CommissionEntry[] {
    const seen = new Set<string>();
    const entries: CommissionEntry[] = [];

    movements
      .filter((movement) => this.isApprovedMovement(movement))
      .forEach((movement) => {
        const commission = Number(movement.commission || 0);

        if (commission <= 0) {
          return;
        }

        const groupKey = this.getCommissionGroupKey(movement);
        if (seen.has(groupKey)) {
          return;
        }

        seen.add(groupKey);
        entries.push({
          currency: movement.commission_currency || movement.currency,
          amount: commission,
        });
      });

    return entries;
  }

  private static createEmptyPeriodStats(): PeriodStats {
    return {
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
  }

  private static calculatePeriodStats(
    transactions: StatsTransactionRow[],
    movements: StatsMovementRow[],
    startDate: Date,
    endDate: Date,
  ): PeriodStats {
    const start = startOfDay(startDate).getTime();
    const end = endOfDay(endDate).getTime();
    const transactionAmountsByCurrency = new Map<string, number>();
    const movementAmountsByCurrency = new Map<string, number>();
    const commissionAmountsByCurrency = new Map<string, number>();

    const periodTransactions = transactions.filter((transaction) => {
      if (!this.isCompletedTransaction(transaction)) {
        return false;
      }

      const createdAt = new Date(transaction.created_at).getTime();
      return createdAt >= start && createdAt <= end;
    });

    const periodMovements = movements.filter((movement) => {
      const createdAt = new Date(movement.created_at).getTime();
      return createdAt >= start && createdAt <= end;
    });
    const periodCommissionEntries = this.buildCommissionEntries(periodMovements);

    periodTransactions.forEach((transaction) => {
      transactionAmountsByCurrency.set(
        transaction.currency_sent,
        (transactionAmountsByCurrency.get(transaction.currency_sent) || 0) +
          Number(transaction.amount_sent),
      );
    });

    periodMovements.forEach((movement) => {
      movementAmountsByCurrency.set(
        movement.currency,
        (movementAmountsByCurrency.get(movement.currency) || 0) + Number(movement.amount),
      );
    });

    periodCommissionEntries.forEach((entry) => {
      commissionAmountsByCurrency.set(
        entry.currency,
        (commissionAmountsByCurrency.get(entry.currency) || 0) + entry.amount,
      );
    });

    return {
      transactions: periodTransactions.length,
      movements: periodMovements.length,
      commissionMovements: periodCommissionEntries.length,
      transactionAmount: periodTransactions.reduce(
        (sum, transaction) => sum + Number(transaction.amount_sent),
        0,
      ),
      movementAmount: periodMovements.reduce(
        (sum, movement) => sum + Number(movement.amount),
        0,
      ),
      commissionAmount: periodCommissionEntries.reduce(
        (sum, entry) => sum + entry.amount,
        0,
      ),
      transactionAmountsByCurrency: this.mapCurrencyTotals(transactionAmountsByCurrency),
      movementAmountsByCurrency: this.mapCurrencyTotals(movementAmountsByCurrency),
      commissionAmountsByCurrency: this.mapCurrencyTotals(commissionAmountsByCurrency),
    };
  }

  private static aggregateCurrencyBalances(
    balances: CustomerBalanceByCurrency[],
  ): TotalBalanceByCurrency[] {
    const totals = new Map<string, TotalBalanceByCurrency>();

    balances.forEach((balance) => {
      if (!balance.currency) {
        return;
      }

      const current = totals.get(balance.currency) || {
        currency: balance.currency,
        total_incoming: 0,
        total_outgoing: 0,
        balance: 0,
      };

      current.total_incoming += Number(balance.total_incoming);
      current.total_outgoing += Number(balance.total_outgoing);
      current.balance += Number(balance.balance);

      totals.set(balance.currency, current);
    });

    return Array.from(totals.values()).sort((a, b) => a.currency.localeCompare(b.currency));
  }

  private static buildTopCustomers(
    customers: Customer[],
    movements: StatsMovementRow[],
    limit: number = 5,
  ): TopCustomer[] {
    const activeCustomers = customers.filter((customer) => !customer.is_profit_loss_account);
    const statsMap = new Map<
      string,
      {
        totalMovements: number;
        totalVolume: number;
        balances: Map<string, number>;
        lastActivity: string;
      }
    >();

    activeCustomers.forEach((customer) => {
      statsMap.set(customer.id, {
        totalMovements: 0,
        totalVolume: 0,
        balances: new Map<string, number>(),
        lastActivity: customer.updated_at || customer.created_at,
      });
    });

    movements
      .filter((movement) => this.isApprovedCustomerMovement(movement))
      .forEach((movement) => {
        const customerStats = statsMap.get(movement.customer_id);

        if (!customerStats) {
          return;
        }

        customerStats.totalMovements += 1;
        customerStats.totalVolume += Number(movement.amount);
        customerStats.balances.set(
          movement.currency,
          (customerStats.balances.get(movement.currency) || 0) +
            (movement.movement_type === 'incoming'
              ? Number(movement.amount)
              : -Number(movement.amount)),
        );

        if (new Date(movement.created_at) > new Date(customerStats.lastActivity)) {
          customerStats.lastActivity = movement.created_at;
        }
      });

    return activeCustomers
      .map((customer) => {
        const stats = statsMap.get(customer.id);

        return {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          linked_user_id: customer.linked_user_id || null,
          totalMovements: stats?.totalMovements || 0,
          totalVolume: stats?.totalVolume || 0,
          balanceByCurrency: this.mapSignedCurrencyTotals(stats?.balances || new Map()),
          lastActivity: stats?.lastActivity || customer.created_at,
        };
      })
      .filter((customer) => customer.totalMovements > 0)
      .sort((a, b) => {
        if (b.totalMovements !== a.totalMovements) {
          return b.totalMovements - a.totalMovements;
        }

        if (b.totalVolume !== a.totalVolume) {
          return b.totalVolume - a.totalVolume;
        }

        return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
      })
      .slice(0, limit);
  }

  private static buildCommissionStats(movements: StatsMovementRow[]): CommissionStats {
    const commissionByCurrency = new Map<string, number>();
    const commissionEntries = this.buildCommissionEntries(movements);
    const totalCommission = commissionEntries.reduce((sum, entry) => sum + entry.amount, 0);

    commissionEntries.forEach((entry) => {
      commissionByCurrency.set(
        entry.currency,
        (commissionByCurrency.get(entry.currency) || 0) + entry.amount,
      );
    });

    return {
      totalCommission,
      commissionByCurrency: Array.from(commissionByCurrency.entries())
        .map(([currency, total]) => ({ currency, total }))
        .sort((a, b) => b.total - a.total),
    };
  }

  private static buildDebtStats(balances: CustomerBalanceByCurrency[]): DebtStats {
    if (balances.length === 0) {
      return EMPTY_DEBT_STATS;
    }

    const owedToUsByCurrency: Record<string, number> = {};
    const weOweByCurrency: Record<string, number> = {};

    balances.forEach((balance) => {
      const amount = Number(balance.balance);
      const currency = balance.currency;

      if (!currency) {
        return;
      }

      if (amount > 0) {
        weOweByCurrency[currency] = (weOweByCurrency[currency] || 0) + amount;
      } else if (amount < 0) {
        owedToUsByCurrency[currency] =
          (owedToUsByCurrency[currency] || 0) + Math.abs(amount);
      }
    });

    return {
      totalOwedToUs: Object.values(owedToUsByCurrency).reduce((sum, value) => sum + value, 0),
      totalWeOwe: Object.values(weOweByCurrency).reduce((sum, value) => sum + value, 0),
      owedToUsByCurrency: Object.entries(owedToUsByCurrency).map(([currency, amount]) => ({
        currency,
        amount,
      })),
      weOweByCurrency: Object.entries(weOweByCurrency).map(([currency, amount]) => ({
        currency,
        amount,
      })),
    };
  }

  private static roundMetric(value: number): number {
    return Number(value.toFixed(1));
  }

  private static buildActionableStats(
    movements: StatsMovementRow[],
    customers: Customer[],
    userId: string,
  ): ActionableStats {
    if (movements.length === 0 || customers.length === 0) {
      return EMPTY_ACTIONABLE_STATS;
    }

    const customerMap = new Map(customers.map((customer) => [customer.id, customer]));
    const awaitingMyApprovalByCurrency = new Map<string, number>();
    const awaitingOthersApprovalByCurrency = new Map<string, number>();
    const stalePendingByCurrency = new Map<string, number>();

    let awaitingMyApprovalCount = 0;
    let awaitingOthersApprovalCount = 0;
    let stalePendingCount = 0;
    let approvedLast7Days = 0;
    let rejectedLast7Days = 0;

    const approvalDurations: number[] = [];
    const now = Date.now();
    const staleThreshold = now - 24 * 60 * 60 * 1000;
    const weekAgo = subDays(new Date(), 7).getTime();

    movements
      .filter((movement) => !movement.is_commission_movement)
      .forEach((movement) => {
        const customer = customerMap.get(movement.customer_id);

        if (!customer || movement.is_voided) {
          return;
        }

        const amount = Number(movement.amount || 0);
        const createdAt = new Date(movement.created_at).getTime();
        const approvedAt = movement.approved_at ? new Date(movement.approved_at).getTime() : null;
        const status = movement.approval_status ?? (movement.pending_approval ? 'pending' : 'approved');
        const isPending = status === 'pending' || movement.pending_approval === true;
        const ownedByCurrentUser = customer.user_id === userId;
        const visibleAsCounterparty = customer.user_id !== userId && customer.linked_user_id === userId;

        if (isPending && visibleAsCounterparty) {
          awaitingMyApprovalCount += 1;
          awaitingMyApprovalByCurrency.set(
            movement.currency,
            (awaitingMyApprovalByCurrency.get(movement.currency) || 0) + amount,
          );
        }

        if (isPending && ownedByCurrentUser && Boolean(customer.linked_user_id)) {
          awaitingOthersApprovalCount += 1;
          awaitingOthersApprovalByCurrency.set(
            movement.currency,
            (awaitingOthersApprovalByCurrency.get(movement.currency) || 0) + amount,
          );
        }

        if (isPending && createdAt <= staleThreshold) {
          stalePendingCount += 1;
          stalePendingByCurrency.set(
            movement.currency,
            (stalePendingByCurrency.get(movement.currency) || 0) + amount,
          );
        }

        if (approvedAt && approvedAt >= weekAgo) {
          approvedLast7Days += 1;
          approvalDurations.push(Math.max(0, (approvedAt - createdAt) / (1000 * 60)));
        }

        if (status === 'rejected' && createdAt >= weekAgo) {
          rejectedLast7Days += 1;
        }
      });

    const decisionCount = approvedLast7Days + rejectedLast7Days;

    return {
      awaitingMyApprovalCount,
      awaitingMyApprovalByCurrency: this.mapCurrencyTotals(awaitingMyApprovalByCurrency),
      awaitingOthersApprovalCount,
      awaitingOthersApprovalByCurrency: this.mapCurrencyTotals(awaitingOthersApprovalByCurrency),
      stalePendingCount,
      stalePendingByCurrency: this.mapCurrencyTotals(stalePendingByCurrency),
      approvedLast7Days,
      rejectedLast7Days,
      approvalRateLast7Days:
        decisionCount > 0 ? this.roundMetric((approvedLast7Days / decisionCount) * 100) : 0,
      rejectionRateLast7Days:
        decisionCount > 0 ? this.roundMetric((rejectedLast7Days / decisionCount) * 100) : 0,
      averageApprovalMinutesLast7Days:
        approvalDurations.length > 0
          ? this.roundMetric(
              approvalDurations.reduce((sum, minutes) => sum + minutes, 0) / approvalDurations.length,
            )
          : null,
    };
  }

  private static buildCashFlowByCurrency(
    movements: StatsMovementRow[],
  ): CashFlowByCurrency[] {
    const flowByCurrency = new Map<string, CashFlowByCurrency>();

    movements
      .filter((movement) => !movement.is_commission_movement)
      .forEach((movement) => {
        const amount = Number(movement.amount || 0);
        const current = flowByCurrency.get(movement.currency) || {
          currency: movement.currency,
          totalReceived: 0,
          totalPaid: 0,
          netFlow: 0,
          linkedReceived: 0,
          linkedPaid: 0,
          directReceived: 0,
          directPaid: 0,
          pendingAmount: 0,
          pendingCount: 0,
          internalTransferAmount: 0,
          internalTransferCount: 0,
          approvedCount: 0,
        };

        const isInternal = this.isInternalTransfer(movement);
        const isLinked = this.isLinkedMovement(movement);

        if (this.isPendingMovement(movement)) {
          current.pendingAmount += amount;
          current.pendingCount += 1;
          flowByCurrency.set(movement.currency, current);
          return;
        }

        if (this.isRejectedMovement(movement) || !this.isApprovedCustomerMovement(movement)) {
          flowByCurrency.set(movement.currency, current);
          return;
        }

        if (isInternal) {
          current.internalTransferAmount += amount;
          current.internalTransferCount += 1;
          flowByCurrency.set(movement.currency, current);
          return;
        }

        if (movement.movement_type === 'incoming') {
          current.totalReceived += amount;

          if (isLinked) {
            current.linkedReceived += amount;
          } else {
            current.directReceived += amount;
          }
        } else {
          current.totalPaid += amount;

          if (isLinked) {
            current.linkedPaid += amount;
          } else {
            current.directPaid += amount;
          }
        }

        current.approvedCount += 1;
        current.netFlow = current.totalReceived - current.totalPaid;

        flowByCurrency.set(movement.currency, current);
      });

    return Array.from(flowByCurrency.values()).sort((a, b) => a.currency.localeCompare(b.currency));
  }

  private static getEmptyStatistics(): StatisticsData {
    return {
      totalCustomers: 0,
      totalTransactions: 0,
      totalMovements: 0,
      totalAmount: 0,
      totalDebts: 0,
      totalWeOwe: 0,
      periodStats: {
        today: this.createEmptyPeriodStats(),
        yesterday: this.createEmptyPeriodStats(),
        week: this.createEmptyPeriodStats(),
        month: this.createEmptyPeriodStats(),
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
  }

  static async fetchAllStatistics(userId: string): Promise<StatisticsData> {
    try {
      const customersResult = await supabase
        .from('customers')
        .select('*')
        .or(buildScopedCustomerFilter(userId, true))
        .order('name', { ascending: true });

      if (customersResult.error) {
        throw customersResult.error;
      }

      const customers = (customersResult.data || []) as Customer[];
      const customerIds = customers.map((customer) => customer.id);

      if (customerIds.length === 0) {
        return this.getEmptyStatistics();
      }

      const nonSystemCustomers = customers.filter((customer) => !customer.is_profit_loss_account);
      const nonSystemCustomerIds = new Set(nonSystemCustomers.map((customer) => customer.id));

      const [transactionsResult, movementsResult, balancesResult] = await Promise.all([
        supabase
          .from('transactions')
          .select('customer_id, amount_sent, currency_sent, created_at, status')
          .in('customer_id', customerIds),
        supabase
          .from('account_movements')
          .select(
            'id, customer_id, amount, commission, commission_currency, currency, movement_type, created_at, related_transfer_id, mirror_movement_id, is_commission_movement, pending_approval, approval_status, is_voided, from_customer_id, to_customer_id, approved_at',
          )
          .in('customer_id', customerIds),
        supabase
          .from('customer_balances_by_currency')
          .select('*')
          .in('customer_id', customerIds),
      ]);

      if (transactionsResult.error) {
        console.error('Error fetching transactions:', transactionsResult.error);
      }

      if (movementsResult.error) {
        console.error('Error fetching movements:', movementsResult.error);
      }

      if (balancesResult.error) {
        console.error('Error fetching customer balances:', balancesResult.error);
      }

      const transactions = ((transactionsResult.data || []) as StatsTransactionRow[]).filter(
        (transaction) => this.isCompletedTransaction(transaction),
      );
      const movements = (movementsResult.data || []) as StatsMovementRow[];
      const balances = (balancesResult.data || []) as CustomerBalanceByCurrency[];

      const approvedCustomerMovements = movements.filter((movement) =>
        this.isApprovedCustomerMovement(movement),
      );
      const nonSystemBalances = balances.filter((balance) =>
        nonSystemCustomerIds.has(balance.customer_id),
      );

      const now = new Date();
      const today = now;
      const yesterday = subDays(now, 1);
      const weekAgo = subDays(now, 7);
      const monthAgo = subDays(now, 30);

      const debtStats = this.buildDebtStats(nonSystemBalances);

      return {
        totalCustomers: nonSystemCustomers.length,
        totalTransactions: transactions.length,
        totalMovements: approvedCustomerMovements.length,
        totalAmount: approvedCustomerMovements.reduce(
          (sum, movement) => sum + Number(movement.amount),
          0,
        ),
        totalDebts: debtStats.totalOwedToUs,
        totalWeOwe: debtStats.totalWeOwe,
        periodStats: {
          today: this.calculatePeriodStats(transactions, approvedCustomerMovements, today, today),
          yesterday: this.calculatePeriodStats(
            transactions,
            approvedCustomerMovements,
            yesterday,
            yesterday,
          ),
          week: this.calculatePeriodStats(transactions, approvedCustomerMovements, weekAgo, today),
          month: this.calculatePeriodStats(
            transactions,
            approvedCustomerMovements,
            monthAgo,
            today,
          ),
        },
        currencyBalances: this.aggregateCurrencyBalances(nonSystemBalances),
        cashFlowByCurrency: this.buildCashFlowByCurrency(movements),
        topCustomers: this.buildTopCustomers(nonSystemCustomers, movements, 5),
        commissionStats: this.buildCommissionStats(movements),
        debtStats,
        actionableStats: this.buildActionableStats(movements, customers, userId),
      };
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
    const customersResult = await supabase
      .from('customers')
      .select('*')
      .or(buildScopedCustomerFilter(userId, true))
      .order('name', { ascending: true });

    if (customersResult.error) {
      throw customersResult.error;
    }

    const customers = (customersResult.data || []) as Customer[];
    const customerIds = customers.map((customer) => customer.id);

    if (customerIds.length === 0) {
      return this.createEmptyPeriodStats();
    }

    const [transactionsResult, movementsResult] = await Promise.all([
      supabase
        .from('transactions')
        .select('customer_id, amount_sent, currency_sent, created_at, status')
        .in('customer_id', customerIds),
      supabase
        .from('account_movements')
        .select(
          'id, customer_id, amount, commission, commission_currency, currency, movement_type, created_at, related_transfer_id, mirror_movement_id, is_commission_movement, pending_approval, approval_status, is_voided, from_customer_id, to_customer_id, approved_at',
        )
        .in('customer_id', customerIds),
    ]);

    if (transactionsResult.error) {
      console.error('Error fetching range transactions:', transactionsResult.error);
    }

    if (movementsResult.error) {
      console.error('Error fetching range movements:', movementsResult.error);
    }

    const transactions = ((transactionsResult.data || []) as StatsTransactionRow[]).filter(
      (transaction) => this.isCompletedTransaction(transaction),
    );
    const movements = ((movementsResult.data || []) as StatsMovementRow[]).filter((movement) =>
      this.isApprovedCustomerMovement(movement),
    );

    return this.calculatePeriodStats(transactions, movements, startDate, endDate);
  }
}
