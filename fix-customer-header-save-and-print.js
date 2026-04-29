const fs = require('fs');
const path = require('path');

const root = process.cwd();
const backupDir = path.join(root, '.customer-header-save-fix-backup');

const customerHeaderPath = path.join(root, 'app', 'customer-header-settings.tsx');
const receiptPreviewPath = path.join(root, 'app', 'receipt-preview.tsx');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
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

function patchCustomerHeaderSettings() {
  if (!fs.existsSync(customerHeaderPath)) {
    throw new Error(`Missing file: ${customerHeaderPath}`);
  }

  backupFile(customerHeaderPath);
  let content = readFile(customerHeaderPath);
  const original = content;

  content = content.replace(
    /if\s*\(!customer\)\s*return;/,
    `if (!customer) {
      throw new Error('لم يتم تحميل بيانات العميل بعد');
    }

    if (!currentUser?.userId) {
      throw new Error('لم يتم العثور على بيانات الحساب الحالي');
    }`
  );

  const updateRegex =
    /const\s*\{\s*error\s*\}\s*=\s*await\s*supabase\s*\.from\('customers'\)\s*\.update\(payload\)\s*\.eq\('id',\s*customer\.id\);/s;

  if (!updateRegex.test(content)) {
    throw new Error('Could not find customers update block in customer-header-settings.tsx');
  }

  content = content.replace(
    updateRegex,
    `const { data: updatedCustomer, error } = await supabase
      .from('customers')
      .update(payload)
      .eq('id', customer.id)
      .or(buildReadableCustomerFilter(currentUser.userId, true))
      .select('id')
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!updatedCustomer) {
      throw new Error('لا تملك صلاحية حفظ ترويسة هذا العميل من هذا الحساب');
    }`
  );

  if (content !== original) {
    writeFile(customerHeaderPath, content);
  } else {
    console.log('No changes needed in app/customer-header-settings.tsx');
  }
}

function patchReceiptPreview() {
  if (!fs.existsSync(receiptPreviewPath)) {
    throw new Error(`Missing file: ${receiptPreviewPath}`);
  }

  backupFile(receiptPreviewPath);
  let content = readFile(receiptPreviewPath);
  const original = content;

  const selectOld =
    ".select('*, customers!customer_id(name, account_number, phone, receipt_header_mode, receipt_header_banner_url, receipt_header_logo_url), commission_recipient:customers!commission_recipient_id(name)')";
  const selectNew =
    ".select('*, customers!customer_id(name, account_number, phone, receipt_header_mode, receipt_header_banner_url, receipt_header_logo_url, receipt_header_left_title, receipt_header_left_subtitle, receipt_header_right_title, receipt_header_right_subtitle, receipt_header_primary_color, receipt_header_secondary_color, receipt_header_text_color), commission_recipient:customers!commission_recipient_id(name)')";

  if (content.includes(selectOld)) {
    content = content.replace(selectOld, selectNew);
  }

  const scopedOld =
    `const scopedMovementData = {

  ...movementData,

  customers: movementData.customers || accessibleCustomer,

  };`;

  const scopedNew =
    `const scopedMovementData = {

  ...movementData,

  customers: {
    ...(accessibleCustomer || {}),
    ...((movementData.customers as any) || {}),
  },

  };`;

  if (content.includes(scopedOld)) {
    content = content.replace(scopedOld, scopedNew);
  } else {
    const scopedRegex =
      /const\s+scopedMovementData\s*=\s*\{[\s\S]*?customers:\s*movementData\.customers\s*\|\|\s*accessibleCustomer,[\s\S]*?\};/;
    if (!scopedRegex.test(content)) {
      throw new Error('Could not find scopedMovementData block in receipt-preview.tsx');
    }
    content = content.replace(
      scopedRegex,
      `const scopedMovementData = {

  ...movementData,

  customers: {
    ...(accessibleCustomer || {}),
    ...((movementData.customers as any) || {}),
  },

  };`
    );
  }

  if (content !== original) {
    writeFile(receiptPreviewPath, content);
  } else {
    console.log('No changes needed in app/receipt-preview.tsx');
  }
}

try {
  patchCustomerHeaderSettings();
  patchReceiptPreview();

  console.log('');
  console.log('Done successfully.');
  console.log('Next steps:');
  console.log('1) npm run typecheck');
  console.log('2) npx expo start -c');
  console.log('');
  console.log('If save still fails after this, the remaining issue is most likely a Supabase RLS update policy.');
} catch (error) {
  console.error('Patch failed:', error.message);
  process.exit(1);
}