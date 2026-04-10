# إصلاح نظام شعار المحل - ملخص سريع

**التاريخ**: 12 يناير 2026

---

## 🔧 ما تم إصلاحه

### المشكلة:
1. ❌ الشعار لا يظهر في السندات PDF
2. ❌ فشل حفظ الشعار في قاعدة البيانات

### الحل:
1. ✅ الشعار يظهر الآن في جميع السندات
2. ✅ حفظ الشعار يعمل بشكل موثوق
3. ✅ دعم Supabase Storage كامل
4. ✅ fallback تلقائي للشعار الافتراضي

---

## 📋 معلومات قاعدة البيانات

### الجدول: `app_settings`

```sql
-- العمود الذي يخزن الشعار
shop_logo TEXT  -- رابط الشعار في Supabase Storage

-- العمود الذي يحدد الشعار للسندات
selected_receipt_logo TEXT  -- 'DEFAULT' أو رابط أو null

-- المعرف الثابت المستخدم
id = '00000000-0000-0000-0000-000000000000'
```

### Storage Bucket: `shop-logos`

```
Bucket Name: shop-logos
Public: Yes ✅
Max Size: 5 MB
Allowed Types: JPG, PNG, WEBP
Path Format: logos/[userId]_[timestamp].[ext]
```

### سياسات RLS (موجودة ✅):

```sql
-- app_settings
CREATE POLICY "Allow anon and authenticated users full access to app_settings"
  ON app_settings FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

-- storage.objects
CREATE POLICY "Public Access"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'shop-logos');
```

---

## 🗂️ الملفات المعدلة

### 1. `utils/logoHelper.ts` ✅
- **التغيير**: إعادة كتابة كاملة
- **الوظيفة**: يقرأ الشعار من قاعدة البيانات، يحمله من Storage، يحوله لـ base64
- **الميزات الجديدة**:
  - قراءة من `app_settings.selected_receipt_logo` و `shop_logo`
  - تحميل الشعار من Supabase Storage
  - تحويل الشعار إلى base64 data URL للـ PDF
  - fallback تلقائي للشعار الافتراضي
  - error logging شامل

### 2. `contexts/AuthContext.tsx` ✅
- **التغيير**: استخدام UPSERT بدلاً من UPDATE/INSERT
- **الكود الجديد**:
```typescript
const settingsToUpsert = {
  id: '00000000-0000-0000-0000-000000000000',
  ...newSettings,
};

await supabase
  .from('app_settings')
  .upsert(settingsToUpsert, { onConflict: 'id' });
```

### 3. `services/logoService.ts` ✅
- **التغيير**: استخدام UPSERT في جميع العمليات
- **الوظائف**:
  - `uploadLogo()` - رفع الشعار إلى Storage (مع upsert: true)
  - `updateShopLogo()` - تحديث رابط الشعار (مع UPSERT)
  - `deleteLogo()` - حذف الشعار القديم من Storage
  - error logging محسّن

### 4. `services/receiptService.ts` ✅
- **التغيير**: لا يوجد (يستخدم الوظائف المحدثة)
- **يستدعي**: `logoHelper.getReceiptLogoBase64()`

### 5. `utils/receiptGenerator.ts` ✅
- **التغيير**: لا يوجد (يستقبل logoDataUrl كـ base64)
- **يعرض**: `<img src="${logoDataUrl}" />` في الهيدر

---

## 🧪 كيفية الاختبار

### اختبار سريع (5 دقائق):

```
1. افتح التطبيق
   ↓
2. الإعدادات → إعدادات المحل
   ↓
3. اختر صورة من المعرض (< 5 MB)
   ↓
4. اختر "استخدام الشعار المرفوع"
   ↓
5. احفظ
   ↓
6. أنشئ حركة جديدة
   ↓
7. افتح السند
   ↓
✅ الشعار يظهر في السند
```

### التحقق من قاعدة البيانات:

```sql
SELECT id, shop_logo, selected_receipt_logo
FROM app_settings
WHERE id = '00000000-0000-0000-0000-000000000000';
```

**النتيجة المتوقعة:**
```
id: 00000000-0000-0000-0000-000000000000
shop_logo: https://...supabase.co/storage/v1/object/public/shop-logos/logos/default_1234567890.jpg
selected_receipt_logo: [نفس الرابط أو null]
```

---

## 🔄 كيف يعمل النظام

```
المستخدم يرفع صورة
      ↓
uploadLogo() → Supabase Storage
      ↓
updateSettings() → UPSERT في app_settings
      ↓
shop_logo = "https://...supabase.co/.../logo.jpg"
      ↓
[المستخدم ينشئ سند]
      ↓
getReceiptLogoBase64() → قراءة من app_settings
      ↓
downloadAndConvertLogoToBase64() → تحميل من Storage
      ↓
FileSystem.downloadAsync() → ملف محلي مؤقت
      ↓
FileSystem.readAsStringAsync() → base64
      ↓
data:image/jpeg;base64,/9j/4AAQSkZJRg...
      ↓
generateReceiptHTML() → <img src="data:image/jpeg;base64,...">
      ↓
Print.printToFileAsync() → PDF
      ↓
✅ الشعار يظهر في السند
```

---

## 📝 Console Logs المتوقعة

### عند رفع الشعار:
```
[logoService] Starting upload for: file:///...
[logoService] File read successfully, size: 0.23 MB
[logoService] Uploading to path: logos/default_1705012345678.jpg
[logoService] Upload successful
[logoService] Public URL: https://...supabase.co/.../logo.jpg
[AuthContext] Performing upsert with data: {...}
[AuthContext] Settings upserted successfully
```

### عند إنشاء السند:
```
[logoHelper] getReceiptLogoBase64 called
[logoHelper] Settings loaded: { selected_receipt_logo: "https://...", shop_logo: "https://..." }
[logoHelper] Found uploaded logo in Supabase Storage
[logoHelper] Downloading logo from Storage: https://...
[logoHelper] Logo downloaded to: file:///...temp_logo_1705012345678.jpg
[logoHelper] Successfully converted uploaded logo to base64, length: 45678
```

---

## 🐛 استكشاف الأخطاء

### "فشل حفظ الإعدادات"
- تحقق من RLS policies (يجب أن تسمح لـ anon)
- تحقق من وجود السجل `00000000-0000-0000-0000-000000000000`

### "الشعار لا يظهر في السندات"
- افحص console logs للأخطاء
- تحقق من `selected_receipt_logo` (يجب ألا يكون 'DEFAULT')
- تحقق من صلاحيات Storage (يجب أن يكون public)

### "حجم الملف كبير جداً"
- استخدم صورة أصغر (< 5 MB)
- اضغط الصورة باستخدام TinyPNG أو JPEG Optimizer

---

## 📚 التوثيق الكامل

راجع ملف `SHOP_LOGO_COMPLETE_GUIDE.md` للحصول على:
- شرح تفصيلي لكل ملف
- مخططات تدفق البيانات
- دليل اختبار شامل
- حلول لجميع المشاكل المحتملة

---

**ملخص بجملة واحدة:**
النظام الآن يقرأ الشعار من قاعدة البيانات، يحمله من Supabase Storage، يحوله لـ base64، ويعرضه في السندات PDF بشكل موثوق على جميع المنصات.
