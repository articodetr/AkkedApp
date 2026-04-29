const fs = require('fs');
const path = require('path');

const root = process.cwd();
const addCustomerPath = path.join(root, 'app', 'add-customer.tsx');
const backupDir = path.join(root, '.add-customer-default-linked-backup');

function ensureBackupDir() {
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
}

function backup(filePath) {
  ensureBackupDir();

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const backupName = `${path.basename(filePath)}.${Date.now()}.bak`;
  const backupPath = path.join(backupDir, backupName);

  fs.copyFileSync(filePath, backupPath);
  console.log(`Backup created: ${backupPath}`);

  return backupPath;
}

function writeFile(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Updated: ${filePath}`);
}

function patchAddCustomerDefaultType() {
  if (!fs.existsSync(addCustomerPath)) {
    throw new Error(`Missing file: ${addCustomerPath}`);
  }

  backup(addCustomerPath);

  let content = fs.readFileSync(addCustomerPath, 'utf8');

  const originalStateRegex =
    /const\s+\[\s*customerType\s*,\s*setCustomerType\s*\]\s*=\s*useState\s*\(\s*['"]regular['"]\s*\);/;

  if (originalStateRegex.test(content)) {
    content = content.replace(
      originalStateRegex,
      `const [customerType, setCustomerType] = useState('linked');`,
    );
    console.log('Default customerType changed from regular to linked.');
  } else if (
    /const\s+\[\s*customerType\s*,\s*setCustomerType\s*\]\s*=\s*useState\s*\(\s*['"]linked['"]\s*\);/.test(
      content,
    )
  ) {
    console.log('customerType is already set to linked.');
  } else {
    console.log('customerType useState declaration was not found.');
  }

  writeFile(addCustomerPath, content);
}

try {
  patchAddCustomerDefaultType();

  console.log('');
  console.log('Done. Add Customer now opens on "ربط مستخدم موجود" by default.');
  console.log('');
  console.log('Now run:');
  console.log('npm run typecheck');
  console.log('npx expo start -c --port 8082');
} catch (error) {
  console.error('');
  console.error('Patch failed:');
  console.error(error.message || error);
  process.exit(1);
}