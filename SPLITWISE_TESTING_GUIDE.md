# دليل اختبار نظام Splitwise

## الاختبار السريع

### السيناريو الأساسي

#### 1. التحضير
- المستخدم الأول: **جلال أحمد** (رقم الحساب: 26001)
- المستخدم الثاني: **جلال** (رقم الحساب: 26009)
- يجب أن يكون كل مستخدم قد أضاف الآخر كعميل

#### 2. الخطوات

**من حساب جلال أحمد:**
1. افتح قائمة العملاء
2. ابحث عن "جلال" - يجب أن ترى شارة "مرتبط بمستخدم" 🔗
3. افتح تفاصيل العميل "جلال"
4. سجل حركة "له 5000 دولار"
5. لاحظ أن الحركة تظهر مع أيقونة الربط 🔗
6. لاحظ النص: "متزامن مع جلال"

**من حساب جلال:**
1. افتح قائمة العملاء
2. ابحث عن "جلال أحمد" - يجب أن ترى شارة "مرتبط بمستخدم" 🔗
3. افتح تفاصيل العميل "جلال أحمد"
4. **بدون تسجيل أي حركة**، يجب أن ترى:
   - الرصيد: "لنا عند جلال أحمد 5000 دولار" (باللون الأحمر)
   - حركة جديدة "عليه 5000 دولار" تم إنشاؤها تلقائياً
   - الحركة تحمل أيقونة الربط 🔗
   - النص: "متزامن مع جلال أحمد"

#### 3. التحقق من التطابق

**استعلام SQL للتحقق:**

```sql
-- التحقق من الأرصدة
SELECT
  owner.full_name as المستخدم,
  c.name as العميل,
  cb.balance as الرصيد,
  cb.currency as العملة,
  CASE
    WHEN cb.balance > 0 THEN 'له عندنا'
    WHEN cb.balance < 0 THEN 'لنا عنده'
    ELSE 'متساوي'
  END as الوصف
FROM customer_balances_by_currency cb
INNER JOIN customers c ON cb.customer_id = c.id
INNER JOIN app_security owner ON c.user_id = owner.id
WHERE c.linked_user_id IS NOT NULL
  AND (owner.user_name = 'Galal' OR owner.user_name = 'omo')
ORDER BY owner.full_name;
```

**النتيجة المتوقعة:**
| المستخدم | العميل | الرصيد | العملة | الوصف |
|---------|--------|--------|--------|-------|
| جلال | جلال أحمد | -5000 | USD | لنا عنده |
| جلال أحمد | جلال | 5000 | USD | له عندنا |

✅ **الأرصدة متطابقة ومتعاكسة بشكل صحيح!**

## اختبارات إضافية

### اختبار 1: حركات متعددة

**الخطوات:**
1. من حساب جلال أحمد، سجل "له 1000 دولار"
2. من حساب جلال أحمد، سجل "عليه 500 دولار"
3. من حساب جلال، تحقق من الحركات

**النتيجة المتوقعة:**
- في حساب جلال أحمد: الرصيد = 5000 + 1000 - 500 = 5500 دولار (له عندنا)
- في حساب جلال: الرصيد = -5500 دولار (لنا عنده)
- يجب أن تظهر جميع الحركات مع أيقونة الربط

### اختبار 2: عملات متعددة

**الخطوات:**
1. سجل "له 100 يورو"
2. سجل "له 200 ريال"
3. تحقق من الأرصدة في كلا الحسابين

**النتيجة المتوقعة:**
- كل عملة تظهر بشكل منفصل
- الأرصدة متطابقة لكل عملة

### اختبار 3: صفحة الحسابات المتبادلة

**الخطوات:**
1. من أي حساب، انتقل إلى "الحسابات المتبادلة"
2. يجب أن ترى قائمة بجميع المستخدمين المرتبطين
3. اضغط على أي حساب

**النتيجة المتوقعة:**
- قائمة واضحة بالأرصدة
- أيقونات توضيحية (↑↓)
- إمكانية الوصول السريع للتفاصيل

## استعلامات تشخيصية

### 1. فحص الحركات المرآة

```sql
SELECT
  am.movement_number,
  c.name as customer_name,
  am.movement_type,
  am.amount,
  am.mirror_movement_id,
  owner.full_name as owner,
  linked.full_name as linked_user
FROM account_movements am
INNER JOIN customers c ON am.customer_id = c.id
LEFT JOIN app_security owner ON c.user_id = owner.id
LEFT JOIN app_security linked ON c.linked_user_id = linked.id
WHERE c.linked_user_id IS NOT NULL
ORDER BY am.created_at DESC
LIMIT 10;
```

### 2. فحص تطابق الحركات المرآة

```sql
-- التحقق من أن كل حركة لها حركة مرآة مقابلة
SELECT
  am1.movement_number as original,
  am2.movement_number as mirror,
  am1.movement_type as original_type,
  am2.movement_type as mirror_type,
  am1.amount as original_amount,
  am2.amount as mirror_amount,
  CASE
    WHEN am1.movement_type != am2.movement_type
      AND am1.amount = am2.amount
      AND am1.currency = am2.currency
    THEN '✅ صحيح'
    ELSE '❌ خطأ'
  END as status
FROM account_movements am1
INNER JOIN account_movements am2 ON am1.mirror_movement_id = am2.id
WHERE am1.mirror_movement_id IS NOT NULL
ORDER BY am1.created_at DESC
LIMIT 10;
```

### 3. فحص توازن النظام

```sql
-- التحقق من أن مجموع الأرصدة بين المستخدمين المرتبطين = 0
SELECT
  currency,
  SUM(balance) as total_balance,
  CASE
    WHEN SUM(balance) = 0 THEN '✅ متوازن'
    ELSE '❌ غير متوازن'
  END as status
FROM (
  SELECT
    cb.currency,
    cb.balance
  FROM customer_balances_by_currency cb
  INNER JOIN customers c ON cb.customer_id = c.id
  WHERE c.linked_user_id IS NOT NULL
) as linked_balances
GROUP BY currency;
```

## المشاكل الشائعة وحلولها

### المشكلة 1: الحركة المرآة لم تُنشأ

**السبب المحتمل:**
- العميل غير مرتبط بمستخدم
- خطأ في الـ trigger

**الحل:**
```sql
-- تحقق من أن العميل مرتبط
SELECT id, name, linked_user_id
FROM customers
WHERE id = 'CUSTOMER_ID';

-- إذا كان linked_user_id = NULL، العميل غير مرتبط
```

### المشكلة 2: الأرصدة غير متطابقة

**السبب المحتمل:**
- حركات قديمة قبل تفعيل النظام
- حذف حركة مرآة يدوياً

**الحل:**
```sql
-- البحث عن حركات بدون حركة مرآة
SELECT
  am.id,
  am.movement_number,
  c.name,
  c.linked_user_id
FROM account_movements am
INNER JOIN customers c ON am.customer_id = c.id
WHERE c.linked_user_id IS NOT NULL
  AND am.mirror_movement_id IS NULL
  AND am.is_commission_movement = false;
```

### المشكلة 3: المؤشرات البصرية لا تظهر

**السبب المحتمل:**
- الاستعلام في الواجهة لا يجلب بيانات الـ linked_user

**الحل:**
- تحقق من أن الاستعلام يتضمن:
```typescript
.select('*, customer:customers!inner(id, name, linked_user_id, linked_user:app_security!customers_linked_user_id_fkey(id, user_name, full_name, account_number))')
```

## نصائح الاختبار

1. **اختبر من حسابين مختلفين**
   - استخدم جهازين أو متصفحين مختلفين
   - سجل دخول بكل حساب

2. **تحقق من التزامن الفوري**
   - بعد تسجيل الحركة، قم بتحديث الصفحة في الحساب الآخر
   - يجب أن تظهر الحركة فوراً

3. **اختبر سيناريوهات متنوعة**
   - عملات مختلفة
   - حركات متعددة
   - حركات له وعليه

4. **استخدم الاستعلامات التشخيصية**
   - للتحقق من صحة البيانات
   - لفهم أي مشاكل قد تحدث

## خلاصة

نظام Splitwise يعمل بشكل كامل وتلقائي. عند تسجيل أي حركة على عميل مرتبط، يتم:
- ✅ إنشاء الحركة المرآة تلقائياً
- ✅ تحديث الأرصدة في كلا الحسابين
- ✅ إظهار المؤشرات البصرية
- ✅ ضمان تطابق البيانات

**ملاحظة:** النظام محمي بصلاحيات RLS ويعمل بشكل آمن وموثوق.
