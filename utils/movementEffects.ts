/**
 * النموذج المحاسبي المركزي للحركات والعمولات.
 *
 * القاعدة الموقعة (نفس منطق دالة create_movement_with_commission في القاعدة):
 *   - 'incoming' = له  (رصيد العميل +)، 'outgoing' = عليه (رصيد العميل -)
 *   - أثر العمولة على حساب العميل: + عندما تكون العمولة للعميل (account_owner)
 *     و - عندما تكون لصاحب الدفتر (current_user)
 *   - إجمالي العميل = |الأساس الموقع + العمولة الموقعة| مع اتجاه المجموع
 *   - قيد الأرباح والخسائر = قيمة العمولة فقط:
 *     'incoming' (ربح) عندما تكون العمولة لصاحب الدفتر،
 *     'outgoing' (مصروف) عندما تكون العمولة للعميل
 *   - الثابت: أثر العميل + أثر الأرباح والخسائر = الأساس الموقع
 *
 * قاعدة البيانات تبقى المصدر النهائي للحقيقة؛ هذا الملف للمعاينة والعرض
 * والتقارير فقط ويجب أن يبقى مطابقاً لمنطق الـ RPC.
 */

export type MovementDirection = 'incoming' | 'outgoing';
export type CommissionOwner = 'account_owner' | 'current_user';

export interface MovementEffectsInput {
  movementType: MovementDirection;
  baseAmount: number;
  commissionAmount?: number | null;
  commissionOwner?: CommissionOwner | null;
}

export interface MovementEffects {
  valid: boolean;
  error?: string;
  baseAmount: number;
  commissionAmount: number;
  commissionOwner: CommissionOwner | null;
  /** إجمالي الحركة على حساب العميل (قيمة موجبة) */
  customerTotalAmount: number;
  /** اتجاه حركة العميل بعد دمج العمولة */
  customerType: MovementDirection;
  /** الأثر الموقع على رصيد العميل (+ له / - عليه) */
  customerSignedEffect: number;
  /** قيمة قيد الأرباح والخسائر (صفر بدون عمولة) */
  profitLossAmount: number;
  /** اتجاه قيد الأرباح والخسائر لصاحب الدفتر (null بدون عمولة) */
  profitLossType: MovementDirection | null;
  /** الأثر الموقع على الأرباح والخسائر (+ ربح / - مصروف) */
  profitLossSignedEffect: number;
  /** اتجاه حركة المرآة لدى الطرف الآخر */
  mirrorCustomerType: MovementDirection;
  /** أثر المرآة الموقع لدى الطرف الآخر */
  mirrorCustomerSignedEffect: number;
  /** اتجاه قيد الأرباح والخسائر لدى الطرف الآخر */
  mirrorProfitLossType: MovementDirection | null;
  /** الأثر الموقع على أرباح وخسائر الطرف الآخر */
  mirrorProfitLossSignedEffect: number;
  /** صاحب العمولة كما يُخزَّن على صف المرآة (منظور الطرف الآخر) */
  mirrorCommissionOwner: CommissionOwner | null;
}

const flipDirection = (direction: MovementDirection): MovementDirection =>
  direction === 'incoming' ? 'outgoing' : 'incoming';

const flipOwner = (owner: CommissionOwner): CommissionOwner =>
  owner === 'account_owner' ? 'current_user' : 'account_owner';

export function computeMovementEffects(input: MovementEffectsInput): MovementEffects {
  const baseAmount = Number(input.baseAmount) || 0;
  const commissionAmount = Number(input.commissionAmount) || 0;
  const commissionOwner = commissionAmount > 0 ? input.commissionOwner || null : null;

  const invalid = (error: string): MovementEffects => ({
    valid: false,
    error,
    baseAmount,
    commissionAmount,
    commissionOwner,
    customerTotalAmount: 0,
    customerType: input.movementType,
    customerSignedEffect: 0,
    profitLossAmount: 0,
    profitLossType: null,
    profitLossSignedEffect: 0,
    mirrorCustomerType: flipDirection(input.movementType),
    mirrorCustomerSignedEffect: 0,
    mirrorProfitLossType: null,
    mirrorProfitLossSignedEffect: 0,
    mirrorCommissionOwner: null,
  });

  if (!input.movementType) {
    return invalid('نوع الحركة مطلوب');
  }

  if (!(baseAmount > 0)) {
    return invalid('المبلغ الأساسي يجب أن يكون أكبر من صفر');
  }

  if ((Number(input.commissionAmount) || 0) < 0) {
    return invalid('قيمة العمولة لا يمكن أن تكون سالبة');
  }

  if (commissionAmount > 0 && !commissionOwner) {
    return invalid('يجب تحديد صاحب العمولة');
  }

  const baseSigned = input.movementType === 'incoming' ? baseAmount : -baseAmount;
  const commissionSigned =
    commissionAmount === 0 ? 0 : commissionOwner === 'account_owner' ? commissionAmount : -commissionAmount;
  const totalSigned = baseSigned + commissionSigned;

  if (commissionAmount > 0 && (totalSigned === 0 || Math.sign(totalSigned) !== Math.sign(baseSigned))) {
    return invalid('قيمة العمولة تلغي أو تعكس اتجاه الحركة الأساسية — راجع المبلغ أو صاحب العمولة');
  }

  const customerType: MovementDirection = totalSigned >= 0 ? 'incoming' : 'outgoing';
  const profitLossType: MovementDirection | null =
    commissionAmount > 0 ? (commissionOwner === 'current_user' ? 'incoming' : 'outgoing') : null;
  const profitLossSignedEffect =
    profitLossType === null ? 0 : profitLossType === 'incoming' ? commissionAmount : -commissionAmount;

  return {
    valid: true,
    baseAmount,
    commissionAmount,
    commissionOwner,
    customerTotalAmount: Math.abs(totalSigned),
    customerType,
    customerSignedEffect: totalSigned,
    profitLossAmount: commissionAmount,
    profitLossType,
    profitLossSignedEffect,
    mirrorCustomerType: flipDirection(customerType),
    mirrorCustomerSignedEffect: -totalSigned,
    mirrorProfitLossType: profitLossType === null ? null : flipDirection(profitLossType),
    mirrorProfitLossSignedEffect: -profitLossSignedEffect,
    mirrorCommissionOwner: commissionOwner === null ? null : flipOwner(commissionOwner),
  };
}

export interface MovementLike {
  id?: string;
  customer_id?: string;
  movement_type?: string;
  amount?: number | string;
  currency?: string;
  base_amount?: number | string | null;
  commission_amount?: number | string | null;
  commission_owner?: string | null;
  operation_group_id?: string | null;
  is_commission_movement?: boolean;
  related_commission_movement_id?: string | null;
}

export interface MovementDisplayParts {
  /** إجمالي الحركة على العميل (ما يدخل في الرصيد) */
  totalAmount: number;
  /** المبلغ الأساسي قبل العمولة */
  baseAmount: number;
  /** قيمة العمولة (صفر إن لم توجد) */
  commissionAmount: number;
  commissionOwner: CommissionOwner | null;
  hasCommission: boolean;
  /** true عندما تأتي العمولة من صفوف النظام القديم المنفصلة */
  isLegacyCommission: boolean;
}

/**
 * تفكيك حركة للعرض: الحركات الجديدة تخزّن الإجمالي في amount مع
 * base_amount/commission_amount، والحركات القديمة تُجمَع مع صفوف العمولة
 * المنفصلة المرتبطة بها (نفس منطق getCombinedAmount التاريخي).
 */
export function getMovementDisplayParts(
  movement: MovementLike,
  allMovements: MovementLike[] = [],
): MovementDisplayParts {
  const amount = Number(movement.amount) || 0;
  const commissionAmount = Number(movement.commission_amount) || 0;

  if (commissionAmount > 0) {
    const owner =
      movement.commission_owner === 'account_owner' || movement.commission_owner === 'current_user'
        ? movement.commission_owner
        : null;
    const baseAmount = Number(movement.base_amount) || 0;

    return {
      totalAmount: amount,
      baseAmount: baseAmount > 0 ? baseAmount : amount,
      commissionAmount,
      commissionOwner: owner,
      hasCommission: true,
      isLegacyCommission: false,
    };
  }

  const legacyCommission = allMovements
    .filter(
      (item) =>
        item.is_commission_movement === true &&
        item.related_commission_movement_id === movement.id &&
        item.customer_id === movement.customer_id &&
        item.movement_type === movement.movement_type &&
        item.currency === movement.currency,
    )
    .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

  return {
    totalAmount: amount + legacyCommission,
    baseAmount: amount,
    commissionAmount: legacyCommission,
    commissionOwner: null,
    hasCommission: legacyCommission > 0,
    isLegacyCommission: legacyCommission > 0,
  };
}

export function getCommissionOwnerLabel(owner: CommissionOwner | null | undefined): string {
  if (owner === 'account_owner') return 'العمولة للعميل';
  if (owner === 'current_user') return 'العمولة لي';
  return '';
}

export function getProfitLossEffectLabel(type: MovementDirection | null | undefined): string {
  if (type === 'incoming') return 'ربح (له)';
  if (type === 'outgoing') return 'مصروف (عليه)';
  return '';
}
