import { describe, expect, it } from 'vitest';

import {
  computeMovementEffects,
  getMovementDisplayParts,
} from '../movementEffects';

describe('computeMovementEffects — بدون عمولة', () => {
  it('له 1000 بدون عمولة', () => {
    const fx = computeMovementEffects({ movementType: 'incoming', baseAmount: 1000 });
    expect(fx.valid).toBe(true);
    expect(fx.customerTotalAmount).toBe(1000);
    expect(fx.customerType).toBe('incoming');
    expect(fx.customerSignedEffect).toBe(1000);
    expect(fx.profitLossAmount).toBe(0);
    expect(fx.profitLossType).toBeNull();
    expect(fx.mirrorCustomerType).toBe('outgoing');
    expect(fx.mirrorCustomerSignedEffect).toBe(-1000);
  });

  it('عليه 1000 بدون عمولة', () => {
    const fx = computeMovementEffects({ movementType: 'outgoing', baseAmount: 1000 });
    expect(fx.valid).toBe(true);
    expect(fx.customerTotalAmount).toBe(1000);
    expect(fx.customerType).toBe('outgoing');
    expect(fx.customerSignedEffect).toBe(-1000);
    expect(fx.profitLossAmount).toBe(0);
  });
});

describe('computeMovementEffects — الحالة 1: العمولة للعميل', () => {
  // له 1000 + عمولة 50 للعميل ⇒ العميل له 1050 والأرباح والخسائر عليه 50
  it('له 1000 + عمولة 50 للعميل', () => {
    const fx = computeMovementEffects({
      movementType: 'incoming',
      baseAmount: 1000,
      commissionAmount: 50,
      commissionOwner: 'account_owner',
    });
    expect(fx.valid).toBe(true);
    expect(fx.customerTotalAmount).toBe(1050);
    expect(fx.customerType).toBe('incoming');
    expect(fx.profitLossAmount).toBe(50);
    expect(fx.profitLossType).toBe('outgoing'); // مصروف
    expect(fx.profitLossSignedEffect).toBe(-50);
    // الثابت المحاسبي: أثر العميل + أثر الأرباح والخسائر = الأساس الموقع
    expect(fx.customerSignedEffect + fx.profitLossSignedEffect).toBe(1000);
  });
});

describe('computeMovementEffects — الحالة 2: العمولة لي', () => {
  // عليه 1000 + عمولة 50 لي ⇒ العميل عليه 1050 والأرباح والخسائر له 50
  it('عليه 1000 + عمولة 50 لي', () => {
    const fx = computeMovementEffects({
      movementType: 'outgoing',
      baseAmount: 1000,
      commissionAmount: 50,
      commissionOwner: 'current_user',
    });
    expect(fx.valid).toBe(true);
    expect(fx.customerTotalAmount).toBe(1050);
    expect(fx.customerType).toBe('outgoing');
    expect(fx.profitLossAmount).toBe(50);
    expect(fx.profitLossType).toBe('incoming'); // ربح
    expect(fx.profitLossSignedEffect).toBe(50);
    expect(fx.customerSignedEffect + fx.profitLossSignedEffect).toBe(-1000);
  });
});

describe('computeMovementEffects — الحالات المتقاطعة', () => {
  // له 1000 + عمولة 50 لي ⇒ نستقطعها من مستحق العميل: له 950 وربح 50
  it('له 1000 + عمولة 50 لي', () => {
    const fx = computeMovementEffects({
      movementType: 'incoming',
      baseAmount: 1000,
      commissionAmount: 50,
      commissionOwner: 'current_user',
    });
    expect(fx.valid).toBe(true);
    expect(fx.customerTotalAmount).toBe(950);
    expect(fx.customerType).toBe('incoming');
    expect(fx.profitLossSignedEffect).toBe(50);
    expect(fx.customerSignedEffect + fx.profitLossSignedEffect).toBe(1000);
  });

  // عليه 1000 + عمولة 50 للعميل ⇒ يخصم من التزامه: عليه 950 ومصروف 50
  it('عليه 1000 + عمولة 50 للعميل', () => {
    const fx = computeMovementEffects({
      movementType: 'outgoing',
      baseAmount: 1000,
      commissionAmount: 50,
      commissionOwner: 'account_owner',
    });
    expect(fx.valid).toBe(true);
    expect(fx.customerTotalAmount).toBe(950);
    expect(fx.customerType).toBe('outgoing');
    expect(fx.profitLossSignedEffect).toBe(-50);
    expect(fx.customerSignedEffect + fx.profitLossSignedEffect).toBe(-1000);
  });
});

describe('computeMovementEffects — الحسابات المرتبطة (مثال التحقق الأساسي)', () => {
  it('العمولة للطرف الآخر: له 1050 عندي وعليه 1050 عنده وقيدا أرباح متعاكسان', () => {
    const fx = computeMovementEffects({
      movementType: 'incoming',
      baseAmount: 1000,
      commissionAmount: 50,
      commissionOwner: 'account_owner',
    });
    // الطرف الأول
    expect(fx.customerSignedEffect).toBe(1050);
    expect(fx.profitLossSignedEffect).toBe(-50);
    // الطرف الثاني (المرآة)
    expect(fx.mirrorCustomerType).toBe('outgoing');
    expect(fx.mirrorCustomerSignedEffect).toBe(-1050);
    expect(fx.mirrorProfitLossType).toBe('incoming');
    expect(fx.mirrorProfitLossSignedEffect).toBe(50);
    expect(fx.mirrorCommissionOwner).toBe('current_user');
    // متوازن من الجهتين
    expect(fx.customerSignedEffect + fx.mirrorCustomerSignedEffect).toBe(0);
    expect(fx.profitLossSignedEffect + fx.mirrorProfitLossSignedEffect).toBe(0);
  });

  it('العمولة لي: عليه 1050 عندي وله 1050 عنده', () => {
    const fx = computeMovementEffects({
      movementType: 'outgoing',
      baseAmount: 1000,
      commissionAmount: 50,
      commissionOwner: 'current_user',
    });
    expect(fx.customerSignedEffect).toBe(-1050);
    expect(fx.profitLossSignedEffect).toBe(50);
    expect(fx.mirrorCustomerSignedEffect).toBe(1050);
    expect(fx.mirrorProfitLossSignedEffect).toBe(-50);
    expect(fx.mirrorCommissionOwner).toBe('account_owner');
  });
});

describe('computeMovementEffects — التحقق من المدخلات', () => {
  it('يرفض عمولة سالبة', () => {
    const fx = computeMovementEffects({
      movementType: 'incoming',
      baseAmount: 1000,
      commissionAmount: -5,
      commissionOwner: 'current_user',
    });
    expect(fx.valid).toBe(false);
  });

  it('يرفض عمولة بدون صاحب', () => {
    const fx = computeMovementEffects({
      movementType: 'incoming',
      baseAmount: 1000,
      commissionAmount: 50,
      commissionOwner: null,
    });
    expect(fx.valid).toBe(false);
  });

  it('يرفض مبلغاً أساسياً صفرياً', () => {
    const fx = computeMovementEffects({ movementType: 'incoming', baseAmount: 0 });
    expect(fx.valid).toBe(false);
  });

  it('يرفض عمولة تلغي اتجاه الحركة (متقاطعة ≥ الأساس)', () => {
    const equal = computeMovementEffects({
      movementType: 'incoming',
      baseAmount: 1000,
      commissionAmount: 1000,
      commissionOwner: 'current_user',
    });
    expect(equal.valid).toBe(false);

    const flipped = computeMovementEffects({
      movementType: 'outgoing',
      baseAmount: 100,
      commissionAmount: 150,
      commissionOwner: 'account_owner',
    });
    expect(flipped.valid).toBe(false);
  });

  it('العمولة الصفرية تعامل كأنها بدون عمولة', () => {
    const fx = computeMovementEffects({
      movementType: 'incoming',
      baseAmount: 1000,
      commissionAmount: 0,
      commissionOwner: 'current_user',
    });
    expect(fx.valid).toBe(true);
    expect(fx.customerTotalAmount).toBe(1000);
    expect(fx.profitLossAmount).toBe(0);
    expect(fx.commissionOwner).toBeNull();
  });
});

describe('getMovementDisplayParts', () => {
  it('حركة جديدة: amount هو الإجمالي والتفصيل من الأعمدة الجديدة', () => {
    const parts = getMovementDisplayParts({
      id: 'a',
      customer_id: 'c1',
      movement_type: 'incoming',
      amount: 1050,
      currency: 'USD',
      base_amount: 1000,
      commission_amount: 50,
      commission_owner: 'account_owner',
    });
    expect(parts.totalAmount).toBe(1050);
    expect(parts.baseAmount).toBe(1000);
    expect(parts.commissionAmount).toBe(50);
    expect(parts.commissionOwner).toBe('account_owner');
    expect(parts.hasCommission).toBe(true);
    expect(parts.isLegacyCommission).toBe(false);
  });

  it('حركة قديمة: تجمع صفوف العمولة المنفصلة المرتبطة بها', () => {
    const base = {
      id: 'a',
      customer_id: 'c1',
      movement_type: 'incoming' as const,
      amount: 1000,
      currency: 'USD',
    };
    const legacyCommission = {
      id: 'b',
      customer_id: 'c1',
      movement_type: 'incoming' as const,
      amount: 50,
      currency: 'USD',
      is_commission_movement: true,
      related_commission_movement_id: 'a',
    };
    const parts = getMovementDisplayParts(base, [base, legacyCommission]);
    expect(parts.totalAmount).toBe(1050);
    expect(parts.baseAmount).toBe(1000);
    expect(parts.commissionAmount).toBe(50);
    expect(parts.hasCommission).toBe(true);
    expect(parts.isLegacyCommission).toBe(true);
  });

  it('قيود الأرباح والخسائر الجديدة (على حساب آخر) لا تُجمع مع الحركة الأم', () => {
    const base = {
      id: 'a',
      customer_id: 'c1',
      movement_type: 'incoming' as const,
      amount: 1050,
      currency: 'USD',
      base_amount: 1000,
      commission_amount: 50,
      commission_owner: 'account_owner',
    };
    const plEntry = {
      id: 'pl',
      customer_id: 'profit-loss-account',
      movement_type: 'outgoing' as const,
      amount: 50,
      currency: 'USD',
      is_commission_movement: true,
      related_commission_movement_id: 'a',
    };
    const parts = getMovementDisplayParts(base, [base, plEntry]);
    // الإجمالي يبقى 1050 — لا يضاف قيد الأرباح والخسائر مرة ثانية
    expect(parts.totalAmount).toBe(1050);
    expect(parts.commissionAmount).toBe(50);
  });

  it('حركة بدون عمولة تبقى كما هي', () => {
    const parts = getMovementDisplayParts({
      id: 'a',
      customer_id: 'c1',
      movement_type: 'outgoing',
      amount: 700,
      currency: 'USD',
    });
    expect(parts.totalAmount).toBe(700);
    expect(parts.baseAmount).toBe(700);
    expect(parts.commissionAmount).toBe(0);
    expect(parts.hasCommission).toBe(false);
  });
});
