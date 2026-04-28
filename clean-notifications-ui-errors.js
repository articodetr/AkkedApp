const fs = require('fs');
const path = require('path');

const root = process.cwd();

const files = [
  path.join(root, 'app', 'customer-notifications.tsx'),
  path.join(root, 'app', '(tabs)', 'notifications.tsx'),
];

const wrongScriptInsideApp = path.join(root, 'app', 'update-notifications-compact-ui.js');

function backupFile(filePath) {
  const backupPath = `${filePath}.backup-clean-${Date.now()}`;
  fs.copyFileSync(filePath, backupPath);
  console.log(`Backup created: ${backupPath}`);
}

function normalizeImports(content) {
  const reactImport = "import { useCallback, useEffect, useMemo, useRef, useState } from 'react';\n";
  const reactNativeImport = `import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';\n`;

  // Remove any broken/duplicate import blocks from react and react-native.
  content = content.replace(/import\s*\{[\s\S]*?\}\s*from\s*['"]react['"];\s*/g, '');
  content = content.replace(/import\s*\{[\s\S]*?\}\s*from\s*['"]react-native['"];\s*/g, '');

  return `${reactImport}${reactNativeImport}${content.trimStart()}`;
}

function ensureFiltersScrollerStyle(content) {
  if (!content.includes('styles.filtersScroller')) {
    return content;
  }

  if (content.includes('filtersScroller:')) {
    return content;
  }

  const filtersScrollerStyle = `filtersScroller: {
    maxHeight: 52,
    marginTop: 8,
  },
  `;

  if (content.includes('filtersRow:')) {
    return content.replace(/(\s{2}filtersRow:\s*\{)/, `  ${filtersScrollerStyle}$1`);
  }

  if (content.includes('listContent:')) {
    return content.replace(/(\s{2}listContent:\s*\{)/, `  ${filtersScrollerStyle}$1`);
  }

  const marker = 'const styles = StyleSheet.create({';
  if (content.includes(marker)) {
    return content.replace(marker, `${marker}\n  ${filtersScrollerStyle}`);
  }

  return content;
}

function ensureNotificationCardProp(content) {
  return content.replace(/<NotificationCard([\s\S]*?)\n\s*item=\{item\}/g, '<NotificationCard$1\n            notification={item}');
}

function cleanFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`Skipped missing file: ${filePath}`);
    return;
  }

  console.log(`\nCleaning: ${filePath}`);
  backupFile(filePath);

  let content = fs.readFileSync(filePath, 'utf8');

  content = normalizeImports(content);
  content = ensureFiltersScrollerStyle(content);
  content = ensureNotificationCardProp(content);

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Updated: ${filePath}`);
}

try {
  if (fs.existsSync(wrongScriptInsideApp)) {
    fs.rmSync(wrongScriptInsideApp, { force: true });
    console.log(`Removed wrong Expo route file: ${wrongScriptInsideApp}`);
  }

  for (const filePath of files) {
    cleanFile(filePath);
  }

  console.log('\nDone.');
  console.log('Now run:');
  console.log('  npm run typecheck');
  console.log('  npx expo start -c --port 8082');
} catch (error) {
  console.error('\nPatch failed:');
  console.error(error);
  process.exit(1);
}
