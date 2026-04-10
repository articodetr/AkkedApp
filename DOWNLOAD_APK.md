# تحميل ملف APK

## الطريقة الأولى: من المتصفح (موصى بها)

1. افتح الرابط التالي:
   ```
   https://expo.dev/accounts/arti_codetr/projects/altarf-money-transfer/builds
   ```

2. انقر على آخر بناء ناجح (سيكون أخضر اللون)

3. اضغط على زر **"Download"** لتحميل ملف APK

---

## الطريقة الثانية: باستخدام سطر الأوامر

### تحميل آخر APK:
```bash
bash download-apk.sh
```

أو استخدم الأمر مباشرة:
```bash
npx eas-cli build:download --platform android --latest --output ./altarf-app.apk
```

---

## الطريقة الثالثة: تحميل بناء محدد

إذا كنت تريد تحميل بناء معين باستخدام Build ID:

```bash
npx eas-cli build:download --id YOUR_BUILD_ID --output ./altarf-app.apk
```

مثال للبناء الحالي:
```bash
npx eas-cli build:download --id 47f31411-e910-41b7-b4e9-763daa94eaf3 --output ./altarf-app.apk
```

---

## ملاحظات مهمة:

- انتظر حتى يكتمل البناء قبل التحميل (15-30 دقيقة)
- يمكنك التحقق من حالة البناء في لوحة Expo
- ملف APK سيتم حفظه في مجلد المشروع باسم `altarf-app.apk`
