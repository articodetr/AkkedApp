# إعداد نظام الشعارات الديناميكي

## الخطوة 1: إنشاء Storage Bucket في Supabase

يجب عليك إنشاء bucket جديد في Supabase Storage لتخزين الشعارات:

1. افتح لوحة تحكم Supabase الخاصة بك
2. اذهب إلى **Storage** من القائمة الجانبية
3. انقر على **New bucket**
4. املأ البيانات التالية:
   - **Name**: `shop-logos`
   - **Public bucket**: ✅ (اجعله عام)
   - **File size limit**: 5 MB (اختياري)
   - **Allowed MIME types**: `image/jpeg, image/jpg, image/png, image/webp` (اختياري)
5. انقر على **Create bucket**

## الخطوة 2: إعداد سياسات الأمان (RLS Policies)

بعد إنشاء الـ bucket، يجب عليك إضافة سياسات الأمان التالية:

### سياسة القراءة (للجميع)
```sql
CREATE POLICY "Public Access"
ON storage.objects FOR SELECT
USING (bucket_id = 'shop-logos');
```

### سياسة الكتابة (الرفع)
```sql
CREATE POLICY "Enable upload for authenticated users"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'shop-logos');
```

### سياسة الحذف
```sql
CREATE POLICY "Enable delete for authenticated users"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'shop-logos');
```

## طريقة بديلة: إنشاء Bucket من SQL

يمكنك تنفيذ الأوامر التالية في SQL Editor:

```sql
-- إنشاء bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('shop-logos', 'shop-logos', true);

-- إضافة سياسات الأمان
CREATE POLICY "Public Access"
ON storage.objects FOR SELECT
USING (bucket_id = 'shop-logos');

CREATE POLICY "Enable upload for authenticated users"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'shop-logos');

CREATE POLICY "Enable delete for authenticated users"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'shop-logos');
```

## الخطوة 3: التحقق من الإعداد

بعد إكمال الخطوات أعلاه:

1. افتح التطبيق
2. اذهب إلى **الإعدادات**
3. اضغط على **إعدادات المحل**
4. جرب رفع شعار جديد
5. تأكد من ظهور الشعار في الإيصالات

## ملاحظات مهمة

- الشعار الحالي محفوظ في `assets/images/logo.jpg` وسيستخدم كشعار افتراضي
- عند رفع شعار جديد، سيحل محل الشعار الافتراضي
- يمكنك حذف الشعار المخصص والعودة للشعار الافتراضي في أي وقت
- الشعارات تخزن في Supabase Storage وتظهر لجميع المستخدمين
- الصور المدعومة: JPG, JPEG, PNG, WEBP

## استكشاف الأخطاء

### خطأ: "Failed to upload logo"
- تأكد من إنشاء bucket بالاسم الصحيح: `shop-logos`
- تأكد من أن الـ bucket عام (public)
- تأكد من إضافة سياسات الأمان

### خطأ: "Permission denied"
- تأكد من إضافة سياسات الأمان للقراءة والكتابة
- تأكد من أن المستخدم مصادق عليه (authenticated)

### الشعار لا يظهر في الإيصالات
- تأكد من أن رابط الشعار محفوظ في قاعدة البيانات (جدول `app_settings`)
- تأكد من أن الـ bucket عام (public)
- افحص console logs للأخطاء
