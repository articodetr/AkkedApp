const fs = require('fs');
const path = require('path');

const root = process.cwd();
const report = [];
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

function filePath(relativePath) {
  return path.join(root, relativePath);
}

function readFile(relativePath) {
  const target = filePath(relativePath);
  if (!fs.existsSync(target)) {
    throw new Error(`لم أجد الملف: ${relativePath}`);
  }
  return { target, text: fs.readFileSync(target, 'utf8') };
}

function writeFile(target, original, next, label) {
  if (original === next) {
    report.push(`- ${label}: لم يتغير، قد يكون معدلاً مسبقاً أو أن نمط الكود مختلف.`);
    return false;
  }
  fs.writeFileSync(`${target}.bak-${stamp}`, original, 'utf8');
  fs.writeFileSync(target, next, 'utf8');
  report.push(`- ${label}: تم التعديل بنجاح. تم إنشاء نسخة احتياطية: ${path.basename(target)}.bak-${stamp}`);
  return true;
}

function patchCustomerDetails() {
  const relativePath = path.join('app', 'customer-details.tsx');
  const { target, text: original } = readFile(relativePath);
  let code = original;
  let changes = [];

  // Add useRef to React import for auto-scrolling the search field when keyboard opens.
  if (!/useRef/.test((code.match(/import\s*\{[^}]+\}\s*from\s*['"]react['"];?/) || [''])[0])) {
    const before = code;
    code = code.replace(
      /import\s*\{\s*useState\s*,\s*useEffect\s*,\s*useCallback\s*\}\s*from\s*['"]react['"];?/, 
      "import { useState, useEffect, useCallback, useRef } from 'react';"
    );
    if (code !== before) changes.push('إضافة useRef');
  }

  // Add a ScrollView ref and helper near searchQuery state.
  if (!code.includes('const searchScrollRef = useRef<ScrollView>(null);')) {
    const before = code;
    code = code.replace(
      /const\s*\[searchQuery\s*,\s*setSearchQuery\]\s*=\s*useState\(['"]['"]\);?/, 
      (m) => `${m}\n  const searchScrollRef = useRef<ScrollView>(null);\n\n  const focusSearchInput = () => {\n    setTimeout(() => {\n      searchScrollRef.current?.scrollTo({ y: 440, animated: true });\n    }, 220);\n  };`
    );
    if (code !== before) changes.push('إضافة دالة رفع خانة البحث');
  }

  // Patch the main ScrollView so the content can move cleanly above the keyboard.
  if (!code.includes('ref={searchScrollRef}')) {
    const before = code;
    code = code.replace(
      /<ScrollView\s+style=\{styles\.content\}>/, 
      '<ScrollView\n        ref={searchScrollRef}\n        style={styles.content}\n        keyboardShouldPersistTaps="handled"\n        contentContainerStyle={styles.contentScrollContainer}\n      >'
    );
    if (code !== before) changes.push('تجهيز ScrollView للكيبورد');
  }

  // Add onFocus to the movements search TextInput.
  if (!code.includes('onFocus={focusSearchInput}')) {
    const before = code;
    code = code.replace(
      /<TextInput\b[\s\S]*?placeholder=(['"])ابحث في الحركات[\s\S]*?\/?>/,
      (block) => {
        if (block.includes('onFocus=')) return block;
        return block.replace(/\s*\/?>\s*$/, '\n          onFocus={focusSearchInput}\n        />');
      }
    );
    if (code !== before) {
      changes.push('إضافة onFocus لخانة البحث');
    } else {
      // fallback: first TextInput using styles.searchInput
      code = code.replace(
        /<TextInput\b[\s\S]*?style=\{styles\.searchInput\}[\s\S]*?\/?>/,
        (block) => {
          if (block.includes('onFocus=')) return block;
          return block.replace(/\s*\/?>\s*$/, '\n          onFocus={focusSearchInput}\n        />');
        }
      );
      if (code !== before) changes.push('إضافة onFocus لخانة البحث بطريقة بديلة');
    }
  }

  // Add extra bottom padding for scrollable content.
  if (!code.includes('contentScrollContainer:')) {
    const before = code;
    code = code.replace(
      /content:\s*\{\s*flex:\s*1\s*,?\s*\},/, 
      (m) => `${m}\n  contentScrollContainer: {\n    paddingBottom: 180,\n  },`
    );
    if (code !== before) changes.push('إضافة مساحة أسفل الصفحة للكيبورد');
  }

  // Remove the red-marked menu item: إدارة العميل > إرسال واتساب.
  if (code.includes('إرسال واتساب')) {
    const before = code;
    code = code.replace(/\s*<TouchableOpacity\b[\s\S]*?<\/TouchableOpacity>/g, (block) => {
      if (block.includes('إرسال واتساب') && block.includes('handleWhatsApp')) {
        return '';
      }
      return block;
    });
    if (code !== before) changes.push('حذف خيار إرسال واتساب من قائمة إدارة العميل');
  }

  if (changes.length === 0) {
    report.push(`- ${relativePath}: لم أجد أنماط التعديل المطلوبة. أرسل الملف إذا بقيت المشكلة.`);
  } else {
    writeFile(target, original, code, relativePath + ` (${changes.join('، ')})`);
  }
}

function patchPinSettings() {
  const relativePath = path.join('app', 'pin-settings.tsx');
  const { target, text: original } = readFile(relativePath);
  let code = original;
  let changes = [];

  const replacements = [
    [/رقم PIN يجب أن يكون 8 أحرف على الأقل/g, 'رقم PIN يجب أن يكون 8 أرقام على الأقل'],
    [/رقم PIN يجب أن لا يزيد عن 16 حرف/g, 'رقم PIN يجب أن لا يزيد عن 16 رقم'],
    [/رقم PIN \(8-16 حرف: أرقام، أحرف، رموز\)/g, 'رقم PIN (8-16 رقم فقط)'],
    [/\{pin\.length\}\s*\/\s*16\s*حرف/g, '{pin.length} / 16 رقم'],
    [/• رقم PIN يجب أن يكون 8 أحرف على الأقل\{\\'\\n\\'\}\s*• الحد الأقصى 16 حرف\{\\'\\n\\'\}\s*• يمكن استخدام الأرقام والأحرف والرموز/g, "• رقم PIN يجب أن يكون 8 أرقام على الأقل{'\\n'} • الحد الأقصى 16 رقم{'\\n'} • يسمح بالأرقام فقط"],
    [/• رقم PIN يجب أن يكون 8 أحرف على الأقل\{\\n\}\s*• الحد الأقصى 16 حرف\{\\n\}\s*• يمكن استخدام الأرقام والأحرف والرموز/g, "• رقم PIN يجب أن يكون 8 أرقام على الأقل{'\\n'} • الحد الأقصى 16 رقم{'\\n'} • يسمح بالأرقام فقط"],
  ];

  for (const [pattern, value] of replacements) {
    const before = code;
    code = code.replace(pattern, value);
    if (code !== before) changes.push('تعديل نصوص PIN');
  }

  // Add numeric-only validation after length validation.
  if (!code.includes('رقم PIN يجب أن يحتوي على أرقام فقط')) {
    const before = code;
    code = code.replace(
      /if\s*\(pin\.length\s*>\s*16\)\s*\{[\s\S]*?return;\s*\}/,
      (m) => `${m}\n\n    if (!/^\\d+$/.test(pin)) {\n      Alert.alert('خطأ', 'رقم PIN يجب أن يحتوي على أرقام فقط');\n      return;\n    }`
    );
    if (code !== before) changes.push('إضافة تحقق أرقام فقط');
  }

  // Force TextInput to accept digits only.
  if (!code.includes("text.replace(/[^0-9]/g, '')")) {
    const before = code;
    code = code.replace(
      /onChangeText=\{\(text\)\s*=>\s*\{\s*if\s*\(text\.length\s*<=\s*16\)\s*\{\s*setPin\(text\);\s*\}\s*\}\}/,
      "onChangeText={(text) => {\n                const digitsOnly = text.replace(/[^0-9]/g, '');\n                if (digitsOnly.length <= 16) {\n                  setPin(digitsOnly);\n                }\n              }}"
    );
    if (code !== before) changes.push('منع إدخال غير الأرقام في الخانة');
  }

  // Add numeric keyboard props to the PIN input.
  if (!code.includes('keyboardType="number-pad"')) {
    const before = code;
    code = code.replace(
      /(maxLength=\{16\})/, 
      '$1\n              keyboardType="number-pad"\n              inputMode="numeric"'
    );
    if (code !== before) changes.push('إظهار لوحة أرقام');
  }

  // Fallback fixes for different formatting.
  if (code.includes('يمكن استخدام الأرقام والأحرف والرموز')) {
    code = code.replace(/يمكن استخدام الأرقام والأحرف والرموز/g, 'يسمح بالأرقام فقط');
    changes.push('تعديل نص المعلومات');
  }
  if (code.includes('16 حرف')) {
    code = code.replace(/16 حرف/g, '16 رقم');
    changes.push('تعديل 16 حرف إلى 16 رقم');
  }
  if (code.includes('8 أحرف')) {
    code = code.replace(/8 أحرف/g, '8 أرقام');
    changes.push('تعديل 8 أحرف إلى 8 أرقام');
  }

  if (changes.length === 0) {
    report.push(`- ${relativePath}: لم أجد أنماط التعديل المطلوبة. أرسل الملف إذا بقيت المشكلة.`);
  } else {
    writeFile(target, original, code, relativePath + ` (${Array.from(new Set(changes)).join('، ')})`);
  }
}

try {
  patchCustomerDetails();
  patchPinSettings();

  const reportText = [
    'تقرير تعديل خانة البحث وقائمة إدارة العميل ورقم PIN',
    '====================================================',
    '',
    ...report,
    '',
    'بعد الانتهاء شغّل:',
    'npx tsc --noEmit',
    'npm run dev',
  ].join('\n');

  fs.writeFileSync(path.join(root, 'PATCH_SEARCH_PIN_MENU_REPORT.txt'), reportText, 'utf8');
  console.log(reportText);
} catch (error) {
  console.error('فشل التعديل:', error.message);
  process.exit(1);
}
