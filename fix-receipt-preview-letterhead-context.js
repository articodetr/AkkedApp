const fs = require('fs');
const path = require('path');

const root = process.cwd();
const filePath = path.join(root, 'app', 'receipt-preview.tsx');
const backupDir = path.join(root, '.receipt-preview-letterhead-fix-backup');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function backup(targetPath) {
  ensureDir(backupDir);
  const backupPath = path.join(
    backupDir,
    `${path.basename(targetPath)}.${Date.now()}.bak`
  );
  fs.copyFileSync(targetPath, backupPath);
  console.log('Backup created:', backupPath);
}

function readFile(targetPath) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`File not found: ${targetPath}`);
  }
  return fs.readFileSync(targetPath, 'utf8');
}

function writeFile(targetPath, content) {
  fs.writeFileSync(targetPath, content, 'utf8');
  console.log('Updated:', targetPath);
}

function patchReceiptPreview() {
  let content = readFile(filePath);
  const original = content;

  backup(filePath);

  // Case 1: broken partially-patched call
  content = content.replace(
    /getCustomerReceiptHeaderBase64\(\s*customerData\s*,\s*forceRefresh\s*,\s*currentUser\?\.\s*userId\s*\)/g,
    `getCustomerReceiptHeaderBase64(customerData, forceRefresh, { userId: currentUser?.userId })`
  );

  // Case 2: old call without context
  content = content.replace(
    /getCustomerReceiptHeaderBase64\(\s*customerData\s*,\s*forceRefresh\s*\)/g,
    `getCustomerReceiptHeaderBase64(customerData, forceRefresh, { userId: currentUser?.userId })`
  );

  if (content === original) {
    console.log('No changes were needed in receipt-preview.tsx');
    return;
  }

  writeFile(filePath, content);
}

try {
  patchReceiptPreview();
  console.log('');
  console.log('Done. receipt-preview.tsx now passes the correct letterhead context.');
  console.log('Next step: npm run typecheck');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}