const fs = require('fs');
const path = require('path');

const root = process.cwd();
const filePath = path.join(root, 'components', 'KeyboardAwareView.tsx');
const backupDir = path.join(root, '.keyboard-aware-view-backup');

function ensureBackupDir() {
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
}

function backup(targetPath) {
  ensureBackupDir();

  if (!fs.existsSync(targetPath)) {
    return null;
  }

  const backupName = `${path.basename(targetPath)}.${Date.now()}.bak`;
  const backupPath = path.join(backupDir, backupName);

  fs.copyFileSync(targetPath, backupPath);
  console.log(`Backup created: ${backupPath}`);

  return backupPath;
}

function writeFile(targetPath, content) {
  fs.writeFileSync(targetPath, content, 'utf8');
  console.log(`Updated: ${targetPath}`);
}

function patchKeyboardAwareView() {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${filePath}`);
  }

  backup(filePath);

  let content = fs.readFileSync(filePath, 'utf8');

  // 1) Add style prop to interface if missing
  if (!/style\?\s*:\s*StyleProp<ViewStyle>;/.test(content)) {
    content = content.replace(
      /interface KeyboardAwareViewProps \{/,
      `interface KeyboardAwareViewProps {\n  style?: StyleProp<ViewStyle>;`,
    );
    console.log('Added style prop to KeyboardAwareViewProps.');
  } else {
    console.log('style prop already exists in KeyboardAwareViewProps.');
  }

  // 2) Add style to function destructuring
  if (
    /export function KeyboardAwareView\(\{\s*children,\s*contentContainerStyle,/.test(
      content,
    ) &&
    !/export function KeyboardAwareView\(\{[\s\S]*?\bstyle,/.test(content)
  ) {
    content = content.replace(
      /export function KeyboardAwareView\(\{\s*children,\s*contentContainerStyle,/,
      `export function KeyboardAwareView({\n  children,\n  style,\n  contentContainerStyle,`,
    );
    console.log('Added style to component props destructuring.');
  } else {
    console.log(
      'style already exists in component props destructuring or block not found.',
    );
  }

  // 3) Apply style when useScrollView is false
  content = content.replace(
    /if \(!useScrollView\) \{\s*return\s*\(\s*<KeyboardAvoidingView([^>]*)>\s*\{children\}\s*<\/KeyboardAvoidingView>\s*\);\s*\}/,
    `if (!useScrollView) {\n    return (\n      <KeyboardAvoidingView$1 style={style}>\n        {children}\n      </KeyboardAvoidingView>\n    );\n  }`,
  );

  // 4) Apply style when useScrollView is true
  content = content.replace(
    /return\s*\(\s*<TouchableWithoutFeedback onPress=\{Keyboard\.dismiss\}>\s*<KeyboardAvoidingView([^>]*)>\s*<ScrollView/,
    `return (\n    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>\n      <KeyboardAvoidingView$1 style={style}>\n        <ScrollView`,
  );

  writeFile(filePath, content);
}

try {
  patchKeyboardAwareView();

  console.log('');
  console.log('Done. KeyboardAwareView now supports the style prop.');
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
