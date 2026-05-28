export type NumericValidationOptions = {
  allowDecimal?: boolean;
  allowNegative?: boolean;
  allowZero?: boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  exactLength?: number;
  required?: boolean;
};

export type NumericValidationResult = {
  isValid: boolean;
  error: string | null;
  cleanedValue: string;
};

const ARABIC_INDIC_DIGITS: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '،': '.', '٫': '.', ',': '.',
};

export function normalizeNumericInput(value: string): string {
  if (!value) return '';
  let result = '';
  for (const char of value) {
    result += ARABIC_INDIC_DIGITS[char] ?? char;
  }
  return result;
}

export function validateNumericInput(
  rawValue: string,
  options: NumericValidationOptions = {}
): NumericValidationResult {
  const {
    allowDecimal = false,
    allowNegative = false,
    allowZero = true,
    min,
    max,
    maxLength,
    exactLength,
    required = false,
  } = options;

  const value = normalizeNumericInput(rawValue).trim();

  if (!value) {
    if (required) {
      return { isValid: false, error: 'هذا الحقل مطلوب', cleanedValue: '' };
    }
    return { isValid: true, error: null, cleanedValue: '' };
  }

  const allowedCharsPattern = allowDecimal
    ? allowNegative
      ? /^-?\d*\.?\d*$/
      : /^\d*\.?\d*$/
    : allowNegative
      ? /^-?\d*$/
      : /^\d*$/;

  if (!allowedCharsPattern.test(value)) {
    if (allowDecimal) {
      return {
        isValid: false,
        error: 'يُسمح بإدخال الأرقام والفاصلة العشرية فقط',
        cleanedValue: value,
      };
    }
    return {
      isValid: false,
      error: 'يُسمح بإدخال الأرقام فقط',
      cleanedValue: value,
    };
  }

  if (value === '.' || value === '-' || value === '-.') {
    return {
      isValid: false,
      error: 'صيغة الرقم غير صحيحة',
      cleanedValue: value,
    };
  }

  const dotCount = (value.match(/\./g) || []).length;
  if (dotCount > 1) {
    return {
      isValid: false,
      error: 'لا يمكن وضع أكثر من فاصلة عشرية',
      cleanedValue: value,
    };
  }

  const numericValue = parseFloat(value);
  if (Number.isNaN(numericValue)) {
    return {
      isValid: false,
      error: 'صيغة الرقم غير صحيحة',
      cleanedValue: value,
    };
  }

  if (!allowZero && numericValue === 0) {
    return {
      isValid: false,
      error: 'يجب أن يكون الرقم أكبر من صفر',
      cleanedValue: value,
    };
  }

  if (!allowNegative && numericValue < 0) {
    return {
      isValid: false,
      error: 'لا يُسمح بالأرقام السالبة',
      cleanedValue: value,
    };
  }

  if (typeof min === 'number' && numericValue < min) {
    return {
      isValid: false,
      error: `الحد الأدنى هو ${min}`,
      cleanedValue: value,
    };
  }

  if (typeof max === 'number' && numericValue > max) {
    return {
      isValid: false,
      error: `الحد الأقصى هو ${max}`,
      cleanedValue: value,
    };
  }

  const lengthValue = value.replace(/^-/, '');
  if (typeof exactLength === 'number' && lengthValue.length !== exactLength) {
    return {
      isValid: false,
      error: `يجب أن يكون الرقم ${exactLength} خانات`,
      cleanedValue: value,
    };
  }

  if (typeof maxLength === 'number' && lengthValue.length > maxLength) {
    return {
      isValid: false,
      error: `الحد الأقصى ${maxLength} خانة`,
      cleanedValue: value,
    };
  }

  return { isValid: true, error: null, cleanedValue: value };
}
