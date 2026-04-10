# نظام التحديث التلقائي للأرقام

## نظرة عامة

تم إضافة نظام تحديث تلقائي شامل يضمن تحديث جميع الأرقام والبيانات في التطبيق فوراً بعد أي إضافة أو تعديل أو حذف للحركات المالية، دون الحاجة لإعادة تحميل الصفحة أو السحب للتحديث يدوياً.

## آلية العمل

### 1. نظام Realtime من Supabase
تم تفعيل Realtime subscriptions على الجداول التالية:
- `account_movements` - الحركات المالية
- `customers` - العملاء
- `transactions` - المعاملات

عندما يحدث أي تغيير (INSERT, UPDATE, DELETE) في أي من هذه الجداول، يرسل Supabase إشعاراً فورياً للتطبيق.

### 2. DataRefreshContext
تم إنشاء Context مركزي يدير جميع التحديثات في التطبيق:

**الموقع:** `contexts/DataRefreshContext.tsx`

**المميزات:**
- يستمع لجميع التغييرات من Supabase Realtime
- يحتفظ بوقت آخر تحديث (`lastRefreshTime`)
- يوفر دالة `triggerRefresh()` لإطلاق التحديث يدوياً عند الحاجة
- يدعم أنواع التحديث المختلفة: movements, customers, all

**طريقة الاستخدام:**
```typescript
import { useDataRefresh } from '@/contexts/DataRefreshContext';

function MyComponent() {
  const { lastRefreshTime, triggerRefresh } = useDataRefresh();

  // الاستماع للتحديثات التلقائية
  useEffect(() => {
    if (!isLoading) {
      console.log('Auto-refreshing due to data change');
      loadData();
    }
  }, [lastRefreshTime]);

  // إطلاق تحديث يدوي بعد حفظ البيانات
  triggerRefresh('movements');
}
```

## الصفحات المحدثة

### 1. صفحة تفاصيل العميل (`app/customer-details.tsx`)
- تتحدث تلقائياً عند أي تغيير في الحركات المالية
- تعرض الأرصدة المحدثة فوراً
- تحدّث قائمة الحركات بدون تأخير

### 2. صفحة الإحصائيات (`app/statistics.tsx`)
- تتحدث جميع الإحصائيات فوراً
- تحديث التدفق النقدي، الديون، العمولات
- تحديث قائمة أكثر العملاء نشاطاً

### 3. صفحة قائمة العملاء (`app/(tabs)/customers.tsx`)
- تحديث أرصدة جميع العملاء فوراً
- عرض البيانات الأحدث دائماً

### 4. صفحة إضافة حركة (`app/new-movement.tsx`)
- تطلق تحديثاً تلقائياً بعد حفظ الحركة
- جميع الشاشات الأخرى تتحدث فوراً

### 5. صفحة تعديل حركة (`app/edit-movement.tsx`)
- تطلق تحديثاً بعد حفظ التعديلات
- تحديث فوري لجميع الشاشات المعتمدة على هذه الحركة

### 6. مكون QuickAddMovementSheet (`components/QuickAddMovementSheet.tsx`)
- تحديث فوري بعد إضافة حركة سريعة
- التحديث يظهر في صفحة تفاصيل العميل والإحصائيات

## Migration للقاعدة

تم تطبيق migration لتفعيل Realtime:

**الملف:** `20260104000000_enable_realtime_for_auto_refresh.sql`

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE account_movements;
ALTER PUBLICATION supabase_realtime ADD TABLE customers;
ALTER PUBLICATION supabase_realtime ADD TABLE transactions;
```

## الفوائد

✅ **تحديث فوري:** جميع الأرقام تتحدث لحظياً بدون تأخير

✅ **تجربة مستخدم أفضل:** لا حاجة للسحب للتحديث أو إعادة تحميل الصفحة

✅ **بيانات دقيقة دائماً:** القراءات والأرصدة دائماً محدثة

✅ **دعم تعدد المستخدمين:** إذا أضاف مستخدم آخر حركة، ستظهر فوراً لجميع المستخدمين

✅ **أداء ممتاز:** التحديثات تحدث في الخلفية بدون حجب الواجهة

## الاختبار

للتأكد من عمل النظام بشكل صحيح:

1. **افتح صفحة تفاصيل عميل**
2. **أضف حركة مالية جديدة** من زر "+"
3. **احفظ الحركة**
4. **لاحظ:** الأرقام في صفحة التفاصيل تتحدث فوراً
5. **ارجع لصفحة قائمة العملاء:** الأرصدة محدثة
6. **افتح صفحة الإحصائيات:** جميع الأرقام محدثة

## ملاحظات تقنية

- النظام يعمل في الخلفية بدون تأثير على أداء التطبيق
- يتم debouncing للتحديثات المتتالية لتجنب التحديثات المتكررة
- التحديثات صامتة ولا تظهر مؤشرات تحميل مزعجة
- في حالة فشل الاتصال، يعود النظام للتحديث اليدوي (السحب للتحديث)

## التكامل مع الكود الموجود

تم التأكد من عدم التأثير على أي وظيفة موجودة:
- دالة `onSuccess()` لا تزال تعمل كما هي
- السحب للتحديث (Pull to Refresh) لا يزال يعمل
- `useFocusEffect` لا يزال يعمل عند العودة للشاشة

## الصيانة المستقبلية

لإضافة شاشة جديدة للنظام:

1. استيراد `useDataRefresh`:
```typescript
import { useDataRefresh } from '@/contexts/DataRefreshContext';
```

2. استخدام Hook:
```typescript
const { lastRefreshTime } = useDataRefresh();
```

3. إضافة useEffect للاستماع:
```typescript
useEffect(() => {
  if (!isLoading) {
    loadData();
  }
}, [lastRefreshTime]);
```

4. عند حفظ بيانات جديدة:
```typescript
const { triggerRefresh } = useDataRefresh();
// بعد الحفظ الناجح
triggerRefresh('movements');
```

---

**تم التنفيذ بتاريخ:** 4 يناير 2026
**الإصدار:** 1.0
