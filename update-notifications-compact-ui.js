const fs = require('fs');
const path = require('path');

const root = process.cwd();

const FILES = [
  {
    label: 'Customer notifications screen',
    path: path.join(root, 'app', 'customer-notifications.tsx'),
    activeColor: '#B45309',
    headerIconBg: '#FEF3C7',
    removeNotice: true,
  },
  {
    label: 'General notifications tab',
    path: path.join(root, 'app', '(tabs)', 'notifications.tsx'),
    activeColor: '#2563EB',
    headerIconBg: '#DBEAFE',
    removeNotice: false,
  },
];

function read(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function write(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
}

function backup(filePath) {
  const backupPath = `${filePath}.backup-${Date.now()}`;
  fs.copyFileSync(filePath, backupPath);
  console.log(`Backup created: ${backupPath}`);
}

function replaceStyleObject(content, styleName, replacementObject) {
  const marker = `${styleName}: {`;
  const start = content.indexOf(marker);

  if (start === -1) {
    return content;
  }

  const objectStart = content.indexOf('{', start);
  let depth = 0;
  let end = -1;

  for (let i = objectStart; i < content.length; i += 1) {
    const char = content[i];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;

    if (depth === 0) {
      end = i;
      break;
    }
  }

  if (end === -1) {
    return content;
  }

  let finalEnd = end + 1;
  if (content[finalEnd] === ',') finalEnd += 1;

  return `${content.slice(0, start)}${styleName}: ${replacementObject},${content.slice(finalEnd)}`;
}

function removeStyleObject(content, styleName) {
  const marker = `${styleName}: {`;
  const start = content.indexOf(marker);

  if (start === -1) {
    return content;
  }

  const objectStart = content.indexOf('{', start);
  let depth = 0;
  let end = -1;

  for (let i = objectStart; i < content.length; i += 1) {
    const char = content[i];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;

    if (depth === 0) {
      end = i;
      break;
    }
  }

  if (end === -1) {
    return content;
  }

  let finalEnd = end + 1;
  if (content[finalEnd] === ',') finalEnd += 1;

  return content.slice(0, start) + content.slice(finalEnd);
}

function ensureReactNativeImport(content, importName) {
  const reactNativeImportRegex = /import\s*\{([\s\S]*?)\}\s*from\s*['"]react-native['"];?/;
  const match = content.match(reactNativeImportRegex);

  if (!match || match[1].includes(importName)) {
    return content;
  }

  const names = match[1]
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  names.push(importName);
  names.sort((a, b) => a.localeCompare(b));

  const nextImport = `import {\n  ${names.join(',\n  ')},\n} from 'react-native';`;
  return content.replace(reactNativeImportRegex, nextImport);
}

function fixNotificationCardProp(content) {
  // The current NotificationCard component expects notification={item}, not item={item}.
  return content.replace(/<NotificationCard([\s\S]*?)\bitem=\{item\}/g, '<NotificationCard$1notification={item}');
}

function removeCustomerNotice(content) {
  // Remove the yellow notice box rendered before the filters.
  content = content.replace(
    /\s*<View\s+style=\{styles\.noticeBox\}>\s*<Text\s+style=\{styles\.noticeText\}>[\s\S]*?<\/Text>\s*<\/View>\s*/g,
    '\n',
  );

  content = removeStyleObject(content, 'noticeBox');
  content = removeStyleObject(content, 'noticeText');

  return content;
}

function wrapFiltersWithHorizontalScroll(content) {
  if (content.includes('styles.filtersScroller')) {
    return content;
  }

  const marker = '<View style={styles.filtersRow}>';
  const start = content.indexOf(marker);

  if (start === -1) {
    return content;
  }

  const tagRegex = /<\/?View\b[^>]*>/g;
  tagRegex.lastIndex = start;

  let depth = 0;
  let openingStart = -1;
  let closingStart = -1;
  let closingEnd = -1;
  let match;

  while ((match = tagRegex.exec(content))) {
    const tag = match[0];

    if (!tag.startsWith('</')) {
      depth += 1;
      if (openingStart === -1) {
        openingStart = match.index;
      }
    } else {
      depth -= 1;
      if (depth === 0) {
        closingStart = match.index;
        closingEnd = tagRegex.lastIndex;
        break;
      }
    }
  }

  if (openingStart === -1 || closingStart === -1 || closingEnd === -1) {
    return content;
  }

  const openingReplacement = `<ScrollView\n        horizontal\n        showsHorizontalScrollIndicator={false}\n        style={styles.filtersScroller}\n        contentContainerStyle={styles.filtersRow}\n      >`;

  return (
    content.slice(0, openingStart) +
    openingReplacement +
    content.slice(openingStart + marker.length, closingStart) +
    '</ScrollView>' +
    content.slice(closingEnd)
  );
}

function compactStyles(content, config) {
  const activeColor = config.activeColor;
  const headerIconBg = config.headerIconBg;

  content = replaceStyleObject(
    content,
    'header',
    `{
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  }`,
  );

  content = replaceStyleObject(
    content,
    'headerIcon',
    `{
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: '${headerIconBg}',
    alignItems: 'center',
    justifyContent: 'center',
  }`,
  );

  content = replaceStyleObject(
    content,
    'headerTitle',
    `{
    fontSize: 19,
    color: '#0F172A',
    fontWeight: '900',
    textAlign: 'right',
    writingDirection: 'rtl',
  }`,
  );

  content = replaceStyleObject(
    content,
    'headerSubtitle',
    `{
    marginTop: 2,
    fontSize: 12,
    color: '#64748B',
    textAlign: 'right',
    writingDirection: 'rtl',
    lineHeight: 18,
  }`,
  );

  content = replaceStyleObject(
    content,
    'searchBox',
    `{
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    minHeight: 42,
    paddingHorizontal: 12,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
  }`,
  );

  content = replaceStyleObject(
    content,
    'searchInput',
    `{
    flex: 1,
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '700',
    paddingVertical: 8,
    writingDirection: 'rtl',
  }`,
  );

  content = replaceStyleObject(
    content,
    'clearSearchButton',
    `{
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
  }`,
  );

  content = replaceStyleObject(
    content,
    'filtersScroller',
    `{
    marginTop: 8,
    maxHeight: 42,
  }`,
  );

  content = replaceStyleObject(
    content,
    'filtersRow',
    `{
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 16,
    paddingTop: 0,
    paddingBottom: 2,
  }`,
  );

  content = replaceStyleObject(
    content,
    'filterButton',
    `{
    minHeight: 34,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row-reverse',
    gap: 6,
  }`,
  );

  content = replaceStyleObject(
    content,
    'filterButtonActive',
    `{
    backgroundColor: '${activeColor}',
    borderColor: '${activeColor}',
  }`,
  );

  content = replaceStyleObject(
    content,
    'filterText',
    `{
    color: '#475569',
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'right',
    writingDirection: 'rtl',
  }`,
  );

  content = replaceStyleObject(
    content,
    'filterTextActive',
    `{
    color: '#FFFFFF',
  }`,
  );

  content = replaceStyleObject(
    content,
    'filterCount',
    `{
    minWidth: 22,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
  }`,
  );

  content = replaceStyleObject(
    content,
    'filterCountActive',
    `{
    backgroundColor: 'rgba(255,255,255,0.22)',
  }`,
  );

  content = replaceStyleObject(
    content,
    'filterCountText',
    `{
    color: '#475569',
    fontWeight: '900',
    fontSize: 11,
  }`,
  );

  content = replaceStyleObject(
    content,
    'filterCountTextActive',
    `{
    color: '#FFFFFF',
  }`,
  );

  content = replaceStyleObject(
    content,
    'listContent',
    `{
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 28,
    gap: 10,
  }`,
  );

  return content;
}

function patchFile(config) {
  console.log(`\nPatching: ${config.label}`);
  let content = read(config.path);
  backup(config.path);

  content = ensureReactNativeImport(content, 'ScrollView');
  content = fixNotificationCardProp(content);

  if (config.removeNotice) {
    content = removeCustomerNotice(content);
  }

  content = wrapFiltersWithHorizontalScroll(content);
  content = compactStyles(content, config);

  write(config.path, content);
  console.log(`Updated: ${config.path}`);
}

try {
  FILES.forEach(patchFile);
  console.log('\nDone. Compact notifications UI patch applied successfully.');
  console.log('Next commands:');
  console.log('  npm run typecheck');
  console.log('  npx expo start -c');
} catch (error) {
  console.error('\nPatch failed:');
  console.error(error.message);
  process.exit(1);
}
