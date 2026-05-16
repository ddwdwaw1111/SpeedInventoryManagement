import type { Content, CustomTableLayout, Style, TableCell, TDocumentDefinitions, TFontDictionary } from "pdfmake/interfaces";

import { getOutboundDisplayShipDate, getOutboundExpectedShipDate } from "./outboundDates";
import { downloadPdfDefinition } from "./pdfMakeRuntime";
import { normalizeStorageSection, type OutboundDocument } from "./types";

const PICK_SHEET_LAYOUT_NAME = "pickSheetTable";
const CJK_FONT_NAME = "NotoSansCJKSC";
const CJK_FONT_URL_BASE = "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/SimplifiedChinese";
const PICK_SHEET_VERSION = "1.0";

const PDF_FONTS: TFontDictionary = {
  [CJK_FONT_NAME]: {
    normal: `${CJK_FONT_URL_BASE}/NotoSansCJKsc-Regular.otf`,
    bold: `${CJK_FONT_URL_BASE}/NotoSansCJKsc-Bold.otf`,
    italics: `${CJK_FONT_URL_BASE}/NotoSansCJKsc-Regular.otf`,
    bolditalics: `${CJK_FONT_URL_BASE}/NotoSansCJKsc-Bold.otf`
  }
};

const PICK_SHEET_TABLE_LAYOUT: CustomTableLayout = {
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
    fontSize: 15,
    bold: true,
    color: "#0f172a"
  },
  titleMeta: {
    fontSize: 8,
    color: "#475569"
  },
  skuHeader: {
    fontSize: 10,
    bold: true,
    color: "#ffffff",
    fillColor: "#143569"
  },
  warehouseSubHeader: {
    fontSize: 7,
    bold: true,
    color: "#143569",
    fillColor: "#e8f0fb"
  },
  warehouseSubHeaderRight: {
    fontSize: 7,
    bold: true,
    color: "#143569",
    fillColor: "#e8f0fb",
    alignment: "right"
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
  tableHeader: {
    fontSize: 7,
    bold: true,
    color: "#ffffff",
    fillColor: "#1e3a5f",
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
  footer: {
    fontSize: 6,
    color: "#64748b"
  }
};

type PickSheetRow = {
  id: string;
  demandKey: string;
  demandSequence: number;
  sku: string;
  warehouse: string;
  section: string;
  containerNo: string;
  quantity: number;
  pallets: number;
};

type PickSheetSkuGroup = {
  key: string;
  sku: string;
  rows: PickSheetRow[];
  totalQty: number;
  totalPallets: number;
  warehouseGroups: PickSheetWarehouseGroup[];
};

type PickSheetWarehouseGroup = {
  key: string;
  warehouse: string;
  rows: PickSheetRow[];
  totalQty: number;
  totalPallets: number;
  containerGroups: PickSheetContainerGroup[];
};

type PickSheetContainerGroup = {
  key: string;
  warehouse: string;
  section: string;
  containerNo: string;
  rows: PickSheetRow[];
  totalQty: number;
  totalPallets: number;
};

type PickSheetDocument = {
  fileName: string;
  rows: PickSheetRow[];
  skuGroups: PickSheetSkuGroup[];
  packingListNo: string;
  orderRef: string;
  customerSummary: string;
  expectedShipDate: string;
  actualShipDate: string;
  warehouseSummary: string;
  remarks: string;
  totalQty: number;
  totalPallets: number;
  totalContainers: number;
  totalDemandLines: number;
};

const LABELS = {
  title: "Warehouse Pick Sheet",
  printedAt: "Printed At",
  packingListNo: "Packing List No.",
  orderRef: "Order No.",
  pickDate: "Pick Date",
  warehouse: "Warehouse",
  remarks: "Remarks",
  warehouseCount: "Warehouses",
  sku: "SKU",
  section: "Section",
  containerNo: "Container No.",
  qty: "Qty",
  totalQty: "Total Qty",
  palletQty: "Pallet Qty",
  pallets: "Pallets",
  totalPallet: "Total Pallet",
  totalContainers: "Containers",
  containerCount: "Containers",
  unknownWarehouse: "Unassigned",
  generatedBySystem: "System generated document",
  empty: "--",
  subject: "Warehouse Pick Sheet"
} as const;

export async function downloadOutboundPickSheetPdfFromDocument(document: OutboundDocument) {
  const pickSheetDocument = buildPickSheetDocument(document);
  const documentDefinition = buildPickSheetDefinition(pickSheetDocument);
  const tableLayouts = { [PICK_SHEET_LAYOUT_NAME]: PICK_SHEET_TABLE_LAYOUT };
  await downloadPdfDefinition(documentDefinition, tableLayouts, PDF_FONTS, pickSheetDocument.fileName);
}

export function buildPickSheetDocument(document: OutboundDocument): PickSheetDocument {
  const rows = document.lines.flatMap((line, lineIndex) => buildPickSheetRowsForLine(line, lineIndex));

  const skuGroups = groupRowsBySku(rows);

  return {
    fileName: `warehouse-pick-sheet-${sanitizeFileName(document.packingListNo || `outbound-${document.id}`)}.pdf`,
    rows,
    skuGroups,
    packingListNo: document.packingListNo || `OUT-${document.id}`,
    orderRef: safeValue(document.orderRef),
    customerSummary: safeValue(document.customerName),
    expectedShipDate: safeValue(getOutboundExpectedShipDate(document)),
    actualShipDate: safeValue(getOutboundDisplayShipDate(document)),
    warehouseSummary: joinUniqueValues(rows.map((row) => row.warehouse)),
    remarks: safeValue(document.documentNote),
    totalQty: rows.reduce((sum, row) => sum + row.quantity, 0),
    totalPallets: normalizePalletCount(rows.reduce((sum, row) => sum + Math.max(0, row.pallets || 0), 0)),
    totalContainers: countUniqueContainers(rows),
    totalDemandLines: new Set(rows.map((row) => row.demandKey)).size
  };
}

function buildPickSheetRowsForLine(line: OutboundDocument["lines"][number], lineIndex: number): PickSheetRow[] {
  if (line.pickAllocations.length === 0) {
    throw new Error(`Warehouse pick sheet requires stored pick allocations for outbound line ${line.id}.`);
  }

  const demandSequence = lineIndex + 1;
  const demandKey = String(line.id || demandSequence);

  return mergePickSheetRowsByContainer(line.pickAllocations.map((allocation) => ({
    id: `${line.id}-${allocation.id}`,
    demandKey,
    demandSequence,
    sku: line.sku,
    warehouse: allocation.locationName || line.locationName,
    section: normalizeStorageSection(allocation.storageSection),
    containerNo: allocation.containerNo || "",
    quantity: allocation.allocatedQty,
    pallets: Math.max(0, allocation.pallets ?? 0)
  })));
}

function mergePickSheetRowsByContainer(rows: PickSheetRow[]): PickSheetRow[] {
  const mergedRows: PickSheetRow[] = [];
  const indexByKey = new Map<string, number>();

  for (const row of rows) {
    const key = [
      safeValue(row.warehouse),
      safeValue(row.section),
      safeValue(row.containerNo),
      safeValue(row.sku),
      safeValue(row.demandKey)
    ].join("|");
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, mergedRows.length);
      mergedRows.push({ ...row, pallets: normalizePalletCount(row.pallets) });
      continue;
    }

    const existingRow = mergedRows[existingIndex];
    existingRow.quantity += row.quantity;
    existingRow.pallets = normalizePalletCount(existingRow.pallets + row.pallets);
  }

  return mergedRows;
}

function groupRowsBySku(rows: PickSheetRow[]): PickSheetSkuGroup[] {
  const groups: PickSheetSkuGroup[] = [];
  const indexByKey = new Map<string, number>();

  for (const row of rows) {
    const key = safeValue(row.sku) || LABELS.empty;
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, groups.length);
      groups.push({
        key,
        sku: key,
        rows: [row],
        totalQty: row.quantity,
        totalPallets: normalizePalletCount(row.pallets),
        warehouseGroups: []
      });
      continue;
    }

    const group = groups[existingIndex];
    group.rows.push(row);
    group.totalQty += row.quantity;
    group.totalPallets = normalizePalletCount(group.totalPallets + row.pallets);
  }

  for (const group of groups) {
    group.rows.sort(comparePickSheetRowsForHierarchy);
    group.warehouseGroups = groupRowsByWarehouse(group.rows);
  }

  return groups;
}

function comparePickSheetRowsForHierarchy(left: PickSheetRow, right: PickSheetRow) {
  const warehouseCompare = left.warehouse.localeCompare(right.warehouse);
  if (warehouseCompare !== 0) return warehouseCompare;
  const sectionCompare = left.section.localeCompare(right.section);
  if (sectionCompare !== 0) return sectionCompare;
  const containerCompare = left.containerNo.localeCompare(right.containerNo);
  if (containerCompare !== 0) return containerCompare;
  return left.demandSequence - right.demandSequence;
}

function groupRowsByWarehouse(rows: PickSheetRow[]): PickSheetWarehouseGroup[] {
  const groups: PickSheetWarehouseGroup[] = [];
  const indexByKey = new Map<string, number>();
  for (const row of rows) {
    const key = (row.warehouse || "").trim() || LABELS.unknownWarehouse;
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, groups.length);
      groups.push({ key, warehouse: key, rows: [row], totalQty: row.quantity, totalPallets: normalizePalletCount(row.pallets), containerGroups: [] });
      continue;
    }
    const group = groups[existingIndex];
    group.rows.push(row);
    group.totalQty += row.quantity;
    group.totalPallets = normalizePalletCount(group.totalPallets + row.pallets);
  }
  for (const group of groups) {
    group.rows.sort(comparePickSheetRowsForHierarchy);
    group.containerGroups = groupRowsByContainer(group.rows);
  }
  return groups;
}

function groupRowsByContainer(rows: PickSheetRow[]): PickSheetContainerGroup[] {
  const groups: PickSheetContainerGroup[] = [];
  const indexByKey = new Map<string, number>();

  for (const row of rows) {
    const warehouse = safeValue(row.warehouse) || LABELS.unknownWarehouse;
    const containerNo = safeValue(row.containerNo) || LABELS.empty;
    const section = safeValue(row.section) || LABELS.empty;
    const key = [warehouse, section, containerNo].join("|");
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, groups.length);
      groups.push({
        key,
        warehouse,
        section,
        containerNo,
        rows: [row],
        totalQty: row.quantity,
        totalPallets: normalizePalletCount(row.pallets)
      });
      continue;
    }

    const group = groups[existingIndex];
    group.rows.push(row);
    group.totalQty += row.quantity;
    group.totalPallets = normalizePalletCount(group.totalPallets + row.pallets);
  }

  return groups;
}

export function buildPickSheetDefinition(document: PickSheetDocument): TDocumentDefinitions {
  const printedAt = formatTimestamp(new Date().toISOString(), true);

  const skuSections: Content[] = [];
  for (const skuGroup of document.skuGroups) {
    skuSections.push({
      margin: [0, 10, 0, 0],
      table: {
        widths: ["*", 70, 78, 74, 74],
        body: [[
          {
            text: `${LABELS.sku}: ${skuGroup.sku || LABELS.empty}`,
            style: "skuHeader",
            margin: [6, 3, 6, 3]
          },
          {
            text: `${LABELS.totalQty}: ${formatInteger(skuGroup.totalQty)}`,
            style: "skuHeader",
            margin: [6, 3, 6, 3],
            alignment: "right",
            noWrap: true
          },
          {
            text: `${LABELS.totalPallet}: ${formatPalletCount(skuGroup.totalPallets)}`,
            style: "skuHeader",
            margin: [6, 3, 6, 3],
            alignment: "right",
            noWrap: true
          },
          {
            text: `${LABELS.warehouseCount}: ${formatInteger(skuGroup.warehouseGroups.length)}`,
            style: "skuHeader",
            margin: [6, 3, 6, 3],
            alignment: "right",
            noWrap: true
          },
          {
            text: `${LABELS.containerCount}: ${formatInteger(countSkuContainerGroups(skuGroup))}`,
            style: "skuHeader",
            margin: [6, 3, 6, 3],
            alignment: "right",
            noWrap: true
          }
        ]]
      },
      layout: "noBorders"
    });

    const tableBody: TableCell[][] = [
      [
        headerCell(LABELS.containerNo),
        headerCell(LABELS.section),
        headerCell(LABELS.qty),
        headerCell(LABELS.palletQty)
      ],
      ...skuGroup.warehouseGroups.flatMap((warehouseGroup) => [
        warehouseGroupHeaderRow(warehouseGroup),
        ...warehouseGroup.rows.map((row) => [
          bodyCell(safeValue(row.containerNo) || LABELS.empty, "tableCellCenter"),
          bodyCell(safeValue(row.section) || LABELS.empty, "tableCellCenter"),
          bodyCell(formatInteger(row.quantity), "tableCellRight"),
          bodyCell(formatPalletCount(row.pallets), "tableCellRight")
        ])
      ])
    ];

    skuSections.push({
      margin: [0, 2, 0, 0],
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: ["*", 70, 54, 54],
        body: tableBody
      },
      layout: PICK_SHEET_LAYOUT_NAME
    });
  }

  const content: Content[] = [
    {
      table: {
        widths: ["*"],
        body: [[
          {
            stack: [
              { text: LABELS.title, style: "pageTitle" },
              { text: `${LABELS.packingListNo}: ${document.packingListNo} | ${LABELS.orderRef}: ${document.orderRef || LABELS.empty}`, style: "titleMeta", margin: [0, 2, 0, 0] }
            ],
            margin: [0, 0, 8, 0]
          }
        ]]
      },
      layout: "noBorders"
    },
    {
      margin: [0, 5, 0, 0],
      table: {
        widths: [84, "*"],
        body: [[
          metaBlock(LABELS.pickDate, formatDateLabel(getPickDateValue(document))),
          metaBlock(LABELS.remarks, document.remarks || LABELS.empty)
        ]]
      },
      layout: "noBorders"
    },
    ...skuSections
  ];

  return {
    pageSize: "A4",
    pageOrientation: "portrait",
    pageMargins: [18, 14, 18, 16],
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
        {
          stack: [
            { text: LABELS.generatedBySystem, style: "footer" },
            { text: `Version ${PICK_SHEET_VERSION}`, style: "footer" }
          ]
        },
        { text: `${LABELS.printedAt}: ${printedAt}`, alignment: "center", style: "footer" },
        { text: `Page ${currentPage} / ${pageCount}`, alignment: "right", style: "footer" }
      ]
    }),
    content
  };
}

function headerCell(text: string): TableCell {
  return { text, style: "tableHeader", margin: [0, 1, 0, 1], noWrap: true };
}

function bodyCell(text: string, styleName: keyof typeof styles): TableCell {
  return { text, style: styleName, margin: [0, 0, 0, 0] };
}

function warehouseGroupHeaderRow(group: PickSheetWarehouseGroup): TableCell[] {
  return [
    {
      colSpan: 2,
      text: `${LABELS.warehouse}: ${group.warehouse || LABELS.empty} | ${LABELS.totalContainers}: ${formatInteger(group.containerGroups.length)}`,
      style: "warehouseSubHeader",
      margin: [4, 1, 4, 1]
    },
    {},
    {
      text: formatInteger(group.totalQty),
      style: "warehouseSubHeaderRight",
      margin: [4, 1, 4, 1]
    },
    {
      text: formatPalletCount(group.totalPallets),
      style: "warehouseSubHeaderRight",
      margin: [4, 1, 4, 1]
    }
  ];
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

function formatDateLabel(value: string) {
  return value ? formatTimestamp(value, false) : LABELS.empty;
}

function getPickDateValue(document: PickSheetDocument) {
  return document.actualShipDate || document.expectedShipDate;
}

function formatTimestamp(value: string, includeTime: boolean) {
  if (!includeTime) {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (dateOnly) {
      return `${dateOnly[2]}/${dateOnly[3]}/${dateOnly[1]}`;
    }
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value || LABELS.empty;
  }

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {})
  }).format(parsed);
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatPalletCount(value: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4
  }).format(normalizePalletCount(value));
}

function normalizePalletCount(value: number) {
  return Math.round(value * 10000) / 10000;
}

function countSkuContainerGroups(group: PickSheetSkuGroup) {
  return group.warehouseGroups.reduce((sum, warehouseGroup) => sum + warehouseGroup.containerGroups.length, 0);
}

function countUniqueContainers(rows: PickSheetRow[]) {
  return new Set(rows.map((row) => [
    safeValue(row.warehouse) || LABELS.unknownWarehouse,
    safeValue(row.section) || LABELS.empty,
    safeValue(row.containerNo) || LABELS.empty
  ].join("|"))).size;
}

function joinUniqueValues(values: string[]) {
  return Array.from(new Set(values.map((value) => safeValue(value)).filter(Boolean))).join(", ");
}

function safeValue(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "warehouse-pick-sheet";
}
