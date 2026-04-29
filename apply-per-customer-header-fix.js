const fs = require('fs');
const path = require('path');

const root = process.cwd();
const backupDir = path.join(root, '.per-customer-header-fix-backup');

const shopSettingsPath = path.join(root, 'app', 'shop-settings.tsx');
const customerDetailsPath = path.join(root, 'app', 'customer-details.tsx');
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

function replaceOrFail(content, searchValue, replaceValue, label) {
  if (!content.includes(searchValue)) {
    throw new Error(`Could not find pattern for: ${label}`);
  }
  return content.replace(searchValue, replaceValue);
}

function patchShopSettings() {
  if (!fs.existsSync(shopSettingsPath)) return;

  backupFile(shopSettingsPath);
  let content = readFile(shopSettingsPath);
  const original = content;

  content = content.replaceAll(
    "router.push('/customer-header-settings')",
    "router.push('/letterhead-settings')"
  );

  content = content.replaceAll(
    'إعدادات الترويسة',
    'إعدادات الترويسة العامة'
  );

  content = content.replaceAll(
    'تعديل اسم المحل، البيانات، وترويسة الصفحات',
    'تعديل الترويسة العامة الافتراضية للمحل'
  );

  content = content.replaceAll(
    'تعديل بيانات الترويسة والعناصر الظاهرة أعلى الصفحة',
    'تعديل الترويسة العامة الافتراضية للمحل'
  );

  if (content !== original) {
    writeFile(shopSettingsPath, content);
  } else {
    console.log('No changes needed in app/shop-settings.tsx');
  }
}

function patchCustomerDetails() {
  backupFile(customerDetailsPath);
  let content = readFile(customerDetailsPath);
  const original = content;

  if (!content.includes('const openCustomerHeaderSettings = useCallback(')) {
    const anchor =
      "const openCustomerNotifications = useCallback(() => {\n" +
      "  if (!id) return;\n" +
      "  router.push({\n" +
      "  pathname: '/customer-notifications',\n" +
      "  params: {\n" +
      "  customerId: String(id),\n" +
      "  customerName: customer?.name || '',\n" +
      "  },\n" +
      "  });\n" +
      "  }, [customer?.name, id, router]);";

    const insert =
      "const openCustomerNotifications = useCallback(() => {\n" +
      "  if (!id) return;\n" +
      "  router.push({\n" +
      "  pathname: '/customer-notifications',\n" +
      "  params: {\n" +
      "  customerId: String(id),\n" +
      "  customerName: customer?.name || '',\n" +
      "  },\n" +
      "  });\n" +
      "  }, [customer?.name, id, router]);\n\n" +
      "  const openCustomerHeaderSettings = useCallback(() => {\n" +
      "  if (!id) return;\n" +
      "  router.push({\n" +
      "  pathname: '/customer-header-settings',\n" +
      "  params: {\n" +
      "  customerId: String(id),\n" +
      "  customerName: customer?.name || '',\n" +
      "  },\n" +
      "  });\n" +
      "  }, [customer?.name, id, router]);";

    if (!content.includes(anchor)) {
      throw new Error('Could not find openCustomerNotifications block in app/customer-details.tsx');
    }
    content = content.replace(anchor, insert);
  }

  const headerButtonBlock =
    "<TouchableOpacity\n" +
    "  style={styles.settingsButton}\n" +
    "  onPress={() => setShowSettingsMenu(true)}\n" +
    "  >\n" +
    "  <Settings size={24} color=\"#FFFFFF\" />\n" +
    "  </TouchableOpacity>";

  const headerButtonReplacement =
    "<View style={styles.headerButtonsWrap}>\n" +
    "  <TouchableOpacity\n" +
    "  style={[styles.settingsButton, styles.headerActionButtonAlt]}\n" +
    "  onPress={openCustomerHeaderSettings}\n" +
    "  >\n" +
    "  <FileText size={22} color=\"#FFFFFF\" />\n" +
    "  </TouchableOpacity>\n" +
    "  <TouchableOpacity\n" +
    "  style={styles.settingsButton}\n" +
    "  onPress={() => setShowSettingsMenu(true)}\n" +
    "  >\n" +
    "  <Settings size={24} color=\"#FFFFFF\" />\n" +
    "  </TouchableOpacity>\n" +
    "  </View>";

  if (content.includes(headerButtonBlock)) {
    content = content.replace(headerButtonBlock, headerButtonReplacement);
  } else if (!content.includes('openCustomerHeaderSettings')) {
    throw new Error('Could not find settings button block in app/customer-details.tsx');
  }

  if (
    content.includes('customerAccountNumber: customer?.account_number,') &&
    !content.includes('customerId: customer?.id,')
  ) {
    content = content.replace(
      'customerAccountNumber: customer?.account_number,',
      "customerAccountNumber: customer?.account_number,\n  customerId: customer?.id,"
    );
  }

  if (!content.includes('headerButtonsWrap:')) {
    const styleAnchor =
      "settingsButton: {\n" +
      "  width: 40,\n" +
      "  height: 40,\n" +
      "  borderRadius: 20,";

    const styleReplacement =
      "headerButtonsWrap: {\n" +
      "  flexDirection: 'row-reverse',\n" +
      "  alignItems: 'center',\n" +
      "  gap: 8,\n" +
      "},\n" +
      "headerActionButtonAlt: {\n" +
      "  backgroundColor: 'rgba(255,255,255,0.18)',\n" +
      "},\n" +
      "settingsButton: {\n" +
      "  width: 40,\n" +
      "  height: 40,\n" +
      "  borderRadius: 20,";

    if (!content.includes(styleAnchor)) {
      throw new Error('Could not find settingsButton style block in app/customer-details.tsx');
    }
    content = content.replace(styleAnchor, styleReplacement);
  }

  if (content !== original) {
    writeFile(customerDetailsPath, content);
  } else {
    console.log('No changes needed in app/customer-details.tsx');
  }
}

function patchReceiptPreview() {
  backupFile(receiptPreviewPath);
  let content = readFile(receiptPreviewPath);
  const original = content;

  content = replaceOrFail(
    content,
    'const { movementId, customerName, customerAccountNumber } = useLocalSearchParams();',
    'const { movementId, customerName, customerAccountNumber, customerId } = useLocalSearchParams();',
    'useLocalSearchParams destructuring in app/receipt-preview.tsx'
  );

  content = replaceOrFail(
    content,
    ".select('*, customers!customer_id(name, account_number, phone, receipt_header_mode, receipt_header_banner_url, receipt_header_logo_url), commission_recipient:customers!commission_recipient_id(name)')",
    ".select('*, customers!customer_id(name, account_number, phone, receipt_header_mode, receipt_header_banner_url, receipt_header_logo_url, receipt_header_left_title, receipt_header_left_subtitle, receipt_header_right_title, receipt_header_right_subtitle, receipt_header_primary_color, receipt_header_secondary_color, receipt_header_text_color), commission_recipient:customers!commission_recipient_id(name)')",
    'customer select fields in app/receipt-preview.tsx'
  );

  if (!content.includes('if (!customerData && customerId && currentUser?.userId) {')) {
    const customerDataAnchor =
      "const customerData = movementData.customers;\n" +
      "\n" +
      "  const commissionRecipientData = movementData.commission_recipient;";

    const customerDataReplacement =
      "let customerData = movementData.customers;\n" +
      "\n" +
      "  if (!customerData && customerId && currentUser?.userId) {\n" +
      "  try {\n" +
      "  customerData = await fetchAccessibleCustomerById(String(customerId), currentUser.userId);\n" +
      "  } catch (fallbackError) {\n" +
      "  console.warn('[ReceiptPreview] Could not fetch fallback customer data:', fallbackError);\n" +
      "  }\n" +
      "  }\n" +
      "\n" +
      "  const commissionRecipientData = movementData.commission_recipient;";

    if (!content.includes(customerDataAnchor)) {
      throw new Error('Could not find customerData block in app/receipt-preview.tsx');
    }
    content = content.replace(customerDataAnchor, customerDataReplacement);
  }

  if (content !== original) {
    writeFile(receiptPreviewPath, content);
  } else {
    console.log('No changes needed in app/receipt-preview.tsx');
  }
}

try {
  patchShopSettings();
  patchCustomerDetails();
  patchReceiptPreview();

  console.log('');
  console.log('Done successfully.');
  console.log('Next steps:');
  console.log('1) npm run typecheck');
  console.log('2) npx expo start -c');
  console.log('');
  console.log('Expected result:');
  console.log('- الترويسة العامة تبقى داخل إعدادات المحل');
  console.log('- كل عميل يصبح له زر ترويسة خاص داخل صفحة العميل');
  console.log('- حفظ ترويسة العميل يتم على سجل العميل نفسه');
  console.log('- السندات والملفات ستقرأ حقول الترويسة الخاصة بالعميل');
} catch (error) {
  console.error('Patch failed:', error.message);
  process.exit(1);
}