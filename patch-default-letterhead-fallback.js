const fs = require('fs');
const path = require('path');

const root = process.cwd();
const filePath = path.join(root, 'utils', 'logoHelper.ts');
const backupDir = path.join(root, '.logo-helper-default-fallback-backup');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function backup(targetPath) {
  ensureDir(backupDir);

  if (!fs.existsSync(targetPath)) {
    return null;
  }

  const backupPath = path.join(
    backupDir,
    `${path.basename(targetPath)}.${Date.now()}.bak`
  );

  fs.copyFileSync(targetPath, backupPath);
  console.log(`Backup created: ${backupPath}`);
  return backupPath;
}

function writeFile(targetPath, content) {
  fs.writeFileSync(targetPath, content, 'utf8');
  console.log(`Updated: ${targetPath}`);
}

function patchLogoHelper() {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${filePath}`);
  }

  backup(filePath);

  let content = fs.readFileSync(filePath, 'utf8');

  // Add Asset import if missing
  if (!content.includes(`import { Asset } from 'expo-asset';`)) {
    content = content.replace(
      `import { Platform } from 'react-native';`,
      `import { Platform } from 'react-native';\nimport { Asset } from 'expo-asset';`
    );
    console.log('Added Asset import.');
  }

  // Add default banner require if missing
  if (!content.includes(`const DEFAULT_RECEIPT_BANNER = require('@/assets/images/altaraf.png');`)) {
    content = content.replace(
      `const FIXED_SETTINGS_ID = '00000000-0000-0000-0000-000000000000';`,
      `const FIXED_SETTINGS_ID = '00000000-0000-0000-0000-000000000000';\nconst DEFAULT_RECEIPT_BANNER = require('@/assets/images/altaraf.png');`
    );
    console.log('Added DEFAULT_RECEIPT_BANNER constant.');
  }

  // Add helper function if missing
  if (!content.includes(`async function getDefaultReceiptBannerBase64()`)) {
    const insertAfter = `async function downloadAndConvertLogoToBase64(logoUrl: string): Promise<string | null> {`;
    const startIndex = content.indexOf(insertAfter);
    if (startIndex === -1) {
      throw new Error('Could not find insertion point for default banner helper.');
    }

    // find end of existing function by first occurrence of "\n}\n\nexport async function getReceiptLogoBase64"
    const marker = `\n}\n\nexport async function getReceiptLogoBase64`;
    const markerIndex = content.indexOf(marker);
    if (markerIndex === -1) {
      throw new Error('Could not find receipt logo function marker.');
    }

    const helperCode = `
async function getDefaultReceiptBannerBase64(): Promise<string> {
  try {
    if (Platform.OS === 'web') {
      const asset = Asset.fromModule(DEFAULT_RECEIPT_BANNER);
      return asset?.uri || '';
    }

    const asset = Asset.fromModule(DEFAULT_RECEIPT_BANNER);
    await asset.downloadAsync();

    const localUri = asset.localUri || asset.uri;
    if (!localUri) return '';

    const base64 = await FileSystem.readAsStringAsync(localUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    if (!base64) return '';

    return 'data:image/png;base64,' + base64;
  } catch (error) {
    console.error('[logoHelper] Error loading default receipt banner:', error);
    return '';
  }
}

`;
    content = content.replace(marker, `\n}\n\n${helperCode}export async function getReceiptLogoBase64`);
    console.log('Added getDefaultReceiptBannerBase64 helper.');
  }

  // Replace DEFAULT return behavior
  content = content.replace(
    `if (settings.selected_receipt_logo === 'DEFAULT') {
      console.log('[logoHelper] User selected DEFAULT logo, no logo available');
      return '';
    }`,
    `if (settings.selected_receipt_logo === 'DEFAULT') {
      console.log('[logoHelper] User selected DEFAULT logo, loading bundled default banner');
      return await getDefaultReceiptBannerBase64();
    }`
  );

  // Replace no settings fallback
  content = content.replace(
    `if (!settings) {
      console.log('[logoHelper] No settings found, no logo available');
      return '';
    }`,
    `if (!settings) {
      console.log('[logoHelper] No settings found, loading bundled default banner');
      return await getDefaultReceiptBannerBase64();
    }`
  );

  // Replace no logo URL fallback
  content = content.replace(
    `if (!logoUrl || logoUrl === 'DEFAULT') {
      console.log('[logoHelper] No uploaded logo URL found');
      return '';
    }`,
    `if (!logoUrl || logoUrl === 'DEFAULT') {
      console.log('[logoHelper] No uploaded logo URL found, loading bundled default banner');
      return await getDefaultReceiptBannerBase64();
    }`
  );

  // Replace error fallback
  content = content.replace(
    `return '';`,
    `return '';`
  );

  writeFile(filePath, content);
}

try {
  patchLogoHelper();
  console.log('');
  console.log('Done. Default bundled receipt banner fallback has been added.');
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