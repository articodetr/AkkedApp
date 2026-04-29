const fs = require('fs');
const path = require('path');

const root = process.cwd();
const backupDir = path.join(root, '.pdf-letterhead-user-settings-backup');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function backup(filePath) {
  ensureDir(backupDir);
  const backupPath = path.join(
    backupDir,
    `${path.basename(filePath)}.${Date.now()}.bak`
  );
  fs.copyFileSync(filePath, backupPath);
  console.log('Backup created:', backupPath);
}

function read(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function write(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Updated:', filePath);
}

function replaceOne(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) {
    throw new Error(`Patch failed: Could not find pattern for: ${label}`);
  }
  return next;
}

function patchLogoHelper() {
  const filePath = path.join(root, 'utils', 'logoHelper.ts');
  let content = read(filePath);
  backup(filePath);

  if (!content.includes('type ReceiptHeaderContext = {')) {
    const insertTypes = [
      "const DEFAULT_RECEIPT_HEADER = require('../assets/images/default-header.png');",
      '',
      'type ReceiptHeaderContext = {',
      '  userId?: string | null;',
      '};',
      '',
      'type StoredLetterheadSettings = {',
      '  logo_url?: string | null;',
      '  business_name?: string | null;',
      '  phone_number?: string | null;',
      '  background_color?: string | null;',
      '  primary_color?: string | null;',
      '  text_color?: string | null;',
      '  border_color?: string | null;',
      '  accent_color?: string | null;',
      '  show_logo?: boolean | null;',
      '  show_phone?: boolean | null;',
      '};',
      '',
      "const DEFAULT_LETTERHEAD_BACKGROUND_COLOR = '#FFFFFF';",
      "const DEFAULT_LETTERHEAD_PRIMARY_COLOR = '#111827';",
      "const DEFAULT_LETTERHEAD_TEXT_COLOR = '#374151';",
      "const DEFAULT_LETTERHEAD_BORDER_COLOR = '#E5E7EB';",
      "const DEFAULT_LETTERHEAD_ACCENT_COLOR = '#0EA5E9';",
      '',
    ].join('\n');

    content = replaceOne(
      content,
      /const DEFAULT_RECEIPT_HEADER = require\('\.\.\/assets\/images\/default-header\.png'\);\r?\n/,
      `${insertTypes}`,
      'logoHelper default header constants'
    );
  }

  if (!content.includes('async function getStoredLetterheadHeaderBase64(')) {
    const helperBlock = [
      'function buildStoredLetterheadHeaderSvg(',
      '  settings: StoredLetterheadSettings,',
      '  logoHref?: string | null',
      '): string {',
      '  const background = sanitizeHexColor(',
      '    settings.background_color,',
      '    DEFAULT_LETTERHEAD_BACKGROUND_COLOR',
      '  );',
      '  const primary = sanitizeHexColor(',
      '    settings.primary_color,',
      '    DEFAULT_LETTERHEAD_PRIMARY_COLOR',
      '  );',
      '  const textColor = sanitizeHexColor(',
      '    settings.text_color,',
      '    DEFAULT_LETTERHEAD_TEXT_COLOR',
      '  );',
      '  const border = sanitizeHexColor(',
      '    settings.border_color,',
      '    DEFAULT_LETTERHEAD_BORDER_COLOR',
      '  );',
      '  const accent = sanitizeHexColor(',
      '    settings.accent_color,',
      '    DEFAULT_LETTERHEAD_ACCENT_COLOR',
      '  );',
      "  const businessName = escapeXml(settings.business_name?.trim() || 'ArtiCode');",
      "  const phoneNumber = escapeXml(settings.phone_number?.trim() || '');",
      '  const showLogo = settings.show_logo ?? true;',
      '  const showPhone = settings.show_phone ?? true;',
      "  const initials = escapeXml((settings.business_name?.trim()?.charAt(0) || 'A').toUpperCase());",
      '',
      '  return `',
      '  <svg xmlns="http://www.w3.org/2000/svg" width="2048" height="405" viewBox="0 0 2048 405">',
      '    <defs>',
      '      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">',
      '        <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="rgba(0,0,0,0.18)" />',
      '      </filter>',
      '    </defs>',
      '    <rect width="2048" height="405" fill="transparent" />',
      '    <rect x="10" y="10" width="2028" height="385" rx="42" fill="${background}" stroke="${border}" stroke-width="10" filter="url(#shadow)" />',
      '    <rect x="590" y="120" width="1180" height="14" rx="7" fill="${accent}" fill-opacity="0.14" />',
      '    <rect x="920" y="275" width="850" height="12" rx="6" fill="${accent}" fill-opacity="0.08" />',
      '    ${showLogo ? `',
      '      <circle cx="255" cy="202.5" r="108" fill="${accent}" fill-opacity="0.10" stroke="${accent}" stroke-width="6" />',
      '      ${logoHref',
      '        ? `<image href="${logoHref}" x="155" y="102.5" width="200" height="200" preserveAspectRatio="xMidYMid meet" />`',
      '        : `<text x="255" y="226" text-anchor="middle" font-size="96" font-weight="700" fill="${accent}">${initials}</text>`',
      '      }',
      '    ` : ``}',
      '    <text x="1810" y="186" text-anchor="end" font-size="82" font-weight="800" fill="${primary}">${businessName}</text>',
      '    ${showPhone && phoneNumber',
      '      ? `<text x="1810" y="266" text-anchor="end" font-size="44" font-weight="600" fill="${textColor}">رقم الهاتف: ${phoneNumber}</text>`',
      '      : ``',
      '    }',
      '  </svg>',
      '  `;',
      '}',
      '',
      'function buildStoredLetterheadHeaderDataUrl(',
      '  settings: StoredLetterheadSettings,',
      '  logoHref?: string | null',
      '): string {',
      '  const svg = buildStoredLetterheadHeaderSvg(settings, logoHref);',
      '  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;',
      '}',
      '',
      'async function getStoredLetterheadHeaderBase64(',
      '  userId?: string | null',
      '): Promise<string | null> {',
      '  if (!userId) return null;',
      '',
      '  try {',
      '    const { data, error } = await supabase',
      "      .from('letterhead_settings')",
      "      .select('logo_url, business_name, phone_number, background_color, primary_color, text_color, border_color, accent_color, show_logo, show_phone')",
      "      .eq('user_id', userId)",
      '      .maybeSingle();',
      '',
      '    if (error || !data) {',
      '      return null;',
      '    }',
      '',
      '    const logoDataUrl = data.show_logo && data.logo_url',
      '      ? await downloadAndConvertImageToBase64(data.logo_url)',
      '      : null;',
      '',
      '    return buildStoredLetterheadHeaderDataUrl(data, logoDataUrl);',
      '  } catch (error) {',
      "    console.error('[logoHelper] Error loading stored letterhead settings:', error);",
      '    return null;',
      '  }',
      '}',
      '',
    ].join('\n');

    content = replaceOne(
      content,
      /async function getAppReceiptLogoBase64\(forceRefresh = false\): Promise<string> \{/,
      `${helperBlock}async function getAppReceiptLogoBase64(forceRefresh = false): Promise<string> {`,
      'insert stored letterhead helpers'
    );
  }

  if (!content.includes('context: ReceiptHeaderContext = {}')) {
    const getCustomerBlock = [
      'export async function getCustomerReceiptHeaderBase64(',
      '  customer?: Partial<Customer> | null,',
      '  forceRefresh = false,',
      '  context: ReceiptHeaderContext = {}',
      '): Promise<string> {',
      '  try {',
      "    const mode = customer?.receipt_header_mode || 'default';",
      '',
      "    if (!customer || mode === 'default') {",
      '      const storedLetterhead = await getStoredLetterheadHeaderBase64(context.userId);',
      '',
      '      if (storedLetterhead) {',
      '        return storedLetterhead;',
      '      }',
      '',
      '      return await getAppReceiptLogoBase64(forceRefresh);',
      '    }',
      '',
      "    if (mode === 'full_banner' && customer.receipt_header_banner_url) {",
      '      const banner = await downloadAndConvertImageToBase64(customer.receipt_header_banner_url);',
      '',
      '      return banner || (await getAppReceiptLogoBase64(forceRefresh));',
      '    }',
      '',
      "    if (mode === 'generated') {",
      '      let centerLogo: string | null = null;',
      '',
      '      if (customer.receipt_header_logo_url) {',
      '        centerLogo = await downloadAndConvertImageToBase64(customer.receipt_header_logo_url);',
      '      }',
      '',
      '      return buildGeneratedCustomerHeaderDataUrl(customer, centerLogo);',
      '    }',
      '',
      '    const storedLetterhead = await getStoredLetterheadHeaderBase64(context.userId);',
      '',
      '    if (storedLetterhead) {',
      '      return storedLetterhead;',
      '    }',
      '',
      '    return await getAppReceiptLogoBase64(forceRefresh);',
      '  } catch (error) {',
      "    console.error('[logoHelper] Error in getCustomerReceiptHeaderBase64:', error);",
      '',
      '    const storedLetterhead = await getStoredLetterheadHeaderBase64(context.userId);',
      '',
      '    if (storedLetterhead) {',
      '      return storedLetterhead;',
      '    }',
      '',
      '    return await getAppReceiptLogoBase64(forceRefresh);',
      '  }',
      '}',
      '',
    ].join('\n');

    content = replaceOne(
      content,
      /export async function getCustomerReceiptHeaderBase64\([\s\S]*?\n\}\r?\n\r?\nexport async function getReceiptLogoBase64\(/,
      `${getCustomerBlock}export async function getReceiptLogoBase64(`,
      'replace getCustomerReceiptHeaderBase64'
    );

    const getReceiptBlock = [
      'export async function getReceiptLogoBase64(',
      '  forceRefresh = false,',
      '  customer?: Partial<Customer> | null,',
      '  context: ReceiptHeaderContext = {}',
      '): Promise<string> {',
      '  return getCustomerReceiptHeaderBase64(customer, forceRefresh, context);',
      '}',
      '',
    ].join('\n');

    content = replaceOne(
      content,
      /export async function getReceiptLogoBase64\([\s\S]*?\n\}\r?\n\r?\nexport async function getLogoBase64\(/,
      `${getReceiptBlock}export async function getLogoBase64(`,
      'replace getReceiptLogoBase64'
    );

    const getLogoBlock = [
      'export async function getLogoBase64(',
      '  forceRefresh = false,',
      '  customer?: Partial<Customer> | null,',
      '  context: ReceiptHeaderContext = {}',
      '): Promise<string> {',
      '  return getCustomerReceiptHeaderBase64(customer, forceRefresh, context);',
      '}',
      '',
    ].join('\n');

    content = replaceOne(
      content,
      /export async function getLogoBase64\([\s\S]*?\n\}\r?\n\r?\nexport async function getLogoUrl\(\): Promise<string> \{/,
      `${getLogoBlock}export async function getLogoUrl(): Promise<string> {`,
      'replace getLogoBase64'
    );
  }

  write(filePath, content);
}

function patchReceiptPreview() {
  const filePath = path.join(root, 'app', 'receipt-preview.tsx');
  let content = read(filePath);
  backup(filePath);

  if (
    !content.includes(
      "logoDataUrl = await getCustomerReceiptHeaderBase64(customerData, forceRefresh, {"
    )
  ) {
    content = replaceOne(
      content,
      /logoDataUrl = await getCustomerReceiptHeaderBase64\(customerData, forceRefresh\);/,
      `logoDataUrl = await getCustomerReceiptHeaderBase64(customerData, forceRefresh, {
        userId: currentUser?.userId,
      });`,
      'receipt-preview letterhead context'
    );
  }

  write(filePath, content);
}

try {
  patchLogoHelper();
  patchReceiptPreview();
  console.log('');
  console.log('Done. PDF receipts now use the saved user letterhead before falling back to the default header.');
  console.log('Next step: npm run typecheck');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}