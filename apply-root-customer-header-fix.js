const fs = require('fs');
const path = require('path');

const root = process.cwd();
const backupDir = path.join(root, '.root-customer-header-fix-backup');

const shopSettingsPath = path.join(root, 'app', 'shop-settings.tsx');
const customerDetailsPath = path.join(root, 'app', 'customer-details.tsx');
const customerHeaderSettingsPath = path.join(root, 'app', 'customer-header-settings.tsx');
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

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function write(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Updated: ${filePath}`);
}

function patchShopSettings() {
  if (!fs.existsSync(shopSettingsPath)) return;

  backupFile(shopSettingsPath);
  let content = read(shopSettingsPath);
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
    'تعديل بيانات الترويسة والعناصر الظاهرة أعلى الصفحة',
    'تعديل الترويسة العامة الافتراضية للمحل'
  );

  content = content.replaceAll(
    'تعديل اسم المحل، البيانات، وترويسة الصفحات',
    'تعديل الترويسة العامة الافتراضية للمحل'
  );

  if (content !== original) {
    write(shopSettingsPath, content);
  } else {
    console.log('No changes needed in shop-settings.tsx');
  }
}

function patchCustomerDetails() {
  if (!fs.existsSync(customerDetailsPath)) return;

  backupFile(customerDetailsPath);
  let content = read(customerDetailsPath);
  const original = content;

  content = content.replace(
    /import\s*\{([\s\S]*?)\}\s*from\s*'lucide-react-native';/,
    (full, icons) => {
      const names = icons
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

      if (!names.includes('FileText')) {
        names.push('FileText');
      }

      return `import { ${names.join(', ')} } from 'lucide-react-native';`;
    }
  );

  const notificationsBlock =
`  const openCustomerNotifications = useCallback(() => {
  if (!id) return;
  router.push({
  pathname: '/customer-notifications',
  params: {
  customerId: String(id),
  customerName: customer?.name || '',
  },
  });
  }, [customer?.name, id, router]);`;

  const notificationsReplacement =
`  const openCustomerNotifications = useCallback(() => {
  if (!id) return;
  router.push({
  pathname: '/customer-notifications',
  params: {
  customerId: String(id),
  customerName: customer?.name || '',
  },
  });
  }, [customer?.name, id, router]);

  const openCustomerHeaderSettings = useCallback(() => {
  if (!id) return;
  router.push({
  pathname: '/customer-header-settings',
  params: {
  customerId: String(id),
  customerName: customer?.name || '',
  },
  });
  }, [customer?.name, id, router]);`;

  if (content.includes(notificationsBlock) && !content.includes('openCustomerHeaderSettings')) {
    content = content.replace(notificationsBlock, notificationsReplacement);
  }

  const oldHeaderButton =
`  <TouchableOpacity
  style={styles.settingsButton}
  onPress={() => setShowSettingsMenu(true)}
  >
  <Settings size={24} color="#FFFFFF" />
  </TouchableOpacity>`;

  const newHeaderButton =
`  <View style={styles.headerButtonsWrap}>
  <TouchableOpacity
  style={[styles.settingsButton, styles.headerActionButtonAlt]}
  onPress={openCustomerHeaderSettings}
  >
  <FileText size={22} color="#FFFFFF" />
  </TouchableOpacity>

  <TouchableOpacity
  style={styles.settingsButton}
  onPress={() => setShowSettingsMenu(true)}
  >
  <Settings size={24} color="#FFFFFF" />
  </TouchableOpacity>
  </View>`;

  if (content.includes(oldHeaderButton)) {
    content = content.replace(oldHeaderButton, newHeaderButton);
  }

  content = content.replace(
    `  customerAccountNumber: customer?.account_number,`,
    `  customerAccountNumber: customer?.account_number,
  customerId: customer?.id,`
  );

  if (!content.includes('headerButtonsWrap:')) {
    const styleAnchor =
`settingsButton: {
  width: 40,
  height: 40,
  borderRadius: 20,`;

    const styleReplacement =
`headerButtonsWrap: {
  flexDirection: 'row-reverse',
  alignItems: 'center',
  gap: 8,
},
headerActionButtonAlt: {
  backgroundColor: 'rgba(255,255,255,0.18)',
},
settingsButton: {
  width: 40,
  height: 40,
  borderRadius: 20,`;

    if (content.includes(styleAnchor)) {
      content = content.replace(styleAnchor, styleReplacement);
    }
  }

  if (content !== original) {
    write(customerDetailsPath, content);
  } else {
    console.log('No changes needed in customer-details.tsx');
  }
}

function patchCustomerHeaderSettings() {
  if (!fs.existsSync(customerHeaderSettingsPath)) return;

  backupFile(customerHeaderSettingsPath);
  let content = read(customerHeaderSettingsPath);
  const original = content;

  content = content.replace(
    /if\s*\(!customer\)\s*return;/,
    `if (!customer) {
      throw new Error('لم يتم تحميل بيانات العميل');
    }`
  );

  const oldUpdateBlock = /const\s*\{\s*error\s*\}\s*=\s*await\s*supabase[\s\S]*?\.from\('customers'\)[\s\S]*?\.update\(payload\)[\s\S]*?\.eq\('id', customer\.id\);/;

  const newUpdateBlock = `const { error } = await supabase.rpc('save_customer_header_settings', {
      p_customer_id: customer.id,
      p_receipt_header_mode: mode,
      p_receipt_header_banner_url:
        mode === 'full_banner'
          ? uploadedBannerUrl
          : customer.receipt_header_banner_url || null,
      p_receipt_header_logo_url:
        mode === 'generated'
          ? uploadedLogoUrl
          : customer.receipt_header_logo_url || null,
      p_receipt_header_left_title: leftTitle.trim() || null,
      p_receipt_header_left_subtitle: leftSubtitle.trim() || null,
      p_receipt_header_right_title: rightTitle.trim() || null,
      p_receipt_header_right_subtitle: rightSubtitle.trim() || null,
      p_receipt_header_primary_color: primaryColor.trim() || '#0F766E',
      p_receipt_header_secondary_color: secondaryColor.trim() || '#115E59',
      p_receipt_header_text_color: textColor.trim() || '#FFFFFF',
    });`;

  if (oldUpdateBlock.test(content)) {
    content = content.replace(oldUpdateBlock, newUpdateBlock);
  } else {
    throw new Error('Could not patch save block in customer-header-settings.tsx');
  }

  if (content !== original) {
    write(customerHeaderSettingsPath, content);
  } else {
    console.log('No changes needed in customer-header-settings.tsx');
  }
}

function patchReceiptPreview() {
  if (!fs.existsSync(receiptPreviewPath)) return;

  backupFile(receiptPreviewPath);
  let content = read(receiptPreviewPath);
  const original = content;

  content = content.replace(
    `const { movementId, customerName, customerAccountNumber } = useLocalSearchParams();`,
    `const { movementId, customerName, customerAccountNumber, customerId } = useLocalSearchParams();`
  );

  content = content.replace(
    `.select('*, customers!customer_id(name, account_number, phone, receipt_header_mode, receipt_header_banner_url, receipt_header_logo_url), commission_recipient:customers!commission_recipient_id(name)')`,
    `.select('*, customers!customer_id(name, account_number, phone, receipt_header_mode, receipt_header_banner_url, receipt_header_logo_url, receipt_header_left_title, receipt_header_left_subtitle, receipt_header_right_title, receipt_header_right_subtitle, receipt_header_primary_color, receipt_header_secondary_color, receipt_header_text_color), commission_recipient:customers!commission_recipient_id(name)')`
  );

  content = content.replace(
    `  const scopedMovementData = {

  ...movementData,

  customers: movementData.customers || accessibleCustomer,

  };`,
    `  const scopedMovementData = {

  ...movementData,

  customers: {
    ...(accessibleCustomer || {}),
    ...((movementData.customers as any) || {}),
  },

  };`
  );

  if (!content.includes(`movementData.customer_id || customerId`)) {
    content = content.replace(
      `  const accessibleCustomer = await fetchAccessibleCustomerById(
  currentUser.userId,
  movementData.customer_id,
  true,
  );`,
      `  const accessibleCustomer = await fetchAccessibleCustomerById(
  currentUser.userId,
  (movementData.customer_id || customerId) as string,
  true,
  );`
    );
  }

  if (content !== original) {
    write(receiptPreviewPath, content);
  } else {
    console.log('No changes needed in receipt-preview.tsx');
  }
}

try {
  patchShopSettings();
  patchCustomerDetails();
  patchCustomerHeaderSettings();
  patchReceiptPreview();

  console.log('');
  console.log('Done successfully.');
  console.log('Next steps:');
  console.log('1) Run the SQL in Supabase');
  console.log('2) npm run typecheck');
  console.log('3) npx expo start -c');
} catch (error) {
  console.error('Patch failed:', error.message);
  process.exit(1);
}