import type { TransferCommissionCalculationType } from '@/types/database';

export interface TransferCommissionSummary {
  amount: number;
  customerCommission: number;
  networkCommission: number;
  debitTotal: number;
  networkTotal: number;
  netProfit: number;
}

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function getTransferCommissionQuoteKey(
  userId: string | null | undefined,
  direction: string,
  currency: string,
  amount: number,
): string | null {
  if (!userId || !Number.isFinite(amount) || amount <= 0) return null;

  return JSON.stringify([
    userId,
    direction,
    currency,
    roundMoney(amount),
  ]);
}

export function calculateTransferCommission(
  amount: number,
  value: number,
  calculationType: TransferCommissionCalculationType,
): number {
  if (!Number.isFinite(amount) || !Number.isFinite(value) || amount < 0 || value < 0) {
    return 0;
  }

  const result =
    calculationType === 'fixed'
      ? value
      : calculationType === 'percentage'
        ? (amount * value) / 100
        : calculationType === 'per_thousand'
          ? (amount * value) / 1_000
          : (amount * value) / 1_000_000;

  return roundMoney(result);
}

export function calculateTransferCommissionSummary(
  amount: number,
  customerCommission: number,
  networkCommission: number,
): TransferCommissionSummary {
  const normalizedAmount = roundMoney(Math.max(0, Number(amount) || 0));
  const normalizedCustomer = roundMoney(Math.max(0, Number(customerCommission) || 0));
  const normalizedNetwork = roundMoney(Math.max(0, Number(networkCommission) || 0));

  return {
    amount: normalizedAmount,
    customerCommission: normalizedCustomer,
    networkCommission: normalizedNetwork,
    debitTotal: roundMoney(normalizedAmount + normalizedCustomer),
    networkTotal: roundMoney(normalizedAmount + normalizedNetwork),
    netProfit: roundMoney(normalizedCustomer - normalizedNetwork),
  };
}
