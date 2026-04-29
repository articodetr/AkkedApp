const fs = require('fs');
const path = require('path');

const root = process.cwd();
const packRoot = __dirname;
const replacementsRoot = path.join(packRoot, 'replacements');
const backupDir = path.join(root, '.letterhead-unification-backup');

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

function writeFromReplacement(relativePath) {
  const sourcePath = path.join(replacementsRoot, relativePath);
  const targetPath = path.join(root, relativePath);

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing replacement file: ${sourcePath}`);
  }

  backup(targetPath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  console.log(`Replaced: ${relativePath}`);
}

function patchFile(relativePath, patcher) {
  const filePath = path.join(root, relativePath);

  if (!fs.existsSync(filePath)) {
    console.log(`Skipped missing file: ${relativePath}`);
    return;
  }

  backup(filePath);

  const original = fs.readFileSync(filePath, 'utf8');
  const updated = patcher(original);

  if (updated !== original) {
    fs.writeFileSync(filePath, updated, 'utf8');
    console.log(`Patched: ${relativePath}`);
  } else {
    console.log(`No changes applied to: ${relativePath}`);
  }
}

try {
  writeFromReplacement(path.join('services', 'letterheadService.ts'));
  writeFromReplacement(path.join('components', 'LetterheadPreview.tsx'));
  writeFromReplacement(path.join('app', 'shop-settings.tsx'));
  writeFromReplacement(path.join('app', 'letterhead-settings.tsx'));
  writeFromReplacement(path.join('utils', 'logoHelper.ts'));

  patchFile(path.join('app', '(tabs)', 'settings.tsx'), (content) => {
    let next = content;
    next = next.replace(`subtitle: 'اسم المحل والشعار',`, `subtitle: 'اسم المحل ورقم الهاتف والعنوان',`);
    next = next.replace(`title: 'ترويسة السندات',`, `title: 'الترويسة والطباعة',`);
    next = next.replace(
      `subtitle: 'تخصيص الشعار والرقم وألوان الترويسة',`,
      `subtitle: 'الترويسة الافتراضية أو البسيطة أو الكاملة للسندات',`
    );
    return next;
  });

  patchFile(path.join('app', 'receipt-preview.tsx'), (content) => {
    let next = content;
    next = next.replace(
      `logoDataUrl = await getReceiptLogoBase64(forceRefresh);`,
      `logoDataUrl = await getReceiptLogoBase64(currentUser?.userId, forceRefresh);`
    );
    return next;
  });

  console.log('');
  console.log('Done. Letterhead settings are now unified and receipt previews use the current user letterhead.');
  console.log('');
  console.log('Run the SQL migration first, then run this script.');
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
