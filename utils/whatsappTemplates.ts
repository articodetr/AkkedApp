import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { supabase } from '@/lib/supabase';

export interface TemplateVariables {
  customer_name?: string;
  account_number?: string;
  date?: string;
  balance?: string;
  balances?: string;
  movements?: string;
  shop_name?: string;
}

export interface WhatsAppTemplates {
  account_statement: string;
  share_account: string;
}

const DEFAULT_TEMPLATES: WhatsAppTemplates = {
  account_statement: `مرحباً {customer_name}،

كشف حساب رقم: {account_number}
التاريخ: {date}

الأرصدة:
{balance}

شكراً لك`,
  share_account: `مرحباً {customer_name}،

كشف حساب تفصيلي
رقم الحساب: {account_number}
التاريخ: {date}

{balances}

الحركات المالية:
{movements}

{shop_name}`,
};

/**
 * Fetch WhatsApp templates from database
 */
export async function fetchWhatsAppTemplates(): Promise<WhatsAppTemplates> {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('whatsapp_account_statement_template, whatsapp_share_account_template')
      .maybeSingle();

    if (error || !data) {
      return DEFAULT_TEMPLATES;
    }

    return {
      account_statement:
        data.whatsapp_account_statement_template || DEFAULT_TEMPLATES.account_statement,
      share_account:
        data.whatsapp_share_account_template || DEFAULT_TEMPLATES.share_account,
    };
  } catch (error) {
    console.error('Error fetching WhatsApp templates:', error);
    return DEFAULT_TEMPLATES;
  }
}

/**
 * Replace template variables with actual values
 */
export function replaceTemplateVariables(
  template: string,
  variables: TemplateVariables
): string {
  let result = template;

  Object.entries(variables).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      const placeholder = `{${key}}`;
      result = result.replace(new RegExp(placeholder, 'g'), value);
    }
  });

  return result;
}

/**
 * Format balances for display in WhatsApp message
 */
export function formatBalancesForWhatsApp(
  balances: Array<{ currency: string; balance: number }>
): string {
  if (balances.length === 0) {
    return 'لا توجد أرصدة';
  }

  return balances
    .map((item) => {
      const balanceValue = Number(item.balance);
      const direction = balanceValue > 0 ? 'له' : balanceValue < 0 ? 'عليه' : '';
      const absBalance = Math.abs(balanceValue).toFixed(2);

      return `${item.currency}: ${absBalance} ${direction}`;
    })
    .join('\n');
}

/**
 * Format movements for display in WhatsApp message
 */
export function formatMovementsForWhatsApp(
  movements: Array<{
    created_at: string;
    movement_type: string;
    amount: number;
    currency: string;
    notes?: string;
  }>
): string {
  if (movements.length === 0) {
    return 'لا توجد حركات';
  }

  return movements
    .map((movement, index) => {
      const date = format(new Date(movement.created_at), 'dd/MM/yyyy', { locale: ar });
      const type = movement.movement_type === 'incoming' ? 'وارد' : 'صادر';
      const amount = Number(movement.amount).toFixed(2);
      const notes = movement.notes ? `\n  الملاحظات: ${movement.notes}` : '';

      return `${index + 1}. ${date} - ${type}: ${amount} ${movement.currency}${notes}`;
    })
    .join('\n\n');
}

/**
 * Get current date formatted in Arabic
 */
export function getFormattedDate(): string {
  return format(new Date(), 'dd MMMM yyyy', { locale: ar });
}

/**
 * Validate template for required variables
 */
export function validateTemplate(template: string, requiredVariables: string[]): boolean {
  return requiredVariables.every((variable) => template.includes(`{${variable}}`));
}

/**
 * Get available variables for account statement template
 */
export function getAccountStatementVariables(): Array<{ key: string; description: string; example: string }> {
  return [
    { key: '{customer_name}', description: 'اسم العميل', example: 'محمد أحمد' },
    { key: '{account_number}', description: 'رقم الحساب', example: 'A-001' },
    { key: '{date}', description: 'التاريخ الحالي', example: '21 يناير 2026' },
    { key: '{balance}', description: 'الأرصدة بجميع العملات', example: 'USD: 1000.00 له\nYER: 500.00 عليه' },
  ];
}

/**
 * Get available variables for share account template
 */
export function getShareAccountVariables(): Array<{ key: string; description: string; example: string }> {
  return [
    { key: '{customer_name}', description: 'اسم العميل', example: 'محمد أحمد' },
    { key: '{account_number}', description: 'رقم الحساب', example: 'A-001' },
    { key: '{date}', description: 'التاريخ الحالي', example: '21 يناير 2026' },
    { key: '{balances}', description: 'الأرصدة التفصيلية', example: 'USD: 1000.00 له\nYER: 500.00 عليه' },
    { key: '{movements}', description: 'قائمة الحركات المالية', example: '1. 20/01/2026 - وارد: 500.00 USD' },
    { key: '{shop_name}', description: 'اسم المحل', example: 'محل الصرافة' },
  ];
}

/**
 * Generate preview message with sample data
 */
export function generatePreviewMessage(
  template: string,
  templateType: 'account_statement' | 'share_account'
): string {
  const sampleVariables: TemplateVariables = {
    customer_name: 'محمد أحمد',
    account_number: 'A-001',
    date: getFormattedDate(),
    balance: 'USD: 1000.00 له\nYER: 250000.00 له',
    balances: 'USD: 1000.00 له\nYER: 250000.00 له\nSAR: 500.00 عليه',
    movements: '1. 20/01/2026 - وارد: 500.00 USD\n  الملاحظات: دفعة أولى\n\n2. 19/01/2026 - صادر: 100000.00 YER',
    shop_name: 'محل الصرافة - الطرف للحوالات المالية',
  };

  return replaceTemplateVariables(template, sampleVariables);
}
