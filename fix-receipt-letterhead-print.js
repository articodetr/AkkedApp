const fs = require('fs');
const path = require('path');

const root = process.cwd();
const backupDir = path.join(root, '.receipt-letterhead-print-backup');
const HELPER_BLOCK = "async function getUserLetterheadHeaderBase64(\n  userId?: string | null\n): Promise<string | null> {\n  if (!userId) {\n    return null;\n  }\n\n  try {\n    const { data, error } = await supabase\n      .from('letterhead_settings')\n      .select(\n        'logo_url, business_name, phone_number, background_color, primary_color, text_color, border_color, accent_color, show_logo, show_phone'\n      )\n      .eq('user_id', userId)\n      .maybeSingle();\n\n    if (error || !data) {\n      return null;\n    }\n\n    let centerLogo: string | null = null;\n\n    if (data.show_logo && data.logo_url) {\n      centerLogo = await downloadAndConvertImageToBase64(data.logo_url);\n    }\n\n    const primary = data.primary_color || '#111827';\n    const accent = data.accent_color || primary;\n    const textColor = data.text_color || '#FFFFFF';\n    const businessName = escapeXml(data.business_name || 'ArtiCode');\n    const phoneNumber = escapeXml(data.phone_number || '');\n\n    const svg = `\n<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"2048\" height=\"405\" viewBox=\"0 0 2048 405\">\n  <defs>\n    <linearGradient id=\"bg\" x1=\"0%\" y1=\"0%\" x2=\"100%\" y2=\"0%\">\n      <stop offset=\"0%\" stop-color=\"${primary}\" />\n      <stop offset=\"100%\" stop-color=\"${accent}\" />\n    </linearGradient>\n  </defs>\n  <rect width=\"2048\" height=\"405\" fill=\"url(#bg)\" />\n  <rect x=\"80\" y=\"70\" width=\"560\" height=\"265\" rx=\"28\" fill=\"rgba(255,255,255,0.10)\" />\n  <rect x=\"1408\" y=\"70\" width=\"560\" height=\"265\" rx=\"28\" fill=\"rgba(255,255,255,0.10)\" />\n  <circle cx=\"1024\" cy=\"202.5\" r=\"108\" fill=\"#ffffff\" />\n  ${\n    centerLogo\n      ? `<image href=\"${centerLogo}\" x=\"932\" y=\"110.5\" width=\"184\" height=\"184\" preserveAspectRatio=\"xMidYMid meet\" />`\n      : ''\n  }\n  <text x=\"140\" y=\"155\" font-size=\"52\" font-weight=\"700\" fill=\"${textColor}\">${businessName}</text>\n  ${\n    data.show_phone && phoneNumber\n      ? `<text x=\"140\" y=\"225\" font-size=\"34\" font-weight=\"500\" fill=\"${textColor}\">${phoneNumber}</text>`\n      : ''\n  }\n</svg>\n    `;\n\n    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;\n  } catch (error) {\n    console.error('[logoHelper] Error in getUserLetterheadHeaderBase64:', error);\n    return null;\n  }\n}\n\n";
const NEW_RECEIPT_HEADER_FUNCTION = "export async function getCustomerReceiptHeaderBase64(\n  customer?: Partial<Customer> | null,\n  forceRefresh = false,\n  userId?: string | null\n): Promise<string> {\n  try {\n    const mode = customer?.receipt_header_mode || 'default';\n\n    if (customer && mode === 'full_banner' && customer.receipt_header_banner_url) {\n      const banner = await downloadAndConvertImageToBase64(customer.receipt_header_banner_url);\n      return banner || (await getAppReceiptLogoBase64(forceRefresh));\n    }\n\n    if (customer && mode === 'generated') {\n      let centerLogo: string | null = null;\n\n      if (customer.receipt_header_logo_url) {\n        centerLogo = await downloadAndConvertImageToBase64(customer.receipt_header_logo_url);\n      }\n\n      return buildGeneratedCustomerHeaderDataUrl(customer, centerLogo);\n    }\n\n    const userLetterhead = await getUserLetterheadHeaderBase64(userId);\n\n    if (userLetterhead) {\n      return userLetterhead;\n    }\n\n    return await getAppReceiptLogoBase64(forceRefresh);\n  } catch (error) {\n    console.error('[logoHelper] Error in getCustomerReceiptHeaderBase64:', error);\n    return await getAppReceiptLogoBase64(forceRefresh);\n  }\n}\n\n";
const NEW_RECEIPT_LOGO_WRAPPER = "export async function getReceiptLogoBase64(\n  forceRefresh = false,\n  customer?: Partial<Customer> | null,\n  userId?: string | null\n): Promise<string> {\n  return getCustomerReceiptHeaderBase64(customer, forceRefresh, userId);\n}";
const NEW_LOGO_WRAPPER = "export async function getLogoBase64(\n  forceRefresh = false,\n  customer?: Partial<Customer> | null,\n  userId?: string | null\n): Promise<string> {\n  return getCustomerReceiptHeaderBase64(customer, forceRefresh, userId);\n}";

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function backup(filePath) {
  ensureDir(backupDir);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const backupPath = path.join(
    backupDir,
    `${path.basename(filePath)}.${Date.now()}.bak`
  );

  fs.copyFileSync(filePath, backupPath);
  console.log('Backup created:', backupPath);
  return backupPath;
}

function readFile(relativePath) {
  const filePath = path.join(root, relativePath);

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${relativePath}`);
  }

  return {
    filePath,
    content: fs.readFileSync(filePath, 'utf8'),
  };
}

function writeFile(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
}

function patchReceiptPreview() {
  const relativePath = path.join('app', 'receipt-preview.tsx');
  const { filePath, content } = readFile(relativePath);
  const alreadyPatched = content.includes(
    'getCustomerReceiptHeaderBase64(customerData, forceRefresh, currentUser?.userId)'
  );

  if (alreadyPatched) {
    console.log('No changes needed in app/receipt-preview.tsx');
    return false;
  }

  const oldSnippet = 'logoDataUrl = await getCustomerReceiptHeaderBase64(customerData, forceRefresh);';
  const newSnippet =
    'logoDataUrl = await getCustomerReceiptHeaderBase64(customerData, forceRefresh, currentUser?.userId);';

  if (!content.includes(oldSnippet)) {
    throw new Error(
      'Could not find the receipt header loading line inside app/receipt-preview.tsx'
    );
  }

  backup(filePath);
  const updated = content.replace(oldSnippet, newSnippet);
  writeFile(filePath, updated);
  console.log('Updated:', relativePath);
  return true;
}

function patchLogoHelper() {
  const relativePath = path.join('utils', 'logoHelper.ts');
  const { filePath, content } = readFile(relativePath);

  let updated = content;
  let changed = false;

  const helperName = 'async function getUserLetterheadHeaderBase64(';
  if (!updated.includes(helperName)) {
    const insertionMarker = 'export async function getCustomerReceiptHeaderBase64(';

    if (!updated.includes(insertionMarker)) {
      throw new Error(
        'Could not find getCustomerReceiptHeaderBase64 marker inside utils/logoHelper.ts'
      );
    }

    updated = updated.replace(insertionMarker, HELPER_BLOCK + insertionMarker);
    changed = true;
  }

  const startMarker = 'export async function getCustomerReceiptHeaderBase64(';
  const endMarker = 'export async function getReceiptLogoBase64(';
  const startIndex = updated.indexOf(startMarker);
  const endIndex = updated.indexOf(endMarker);

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    throw new Error(
      'Could not isolate getCustomerReceiptHeaderBase64 block inside utils/logoHelper.ts'
    );
  }

  const existingBlock = updated.slice(startIndex, endIndex);
  if (existingBlock !== NEW_RECEIPT_HEADER_FUNCTION) {
    updated = updated.slice(0, startIndex) + NEW_RECEIPT_HEADER_FUNCTION + updated.slice(endIndex);
    changed = true;
  }

  const receiptLogoWrapperRegex = /export async function getReceiptLogoBase64\([\s\S]*?\): Promise<string> \{[\s\S]*?return getCustomerReceiptHeaderBase64\(customer, forceRefresh(?:, userId)?\);\s*\}/;
  if (receiptLogoWrapperRegex.test(updated)) {
    updated = updated.replace(receiptLogoWrapperRegex, NEW_RECEIPT_LOGO_WRAPPER);
    changed = true;
  } else {
    throw new Error('Could not update getReceiptLogoBase64 wrapper in utils/logoHelper.ts');
  }

  const logoWrapperRegex = /export async function getLogoBase64\([\s\S]*?\): Promise<string> \{[\s\S]*?return getCustomerReceiptHeaderBase64\(customer, forceRefresh(?:, userId)?\);\s*\}/;
  if (logoWrapperRegex.test(updated)) {
    updated = updated.replace(logoWrapperRegex, NEW_LOGO_WRAPPER);
    changed = true;
  } else {
    throw new Error('Could not update getLogoBase64 wrapper in utils/logoHelper.ts');
  }

  if (!changed) {
    console.log('No changes needed in utils/logoHelper.ts');
    return false;
  }

  backup(filePath);
  writeFile(filePath, updated);
  console.log('Updated:', relativePath);
  return true;
}

try {
  const changedReceiptPreview = patchReceiptPreview();
  const changedLogoHelper = patchLogoHelper();

  console.log('');
  console.log('Done. Receipt printing now reads the saved user letterhead before the default app header.');
  console.log('');
  console.log('Changed files:');
  console.log(`- app/receipt-preview.tsx: ${changedReceiptPreview ? 'updated' : 'unchanged'}`);
  console.log(`- utils/logoHelper.ts: ${changedLogoHelper ? 'updated' : 'unchanged'}`);
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
