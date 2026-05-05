/*
  AkkedApp UI fix patch
  يطبق التعديلات التالية:
  1) تصحيح اسم التطبيق إلى: أكِّد
  2) رفع/إبعاد إشعار نجاح إضافة الحركة عن لوحة المفاتيح عبر إغلاق الكيبورد قبل ظهور التنبيه
  3) تغيير زر "مشاركة الحساب" إلى زر "واتساب" وربطه بدالة واتساب الخاصة بالعميل
  4) إضافة دالة لحساب الرصيد بعد كل حركة، ومحاولة استبدال نص "من العميل/للعميل" تحت المبلغ بهذا الرصيد

  طريقة التشغيل:
  ضع هذا الملف داخل مجلد AkkedApp ثم نفذ:
  node apply_customer_details_ui_fix.js
*/

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const report = [];

function filePath(...parts) {
  return path.join(root, ...parts);
}

function exists(file) {
  return fs.existsSync(file);
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function write(file, content) {
  fs.writeFileSync(file, content, 'utf8');
}

function backup(file) {
  const backupFile = `${file}.bak_${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(file, backupFile);
  report.push(`نسخة احتياطية: ${path.relative(root, backupFile)}`);
}

function replaceAllCount(content, searchValue, replaceValue) {
  let count = 0;
  const next = content.replace(searchValue, (...args) => {
    count += 1;
    if (typeof replaceValue === 'function') return replaceValue(...args);
    return replaceValue;
  });
  return { content: next, count };
}

function patchFile(relativePath, patcher) {
  const full = filePath(...relativePath.split('/'));
  if (!exists(full)) {
    report.push(`لم أجد الملف: ${relativePath}`);
    return;
  }
  const original = read(full);
  const patched = patcher(original, relativePath);
  if (patched !== original) {
    backup(full);
    write(full, patched);
    report.push(`تم تعديل: ${relativePath}`);
  } else {
    report.push(`لم يتغير الملف: ${relativePath}`);
  }
}

function patchAppName(content) {
  // الكسرة تحت الشدة: أكِّد وليس أكَّد
  return content
    .replace(/أكَّد/g, 'أكِّد')
    .replace(/جلال/g, 'أكِّد');
}

function addKeyboardImport(content) {
  if (/\bKeyboard\b/.test(content)) return content;

  // إضافة Keyboard داخل import react-native
  return content.replace(
    /import\s*\{([\s\S]*?)\}\s*from\s*['"]react-native['"];?/,
    (match, imports) => {
      if (imports.includes('Keyboard')) return match;
      const cleaned = imports.trim();
      const nextImports = cleaned.endsWith(',') ? `${cleaned} Keyboard,` : `${cleaned}, Keyboard`;
      return `import {\n${nextImports}\n} from 'react-native';`;
    }
  );
}

function patchQuickAddMovementSheet(content) {
  let next = addKeyboardImport(content);

  const successAlertRegex = /Alert\.alert\(\s*['"]نجح['"]\s*,\s*pendingMessage\s*,\s*\[\s*\{\s*text:\s*['"]حسناً['"]\s*,\s*onPress:\s*onClose\s*,?\s*\}\s*\]\s*\);/m;

  if (successAlertRegex.test(next) && !/Keyboard\.dismiss\(\);\s*setTimeout\(\(\)\s*=>\s*\{\s*Alert\.alert\(\s*['"]نجح['"]\s*,\s*pendingMessage/.test(next)) {
    next = next.replace(
      successAlertRegex,
      `Keyboard.dismiss();\n        setTimeout(() => {\n          Alert.alert('نجح', pendingMessage, [\n            {\n              text: 'حسناً',\n              onPress: onClose,\n            },\n          ]);\n        }, 250);`
    );
    report.push('تم تعديل تنبيه نجاح إضافة الحركة: إغلاق لوحة المفاتيح قبل التنبيه.');
  } else if (/Alert\.alert\(\s*['"]نجح['"]\s*,\s*pendingMessage/.test(next)) {
    // خطة احتياطية إذا كان تنسيق الكود مختلفاً
    next = next.replace(
      /Alert\.alert\(\s*['"]نجح['"]\s*,\s*pendingMessage/,
      `Keyboard.dismiss();\n        setTimeout(() => Alert.alert('نجح', pendingMessage`
    );
    next = next.replace(/\]\s*\);\s*\n\s*}\s*catch \(error\)/, `]);\n        }, 250);\n      } catch (error)`);
    report.push('تم تطبيق تعديل احتياطي لتنبيه نجاح الحركة.');
  } else {
    report.push('تنبيه: لم أجد Alert النجاح في QuickAddMovementSheet، راجع الملف يدوياً.');
  }

  return next;
}

const runningBalanceHelpers = `
function calculateRunningBalanceAfterMovement(
  movement: AccountMovement,
  allMovements: AccountMovement[],
): number {
  const movementTime = new Date(movement.created_at).getTime();
  const movementId = String(movement.id || '');

  return allMovements
    .filter((item) => shouldIncludeMovementInBalance(item))
    .filter((item) => item.currency === movement.currency)
    .filter((item) => {
      const itemTime = new Date(item.created_at).getTime();
      if (itemTime < movementTime) return true;
      if (itemTime > movementTime) return false;
      return String(item.id || '') <= movementId;
    })
    .sort((a, b) => {
      const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (timeDiff !== 0) return timeDiff;
      return String(a.id || '').localeCompare(String(b.id || ''));
    })
    .reduce((sum, item) => {
      const amount = Number(item.amount) || 0;
      return item.movement_type === 'incoming' ? sum + amount : sum - amount;
    }, 0);
}

function formatMovementBalanceLabel(
  movement: AccountMovement,
  allMovements: AccountMovement[],
): string {
  if (!shouldIncludeMovementInBalance(movement)) {
    const status = normalizeMovementApprovalStatus(movement);
    if (status === 'pending') return 'بانتظار الموافقة';
    if (status === 'rejected') return 'مرفوضة';
    return 'لا تؤثر في الرصيد';
  }

  const balance = calculateRunningBalanceAfterMovement(movement, allMovements);
  const symbol = getCurrencySymbol(movement.currency);
  const amount = Math.round(Math.abs(balance));

  if (balance > 0) return \`الرصيد بعد الحركة: \${amount} \${symbol} له\`;
  if (balance < 0) return \`الرصيد بعد الحركة: \${amount} \${symbol} عليه\`;
  return 'الرصيد بعد الحركة: متساوي';
}
`;

function addRunningBalanceHelpers(content) {
  if (content.includes('function formatMovementBalanceLabel(')) return content;

  // نضيف الدوال بعد shouldIncludeMovementInBalance لأنها تستخدمها
  const markerRegex = /function\s+shouldIncludeMovementInBalance\s*\([^)]*\)\s*:\s*boolean\s*\{[\s\S]*?\n\}/m;
  if (markerRegex.test(content)) {
    return content.replace(markerRegex, (match) => `${match}\n${runningBalanceHelpers}`);
  }

  // احتياط: نضيفها قبل getCombinedAmount إذا لم نتمكن من تحديد الدالة السابقة
  if (/function\s+getCombinedAmount\s*\(/.test(content)) {
    return content.replace(/function\s+getCombinedAmount\s*\(/, `${runningBalanceHelpers}\nfunction getCombinedAmount(`);
  }

  report.push('تنبيه: لم أستطع إضافة دوال الرصيد بعد الحركة تلقائياً.');
  return content;
}

function patchMovementBalanceLabel(content) {
  let next = content;
  let total = 0;

  const replacements = [
    {
      re: /\{\s*movement\.movement_type\s*===\s*['"]outgoing['"]\s*\?\s*['"]من العميل['"]\s*:\s*['"]للعميل['"]\s*\}/g,
      value: '{formatMovementBalanceLabel(movement, approvedMovements)}',
    },
    {
      re: /movement\.movement_type\s*===\s*['"]outgoing['"]\s*\?\s*['"]من العميل['"]\s*:\s*['"]للعميل['"]/g,
      value: 'formatMovementBalanceLabel(movement, approvedMovements)',
    },
    {
      re: /\{\s*movement\.movement_type\s*===\s*['"]incoming['"]\s*\?\s*['"]للعميل['"]\s*:\s*['"]من العميل['"]\s*\}/g,
      value: '{formatMovementBalanceLabel(movement, approvedMovements)}',
    },
    {
      re: /movement\.movement_type\s*===\s*['"]incoming['"]\s*\?\s*['"]للعميل['"]\s*:\s*['"]من العميل['"]/g,
      value: 'formatMovementBalanceLabel(movement, approvedMovements)',
    },
    {
      re: /\{\s*getMovementCreatorLabel\(\s*movement\s*,\s*currentUser\s*\)\s*\}/g,
      value: '{formatMovementBalanceLabel(movement, approvedMovements)}',
    },
    {
      re: /getMovementCreatorLabel\(\s*movement\s*,\s*currentUser\s*\)/g,
      value: 'formatMovementBalanceLabel(movement, approvedMovements)',
    },
  ];

  for (const { re, value } of replacements) {
    const result = replaceAllCount(next, re, value);
    next = result.content;
    total += result.count;
  }

  // محاولة إضافية إذا كان النص داخل Text مباشر بدون تعبير واضح
  next = next.replace(/>\s*من العميل\s*</g, () => {
    total += 1;
    return '>{formatMovementBalanceLabel(movement, approvedMovements)}<';
  });
  next = next.replace(/>\s*للعميل\s*</g, () => {
    total += 1;
    return '>{formatMovementBalanceLabel(movement, approvedMovements)}<';
  });

  if (total > 0) {
    report.push(`تم استبدال نص تحت المبلغ بالرصيد بعد الحركة في ${total} موضع.`);
  } else {
    report.push('تنبيه: لم أجد نص من العميل/للعميل أو getMovementCreatorLabel داخل جدول الحركات. قد تحتاج تعديل موضع العرض يدوياً.');
  }

  return next;
}

function patchShareButtonToWhatsApp(content) {
  let next = content;
  let total = 0;

  // تغيير عنوان الزر فقط؛ أما عنوان Alert الاحتياطي سيصبح واتساب أيضاً ولا يضر
  const textResult = replaceAllCount(next, /مشاركة الحساب/g, 'واتساب');
  next = textResult.content;
  total += textResult.count;

  const pressPatterns = [
    /onPress\s*=\s*\{\s*handleShareAccount\s*\}/g,
    /onPress\s*=\s*\{\s*\(\s*\)\s*=>\s*handleShareAccount\s*\(\s*\)\s*\}/g,
    /onPress\s*=\s*\{\s*async\s*\(\s*\)\s*=>\s*handleShareAccount\s*\(\s*\)\s*\}/g,
  ];

  for (const re of pressPatterns) {
    const result = replaceAllCount(next, re, 'onPress={handleWhatsApp}');
    next = result.content;
    total += result.count;
  }

  if (total > 0) {
    report.push(`تم تعديل زر مشاركة الحساب/واتساب في ${total} موضع.`);
  } else {
    report.push('تنبيه: لم أجد زر مشاركة الحساب لتعديله تلقائياً.');
  }

  return next;
}

function patchCustomerDetails(content) {
  let next = content;
  next = addRunningBalanceHelpers(next);
  next = patchMovementBalanceLabel(next);
  next = patchShareButtonToWhatsApp(next);
  return next;
}

// تنفيذ التعديلات
patchFile('app/(tabs)/index.tsx', patchAppName);
patchFile('components/QuickAddMovementSheet.tsx', patchQuickAddMovementSheet);
patchFile('app/customer-details.tsx', patchCustomerDetails);

const reportText = [
  'تقرير تطبيق تعديلات AkkedApp',
  '================================',
  ...report,
  '',
  'بعد التشغيل نفذ:',
  'npx tsc --noEmit',
  'npm run dev',
].join('\n');

write(filePath('PATCH_CUSTOMER_DETAILS_UI_REPORT.txt'), reportText);
console.log(reportText);
