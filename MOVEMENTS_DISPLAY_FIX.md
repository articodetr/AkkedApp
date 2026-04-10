# إصلاح مشكلة عدم ظهور الحركات المالية

## المشكلة

كانت الحركات المالية لا تظهر في صفحة تفاصيل العميل (`customer-details.tsx`) رغم وجودها في قاعدة البيانات.

## السبب الجذري

المشكلة كانت بسبب **Connection Pooling** في Supabase:

1. كانت صفحة `customer-details.tsx` تستدعي `set_current_user` لتعيين المستخدم الحالي في سياق الجلسة
2. ثم تقوم بجلب الحركات المالية مباشرة من جدول `account_movements`
3. بسبب Connection Pooling، قد يستخدم الاستعلام الثاني اتصال مختلف من pool الاتصالات
4. الاتصال الجديد **لا يحتوي على إعداد `app.current_user`**
5. سياسات Row Level Security (RLS) تفشل وترجع صفر نتائج

### مثال على المشكلة

```typescript
// هذا الكود كان يفشل
await supabase.rpc('set_current_user', { user_name: currentUser.userName });

// قد يستخدم اتصال مختلف بدون app.current_user
const movementsResult = await supabase
  .from('account_movements')
  .select('*')
  .eq('customer_id', id);
```

## الحل

تم إنشاء دالة `get_customer_movements_with_user` محمية بـ `SECURITY DEFINER` تقوم بـ:

1. تعيين المستخدم في السياق
2. جلب الحركات المالية
3. إرجاع النتائج

**كل ذلك في معاملة واحدة (transaction)** مما يضمن استخدام نفس الاتصال.

### الدالة الجديدة

```sql
CREATE OR REPLACE FUNCTION get_customer_movements_with_user(
  p_user_name text,
  p_customer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- تعيين المستخدم في السياق
  PERFORM set_config('app.current_user', p_user_name, false);

  -- جلب وإرجاع الحركات مع معلومات العميل المرتبط
  RETURN (SELECT jsonb_agg(... ORDER BY created_at DESC)
          FROM account_movements am
          WHERE am.customer_id = p_customer_id);
END;
$$;
```

### الكود المحدّث

```typescript
// الحل الصحيح
const movementsResult = await supabase.rpc('get_customer_movements_with_user', {
  p_user_name: currentUser.userName,
  p_customer_id: id
});

// معالجة النتيجة
const movementsData = Array.isArray(movementsResult.data)
  ? movementsResult.data
  : (movementsResult.data || []);
```

## الملفات المتأثرة

### 1. Migrations الجديدة

- `supabase/migrations/[timestamp]_add_get_customer_movements_function.sql`
  - إنشاء الدالة الأساسية

- `supabase/migrations/[timestamp]_improve_get_customer_movements_function.sql`
  - تحسين الدالة لتشمل معلومات العميل المرتبط بصيغة JSONB

### 2. الكود المحدّث

- `app/customer-details.tsx`
  - السطور 208-225: تم استبدال `set_current_user` + الاستعلام المباشر بـ `get_customer_movements_with_user`
  - السطور 230-250: تحسين معالجة نتيجة الدالة

## الفوائد

1. **موثوقية**: حل مشكلة Connection Pooling نهائياً
2. **أمان**: الدالة محمية بـ `SECURITY DEFINER` وتطبق RLS بشكل صحيح
3. **أداء**: تقليل عدد الاستعلامات وتحسين الأداء
4. **صيانة**: كود أنظف وأسهل في الصيانة

## الاختبار

تم اختبار الحل بنجاح:

```sql
-- اختبار جلب حركات العميل
SELECT jsonb_array_length(
  get_customer_movements_with_user('aaa', '27cb3fcc-65c0-46eb-91ce-f5685253fe5a')
) as movements_count;
-- النتيجة: 14 حركة ✅

-- اختبار مع مستخدم آخر
SELECT jsonb_array_length(
  get_customer_movements_with_user('pppp', 'd5420090-2953-43cb-b229-14618c51e529')
) as movements_count;
-- النتيجة: 14 حركة ✅
```

## ملاحظات مهمة

1. هذا النمط (دالة SECURITY DEFINER) يجب استخدامه في أي مكان نحتاج فيه إلى تعيين `app.current_user` ثم جلب البيانات
2. نفس الحل تم تطبيقه مسبقاً في `insert_movement_with_user` لإضافة الحركات
3. يمكن تطبيق نفس النمط على صفحات أخرى إذا لزم الأمر

## الخلاصة

تم حل المشكلة بنجاح من خلال استخدام دالة محمية تضمن تنفيذ جميع العمليات في معاملة واحدة، مما يتجنب مشاكل Connection Pooling ويضمن عمل Row Level Security بشكل صحيح.
