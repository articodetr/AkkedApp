const fs = require('fs');
const path = require('path');

const root = process.cwd();

const files = [
  path.join(root, 'app', 'customer-notifications.tsx'),
  path.join(root, 'app', '(tabs)', 'notifications.tsx'),
];

function backup(filePath) {
  const backupPath = `${filePath}.backup-filters-layout-${Date.now()}`;
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

  // Remove ScrollView import because the filters no longer need horizontal scrolling.
  content = content.replace(/\n\s*ScrollView,\s*/g, '\n');

  // Replace the filters ScrollView with a normal View.
  // This prevents the filter row from stretching vertically when a filter has few/no results.
  content = content.replace(
    /<ScrollView\s+horizontal\s+showsHorizontalScrollIndicator=\{false\}\s+style=\{styles\.filtersScroller\}\s+contentContainerStyle=\{styles\.filtersRow\}\s*>/g,
    '<View style={styles.filtersRow}>',
  );

  content = content.replace(
    /<\/ScrollView>\s*\n\s*<FlatList/g,
    '</View>\n\n      <FlatList',
  );

  // Remove filtersScroller style block if it exists.
  content = content.replace(
    /\n\s{2}filtersScroller:\s*\{[\s\S]*?\},(?=\n\s{2}[a-zA-Z])/g,
    '',
  );

  // Replace filtersRow style with a compact fixed-height row.
  content = content.replace(
    /filtersRow:\s*\{[\s\S]*?\},\s*filterChip:/,
    `filtersRow: {
    minHeight: 48,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  filterChip:`,
  );

  // Make list start immediately after filters.
  content = content.replace(
    /listContent:\s*\{\s*paddingHorizontal:\s*14,\s*paddingTop:\s*\d+,/g,
    `listContent: {
    paddingHorizontal: 14,
    paddingTop: 4,`,
  );

  if (content === before) {
    console.log('No changes applied. The file may already be fixed or has a different structure.');
  } else {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated: ${filePath}`);
  }
}

try {
  for (const filePath of files) {
    patchFile(filePath);
  }

  console.log('\nDone. Filter layout fixed.');
  console.log('Now run:');
  console.log('npm run typecheck');
  console.log('npx expo start -c --port 8082');
} catch (error) {
  console.error('\nPatch failed:');
  console.error(error.message || error);
  process.exit(1);
}
