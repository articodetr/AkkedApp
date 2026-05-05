const fs = require('fs');
const path = require('path');

const root = process.cwd();
const receiptPath = path.join(root, 'app', 'receipt-preview.tsx');
const customerDetailsPath = path.join(root, 'app', 'customer-details.tsx');
const report = [];

function ensureFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
}

function write(filePath, src) {
  fs.writeFileSync(filePath, src, 'utf8');
}

function patchReceiptPreview() {
  ensureFile(receiptPath);
  let src = fs.readFileSync(receiptPath, 'utf8');

  const helper = [
    '',
    'function sanitizeReceiptPdfFileName(value: string | number | null | undefined): string {',
    "  const safe = String(value || 'عميل')",
    '    .trim()',
    '    .replace(/[\\\\/:*?\"<>|#%{}~&]/g, \'-\')',
    '    .replace(/\\s+/g, \'_\')',
    '    .replace(/_+/g, \'_\')',
    '    .slice(0, 80);',
    "  return safe || 'عميل';",
    '}',
    '',
    'function buildReceiptPdfName(customerName: string | null | undefined, receiptNo: string | number | null | undefined): string {',
    '  const safeCustomerName = sanitizeReceiptPdfFileName(customerName);',
    "  const safeReceiptNo = sanitizeReceiptPdfFileName(receiptNo || new Date().toISOString().slice(0, 10));",
    '  return `سند_${safeCustomerName}_${safeReceiptNo}.pdf`;',
    '}',
    '',
    'async function prepareNamedReceiptPdf(sourceUri: string, fileName: string): Promise<string> {',
    '  const baseDirectory = FileSystem.cacheDirectory || FileSystem.documentDirectory;',
    '',
    '  if (!baseDirectory) {',
    '    return sourceUri;',
    '  }',
    '',
    '  const targetUri = `${baseDirectory}${fileName}`;',
    '',
    '  if (targetUri === sourceUri) {',
    '    return sourceUri;',
    '  }',
    '',
    '  try {',
    '    const existing = await FileSystem.getInfoAsync(targetUri);',
    '    if (existing.exists) {',
    '      await FileSystem.deleteAsync(targetUri, { idempotent: true });',
    '    }',
    '  } catch {',
    '    // تجاهل خطأ فحص الملف القديم.',
    '  }',
    '',
    '  await FileSystem.copyAsync({ from: sourceUri, to: targetUri });',
    '  return targetUri;',
    '}',
    '',
  ].join('\n');

  if (!src.includes('function buildReceiptPdfName')) {
    src = src.replace('export default function ReceiptPreviewScreen() {', `${helper}\nexport default function ReceiptPreviewScreen() {`);
    report.push('✅ app/receipt-preview.tsx: تم إضافة دوال تسمية السند باسم العميل.');
  } else if (!src.includes('function prepareNamedReceiptPdf')) {
    const prepareOnly = [
      '',
      'async function prepareNamedReceiptPdf(sourceUri: string, fileName: string): Promise<string> {',
      '  const baseDirectory = FileSystem.cacheDirectory || FileSystem.documentDirectory;',
      '',
      '  if (!baseDirectory) {',
      '    return sourceUri;',
      '  }',
      '',
      '  const targetUri = `${baseDirectory}${fileName}`;',
      '',
      '  if (targetUri === sourceUri) {',
      '    return sourceUri;',
      '  }',
      '',
      '  try {',
      '    const existing = await FileSystem.getInfoAsync(targetUri);',
      '    if (existing.exists) {',
      '      await FileSystem.deleteAsync(targetUri, { idempotent: true });',
      '    }',
      '  } catch {',
      '    // تجاهل خطأ فحص الملف القديم.',
      '  }',
      '',
      '  await FileSystem.copyAsync({ from: sourceUri, to: targetUri });',
      '  return targetUri;',
      '}',
      '',
    ].join('\n');
    src = src.replace('export default function ReceiptPreviewScreen() {', `${prepareOnly}\nexport default function ReceiptPreviewScreen() {`);
    report.push('✅ app/receipt-preview.tsx: تم إضافة دالة نسخ PDF إلى اسم واضح قبل المشاركة.');
  }

  const oldReceiptName = 'const pdfName = `receipt_${movementData.receipt_number || movementData.movement_number}.pdf`;';
  const newReceiptName = 'const pdfName = buildReceiptPdfName(receiptData.customerName, movementData.receipt_number || movementData.movement_number);';
  if (src.includes(oldReceiptName)) {
    src = src.replace(oldReceiptName, newReceiptName);
    report.push('✅ app/receipt-preview.tsx: تم تعديل اسم PDF عند إنشاء السند.');
  }

  const oldPdfPath = 'const pdfPath = `${FileSystem.documentDirectory}${pdfName}`;';
  const newPdfPath = 'const pdfPath = await prepareNamedReceiptPdf(uri, pdfName);';
  if (src.includes(oldPdfPath)) {
    src = src.replace(oldPdfPath, newPdfPath);
    report.push('✅ app/receipt-preview.tsx: تم إنشاء مسار PDF باسم العميل بدل اسم Expo المؤقت.');
  }

  const oldMove = 'await FileSystem.moveAsync({ from: uri, to: pdfPath, });';
  if (src.includes(oldMove)) {
    src = src.replace(oldMove, '// تم نسخ ملف PDF إلى اسم واضح باستخدام prepareNamedReceiptPdf.');
    report.push('✅ app/receipt-preview.tsx: تم إلغاء moveAsync الذي قد يترك اسم الملف المؤقت في المشاركة.');
  }

  const shareRegex = /console\.log\('\[ReceiptPreview\] Sharing PDF:', pdfUri\);\s*await Sharing\.shareAsync\(pdfUri,/s;
  if (shareRegex.test(src)) {
    src = src.replace(
      shareRegex,
      "const sharePdfName = buildReceiptPdfName((movement as any)?.customers?.name || (customerName as string) || 'عميل', (movement as any)?.receipt_number || (movement as any)?.movement_number);\n        const sharePdfUri = await prepareNamedReceiptPdf(pdfUri, sharePdfName);\n        console.log('[ReceiptPreview] Sharing PDF:', sharePdfUri);\n        await Sharing.shareAsync(sharePdfUri,"
    );
    report.push('✅ app/receipt-preview.tsx: تم إجبار المشاركة على استخدام نسخة PDF باسم العميل.');
  } else if (src.includes('const sharePdfUri = await prepareNamedReceiptPdf')) {
    report.push('ℹ️ app/receipt-preview.tsx: المشاركة تستخدم مسبقًا ملفًا باسم العميل.');
  } else {
    report.push('⚠️ app/receipt-preview.tsx: لم أجد كتلة مشاركة السند القديمة؛ راجع handleShare يدويًا.');
  }

  const oldDownloadName = 'const pdfName = `receipt_${movement.receipt_number || movement.movement_number}.pdf`;';
  const newDownloadName = "const pdfName = buildReceiptPdfName((movement as any)?.customers?.name || (customerName as string) || 'عميل', movement.receipt_number || movement.movement_number);";
  if (src.includes(oldDownloadName)) {
    src = src.replace(oldDownloadName, newDownloadName);
    report.push('✅ app/receipt-preview.tsx: تم تعديل اسم PDF عند التنزيل.');
  }

  write(receiptPath, src);
}

function patchCustomerDetails() {
  ensureFile(customerDetailsPath);
  let src = fs.readFileSync(customerDetailsPath, 'utf8');

  if (!src.includes("import * as FileSystem from 'expo-file-system/legacy';")) {
    src = src.replace(
      "import * as Sharing from 'expo-sharing';",
      "import * as Sharing from 'expo-sharing';\nimport * as FileSystem from 'expo-file-system/legacy';"
    );
    report.push('✅ app/customer-details.tsx: تم إضافة FileSystem لإعادة تسمية ملفات كشف الحساب.');
  }

  const helper = [
    '',
    'function sanitizeStatementPdfFileName(value: string | number | null | undefined): string {',
    "  const safe = String(value || 'عميل')",
    '    .trim()',
    '    .replace(/[\\\\/:*?\"<>|#%{}~&]/g, \'-\')',
    '    .replace(/\\s+/g, \'_\')',
    '    .replace(/_+/g, \'_\')',
    '    .slice(0, 80);',
    "  return safe || 'عميل';",
    '}',
    '',
    'function buildAccountStatementPdfName(customerName: string | null | undefined): string {',
    '  const safeCustomerName = sanitizeStatementPdfFileName(customerName);',
    "  const date = new Date().toISOString().slice(0, 10);",
    '  return `كشف_حساب_${safeCustomerName}_${date}.pdf`;',
    '}',
    '',
    'async function prepareNamedStatementPdf(sourceUri: string, fileName: string): Promise<string> {',
    '  const baseDirectory = FileSystem.cacheDirectory || FileSystem.documentDirectory;',
    '',
    '  if (!baseDirectory) {',
    '    return sourceUri;',
    '  }',
    '',
    '  const targetUri = `${baseDirectory}${fileName}`;',
    '',
    '  if (targetUri === sourceUri) {',
    '    return sourceUri;',
    '  }',
    '',
    '  try {',
    '    const existing = await FileSystem.getInfoAsync(targetUri);',
    '    if (existing.exists) {',
    '      await FileSystem.deleteAsync(targetUri, { idempotent: true });',
    '    }',
    '  } catch {',
    '    // تجاهل خطأ فحص الملف القديم.',
    '  }',
    '',
    '  await FileSystem.copyAsync({ from: sourceUri, to: targetUri });',
    '  return targetUri;',
    '}',
    '',
  ].join('\n');

  if (!src.includes('function buildAccountStatementPdfName')) {
    if (src.includes('interface GroupedMovements')) {
      src = src.replace('interface GroupedMovements', `${helper}\ninterface GroupedMovements`);
    } else {
      src = src.replace('export default function CustomerDetailsScreen() {', `${helper}\nexport default function CustomerDetailsScreen() {`);
    }
    report.push('✅ app/customer-details.tsx: تم إضافة دوال تسمية كشف الحساب باسم العميل.');
  }

  const oldStatementBlockRegex = /const \{ uri \} = await Print\.printToFileAsync\(\{ html \}\);\s*console\.log\('\[CustomerDetails\] PDF created at:', uri\);\s*const canShare = await Sharing\.isAvailableAsync\(\);/s;
  if (oldStatementBlockRegex.test(src)) {
    src = src.replace(
      oldStatementBlockRegex,
      "const { uri } = await Print.printToFileAsync({ html });\n      const statementPdfName = buildAccountStatementPdfName(customer.name);\n      const namedPdfUri = await prepareNamedStatementPdf(uri, statementPdfName);\n      console.log('[CustomerDetails] PDF created at:', namedPdfUri);\n      const canShare = await Sharing.isAvailableAsync();"
    );
    report.push('✅ app/customer-details.tsx: تم تسمية PDF كشف الحساب قبل المشاركة.');
  }

  const oldStatementShareRegex = /await Sharing\.shareAsync\(uri,\s*\{\s*mimeType: 'application\/pdf',\s*dialogTitle: `كشف حساب \$\{customer\.name\}`,\s*UTI: 'com\.adobe\.pdf',\s*\}\);/s;
  if (oldStatementShareRegex.test(src)) {
    src = src.replace(
      oldStatementShareRegex,
      "await Sharing.shareAsync(namedPdfUri, {\n          mimeType: 'application/pdf',\n          dialogTitle: `كشف حساب ${customer.name}`,\n          UTI: 'com.adobe.pdf',\n        });"
    );
    report.push('✅ app/customer-details.tsx: تم مشاركة كشف الحساب من المسار الجديد وليس uri المؤقت.');
  } else if (src.includes('Sharing.shareAsync(namedPdfUri')) {
    report.push('ℹ️ app/customer-details.tsx: كشف الحساب يستخدم مسبقًا المسار الجديد.');
  } else {
    report.push('⚠️ app/customer-details.tsx: لم أجد مشاركة كشف الحساب القديمة؛ راجع executePrint يدويًا.');
  }

  write(customerDetailsPath, src);
}

try {
  patchReceiptPreview();
  patchCustomerDetails();

  const reportPath = path.join(root, 'PATCH_PDF_FILENAME_FINAL_REPORT.txt');
  fs.writeFileSync(reportPath, report.join('\n'), 'utf8');
  console.log(report.join('\n'));
  console.log(`\nتم إنشاء التقرير: ${reportPath}`);
} catch (error) {
  console.error('فشل تطبيق التعديل:', error.message);
  process.exit(1);
}
