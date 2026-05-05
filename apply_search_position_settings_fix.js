/*
  AkkedApp - إصلاح ارتفاع البحث وإصلاح أيقونة الإعدادات في صفحة تفاصيل العميل

  المطلوب:
  1) جعل خانة البحث ترتفع ارتفاعاً متوسطاً فوق الكيبورد، وليس كثيراً.
  2) إصلاح أيقونة الإعدادات في أعلى صفحة تفاصيل العميل حتى لا يعلق التطبيق.
  3) استبدال قائمة إدارة العميل بقائمة آمنة بدون خيار إرسال واتساب.

  طريقة الاستخدام:
  1) ضع هذا الملف داخل مجلد AkkedApp الرئيسي.
  2) شغّل:
     node apply_search_position_settings_fix.js
     npx tsc --noEmit
     npm run dev
*/

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const relativePath = path.join('app', 'customer-details.tsx');
const target = path.join(root, relativePath);
const reportPath = path.join(root, 'PATCH_SEARCH_POSITION_SETTINGS_REPORT.txt');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!fs.existsSync(target)) {
  fail(`لم أجد الملف: ${relativePath}`);
}

const original = fs.readFileSync(target, 'utf8');
let code = original;
const changes = [];
const warnings = [];

function replaceIfChanged(label, replacer) {
  const before = code;
  code = replacer(code);
  if (code !== before) changes.push(label);
}

function findTagBlocks(source, tagName) {
  const blocks = [];
  const openToken = `<${tagName}`;
  const closeToken = `</${tagName}>`;
  let index = 0;

  while (index < source.length) {
    const start = source.indexOf(openToken, index);
    if (start === -1) break;

    let cursor = start + openToken.length;
    let depth = 1;

    while (cursor < source.length && depth > 0) {
      const nextOpen = source.indexOf(openToken, cursor);
      const nextClose = source.indexOf(closeToken, cursor);
      if (nextClose === -1) break;

      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth += 1;
        cursor = nextOpen + openToken.length;
      } else {
        depth -= 1;
        cursor = nextClose + closeToken.length;
      }
    }

    if (depth === 0) {
      blocks.push({ start, end: cursor, text: source.slice(start, cursor) });
      index = cursor;
    } else {
      warnings.push(`لم أستطع قراءة بلوك ${tagName} بشكل كامل عند الموضع ${start}.`);
      break;
    }
  }

  return blocks;
}

const SAFE_SETTINGS_MENU = `
      {/* Akked safe customer settings menu */}
      <Modal
        visible={showSettingsMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSettingsMenu(false)}
      >
        <View style={styles.settingsOverlay}>
          <TouchableOpacity
            style={styles.settingsBackdrop}
            activeOpacity={1}
            onPress={() => setShowSettingsMenu(false)}
          />

          <View style={styles.settingsSheet}>
            <Text style={styles.settingsSheetTitle}>إدارة العميل</Text>
            <Text style={styles.settingsSheetSubtitle}>{customer?.name}</Text>

            <TouchableOpacity
              style={styles.settingsMenuItem}
              activeOpacity={0.75}
              onPress={() => {
                setShowSettingsMenu(false);
                router.push({
                  pathname: '/add-customer',
                  params: { id: String(customer?.id || id || '') },
                });
              }}
            >
              <Text style={styles.settingsMenuItemText}>تعديل البيانات</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.settingsMenuItem}
              activeOpacity={0.75}
              onPress={() => {
                setShowSettingsMenu(false);
                setTimeout(handleResetAccount, 150);
              }}
            >
              <Text style={[styles.settingsMenuItemText, styles.settingsMenuItemDanger]}>
                تصفير الحساب
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.settingsMenuItem}
              activeOpacity={0.75}
              onPress={() => {
                setShowSettingsMenu(false);
                setTimeout(handleDeleteCustomer, 150);
              }}
            >
              <Text style={[styles.settingsMenuItemText, styles.settingsMenuItemDanger]}>
                حذف العميل
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.settingsCancelButton}
              activeOpacity={0.75}
              onPress={() => setShowSettingsMenu(false)}
            >
              <Text style={styles.settingsCancelText}>إلغاء</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
`;

const SAFE_SETTINGS_STYLES = `
  settingsOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  settingsBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  settingsSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 30,
  },
  settingsSheetTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 6,
  },
  settingsSheetSubtitle: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 22,
  },
  settingsMenuItem: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  settingsMenuItemText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'right',
  },
  settingsMenuItemDanger: {
    color: '#DC2626',
  },
  settingsCancelButton: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsCancelText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#334155',
  },
`;

// 1) اجعل رفع البحث متوسطاً: كان 440 في التعديل السابق وهذا يرفعه كثيراً.
replaceIfChanged('تقليل ارتفاع خانة البحث إلى مستوى متوسط', (src) =>
  src.replace(/scrollTo\(\{\s*y:\s*\d+\s*,\s*animated:\s*true\s*\}\)/g, 'scrollTo({ y: 230, animated: true })')
);

// إذا لم يكن تعديل البحث موجوداً من قبل، أضفه ولكن بقيمة متوسطة.
if (!/searchScrollRef/.test(code)) {
  replaceIfChanged('إضافة useRef لتحريك صفحة البحث', (src) =>
    src.replace(
      /import\s*\{\s*useState\s*,\s*useEffect\s*,\s*useCallback\s*\}\s*from\s*['"]react['"];?/,
      "import { useState, useEffect, useCallback, useRef } from 'react';"
    )
  );

  replaceIfChanged('إضافة دالة رفع البحث بشكل متوسط', (src) =>
    src.replace(
      /const\s*\[searchQuery\s*,\s*setSearchQuery\]\s*=\s*useState\(['"]['"]\);?/, 
      (m) => `${m}\n  const searchScrollRef = useRef<ScrollView>(null);\n\n  const focusSearchInput = () => {\n    setTimeout(() => {\n      searchScrollRef.current?.scrollTo({ y: 230, animated: true });\n    }, 220);\n  };`
    )
  );
}

// 2) قلل مساحة أسفل الصفحة؛ 180 كانت كثيرة لبعض الشاشات.
replaceIfChanged('تقليل paddingBottom في contentScrollContainer', (src) =>
  src.replace(/(contentScrollContainer\s*:\s*\{[\s\S]*?paddingBottom\s*:\s*)\d+(\s*,?[\s\S]*?\})/g, '$1120$2')
);

// 3) تأكد أن ScrollView مجهز للكيبورد إذا لم يكن كذلك.
if (!/ref=\{searchScrollRef\}/.test(code)) {
  replaceIfChanged('تجهيز ScrollView لتحريك خانة البحث', (src) =>
    src.replace(
      /<ScrollView\s+style=\{styles\.content\}>/,
      '<ScrollView\n        ref={searchScrollRef}\n        style={styles.content}\n        keyboardShouldPersistTaps="handled"\n        contentContainerStyle={styles.contentScrollContainer}\n      >'
    )
  );
}

// 4) تأكد أن خانة البحث تستدعي دالة التركيز.
if (!/onFocus=\{focusSearchInput\}/.test(code) && /focusSearchInput/.test(code)) {
  replaceIfChanged('إضافة onFocus لخانة البحث', (src) =>
    src.replace(/<TextInput\b[\s\S]*?placeholder=(['"])ابحث في الحركات[\s\S]*?\/?>/, (block) => {
      if (/onFocus=/.test(block)) return block;
      return block.replace(/\s*\/?>\s*$/, '\n          onFocus={focusSearchInput}\n        />');
    })
  );
}

// 5) تأكد أن زر الترس يفتح القائمة فقط ولا ينفذ أي دالة قديمة.
replaceIfChanged('تثبيت onPress لأيقونة الإعدادات', (src) =>
  src.replace(/(<TouchableOpacity\s+[\s\S]*?style=\{styles\.settingsButton\}[\s\S]*?)onPress=\{[\s\S]*?\}([\s\S]*?>\s*<Settings\b)/, '$1onPress={() => setShowSettingsMenu(true)}$2')
);

// 6) استبدل أي Modal قديم مرتبط بـ showSettingsMenu بقائمة آمنة لا تعلق التطبيق.
(function replaceSettingsModal() {
  const blocks = findTagBlocks(code, 'Modal');
  const settingsBlocks = blocks.filter((b) => /showSettingsMenu/.test(b.text));

  if (settingsBlocks.length > 0) {
    let out = '';
    let cursor = 0;
    let replaced = 0;

    for (const block of blocks) {
      out += code.slice(cursor, block.start);
      if (/showSettingsMenu/.test(block.text)) {
        if (replaced === 0) {
          out += SAFE_SETTINGS_MENU;
        }
        replaced += 1;
      } else {
        out += block.text;
      }
      cursor = block.end;
    }
    out += code.slice(cursor);

    if (out !== code) {
      code = out;
      changes.push(`استبدال ${settingsBlocks.length} قائمة إعدادات قديمة بقائمة آمنة`);
    }
  } else if (!code.includes('Akked safe customer settings menu')) {
    const before = code;
    code = code.replace(/<ScrollView\b/, `${SAFE_SETTINGS_MENU}\n      <ScrollView`);
    if (code !== before) {
      changes.push('إضافة قائمة إعدادات آمنة جديدة');
    } else {
      warnings.push('لم أستطع إدراج قائمة الإعدادات الآمنة قبل ScrollView.');
    }
  }
})();

// 7) أضف/ثبّت أنماط القائمة الجديدة.
if (!/settingsSheetTitle\s*:/.test(code)) {
  replaceIfChanged('إضافة أنماط قائمة الإعدادات الآمنة', (src) =>
    src.replace(/const\s+styles\s*=\s*StyleSheet\.create\(\{/, (m) => `${m}\n${SAFE_SETTINGS_STYLES}`)
  );
}

// 8) إذا لم يكن contentScrollContainer موجوداً أضفه بقيمة خفيفة.
if (!/contentScrollContainer\s*:/.test(code)) {
  replaceIfChanged('إضافة contentScrollContainer بقيمة خفيفة', (src) =>
    src.replace(/content\s*:\s*\{\s*flex\s*:\s*1\s*,?\s*\},/, (m) => `${m}\n  contentScrollContainer: {\n    paddingBottom: 120,\n  },`)
  );
}

// 9) تنظيف خيار إرسال واتساب داخل أي قائمة قديمة لو بقيت صدفة.
if (/إرسال\s+واتساب/.test(code)) {
  replaceIfChanged('حذف أي بقايا لخيار إرسال واتساب من قائمة الإدارة', (src) =>
    src.replace(/\s*<TouchableOpacity\b[\s\S]*?إرسال\s+واتساب[\s\S]*?<\/TouchableOpacity>/g, '')
  );
}

const report = [];
report.push('تقرير إصلاح موضع البحث وأيقونة الإعدادات');
report.push('=========================================');
report.push('');

if (changes.length === 0) {
  report.push('- لم يتغير الملف. قد يكون التعديل مطبقاً مسبقاً أو أن تنسيق الملف مختلف.');
} else {
  const backup = `${target}.bak-${stamp}`;
  fs.copyFileSync(target, backup);
  fs.writeFileSync(target, code, 'utf8');
  report.push(`- تم تعديل الملف: ${relativePath}`);
  report.push(`- تم إنشاء نسخة احتياطية: ${path.relative(root, backup)}`);
  report.push('- التعديلات:');
  for (const item of Array.from(new Set(changes))) {
    report.push(`  • ${item}`);
  }
}

if (warnings.length > 0) {
  report.push('');
  report.push('تنبيهات:');
  for (const item of warnings) report.push(`- ${item}`);
}

report.push('');
report.push('بعد التشغيل نفّذ:');
report.push('npx tsc --noEmit');
report.push('npm run dev');

fs.writeFileSync(reportPath, report.join('\n'), 'utf8');
console.log(report.join('\n'));
