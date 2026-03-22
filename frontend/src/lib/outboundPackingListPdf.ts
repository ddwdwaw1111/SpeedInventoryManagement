import * as pdfMake from "pdfmake/build/pdfmake";
import type { Content, CustomTableLayout, Style, TableCell, TDocumentDefinitions, TFontDictionary } from "pdfmake/interfaces";

import type { OutboundDocument, OutboundDocumentLine } from "./types";

const PACKING_LIST_LAYOUT_NAME = "packingListTable";
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

const PACKING_LIST_TABLE_LAYOUT: CustomTableLayout = {
  hLineColor: (rowIndex, node) => (rowIndex === 0 || rowIndex === node.table.body.length ? "#cbd5e1" : "#e2e8f0"),
  vLineColor: () => "#e2e8f0",
  hLineWidth: (rowIndex, node) => (rowIndex === 0 || rowIndex === 1 || rowIndex === node.table.body.length ? 0.8 : 0.4),
  vLineWidth: () => 0.4,
  paddingLeft: (columnIndex) => (columnIndex === 0 ? 4 : 5),
  paddingRight: (columnIndex, node) => (columnIndex === node.table.widths!.length - 1 ? 4 : 5),
  paddingTop: () => 4,
  paddingBottom: () => 4
};

const styles: Record<string, Style> = {
  pageTitle: {
    fontSize: 14,
    bold: true,
    color: "#0f172a"
  },
  metaLabel: {
    fontSize: 7,
    bold: true,
    color: "#64748b"
  },
  metaValue: {
    fontSize: 8,
    color: "#0f172a"
  },
  notesLabel: {
    fontSize: 7,
    bold: true,
    color: "#1e293b"
  },
  notesValue: {
    fontSize: 8,
    color: "#1e293b",
    lineHeight: 1.1
  },
  tableHeader: {
    fontSize: 7,
    bold: true,
    color: "#ffffff",
    fillColor: "#334155",
    alignment: "center"
  },
  tableCell: {
    fontSize: 7,
    color: "#0f172a"
  },
  tableCellCenter: {
    fontSize: 7,
    color: "#0f172a",
    alignment: "center"
  },
  tableCellRight: {
    fontSize: 7,
    color: "#0f172a",
    alignment: "right"
  },
  totalsLabel: {
    fontSize: 8,
    bold: true,
    color: "#0f172a",
    alignment: "right"
  },
  totalsValue: {
    fontSize: 8,
    bold: true,
    color: "#0f172a",
    alignment: "right"
  },
  footer: {
    fontSize: 6,
    color: "#64748b"
  }
};

type PackingListDocument = {
  fileName: string;
  rows: PackingListRow[];
  packingListNo: string;
  orderRef: string;
  customerSummary: string;
  storageSummary: string;
  outDate: string;
  notes: string[];
  totalQty: number;
  totalNetWeightKgs: number;
  totalGrossWeightKgs: number;
};

type PackingListRow = {
  id: number;
  sku: string;
  description: string;
  itemName: string;
  locationName: string;
  storageSection: string;
  quantity: number;
  unitLabel: string;
  cartonSizeMm: string;
  netWeightKgs: number;
  grossWeightKgs: number;
  documentNote: string;
  createdAt: string;
  outDate: string | null;
};

const LABELS = {
  title: "Packing List",
  generatedAt: "Generated",
  packingListNo: "Packing List No.",
  orderRef: "Order Ref.",
  customer: "Customer",
  outDate: "Out Date",
  storage: "Storage",
  totalQty: "Total Qty",
  notes: "Notes",
  sequence: "SN",
  sku: "SKU",
  description: "Description",
  qty: "Qty",
  unit: "Unit",
  cartonSize: "CTN Size (MM)",
  netWeight: "N.W.",
  grossWeight: "G.W.",
  total: "TOTAL",
  generatedBySystem: "Generated automatically by the system",
  empty: "—",
  subject: "Outbound Packing List"
} as const;

export function downloadOutboundPackingListPdfFromDocument(document: OutboundDocument) {
  const packingListDocument = buildPackingListDocumentFromDocument(document);
  const documentDefinition = buildDocumentDefinition(packingListDocument);
  const tableLayouts = { [PACKING_LIST_LAYOUT_NAME]: PACKING_LIST_TABLE_LAYOUT };
  void pdfMake.createPdf(documentDefinition, tableLayouts, PDF_FONTS).download(packingListDocument.fileName);
}

function buildPackingListDocumentFromDocument(document: OutboundDocument): PackingListDocument {
  return {
    fileName: `packing-list-${sanitizeFileName(document.packingListNo || `outbound-${document.id}`)}.pdf`,
    rows: document.lines.map((line) => toPackingListRowFromLine(line, document)),
    packingListNo: document.packingListNo || `OUT-${document.id}`,
    orderRef: safeValue(document.orderRef),
    customerSummary: safeValue(document.customerName),
    storageSummary: joinUniqueValues(document.lines.map((line) => `${line.locationName}${line.storageSection ? ` / ${line.storageSection}` : ""}`)),
    outDate: safeValue(document.outDate),
    notes: collectNotes(document.lines.map((line) => toPackingListRowFromLine(line, document))),
    totalQty: document.totalQty,
    totalNetWeightKgs: document.totalNetWeightKgs,
    totalGrossWeightKgs: document.totalGrossWeightKgs
  };
}

function buildDocumentDefinition(document: PackingListDocument): TDocumentDefinitions {
  const noteText = document.notes.length > 0 ? document.notes.join(" / ") : LABELS.empty;
  const tableBody: TableCell[][] = [
    [
      headerCell(LABELS.sequence),
      headerCell(LABELS.sku),
      headerCell(LABELS.description),
      headerCell(LABELS.storage),
      headerCell(LABELS.qty),
      headerCell(LABELS.unit),
      headerCell(LABELS.cartonSize),
      headerCell(LABELS.netWeight),
      headerCell(LABELS.grossWeight)
    ],
    ...document.rows.map((row, index) => ([
      bodyCell(String(index + 1), "tableCellCenter"),
      bodyCell(row.sku, "tableCellCenter"),
      bodyCell(displayDescription(row), "tableCell"),
      bodyCell(`${row.locationName}${row.storageSection ? ` / ${row.storageSection}` : ""}`, "tableCell"),
      bodyCell(formatInteger(Math.abs(row.quantity)), "tableCellRight"),
      bodyCell(row.unitLabel || "PCS", "tableCellCenter"),
      bodyCell(row.cartonSizeMm || LABELS.empty, "tableCellCenter"),
      bodyCell(formatDecimal(row.netWeightKgs), "tableCellRight"),
      bodyCell(formatDecimal(row.grossWeightKgs), "tableCellRight")
    ]))
  ];

  const content: Content[] = [
    {
      text: LABELS.title,
      style: "pageTitle",
      margin: [0, 0, 0, -1]
    },
    {
      margin: [0, 4, 0, 0],
      table: {
        widths: ["*", "*", "*", "*"],
        body: [
          [
            metaBlock(LABELS.packingListNo, document.packingListNo),
            metaBlock(LABELS.orderRef, document.orderRef || LABELS.empty),
            metaBlock(LABELS.customer, document.customerSummary || LABELS.empty),
            metaBlock(LABELS.outDate, formatDateLabel(document.outDate))
          ],
          [
            metaBlock(LABELS.storage, document.storageSummary || LABELS.empty),
            metaBlock(LABELS.generatedAt, formatTimestamp(new Date().toISOString(), { includeTime: true })),
            metaSpanBlock(LABELS.notes, noteText, 2),
            {}
          ]
        ]
      },
      layout: "noBorders"
    },
    {
      margin: [0, 4, 0, 0],
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: [22, 58, "*", 98, 42, 42, 90, 56, 56],
        body: tableBody
      },
      layout: PACKING_LIST_LAYOUT_NAME
    },
    {
      margin: [0, 8, 0, 0],
      alignment: "right",
      table: {
        widths: [88, 56, 56, 56],
        body: [[
          { text: LABELS.total, style: "totalsLabel", border: [false, false, false, false] },
          { text: formatInteger(document.totalQty), style: "totalsValue", border: [false, false, false, false] },
          { text: formatDecimal(document.totalNetWeightKgs), style: "totalsValue", border: [false, false, false, false] },
          { text: formatDecimal(document.totalGrossWeightKgs), style: "totalsValue", border: [false, false, false, false] }
        ]]
      },
      layout: "noBorders"
    }
  ];

  return {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [16, 12, 16, 12],
    info: {
      title: `${LABELS.title} ${document.packingListNo}`,
      subject: LABELS.subject,
      author: "Speed Inventory Management"
    },
    defaultStyle: {
      font: CJK_FONT_NAME,
      fontSize: 8,
      color: "#0f172a"
    },
    styles,
    footer: (currentPage, pageCount) => ({
      margin: [20, 0, 20, 4],
      columns: [
        { text: LABELS.generatedBySystem, style: "footer" },
        { text: `Page ${currentPage} / ${pageCount}`, alignment: "right", style: "footer" }
      ]
    }),
    content
  };
}

function collectNotes(rows: PackingListRow[]) {
  const notes = rows
    .map((row) => safeValue(row.documentNote))
    .filter(Boolean);

  return Array.from(new Set(notes));
}

function headerCell(text: string): TableCell {
  return { text, style: "tableHeader", margin: [0, 1, 0, 1], noWrap: true };
}

function bodyCell(text: string, styleName: keyof typeof styles): TableCell {
  return { text, style: styleName, margin: [0, 0, 0, 0] };
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

function metaSpanBlock(label: string, value: string, colSpan: number): TableCell {
  return {
    colSpan,
    stack: [
      { text: label, style: "metaLabel" },
      { text: value, style: "metaValue", margin: [0, 1, 0, 0] }
    ],
    margin: [0, 0, 8, 2]
  };
}

function displayDescription(row: Pick<PackingListRow, "description" | "itemName">) {
  return safeValue(row.description) || safeValue(row.itemName);
}

function toPackingListRowFromLine(line: OutboundDocumentLine, document: OutboundDocument): PackingListRow {
  return {
    id: line.id,
    sku: line.sku,
    description: line.description,
    itemName: line.description,
    locationName: line.locationName,
    storageSection: line.storageSection,
    quantity: line.quantity,
    unitLabel: line.unitLabel || "PCS",
    cartonSizeMm: line.cartonSizeMm,
    netWeightKgs: line.netWeightKgs,
    grossWeightKgs: line.grossWeightKgs,
    documentNote: document.documentNote,
    createdAt: line.createdAt,
    outDate: document.outDate
  };
}

function formatDateLabel(value: string) {
  return value ? formatTimestamp(value, { includeTime: false }) : LABELS.empty;
}

function formatTimestamp(value: string, options: { includeTime: boolean }) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value || LABELS.empty;
  }

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(options.includeTime
      ? {
          hour: "2-digit",
          minute: "2-digit"
        }
      : {})
  }).format(parsed);
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatDecimal(value: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  }).format(value);
}

function joinUniqueValues(values: string[]) {
  return Array.from(new Set(values.map((value) => safeValue(value)).filter(Boolean))).join(", ");
}

function safeValue(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "packing-list";
}
