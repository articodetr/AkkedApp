-- ملف التحقق من إعداد نظام شعار المحل
-- استخدم هذا الملف للتأكد من أن قاعدة البيانات و Storage جاهزة

-- 1. التحقق من جدول app_settings
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'app_settings' AND table_schema = 'public'
ORDER BY ordinal_position;

-- النتيجة المتوقعة:
-- يجب أن يكون هناك عمود 'shop_logo' (text, nullable)
-- يجب أن يكون هناك عمود 'selected_receipt_logo' (text, nullable)

-- 2. التحقق من وجود السجل الأساسي
SELECT * FROM app_settings
WHERE id = '00000000-0000-0000-0000-000000000000';

-- إذا لم يوجد السجل، أنشئه:
-- INSERT INTO app_settings (id, shop_name)
-- VALUES ('00000000-0000-0000-0000-000000000000', '')
-- ON CONFLICT (id) DO NOTHING;

-- 3. التحقق من RLS policies لـ app_settings
SELECT
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'app_settings'
ORDER BY policyname;

-- النتيجة المتوقعة:
-- يجب أن تكون هناك سياسة تسمح لـ anon و authenticated بالعمليات

-- 4. التحقق من Storage bucket
SELECT
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
FROM storage.buckets
WHERE name = 'shop-logos';

-- النتيجة المتوقعة:
-- name: shop-logos
-- public: true
-- file_size_limit: 5242880 (5 MB)
-- allowed_mime_types: ["image/jpeg","image/jpg","image/png","image/webp"]

-- 5. التحقق من Storage policies
SELECT
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND qual LIKE '%shop-logos%'
ORDER BY policyname;

-- النتيجة المتوقعة:
-- يجب أن تكون هناك سياسات للـ:
-- - SELECT (public) - للقراءة
-- - INSERT (anon, authenticated) - للرفع
-- - UPDATE (anon, authenticated) - للتحديث
-- - DELETE (anon, authenticated) - للحذف

-- 6. فحص الشعارات المرفوعة حالياً
SELECT
  name,
  bucket_id,
  created_at,
  updated_at,
  last_accessed_at,
  metadata->>'size' as size_bytes,
  metadata->>'mimetype' as mime_type
FROM storage.objects
WHERE bucket_id = 'shop-logos'
ORDER BY created_at DESC
LIMIT 10;

-- 7. اختبار الوصول للشعار (تشغيل بعد رفع شعار)
-- استبدل [YOUR_LOGO_URL] برابط الشعار الخاص بك
-- ثم افتح الرابط في المتصفح للتأكد من أنه يعمل:
-- https://[YOUR_PROJECT].supabase.co/storage/v1/object/public/shop-logos/logos/default_1234567890.jpg

-- ✅ إذا كانت جميع النتائج صحيحة، النظام جاهز!

-- 🔧 إذا كان هناك مشاكل:

-- إنشاء السياسة لـ app_settings إذا لم تكن موجودة:
-- DROP POLICY IF EXISTS "Allow authenticated users to update app_settings" ON app_settings;
-- DROP POLICY IF EXISTS "Allow public read access to app_settings" ON app_settings;
-- CREATE POLICY "Allow anon and authenticated users full access to app_settings"
--   ON app_settings FOR ALL
--   TO anon, authenticated
--   USING (true) WITH CHECK (true);

-- إنشاء سياسة القراءة لـ Storage إذا لم تكن موجودة:
-- CREATE POLICY "Public Access"
--   ON storage.objects FOR SELECT
--   TO public
--   USING (bucket_id = 'shop-logos');

-- إنشاء سياسة الرفع لـ Storage إذا لم تكن موجودة:
-- CREATE POLICY "Allow upload for all users"
--   ON storage.objects FOR INSERT
--   TO anon, authenticated;

-- إنشاء سياسة التحديث لـ Storage إذا لم تكن موجودة:
-- CREATE POLICY "Allow update for all users"
--   ON storage.objects FOR UPDATE
--   TO anon, authenticated
--   USING (bucket_id = 'shop-logos');

-- إنشاء سياسة الحذف لـ Storage إذا لم تكن موجودة:
-- CREATE POLICY "Allow delete for all users"
--   ON storage.objects FOR DELETE
--   TO anon, authenticated
--   USING (bucket_id = 'shop-logos');
