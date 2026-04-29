const fs = require('fs');
const path = require('path');

const root = process.cwd();
const componentPath = path.join(root, 'components', 'ArabicTemplateTokenBar.tsx');
const backupDir = path.join(root, '.arabic-token-bar-backup');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function backupFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  ensureDir(backupDir);
  const backupPath = path.join(
    backupDir,
    `${path.basename(filePath)}.${Date.now()}.bak`
  );
  fs.copyFileSync(filePath, backupPath);
  console.log(`Backup created: ${backupPath}`);
}

const content = `import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export type ArabicTemplateTokenItem = {
  label: string;
  value?: string;
  token?: string;
};

type ArabicTemplateTokenBarProps = {
  items?: ArabicTemplateTokenItem[];
  tokens?: ArabicTemplateTokenItem[];
  onInsert: (value: string) => void;
};

export function ArabicTemplateTokenBar({
  items,
  tokens,
  onInsert,
}: ArabicTemplateTokenBarProps) {
  const sourceItems = items ?? tokens ?? [];

  return (
    <View style={styles.wrapper}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        {sourceItems.map((item, index) => {
          const insertValue = item.value ?? item.token ?? '';

          return (
            <TouchableOpacity
              key={\`\${item.label}-\${insertValue}-\${index}\`}
              style={styles.tokenButton}
              onPress={() => onInsert(insertValue)}
              activeOpacity={0.8}
            >
              <Text style={styles.tokenText}>{item.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

export default ArabicTemplateTokenBar;

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 12,
  },
  content: {
    flexDirection: 'row-reverse',
    gap: 8,
    paddingVertical: 4,
  },
  tokenButton: {
    backgroundColor: '#F2F4F7',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  tokenText: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '600',
    textAlign: 'center',
  },
});
`;

try {
  ensureDir(path.dirname(componentPath));
  backupFile(componentPath);
  fs.writeFileSync(componentPath, content, 'utf8');
  console.log(`Updated: ${componentPath}`);
  console.log('');
  console.log('Done.');
  console.log('Now run:');
  console.log('1) npm run typecheck');
  console.log('2) npx expo start -c');
} catch (error) {
  console.error('Patch failed:', error.message);
  process.exit(1);
}