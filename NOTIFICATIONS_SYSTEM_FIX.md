# إصلاح نظام الإشعارات - ملخص التحديثات

تاريخ التحديث: 24 يناير 2026

## المشاكل التي تم حلها

### 1. بيانات الإشعارات فارغة
**المشكلة:**
- الحقول `amount`, `currency`, `customer_name`, `movement_type`, `movement_number` كانت NULL في جدول `movement_notifications`
- المستخدم لا يرى المبلغ أو اسم العميل في الإشعارات

**الحل:**
- تحديث دالة `create_notification` لقبول وحفظ جميع البيانات الإضافية
- تحديث جميع استدعاءات الدالة في:
  - `create_mirror_movement_v2`
  - `approve_movement`
  - `void_movement_and_mirror`
- إصلاح البيانات الموجودة في الإشعارات غير المقروءة

### 2. خطأ "Movement is not pending approval"
**المشكلة:**
- جميع الحركات المرآة كانت تُنشأ بحالة `approved` مباشرة
- عند الضغط على زر "موافق"، يظهر خطأ "Movement is not pending approval"
- التناقض: الإشعار يطلب الموافقة على حركة معتمدة مسبقاً

**الحل:**
- تعديل منطق `create_mirror_movement_v2`:
  - إذا كانت الحركة الأصلية "عليه" (outgoing) → الحركة المرآة "له" (incoming) → `pending` (تحتاج موافقة)
  - إذا كانت الحركة الأصلية "له" (incoming) → الحركة المرآة "عليه" (outgoing) → `approved` (معتمدة تلقائياً)

### 3. أزرار الموافقة/الرفض تظهر للحركات المعتمدة
**المشكلة:**
- أزرار "موافق" و "رفض" كانت تظهر حتى للحركات المعتمدة أو الملغاة مسبقاً
- يؤدي ذلك إلى الارتباك والخطأ عند الضغط على الأزرار

**الحل:**
- إضافة `approval_status` و `pending_approval` إلى استعلام البيانات
- إخفاء أزرار الموافقة/الرفض إذا:
  - الحركة ملغاة (`is_voided = true`)
  - الحركة معتمدة مسبقاً (`approval_status != 'pending'`)
  - الحركة لا تنتظر الموافقة (`pending_approval = false`)
- تحسين رسالة الخطأ لتوضيح الحالة للمستخدم

## الملفات المُعدّلة

### 1. قاعدة البيانات (Migrations)

#### `drop_old_create_notification_function.sql`
- حذف جميع إصدارات دالة `create_notification` القديمة

#### `recreate_notifications_with_full_data.sql`
- إعادة إنشاء `create_notification` مع معاملات إضافية:
  - `p_movement_number`
  - `p_amount`
  - `p_currency`
  - `p_customer_name`
  - `p_actor_name`
  - `p_movement_type`
  - `p_extra_data`
- تحديث `create_mirror_movement_v2` لتمرير البيانات الكاملة
- تحديث `approve_movement` لتمرير البيانات الكاملة
- تحديث `void_movement_and_mirror` لتمرير البيانات الكاملة
- إصلاح البيانات الموجودة في الإشعارات غير المقروءة

### 2. واجهة المستخدم

#### `app/notifications.tsx`
- إضافة `approval_status` و `pending_approval` إلى interface Notification
- إضافة الحقلين إلى استعلام البيانات
- تحديث منطق `showActions` لإخفاء الأزرار للحركات المعتمدة/الملغاة
- تحسين `handleApprove` مع رسالة خطأ أفضل

## منطق نظام الموافقات

### سيناريو 1: حركة "عليه" من المستخدم A
```
المستخدم A: إضافة حركة "عليه" لحساب العميل X (مرتبط بالمستخدم B)
  ↓
الحركة الأصلية: outgoing, approved (معتمدة تلقائياً)
  ↓
الحركة المرآة للمستخدم B: incoming, pending (تحتاج موافقة)
  ↓
المستخدم B يتلقى إشعار: "تم إضافة حركة جديدة من X"
  ↓
يظهر زر "موافق" و "رفض"
  ↓
عند الموافقة: الحركة المرآة تتحول إلى approved
```

### سيناريو 2: حركة "له" من المستخدم A
```
المستخدم A: إضافة حركة "له" لحساب العميل X (مرتبط بالمستخدم B)
  ↓
الحركة الأصلية: incoming, approved (معتمدة تلقائياً)
  ↓
الحركة المرآة للمستخدم B: outgoing, approved (معتمدة تلقائياً)
  ↓
المستخدم B يتلقى إشعار: "تم إضافة حركة جديدة من X"
  ↓
لا تظهر أزرار "موافق" و "رفض" (لأن الحركة معتمدة مسبقاً)
```

## البيانات المعروضة في الإشعارات

الآن تعرض الإشعارات:
- **اسم العميل**: من حقل `customer_name` في الإشعار أو من العلاقة `movement.customer.name`
- **المبلغ**: من حقل `amount` في الإشعار أو من العلاقة `movement.amount`
- **العملة**: من حقل `currency` في الإشعار أو من العلاقة `movement.currency`
- **نوع الحركة**: outgoing/incoming
- **رقم الحركة**: movement_number
- **سبب الرفض**: إذا كان الإشعار من نوع "rejected"

## الاختبار

لاختبار النظام:

1. **إضافة حركة "عليه" لحساب مرتبط:**
   ```
   المستخدم A → إضافة حركة "عليه" 100 USD لـ Salem
   المستخدم B (حساب Salem) → يتلقى إشعار مع:
     - المبلغ: 100.00 USD
     - اسم العميل: A
     - أزرار "موافق" و "رفض"
   ```

2. **إضافة حركة "له" لحساب مرتبط:**
   ```
   المستخدم A → إضافة حركة "له" 200 USD من Salem
   المستخدم B (حساب Salem) → يتلقى إشعار مع:
     - المبلغ: 200.00 USD
     - اسم العميل: A
     - بدون أزرار (معتمدة تلقائياً)
   ```

3. **الموافقة على حركة معتمدة مسبقاً:**
   ```
   الضغط على "موافق" لحركة معتمدة → رسالة:
   "هذه الحركة معتمدة مسبقاً أو تم التعامل معها. سيتم إخفاء الإشعار."
   ```

## الأداء والتحديثات التلقائية

- الإشعارات تتحدث تلقائياً عبر **Realtime Subscriptions**
- عند إضافة/تعديل/حذف إشعار، تُحدّث الشاشة فوراً
- البيانات محفوظة في الإشعار نفسه، لا حاجة لاستعلامات إضافية

## الأمان

- جميع الدوال تستخدم `SECURITY DEFINER`
- التحقق من `user_id` قبل أي عملية
- RLS policies تضمن أن كل مستخدم يرى إشعاراته فقط
- لا يمكن التلاعب بالإشعارات من الواجهة

## الملاحظات الفنية

### تحديث دالة create_notification
قبل:
```sql
CREATE FUNCTION create_notification(
  p_movement_id uuid,
  p_user_id uuid,
  p_notification_type text,
  p_message text
)
```

بعد:
```sql
CREATE FUNCTION create_notification(
  p_movement_id uuid,
  p_user_id uuid,
  p_notification_type text,
  p_message text,
  p_movement_number text DEFAULT NULL,
  p_amount numeric DEFAULT NULL,
  p_currency text DEFAULT NULL,
  p_customer_name text DEFAULT NULL,
  p_actor_name text DEFAULT NULL,
  p_movement_type text DEFAULT NULL,
  p_extra_data jsonb DEFAULT NULL
)
```

### منطق showActions في الواجهة
```typescript
const movementIsPending =
  movement?.approval_status === 'pending' ||
  movement?.pending_approval === true;

const showActions =
  needsAction &&
  notification.movement_id &&
  !movement?.is_voided &&
  movementIsPending;
```

## الخطوات التالية

تم إكمال جميع الإصلاحات. النظام الآن:
- ✅ يعرض البيانات الكاملة في الإشعارات
- ✅ يطبق منطق الموافقة الصحيح
- ✅ يخفي أزرار الموافقة/الرفض للحركات المعتمدة
- ✅ يوفر رسائل خطأ واضحة

يمكن للمستخدمين الآن استخدام نظام الإشعارات بشكل طبيعي دون مواجهة الأخطاء السابقة.
