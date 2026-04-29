const fs = require('fs');
const path = require('path');

const root = process.cwd();
const appDir = path.join(root, 'app');
const backupDir = path.join(root, '.settings-restructure-backup');

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

function readFileSafe(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

function writeFileSafe(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Updated: ${filePath}`);
}

function getAllTsxFiles(dir) {
  const result = [];
  if (!fs.existsSync(dir)) return result;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...getAllTsxFiles(fullPath));
    } else if (entry.isFile() && fullPath.endsWith('.tsx')) {
      result.push(fullPath);
    }
  }
  return result;
}

function removeUsersManagementFromSettingsFiles() {
  const files = getAllTsxFiles(appDir);

  files.forEach((filePath) => {
    let content = readFileSafe(filePath);
    if (!content) return;

    const original = content;

    // Remove object items in arrays that point to users-management
    content = content.replace(
      /,\s*\{[\s\S]*?(href|route|path|screen)\s*:\s*['"`]\/?users-management['"`][\s\S]*?\}/g,
      '',
    );

    content = content.replace(
      /\{[\s\S]*?(href|route|path|screen)\s*:\s*['"`]\/?users-management['"`][\s\S]*?\},?\s*/g,
      '',
    );

    // Remove JSX blocks that navigate to users-management
    content = content.replace(
      /<TouchableOpacity[\s\S]*?users-management[\s\S]*?<\/TouchableOpacity>\s*/g,
      '',
    );

    content = content.replace(
      /<Pressable[\s\S]*?users-management[\s\S]*?<\/Pressable>\s*/g,
      '',
    );

    // Remove JSX blocks containing Arabic title "إدارة المستخدمين"
    content = content.replace(
      /<TouchableOpacity[\s\S]*?إدارة المستخدمين[\s\S]*?<\/TouchableOpacity>\s*/g,
      '',
    );

    content = content.replace(
      /<Pressable[\s\S]*?إدارة المستخدمين[\s\S]*?<\/Pressable>\s*/g,
      '',
    );

    // Remove direct router.push('/users-management')
    content = content.replace(
      /router\.(push|replace)\(\s*['"`]\/?users-management['"`]\s*\);?/g,
      '',
    );

    if (content !== original) {
      backupFile(filePath);
      writeFileSafe(filePath, content);
    }
  });
}

function ensureReactNativeImport(content, importName) {
  const reactNativeImportRegex =
    /import\s*\{([^}]+)\}\s*from\s*['"]react-native['"]\s*;/;
  const match = content.match(reactNativeImportRegex);

  if (!match) return content;

  const items = match[1]
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (!items.includes(importName)) {
    items.push(importName);
  }

  const replacement = `import {\n  ${items.join(',\n  ')}\n} from 'react-native';`;
  return content.replace(reactNativeImportRegex, replacement);
}

function ensureLucideImport(content, neededIcons) {
  const lucideRegex =
    /import\s*\{([^}]+)\}\s*from\s*['"]lucide-react-native['"]\s*;/;

  const match = content.match(lucideRegex);
  if (!match) return content;

  const icons = match[1]
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  neededIcons.forEach((icon) => {
    if (!icons.includes(icon)) icons.push(icon);
  });

  const replacement = `import { ${icons.join(', ')} } from 'lucide-react-native';`;
  return content.replace(lucideRegex, replacement);
}

function ensureExpoRouterImport(content) {
  if (
    /import\s*\{[^}]*useRouter[^}]*\}\s*from\s*['"]expo-router['"]\s*;/.test(
      content,
    )
  ) {
    return content;
  }

  const importRegex = /import\s*\{([^}]+)\}\s*from\s*['"]expo-router['"]\s*;/;

  if (importRegex.test(content)) {
    return content.replace(importRegex, (_, imports) => {
      const items = imports
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

      if (!items.includes('useRouter')) items.push('useRouter');

      return `import { ${items.join(', ')} } from 'expo-router';`;
    });
  }

  return `import { useRouter } from 'expo-router';\n${content}`;
}

function ensureRouterHook(content) {
  if (/const\s+router\s*=\s*useRouter\(\s*\)\s*;/.test(content)) {
    return content;
  }

  return content.replace(
    /export\s+default\s+function\s+[A-Za-z0-9_]+\s*\([^)]*\)\s*\{/,
    (match) => `${match}\n  const router = useRouter();`,
  );
}

function insertShopSettingsSection(content) {
  if (content.includes('settingsStructureSectionMarker')) {
    return content;
  }

  const section = `
        {/* settingsStructureSectionMarker */}
        <View style={styles.extraSettingsCard}>
          <Text style={styles.extraSettingsTitle}>الترويسة والطباعة</Text>
          <Text style={styles.extraSettingsSubtitle}>
            تم جمع إعدادات الترويسة والطباعة داخل إعدادات المحل لتكون أوضح وأسهل.
          </Text>

          <TouchableOpacity
            style={styles.extraSettingsButton}
            onPress={() => router.push('/customer-header-settings')}
          >
            <View style={styles.extraSettingsButtonIcon}>
              <FileText size={18} color="#2563EB" />
            </View>
            <View style={styles.extraSettingsButtonTextWrap}>
              <Text style={styles.extraSettingsButtonTitle}>إعدادات الترويسة</Text>
              <Text style={styles.extraSettingsButtonSubtitle}>
                تعديل اسم المحل، البيانات، وترويسة الصفحات
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.extraSettingsButton}
            onPress={() => router.push('/letterhead-settings')}
          >
            <View style={styles.extraSettingsButtonIcon}>
              <Printer size={18} color="#16A34A" />
            </View>
            <View style={styles.extraSettingsButtonTextWrap}>
              <Text style={styles.extraSettingsButtonTitle}>إعدادات الطباعة</Text>
              <Text style={styles.extraSettingsButtonSubtitle}>
                التحكم بشكل الطباعة والترويسة داخل المستندات
              </Text>
            </View>
          </TouchableOpacity>
        </View>
`;

  if (content.includes('</ScrollView>')) {
    return content.replace('</ScrollView>', `${section}\n      </ScrollView>`);
  }

  if (content.includes('</View>')) {
    const idx = content.lastIndexOf('</View>');
    return content.slice(0, idx) + section + '\n' + content.slice(idx);
  }

  return content + '\n' + section;
}

function insertShopSettingsStyles(content) {
  if (content.includes('extraSettingsCard:')) {
    return content;
  }

  const styleBlock = `
  extraSettingsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    marginTop: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  extraSettingsTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'right',
    marginBottom: 6,
  },
  extraSettingsSubtitle: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'right',
    lineHeight: 20,
    marginBottom: 14,
  },
  extraSettingsButton: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginTop: 10,
  },
  extraSettingsButtonIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  extraSettingsButtonTextWrap: {
    flex: 1,
  },
  extraSettingsButtonTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'right',
    marginBottom: 3,
  },
  extraSettingsButtonSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'right',
    lineHeight: 18,
  },
`;

  return content.replace(/\}\);\s*$/, `${styleBlock}\n});`);
}

function patchShopSettings() {
  const shopSettingsPath = path.join(appDir, 'shop-settings.tsx');

  if (!fs.existsSync(shopSettingsPath)) {
    console.log('Skipped: app/shop-settings.tsx not found');
    return;
  }

  let content = readFileSafe(shopSettingsPath);
  if (!content) return;

  const original = content;

  content = ensureExpoRouterImport(content);
  content = ensureReactNativeImport(content, 'TouchableOpacity');
  content = ensureLucideImport(content, ['FileText', 'Printer']);
  content = ensureRouterHook(content);
  content = insertShopSettingsSection(content);
  content = insertShopSettingsStyles(content);

  if (content !== original) {
    backupFile(shopSettingsPath);
    writeFileSafe(shopSettingsPath, content);
  }
}

try {
  removeUsersManagementFromSettingsFiles();
  patchShopSettings();

  console.log('');
  console.log('Done successfully.');
  console.log('Next steps:');
  console.log('1) npm run typecheck');
  console.log('2) npx expo start -c');
  console.log('');
  console.log('Important:');
  console.log('- تم إخفاء إدارة المستخدمين من الواجهة فقط');
  console.log('- تم إضافة الترويسة والطباعة داخل إعدادات المحل');
} catch (error) {
  console.error('Patch failed:', error.message);
  process.exit(1);
}
