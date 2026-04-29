const fs = require('fs');
const path = require('path');

const root = process.cwd();
const backupDir = path.join(root, '.pdf-letterhead-inline-svg-backup');

const files = {
  receiptGenerator: path.join(root, 'utils', 'receiptGenerator.ts'),
  receiptPreview: path.join(root, 'app', 'receipt-preview.tsx'),
};

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

function patchReceiptGenerator() {
  const filePath = files.receiptGenerator;
  let content = read(filePath);
  const original = content;

  backup(filePath);

  if (!content.includes('function renderReceiptHeader(')) {
    const helper = `
function escapeHtmlAttribute(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderReceiptHeader(logoDataUrl?: string): string {
  const fallbackHeader = '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" alt="Default Banner" class="header-banner-image" />';

  if (!logoDataUrl) {
    return fallbackHeader;
  }

  if (logoDataUrl.startsWith('data:image/svg+xml')) {
    const commaIndex = logoDataUrl.indexOf(',');

    if (commaIndex !== -1) {
      const encodedSvg = logoDataUrl.slice(commaIndex + 1);

      try {
        const decodedSvg = decodeURIComponent(encodedSvg).trim();

        if (decodedSvg.startsWith('<svg')) {
          return decodedSvg;
        }
      } catch (error) {
        console.warn('[receiptGenerator] Could not decode SVG header, falling back to <img> rendering.', error);
      }
    }
  }

  return \`<img src="\${escapeHtmlAttribute(logoDataUrl)}" alt="Header Banner" class="header-banner-image" />\`;
}

`;
    content = content.replace(
      /export function generateReceiptHTML\(/,
      `${helper}export function generateReceiptHTML(`
    );
  }

  content = content.replace(
    /\$\{logoDataUrl[\s\S]*?: `<img src="data:image\/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk\+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" alt="Default Banner" class="header-banner-image" \/>`\s*\}/m,
    '${renderReceiptHeader(logoDataUrl)}'
  );

  if (content === original) {
    console.log('No changes were needed in utils/receiptGenerator.ts');
    return;
  }

  write(filePath, content);
}

function patchReceiptPreview() {
  const filePath = files.receiptPreview;
  let content = read(filePath);
  const original = content;

  backup(filePath);

  content = content.replace(
    /customers!customer_id\(name,\s*account_number,\s*phone\)/g,
    'customers!customer_id(name, account_number, phone, receipt_header_mode, receipt_header_banner_url, receipt_header_logo_url)'
  );

  if (content === original) {
    console.log('No changes were needed in app/receipt-preview.tsx');
    return;
  }

  write(filePath, content);
}

try {
  patchReceiptGenerator();
  patchReceiptPreview();

  console.log('');
  console.log('Done. The PDF header now renders inline SVG for stored letterheads and receipt-preview now fetches customer header fields too.');
  console.log('Next steps:');
  console.log('1) npm run typecheck');
  console.log('2) npx expo start -c');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}