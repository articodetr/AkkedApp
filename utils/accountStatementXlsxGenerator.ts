import JSZip from 'jszip';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { AccountMovement, CURRENCIES } from '@/types/database';
import { getMovementApprovalLabel, isPostedMovement } from './movementApproval';

interface SheetCell {
  ref: string;
  value: string | number;
  style: number;
  type?: 'number' | 'string';
}

interface SheetRow {
  index: number;
  height?: number;
  cells: SheetCell[];
}

interface EmbeddedImage {
  extension: 'png' | 'jpg' | 'jpeg' | 'svg' | 'webp';
  contentType: string;
  data: string;
  encoding: 'base64' | 'text';
  dimensions?: ImageDimensions;
}

interface ImageDimensions {
  width: number;
  height: number;
}

interface CompanyHeaderInfo {
  nameAr?: string | null;
  nameEn?: string | null;
  phoneAr?: string | null;
  phoneEn?: string | null;
  addressAr?: string | null;
  addressEn?: string | null;
}

interface AccountStatementXlsxOptions {
  customerName: string;
  movements: AccountMovement[];
  previousMovements?: AccountMovement[];
  logoDataUrl?: string;
  companyHeader?: CompanyHeaderInfo;
  isProfitLossAccount?: boolean;
  currentUser?: {
    userId?: string | null;
    userName?: string | null;
    fullName?: string | null;
  } | null;
}

function getCurrencyName(code: string): string {
  const currency = CURRENCIES.find((c) => c.code === code);
  return currency?.name || code;
}

function getCurrencySymbol(code: string): string {
  const currency = CURRENCIES.find((c) => c.code === code);
  return currency?.symbol || code;
}

function formatAmount(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 20,
  });
}

function escapeXml(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnName(index: number): string {
  let name = '';
  let value = index;

  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }

  return name;
}

const WORKSHEET_COLUMN_WIDTHS = [8, 14, 18, 16, 16, 16, 14, 18, 14, 24, 22, 22, 34];
const WORKSHEET_LAST_COLUMN = columnName(WORKSHEET_COLUMN_WIDTHS.length);
const HEADER_IMAGE_MAX_WIDTH = 560;
const HEADER_IMAGE_MAX_HEIGHT = 126;
const HEADER_IMAGE_TOP_PADDING = 4;

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getImageContentType(extension: EmbeddedImage['extension']): string {
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'svg') return 'image/svg+xml';
  if (extension === 'webp') return 'image/webp';
  return 'image/png';
}

function base64ToBytes(base64: string): Uint8Array | null {
  try {
    if (typeof globalThis.atob !== 'function') return null;

    const binary = globalThis.atob(base64.replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
  } catch {
    return null;
  }
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) + bytes[offset + 1];
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + (bytes[offset + 1] << 8);
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16);
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

function parsePngDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (
    bytes.length < 24 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47
  ) {
    return undefined;
  }

  return {
    width: readUint32BE(bytes, 16),
    height: readUint32BE(bytes, 20),
  };
}

function parseJpegDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return undefined;
  }

  let offset = 2;

  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1];

    if (marker === 0xd9 || marker === 0xda) {
      break;
    }

    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }

    const segmentLength = readUint16BE(bytes, offset + 2);
    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;

    if (isStartOfFrame && offset + 8 < bytes.length) {
      return {
        width: readUint16BE(bytes, offset + 7),
        height: readUint16BE(bytes, offset + 5),
      };
    }

    offset += 2 + segmentLength;
  }

  return undefined;
}

function parseWebpDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (
    bytes.length < 30 ||
    String.fromCharCode(...bytes.slice(0, 4)) !== 'RIFF' ||
    String.fromCharCode(...bytes.slice(8, 12)) !== 'WEBP'
  ) {
    return undefined;
  }

  const chunkType = String.fromCharCode(...bytes.slice(12, 16));

  if (chunkType === 'VP8X' && bytes.length >= 30) {
    return {
      width: readUint24LE(bytes, 24) + 1,
      height: readUint24LE(bytes, 27) + 1,
    };
  }

  if (chunkType === 'VP8 ' && bytes.length >= 30) {
    return {
      width: readUint16LE(bytes, 26) & 0x3fff,
      height: readUint16LE(bytes, 28) & 0x3fff,
    };
  }

  if (chunkType === 'VP8L' && bytes.length >= 25) {
    return {
      width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
      height: 1 + ((bytes[22] & 0xc0) >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10),
    };
  }

  return undefined;
}

function parseSvgDimensions(svgText: string): ImageDimensions | undefined {
  const svgTag = svgText.match(/<svg\b[^>]*>/i)?.[0] || '';
  const widthValue = svgTag.match(/\bwidth=["']([\d.]+)/i)?.[1];
  const heightValue = svgTag.match(/\bheight=["']([\d.]+)/i)?.[1];
  const width = widthValue ? Number(widthValue) : 0;
  const height = heightValue ? Number(heightValue) : 0;

  if (width > 0 && height > 0) {
    return { width, height };
  }

  const viewBox = svgTag.match(/\bviewBox=["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/i);
  const viewBoxWidth = viewBox ? Number(viewBox[1]) : 0;
  const viewBoxHeight = viewBox ? Number(viewBox[2]) : 0;

  if (viewBoxWidth > 0 && viewBoxHeight > 0) {
    return { width: viewBoxWidth, height: viewBoxHeight };
  }

  return undefined;
}

function getRasterImageDimensions(
  extension: EmbeddedImage['extension'],
  base64: string,
): ImageDimensions | undefined {
  const bytes = base64ToBytes(base64);
  if (!bytes) return undefined;

  if (extension === 'png') return parsePngDimensions(bytes);
  if (extension === 'jpg' || extension === 'jpeg') return parseJpegDimensions(bytes);
  if (extension === 'webp') return parseWebpDimensions(bytes);

  return undefined;
}

function parseRasterImageDataUrl(dataUrl: string): EmbeddedImage | null {
  const match = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
  if (!match) return null;

  const extension = match[1].toLowerCase() as EmbeddedImage['extension'];
  const data = match[2].replace(/\s/g, '');

  return {
    extension,
    contentType: getImageContentType(extension),
    data,
    encoding: 'base64',
    dimensions: getRasterImageDimensions(extension, data),
  };
}

function parseSvgImageDataUrl(dataUrl: string): EmbeddedImage | null {
  const svgMatch = dataUrl.match(/^data:image\/svg\+xml(?:;charset=[^;,]+)?(;base64)?,([\s\S]+)$/i);
  if (!svgMatch) return null;

  const isBase64 = Boolean(svgMatch[1]);
  const rawSvg = svgMatch[2];
  const svgText = isBase64
    ? globalThis.atob?.(rawSvg.replace(/\s/g, '')) || ''
    : safeDecodeURIComponent(rawSvg);

  // Letterhead SVGs carry both the center logo and the company text.
  // Keep the SVG intact so Excel does not lose the surrounding details.
  return {
    extension: 'svg',
    contentType: 'image/svg+xml',
    data: isBase64 ? rawSvg.replace(/\s/g, '') : svgText,
    encoding: isBase64 ? 'base64' : 'text',
    dimensions: parseSvgDimensions(svgText),
  };
}

function parseImageDataUrl(dataUrl?: string): EmbeddedImage | null {
  if (!dataUrl) return null;

  return parseRasterImageDataUrl(dataUrl) || parseSvgImageDataUrl(dataUrl);
}

function trimHeaderText(value?: string | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

function hasCompanyHeaderInfo(companyHeader?: CompanyHeaderInfo): boolean {
  if (!companyHeader) return false;

  return Boolean(
    trimHeaderText(companyHeader.nameAr) ||
      trimHeaderText(companyHeader.nameEn) ||
      trimHeaderText(companyHeader.phoneAr) ||
      trimHeaderText(companyHeader.phoneEn) ||
      trimHeaderText(companyHeader.addressAr) ||
      trimHeaderText(companyHeader.addressEn),
  );
}

function getSvgTextFromDataUrl(dataUrl?: string): string {
  const svgMatch = dataUrl?.match(/^data:image\/svg\+xml(?:;charset=[^;,]+)?(;base64)?,([\s\S]+)$/i);
  if (!svgMatch) return '';

  const rawSvg = svgMatch[2];
  return svgMatch[1]
    ? globalThis.atob?.(rawSvg.replace(/\s/g, '')) || ''
    : safeDecodeURIComponent(rawSvg);
}

function isCompleteHeaderImage(dataUrl: string | undefined, image: EmbeddedImage | null): boolean {
  if (!dataUrl || !image) return false;

  if (image.extension === 'svg' && /<text\b/i.test(getSvgTextFromDataUrl(dataUrl))) {
    return true;
  }

  if (!image.dimensions?.width || !image.dimensions?.height) {
    return false;
  }

  return image.dimensions.width / image.dimensions.height >= 2.2;
}

function buildCompanyHeaderDataUrl(
  companyHeader: CompanyHeaderInfo,
  logoDataUrl?: string,
): string {
  const nameAr = trimHeaderText(companyHeader.nameAr) || trimHeaderText(companyHeader.nameEn) || 'Akked';
  const nameEn = trimHeaderText(companyHeader.nameEn) || trimHeaderText(companyHeader.nameAr) || 'Akked';
  const phoneAr = trimHeaderText(companyHeader.phoneAr) || trimHeaderText(companyHeader.phoneEn);
  const phoneEn = trimHeaderText(companyHeader.phoneEn) || trimHeaderText(companyHeader.phoneAr);
  const addressAr = trimHeaderText(companyHeader.addressAr);
  const addressEn = trimHeaderText(companyHeader.addressEn);
  const initials = escapeXml((nameEn || nameAr || 'A').charAt(0).toUpperCase());
  const logoHref = logoDataUrl?.startsWith('data:image/') ? escapeXml(logoDataUrl) : '';

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="2048" height="620" viewBox="0 0 2048 620">
    <rect width="2048" height="620" fill="#ffffff" />
    <rect x="24" y="24" width="2000" height="572" rx="24" fill="#ffffff" stroke="#D4D4D4" stroke-width="2.5" />

    <text x="170" y="188" font-size="62" font-weight="800" fill="#111111">${escapeXml(nameEn)}</text>
    ${phoneEn ? `<text x="170" y="282" font-size="36" font-weight="500" fill="#4B5563">${escapeXml(phoneEn)}</text>` : ``}
    ${addressEn ? `<text x="170" y="366" font-size="34" font-weight="500" fill="#6B7280">${escapeXml(addressEn)}</text>` : ``}

    <text x="1878" y="150" text-anchor="end" font-size="62" font-weight="800" fill="#111111">${escapeXml(nameAr)}</text>
    ${phoneAr ? `<text x="1878" y="222" text-anchor="end" font-size="36" font-weight="500" fill="#4B5563">${escapeXml(phoneAr)}</text>` : ``}
    ${addressAr ? `<text x="1878" y="286" text-anchor="end" font-size="34" font-weight="500" fill="#6B7280">${escapeXml(addressAr)}</text>` : ``}

    ${
      logoHref
        ? `<image href="${logoHref}" x="884" y="74" width="280" height="280" preserveAspectRatio="xMidYMid meet" />`
        : `<circle cx="1024" cy="218" r="132" fill="#ffffff" stroke="#111111" stroke-width="6" /><text x="1024" y="240" text-anchor="middle" font-size="110" font-weight="700" fill="#111111">${initials}</text>`
    }

    <line x1="150" y1="548" x2="1898" y2="548" stroke="#BDBDBD" stroke-width="3.5" />
  </svg>
  `;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function buildHeaderImageDataUrl(options: AccountStatementXlsxOptions): string | undefined {
  const originalImage = parseImageDataUrl(options.logoDataUrl);

  if (isCompleteHeaderImage(options.logoDataUrl, originalImage)) {
    return options.logoDataUrl;
  }

  if (hasCompanyHeaderInfo(options.companyHeader)) {
    return buildCompanyHeaderDataUrl(options.companyHeader!, options.logoDataUrl);
  }

  return options.logoDataUrl;
}

function getCombinedAmountFromPool(
  movement: AccountMovement,
  pool: AccountMovement[],
): number {
  const baseAmount = Number(movement.amount);
  const relatedCommissions = pool.filter(
    (m) =>
      (m as any).is_commission_movement === true &&
      (m as any).related_commission_movement_id === movement.id &&
      m.customer_id === movement.customer_id &&
      m.movement_type === movement.movement_type &&
      m.currency === movement.currency,
  );

  return relatedCommissions.reduce((sum, m) => sum + Number(m.amount), baseAmount);
}

function sortMovements(movements: AccountMovement[]): AccountMovement[] {
  return [...movements].sort((a, b) => {
    const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (timeDiff !== 0) return timeDiff;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}

function shouldIncludeMovement(movement: AccountMovement, isProfitLossAccount?: boolean): boolean {
  return isPostedMovement(movement) && (isProfitLossAccount || !(movement as any).is_commission_movement);
}

function getMovementCreatorLabel(
  movement: AccountMovement,
  currentUser?: AccountStatementXlsxOptions['currentUser'],
): string {
  const createdByUserId = (movement as any).created_by_user_id;
  const sourceUserId = (movement as any).source_user_id;
  const createdByUserName = (movement as any).created_by_user_name?.trim();

  if (
    (Boolean(currentUser?.userId) && sourceUserId === currentUser?.userId) ||
    (Boolean(currentUser?.userId) && createdByUserId === currentUser?.userId) ||
    (Boolean(currentUser?.fullName) && createdByUserName === currentUser?.fullName) ||
    (Boolean(currentUser?.userName) && createdByUserName === currentUser?.userName)
  ) {
    return 'أنا';
  }

  return createdByUserName || 'العميل';
}

function buildWorksheetRows(options: AccountStatementXlsxOptions) {
  const rows: SheetRow[] = [];
  const merges: string[] = [];
  const totalColumns = WORKSHEET_COLUMN_WIDTHS.length;
  const lastColumn = columnName(totalColumns);

  const addRow = (cells: Array<Omit<SheetCell, 'ref'>>, height?: number) => {
    const rowIndex = rows.length + 1;
    rows.push({
      index: rowIndex,
      height,
      cells: cells.map((cell, index) => ({
        ...cell,
        ref: `${columnName(index + 1)}${rowIndex}`,
      })),
    });
    return rowIndex;
  };

  for (let index = 0; index < 4; index += 1) {
    addRow([], 25);
  }

  addRow([]);
  const titleRow = addRow([{ value: `كشف حساب العميل: ${options.customerName}`, style: 1 }], 28);
  merges.push(`A${titleRow}:${lastColumn}${titleRow}`);

  const previousMovements = sortMovements(
    (options.previousMovements || []).filter((movement) =>
      shouldIncludeMovement(movement, options.isProfitLossAccount),
    ),
  );
  const printedMovements = sortMovements(
    options.movements.filter((movement) => shouldIncludeMovement(movement, options.isProfitLossAccount)),
  );
  const movementPool = [...previousMovements, ...printedMovements];
  const runningBalances: Record<string, number> = {};

  previousMovements.forEach((movement) => {
    const amount = getCombinedAmountFromPool(movement, previousMovements);
    runningBalances[movement.currency] =
      (runningBalances[movement.currency] || 0) +
      (movement.movement_type === 'incoming' ? amount : -amount);
  });

  const previousBalanceText = Object.entries(runningBalances)
    .filter(([, balance]) => balance !== 0)
    .map(([currency, balance]) => {
      const direction = balance > 0 ? 'له' : 'عليه';
      return `${formatAmount(Math.abs(balance))} ${getCurrencySymbol(currency)} ${direction}`;
    })
    .join('، ') || 'لا يوجد';

  const metaDateRow = addRow(
    [
      { value: 'تاريخ التصدير', style: 2 },
      { value: format(new Date(), 'yyyy-MM-dd HH:mm'), style: 5 },
    ],
    24,
  );
  merges.push(`B${metaDateRow}:${lastColumn}${metaDateRow}`);

  const previousRow = addRow(
    [
      { value: 'رصيد سابق للفترة', style: 2 },
      { value: previousBalanceText, style: 5 },
    ],
    24,
  );
  merges.push(`B${previousRow}:${lastColumn}${previousRow}`);

  addRow(
    [
      { value: 'م', style: 3 },
      { value: 'التاريخ', style: 3 },
      { value: 'رقم الحركة', style: 3 },
      { value: 'نوع الحركة', style: 3 },
      { value: 'الحالة', style: 3 },
      { value: 'المنشأ', style: 3 },
      { value: 'المبلغ', style: 3 },
      { value: 'العملة', style: 3 },
      { value: 'العمولة', style: 3 },
      { value: 'الرصيد بعد الحركة', style: 3 },
      { value: 'المرسل', style: 3 },
      { value: 'المستلم', style: 3 },
      { value: 'ملاحظات', style: 3 },
    ],
    26,
  );

  if (printedMovements.length === 0) {
    const emptyRow = addRow([{ value: 'لا توجد حركات', style: 2 }], 26);
    merges.push(`A${emptyRow}:${lastColumn}${emptyRow}`);
  }

  printedMovements.forEach((movement, index) => {
    const amount = getCombinedAmountFromPool(movement, movementPool);
    const relatedCommission = movementPool
      .filter(
        (item) =>
          (item as any).is_commission_movement === true &&
          (item as any).related_commission_movement_id === movement.id &&
          item.customer_id === movement.customer_id &&
          item.movement_type === movement.movement_type &&
          item.currency === movement.currency,
      )
      .reduce((sum, item) => sum + Number(item.amount), 0);

    runningBalances[movement.currency] =
      (runningBalances[movement.currency] || 0) +
      (movement.movement_type === 'incoming' ? amount : -amount);

    const balanceAfter = runningBalances[movement.currency];
    const balanceAfterText =
      balanceAfter > 0
        ? `${formatAmount(balanceAfter)} ${getCurrencySymbol(movement.currency)} له`
        : balanceAfter < 0
          ? `${formatAmount(Math.abs(balanceAfter))} ${getCurrencySymbol(movement.currency)} عليه`
          : 'متساوي';

    const movementType = (movement as any).is_internal_transfer
      ? 'تحويل داخلي'
      : movement.movement_type === 'outgoing'
        ? 'عليه'
        : 'له';

    addRow(
      [
        { value: index + 1, style: 5, type: 'number' },
        { value: format(new Date(movement.created_at), 'yyyy-MM-dd'), style: 5 },
        { value: movement.movement_number || '', style: 5 },
        { value: movementType, style: 5 },
        { value: getMovementApprovalLabel(movement), style: 5 },
        { value: getMovementCreatorLabel(movement, options.currentUser), style: 5 },
        { value: amount, style: 5, type: 'number' },
        { value: getCurrencyName(movement.currency), style: 5 },
        { value: relatedCommission, style: 5, type: 'number' },
        { value: balanceAfterText, style: 5 },
        { value: movement.sender_name || '', style: 4 },
        { value: movement.beneficiary_name || '', style: 4 },
        { value: movement.notes || '', style: 4 },
      ],
      24,
    );
  });

  addRow([]);
  const footerRow = addRow(
    [{ value: `تاريخ الطباعة: ${format(new Date(), 'EEEE، dd MMMM yyyy', { locale: ar })}`, style: 5 }],
    22,
  );
  merges.push(`A${footerRow}:${lastColumn}${footerRow}`);

  return { rows, merges };
}

function renderCell(cell: SheetCell): string {
  if (cell.type === 'number' && typeof cell.value === 'number') {
    return `<c r="${cell.ref}" s="${cell.style}"><v>${cell.value}</v></c>`;
  }

  return `<c r="${cell.ref}" t="inlineStr" s="${cell.style}"><is><t>${escapeXml(cell.value)}</t></is></c>`;
}

function renderWorksheet(
  rows: SheetRow[],
  merges: string[],
  hasImage: boolean,
): string {
  const maxRow = Math.max(rows.length, 1);
  const columnsXml = WORKSHEET_COLUMN_WIDTHS.map(
    (width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
  ).join('\n    ');
  const renderedRows = rows
    .map((row) => {
      const heightAttrs = row.height ? ` ht="${row.height}" customHeight="1"` : '';
      return `<row r="${row.index}"${heightAttrs}>${row.cells.map(renderCell).join('')}</row>`;
    })
    .join('');

  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="A1:${WORKSHEET_LAST_COLUMN}${maxRow}"/>
  <sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="22"/>
  <cols>
    ${columnsXml}
  </cols>
  <sheetData>${renderedRows}</sheetData>
  ${mergeXml}
  <pageMargins left="0.35" right="0.35" top="0.35" bottom="0.5" header="0.2" footer="0.2"/>
  <pageSetup orientation="landscape" paperSize="9"/>
  ${hasImage ? '<drawing r:id="rId1"/>' : ''}
</worksheet>`;
}

function renderStyles(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="11"/><name val="Tahoma"/></font>
    <font><b/><sz val="11"/><name val="Tahoma"/></font>
    <font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Tahoma"/></font>
  </fonts>
  <fills count="8">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF10B981"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE5E7EB"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF3F4F6"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDBEAFE"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FF000000"/></left>
      <right style="thin"><color rgb="FF000000"/></right>
      <top style="thin"><color rgb="FF000000"/></top>
      <bottom style="thin"><color rgb="FF000000"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="9">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" readingOrder="2" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function getContainedImageSize(dimensions?: ImageDimensions): ImageDimensions {
  if (!dimensions?.width || !dimensions?.height) {
    return { width: HEADER_IMAGE_MAX_WIDTH, height: 112 };
  }

  const aspectRatio = dimensions.width / dimensions.height;
  let width = HEADER_IMAGE_MAX_WIDTH;
  let height = width / aspectRatio;

  if (height > HEADER_IMAGE_MAX_HEIGHT) {
    height = HEADER_IMAGE_MAX_HEIGHT;
    width = height * aspectRatio;
  }

  return {
    width: Math.round(width),
    height: Math.round(height),
  };
}

function pixelsToEmu(pixels: number): number {
  return Math.round(pixels * 9525);
}

function excelColumnWidthToPixels(width: number): number {
  return Math.floor(width * 7 + 5);
}

function getColumnAnchorFromPixels(pixels: number): { column: number; offset: number } {
  let remainingPixels = Math.max(0, pixels);

  for (let index = 0; index < WORKSHEET_COLUMN_WIDTHS.length; index += 1) {
    const columnPixels = excelColumnWidthToPixels(WORKSHEET_COLUMN_WIDTHS[index]);

    if (remainingPixels < columnPixels) {
      return { column: index, offset: pixelsToEmu(remainingPixels) };
    }

    remainingPixels -= columnPixels;
  }

  return { column: WORKSHEET_COLUMN_WIDTHS.length - 1, offset: 0 };
}

function getWorksheetPixelWidth(): number {
  return WORKSHEET_COLUMN_WIDTHS.reduce(
    (total, width) => total + excelColumnWidthToPixels(width),
    0,
  );
}

function renderDrawing(image: EmbeddedImage): string {
  const size = getContainedImageSize(image.dimensions);
  const leftPixels = (getWorksheetPixelWidth() - size.width) / 2;
  const anchor = getColumnAnchorFromPixels(leftPixels);
  const rowOff = pixelsToEmu(HEADER_IMAGE_TOP_PADDING + (HEADER_IMAGE_MAX_HEIGHT - size.height) / 2);
  const cx = pixelsToEmu(size.width);
  const cy = pixelsToEmu(size.height);

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <xdr:oneCellAnchor>
    <xdr:from><xdr:col>${anchor.column}</xdr:col><xdr:colOff>${anchor.offset}</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>${rowOff}</xdr:rowOff></xdr:from>
    <xdr:ext cx="${cx}" cy="${cy}"/>
    <xdr:pic>
      <xdr:nvPicPr>
        <xdr:cNvPr id="1" name="Logo"/>
        <xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr>
      </xdr:nvPicPr>
      <xdr:blipFill>
        <a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1"/>
        <a:stretch><a:fillRect/></a:stretch>
      </xdr:blipFill>
      <xdr:spPr>
        <a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      </xdr:spPr>
    </xdr:pic>
    <xdr:clientData/>
  </xdr:oneCellAnchor>
</xdr:wsDr>`;
}

export async function generateAccountStatementXlsxBase64(
  options: AccountStatementXlsxOptions,
): Promise<string> {
  const zip = new JSZip();
  const image = parseImageDataUrl(buildHeaderImageDataUrl(options));
  const { rows, merges } = buildWorksheetRows(options);
  const now = new Date().toISOString();

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${image ? `<Default Extension="${image.extension}" ContentType="${image.contentType}"/>` : ''}
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${image ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : ''}
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`,
  );

  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`,
  );

  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView/></bookViews>
  <sheets><sheet name="كشف الحساب" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
  );

  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  );

  zip.file('xl/worksheets/sheet1.xml', renderWorksheet(rows, merges, Boolean(image)));
  zip.file('xl/styles.xml', renderStyles());

  if (image) {
    zip.file(
      'xl/worksheets/_rels/sheet1.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`,
    );
    zip.file('xl/drawings/drawing1.xml', renderDrawing(image));
    zip.file(
      'xl/drawings/_rels/drawing1.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.${image.extension}"/>
</Relationships>`,
    );
    zip.file(
      `xl/media/logo.${image.extension}`,
      image.data,
      image.encoding === 'base64' ? { base64: true } : undefined,
    );
  }

  zip.file(
    'docProps/core.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>كشف حساب ${escapeXml(options.customerName)}</dc:title>
  <dc:creator>Akked</dc:creator>
  <cp:lastModifiedBy>Akked</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`,
  );

  zip.file(
    'docProps/app.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Akked</Application>
</Properties>`,
  );

  return zip.generateAsync({
    type: 'base64',
    compression: 'DEFLATE',
  });
}
