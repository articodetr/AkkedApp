# معيار عرض الأرصدة الموحد

## المبدأ الأساسي

تم توحيد طريقة عرض حالة العملاء في جميع أنحاء التطبيق لتكون متسقة وواضحة.

## القاعدة الموحدة

### الرصيد الموجب (+)
- **اللون**: أخضر (#10B981)
- **النص**: "له عندنا" أو "له"
- **المعنى**: العميل له رصيد موجب عندنا (نحن مدينون له)

### الرصيد السالب (-)
- **اللون**: أحمر (#EF4444)
- **النص**: "لنا عنده" أو "عليه"
- **المعنى**: العميل عليه رصيد سالب (هو مدين لنا)

### الرصيد الصفر (0)
- **اللون**: رمادي (#6B7280)
- **النص**: "متساوي" أو "صفر"
- **المعنى**: الحساب متساوي

## الملفات المتأثرة

تم تطبيق هذا المعيار في:

1. **app/(tabs)/customers.tsx** - قائمة العملاء
2. **app/customer-details.tsx** - تفاصيل العميل
3. **components/QuickAddMovementSheet.tsx** - معاينة الرصيد الجديد

## أمثلة الاستخدام

### في قائمة العملاء
```typescript
<Text style={{ color: balanceAmount > 0 ? '#10B981' : '#EF4444' }}>
  {balanceAmount > 0
    ? `+${Math.round(balanceAmount)}`
    : `${Math.round(balanceAmount)}`
  } {getCurrencySymbol(balance.currency)}
</Text>
```

### في تفاصيل العميل
```typescript
{currBalance.balance > 0 ? (
  <Text style={styles.summaryLineGreen}>
    {customer.name} له عندنا{' '}
    <Text style={styles.summaryAmountGreen}>
      {Math.round(currBalance.balance)} {getCurrencySymbol(currBalance.currency)}
    </Text>
  </Text>
) : (
  <Text style={styles.summaryLineRed}>
    لنا عند {customer.name}{' '}
    <Text style={styles.summaryAmountRed}>
      {Math.round(Math.abs(currBalance.balance))} {getCurrencySymbol(currBalance.currency)}
    </Text>
  </Text>
)}
```

### في معاينة الرصيد
```typescript
{ color: newBalance > 0 ? '#10B981' : newBalance < 0 ? '#EF4444' : '#6B7280' }
```

## ملاحظات مهمة

1. **لا تعكس المنطق**: الرصيد الموجب دائماً أخضر، والرصيد السالب دائماً أحمر
2. **استخدم نفس المصطلحات**: "له عندنا" للموجب و "لنا عنده" للسالب
3. **كن متسقاً**: تأكد من تطبيق نفس المنطق في أي صفحة أو مكون جديد

## تاريخ التحديث

آخر تحديث: 2026-01-10
