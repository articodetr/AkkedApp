# قوالب الإيميل — تطبيق أكِّد

كل القوالب مصمَّمة لتطابق هوية التطبيق البصرية:
- **Gradient بنفسجي**: `#6366F1 → #4F46E5 → #4338CA`
- **بطاقة بيضاء عائمة** بزوايا مستديرة (24px) وظل ناعم
- **Brand pill** يحوي "أكِّد"
- **أيقونة دائرية** مع حلقة شفافة
- **زر CTA** بـ gradient وظل بنفسجي
- **بطاقات معلومات** ملوّنة (سبب الإجراء + نصائح + تحذيرات)
- **Footer** أنيق

## القوالب المتوفّرة

| الملف | الاستخدام في Supabase |
|---|---|
| `reset-password.html` | Reset Password |
| `confirm-signup.html` | Confirm signup |
| `magic-link.html` | Magic Link |
| `change-email.html` | Change Email Address |

كلها جاهزة للنسخ المباشر في **Supabase Dashboard → Authentication → Email Templates**.

---

## 🚀 إعداد Resend مع Supabase (خطوة بخطوة)

### الفائدة:
- ✅ الإيميلات لن تذهب لـ Spam (لأنها من نطاقك الموثوق)
- ✅ تظهر الأيقونات وتنسيق HTML بالكامل
- ✅ Resend مجاني حتى 3,000 إيميل/شهر
- ✅ سرعة إيصال أعلى من SMTP الافتراضي

### الخطوة 1️⃣: إنشاء حساب Resend

1. اذهب إلى [resend.com](https://resend.com) → **Sign up**
2. سجّل بإيميل عملك (يفضّل نطاق الشركة)

### الخطوة 2️⃣: إضافة نطاقك (Domain)

> ⚠️ **مهمّ**: تحتاج نطاقاً تملكه (مثل `articode.com`). لا يمكن استخدام Gmail/Outlook الشخصي.

1. في Resend → **Domains** → **Add Domain**
2. أدخل نطاقك (مثلاً: `articode.com`)
3. Resend سيعطيك سجلات **DNS** ثلاثة:
   - **SPF** (TXT record)
   - **DKIM** (TXT record)
   - **MX** (للاستلام، اختياري)

### الخطوة 3️⃣: إضافة سجلات DNS

اذهب لمزوّد نطاقك (GoDaddy / Namecheap / Cloudflare / إلخ):
1. افتح إعدادات DNS
2. أضف الـ 3 سجلات بالضبط كما تظهر في Resend
3. ارجع لـ Resend واضغط **Verify Domain**
4. الانتظار: 5-30 دقيقة عادةً
5. عند ظهور علامة ✅ **Verified** → النطاق جاهز

### الخطوة 4️⃣: إنشاء API Key

1. في Resend → **API Keys** → **Create API Key**
2. **Name**: `Supabase Auth`
3. **Permission**: `Sending access`
4. **Domain**: اختر نطاقك الذي تحقّقت منه
5. **Create** → انسخ الـ API Key فوراً (لن يظهر مرة أخرى)
   - يبدأ بـ `re_xxxxxxxxxxxxxxxxxxx`

### الخطوة 5️⃣: ربط Resend بـ Supabase

1. افتح [Supabase Dashboard](https://supabase.com/dashboard/project/hnaudgieczuzuduplhkp/settings/auth)
2. **Project Settings** → **Authentication** → **SMTP Settings**
3. شغّل **Enable Custom SMTP** ✓
4. املأ:

| الحقل | القيمة |
|---|---|
| **Sender email** | `noreply@articode.com` (نطاقك) |
| **Sender name** | `أكِّد` |
| **Host** | `smtp.resend.com` |
| **Port number** | `465` |
| **Username** | `resend` |
| **Password** | الـ API Key من Resend (`re_xxx...`) |
| **Minimum interval between emails** | `60` (ثانية — لتفادي spam) |

5. اضغط **Save**

### الخطوة 6️⃣: تثبيت القوالب في Supabase

لكل قالب:

1. **Authentication** → **Email Templates**
2. اختر القالب المطلوب من القائمة:
   - Confirm signup → `confirm-signup.html`
   - Magic Link → `magic-link.html`
   - Change Email Address → `change-email.html`
   - Reset Password → `reset-password.html`
3. **Subject heading**: استخدم العنوان المقترح أدناه
4. **Message body**: افتح الملف المقابل، انسخ محتواه كاملاً، الصقه
5. اضغط **Save**

#### العناوين المقترَحة (Subject)

| القالب | Subject |
|---|---|
| Confirm signup | `أهلاً بك في أكِّد — أكّد بريدك` |
| Magic Link | `رابط الدخول السحري — أكِّد` |
| Change Email | `تأكيد تغيير البريد الإلكتروني — أكِّد` |
| Reset Password | `استعادة كلمة المرور — أكِّد` |

### الخطوة 7️⃣: ضبط Redirect URLs

في **Authentication** → **URL Configuration**:

| الحقل | القيمة |
|---|---|
| **Site URL** | `akked://` |
| **Redirect URLs** | `akked://**` + `akked://auth-callback` + `exp://**` |

---

## 🧪 اختبار الإرسال

### اختبار من Resend مباشرة:
1. في Resend → **Emails** → **Send Email** (واجهة اختبار)
2. أرسل إيميل تجريبي لنفسك

### اختبار من التطبيق:
1. افتح التطبيق → "نسيت كلمة المرور" → أدخل إيميلك
2. تحقق من صندوق الوارد (وليس Spam هذه المرة)
3. يجب أن يصل إيميل **بهوية أكِّد بالكامل**

---

## 🎨 ملاحظات حول التصميم

### المتغيّرات الديناميكية في القوالب
Supabase يدعم هذه المتغيّرات داخل القوالب:

| المتغيّر | المعنى |
|---|---|
| `{{ .ConfirmationURL }}` | رابط التأكيد/الإجراء (الأهم) |
| `{{ .Email }}` | بريد المستخدم |
| `{{ .Token }}` | الـ token الخام (نادر الاستخدام) |
| `{{ .TokenHash }}` | hash الـ token (للتحقق المخصص) |
| `{{ .SiteURL }}` | عنوان موقعك |
| `{{ .RedirectTo }}` | عنوان العودة |

كل قوالبنا تستخدم `{{ .ConfirmationURL }}` فقط (الأشهر والأنسب).

### توافق الإيميل
القوالب اختُبرت تصميمياً لتعمل في:
- ✅ Gmail (Web + Mobile + iOS App)
- ✅ Outlook (Web + Desktop)
- ✅ Apple Mail (macOS + iOS)
- ✅ Yahoo Mail
- ✅ Samsung Mail
- ✅ Dark mode (يبقى أبيض اللون عبر `color-scheme: light only`)

### ملاحظة عن الـ Gradient في Outlook القديم
بعض إصدارات Outlook Desktop لا تدعم `linear-gradient`. لهذا أضفنا `background-color: #4F46E5` كاحتياطي صلب قبل التدرّج — فلن يظهر للمستخدمين فراغ أبيض.

---

## 🛠️ الصيانة

### تغيير اللون البنفسجي مستقبلاً
ابحث في كل قالب عن:
```css
#6366F1   (المسار الفاتح للـ gradient)
#4F46E5   (اللون الرئيسي)
#4338CA   (المسار الغامق)
```
وبدّلها بألوانك الجديدة.

### تغيير اسم العلامة
ابحث عن `أكِّد` واستبدله.

### إضافة Logo بدل الإيموجي
استبدل سطر الإيموجي (مثلاً `🔑` أو `👋`) بـ:
```html
<img src="https://your-cdn.com/icon.png" width="64" height="64" alt="أكِّد" />
```
ارفع الصورة لـ Supabase Storage أو CDN.

---

## ❓ مشاكل شائعة وحلولها

| المشكلة | الحل |
|---|---|
| الإيميل لا يصل | تحقّق من Resend → **Emails** → ابحث عن الإيميل وارَ سجل التسليم |
| الإيميل في Spam | تأكّد أن SPF + DKIM مُعرَّفان ومُتحقَّق منهما في Resend |
| الـ gradient لا يظهر | المستخدم على Outlook قديم — اللون الصلب الاحتياطي سيظهر |
| الزر بأبيض شفّاف | بعض client تتجاهل `background-image`. اللون الصلب `#4F46E5` سيظهر |
| Arabic يبدو معكوساً | تأكّد من `dir="rtl"` في تاغ `<html>` و `<body>` (موجود في كل القوالب) |
| `{{ .ConfirmationURL }}` يظهر كنص | أنت في صفحة Preview في Supabase — في الإيميل الفعلي سيُستبدَل |

---

## 📋 قائمة فحص قبل الإطلاق

- [ ] نطاقك مُتحقّق منه في Resend (✅ Verified)
- [ ] API Key أُنشِئ ومحفوظ بأمان
- [ ] SMTP في Supabase مُفعَّل ومحفوظ
- [ ] القوالب الأربعة منسوخة في Supabase
- [ ] Redirect URLs مضافة (`akked://**`)
- [ ] جربت إرسال إيميل تجريبي ووصل بنجاح
- [ ] فتحت الرابط من الهاتف وعمل التطبيق
