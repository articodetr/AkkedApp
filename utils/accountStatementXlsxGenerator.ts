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
  extension: 'png' | 'jpg' | 'jpeg';
  contentType: string;
  base64: string;
}

interface AccountStatementXlsxOptions {
  customerName: string;
  movements: AccountMovement[];
  previousMovements?: AccountMovement[];
  logoDataUrl?: string;
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

function parseImageDataUrl(dataUrl?: string): EmbeddedImage | null {
  if (!dataUrl) return null;

  const match = dataUrl.match(/^data:image\/(png|jpe?g);base64,(.+)$/i);
  if (!match) return null;

  const extension = match[1].toLowerCase() as EmbeddedImage['extension'];
  const normalizedExtension = extension === 'jpg' ? 'jpeg' : extension;

  return {
    extension,
    contentType: `image/${normalizedExtension}`,
    base64: match[2].replace(/\s/g, ''),
  };
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
  const totalColumns = 13;
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
  <dimension ref="A1:M${maxRow}"/>
  <sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="22"/>
  <cols>
    <col min="1" max="1" width="8" customWidth="1"/>
    <col min="2" max="2" width="14" customWidth="1"/>
    <col min="3" max="3" width="18" customWidth="1"/>
    <col min="4" max="4" width="16" customWidth="1"/>
    <col min="5" max="5" width="16" customWidth="1"/>
    <col min="6" max="6" width="16" customWidth="1"/>
    <col min="7" max="7" width="14" customWidth="1"/>
    <col min="8" max="8" width="18" customWidth="1"/>
    <col min="9" max="9" width="14" customWidth="1"/>
    <col min="10" max="10" width="24" customWidth="1"/>
    <col min="11" max="11" width="22" customWidth="1"/>
    <col min="12" max="12" width="22" customWidth="1"/>
    <col min="13" max="13" width="34" customWidth="1"/>
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

function renderDrawing(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <xdr:twoCellAnchor editAs="oneCell">
    <xdr:from><xdr:col>4</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>9</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>4</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:pic>
      <xdr:nvPicPr>
        <xdr:cNvPr id="1" name="Logo"/>
        <xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr>
      </xdr:nvPicPr>
      <xdr:blipFill>
        <a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1"/>
        <a:stretch><a:fillRect/></a:stretch>
      </xdr:blipFill>
      <xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>
    </xdr:pic>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
</xdr:wsDr>`;
}

export async function generateAccountStatementXlsxBase64(
  options: AccountStatementXlsxOptions,
): Promise<string> {
  const zip = new JSZip();
  const image = parseImageDataUrl(options.logoDataUrl);
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
    zip.file('xl/drawings/drawing1.xml', renderDrawing());
    zip.file(
      'xl/drawings/_rels/drawing1.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.${image.extension}"/>
</Relationships>`,
    );
    zip.file(`xl/media/logo.${image.extension}`, image.base64, { base64: true });
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
