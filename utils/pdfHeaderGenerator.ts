import { COMPANY_INFO } from '@/constants/companyInfo';

export interface PDFHeaderOptions {
  title: string;
  logoDataUrl?: string;
  primaryColor?: string;
  darkColor?: string;
  height?: number;
  showPhones?: boolean;
}

export function generatePDFHeaderHTML(options: PDFHeaderOptions): string {
  const {
    title,
    logoDataUrl,
  } = options;

  // استخدام صورة البانر الكاملة
  const headerImageHTML = logoDataUrl && logoDataUrl !== '' && !logoDataUrl.includes('undefined')
    ? `<img src="${logoDataUrl}" alt="Header Banner" class="header-banner-image" onerror="this.style.display='none'" />`
    : '';

  return `
    <div class="pdf-header-banner">
      ${headerImageHTML}
    </div>

    <div class="document-title">${title}</div>
  `;
}

export function generatePDFHeaderStyles(): string {
  return `
    .pdf-header-banner {
      position: relative;
      width: 100%;
      margin: 0 0 12px;
      overflow: visible;
      flex-shrink: 0;
      box-sizing: border-box;
      display: block;
      line-height: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .header-banner-image {
      width: 100%;
      height: auto;
      display: block;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .document-title {
      text-align: center;
      font-size: 20px;
      font-weight: bold;
      color: #111827;
      margin: 8px 0 18px;
      padding: 4px;
    }

    .header-wrapper {
      position: relative;
      display: block;
    }

    @media print {
      * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        color-adjust: exact !important;
      }

      .pdf-header-banner {
        width: 100% !important;
        max-width: none !important;
        height: auto !important;
        margin-left: 0 !important;
        margin-right: 0 !important;
        overflow: visible !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        color-adjust: exact !important;
        page-break-inside: avoid;
        page-break-after: avoid;
        box-sizing: border-box;
      }

      .header-wrapper {
        page-break-inside: avoid;
        page-break-after: avoid;
      }

      .header-banner-image {
        width: 100% !important;
        height: auto !important;
        max-width: none !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
    }
  `;
}
