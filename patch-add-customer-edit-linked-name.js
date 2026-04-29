const fs = require('fs');
const path = require('path');

const root = process.cwd();
const addCustomerPath = path.join(root, 'app', 'add-customer.tsx');
const backupDir = path.join(root, '.add-customer-edit-linked-name-backup');

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

function patchAddCustomer() {
  if (!fs.existsSync(addCustomerPath)) {
    throw new Error(`Missing file: ${addCustomerPath}`);
  }

  backup(addCustomerPath);

  let content = fs.readFileSync(addCustomerPath, 'utf8');

  // Make the linked-customer name field editable after selecting a user.
  const editableRegex =
    /editable=\{customerType === 'regular' \|\| isEditMode\}/g;

  if (editableRegex.test(content)) {
    content = content.replace(
      editableRegex,
      `editable={customerType === 'regular' || isEditMode || !!selectedUser}`,
    );
    console.log('Patched name input to allow editing for linked users.');
  } else if (
    content.includes(
      `editable={customerType === 'regular' || isEditMode || !!selectedUser}`,
    )
  ) {
    console.log('Name input is already editable for linked users.');
  } else {
    console.log('Could not find the editable condition for the name input.');
  }

  // Improve placeholder so the user understands they can edit the linked user's display name.
  const linkedPlaceholderRegex =
    /placeholder=\{\s*customerType === 'linked'\s*\?\s*'اسم العرض \(اختياري - سيتم استخدام اسم المستخدم افتراضياً\)'\s*:\s*'أدخل اسم العميل'\s*\}/g;

  if (linkedPlaceholderRegex.test(content)) {
    content = content.replace(
      linkedPlaceholderRegex,
      `placeholder={
                customerType === 'linked'
                  ? 'يمكنك تعديل الاسم قبل حفظ العميل'
                  : 'أدخل اسم العميل'
              }`,
    );
    console.log('Updated linked-customer name placeholder.');
  } else if (content.includes(`'يمكنك تعديل الاسم قبل حفظ العميل'`)) {
    console.log('Linked placeholder already updated.');
  } else {
    console.log('Could not find the linked placeholder block.');
  }

  writeFile(addCustomerPath, content);
}

try {
  patchAddCustomer();

  console.log('');
  console.log('Done. Linked customer name can now be edited before saving.');
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
