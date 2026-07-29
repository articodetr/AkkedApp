import { describe, expect, it } from 'vitest';

import {
  calculateTransferCommission,
  calculateTransferCommissionSummary,
  getTransferCommissionQuoteKey,
  roundMoney,
} from '../transferCommission';

describe('transfer commission calculation', () => {
  it('calculates a fixed commission', () => {
    expect(calculateTransferCommission(1_000, 20, 'fixed')).toBe(20);
  });

  it('calculates percentage commissions and rounds each one to two decimals', () => {
    expect(calculateTransferCommission(1_234.56, 2.5, 'percentage')).toBe(30.86);
    expect(calculateTransferCommission(1_234.56, 1.2, 'percentage')).toBe(14.81);
  });

  it('calculates per-thousand and per-million commissions proportionally', () => {
    expect(calculateTransferCommission(2_500, 10, 'per_thousand')).toBe(25);
    expect(calculateTransferCommission(2_500_000, 1_000, 'per_million')).toBe(2_500);
  });

  it('uses financial two-decimal rounding for positive commissions', () => {
    expect(roundMoney(0.005)).toBe(0.01);
    expect(roundMoney(1.005)).toBe(1.01);
  });

  it('builds the balanced send/receive summary', () => {
    expect(calculateTransferCommissionSummary(1_000, 20, 8)).toEqual({
      amount: 1_000,
      customerCommission: 20,
      networkCommission: 8,
      debitTotal: 1_020,
      networkTotal: 1_008,
      netProfit: 12,
    });
  });

  it('keeps a negative difference as a loss', () => {
    expect(calculateTransferCommissionSummary(1_000, 5, 8).netProfit).toBe(-3);
  });

  it('invalidates a resolved quote when a financially distinct input changes', () => {
    const original = getTransferCommissionQuoteKey(
      '00000000-0000-0000-0000-000000000001',
      'send',
      'SAR',
      100,
    );

    expect(
      getTransferCommissionQuoteKey(
        '00000000-0000-0000-0000-000000000001',
        'send',
        'SAR',
        200,
      ),
    ).not.toBe(original);
    expect(
      getTransferCommissionQuoteKey(
        '00000000-0000-0000-0000-000000000001',
        'receive',
        'SAR',
        100,
      ),
    ).not.toBe(original);
  });

  it('uses the same quote key for amounts that the RPC rounds identically', () => {
    expect(
      getTransferCommissionQuoteKey('user-id', 'send', 'SAR', 100.001),
    ).toBe(
      getTransferCommissionQuoteKey('user-id', 'send', 'SAR', 100.002),
    );
    expect(getTransferCommissionQuoteKey('user-id', 'send', 'SAR', 0)).toBeNull();
  });
});
