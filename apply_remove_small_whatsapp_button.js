/*
  AkkedApp - إزالة زر واتساب الصغير وإضافة أيقونة للزر البرتقالي

  المطلوب:
  - حذف زر واتساب الأبيض/الصغير الموجود بجانب زر PDF.
  - إبقاء زر واتساب البرتقالي فقط.
  - إضافة أيقونة MessageCircle داخل الزر البرتقالي قبل كلمة واتساب.

  طريقة الاستخدام:
  1) ضع هذا الملف داخل مجلد AkkedApp الرئيسي.
  2) شغّل:
     node apply_remove_small_whatsapp_button.js
     npx tsc --noEmit
     npm run dev
*/

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const filePath = path.join(root, 'app', 'customer-details.tsx');
const reportPath = path.join(root, 'PATCH_REMOVE_SMALL_WHATSAPP_REPORT.txt');

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!fs.existsSync(filePath)) {
  fail(`لم أجد الملف: ${path.relative(root, filePath)}`);
}

const original = fs.readFileSync(filePath, 'utf8');
let src = original;
let removedCount = 0;
let patchedPrimaryCount = 0;
let iconAddedCount = 0;

function findTouchableBlocks(text) {
  const blocks = [];
  const openTag = '<TouchableOpacity';
  const closeTag = '</TouchableOpacity>';
  let index = 0;

  while (index < text.length) {
    const start = text.indexOf(openTag, index);
    if (start === -1) break;

    let cursor = start + openTag.length;
    let depth = 1;

    while (cursor < text.length && depth > 0) {
      const nextOpen = text.indexOf(openTag, cursor);
      const nextClose = text.indexOf(closeTag, cursor);

      if (nextClose === -1) break;

      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth += 1;
        cursor = nextOpen + openTag.length;
      } else {
        depth -= 1;
        cursor = nextClose + closeTag.length;
      }
    }

    if (depth === 0) {
      blocks.push({ start, end: cursor, text: text.slice(start, cursor) });
      index = cursor;
    } else {
      break;
    }
  }

  return blocks;
}

function normalizeArabic(value) {
  return value
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/آ/g, 'ا')
    .replace(/إ/g, 'ا')
    .replace(/أ/g, 'ا')
    .replace(/\s+/g, '');
}

function hasWhatsappText(block) {
  const compact = normalizeArabic(block);
  return compact.includes('واتساب') || compact.includes('واتسابق') || /WhatsApp|whatsapp/i.test(block);
}

function isClearlyOrangePrimary(block) {
  return /tabButtonPrimary|primaryButton|shareButton|orange|primaryWhatsapp|whatsappPrimary/i.test(block)
    || /tabButtonPrimaryText|primaryButtonText|shareButtonText|whatsappPrimaryText/i.test(block)
    || /#FF7A|#F973|#FB7|orange/i.test(block);
}

function isSmallSecondaryWhatsapp(block) {
  if (!hasWhatsappText(block)) return false;

  // لا نحذف الزر البرتقالي أو الأساسي.
  if (isClearlyOrangePrimary(block)) return false;

  // غالباً الزر الأبيض/الصغير يستخدم أحد هذه الأنماط.
  const looksSecondary = /tabButton\b|secondary|outline|ghost|actionButton|quickAction|pill|small|whatsappButton|buttonText/i.test(block);

  // غالباً الزر الصغير يفتح handleWhatsApp مباشرة أو يحتوي MessageCircle مع نص واتساب.
  const hasWhatsappHandler = /handleWhatsApp|openWhatsApp|sendWhatsApp|MessageCircle/i.test(block);

  return looksSecondary || hasWhatsappHandler;
}

function patchOrangeButton(block) {
  if (!isClearlyOrangePrimary(block)) return block;
  if (!hasWhatsappText(block) && !/مشاركة\s*الحساب/.test(block)) return block;

  let next = block;

  // اجعل النص واتساب إذا كان ما زال مشاركة الحساب.
  next = next.replace(/مشاركة\s*الحساب/g, 'واتساب');

  // اربط الزر البرتقالي بدالة handleWhatsApp لو كان مربوطاً بمشاركة الحساب.
  next = next.replace(/onPress=\{\s*handleShareAccount\s*\}/g, 'onPress={handleWhatsApp}');
  next = next.replace(/onPress=\{\s*\(\s*\)\s*=>\s*handleShareAccount\(\s*\)\s*\}/g, 'onPress={handleWhatsApp}');

  // أضف أيقونة للزر البرتقالي قبل نص واتساب إذا لم تكن موجودة.
  if (!/<MessageCircle\b[\s\S]*?color=\{?['\"]#FFFFFF['\"]\}?/i.test(next) && !/<MessageCircle\b[\s\S]*?color=\{?['\"]#fff['\"]\}?/i.test(next)) {
    const before = next;
    next = next.replace(
      /(\s*)<Text\s+style=\{styles\.[^}]*?(?:tabButtonPrimaryText|primaryButtonText|shareButtonText|whatsappPrimaryText)[^}]*?\}>\s*واتساب\s*<\/Text>/,
      (match, indent) => `${indent}<MessageCircle size={16} color="#FFFFFF" />\n${match}`
    );

    // احتياط إذا كان Text بدون style متوقع.
    if (next === before) {
      next = next.replace(
        /(\s*)<Text\b([^>]*)>\s*واتساب\s*<\/Text>/,
        (match, indent) => `${indent}<MessageCircle size={16} color="#FFFFFF" />\n${match}`
      );
    }

    if (next !== before) iconAddedCount += 1;
  }

  if (next !== block) patchedPrimaryCount += 1;
  return next;
}

// 1) احذف أزرار واتساب الصغيرة/الثانوية، وعدّل الزر البرتقالي.
const blocks = findTouchableBlocks(src);
if (blocks.length > 0) {
  let out = '';
  let cursor = 0;

  for (const block of blocks) {
    out += src.slice(cursor, block.start);

    if (isSmallSecondaryWhatsapp(block.text)) {
      removedCount += 1;
      // احذف أي فاصلة/فراغات زائدة بشكل آمن من نفس المكان فقط.
      out += '';
    } else {
      out += patchOrangeButton(block.text);
    }

    cursor = block.end;
  }

  out += src.slice(cursor);
  src = out;
}

// 2) احتياط: إذا بقيت تسمية مشاركة الحساب في أي مكان ظاهر، غيّرها إلى واتساب.
src = src.replace(/مشاركة\s*الحساب/g, 'واتساب');

// 3) احتياط قوي جداً: حذف أي TouchableOpacity يحتوي نص واتساب لكنه ليس زر Primary.
// هذا يعالج الحالات التي يكون فيها اسم style مختلف تماماً.
const blocksAfterFirstPass = findTouchableBlocks(src);
const whatsappBlocks = blocksAfterFirstPass.filter((b) => hasWhatsappText(b.text));
const primaryWhatsappBlocks = whatsappBlocks.filter((b) => isClearlyOrangePrimary(b.text));

if (whatsappBlocks.length > 1) {
  let keepIndex = -1;
  if (primaryWhatsappBlocks.length > 0) {
    keepIndex = blocksAfterFirstPass.indexOf(primaryWhatsappBlocks[0]);
  } else {
    // إذا لم نعرف الزر الأساسي، نترك آخر زر واتساب ونحذف الباقي حتى يختفي الزر الصغير.
    keepIndex = blocksAfterFirstPass.indexOf(whatsappBlocks[whatsappBlocks.length - 1]);
  }

  let out = '';
  let cursor = 0;
  for (let i = 0; i < blocksAfterFirstPass.length; i++) {
    const block = blocksAfterFirstPass[i];
    out += src.slice(cursor, block.start);
    if (hasWhatsappText(block.text) && i !== keepIndex) {
      removedCount += 1;
      out += '';
    } else {
      out += patchOrangeButton(block.text);
    }
    cursor = block.end;
  }
  out += src.slice(cursor);
  src = out;
}

// 4) تحقق نهائي مبسط.
const finalBlocks = findTouchableBlocks(src);
const finalWhatsappBlocks = finalBlocks.filter((b) => hasWhatsappText(b.text));
const finalSmallWhatsappBlocks = finalWhatsappBlocks.filter((b) => !isClearlyOrangePrimary(b.text));
const finalPrimaryHasIcon = finalWhatsappBlocks.some((b) => isClearlyOrangePrimary(b.text) && /<MessageCircle\b/i.test(b.text));

const report = [];

if (src !== original) {
  const backupPath = `${filePath}.bak_${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(filePath, backupPath);
  fs.writeFileSync(filePath, src, 'utf8');
  report.push('تم تعديل الملف: app/customer-details.tsx');
  report.push(`تم إنشاء نسخة احتياطية: ${path.relative(root, backupPath)}`);
} else {
  report.push('لم يتغير الملف. غالباً الزر مكتوب بطريقة مختلفة جداً عن المتوقع.');
}

report.push(`عدد أزرار واتساب الصغيرة المحذوفة: ${removedCount}`);
report.push(`عدد الأزرار البرتقالية المعدلة: ${patchedPrimaryCount}`);
report.push(`عدد أيقونات واتساب/رسالة المضافة: ${iconAddedCount}`);
report.push(`عدد أزرار واتساب المتبقية في الصفحة: ${finalWhatsappBlocks.length}`);

if (finalSmallWhatsappBlocks.length > 0) {
  report.push('تنبيه: ما زال يوجد زر واتساب غير أساسي. إذا ظهر في التطبيق، أرسل لي ملف app/customer-details.tsx كامل.');
} else {
  report.push('تم التأكد: لم يعد يوجد زر واتساب صغير/ثانوي حسب فحص الملف.');
}

if (!finalPrimaryHasIcon) {
  report.push('تنبيه: لم يتم تأكيد وجود الأيقونة داخل الزر البرتقالي.');
} else {
  report.push('تم التأكد: الزر البرتقالي يحتوي على أيقونة.');
}

report.push('');
report.push('بعد التشغيل نفّذ:');
report.push('npx tsc --noEmit');
report.push('npm run dev');

fs.writeFileSync(reportPath, report.join('\n'), 'utf8');
console.log(report.join('\n'));
