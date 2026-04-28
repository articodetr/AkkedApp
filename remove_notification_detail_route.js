const fs = require('fs');
const path = require('path');

const root = process.cwd();

const customerDetailsPath = path.join(root, 'app', 'customer-details.tsx');
const customerNotificationsPath = path.join(root, 'app', 'customer-notifications.tsx');
const generalNotificationsPath = path.join(root, 'app', '(tabs)', 'notifications.tsx');
const notificationDetailPath = path.join(root, 'app', 'notification-detail.tsx');

const backupDir = path.join(root, '.notification-detail-removal-backup');

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

function patchCustomerDetails() {
  if (!fs.existsSync(customerDetailsPath)) {
    console.log(`Skipped missing file: ${customerDetailsPath}`);
    return;
  }

  backup(customerDetailsPath);

  let content = fs.readFileSync(customerDetailsPath, 'utf8');

  // Remove the special notification-detail lookup function.
  const removeDecisionFunctionRegex =
    /const\s+openNotificationDecisionPage\s*=\s*async\s*\(\s*movement\s*:\s*AccountMovement\s*\)\s*:\s*Promise\s*<\s*boolean\s*>\s*=>\s*\{[\s\S]*?\};\s*const\s+handleMovementPress\s*=\s*async\s*\(\s*movement\s*:\s*AccountMovement\s*\)\s*=>\s*\{/;

  if (removeDecisionFunctionRegex.test(content)) {
    content = content.replace(
      removeDecisionFunctionRegex,
      `const handleMovementPress = async (movement: AccountMovement) => {`,
    );
    console.log('Removed openNotificationDecisionPage from customer-details.tsx');
  } else {
    console.log('openNotificationDecisionPage exact block was not found. Continuing with direct call replacement.');
  }

  // Replace any remaining pending movement behavior to open the customer notifications page.
  content = content.replace(
    /if\s*\(\s*isPendingMovement\s*\(\s*movement\s*\)\s*\)\s*\{\s*const\s+handled\s*=\s*await\s+openNotificationDecisionPage\s*\(\s*movement\s*\)\s*;\s*if\s*\(\s*handled\s*\)\s*return\s*;\s*\}/g,
    `if (isPendingMovement(movement)) {
      openCustomerNotifications();
      return;
    }`,
  );

  // Safety net: if any direct router push to notification-detail remains in this file, redirect it to customer notifications.
  content = content.replace(
    /router\.push\(\s*\{\s*pathname:\s*['"]\/notification-detail['"][\s\S]*?\}\s*\)\s*;?/g,
    `openCustomerNotifications();`,
  );

  writeFile(customerDetailsPath, content);
}

function patchNotificationListFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`Skipped missing file: ${filePath}`);
    return;
  }

  backup(filePath);

  let content = fs.readFileSync(filePath, 'utf8');

  // Make notification card press do nothing instead of opening the deleted detail route.
  const openNotificationRegex =
    /const\s+openNotification\s*=\s*\(\s*item\s*:\s*MovementNotification\s*\)\s*=>\s*\{[\s\S]*?\};\s*const\s+confirmDelete/;

  if (openNotificationRegex.test(content)) {
    content = content.replace(
      openNotificationRegex,
      `const openNotification = (_item: MovementNotification) => {
    // تم حذف صفحة تفاصيل الإشعار الخاصة.
    // القبول والرفض والملاحظة تظهر مباشرة داخل بطاقة الإشعار.
  };

  const confirmDelete`,
    );
    console.log(`Disabled notification-detail navigation in: ${filePath}`);
  } else {
    // Safety net for any remaining route push.
    content = content.replace(
      /router\.push\(\s*\{\s*pathname:\s*['"]\/notification-detail['"][\s\S]*?\}\s*\)\s*;?/g,
      `// notification-detail route removed; no navigation needed.`,
    );
    console.log(`Applied fallback notification-detail removal in: ${filePath}`);
  }

  writeFile(filePath, content);
}

function deleteNotificationDetailRoute() {
  if (!fs.existsSync(notificationDetailPath)) {
    console.log('notification-detail.tsx is already deleted.');
    return;
  }

  const backupPath = backup(notificationDetailPath);
  fs.rmSync(notificationDetailPath, { force: true });

  console.log(`Deleted route: ${notificationDetailPath}`);
  console.log(`Backup kept at: ${backupPath}`);
}

try {
  patchCustomerDetails();
  patchNotificationListFile(customerNotificationsPath);
  patchNotificationListFile(generalNotificationsPath);
  deleteNotificationDetailRoute();

  console.log('');
  console.log('Done. Special notification-detail route has been removed.');
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
