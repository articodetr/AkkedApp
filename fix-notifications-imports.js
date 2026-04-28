const fs = require('fs');
const path = require('path');

const files = [
  path.join(process.cwd(), 'app', 'customer-notifications.tsx'),
  path.join(process.cwd(), 'app', '(tabs)', 'notifications.tsx'),
];

const reactImport = `import { useCallback, useEffect, useMemo, useRef, useState } from 'react';`;

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
} from 'react-native';`;

for (const filePath of files) {
  if (!fs.existsSync(filePath)) {
    console.log('File not found:', filePath);
    continue;
  }

  let content = fs.readFileSync(filePath, 'utf8');

  const backupPath = `${filePath}.backup-imports-${Date.now()}`;
  fs.copyFileSync(filePath, backupPath);

  // Replace the first wrong/mixed React import block.
  content = content.replace(
    /import\s*\{[\s\S]*?\}\s*from\s*'react';/,
    `${reactImport}\n${reactNativeImport}`,
  );

  // Remove duplicate react-native import if the file already had one after replacement.
  const parts = content.split(reactNativeImport);
  if (parts.length > 2) {
    content = parts[0] + reactNativeImport + parts.slice(1).join('');
  }

  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Fixed imports:', filePath);
}

console.log('Done. Now run: npm run typecheck');