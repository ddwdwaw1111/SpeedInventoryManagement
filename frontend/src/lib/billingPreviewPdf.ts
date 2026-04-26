import type { Content, CustomTableLayout, Style, TableCell, TDocumentDefinitions, TFontDictionary } from "pdfmake/interfaces";

import type { BillingPreview, BillingRates, BillingStorageRow } from "./billingPreview";
import { formatDateTimeValue } from "./dates";
import { downloadPdfDefinition } from "./pdfMakeRuntime";
import type { BillingExportMode } from "./types";

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
  }
};

type BillingWorkspaceMode = "OVERVIEW" | "STORAGE_SETTLEMENT";

export type BillingPreviewPdfInput = {
  preview: BillingPreview;
  rates: BillingRates;
  timeZone: string;
  exportMode?: BillingExportMode;
  workspaceMode?: BillingWorkspaceMode;
  storageRows?: BillingStorageRow[];
  generatedAt?: string;
};

type BillingPreviewPdfDocument = {
  fileName: string;
  title: string;
  subtitle: string;
  customerName: string;
  startDate: string;
  endDate: string;
  generatedAtLabel: string;
  modeLabel: string;
  exportModeLabel: string;
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
    customerName: string;
    containerNo: string;
    containerType: string;
    warehouses: string;
    trackedPallets: string;
    palletDays: string;
    freePalletDays: string;
    discountAmount: string;
    amount: string;
  }>;
  segmentRows: Array<{
    customerName: string;
    containerNo: string;
    containerType: string;
    warehouses: string;
    startDate: string;
    endDate: string;
    dayEndPallets: string;
    billedDays: string;
    palletDays: string;
    freePalletDays: string;
    discountAmount: string;
    amount: string;
  }>;
};

export async function downloadBillingPreviewPdf(input: BillingPreviewPdfInput) {
  const document = buildBillingPreviewPdfDocument(input);
  const definition = buildBillingPreviewPdfDefinition(document);
  const tableLayouts = { [BILLING_TABLE_LAYOUT_NAME]: BILLING_TABLE_LAYOUT };
  await downloadPdfDefinition(definition, tableLayouts, PDF_FONTS, document.fileName);
}

export function buildBillingPreviewPdfDocument({
  preview,
  rates: _rates,
  timeZone,
  exportMode = "SUMMARY",
  workspaceMode = "OVERVIEW",
  storageRows = preview.storageRows,
  generatedAt = new Date().toISOString()
}: BillingPreviewPdfInput): BillingPreviewPdfDocument {
  const modeLabel = workspaceMode === "STORAGE_SETTLEMENT" ? "Storage Settlement" : "Overview";
  const exportModeLabel = exportMode === "DETAILED" ? "Detailed" : "Summary";
  const containerTypeSummary = summarizeContainerType(storageRows);

  return {
    fileName: buildFileName(preview.customerName, preview.startDate, preview.endDate, workspaceMode, exportMode),
    title: workspaceMode === "STORAGE_SETTLEMENT" ? "Storage Settlement Preview" : "Billing Preview",
    subtitle: `${preview.customerName} | ${preview.startDate} to ${preview.endDate}`,
    customerName: preview.customerName,
    startDate: preview.startDate,
    endDate: preview.endDate,
    generatedAtLabel: formatDateTimeValue(generatedAt, timeZone),
    modeLabel,
    exportModeLabel,
    summaryRows: workspaceMode === "STORAGE_SETTLEMENT"
      ? [
          { label: "Storage Containers", value: formatNumber(storageRows.length) },
          { label: "Container Type", value: containerTypeSummary },
          { label: "Tracked Pallets", value: formatNumber(storageRows.reduce((sum, row) => sum + row.palletsTracked, 0)) },
          { label: "Pallet-Days", value: formatNumber(storageRows.reduce((sum, row) => sum + row.palletDays, 0)) },
          { label: "Grace Discount", value: formatDiscountMoney(storageRows.reduce((sum, row) => sum + row.discountAmount, 0)) },
          { label: "Storage Charges", value: formatMoney(storageRows.reduce((sum, row) => sum + row.amount, 0)) }
        ]
      : [
          { label: "Received Containers", value: formatNumber(preview.summary.receivedContainers) },
          { label: "Received Pallets", value: formatNumber(preview.summary.receivedPallets) },
          { label: "Pallet-Days", value: formatNumber(preview.summary.palletDays) },
          { label: "Grace Discount", value: formatDiscountMoney(storageRows.reduce((sum, row) => sum + row.discountAmount, 0)) },
          { label: "Inbound Charges", value: formatMoney(preview.summary.inboundAmount) },
          { label: "Wrapping Charges", value: formatMoney(preview.summary.wrappingAmount) },
          { label: "Storage Charges", value: formatMoney(preview.summary.storageAmount) },
          { label: "Outbound Charges", value: formatMoney(preview.summary.outboundAmount) },
          { label: "Grand Total", value: formatMoney(preview.summary.grandTotal) }
        ],
    rateRows: [],
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
    storageRows: storageRows.map((row) => ({
      customerName: row.customerName,
      containerNo: row.containerNo || "-",
      containerType: formatContainerType(row.containerType),
      warehouses: row.warehousesTouched.join(", ") || "-",
      trackedPallets: formatNumber(row.palletsTracked),
      palletDays: formatNumber(row.palletDays),
      freePalletDays: formatNumber(row.freePalletDays),
      discountAmount: formatDiscountMoney(row.discountAmount),
      amount: formatMoney(row.amount)
    })),
    segmentRows: storageRows.flatMap((row) => row.segments.map((segment) => ({
      customerName: row.customerName,
      containerNo: row.containerNo || "-",
      containerType: formatContainerType(row.containerType),
      warehouses: row.warehousesTouched.join(", ") || "-",
      startDate: segment.startDate,
      endDate: segment.endDate,
      dayEndPallets: formatNumber(segment.dayEndPallets),
      billedDays: formatNumber(segment.billedDays),
      palletDays: formatNumber(segment.palletDays),
      freePalletDays: formatNumber(segment.freePalletDays),
      discountAmount: formatDiscountMoney(segment.discountAmount),
      amount: formatMoney(segment.amount)
    })))
  };
}

export function buildBillingPreviewPdfDefinition(document: BillingPreviewPdfDocument): TDocumentDefinitions {
  const content: Content[] = [
    { text: document.title, style: "pageTitle", margin: [0, 0, 0, 2] },
    { text: document.subtitle, style: "pageSubtitle", margin: [0, 0, 0, 8] },
    {
      table: {
        widths: ["*", "*", "*", "*"],
        body: [[
          metaBlock("Customer", document.customerName),
          metaBlock("Billing Period", `${document.startDate} to ${document.endDate}`),
          metaBlock("Mode", document.modeLabel),
          metaBlock("Export", document.exportModeLabel)
        ], [
          metaBlock("Generated At", document.generatedAtLabel),
          metaBlock("File", document.fileName),
          metaBlock("Start", document.startDate),
          metaBlock("End", document.endDate)
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
  ];

  if (document.lineRows.length > 0) {
    content.push({ text: "Invoice Lines", style: "sectionTitle", margin: [0, 8, 0, 4] });
    content.push({
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: [52, 88, 68, 70, 42, 48, 52, 58, "*"],
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
          ]))
        ]
      },
      layout: BILLING_TABLE_LAYOUT_NAME
    });
  }

  if (document.storageRows.length > 0) {
    content.push({ text: "Storage by Container", style: "sectionTitle", margin: [0, 8, 0, 4] });
    content.push({
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: [72, 52, 54, 76, 38, 42, 56, 56],
        body: [
          [
            headerCell("Customer"),
            headerCell("Container"),
            headerCell("Type"),
            headerCell("Warehouses"),
            headerCell("Pallets"),
            headerCell("Pallet-Days"),
            headerCell("Discount"),
            headerCell("Amount")
          ],
          ...document.storageRows.map((row, index) => ([
            bodyCell(row.customerName, "tableCell", index),
            bodyCell(row.containerNo, "tableCellCenter", index),
            bodyCell(row.containerType, "tableCellCenter", index),
            bodyCell(row.warehouses, "tableCell", index),
            bodyCell(row.trackedPallets, "tableCellRight", index),
            bodyCell(row.palletDays, "tableCellRight", index),
            bodyCell(row.discountAmount, "tableCellRight", index),
            bodyCell(row.amount, "tableCellRight", index)
          ]))
        ]
      },
      layout: BILLING_TABLE_LAYOUT_NAME
    });
  }

  if (document.segmentRows.length > 0 && document.exportModeLabel === "Detailed") {
    content.push({ text: "Storage Segment Breakdown", style: "sectionTitle", margin: [0, 8, 0, 4] });
    content.push({
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: [62, 46, 52, 58, 48, 48, 34, 34, 40, 48, 52],
        body: [
          [
            headerCell("Customer"),
            headerCell("Container"),
            headerCell("Type"),
            headerCell("Warehouses"),
            headerCell("Segment Start"),
            headerCell("Segment End"),
            headerCell("Pallets"),
            headerCell("Days"),
            headerCell("Pallet-Days"),
            headerCell("Discount"),
            headerCell("Amount")
          ],
          ...document.segmentRows.map((row, index) => ([
            bodyCell(row.customerName, "tableCell", index),
            bodyCell(row.containerNo, "tableCellCenter", index),
            bodyCell(row.containerType, "tableCellCenter", index),
            bodyCell(row.warehouses, "tableCell", index),
            bodyCell(row.startDate, "tableCellCenter", index),
            bodyCell(row.endDate, "tableCellCenter", index),
            bodyCell(row.dayEndPallets, "tableCellRight", index),
            bodyCell(row.billedDays, "tableCellRight", index),
            bodyCell(row.palletDays, "tableCellRight", index),
            bodyCell(row.discountAmount, "tableCellRight", index),
            bodyCell(row.amount, "tableCellRight", index)
          ]))
        ]
      },
      layout: BILLING_TABLE_LAYOUT_NAME
    });
  }

  if (content.length === 5) {
    content.push({ text: "No billable rows found for the selected billing period.", style: "emptyState" });
  }

  return {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [18, 14, 18, 16],
    info: {
      title: document.title,
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
        { text: document.title, style: "footer" },
        { text: `${currentPage} / ${pageCount}`, alignment: "right", style: "footer" }
      ]
    }),
    content
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
      { text: value, style: "metaValue", margin: [0, 2, 0, 0] }
    ],
    margin: [0, 0, 10, 0]
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

function buildFileName(customerName: string, startDate: string, endDate: string, workspaceMode: BillingWorkspaceMode, exportMode: BillingExportMode) {
  const normalizedCustomer = sanitizeFileName(customerName || "all-customers");
  const normalizedMode = workspaceMode === "STORAGE_SETTLEMENT" ? "storage-settlement" : "overview";
  return `${normalizedMode}-${exportMode.toLowerCase()}-${normalizedCustomer}-${startDate}-to-${endDate}.pdf`;
}

function summarizeContainerType(rows: BillingStorageRow[]) {
  if (rows.length === 0) {
    return "-";
  }
  const first = rows[0].containerType;
  const allSame = rows.every((row) => row.containerType === first);
  return allSame ? formatContainerType(first) : "Mixed";
}

function formatContainerType(containerType: BillingStorageRow["containerType"]) {
  return containerType === "WEST_COAST_TRANSFER" ? "Transfer" : "Normal";
}

function sanitizeFileName(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "billing-preview";
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function formatDiscountMoney(value: number) {
  return `-${formatMoney(Math.abs(value))}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2
  }).format(value);
}
