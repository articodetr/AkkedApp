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
    height = 110,
  } = options;

  // استخدام صورة البانر الكاملة
  const headerImageHTML = logoDataUrl && logoDataUrl !== '' && !logoDataUrl.includes('undefined')
    ? `<img src="${logoDataUrl}" alt="Header Banner" class="header-banner-image" onerror="this.style.display='none'" />`
    : `<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" alt="Default Banner" class="header-banner-image" />`;

  return `
    <div class="pdf-header-banner" style="height: ${height}px;">
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
      max-width: 720px;
      height: 110px;
      margin: 0 auto 12px;
      overflow: hidden;
      flex-shrink: 0;
      box-sizing: border-box;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .header-banner-image {
      width: 100%;
      height: 100%;
      display: block;
      object-fit: contain;
      object-position: top center;
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
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
    }
  `;
}
