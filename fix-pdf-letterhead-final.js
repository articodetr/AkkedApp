const fs = require('fs');
const path = require('path');

const root = process.cwd();
const receiptPreviewPath = path.join(root, 'app', 'receipt-preview.tsx');
const backupDir = path.join(root, '.pdf-letterhead-final-backup');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function backupFile(filePath) {
  ensureDir(backupDir);
  const backupPath = path.join(
    backupDir,
    `${path.basename(filePath)}.${Date.now()}.bak`
  );
  fs.copyFileSync(filePath, backupPath);
  console.log('Backup created:', backupPath);
}

function readFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function writeFile(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Updated:', filePath);
}

function patchReceiptPreview() {
  let content = readFile(receiptPreviewPath);
  const original = content;

  backupFile(receiptPreviewPath);

  content = content.replace(
    /logoDataUrl\s*=\s*await\s*getReceiptLogoBase64\(\s*forceRefresh\s*\)\s*;/g,
    `logoDataUrl = await getReceiptLogoBase64(
          forceRefresh,
          customerData,
          currentUser?.userId
        );`
  );

  content = content.replace(
    /logoDataUrl\s*=\s*await\s*getCustomerReceiptHeaderBase64\(\s*customerData\s*,\s*forceRefresh\s*\)\s*;/g,
    `logoDataUrl = await getReceiptLogoBase64(
          forceRefresh,
          customerData,
          currentUser?.userId
        );`
  );

  content = content.replace(
    /logoDataUrl\s*=\s*await\s*getCustomerReceiptHeaderBase64\(\s*customerData\s*,\s*forceRefresh\s*,\s*\{\s*userId:\s*currentUser\?\.userId\s*\}\s*\)\s*;/g,
    `logoDataUrl = await getReceiptLogoBase64(
          forceRefresh,
          customerData,
          currentUser?.userId
        );`
  );

  if (content === original) {
    throw new Error(
      'Patch failed: could not find the receipt logo call inside app/receipt-preview.tsx'
    );
  }

  writeFile(receiptPreviewPath, content);
}

try {
  patchReceiptPreview();
  console.log('');
  console.log('Done. PDF receipt generation now passes the current user and customer data.');
  console.log('Next steps:');
  console.log('1) npm run typecheck');
  console.log('2) npx expo start -c');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}