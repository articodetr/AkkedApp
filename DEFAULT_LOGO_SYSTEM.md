# نظام الشعار الافتراضي للسندات

## نظرة عامة

تم تكوين التطبيق لاستخدام صورة افتراضية من مجلد `assets` عند عدم وجود شعار مخصص مرفوع من المستخدم. هذا يوفر تجربة أفضل بدلاً من عرض placeholder رمادي.

## موقع الشعار الافتراضي

الشعار الافتراضي موجود في:
```
assets/images/logo_1.png
```

## كيفية عمل النظام

### 1. عند إنشاء سند جديد

عند إنشاء سند جديد، يقوم النظام بالخطوات التالية:

1. **التحقق من الشعار المرفوع**: يبحث في قاعدة البيانات (`app_settings.selected_receipt_logo`)
   - إذا كان `selected_receipt_logo` يحتوي على رابط صورة صالح: يستخدم هذا الشعار
   - إذا كان `selected_receipt_logo = 'DEFAULT'`: يستخدم الشعار الافتراضي من assets
   - إذا كان `selected_receipt_logo = null`: يستخدم الشعار الافتراضي من assets

2. **تحميل الشعار الافتراضي**:
   - على الويب: يتم تحميل الصورة مباشرة من assets ويُرجع URI
   - على الموبايل: يتم قراءة الصورة وتحويلها إلى base64 لاستخدامها في PDF

### 2. الكود المسؤول

الدالة المسؤولة عن تحميل الشعار الافتراضي موجودة في `utils/logoHelper.ts`:

```typescript
async function getDefaultLogoBase64(): Promise<string> {
  // على الويب: إرجاع asset URI مباشرة
  if (Platform.OS === 'web') {
    const asset = Asset.fromModule(require('@/assets/images/logo_1.png'));
    await asset.downloadAsync();
    return asset.uri;
  }

  // على الموبايل: تحويل إلى base64
  const asset = Asset.fromModule(require('@/assets/images/logo_1.png'));
  await asset.downloadAsync();

  const uriToUse = asset.localUri || asset.uri;
  const base64 = await FileSystem.readAsStringAsync(uriToUse, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return `data:image/png;base64,${base64}`;
}
```

الدالة التي تُستخدم في السندات هي `getReceiptLogoBase64()`:

```typescript
export async function getReceiptLogoBase64(forceRefresh = false): Promise<string> {
  const dbLogoUrl = await getReceiptLogoFromDatabase();

  if (dbLogoUrl) {
    // استخدام الشعار المرفوع
    return await convertUrlToBase64(dbLogoUrl, LOGO_CACHE_FILENAME, forceRefresh);
  } else {
    // استخدام الشعار الافتراضي
    return await getDefaultLogoBase64();
  }
}
```

## كيفية تخصيص الشعار الافتراضي

لتغيير الشعار الافتراضي الذي يظهر في السندات:

### الخطوة 1: إعداد الصورة

1. قم بإنشاء أو تحضير صورة الشعار بصيغة PNG
2. يُفضل أن تكون الصورة مربعة (مثل 500x500 أو 1000x1000)
3. تأكد من أن حجم الملف معقول (أقل من 500 كيلوبايت لأداء أفضل)

### الخطوة 2: استبدال الملف

استبدل ملف `assets/images/logo_1.png` بالصورة الجديدة:

```bash
# حذف الملف القديم
rm assets/images/logo_1.png

# نسخ الشعار الجديد
cp /path/to/your/new-logo.png assets/images/logo_1.png
```

### الخطوة 3: إعادة بناء التطبيق

بعد استبدال الصورة، يجب إعادة بناء التطبيق:

```bash
# للويب
npm run build:web

# لـ Android/iOS - قد تحتاج إلى إعادة البناء الكامل
```

## ملاحظات هامة

### 1. حجم الصورة

- الصورة الحالية (logo_1.png) بحجم 1024x1024 بكسل و148 كيلوبايت
- يُنصح باستخدام صور بحجم معقول (500-1000 بكسل) لتوازن الجودة والأداء
- حجم الملف يؤثر على:
  - سرعة تحميل التطبيق
  - حجم حزمة التطبيق النهائية
  - سرعة إنشاء السندات (خاصة على الأجهزة القديمة)

### 2. صيغة الصورة

- يجب أن تكون الصورة بصيغة PNG
- يمكن أن تحتوي على خلفية شفافة (alpha channel)
- إذا كنت تريد استخدام JPG، ستحتاج لتعديل الكود ليدعم ذلك

### 3. الـ Caching

- على الموبايل، يتم تحويل الصورة إلى base64 وتخزينها في الذاكرة
- هذا يحسن الأداء عند إنشاء سندات متعددة
- لا حاجة لمسح الكاش عند تغيير الشعار الافتراضي (يتطلب إعادة بناء التطبيق)

### 4. التوافق

- الكود يعمل على:
  - الويب (Web)
  - Android
  - iOS
- كل منصة تعالج الصورة بشكل مناسب لها

## السيناريوهات المختلفة

### السيناريو 1: لا يوجد شعار مرفوع

```
المستخدم لم يرفع أي شعار
↓
selected_receipt_logo = 'DEFAULT' (أو null)
↓
يستخدم logo_1.png من assets
```

### السيناريو 2: شعار مرفوع ومحدد للسندات

```
المستخدم رفع شعار واختار "استخدام الشعار المرفوع"
↓
selected_receipt_logo = [URL من Supabase Storage]
↓
يستخدم الشعار المرفوع
```

### السيناريو 3: شعار مرفوع ولكن اختار الافتراضي

```
المستخدم رفع شعار ولكن اختار "استخدام الشعار الافتراضي"
↓
selected_receipt_logo = 'DEFAULT'
↓
يستخدم logo_1.png من assets (يتجاهل الشعار المرفوع)
```

## استكشاف الأخطاء

### المشكلة: الشعار لا يظهر في السندات

**الأسباب المحتملة:**
1. ملف logo_1.png غير موجود أو تالف
2. ملف logo_1.png ليس صورة PNG حقيقية
3. مشكلة في الأذونات

**الحل:**
```bash
# التحقق من وجود الملف ونوعه
file assets/images/logo_1.png
# يجب أن يظهر: PNG image data

# التحقق من حجم الملف
ls -lh assets/images/logo_1.png
# يجب أن يكون أكبر من صفر

# إعادة نسخ الصورة إذا لزم الأمر
cp assets/images/icon.png assets/images/logo_1.png
```

### المشكلة: الشعار يظهر على الويب ولكن ليس على الموبايل

**السبب:** مشكلة في تحويل الصورة إلى base64

**الحل:**
```typescript
// في utils/logoHelper.ts، تحقق من logs:
console.log('[logoHelper] Asset info - URI:', asset.uri, 'LocalURI:', asset.localUri);
```

### المشكلة: الشعار يظهر ضبابي أو منخفض الجودة

**السبب:** حجم الصورة صغير جداً

**الحل:**
- استخدم صورة بدقة أعلى (على الأقل 512x512)
- تأكد من جودة الصورة الأصلية

## الملفات ذات الصلة

- `utils/logoHelper.ts`: الوظائف الرئيسية لتحميل الشعار
- `services/receiptService.ts`: استخدام الشعار في إنشاء السندات
- `utils/receiptGenerator.ts`: إضافة الشعار إلى PDF السند
- `assets/images/logo_1.png`: ملف الشعار الافتراضي
- `app/shop-settings.tsx`: إعدادات اختيار الشعار

## المراجع

- [Expo Asset Documentation](https://docs.expo.dev/versions/latest/sdk/asset/)
- [Expo FileSystem Documentation](https://docs.expo.dev/versions/latest/sdk/filesystem/)

## الخلاصة

النظام الآن يستخدم صورة حقيقية من `assets/images/logo_1.png` كشعار افتراضي للسندات. هذا يوفر:

✅ تجربة احترافية للمستخدم
✅ إمكانية تخصيص الشعار الافتراضي بسهولة
✅ أداء جيد على جميع المنصات
✅ دعم الكاش لتحسين السرعة
✅ fallback إلى placeholder SVG في حالة حدوث أي خطأ

لتخصيص الشعار، ببساطة استبدل ملف `assets/images/logo_1.png` بشعارك الخاص وأعد بناء التطبيق!
