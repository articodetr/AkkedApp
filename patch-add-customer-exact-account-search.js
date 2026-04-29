const fs = require('fs');
const path = require('path');

const root = process.cwd();
const addCustomerPath = path.join(root, 'app', 'add-customer.tsx');
const backupDir = path.join(root, '.add-customer-exact-search-backup');

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

  // Replace searchUsers function with exact-match-only behavior.
  const searchUsersRegex =
    /const\s+searchUsers\s*=\s*async\s*\(\s*query\s*:\s*string\s*\)\s*=>\s*\{[\s\S]*?\n\s*\};/m;

  if (searchUsersRegex.test(content)) {
    content = content.replace(
      searchUsersRegex,
      `const searchUsers = async (query: string) => {
    const cleanedQuery = query.replace(/\\D/g, '').trim();

    if (!cleanedQuery) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);

    try {
      const { data, error } = await supabase.rpc('search_users_by_account_number', {
        p_account_number: cleanedQuery,
        p_current_user_id: currentUser?.userId,
      });

      if (error) throw error;

      const exactResults = (data || []).filter(
        (user: SearchUserResult) =>
          String(user.account_number ?? '').trim() === cleanedQuery
      );

      setSearchResults(exactResults);
    } catch (error) {
      console.error('Error searching users:', error);
      Alert.alert('خطأ', 'حدث خطأ أثناء البحث');
    } finally {
      setIsSearching(false);
    }
  };`,
    );
    console.log('Patched searchUsers function.');
  } else {
    console.log('searchUsers function not found.');
  }

  // Replace handleSearchQueryChange function.
  const handleSearchQueryChangeRegex =
    /const\s+handleSearchQueryChange\s*=\s*\(\s*text\s*:\s*string\s*\)\s*=>\s*\{[\s\S]*?\n\s*\};/m;

  if (handleSearchQueryChangeRegex.test(content)) {
    content = content.replace(
      handleSearchQueryChangeRegex,
      `const handleSearchQueryChange = (text: string) => {
    const cleanedText = text.replace(/\\D/g, '');

    setSearchQuery(cleanedText);
    setSelectedUser(null);

    if (cleanedText) {
      searchUsers(cleanedText);
    } else {
      setSearchResults([]);
      setIsSearching(false);
    }
  };`,
    );
    console.log('Patched handleSearchQueryChange function.');
  } else {
    console.log('handleSearchQueryChange function not found.');
  }

  // Update placeholder text.
  content = content.replace(
    /placeholder=\s*["'][^"']*رقم الحساب[^"']*["']/g,
    `placeholder="أدخل رقم الحساب كاملًا"`,
  );

  // Remove any previously added fixed maxLength.
  content = content.replace(/\s*maxLength=\{ACCOUNT_NUMBER_LENGTH\}/g, '');
  content = content.replace(/\s*maxLength=\{7\}/g, '');

  writeFile(addCustomerPath, content);
}

try {
  patchAddCustomer();

  console.log('');
  console.log('Done. Search now shows only an exact full account-number match.');
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