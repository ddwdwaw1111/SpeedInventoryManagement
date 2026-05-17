import type { Content, CustomTableLayout, Style, TableCell, TDocumentDefinitions, TFontDictionary } from "pdfmake/interfaces";

import { downloadPdfDefinition } from "./pdfMakeRuntime";
import type { InboundDocument, InboundPackingListImportLine, InboundPackingListImportPreview } from "./types";

const TALLY_SHEET_LAYOUT_NAME = "receivingTallySheetTable";
const CJK_FONT_NAME = "NotoSansCJKSC";
const CJK_FONT_URL_BASE = "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/SimplifiedChinese";
const TALLY_SHEET_VERSION = "Version 1.0";
const ROWS_PER_PAGE = 41;
const BLANK_ROWS_AFTER_SKUS = 5;

const PDF_FONTS: TFontDictionary = {
  [CJK_FONT_NAME]: {
    normal: `${CJK_FONT_URL_BASE}/NotoSansCJKsc-Regular.otf`,
    bold: `${CJK_FONT_URL_BASE}/NotoSansCJKsc-Bold.otf`,
    italics: `${CJK_FONT_URL_BASE}/NotoSansCJKsc-Regular.otf`,
    bolditalics: `${CJK_FONT_URL_BASE}/NotoSansCJKsc-Bold.otf`
  }
};

const TALLY_SHEET_TABLE_LAYOUT: CustomTableLayout = {
  hLineColor: (rowIndex, node) => (rowIndex === 0 || rowIndex === 1 || rowIndex === node.table.body.length ? "#111827" : "#6b7280"),
  vLineColor: () => "#111827",
  hLineWidth: (rowIndex, node) => (rowIndex === 0 || rowIndex === 1 || rowIndex === node.table.body.length ? 0.9 : 0.42),
  vLineWidth: () => 0.7,
  paddingLeft: () => 3,
  paddingRight: () => 3,
  paddingTop: (rowIndex) => (rowIndex === 0 ? 2 : 0.6),
  paddingBottom: (rowIndex) => (rowIndex === 0 ? 2 : 0.6)
};

const CHECKBOX_LAYOUT: CustomTableLayout = {
  hLineColor: () => "#111827",
  vLineColor: () => "#111827",
  hLineWidth: () => 0.75,
  vLineWidth: () => 0.75,
  paddingLeft: () => 0,
  paddingRight: () => 0,
  paddingTop: () => 0,
  paddingBottom: () => 0
};

const styles: Record<string, Style> = {
  pageTitle: {
    fontSize: 15,
    bold: true,
    color: "#111827"
  },
  fieldLabel: {
    fontSize: 8,
    bold: true,
    color: "#111827"
  },
  fieldValue: {
    fontSize: 8,
    color: "#111827"
  },
  tableHeader: {
    fontSize: 7.4,
    bold: true,
    color: "#111827",
    alignment: "center"
  },
  tableHeaderSmall: {
    fontSize: 6.1,
    bold: true,
    color: "#111827",
    alignment: "center"
  },
  tableCell: {
    fontSize: 6.4,
    color: "#111827"
  },
  tableCellCenter: {
    fontSize: 6.4,
    color: "#111827",
    alignment: "center"
  },
  skuText: {
    fontSize: 6.6,
    bold: true,
    color: "#111827",
    lineHeight: 0.9
  },
  descriptionText: {
    fontSize: 4.7,
    color: "#4b5563",
    lineHeight: 0.9
  },
  footer: {
    fontSize: 6,
    color: "#111827"
  }
};

type InboundReceivingCountSheetLineInput = InboundPackingListImportLine & {
  actualQty?: number | null;
  expectedPalletQty?: number | null;
  actualPalletQty?: number | null;
  palletDetails?: string;
};

export type InboundReceivingCountSheetInput = Omit<InboundPackingListImportPreview, "lines"> & {
  customerName?: string;
  warehouseName?: string;
  scheduledArrivalDate?: string | null;
  receivingDate?: string | null;
  unloadingDock?: string;
  remarks?: string;
  containerType?: string | null;
  receivedBy?: string;
  totalPallets?: number | null;
  lines: InboundReceivingCountSheetLineInput[];
};

type ReceivingCountSheetDocument = {
  fileName: string;
  warehouseName: string;
  containerNo: string;
  receivedBy: string;
  totalPallets: number | null;
  rows: ReceivingCountSheetRow[];
};

type ReceivingCountSheetRow = {
  sequence: number;
  itemNumber: string;
  sku: string;
  description: string;
  expectedQty: number;
  actualQty: number | null;
  expectedPalletQty: number | null;
  actualPalletQty: number | null;
  palletDetails: string;
};

const LABELS = {
  title: "RECEIVING TALLY SHEET",
  warehouse: "Warehouse",
  containerType: "Container Type",
  regular: "Regular",
  transfer: "Transfer",
  containerNo: "Container No.",
  receivedBy: "Recived At",
  totalPallets: "Total Pallets",
  sku: "SKU",
  expectedQty: "Expected\nQty (CTN)",
  actualQty: "Actual\nQty (CTN)",
  expectedPalletQty: "Expected\nPallet Qty",
  actualPalletQty: "Actual\nPallet Qty",
  palletDetails: "Pallet Details",
  empty: "",
  subject: "Receiving Tally Sheet"
} as const;

export async function downloadInboundReceivingCountSheetPdf(input: InboundReceivingCountSheetInput) {
  const document = buildInboundReceivingCountSheetDocument(input);
  const definition = buildInboundReceivingCountSheetDefinition(document);
  const tableLayouts = {
    [TALLY_SHEET_LAYOUT_NAME]: TALLY_SHEET_TABLE_LAYOUT,
    checkbox: CHECKBOX_LAYOUT
  };
  await downloadPdfDefinition(definition, tableLayouts, PDF_FONTS, document.fileName);
}

export function downloadInboundReceivingCountSheetPdfFromDocument(document: InboundDocument) {
  return downloadInboundReceivingCountSheetPdf(buildInboundReceivingCountSheetInputFromDocument(document));
}

export function buildInboundReceivingCountSheetInputFromDocument(document: InboundDocument): InboundReceivingCountSheetInput {
  const unitLabel = document.unitLabel || document.lines.find((line) => line.unitLabel)?.unitLabel || "";
  const totalExpectedQty = document.lines.reduce((sum, line) => sum + getLineExpectedQty(line.expectedQty, line.receivedQty), 0);

  return {
    sourceFileName: `Inbound Receipt #${document.id}`,
    title: LABELS.title,
    containerNo: document.containerNo,
    referenceCode: `IN-${document.id}`,
    unitLabel,
    totalQty: document.totalExpectedQty || totalExpectedQty,
    totalCartons: isCartonUnit(unitLabel) ? (document.totalExpectedQty || totalExpectedQty) : 0,
    totalNetWeightKgs: 0,
    totalGrossWeightKgs: 0,
    customerName: document.customerName,
    warehouseName: document.locationName,
    scheduledArrivalDate: document.expectedArrivalDate,
    receivingDate: document.actualArrivalDate,
    remarks: document.documentNote,
    containerType: document.containerType,
    totalPallets: null,
    lines: document.lines.map((line, index) => {
      const lineUnitLabel = line.unitLabel || unitLabel;
      const lineExpectedQty = getLineExpectedQty(line.expectedQty, line.receivedQty);

      return {
        sequence: index + 1,
        itemNumber: "",
        sku: line.sku,
        description: line.description,
        quantity: lineExpectedQty,
        unitLabel: lineUnitLabel,
        cartonSizeMm: "",
        cartonCount: isCartonUnit(lineUnitLabel) ? lineExpectedQty : 0,
        netWeightKgs: 0,
        grossWeightKgs: 0,
        actualQty: null,
        expectedPalletQty: line.pallets || null,
        actualPalletQty: null,
        palletDetails: ""
      };
    })
  };
}

export function buildInboundReceivingCountSheetDocument(input: InboundReceivingCountSheetInput): ReceivingCountSheetDocument {
  const rows = input.lines.map(toReceivingCountSheetRow);

  return {
    fileName: `receiving-tally-sheet-${sanitizeFileName(input.containerNo || input.referenceCode || input.sourceFileName || "inbound")}.pdf`,
    warehouseName: safeValue(input.warehouseName),
    containerNo: safeValue(input.containerNo),
    receivedBy: safeValue(input.receivedBy),
    totalPallets: input.totalPallets && input.totalPallets > 0 ? input.totalPallets : null,
    rows
  };
}

export function buildInboundReceivingCountSheetDefinition(document: ReceivingCountSheetDocument): TDocumentDefinitions {
  const pages = buildTallySheetRowPages(document.rows);

  return {
    pageSize: "LETTER",
    pageOrientation: "portrait",
    pageMargins: [26, 24, 26, 18],
    info: {
      title: `${LABELS.title} ${document.containerNo || ""}`.trim(),
      subject: LABELS.subject,
      author: "Speed Inventory Management"
    },
    defaultStyle: {
      font: CJK_FONT_NAME,
      fontSize: 9,
      color: "#111827"
    },
    styles,
    footer: (currentPage, pageCount) => ({
      margin: [26, 0, 26, 5],
      columns: [
        { text: pageCount > 1 ? `Page ${currentPage} / ${pageCount}` : "", style: "footer" },
        { text: TALLY_SHEET_VERSION, alignment: "right", style: "footer" }
      ]
    }),
    content: pages.flatMap((rows, pageIndex) => buildTallySheetPage(document, rows, pageIndex < pages.length - 1))
  };
}

function buildTallySheetPage(document: ReceivingCountSheetDocument, rows: ReceivingCountSheetRow[], addPageBreak: boolean): Content[] {
  const content: Content[] = [
    { text: LABELS.title, style: "pageTitle", margin: [0, 0, 0, 3] },
    {
      canvas: [{ type: "line", x1: 0, y1: 0, x2: 560, y2: 0, lineWidth: 1.1, lineColor: "#111827" }],
      margin: [0, 0, 0, 7]
    },
    buildFieldRow([
      labelCell(LABELS.warehouse),
      underlineCell(document.warehouseName),
      labelCell(LABELS.containerType, 16),
      containerTypeCell()
    ], [68, 165, 82, 150]),
    buildFieldRow([
      labelCell(LABELS.containerNo),
      underlineCell(document.containerNo),
      labelCell(LABELS.receivedBy, 16),
      underlineCell(document.receivedBy)
    ], [84, 165, 80, 152]),
    buildFieldRow([
      labelCell(LABELS.totalPallets),
      underlineCell(formatOptionalInteger(document.totalPallets)),
      emptyCell(),
      emptyCell()
    ], [88, 80, "*", 152], [0, 0, 0, 6]),
    buildMainTable(rows)
  ];

  if (addPageBreak) {
    content.push({ text: "", pageBreak: "after" });
  }

  return content;
}

function buildFieldRow(body: TableCell[], widths: Array<number | string>, margin: [number, number, number, number] = [0, 0, 0, 6]): Content {
  return {
    margin,
    table: {
      widths,
      body: [body]
    },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0
    }
  };
}

function buildMainTable(rows: ReceivingCountSheetRow[]): Content {
  return {
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths: [104, 68, 68, 78, 74, "*"],
      heights: (rowIndex) => (rowIndex === 0 ? 17 : 13),
      body: [
        [
          headerCell(LABELS.sku, "tableHeader"),
          headerCell(LABELS.expectedQty, "tableHeaderSmall"),
          headerCell(LABELS.actualQty, "tableHeaderSmall"),
          headerCell(LABELS.expectedPalletQty, "tableHeaderSmall"),
          headerCell(LABELS.actualPalletQty, "tableHeaderSmall"),
          headerCell(LABELS.palletDetails, "tableHeader")
        ],
        ...rows.map((row) => [
          skuCell(row),
          bodyCell(formatOptionalInteger(row.expectedQty), "tableCellCenter"),
          bodyCell(formatOptionalInteger(row.actualQty), "tableCellCenter"),
          bodyCell(formatOptionalInteger(row.expectedPalletQty), "tableCellCenter"),
          bodyCell(formatOptionalInteger(row.actualPalletQty), "tableCellCenter"),
          bodyCell(row.palletDetails, "tableCell")
        ])
      ]
    },
    layout: TALLY_SHEET_LAYOUT_NAME
  };
}

function toReceivingCountSheetRow(line: InboundReceivingCountSheetLineInput): ReceivingCountSheetRow {
  return {
    sequence: line.sequence,
    itemNumber: safeValue(line.itemNumber),
    sku: safeValue(line.sku),
    description: safeValue(line.description),
    expectedQty: Math.max(0, line.quantity || 0),
    actualQty: normalizeOptionalNumber(line.actualQty),
    expectedPalletQty: normalizeOptionalNumber(line.expectedPalletQty),
    actualPalletQty: normalizeOptionalNumber(line.actualPalletQty),
    palletDetails: safeValue(line.palletDetails)
  };
}

function labelCell(text: string, leftMargin = 0): TableCell {
  return { text, style: "fieldLabel", margin: [leftMargin, 1, 0, 0], border: [false, false, false, false] };
}

function underlineCell(text: string): TableCell {
  return { text, style: "fieldValue", margin: [0, 1, 0, 1], border: [false, false, false, true], borderColor: ["#111827", "#111827", "#111827", "#111827"] };
}

function emptyCell(): TableCell {
  return { text: "", border: [false, false, false, false] };
}

function containerTypeCell(): TableCell {
  return {
    border: [false, false, false, false],
    table: {
      widths: [10, 54, 10, "*"],
      heights: [10],
      body: [[
        checkboxCell(),
        { text: LABELS.regular, style: "fieldValue", border: [false, false, false, false], margin: [4, 0, 0, 0] },
        checkboxCell(),
        { text: LABELS.transfer, style: "fieldValue", border: [false, false, false, false], margin: [4, 0, 0, 0] }
      ]]
    },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0
    }
  };
}

function checkboxCell(): TableCell {
  return {
    text: "",
    style: "tableCellCenter",
    border: [true, true, true, true],
    margin: [0, 0, 0, 0]
  };
}

function headerCell(text: string, styleName: keyof typeof styles): TableCell {
  return { text, style: styleName, margin: [0, 0, 0, 0], noWrap: false };
}

function skuCell(row: ReceivingCountSheetRow): TableCell {
  if (!row.sku && !row.itemNumber && !row.description) {
    return bodyCell("", "tableCell");
  }

  return {
    stack: [
      { text: row.sku || row.itemNumber, style: "skuText" },
      ...(row.description ? [{ text: truncateDescription(row.description), style: "descriptionText", margin: [0, 0, 0, 0], noWrap: true }] : [])
    ],
    margin: [0, 0, 0, 0]
  } as unknown as TableCell;
}

function bodyCell(text: string, styleName: keyof typeof styles): TableCell {
  return { text, style: styleName, margin: [0, 0, 0, 0] };
}

function createBlankRow(sequence: number): ReceivingCountSheetRow {
  return {
    sequence,
    itemNumber: "",
    sku: "",
    description: "",
    expectedQty: 0,
    actualQty: null,
    expectedPalletQty: null,
    actualPalletQty: null,
    palletDetails: ""
  };
}

function buildTallySheetRowPages(rows: ReceivingCountSheetRow[]) {
  const pages = chunkRows(rows, ROWS_PER_PAGE);
  if (pages.length === 0) {
    return [createBlankRows(0, BLANK_ROWS_AFTER_SKUS)];
  }

  const lastPageIndex = pages.length - 1;
  const lastPage = pages[lastPageIndex];
  const blankRowCount = Math.min(BLANK_ROWS_AFTER_SKUS, Math.max(0, ROWS_PER_PAGE - lastPage.length));
  pages[lastPageIndex] = [...lastPage, ...createBlankRows(lastPage.length, blankRowCount)];

  return pages;
}

function createBlankRows(startIndex: number, count: number) {
  return Array.from({ length: count }, (_, index) => createBlankRow(startIndex + index + 1));
}

function chunkRows(rows: ReceivingCountSheetRow[], size: number) {
  const chunks: ReceivingCountSheetRow[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

function formatOptionalInteger(value: number | null) {
  return value && value > 0 ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value) : "";
}

function normalizeOptionalNumber(value: number | null | undefined) {
  return typeof value === "number" && value > 0 ? value : null;
}

function safeValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function truncateDescription(value: string) {
  return value.length > 48 ? `${value.slice(0, 45)}...` : value;
}

function sanitizeFileName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "receiving-tally-sheet";
}

function getLineExpectedQty(expectedQty: number, receivedQty: number) {
  return expectedQty > 0 ? expectedQty : Math.max(0, receivedQty);
}

function isCartonUnit(unitLabel: string) {
  const normalized = unitLabel.trim().toUpperCase();
  return normalized === "CTN" || normalized === "CARTON" || normalized === "CARTONS";
}
