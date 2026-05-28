export const ARABIC_CURRENCY_NAMES: Record<string, string> = {
  USD: 'دولار',
  SAR: 'ريال سعودي',
  TRY: 'ليرة تركية',
  YER: 'ريال يمني',
};

export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  SAR: 'ر.س',
  TRY: '₺',
  YER: 'ر.ي',
};

export function formatSmartNumber(value: number | string | null | undefined) {
  const numberValue = Number(value ?? 0);

  if (!Number.isFinite(numberValue)) {
    return '0';
  }

  return numberValue.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 20,
  });
}

export function formatCompactNumber(value: number | string | null | undefined) {
  const numberValue = Number(value ?? 0);

  if (!Number.isFinite(numberValue)) {
    return '0';
  }

  return numberValue.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

const ARABIC_TO_LATIN_DIGITS: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٫': '.', '،': '',
};

export function sanitizeAmountInput(text: string): string {
  if (!text) return '';

  let normalized = '';
  for (const ch of text) {
    normalized += ARABIC_TO_LATIN_DIGITS[ch] ?? ch;
  }

  normalized = normalized.replace(/[^0-9.]/g, '');

  const firstDot = normalized.indexOf('.');
  if (firstDot !== -1) {
    const integerPart = normalized.slice(0, firstDot);
    const decimalPart = normalized.slice(firstDot + 1).replace(/\./g, '');
    normalized = `${integerPart}.${decimalPart.slice(0, 2)}`;
  }

  return normalized;
}

export function isValidAmount(value: string | number | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const trimmed = String(value).trim();
  if (trimmed === '' || trimmed === '.') return false;
  const num = Number(trimmed);
  return Number.isFinite(num) && num >= 0;
}

export function getCurrencySymbol(currency?: string | null) {
  const key = String(currency || 'USD').toUpperCase();
  return CURRENCY_SYMBOLS[key] || key;
}

export function getArabicCurrencyName(currency?: string | null) {
  const key = String(currency || 'USD').toUpperCase();
  return ARABIC_CURRENCY_NAMES[key] || key;
}

export function formatAmountArabic(
  amount: number | string | null | undefined,
  currency?: string | null,
) {
  const numericAmount = Number(amount ?? 0);

  if (!Number.isFinite(numericAmount)) {
    return `0 ${getCurrencySymbol(currency)}`;
  }

  const sign = numericAmount < 0 ? '-' : '';
  return `${sign}${formatSmartNumber(Math.abs(numericAmount))} ${getCurrencySymbol(currency)}`;
}

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

export function formatDateTimeArabic(value: Date | string | number | null | undefined) {
  if (!value) return '';

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const day = pad2(date.getDate());
  const month = pad2(date.getMonth() + 1);
  const year = date.getFullYear();

  const hours24 = date.getHours();
  const period = hours24 >= 12 ? 'م' : 'ص';
  const hours12 = hours24 % 12 || 12;
  const minutes = pad2(date.getMinutes());

  return `${day}/${month}/${year} - ${pad2(hours12)}:${minutes} ${period}`;
}

export function formatDateArabic(value: Date | string | number | null | undefined) {
  if (!value) return '';

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
}

// أسماء مختصرة موحَّدة لاستخدامها في الواجهة
export const formatAmount = formatAmountArabic;
export const formatDateTime = formatDateTimeArabic;
export const formatDate = formatDateArabic;
