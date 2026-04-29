const fs = require('fs');
const path = require('path');

const root = process.cwd();
const backupDir = path.join(root, '.settings-shop-move-backup');

const settingsPath = path.join(root, 'app', '(tabs)', 'settings.tsx');
const shopSettingsPath = path.join(root, 'app', 'shop-settings.tsx');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function backupFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  ensureDir(backupDir);
  const backupPath = path.join(
    backupDir,
    `${path.basename(filePath)}.${Date.now()}.bak`,
  );
  fs.copyFileSync(filePath, backupPath);
  console.log(`Backup created: ${backupPath}`);
}

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function writeFile(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Updated: ${filePath}`);
}

function cleanLucideImport(content, removeNames = [], addNames = []) {
  const lucideRegex =
    /import\s*\{([\s\S]*?)\}\s*from\s*['"]lucide-react-native['"]\s*;/;

  const match = content.match(lucideRegex);
  if (!match) return content;

  let names = match[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  names = names.filter((name) => !removeNames.includes(name));

  addNames.forEach((name) => {
    if (!names.includes(name)) {
      names.push(name);
    }
  });

  const replacement = `import { ${names.join(', ')} } from 'lucide-react-native';`;
  return content.replace(lucideRegex, replacement);
}

function removeMenuItemByTitle(content, title) {
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const patterns = [
    new RegExp(
      `\\{[\\s\\S]*?title:\\s*['"]${escapedTitle}['"][\\s\\S]*?\\},\\s*`,
      'g',
    ),
    new RegExp(
      `,\\s*\\{[\\s\\S]*?title:\\s*['"]${escapedTitle}['"][\\s\\S]*?\\}`,
      'g',
    ),
  ];

  let next = content;
  for (const pattern of patterns) {
    next = next.replace(pattern, '');
  }

  next = next.replace(/const\s+menuItems\s*=\s*\[\s*,/g, 'const menuItems = [');
  next = next.replace(/,\s*,/g, ',');
  next = next.replace(/\[\s*,/g, '[');
  next = next.replace(/,\s*\]/g, ']');

  return next;
}

function patchSettingsScreen() {
  if (!fs.existsSync(settingsPath)) {
    throw new Error(`Missing file: ${settingsPath}`);
  }

  backupFile(settingsPath);
  let content = readFile(settingsPath);
  const original = content;

  content = removeMenuItemByTitle(content, 'الترويسة والطباعة');
  content = removeMenuItemByTitle(content, 'إدارة المستخدمين');

  content = cleanLucideImport(content, ['Users', 'FileText'], []);

  if (content !== original) {
    writeFile(settingsPath, content);
  } else {
    console.log('No changes needed in settings.tsx');
  }
}

function patchShopSettingsScreen() {
  if (!fs.existsSync(shopSettingsPath)) {
    throw new Error(`Missing file: ${shopSettingsPath}`);
  }

  backupFile(shopSettingsPath);
  let content = readFile(shopSettingsPath);
  const original = content;

  content = cleanLucideImport(content, [], ['FileText', 'Printer']);

  if (!content.includes('shopHeaderPrintSectionMarker')) {
    const section = `
        {/* shopHeaderPrintSectionMarker */}
        <View style={styles.extraCard}>
          <Text style={styles.extraCardTitle}>الترويسة والطباعة</Text>
          <Text style={styles.extraCardSubtitle}>
            تم نقل إعدادات الترويسة والطباعة إلى داخل إعدادات المحل لتكون أسهل وأوضح.
          </Text>

          <TouchableOpacity
            style={styles.extraLinkRow}
            onPress={() => router.push('/customer-header-settings' as any)}
          >
            <View style={styles.extraIconWrap}>
              <FileText size={18} color="#2563EB" />
            </View>
            <View style={styles.extraTextWrap}>
              <Text style={styles.extraLinkTitle}>إعدادات الترويسة</Text>
              <Text style={styles.extraLinkSubtitle}>
                تعديل الترويسة والعناصر الظاهرة أعلى الصفحة
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.extraLinkRow}
            onPress={() => router.push('/letterhead-settings' as any)}
          >
            <View style={[styles.extraIconWrap, styles.extraIconWrapGreen]}>
              <Printer size={18} color="#16A34A" />
            </View>
            <View style={styles.extraTextWrap}>
              <Text style={styles.extraLinkTitle}>إعدادات الطباعة</Text>
              <Text style={styles.extraLinkSubtitle}>
                التحكم في شكل الطباعة والتنسيق العام للسندات
              </Text>
            </View>
          </TouchableOpacity>
        </View>
`;

    if (content.includes('<View style={styles.footer}>')) {
      content = content.replace(
        '<View style={styles.footer}>',
        `${section}\n      <View style={styles.footer}>`,
      );
    } else if (content.includes('</ScrollView>')) {
      content = content.replace(
        '</ScrollView>',
        `${section}\n      </ScrollView>`,
      );
    } else {
      throw new Error(
        'Could not find insertion point in app/shop-settings.tsx',
      );
    }
  }

  if (!content.includes('extraCard:')) {
    const stylesBlock = `
  extraCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  extraCardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'right',
    marginBottom: 6,
  },
  extraCardSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'right',
    lineHeight: 20,
    marginBottom: 12,
  },
  extraLinkRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginTop: 10,
  },
  extraIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  extraIconWrapGreen: {
    backgroundColor: '#ECFDF5',
  },
  extraTextWrap: {
    flex: 1,
  },
  extraLinkTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'right',
    marginBottom: 4,
  },
  extraLinkSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'right',
    lineHeight: 18,
  },
`;

    content = content.replace(/\}\);\s*$/, `${stylesBlock}\n});`);
  }

  if (content !== original) {
    writeFile(shopSettingsPath, content);
  } else {
    console.log('No changes needed in shop-settings.tsx');
  }
}

try {
  patchSettingsScreen();
  patchShopSettingsScreen();

  console.log('');
  console.log('Done successfully.');
  console.log('Next steps:');
  console.log('1) npm run typecheck');
  console.log('2) npx expo start -c');
} catch (error) {
  console.error('Patch failed:', error.message);
  process.exit(1);
}
