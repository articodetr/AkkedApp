const fs = require('fs');
const path = require('path');

const root = process.cwd();

const files = [
  path.join(root, 'app', 'customer-notifications.tsx'),
  path.join(root, 'app', '(tabs)', 'notifications.tsx'),
];

function backup(filePath) {
  const backupPath = `${filePath}.backup-pending-count-only-${Date.now()}`;
  fs.copyFileSync(filePath, backupPath);
  console.log(`Backup created: ${backupPath}`);
}

function patchFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`Skipped missing file: ${filePath}`);
    return;
  }

  console.log(`\nPatching: ${filePath}`);
  backup(filePath);

  let content = fs.readFileSync(filePath, 'utf8');
  const before = content;

  // Add a flag inside FILTERS.map to show number only on pending filter.
  content = content.replace(
    /const count = filterCounts\[filter\.key\];\s*\n\s*return \(/g,
    `const count = filterCounts[filter.key];
          const shouldShowCount = filter.key === 'pending' && count > 0;

          return (`,
  );

  // Wrap the filter count badge with shouldShowCount.
  content = content.replace(
    /<View style=\{\[styles\.filterCount, isActive && styles\.filterCountActive\]\}>\s*<Text\s+style=\{\[\s*styles\.filterCountText,\s*isActive && styles\.filterCountTextActive,\s*\]\}\s*>\s*\{count\}\s*<\/Text>\s*<\/View>/g,
    `{shouldShowCount && (
                <View style={[styles.filterCount, isActive && styles.filterCountActive]}>
                  <Text
                    style={[
                      styles.filterCountText,
                      isActive && styles.filterCountTextActive,
                    ]}
                  >
                    {count}
                  </Text>
                </View>
              )}`,
  );

  if (content === before) {
    console.log('No changes applied. The file may already be patched or has a different structure.');
  } else {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated: ${filePath}`);
  }
}

try {
  for (const filePath of files) {
    patchFile(filePath);
  }

  console.log('\nDone. Counts are now visible only on pending notifications.');
  console.log('Now run:');
  console.log('npm run typecheck');
  console.log('npx expo start -c --port 8082');
} catch (error) {
  console.error('\nPatch failed:');
  console.error(error.message || error);
  process.exit(1);
}
