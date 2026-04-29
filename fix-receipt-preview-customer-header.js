const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'app', 'receipt-preview.tsx');

if (!fs.existsSync(filePath)) {
  console.error('File not found:', filePath);
  process.exit(1);
}

let content = fs.readFileSync(filePath, 'utf8');

const backupPath = `${filePath}.backup-fix-customer-header-${Date.now()}`;
fs.copyFileSync(filePath, backupPath);
console.log('Backup created:', backupPath);

function replaceOnce(source, searchValue, replaceValue, label) {
  if (!source.includes(searchValue)) {
    console.warn(`Pattern not found for: ${label}`);
    return source;
  }
  return source.replace(searchValue, replaceValue);
}

// 1) Fix import
content = replaceOnce(
  content,
  "import { getReceiptLogoBase64 } from '@/utils/logoHelper';",
  "import { getCustomerReceiptHeaderBase64 } from '@/utils/logoHelper';",
  'receipt-preview logoHelper import'
);

// 2) Fix customer merge block
content = replaceOnce(
  content,
  `const scopedMovementData = {
        ...movementData,
        customers: movementData.customers || accessibleCustomer,
      };`,
  `const mergedCustomer = {
        ...accessibleCustomer,
        ...(movementData.customers || {}),
      };

      const scopedMovementData = {
        ...movementData,
        customers: mergedCustomer,
      };`,
  'receipt-preview merged customer block'
);

// 3) Fix logo loader call
content = replaceOnce(
  content,
  'logoDataUrl = await getReceiptLogoBase64(forceRefresh);',
  'logoDataUrl = await getCustomerReceiptHeaderBase64(customerData, forceRefresh);',
  'receipt-preview logo loader call'
);

fs.writeFileSync(filePath, content, 'utf8');

console.log('Updated:', filePath);
console.log('');
console.log('Done. Now run:');
console.log('npm run typecheck');
console.log('npx expo start -c');