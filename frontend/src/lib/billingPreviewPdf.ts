import * as pdfMake from "pdfmake/build/pdfmake";
import type { Content, CustomTableLayout, Style, TableCell, TDocumentDefinitions, TFontDictionary } from "pdfmake/interfaces";

import type { BillingPreview, BillingRates } from "./billingPreview";
import { formatDateTimeValue } from "./dates";

const BILLING_TABLE_LAYOUT_NAME = "billingTable";
const CJK_FONT_NAME = "NotoSansCJKSC";
const CJK_FONT_URL_BASE = "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/SimplifiedChinese";

const PDF_FONTS: TFontDictionary = {
  [CJK_FONT_NAME]: {
    normal: `${CJK_FONT_URL_BASE}/NotoSansCJKsc-Regular.otf`,
    bold: `${CJK_FONT_URL_BASE}/NotoSansCJKsc-Bold.otf`,
    italics: `${CJK_FONT_URL_BASE}/NotoSansCJKsc-Regular.otf`,
    bolditalics: `${CJK_FONT_URL_BASE}/NotoSansCJKsc-Bold.otf`
  }
};

const BILLING_TABLE_LAYOUT: CustomTableLayout = {
  hLineColor: () => "#dbe5f1",
  vLineColor: () => "#dbe5f1",
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  paddingLeft: () => 5,
  paddingRight: () => 5,
  paddingTop: () => 4,
  paddingBottom: () => 4
};

const styles: Record<string, Style> = {
  pageTitle: {
    fontSize: 15,
    bold: true,
    color: "#102a43"
  },
  pageSubtitle: {
    fontSize: 8,
    color: "#486581"
  },
  sectionTitle: {
    fontSize: 10,
    bold: true,
    color: "#102a43"
  },
  metaLabel: {
    fontSize: 7,
    bold: true,
    color: "#64748b"
  },
  metaValue: {
    fontSize: 8,
    color: "#102a43"
  },
  tableHeader: {
    fontSize: 7,
    bold: true,
    color: "#ffffff",
    fillColor: "#1f4b7a",
    alignment: "center"
  },
  tableCell: {
    fontSize: 7,
    color: "#102a43"
  },
  tableCellCenter: {
    fontSize: 7,
    color: "#102a43",
    alignment: "center"
  },
  tableCellRight: {
    fontSize: 7,
    color: "#102a43",
    alignment: "right"
  },
  emptyState: {
    fontSize: 8,
    italics: true,
    color: "#64748b"
  },
  footer: {
    fontSize: 6,
    color: "#64748b"
  },
  tableTotalLabel: {
    fontSize: 7,
    bold: true,
    color: "#ffffff",
    fillColor: "#1f4b7a",
    alignment: "right"
  },
  tableTotalValue: {
    fontSize: 7,
    bold: true,
    color: "#ffffff",
    fillColor: "#1f4b7a",
    alignment: "right"
  }
};

export type BillingPreviewPdfInput = {
  preview: BillingPreview;
  rates: BillingRates;
  timeZone: string;
  generatedAt?: string;
};

type BillingPreviewPdfDocument = {
  fileName: string;
  customerName: string;
  startDate: string;
  endDate: string;
  generatedAt: string;
  generatedAtLabel: string;
  grandTotal: string;
  summaryRows: Array<{ label: string; value: string }>;
  rateRows: Array<{ label: string; value: string }>;
  lineRows: Array<{
    chargeType: string;
    reference: string;
    containerNo: string;
    warehouse: string;
    quantity: string;
    unitRate: string;
    amount: string;
    occurredOn: string;
    notes: string;
  }>;
  storageRows: Array<{
    containerNo: string;
    warehouses: string;
    trackedPallets: string;
    palletDays: string;
    amount: string;
  }>;
};

export function downloadBillingPreviewPdf(input: BillingPreviewPdfInput) {
  const document = buildBillingPreviewPdfDocument(input);
  const definition = buildBillingPreviewPdfDefinition(document);
  const tableLayouts = { [BILLING_TABLE_LAYOUT_NAME]: BILLING_TABLE_LAYOUT };
  void pdfMake.createPdf(definition, tableLayouts, PDF_FONTS).download(document.fileName);
}

export function buildBillingPreviewPdfDocument({
  preview,
  rates,
  timeZone,
  generatedAt = new Date().toISOString()
}: BillingPreviewPdfInput): BillingPreviewPdfDocument {
  return {
    fileName: buildFileName(preview.customerName, preview.startDate, preview.endDate),
    customerName: preview.customerName,
    startDate: preview.startDate,
    endDate: preview.endDate,
    generatedAt,
    generatedAtLabel: formatDateTimeValue(generatedAt, timeZone),
    grandTotal: formatMoney(preview.summary.grandTotal),
    summaryRows: [
      { label: "Received Containers", value: formatNumber(preview.summary.receivedContainers) },
      { label: "Received Pallets", value: formatNumber(preview.summary.receivedPallets) },
      { label: "Pallet-Days", value: formatNumber(preview.summary.palletDays) },
      { label: "Inbound Charges", value: formatMoney(preview.summary.inboundAmount) },
      { label: "Wrapping Charges", value: formatMoney(preview.summary.wrappingAmount) },
      { label: "Storage Charges", value: formatMoney(preview.summary.storageAmount) },
      { label: "Outbound Charges", value: formatMoney(preview.summary.outboundAmount) },
      { label: "Grand Total", value: formatMoney(preview.summary.grandTotal) }
    ],
    rateRows: [
      { label: "Inbound Fee / Container", value: formatMoney(rates.inboundContainerFee) },
      { label: "Wrapping Fee / Pallet", value: formatMoney(rates.wrappingFeePerPallet) },
      { label: "Storage Fee / Pallet / Week", value: formatMoney(rates.storageFeePerPalletPerWeek) },
      { label: "Outbound Fee / Pallet", value: formatMoney(rates.outboundFeePerPallet) }
    ],
    lineRows: preview.invoiceLines.map((line) => ({
      chargeType: line.chargeType,
      reference: line.reference || "-",
      containerNo: line.containerNo || "-",
      warehouse: line.warehouseSummary || "-",
      quantity: formatNumber(line.quantity),
      unitRate: formatMoney(line.unitRate),
      amount: formatMoney(line.amount),
      occurredOn: line.occurredOn ? formatDateTimeValue(line.occurredOn, timeZone, { dateStyle: "medium" }) : "-",
      notes: line.meta || "-"
    })),
    storageRows: preview.storageRows.map((row) => ({
      containerNo: row.containerNo || "-",
      warehouses: row.warehousesTouched.join(", ") || "-",
      trackedPallets: formatNumber(row.palletsTracked),
      palletDays: formatNumber(row.palletDays),
      amount: formatMoney(row.amount)
    }))
  };
}

export function buildBillingPreviewPdfDefinition(document: BillingPreviewPdfDocument): TDocumentDefinitions {
  const content: Content[] = [
    { text: "Billing Preview", style: "pageTitle", margin: [0, 0, 0, 2] },
    { text: `${document.customerName} · ${document.startDate} to ${document.endDate}`, style: "pageSubtitle", margin: [0, 0, 0, 8] },
    {
      table: {
        widths: ["*", "*", "*"],
        body: [[
          metaBlock("Customer", document.customerName),
          metaBlock("Billing Period", `${document.startDate} to ${document.endDate}`),
          metaBlock("Exported At", document.generatedAtLabel)
        ]]
      },
      layout: "noBorders",
      margin: [0, 0, 0, 8]
    },
    { text: "Summary", style: "sectionTitle", margin: [0, 0, 0, 4] },
    buildTwoColumnTable(
      document.summaryRows.map((row) => [bodyCell(row.label), bodyCell(row.value, "tableCellRight")]),
      [220, "*"]
    ),
    { text: "Rate Card", style: "sectionTitle", margin: [0, 8, 0, 4] },
    buildTwoColumnTable(
      document.rateRows.map((row) => [bodyCell(row.label), bodyCell(row.value, "tableCellRight")]),
      [220, "*"]
    ),
    { text: "Invoice Lines", style: "sectionTitle", margin: [0, 8, 0, 4] }
  ];

  if (document.lineRows.length === 0) {
    content.push({ text: "No billable lines in the selected billing period.", style: "emptyState" });
  } else {
    content.push({
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: [54, 88, 72, 72, 44, 50, 54, 58, "*"],
        body: [
          [
            headerCell("Charge"),
            headerCell("Reference"),
            headerCell("Container"),
            headerCell("Warehouse"),
            headerCell("Qty"),
            headerCell("Rate"),
            headerCell("Amount"),
            headerCell("Occurred On"),
            headerCell("Notes")
          ],
          ...document.lineRows.map((row, index) => ([
            bodyCell(row.chargeType, "tableCellCenter", index),
            bodyCell(row.reference, "tableCell", index),
            bodyCell(row.containerNo, "tableCellCenter", index),
            bodyCell(row.warehouse, "tableCell", index),
            bodyCell(row.quantity, "tableCellRight", index),
            bodyCell(row.unitRate, "tableCellRight", index),
            bodyCell(row.amount, "tableCellRight", index),
            bodyCell(row.occurredOn, "tableCellCenter", index),
            bodyCell(row.notes, "tableCell", index)
          ])),
          // Grand total footer row
          [
            { text: "Grand Total", style: "tableTotalLabel", colSpan: 6, margin: [0, 1, 0, 1] },
            {}, {}, {}, {}, {},
            { text: document.grandTotal, style: "tableTotalValue", margin: [0, 1, 0, 1] },
            { text: "", colSpan: 2, style: "tableCell" },
            {}
          ]
        ]
      },
      layout: BILLING_TABLE_LAYOUT_NAME
    });
  }

  if (document.storageRows.length > 0) {
    content.push({ text: "Container Storage Summary", style: "sectionTitle", margin: [0, 8, 0, 4] });
    content.push({
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: [90, "*", 56, 56, 60],
        body: [
          [
            headerCell("Container"),
            headerCell("Warehouses"),
            headerCell("Pallets"),
            headerCell("Pallet-Days"),
            headerCell("Amount")
          ],
          ...document.storageRows.map((row, index) => ([
            bodyCell(row.containerNo, "tableCellCenter", index),
            bodyCell(row.warehouses, "tableCell", index),
            bodyCell(row.trackedPallets, "tableCellRight", index),
            bodyCell(row.palletDays, "tableCellRight", index),
            bodyCell(row.amount, "tableCellRight", index)
          ]))
        ]
      },
      layout: BILLING_TABLE_LAYOUT_NAME
    });
  }

  return {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [18, 14, 18, 16],
    info: {
      title: `Billing Preview ${document.customerName}`,
      subject: "Billing Preview Export",
      author: "Speed Inventory Management"
    },
    defaultStyle: {
      font: CJK_FONT_NAME,
      fontSize: 8,
      color: "#102a43"
    },
    styles,
    footer: (currentPage, pageCount) => ({
      margin: [18, 0, 18, 6],
      columns: [
        { text: "Billing Preview Export", style: "footer" },
        { text: `${currentPage} / ${pageCount}`, alignment: "right", style: "footer" }
      ]
    }),
    content
  };
}

function buildTwoColumnTable(rows: TableCell[][], widths: [number, string]): Content {
  return {
    table: {
      widths,
      body: rows
    },
    layout: BILLING_TABLE_LAYOUT_NAME
  };
}

function headerCell(text: string): TableCell {
  return { text, style: "tableHeader", margin: [0, 1, 0, 1], noWrap: true };
}

function bodyCell(text: string, styleName: keyof typeof styles = "tableCell", rowIndex?: number): TableCell {
  return {
    text,
    style: styleName,
    margin: [0, 0, 0, 0],
    ...(rowIndex !== undefined && rowIndex % 2 === 1 ? { fillColor: "#f8fafc" } : {})
  };
}

function metaBlock(label: string, value: string): TableCell {
  return {
    stack: [
      { text: label, style: "metaLabel" },
      { text: value, style: "metaValue", margin: [0, 1, 0, 0] }
    ],
    margin: [0, 0, 8, 2]
  };
}

function buildFileName(customerName: string, startDate: string, endDate: string) {
  const raw = `billing-preview-${customerName}-${startDate}-to-${endDate}`;
  return `${raw.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "billing-preview"}.pdf`;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2
  }).format(value);
}
