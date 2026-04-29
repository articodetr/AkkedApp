const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = process.cwd();
const backupDir = path.join(root, '.repair-settings-backup');

const pinSettingsPath = path.join(root, 'app', 'pin-settings.tsx');
const usersManagementPath = path.join(root, 'app', 'users-management.tsx');
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
    `${path.basename(filePath)}.${Date.now()}.bak`
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

function run(cmd) {
  return execSync(cmd, {
    cwd: root,
    stdio: 'pipe',
    encoding: 'utf8',
  });
}

function ensureGitRestore(filePathRelative) {
  try {
    run(`git checkout -- "${filePathRelative}"`);
    console.log(`Restored from Git: ${filePathRelative}`);
  } catch (error) {
    console.error(`Failed to restore ${filePathRelative} from Git.`);
    console.error(error.stdout || error.message);
    process.exit(1);
  }
}

function addLucideIcons(content, iconsToAdd) {
  const regex =
    /import\s*\{([^}]+)\}\s*from\s*['"]lucide-react-native['"]\s*;/;

  const match = content.match(regex);
  if (!match) return content;

  const icons = match[1]
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  iconsToAdd.forEach((icon) => {
    if (!icons.includes(icon)) {
      icons.push(icon);
    }
  });

  return content.replace(
    regex,
    `import { ${icons.join(', ')} } from 'lucide-react-native';`
  );
}

function patchShopSettings() {
  if (!fs.existsSync(shopSettingsPath)) {
    console.log('Skipped: app/shop-settings.tsx not found');
    return;
  }

  backupFile(shopSettingsPath);

  let content = readFile(shopSettingsPath);
  const original = content;

  content = addLucideIcons(content, ['FileText', 'Printer']);

  if (!content.includes('shopHeaderPrintLinksMarker')) {
    const section = `
        {/* shopHeaderPrintLinksMarker */}
        <View style={styles.extraCard}>
          <Text style={styles.extraCardTitle}>الترويسة والطباعة</Text>
          <Text style={styles.extraCardSubtitle}>
            تم وضع إعدادات الترويسة والطباعة داخل إعدادات المحل لتكون أوضح وأسهل.
          </Text>

          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => router.push('/customer-header-settings')}
          >
            <View style={styles.linkIconWrap}>
              <FileText size={18} color="#2563EB" />
            </View>
            <View style={styles.linkTextWrap}>
              <Text style={styles.linkTitle}>إعدادات الترويسة</Text>
              <Text style={styles.linkSubtitle}>
                تعديل بيانات الترويسة والعناصر الظاهرة أعلى الصفحة
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.linkRow}
            onPress={() => router.push('/letterhead-settings')}
          >
            <View style={[styles.linkIconWrap, styles.linkIconWrapGreen]}>
              <Printer size={18} color="#16A34A" />
            </View>
            <View style={styles.linkTextWrap}>
              <Text style={styles.linkTitle}>إعدادات الطباعة</Text>
              <Text style={styles.linkSubtitle}>
                التحكم في شكل الطباعة والورقة والتنسيق العام
              </Text>
            </View>
          </TouchableOpacity>
        </View>
`;

    if (content.includes('<View style={styles.footer}>')) {
      content = content.replace(
        '<View style={styles.footer}>',
        `${section}\n      <View style={styles.footer}>`
      );
    } else if (content.includes('</ScrollView>')) {
      content = content.replace('</ScrollView>', `${section}\n      </ScrollView>`);
    }
  }

  if (!content.includes('extraCard:')) {
    const styleBlock = `
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
  linkRow: {
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
  linkIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  linkIconWrapGreen: {
    backgroundColor: '#ECFDF5',
  },
  linkTextWrap: {
    flex: 1,
  },
  linkTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'right',
    marginBottom: 4,
  },
  linkSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'right',
    lineHeight: 18,
  },
`;

    content = content.replace(/\}\);\s*$/, `${styleBlock}\n});`);
  }

  if (content !== original) {
    writeFile(shopSettingsPath, content);
  } else {
    console.log('No changes needed in app/shop-settings.tsx');
  }
}

function main() {
  if (!fs.existsSync(path.join(root, '.git'))) {
    console.error('This script must be run from the Git project root.');
    process.exit(1);
  }

  backupFile(pinSettingsPath);
  backupFile(usersManagementPath);

  ensureGitRestore('app/pin-settings.tsx');
  ensureGitRestore('app/users-management.tsx');

  patchShopSettings();

  console.log('');
  console.log('Done successfully.');
  console.log('Next steps:');
  console.log('1) npm run typecheck');
  console.log('2) npx expo start -c');
  console.log('');
  console.log('Note:');
  console.log('تم إصلاح الملفات المكسورة ونقل روابط الترويسة والطباعة إلى إعدادات المحل.');
  console.log('أما إزالة إدارة المستخدمين من شاشة الإعدادات نفسها فسننفذها بعد التأكد أن typecheck رجع نظيف.');
}

main();