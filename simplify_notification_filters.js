const fs = require('fs');
const path = require('path');

const root = process.cwd();

const files = [
  path.join(root, 'app', 'customer-notifications.tsx'),
  path.join(root, 'app', '(tabs)', 'notifications.tsx'),
];

const newFilters = `const FILTERS: Array<{ key: LocalNotificationFilter; label: string }> = [
  { key: 'all', label: 'الكل' },
  { key: 'pending', label: 'معلقة' },
  { key: 'rejected', label: 'مرفوضة' },
];`;

function backup(filePath) {
  const backupPath = `${filePath}.backup-simple-filters-${Date.now()}`;
  fs.copyFileSync(filePath, backupPath);
  console.log(`Backup created: ${backupPath}`);
}

function replaceFilters(content) {
  return content.replace(
    /const FILTERS:\s*Array<\{\s*key:\s*LocalNotificationFilter;\s*label:\s*string\s*\}>\s*=\s*\[[\s\S]*?\];/,
    newFilters,
  );
}

function fixFilterStyles(content) {
  let next = content;

  // Replace filtersScroller block if it exists.
  next = next.replace(
    /filtersScroller:\s*\{\s*maxHeight:\s*\d+,\s*marginTop:\s*\d+,\s*\},/g,
    `filtersScroller: {
    minHeight: 54,
    marginTop: 8,
  },`,
  );

  // If filtersScroller has a different shape, still make it safe.
  next = next.replace(
    /filtersScroller:\s*\{[\s\S]*?\},\s*filtersRow:/,
    `filtersScroller: {
    minHeight: 54,
    marginTop: 8,
  },
  filtersRow:`,
  );

  // Replace filtersRow block to avoid clipped chips.
  next = next.replace(
    /filtersRow:\s*\{\s*flexDirection:\s*'row-reverse',\s*alignItems:\s*'center',\s*gap:\s*\d+,\s*paddingHorizontal:\s*\d+,\s*paddingBottom:\s*\d+,\s*\},/g,
    `filtersRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },`,
  );

  // Keep chips smaller and not clipped.
  next = next.replace(
    /filterChip:\s*\{\s*minHeight:\s*\d+,\s*borderRadius:\s*999,/g,
    `filterChip: {
    minHeight: 32,
    borderRadius: 999,`,
  );

  next = next.replace(/paddingVertical:\s*7,/g, `paddingVertical: 6,`);

  return next;
}

function processFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`Skipped missing file: ${filePath}`);
    return;
  }

  console.log(`\nPatching: ${filePath}`);
  backup(filePath);

  let content = fs.readFileSync(filePath, 'utf8');
  const before = content;

  content = replaceFilters(content);
  content = fixFilterStyles(content);

  if (content === before) {
    console.log('No changes were applied. Please check the file manually.');
  } else {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated: ${filePath}`);
  }
}

try {
  for (const filePath of files) {
    processFile(filePath);
  }

  console.log('\nDone. Filters simplified to: الكل، معلقة، مرفوضة');
  console.log('Now run:');
  console.log('npm run typecheck');
  console.log('npx expo start -c --port 8082');
} catch (error) {
  console.error('\nPatch failed:');
  console.error(error.message || error);
  process.exit(1);
}
