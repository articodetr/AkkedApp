import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { AccountMovement, CURRENCIES } from '@/types/database';
import { generatePDFHeaderHTML, generatePDFHeaderStyles } from './pdfHeaderGenerator';
import { isPostedMovement } from './movementApproval';

interface MovementWithBalance extends AccountMovement {
  runningBalance: number;
}

interface OpeningRow {
  isOpening: true;
  currency: string;
  openingBalance: number;
  runningBalance: number;
}

type StatementRow = MovementWithBalance | OpeningRow;

function isOpeningRow(row: StatementRow): row is OpeningRow {
  return (row as OpeningRow).isOpening === true;
}

function getCurrencySymbol(code: string): string {
  const currency = CURRENCIES.find((c) => c.code === code);
  return currency?.symbol || code;
}

function getCurrencyName(code: string): string {
  const currency = CURRENCIES.find((c) => c.code === code);
  return currency?.name || code;
}

function formatAmount(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 20,
  });
}

export function generateAccountStatementHTML(
  customerName: string,
  movements: AccountMovement[],
  logoDataUrl?: string,
  isProfitLossAccount?: boolean,
  previousMovements?: AccountMovement[]
): string {
  const allMovements = movements.filter((movement) => isPostedMovement(movement));

  const filteredMovements = allMovements
    .filter((m) => {
      if (isProfitLossAccount) {
        return true;
      }
      return !(m as any).is_commission_movement;
    })
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const allPreviousMovements = (previousMovements || []).filter((movement) =>
    isPostedMovement(movement),
  );

  const filteredPreviousMovements = allPreviousMovements.filter((m) => {
    if (isProfitLossAccount) {
      return true;
    }
    return !(m as any).is_commission_movement;
  });

  // Helper function to get combined amount including related commission
  const getCombinedAmountFromPool = (
    movement: AccountMovement,
    pool: AccountMovement[],
  ): number => {
    const baseAmount = Number(movement.amount);
    const relatedCommissions = pool.filter(
      (m) =>
        (m as any).is_commission_movement === true &&
        (m as any).related_commission_movement_id === movement.id &&
        m.customer_id === movement.customer_id &&
        m.movement_type === movement.movement_type &&
        m.currency === movement.currency
    );
    const commissionTotal = relatedCommissions.reduce(
      (sum, m) => sum + Number(m.amount),
      0,
    );
    return baseAmount + commissionTotal;
  };

  const getCombinedAmount = (movement: AccountMovement): number =>
    getCombinedAmountFromPool(movement, allMovements);

  const getPreviousCombinedAmount = (movement: AccountMovement): number =>
    getCombinedAmountFromPool(movement, allPreviousMovements);

  // Group movements by currency
  const groupedByCurrency = filteredMovements.reduce((acc, movement) => {
    if (!acc[movement.currency]) {
      acc[movement.currency] = [];
    }
    acc[movement.currency].push(movement);

    return acc;
  }, {} as Record<string, AccountMovement[]>);

  // Compute opening balance per currency from previous movements (before the selected range)
  const openingBalanceByCurrency: Record<string, number> = {};
  filteredPreviousMovements.forEach((movement) => {
    const combinedAmount = getPreviousCombinedAmount(movement);
    const delta = movement.movement_type === 'incoming' ? combinedAmount : -combinedAmount;
    openingBalanceByCurrency[movement.currency] =
      (openingBalanceByCurrency[movement.currency] || 0) + delta;
  });

  // Build the union of currencies appearing in the period and currencies with non-zero opening balance
  const currencyKeys = new Set<string>(Object.keys(groupedByCurrency));
  Object.entries(openingBalanceByCurrency).forEach(([curr, bal]) => {
    if (bal !== 0) currencyKeys.add(curr);
  });

  const reportDate = format(new Date(), 'EEEE، dd MMMM yyyy', { locale: ar });

  // Helper function to split rows into pages
  const splitIntoPages = (rows: StatementRow[], firstPageRows: number, subsequentPageRows: number) => {
    if (rows.length === 0) return [];

    const pages: StatementRow[][] = [];
    let currentIndex = 0;

    // First page
    pages.push(rows.slice(0, Math.min(firstPageRows, rows.length)));
    currentIndex = firstPageRows;

    // Subsequent pages
    while (currentIndex < rows.length) {
      pages.push(rows.slice(currentIndex, currentIndex + subsequentPageRows));
      currentIndex += subsequentPageRows;
    }

    return pages;
  };

  // Generate sections for each currency
  const currencySections = Array.from(currencyKeys).map((curr) => {
    const currMovements = groupedByCurrency[curr] || [];
    const openingBalance = openingBalanceByCurrency[curr] || 0;

    const rows: StatementRow[] = [];
    let runningBalance = openingBalance;

    if (openingBalance !== 0) {
      rows.push({
        isOpening: true,
        currency: curr,
        openingBalance,
        runningBalance: openingBalance,
      });
    }

    currMovements.forEach((movement) => {
      const combinedAmount = getCombinedAmount(movement);

      if (movement.movement_type === 'incoming') {
        runningBalance += combinedAmount;
      } else {
        runningBalance -= combinedAmount;
      }

      rows.push({
        ...movement,
        runningBalance,
      });
    });

    const totalOutgoing = currMovements
      .filter(m => m.movement_type === 'outgoing')
      .reduce((sum, m) => sum + getCombinedAmount(m), 0);

    const totalIncoming = currMovements
      .filter(m => m.movement_type === 'incoming')
      .reduce((sum, m) => sum + getCombinedAmount(m), 0);

    const finalBalance = openingBalance + totalIncoming - totalOutgoing;
    const currencyName = getCurrencyName(curr);

    // Split rows into pages: 9 rows for first page, 13 rows for subsequent pages
    const pages = splitIntoPages(rows, 9, 13);

    // Generate HTML for each page
    const pageHTMLs = pages.map((pageRows, pageIndex) => {
      const isFirstPage = pageIndex === 0;
      const isLastPage = pageIndex === pages.length - 1;

      const movementRows = pageRows
        .map((row) => {
          const balanceDisplay = row.runningBalance > 0
            ? `${formatAmount(row.runningBalance)} ${currencyName} (له)`
            : row.runningBalance < 0
            ? `${formatAmount(Math.abs(row.runningBalance))} ${currencyName} (عليه)`
            : '-';

          if (isOpeningRow(row)) {
            const incomingDisplay = row.openingBalance > 0
              ? formatAmount(row.openingBalance)
              : '-';
            const outgoingDisplay = row.openingBalance < 0
              ? formatAmount(Math.abs(row.openingBalance))
              : '-';

            return `
            <tr class="opening-row">
              <td class="cell text-center">-</td>
              <td class="cell" style="text-align: right; padding-right: 12px;"><strong>ملخص السابقات</strong></td>
              <td class="cell text-center"><strong>${incomingDisplay}</strong></td>
              <td class="cell text-center"><strong>${outgoingDisplay}</strong></td>
              <td class="cell text-center"><strong>${balanceDisplay}</strong></td>
            </tr>
            `;
          }

          const movement = row;
          const dateStr = format(new Date(movement.created_at), 'dd/MM/yyyy');
          const combinedAmount = getCombinedAmount(movement);
          const incomingAmount = movement.movement_type === 'incoming'
            ? formatAmount(combinedAmount)
            : '-';
          const outgoingAmount = movement.movement_type === 'outgoing'
            ? formatAmount(combinedAmount)
            : '-';

          return `
          <tr>
            <td class="cell text-center">${dateStr}</td>
            <td class="cell" style="text-align: right; padding-right: 12px;">${movement.notes || movement.movement_number}</td>
            <td class="cell text-center">${incomingAmount}</td>
            <td class="cell text-center">${outgoingAmount}</td>
            <td class="cell text-center">${balanceDisplay}</td>
          </tr>
          `;
        })
        .join('');

      const finalBalanceDisplay = finalBalance > 0
        ? `${formatAmount(finalBalance)} ${currencyName} (له)`
        : finalBalance < 0
        ? `${formatAmount(Math.abs(finalBalance))} ${currencyName} (عليه)`
        : '-';

      const totalIncomingStr = totalIncoming > 0 ? formatAmount(totalIncoming) : '-';
      const totalOutgoingStr = totalOutgoing > 0 ? formatAmount(totalOutgoing) : '-';

      // Add summary rows only on the last page
      const summaryRows = isLastPage ? `
          <tr class="total-row">
            <td colspan="2" class="cell text-center">المجموع</td>
            <td class="cell text-center">${totalIncomingStr}</td>
            <td class="cell text-center">${totalOutgoingStr}</td>
            <td class="cell text-center">-</td>
          </tr>
          <tr class="final-row">
            <td colspan="4" class="cell text-center"><strong>الرصيد النهائي</strong></td>
            <td class="cell text-center"><strong>${finalBalanceDisplay}</strong></td>
          </tr>
      ` : '';

      return `
      <div class="page-wrapper ${isFirstPage ? 'first-page' : 'subsequent-page'}">
        ${isFirstPage ? `
        <div class="section-title">
          <h2>كشف حساب ${customerName} - ${currencyName}</h2>
        </div>
        ` : ''}
        <table>
          <thead>
            <tr>
              <th style="width: 12%;">التاريخ</th>
              <th style="width: 38%;">البيان</th>
              <th style="width: 15%;">له</th>
              <th style="width: 15%;">عليه</th>
              <th style="width: 20%;">الرصيد</th>
            </tr>
          </thead>
          <tbody>
            ${movementRows}
            ${summaryRows}
          </tbody>
        </table>
      </div>
      `;
    }).join('');

    return `
    <div class="currency-section">
      ${pageHTMLs}
    </div>
    `;
  }).join('');

  const headerHTML = generatePDFHeaderHTML({
    title: `كشف حساب العميل: ${customerName}`,
    logoDataUrl,
    primaryColor: '#382de3',
    darkColor: '#2821b8',
    height: 105,
    showPhones: true,
  });

  return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>كشف الحساب - ${customerName}</title>
  <style>
    @page {
      margin: 0.8cm 1cm 1.2cm;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Arial', 'Tahoma', sans-serif;
      background: #fff;
      color: #000;
      direction: rtl;
      padding: 8px 15px 15px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .header-wrapper {
      margin-bottom: 16px;
      page-break-inside: avoid;
      page-break-after: avoid;
    }

    .currency-section {
      margin-bottom: 0;
    }

    .page-wrapper {
      page-break-inside: avoid;
      padding-top: 20px;
      padding-bottom: 30px;
    }

    .page-wrapper.first-page {
      padding-top: 0;
    }

    .page-wrapper.subsequent-page {
      page-break-before: always;
      padding-top: 40px;
    }

    .section-title {
      border: 2px solid #000;
      padding: 12px 20px;
      margin-bottom: 0;
      text-align: center;
      background: #f9fafb;
    }

    .section-title h2 {
      font-size: 20px;
      font-weight: bold;
      margin: 0;
      color: #111827;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      border: 2px solid #000;
      background: #fff;
    }

    .page-wrapper.first-page table {
      border-top: none;
    }

    th {
      background-color: #e5e7eb;
      font-weight: bold;
      padding: 10px 8px;
      border: 1px solid #000;
      font-size: 14px;
      text-align: center;
      color: #111827;
    }

    td {
      padding: 8px 6px;
      border: 1px solid #000;
      text-align: center;
      font-size: 13px;
      color: #374151;
      vertical-align: middle;
    }

    .text-center {
      text-align: center !important;
    }

    .cell {
      min-height: 30px;
    }

    .opening-row {
      background-color: #fef3c7;
      font-weight: bold;
      font-size: 13px;
    }

    .total-row {
      background-color: #f3f4f6;
      font-weight: bold;
      font-size: 14px;
    }

    .final-row {
      background-color: #dbeafe;
      font-weight: bold;
      font-size: 15px;
      color: #1e40af;
    }

    .footer {
      margin-top: 30px;
      text-align: center;
      font-size: 11px;
      color: #6b7280;
      padding: 10px 0;
      border-top: 1px solid #e5e7eb;
    }

    ${generatePDFHeaderStyles()}

    @media print {
      * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        color-adjust: exact !important;
      }

      html, body {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }

      @page {
        margin: 0.8cm 1cm 1.2cm;
      }

      .header-wrapper {
        page-break-inside: avoid;
        page-break-after: avoid;
      }

      .page-wrapper {
        page-break-inside: avoid;
      }

      .page-wrapper.subsequent-page {
        page-break-before: always;
      }

      table {
        page-break-inside: avoid;
      }

      th {
        background-color: #e5e7eb !important;
        -webkit-print-color-adjust: exact !important;
      }

      .opening-row {
        background-color: #fef3c7 !important;
        -webkit-print-color-adjust: exact !important;
      }

      .total-row {
        background-color: #f3f4f6 !important;
        -webkit-print-color-adjust: exact !important;
      }

      .final-row {
        background-color: #dbeafe !important;
        -webkit-print-color-adjust: exact !important;
      }

      .section-title {
        background: #f9fafb !important;
        -webkit-print-color-adjust: exact !important;
      }
    }
  </style>
</head>
<body>
  <div class="header-wrapper">
    ${headerHTML}
  </div>

  ${currencySections}

  <div class="footer">
    <div>تاريخ الطباعة: ${reportDate}</div>
  </div>
</body>
</html>
  `;
}

export function generateAccountStatementForAllCurrencies(
  customerName: string,
  movements: AccountMovement[],
  logoDataUrl?: string,
  isProfitLossAccount?: boolean
): string {
  return generateAccountStatementHTML(customerName, movements, logoDataUrl, isProfitLossAccount);
}
