import type { Content, CustomTableLayout, Style, TableCell, TDocumentDefinitions, TFontDictionary } from "pdfmake/interfaces";

import { formatDateTimeValue } from "./dates";
import { downloadPdfDefinition } from "./pdfMakeRuntime";
import { DEFAULT_BILLING_INVOICE_HEADER } from "./settings";
import type { BillingInvoice, BillingInvoiceLineData, BillingInvoiceType } from "./types";

const BILLING_TABLE_LAYOUT_NAME = "billingInvoiceTable";
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

export type BillingInvoicePdfInput = {
  invoice: BillingInvoice;
  timeZone: string;
};

export async function downloadBillingInvoicePdf({ invoice, timeZone }: BillingInvoicePdfInput) {
  const definition = buildBillingInvoicePdfDefinition({ invoice, timeZone });
  const tableLayouts = { [BILLING_TABLE_LAYOUT_NAME]: BILLING_TABLE_LAYOUT };
  await downloadPdfDefinition(definition, tableLayouts, PDF_FONTS, buildFileName(invoice.invoiceNo));
}

export function buildBillingInvoicePdfDefinition({ invoice, timeZone }: BillingInvoicePdfInput): TDocumentDefinitions {
  const header = getInvoiceHeader(invoice);
  const totals = getBillingInvoiceDisplayTotals(invoice);
  const chargeSummaryRows = buildChargeSummaryRows(invoice.lines);
  const discountSourceRows = buildDiscountSourceRows(invoice.lines);
  const invoiceDate = getInvoiceDate(invoice);
  const dueDate = getDueDate(invoiceDate, header.paymentDueDays);

  const content: Content[] = [
    buildInvoiceHeader(invoice, totals, invoiceDate, dueDate, timeZone, header),
    {
      table: {
        widths: ["*", "*"],
        body: [
          [
            businessBlock("Bill To", [invoice.customerNameSnapshot]),
            businessBlock("Remit To", [header.remitTo])
          ],
          [
            businessBlock("Billing Period", [`${invoice.periodStart} to ${invoice.periodEnd}`]),
            businessBlock("Service Type", [invoiceTypeLabel(invoice.invoiceType)])
          ]
        ]
      },
      layout: "noBorders",
      margin: [0, 0, 0, 10]
    },
    { text: "Amount Summary", style: "sectionTitle", margin: [0, 0, 0, 4] },
    buildAmountSummaryTable(totals, chargeSummaryRows, discountSourceRows)
  ];

  if (header.paymentInstructions) {
    content.push({ text: header.paymentInstructions, style: "pageSubtitle", margin: [0, 6, 0, 0] });
  }

  if (invoice.lines.length > 0) {
    content.push({ text: "Line Item Detail", style: "sectionTitle", margin: [0, 0, 0, 4], pageBreak: "before" });
    content.push(buildLineDetailTable(invoice.lines));
  }

  if (invoice.invoiceType === "STORAGE_SETTLEMENT") {
    const segmentRows = flattenStorageSettlementSegments(invoice.lines);
    if (segmentRows.length > 0) {
      content.push({ text: "Storage Segment Detail", style: "sectionTitle", margin: [0, 0, 0, 4], pageBreak: "before" });
      content.push(buildStorageSegmentTable(segmentRows));
    }
  }

  return {
    pageSize: "LETTER",
    pageOrientation: "portrait",
    pageMargins: [36, 28, 36, 28],
    info: {
      title: `Billing Invoice ${invoice.invoiceNo}`,
      subject: "Billing Invoice Export",
      author: header.sellerName
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
        { text: `Billing Invoice ${invoice.invoiceNo}`, style: "footer" },
        { text: `${currentPage} / ${pageCount}`, alignment: "right", style: "footer" }
      ]
    }),
    content
  };
}

function buildInvoiceHeader(invoice: BillingInvoice, totals: InvoiceDisplayTotals, invoiceDate: string, dueDate: string | null, timeZone: string, header: BillingInvoice["header"]): Content {
  return {
    columns: [
      {
        width: "*",
        stack: [
          { text: header.sellerName, style: "sellerName", margin: [0, 0, 0, 4] },
          { text: header.subtitle, style: "pageSubtitle" }
        ]
      },
      {
        width: 210,
        stack: [
          { text: "INVOICE", style: "pageTitle", alignment: "right", margin: [0, 0, 0, 6] },
          {
            table: {
              widths: [86, "*"],
              body: [
                invoiceHeaderRow("Invoice No.", invoice.invoiceNo),
                invoiceHeaderRow("Invoice Date", formatInvoiceDate(invoiceDate, timeZone)),
                invoiceHeaderRow("Due Date", dueDate ? formatInvoiceDate(dueDate, timeZone) : "-"),
                invoiceHeaderRow("Terms", header.terms)
              ]
            },
            layout: "noBorders",
            margin: [0, 0, 0, 6]
          },
          { text: "Amount Due", style: "metaLabel", alignment: "right" },
          { text: formatMoney(totals.grandTotal), style: "headerAmountDue", margin: [0, 1, 0, 0] }
        ]
      }
    ],
    columnGap: 24,
    margin: [0, 0, 0, 14]
  };
}

function buildAmountSummaryTable(
  totals: InvoiceDisplayTotals,
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

function buildLineDetailTable(lines: BillingInvoiceLineData[]): Content {
  const rows = buildLineDetailRows(lines);

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
          bodyCell(row.date, "tableCellCenter", index),
          bodyCell(row.quantity, "tableCellRight", index),
          bodyCell(row.rate, "tableCellRight", index),
          bodyCell(formatMoney(row.amount), "tableCellRight", index),
          bodyCell(row.discountSource, "tableCell", index)
        ]))
      ]
    },
    layout: BILLING_TABLE_LAYOUT_NAME
  };
}

function buildStorageSegmentTable(segmentRows: StorageSegmentRow[]): Content {
  const rows = buildStorageSegmentDetailRows(segmentRows);

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

type InvoiceDisplayTotals = {
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
  date: string;
  quantity: string;
  rate: string;
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

function flattenStorageSettlementSegments(lines: BillingInvoiceLineData[]) {
  return lines.flatMap((line) => {
    if (!line.details || line.details.kind !== "STORAGE_CONTAINER_SUMMARY") {
      return [];
    }
    return line.details.segments.map((segment) => ({
      startDate: segment.startDate,
      endDate: segment.endDate,
      dayEndPallets: segment.dayEndPallets,
      billedDays: segment.billedDays,
      palletDays: segment.palletDays,
      freePalletDays: segment.freePalletDays ?? 0,
      grossAmount: segment.grossAmount ?? roundCurrency(segment.amount + (segment.discountAmount ?? 0)),
      discountAmount: segment.discountAmount ?? 0,
      amount: segment.amount
    }));
  });
}

function sumStorageGraceDiscount(lines: BillingInvoiceLineData[]) {
  return lines.reduce((total, line) => total + (line.details?.discountAmount ?? 0), 0);
}

function getBillingInvoiceDisplayTotals(invoice: BillingInvoice): InvoiceDisplayTotals {
  if (invoice.lines.length === 0) {
    const discountTotal = invoice.discountTotal === 0 ? 0 : -Math.abs(invoice.discountTotal);
    return {
      subtotal: roundCurrency(invoice.subtotal),
      discountTotal: roundCurrency(discountTotal),
      grandTotal: roundCurrency(invoice.subtotal + discountTotal)
    };
  }

  const storageGraceDiscount = roundCurrency(sumStorageGraceDiscount(invoice.lines));
  const lineDiscountTotal = roundCurrency(invoice.lines
    .filter((line) => line.chargeType === "DISCOUNT")
    .reduce((total, line) => total + Math.abs(line.amount), 0));
  const subtotal = roundCurrency(invoice.lines
    .filter((line) => line.chargeType !== "DISCOUNT")
    .reduce((total, line) => total + line.amount + (line.details?.discountAmount ?? 0), 0));
  const discountTotal = roundCurrency(-Math.abs(storageGraceDiscount + lineDiscountTotal));

  return {
    subtotal,
    discountTotal,
    grandTotal: roundCurrency(subtotal + discountTotal)
  };
}

function buildChargeSummaryRows(lines: BillingInvoiceLineData[]): ChargeSummaryRow[] {
  const rows = new Map<string, ChargeSummaryRow>();
  for (const line of lines) {
    if (line.chargeType === "DISCOUNT") {
      continue;
    }
    const chargeType = chargeTypeLabel(line.chargeType);
    const existing = rows.get(chargeType) ?? {
      chargeType,
      grossAmount: 0,
      discountAmount: 0,
      netAmount: 0
    };
    const discountAmount = line.details?.discountAmount ?? 0;
    existing.grossAmount = roundCurrency(existing.grossAmount + line.amount + discountAmount);
    existing.discountAmount = roundCurrency(existing.discountAmount + discountAmount);
    existing.netAmount = roundCurrency(existing.netAmount + line.amount);
    rows.set(chargeType, existing);
  }

  return [...rows.values()];
}

function buildDiscountSourceRows(lines: BillingInvoiceLineData[]): DiscountSourceRow[] {
  return lines.flatMap((line, index) => {
    const rows: DiscountSourceRow[] = [];
    if (line.details?.kind === "STORAGE_CONTAINER_SUMMARY" && (line.details.discountAmount ?? 0) > 0) {
      rows.push({
        source: "Storage grace period",
        reference: line.reference || "-",
        basis: `${formatNumber(line.details.freePalletDays ?? 0)} free pallet-days`,
        amount: -Math.abs(line.details.discountAmount ?? 0)
      });
    }

    if (line.chargeType === "DISCOUNT" && line.amount !== 0) {
      rows.push({
        source: line.sourceType === "AUTO" ? "Automatic discount line" : "Manual discount line",
        reference: line.reference || `Line ${index + 1}`,
        basis: line.description || "Invoice discount",
        amount: -Math.abs(line.amount)
      });
    }

    return rows;
  });
}

function buildLineDetailRows(lines: BillingInvoiceLineData[]) {
  const rows: LineDetailRow[] = [];

  lines.forEach((line, index) => {
    if (line.chargeType === "DISCOUNT") {
      rows.push({
        lineNo: String(index + 1),
        charge: "Discount",
        description: line.description || "Invoice discount",
        reference: line.reference || "-",
        date: line.occurredOn || "-",
        quantity: formatQuantityWithUnit(line.quantity, "discount"),
        rate: formatMoney(line.unitRate),
        amount: roundCurrency(line.amount),
        discountSource: discountLineSourceLabel(line)
      });
      return;
    }

    const embeddedDiscount = getEmbeddedDiscountAmount(line);
    rows.push({
      lineNo: String(index + 1),
      charge: chargeTypeDetailLabel(line.chargeType),
      description: line.description || "-",
      reference: line.reference || "-",
      date: line.occurredOn || "-",
      quantity: getLineQuantity(line),
      rate: formatMoney(line.unitRate),
      amount: roundCurrency(line.amount + embeddedDiscount),
      discountSource: "-"
    });

    if (embeddedDiscount > 0) {
      rows.push({
        lineNo: "",
        charge: "Discount",
        description: embeddedDiscountDescription(line),
        reference: line.reference || "-",
        date: line.occurredOn || "-",
        quantity: embeddedDiscountQuantity(line),
        rate: "-",
        amount: -Math.abs(embeddedDiscount),
        discountSource: embeddedDiscountSource(line)
      });
    }
  });

  return rows;
}

function buildStorageSegmentDetailRows(segmentRows: StorageSegmentRow[]) {
  const rows: StorageSegmentDetailRow[] = [];

  aggregateStorageSegmentRows(segmentRows).forEach((segment, index) => {
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

function getEmbeddedDiscountAmount(line: BillingInvoiceLineData) {
  return Math.max(0, roundCurrency(line.details?.discountAmount ?? 0));
}

function getLineQuantity(line: BillingInvoiceLineData) {
  if (line.details?.kind === "STORAGE_CONTAINER_SUMMARY") {
    return formatQuantityWithUnit(line.details.palletDays, "pallet-days");
  }
  return formatQuantityWithUnit(line.quantity, quantityUnitForChargeType(line.chargeType));
}

function embeddedDiscountDescription(line: BillingInvoiceLineData) {
  if (line.details?.kind === "STORAGE_CONTAINER_SUMMARY") {
    return "Storage grace period";
  }
  return "Line discount";
}

function embeddedDiscountQuantity(line: BillingInvoiceLineData) {
  if (line.details?.kind === "STORAGE_CONTAINER_SUMMARY" && (line.details.discountAmount ?? 0) > 0) {
    return `${formatNumber(line.details.freePalletDays ?? 0)} free pallet-days`;
  }
  return "Discount";
}

function embeddedDiscountSource(line: BillingInvoiceLineData) {
  if (line.details?.kind === "STORAGE_CONTAINER_SUMMARY") {
    return "Storage grace period";
  }
  return "Line-level discount";
}

function discountLineSourceLabel(line: BillingInvoiceLineData) {
  return line.sourceType === "AUTO" ? "Automatic discount line" : "Manual discount line";
}

function quantityUnitForChargeType(chargeType: string) {
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
  if (unit === "discount") {
    return value === 1 ? "1 discount" : `${formatted} discounts`;
  }
  if (unit === "pallet-days") {
    return `${formatted} pallet-days`;
  }
  const singular = Math.abs(value) === 1;
  return `${formatted} ${singular ? unit.replace(/s$/, "") : unit}`;
}

function chargeTypeLabel(chargeType: string) {
  switch (chargeType) {
    case "INBOUND":
      return "Inbound Charges";
    case "WRAPPING":
      return "Wrapping Charges";
    case "STORAGE":
      return "Storage Charges";
    case "OUTBOUND":
      return "Outbound Charges";
    case "MANUAL":
      return "Manual Charges";
    default:
      return chargeType;
  }
}

function chargeTypeDetailLabel(chargeType: string) {
  switch (chargeType) {
    case "INBOUND":
      return "Inbound";
    case "WRAPPING":
      return "Wrapping";
    case "STORAGE":
      return "Storage";
    case "OUTBOUND":
      return "Outbound";
    case "MANUAL":
      return "Manual";
    default:
      return chargeType;
  }
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

function invoiceHeaderRow(label: string, value: string): TableCell[] {
  return [
    { text: label, style: "metaLabel", alignment: "right", margin: [0, 0, 8, 2] },
    { text: value, style: "metaValue", alignment: "right", margin: [0, 0, 0, 2] }
  ];
}

function buildFileName(invoiceNo: string) {
  return `${invoiceNo}.pdf`;
}

function invoiceTypeLabel(invoiceType: BillingInvoiceType) {
  return invoiceType === "STORAGE_SETTLEMENT" ? "Storage Settlement" : "Mixed";
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function getInvoiceDate(invoice: BillingInvoice) {
  return invoice.finalizedAt || invoice.createdAt;
}

function getDueDate(invoiceDate: string, paymentDueDays: number) {
  const parsed = new Date(invoiceDate);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  parsed.setDate(parsed.getDate() + paymentDueDays);
  return parsed.toISOString();
}

function getInvoiceHeader(invoice: BillingInvoice): BillingInvoice["header"] {
  const header = invoice.header as Partial<BillingInvoice["header"]> | undefined;
  if (!header) {
    return DEFAULT_BILLING_INVOICE_HEADER;
  }
  return {
    sellerName: typeof header.sellerName === "string" ? header.sellerName.trim() : DEFAULT_BILLING_INVOICE_HEADER.sellerName,
    subtitle: typeof header.subtitle === "string" ? header.subtitle.trim() : DEFAULT_BILLING_INVOICE_HEADER.subtitle,
    remitTo: typeof header.remitTo === "string" ? header.remitTo.trim() : DEFAULT_BILLING_INVOICE_HEADER.remitTo,
    terms: typeof header.terms === "string" ? header.terms.trim() : DEFAULT_BILLING_INVOICE_HEADER.terms,
    paymentDueDays: typeof header.paymentDueDays === "number" && Number.isFinite(header.paymentDueDays) && header.paymentDueDays >= 0
      ? Math.round(header.paymentDueDays)
      : DEFAULT_BILLING_INVOICE_HEADER.paymentDueDays,
    paymentInstructions: typeof header.paymentInstructions === "string"
      ? header.paymentInstructions.trim()
      : DEFAULT_BILLING_INVOICE_HEADER.paymentInstructions
  };
}

function formatInvoiceDate(value: string, timeZone: string) {
  return formatDateTimeValue(value, timeZone, { dateStyle: "medium" });
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
