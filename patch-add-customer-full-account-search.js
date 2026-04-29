const fs = require('fs');
const path = require('path');

const root = process.cwd();
const addCustomerPath = path.join(root, 'app', 'add-customer.tsx');
const backupDir = path.join(root, '.add-customer-search-backup');

const ACCOUNT_NUMBER_LENGTH = 7;

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

  // Add ACCOUNT_NUMBER_LENGTH constant if it does not already exist.
  if (!content.includes('const ACCOUNT_NUMBER_LENGTH = 7;')) {
    const importBlockRegex = /(^[\s\S]*?from\s+['"][^'"]+['"];\s*\n)(\s*\n)?/m;
    const componentStartRegex = /export\s+default\s+function\s+AddCustomer[\s\S]*?\{/m;

    if (componentStartRegex.test(content)) {
      content = content.replace(
        componentStartRegex,
        `const ACCOUNT_NUMBER_LENGTH = ${ACCOUNT_NUMBER_LENGTH};\n\n$&`,
      );
      console.log('Inserted ACCOUNT_NUMBER_LENGTH constant.');
    } else {
      console.log('Could not find component start. Skipping constant insertion.');
    }
  } else {
    console.log('ACCOUNT_NUMBER_LENGTH constant already exists.');
  }

  // Replace searchUsers function.
  const searchUsersRegex =
    /const\s+searchUsers\s*=\s*async\s*\(\s*query\s*:\s*string\s*\)\s*=>\s*\{[\s\S]*?\n\s*\};/m;

  if (searchUsersRegex.test(content)) {
    content = content.replace(
      searchUsersRegex,
      `const searchUsers = async (query: string) => {
    const cleanedQuery = query.replace(/\\D/g, '');

    if (cleanedQuery.length !== ACCOUNT_NUMBER_LENGTH) {
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

      setSearchResults(data || []);
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

    if (cleanedText.length === ACCOUNT_NUMBER_LENGTH) {
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

  // Update the search placeholder text.
  content = content.replace(
    /placeholder=\s*["']أدخل رقم الحساب["']/g,
    `placeholder="أدخل رقم الحساب الكامل"`,
  );

  // Add maxLength to the search input if not already present.
  const searchInputRegex =
    /<TextInput([\s\S]*?value=\{searchQuery\}[\s\S]*?onChangeText=\{handleSearchQueryChange\}[\s\S]*?)\/>/m;

  if (searchInputRegex.test(content)) {
    content = content.replace(searchInputRegex, (match, inputProps) => {
      if (/maxLength=\{ACCOUNT_NUMBER_LENGTH\}/.test(match) || /maxLength=\{7\}/.test(match)) {
        console.log('Search input already has maxLength.');
        return match;
      }

      return `<TextInput${inputProps}
            maxLength={ACCOUNT_NUMBER_LENGTH}
          />`;
    });
    console.log('Patched search input maxLength.');
  } else {
    console.log('Search TextInput block not found.');
  }

  writeFile(addCustomerPath, content);
}

try {
  patchAddCustomer();

  console.log('');
  console.log('Done. Add customer search now waits for the full account number.');
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