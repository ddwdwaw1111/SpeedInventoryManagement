import type { Content, CustomTableLayout, Style, TableCell, TDocumentDefinitions, TFontDictionary } from "pdfmake/interfaces";

import type { BillingInvoiceLine, BillingPreview, BillingRates, BillingStorageRow } from "./billingPreview";
import { formatDateTimeValue } from "./dates";
import { downloadPdfDefinition } from "./pdfMakeRuntime";

const BILLING_TABLE_LAYOUT_NAME = "billingTable";
const CJK_FONT_NAME = "NotoSansCJKSC";
const CJK_FONT_URL_BASE = "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/OTF/SimplifiedChinese";
const SELLER_NAME = "Speed Inventory Management";
const PAYMENT_TERMS_DAYS = 30;
const PAYMENT_TERMS_LABEL = "Net 30";

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
    fontSize: 22,
    bold: true,
    color: "#102a43"
  },
  sellerName: {
    fontSize: 12,
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
    color: "#102a43",
    fillColor: "#EEF2F7",
    alignment: "right"
  },
  tableTotalValue: {
    fontSize: 7,
    bold: true,
    color: "#102a43",
    fillColor: "#EEF2F7",
    alignment: "right"
  },
  amountDueLabel: {
    fontSize: 9,
    bold: true,
    color: "#102a43",
    fillColor: "#dbeafe",
    alignment: "right"
  },
  amountDueValue: {
    fontSize: 11,
    bold: true,
    color: "#0f172a",
    fillColor: "#dbeafe",
    alignment: "right"
  },
  headerAmountDue: {
    fontSize: 16,
    bold: true,
    color: "#0f172a",
    alignment: "right"
  }
};

type BillingWorkspaceMode = "OVERVIEW" | "STORAGE_SETTLEMENT";

export type BillingPreviewPdfInput = {
  preview: BillingPreview;
  rates: BillingRates;
  timeZone: string;
  workspaceMode?: BillingWorkspaceMode;
  storageRows?: BillingStorageRow[];
  generatedAt?: string;
};

type BillingPreviewPdfDocument = {
  fileName: string;
  title: string;
  customerName: string;
  startDate: string;
  endDate: string;
  generatedAt: string;
  generatedAtLabel: string;
  modeLabel: string;
  totals: PreviewDisplayTotals;
  chargeSummaryRows: ChargeSummaryRow[];
  discountSourceRows: DiscountSourceRow[];
  lineRows: LineDetailRow[];
  segmentRows: StorageSegmentDetailRow[];
};

type PreviewDisplayTotals = {
  subtotal: number;
  discountTotal: number;
  grandTotal: number;
};

type ChargeSummaryRow = {
  chargeType: string;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
};

type DiscountSourceRow = {
  source: string;
  reference: string;
  basis: string;
  amount: number;
};

type LineDetailRow = {
  lineNo: string;
  charge: string;
  description: string;
  reference: string;
  serviceDate: string;
  quantity: string;
  unitRate: string;
  amount: number;
  discountSource: string;
};

type StorageSegmentDetailRow = {
  lineNo: string;
  startDate: string;
  endDate: string;
  pallets: string;
  days: string;
  basis: string;
  amount: number;
  discountSource: string;
};

type StorageSegmentRow = {
  startDate: string;
  endDate: string;
  dayEndPallets: number;
  billedDays: number;
  palletDays: number;
  freePalletDays: number;
  grossAmount: number;
  discountAmount: number;
  amount: number;
};

type StorageDiscountContext = {
  customerId: number;
  customerName: string;
  reference: string;
  containerNo: string;
  grossAmount: number;
  discountAmount: number;
  amount: number;
  freePalletDays: number;
  palletDays: number;
  segments: Array<{
    startDate: string;
    endDate: string;
    dayEndPallets: number;
    billedDays: number;
    palletDays: number;
    freePalletDays: number;
    grossAmount: number;
    discountAmount: number;
    amount: number;
  }>;
};

type PreviewChargeSource = {
  customerId: number;
  chargeType: BillingInvoiceLine["chargeType"];
  reference: string;
  containerNo: string;
  occurredOn: string | null;
  quantity: number;
  unitRate: number;
  amount: number;
  meta: string;
};

type PreviewTotalsInput = {
  inboundAmount: number;
  wrappingAmount: number;
  storageGrossAmount: number;
  storageDiscountAmount: number;
  storageAmount: number;
  outboundAmount: number;
  grandTotal: number;
};

type PreviewDocumentRowsInput = {
  invoiceLines: PreviewChargeSource[];
  storageRows: BillingStorageRow[];
  timeZone: string;
};

type PreviewBuildContext = {
  storageDiscountsByLineKey: Map<string, StorageDiscountContext>;
  storageDiscounts: StorageDiscountContext[];
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
  workspaceMode = "OVERVIEW",
  storageRows = preview.storageRows,
  generatedAt = new Date().toISOString()
}: BillingPreviewPdfInput): BillingPreviewPdfDocument {
  const modeLabel = workspaceMode === "STORAGE_SETTLEMENT" ? "Storage Settlement" : "Overview";
  const context = buildPreviewContext(storageRows);
  const totals = workspaceMode === "STORAGE_SETTLEMENT"
    ? buildStorageSettlementTotals(storageRows)
    : buildOverviewTotals(preview.summary);
  const chargeSources = workspaceMode === "STORAGE_SETTLEMENT"
    ? buildStorageSettlementChargeSources(storageRows)
    : preview.invoiceLines;

  return {
    fileName: buildFileName(preview.customerName, preview.startDate, preview.endDate, workspaceMode),
    title: workspaceMode === "STORAGE_SETTLEMENT" ? "Storage Settlement Preview" : "Billing Preview",
    customerName: preview.customerName,
    startDate: preview.startDate,
    endDate: preview.endDate,
    generatedAt,
    generatedAtLabel: formatDateTimeValue(generatedAt, timeZone),
    modeLabel,
    totals,
    chargeSummaryRows: buildChargeSummaryRows(chargeSources, context),
    discountSourceRows: buildDiscountSourceRows(context.storageDiscounts),
    lineRows: buildLineDetailRows({ invoiceLines: chargeSources, storageRows, timeZone }, context),
    segmentRows: buildStorageSegmentDetailRows(storageRows)
  };
}

export function buildBillingPreviewPdfDefinition(document: BillingPreviewPdfDocument): TDocumentDefinitions {
  const content: Content[] = [
    buildPreviewHeader(document),
    {
      table: {
        widths: ["*", "*"],
        body: [
          [
            businessBlock("Bill To", [document.customerName]),
            businessBlock("Remit To", [SELLER_NAME])
          ],
          [
            businessBlock("Billing Period", [`${document.startDate} to ${document.endDate}`]),
            businessBlock("Preview Scope", [document.modeLabel])
          ]
        ]
      },
      layout: "noBorders",
      margin: [0, 0, 0, 10]
    },
    { text: "Amount Summary", style: "sectionTitle", margin: [0, 0, 0, 4] },
    buildAmountSummaryTable(document.totals, document.chargeSummaryRows, document.discountSourceRows)
  ];

  if (document.lineRows.length > 0) {
    content.push({ text: "Line Item Detail", style: "sectionTitle", margin: [0, 0, 0, 4], pageBreak: "before" });
    content.push(buildLineDetailTable(document.lineRows));
  }

  if (document.segmentRows.length > 0) {
    content.push({ text: "Storage Segment Detail", style: "sectionTitle", margin: [0, 0, 0, 4], pageBreak: "before" });
    content.push(buildStorageSegmentTable(document.segmentRows));
  }

  if (document.lineRows.length === 0 && document.segmentRows.length === 0) {
    content.push({ text: "No billable rows found for the selected billing period.", style: "emptyState" });
  }

  return {
    pageSize: "LETTER",
    pageOrientation: "portrait",
    pageMargins: [36, 28, 36, 28],
    info: {
      title: document.title,
      subject: "Billing Preview Export",
      author: SELLER_NAME
    },
    defaultStyle: {
      font: CJK_FONT_NAME,
      fontSize: 8,
      color: "#102a43"
    },
    styles,
    footer: (currentPage, pageCount) => ({
      margin: [36, 0, 36, 10],
      columns: [
        { text: document.title, style: "footer" },
        { text: `${currentPage} / ${pageCount}`, alignment: "right", style: "footer" }
      ]
    }),
    content
  };
}

function buildPreviewHeader(document: BillingPreviewPdfDocument): Content {
  const dueDate = getDueDate(document.generatedAt);
  return {
    columns: [
      {
        width: "*",
        stack: [
          { text: SELLER_NAME, style: "sellerName", margin: [0, 0, 0, 4] },
          { text: "Business services billing preview", style: "pageSubtitle" }
        ]
      },
      {
        width: 230,
        stack: [
          { text: document.title.toUpperCase(), style: "pageTitle", alignment: "right", margin: [0, 0, 0, 6] },
          {
            table: {
              widths: [96, "*"],
              body: [
                previewHeaderRow("Preview Date", document.generatedAtLabel),
                previewHeaderRow("Due Date", dueDate ? formatPreviewDate(dueDate) : "-"),
                previewHeaderRow("Terms", PAYMENT_TERMS_LABEL)
              ]
            },
            layout: "noBorders",
            margin: [0, 0, 0, 6]
          },
          { text: "Amount Due", style: "metaLabel", alignment: "right" },
          { text: formatMoney(document.totals.grandTotal), style: "headerAmountDue", margin: [0, 1, 0, 0] }
        ]
      }
    ],
    columnGap: 24,
    margin: [0, 0, 0, 14]
  };
}

function buildAmountSummaryTable(
  totals: PreviewDisplayTotals,
  chargeRows: ChargeSummaryRow[],
  discountRows: DiscountSourceRow[]
): Content {
  const body: TableCell[][] = [
    [
      headerCell("Summary Item"),
      headerCell("Basis / Source"),
      headerCell("Gross Charges"),
      headerCell("Discounts"),
      headerCell("Net Amount")
    ],
    ...chargeRows.map((row, index): TableCell[] => ([
      bodyCell(row.chargeType, "tableCell", index),
      bodyCell("Charge summary", "tableCell", index),
      bodyCell(formatMoney(row.grossAmount), "tableCellRight", index),
      bodyCell(formatDiscountAmount(row.discountAmount), "tableCellRight", index),
      bodyCell(formatMoney(row.netAmount), "tableCellRight", index)
    ])),
    ...discountRows.map((row, index): TableCell[] => ([
      bodyCell("Discount source", "tableCell", index + chargeRows.length),
      bodyCell(`${row.source} | ${row.reference} | ${row.basis}`, "tableCell", index + chargeRows.length),
      bodyCell("-", "tableCellRight", index + chargeRows.length),
      bodyCell(formatDiscountAmount(row.amount), "tableCellRight", index + chargeRows.length),
      bodyCell("-", "tableCellRight", index + chargeRows.length)
    ])),
    [
      { text: "Subtotal before discounts", style: "tableTotalLabel" },
      { text: "", style: "tableTotalValue" },
      { text: formatMoney(totals.subtotal), style: "tableTotalValue" },
      { text: "", style: "tableTotalValue" },
      { text: "", style: "tableTotalValue" }
    ],
    [
      { text: "Discounts", style: "tableTotalLabel" },
      { text: "", style: "tableTotalValue" },
      { text: "", style: "tableTotalValue" },
      { text: formatDiscountAmount(totals.discountTotal), style: "tableTotalValue" },
      { text: "", style: "tableTotalValue" }
    ],
    [
      { text: "Amount Due", style: "amountDueLabel" },
      { text: "", style: "amountDueValue" },
      { text: "", style: "amountDueValue" },
      { text: "", style: "amountDueValue" },
      { text: formatMoney(totals.grandTotal), style: "amountDueValue" }
    ]
  ];

  return {
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths: [118, "*", 82, 82, 82],
      body
    },
    layout: BILLING_TABLE_LAYOUT_NAME
  };
}

function buildLineDetailTable(rows: LineDetailRow[]): Content {
  return {
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths: [18, 45, "*", 55, 42, 58, 44, 52, 76],
      body: [
        [
          headerCell("#"),
          headerCell("Charge"),
          headerCell("Description"),
          headerCell("Reference"),
          headerCell("Service Date"),
          headerCell("Qty / Basis"),
          headerCell("Unit Rate"),
          headerCell("Amount"),
          headerCell("Discount Source")
        ],
        ...rows.map((row, index) => ([
          bodyCell(row.lineNo, "tableCellCenter", index),
          bodyCell(row.charge, "tableCellCenter", index),
          bodyCell(row.description, "tableCell", index),
          bodyCell(row.reference, "tableCell", index),
          bodyCell(row.serviceDate, "tableCellCenter", index),
          bodyCell(row.quantity, "tableCellRight", index),
          bodyCell(row.unitRate, "tableCellRight", index),
          bodyCell(formatMoney(row.amount), "tableCellRight", index),
          bodyCell(row.discountSource, "tableCell", index)
        ]))
      ]
    },
    layout: BILLING_TABLE_LAYOUT_NAME
  };
}

function buildStorageSegmentTable(rows: StorageSegmentDetailRow[]): Content {
  return {
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths: [20, 58, 58, 42, 36, "*", 55, 78],
      body: [
        [
          headerCell("#"),
          headerCell("Start"),
          headerCell("End"),
          headerCell("Pallets"),
          headerCell("Days"),
          headerCell("Basis"),
          headerCell("Amount"),
          headerCell("Discount Source")
        ],
        ...rows.map((row, index) => ([
          bodyCell(row.lineNo, "tableCellCenter", index),
          bodyCell(row.startDate, "tableCellCenter", index),
          bodyCell(row.endDate, "tableCellCenter", index),
          bodyCell(row.pallets, "tableCellRight", index),
          bodyCell(row.days, "tableCellRight", index),
          bodyCell(row.basis, "tableCellRight", index),
          bodyCell(formatMoney(row.amount), "tableCellRight", index),
          bodyCell(row.discountSource, "tableCell", index)
        ]))
      ]
    },
    layout: BILLING_TABLE_LAYOUT_NAME
  };
}

function buildOverviewTotals(summary: PreviewTotalsInput): PreviewDisplayTotals {
  return {
    subtotal: roundCurrency(summary.inboundAmount + summary.wrappingAmount + summary.storageGrossAmount + summary.outboundAmount),
    discountTotal: roundCurrency(-Math.abs(summary.storageDiscountAmount)),
    grandTotal: roundCurrency(summary.grandTotal)
  };
}

function buildStorageSettlementTotals(storageRows: BillingStorageRow[]): PreviewDisplayTotals {
  const subtotal = roundCurrency(storageRows.reduce((sum, row) => sum + row.grossAmount, 0));
  const discountTotal = roundCurrency(-Math.abs(storageRows.reduce((sum, row) => sum + row.discountAmount, 0)));
  const grandTotal = roundCurrency(storageRows.reduce((sum, row) => sum + row.amount, 0));
  return { subtotal, discountTotal, grandTotal };
}

function buildPreviewContext(storageRows: BillingStorageRow[]): PreviewBuildContext {
  const storageDiscounts = storageRows
    .filter((row) => row.discountAmount > 0)
    .map((row) => buildStorageDiscountContext(row));
  const storageDiscountsByLineKey = new Map<string, StorageDiscountContext>();
  for (const row of storageRows) {
    storageDiscountsByLineKey.set(storageLineKey(row.customerId, row.containerNo), buildStorageDiscountContext(row));
  }
  return { storageDiscountsByLineKey, storageDiscounts };
}

function buildStorageDiscountContext(row: BillingStorageRow): StorageDiscountContext {
  return {
    customerId: row.customerId,
    customerName: row.customerName,
    reference: `Storage | ${row.containerNo || "-"}`,
    containerNo: row.containerNo || "-",
    grossAmount: row.grossAmount,
    discountAmount: row.discountAmount,
    amount: row.amount,
    freePalletDays: row.freePalletDays,
    palletDays: row.palletDays,
    segments: row.segments
  };
}

function buildStorageSettlementChargeSources(storageRows: BillingStorageRow[]): PreviewChargeSource[] {
  return storageRows.map((row) => ({
    customerId: row.customerId,
    chargeType: "STORAGE",
    reference: `Storage | ${row.containerNo || "-"}`,
    containerNo: row.containerNo,
    occurredOn: row.lastActivityAt,
    quantity: row.billablePalletDays,
    unitRate: roundCurrency(row.palletDays > 0 ? row.grossAmount / row.palletDays : 0),
    amount: row.amount,
    meta: "Storage charges"
  }));
}

function buildChargeSummaryRows(lines: PreviewChargeSource[], context: PreviewBuildContext): ChargeSummaryRow[] {
  const rows = new Map<string, ChargeSummaryRow>();
  for (const line of lines) {
    const chargeType = chargeTypeLabel(line.chargeType);
    const existing = rows.get(chargeType) ?? {
      chargeType,
      grossAmount: 0,
      discountAmount: 0,
      netAmount: 0
    };
    const storageDiscount = getLineStorageDiscount(line, context);
    existing.grossAmount = roundCurrency(existing.grossAmount + (storageDiscount?.grossAmount ?? line.amount));
    existing.discountAmount = roundCurrency(existing.discountAmount + (storageDiscount?.discountAmount ?? 0));
    existing.netAmount = roundCurrency(existing.netAmount + (storageDiscount?.amount ?? line.amount));
    rows.set(chargeType, existing);
  }
  return [...rows.values()];
}

function buildDiscountSourceRows(storageDiscounts: StorageDiscountContext[]): DiscountSourceRow[] {
  return storageDiscounts.map((row) => ({
    source: "Storage grace period",
    reference: row.reference,
    basis: `${formatNumber(row.freePalletDays)} free pallet-days`,
    amount: -Math.abs(row.discountAmount)
  }));
}

function buildLineDetailRows({ invoiceLines, timeZone }: PreviewDocumentRowsInput, context: PreviewBuildContext): LineDetailRow[] {
  const rows: LineDetailRow[] = [];
  invoiceLines.forEach((line, index) => {
    const storageDiscount = getLineStorageDiscount(line, context);
    const serviceDate = line.occurredOn ? formatDateTimeValue(line.occurredOn, timeZone, { dateStyle: "medium" }) : "-";
    rows.push({
      lineNo: String(index + 1),
      charge: chargeTypeDetailLabel(line.chargeType),
      description: getLineDescription(line, storageDiscount),
      reference: line.reference || "-",
      serviceDate,
      quantity: storageDiscount
        ? formatQuantityWithUnit(storageDiscount.palletDays, "pallet-days")
        : formatQuantityWithUnit(line.quantity, quantityUnitForChargeType(line.chargeType)),
      unitRate: formatMoney(line.unitRate),
      amount: roundCurrency(storageDiscount?.grossAmount ?? line.amount),
      discountSource: "-"
    });

    if (storageDiscount && storageDiscount.discountAmount > 0) {
      rows.push({
        lineNo: "",
        charge: "Discount",
        description: "Storage grace period",
        reference: line.reference || storageDiscount.reference,
        serviceDate,
        quantity: `${formatNumber(storageDiscount.freePalletDays)} free pallet-days`,
        unitRate: "-",
        amount: -Math.abs(storageDiscount.discountAmount),
        discountSource: "Storage grace period"
      });
    }
  });
  return rows;
}

function buildStorageSegmentDetailRows(storageRows: BillingStorageRow[]): StorageSegmentDetailRow[] {
  const rows: StorageSegmentDetailRow[] = [];

  aggregateStorageSegmentRows(flattenStorageSegments(storageRows)).forEach((segment, index) => {
    rows.push({
      lineNo: String(index + 1),
      startDate: segment.startDate,
      endDate: segment.endDate,
      pallets: formatNumber(segment.dayEndPallets),
      days: formatNumber(segment.billedDays),
      basis: `${formatNumber(segment.palletDays)} pallet-days`,
      amount: roundCurrency(segment.grossAmount),
      discountSource: "-"
    });

    if (segment.discountAmount > 0) {
      rows.push({
        lineNo: "",
        startDate: segment.startDate,
        endDate: segment.endDate,
        pallets: "-",
        days: "-",
        basis: `${formatNumber(segment.freePalletDays)} free pallet-days`,
        amount: -Math.abs(segment.discountAmount),
        discountSource: "Storage grace period"
      });
    }
  });

  return rows;
}

function flattenStorageSegments(storageRows: BillingStorageRow[]): StorageSegmentRow[] {
  return storageRows.flatMap((storageRow) => storageRow.segments.map((segment) => ({
    startDate: segment.startDate,
    endDate: segment.endDate,
    dayEndPallets: segment.dayEndPallets,
    billedDays: segment.billedDays,
    palletDays: segment.palletDays,
    freePalletDays: segment.freePalletDays,
    grossAmount: segment.grossAmount,
    discountAmount: segment.discountAmount,
    amount: segment.amount
  })));
}

type DailyStorageSegmentBucket = {
  date: string;
  dayEndPallets: number;
  dayEndFreePallets: number;
  grossAmount: number;
  discountAmount: number;
};

type ActiveStorageSegmentBucket = DailyStorageSegmentBucket & {
  startDate: string;
  endDate: string;
  billedDays: number;
};

function aggregateStorageSegmentRows(segmentRows: StorageSegmentRow[]): StorageSegmentRow[] {
  const dailyBuckets = new Map<string, DailyStorageSegmentBucket>();

  for (const segment of segmentRows) {
    const segmentDays = enumerateIsoDays(segment.startDate, segment.endDate);
    if (segmentDays.length === 0) {
      continue;
    }

    const grossAmountPerDay = segment.grossAmount / segmentDays.length;
    const discountAmountPerDay = segment.discountAmount / segmentDays.length;
    const freePalletsPerDay = segment.freePalletDays / segmentDays.length;

    for (const day of segmentDays) {
      const bucket = dailyBuckets.get(day) ?? {
        date: day,
        dayEndPallets: 0,
        dayEndFreePallets: 0,
        grossAmount: 0,
        discountAmount: 0
      };
      bucket.dayEndPallets += segment.dayEndPallets;
      bucket.dayEndFreePallets += freePalletsPerDay;
      bucket.grossAmount += grossAmountPerDay;
      bucket.discountAmount += discountAmountPerDay;
      dailyBuckets.set(day, bucket);
    }
  }

  const aggregatedRows: StorageSegmentRow[] = [];
  let activeBucket: ActiveStorageSegmentBucket | null = null;

  for (const day of [...dailyBuckets.keys()].sort()) {
    const bucket = dailyBuckets.get(day)!;
    if (!activeBucket) {
      activeBucket = startAggregatedStorageSegment(bucket);
      continue;
    }

    if (isNextIsoDay(activeBucket.endDate, day) && isSameDailyStorageSegmentBucket(activeBucket, bucket)) {
      activeBucket.endDate = day;
      activeBucket.billedDays += 1;
      continue;
    }

    aggregatedRows.push(finalizeAggregatedStorageSegment(activeBucket));
    activeBucket = startAggregatedStorageSegment(bucket);
  }

  if (activeBucket) {
    aggregatedRows.push(finalizeAggregatedStorageSegment(activeBucket));
  }

  return aggregatedRows;
}

function startAggregatedStorageSegment(bucket: DailyStorageSegmentBucket): ActiveStorageSegmentBucket {
  return {
    ...bucket,
    startDate: bucket.date,
    endDate: bucket.date,
    billedDays: 1
  };
}

function finalizeAggregatedStorageSegment(bucket: ActiveStorageSegmentBucket): StorageSegmentRow {
  const palletDays = bucket.dayEndPallets * bucket.billedDays;
  const freePalletDays = bucket.dayEndFreePallets * bucket.billedDays;
  const grossAmount = roundCurrency(bucket.grossAmount * bucket.billedDays);
  const discountAmount = roundCurrency(bucket.discountAmount * bucket.billedDays);
  return {
    startDate: bucket.startDate,
    endDate: bucket.endDate,
    dayEndPallets: bucket.dayEndPallets,
    billedDays: bucket.billedDays,
    palletDays,
    freePalletDays,
    grossAmount,
    discountAmount,
    amount: roundCurrency(grossAmount - discountAmount)
  };
}

function isSameDailyStorageSegmentBucket(left: DailyStorageSegmentBucket, right: DailyStorageSegmentBucket) {
  return numbersClose(left.dayEndPallets, right.dayEndPallets)
    && numbersClose(left.dayEndFreePallets, right.dayEndFreePallets)
    && numbersClose(left.grossAmount, right.grossAmount)
    && numbersClose(left.discountAmount, right.discountAmount);
}

function enumerateIsoDays(startDate: string, endDate: string) {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (!start || !end || start.getTime() > end.getTime()) {
    return [];
  }

  const days: string[] = [];
  for (let day = start; day.getTime() <= end.getTime(); day = shiftUtcDay(day, 1)) {
    days.push(formatIsoDate(day));
  }
  return days;
}

function parseIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function shiftUtcDay(value: Date, days: number) {
  const next = new Date(value.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function isNextIsoDay(currentDate: string, nextDate: string) {
  const current = parseIsoDate(currentDate);
  return current ? formatIsoDate(shiftUtcDay(current, 1)) === nextDate : false;
}

function formatIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function numbersClose(left: number, right: number) {
  return Math.abs(left - right) < 0.0001;
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

function businessBlock(label: string, lines: string[]): TableCell {
  const stack: Content[] = [
    { text: label, style: "metaLabel" },
    ...lines.map((line, index): Content => ({
      text: line || "-",
      style: "metaValue",
      margin: [0, index === 0 ? 2 : 1, 0, 0] as [number, number, number, number]
    }))
  ];
  const cell: Content = {
    stack: [
      ...stack
    ],
    margin: [0, 0, 14, 6]
  };
  return cell as TableCell;
}

function previewHeaderRow(label: string, value: string): TableCell[] {
  return [
    { text: label, style: "metaLabel", alignment: "right", margin: [0, 0, 8, 2] },
    { text: value, style: "metaValue", alignment: "right", margin: [0, 0, 0, 2] }
  ];
}

function buildFileName(customerName: string, startDate: string, endDate: string, workspaceMode: BillingWorkspaceMode) {
  const normalizedCustomer = sanitizeFileName(customerName || "all-customers");
  const normalizedMode = workspaceMode === "STORAGE_SETTLEMENT" ? "storage-settlement" : "overview";
  return `${normalizedMode}-${normalizedCustomer}-${startDate}-to-${endDate}.pdf`;
}

function storageLineKey(customerId: number, containerNo: string) {
  return `${customerId}|${containerNo || "-"}`;
}

function getLineStorageDiscount(line: PreviewChargeSource, context: PreviewBuildContext) {
  if (line.chargeType !== "STORAGE") {
    return null;
  }
  return context.storageDiscountsByLineKey.get(storageLineKey(line.customerId, line.containerNo)) ?? null;
}

function getLineDescription(line: PreviewChargeSource, storageDiscount: StorageDiscountContext | null) {
  if (storageDiscount) {
    return "Storage charges";
  }
  return line.meta || `${chargeTypeDetailLabel(line.chargeType)} charges`;
}

function chargeTypeLabel(chargeType: BillingInvoiceLine["chargeType"]) {
  switch (chargeType) {
    case "INBOUND":
      return "Inbound Charges";
    case "WRAPPING":
      return "Wrapping Charges";
    case "STORAGE":
      return "Storage Charges";
    case "OUTBOUND":
      return "Outbound Charges";
    default:
      return chargeType;
  }
}

function chargeTypeDetailLabel(chargeType: BillingInvoiceLine["chargeType"]) {
  switch (chargeType) {
    case "INBOUND":
      return "Inbound";
    case "WRAPPING":
      return "Wrapping";
    case "STORAGE":
      return "Storage";
    case "OUTBOUND":
      return "Outbound";
    default:
      return chargeType;
  }
}

function quantityUnitForChargeType(chargeType: BillingInvoiceLine["chargeType"]) {
  switch (chargeType) {
    case "INBOUND":
      return "container";
    case "WRAPPING":
    case "OUTBOUND":
      return "pallets";
    case "STORAGE":
      return "pallet-days";
    default:
      return "units";
  }
}

function formatQuantityWithUnit(value: number, unit: string) {
  const formatted = formatNumber(value);
  if (unit === "pallet-days") {
    return `${formatted} pallet-days`;
  }
  const singular = Math.abs(value) === 1;
  return `${formatted} ${singular ? unit.replace(/s$/, "") : unit}`;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function getDueDate(previewDate: string) {
  const parsed = new Date(previewDate);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  parsed.setDate(parsed.getDate() + PAYMENT_TERMS_DAYS);
  return parsed.toISOString();
}

function formatPreviewDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(parsed);
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

function formatDiscountAmount(value: number) {
  return value === 0 ? formatMoney(0) : formatMoney(-Math.abs(value));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2
  }).format(value);
}
