import type { Content, CustomTableLayout, Style, TableCell, TDocumentDefinitions, TFontDictionary } from "pdfmake/interfaces";

import { formatDateTimeValue } from "./dates";
import {
  buildBillingContainerStatementRows,
  buildBillingContainerStatements,
  getUnreconciledBillingPalletMovementContainers,
  type BillingContainerStatement
} from "./billingContainerStatement";
import {
  buildBillingContainerInvoiceItems,
  formatBillingDate,
  getBillingContainerInvoiceTotals,
  getBillingDueDate,
  getBillingInvoiceDate
} from "./billingContainerInvoice";
import { formatDiscountMoney as formatDiscountAmount, formatMoney, formatNumber } from "./formatters";
import { downloadPdfDefinition, getPdfDefinitionBuffer } from "./pdfMakeRuntime";
import { DEFAULT_BILLING_INVOICE_HEADER } from "./settings";
import type {
  BillingInvoice,
  BillingInvoiceLineData,
  BillingInvoiceType
} from "./types";

const BILLING_TABLE_LAYOUT_NAME = "billingInvoiceTable";
const BILLING_RECONCILIATION_LAYOUT_NAME = "billingReconciliationTable";
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

const BILLING_RECONCILIATION_LAYOUT: CustomTableLayout = {
  hLineColor: () => "#dbe5f1",
  vLineColor: () => "#dbe5f1",
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  paddingLeft: () => 2,
  paddingRight: () => 2,
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
  sectionCaption: {
    fontSize: 7,
    color: "#64748b",
    lineHeight: 1.25
  },
  detailLabel: {
    fontSize: 6,
    bold: true,
    color: "#64748b"
  },
  containerTotal: {
    fontSize: 8,
    bold: true,
    color: "#0f2f4d",
    alignment: "right"
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
  },
  invoiceDocumentTitle: {
    fontSize: 20,
    color: "#111827"
  },
  invoiceSellerName: {
    fontSize: 16,
    color: "#111827"
  },
  invoiceNumber: {
    fontSize: 12,
    bold: true,
    color: "#111827"
  },
  invoiceStripLabel: {
    fontSize: 7,
    color: "#111827",
    fillColor: "#bfd5f3",
    alignment: "center"
  },
  invoiceStripValue: {
    fontSize: 8,
    color: "#111827"
  },
  invoiceStripAmount: {
    fontSize: 10,
    bold: true,
    color: "#111827",
    fillColor: "#6fa6ea",
    alignment: "right"
  },
  invoiceItemHeader: {
    fontSize: 7,
    color: "#111827",
    alignment: "center"
  },
  invoiceTotalLabel: {
    fontSize: 8,
    bold: true,
    color: "#111827",
    alignment: "right"
  },
  invoiceTotalValue: {
    fontSize: 9,
    bold: true,
    color: "#111827",
    alignment: "right"
  }
};

export type BillingInvoicePdfInput = {
  invoice: BillingInvoice;
  timeZone: string;
};

export async function downloadBillingInvoicePdf({ invoice, timeZone }: BillingInvoicePdfInput) {
  const definition = buildBillingInvoicePdfDefinition({ invoice, timeZone });
  await downloadPdfDefinition(definition, buildBillingTableLayouts(), PDF_FONTS, buildFileName(invoice.invoiceNo));
}

export function renderBillingPdfDefinitionBuffer(definition: TDocumentDefinitions) {
  return getPdfDefinitionBuffer(definition, buildBillingTableLayouts(), PDF_FONTS);
}

function buildBillingTableLayouts() {
  return {
    [BILLING_TABLE_LAYOUT_NAME]: BILLING_TABLE_LAYOUT,
    [BILLING_RECONCILIATION_LAYOUT_NAME]: BILLING_RECONCILIATION_LAYOUT
  };
}

export function buildBillingInvoicePdfDefinition({ invoice, timeZone }: BillingInvoicePdfInput): TDocumentDefinitions {
  const header = getInvoiceHeader(invoice);
  const visibleLines = [...filterVisibleInvoiceLines(invoice.lines)].sort(compareInvoiceLinesByContainer);
  const totals = getBillingInvoiceDisplayTotals(invoice);
  const chargeSummaryRows = buildChargeSummaryRows(visibleLines);
  const discountSourceRows = buildDiscountSourceRows(visibleLines);
  const containerDetails = buildBillingContainerStatements(invoice);
  assertBillingPalletMovementsReconcile(containerDetails);
  const containerStatementRows = buildBillingContainerStatementRows(invoice, containerDetails);
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
    { text: "Amount Summary", style: "sectionTitle", margin: [0, 0, 0, 2] },
    { text: "Charges are grouped by service type. Discounts are shown separately from gross charges.", style: "sectionCaption", margin: [0, 0, 0, 5] },
    buildAmountSummaryTable(totals, chargeSummaryRows),
    ...(discountSourceRows.length > 0 ? [buildDiscountDetail(discountSourceRows)] : [])
  ];

  if (header.paymentInstructions) {
    content.push({ text: header.paymentInstructions, style: "pageSubtitle", margin: [0, 6, 0, 0] });
  }

  content.push({
    text: "Container Reconciliation",
    style: "sectionTitle",
    margin: [0, 0, 0, 2],
    pageBreak: "before",
    pageOrientation: "landscape"
  });
  content.push({
    text: "Each row is a complete container statement. Fee columns add to the container total, and all container totals add to the invoice amount due.",
    style: "sectionCaption",
    margin: [0, 0, 0, 5]
  });
  content.push(buildContainerReconciliationTable(containerDetails));

  if (containerStatementRows.some((row) => row.segmentStartDate || row.releaseDate)) {
    content.push({ text: "Container Storage Detail", style: "sectionTitle", margin: [0, 0, 0, 2], pageBreak: "before", pageOrientation: "landscape" });
    content.push({ text: "Storage charges are grouped into periods where the day-end pallet balance stays the same.", style: "sectionCaption", margin: [0, 0, 0, 5] });
    content.push(buildContainerStorageDetailTable(containerStatementRows));
  }

  if (visibleLines.length > 0) {
    content.push({ text: "Line Item Detail", style: "sectionTitle", margin: [0, 0, 0, 2], pageBreak: "before", pageOrientation: "landscape" });
    content.push({ text: "Supporting source lines are ordered by container for audit and document tracing.", style: "sectionCaption", margin: [0, 0, 0, 5] });
    content.push(buildLineDetailTable(visibleLines, invoice.rates.transferInboundFeePerPallet));
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

export type BillingContainerReconciliationPdfInput = BillingInvoicePdfInput & {
  containerNo: string;
  statement?: BillingContainerStatement;
  sourceLines?: BillingInvoiceLineData[];
};

export function buildBillingContainerReconciliationPdfDefinition({
  invoice,
  containerNo,
  timeZone,
  statement: providedStatement
}: BillingContainerReconciliationPdfInput): TDocumentDefinitions {
  const normalizedContainerNo = normalizeContainerNo(containerNo);
  const statement = providedStatement ?? buildBillingContainerStatements(invoice).find((candidate) =>
    normalizeContainerNo(candidate.containerNo) === normalizedContainerNo
  );
  if (!statement) {
    throw new Error(`Container billing detail not found: ${containerNo || "Invoice-level"}`);
  }
  if (normalizeContainerNo(statement.containerNo) !== normalizedContainerNo) {
    throw new Error(`Container billing detail does not match: ${containerNo || "Invoice-level"}`);
  }
  assertBillingPalletMovementsReconcile([statement]);

  const header = getInvoiceHeader(invoice);
  const statementLabel = statement.containerNo || "Invoice-level Adjustments";
  const invoiceDate = getBillingInvoiceDate(invoice);
  const dueDate = getBillingDueDate(invoiceDate, header.paymentDueDays);
  const items = buildBillingContainerInvoiceItems(invoice, statement);
  const totals = getBillingContainerInvoiceTotals(items);
  const content: Content[] = [
    buildContainerStatementHeader(invoice, statement, header),
    buildContainerInvoiceMetaStrip(invoice, statement, invoiceDate, dueDate, timeZone),
    buildContainerInvoiceContext(invoice, statement),
    buildSingleContainerFeeTable(items, totals)
  ];

  if (statement.containerNo && statement.palletMovementAvailable) {
    content.push({ text: "PALLET ACTIVITY", style: "sectionTitle", margin: [0, 14, 0, 5] });
    content.push(buildSingleContainerPalletTable(statement));
  }

  if (statement.storageSegments.length > 0) {
    content.push({ text: "STORAGE DETAIL", style: "sectionTitle", margin: [0, 14, 0, 5] });
    content.push(buildSingleContainerStorageTable(statement));
  }

  return {
    pageSize: "LETTER",
    pageOrientation: "portrait",
    pageMargins: [36, 36, 36, 36],
    info: {
      title: `${invoice.invoiceNo} - ${statementLabel}`,
      subject: "Container Invoice",
      author: header.sellerName
    },
    defaultStyle: {
      font: CJK_FONT_NAME,
      fontSize: 8,
      color: "#102a43"
    },
    styles,
    content
  };
}

function buildContainerStatementHeader(
  invoice: BillingInvoice,
  statement: BillingContainerStatement,
  header: BillingInvoice["header"]
): Content {
  const statementLabel = statement.containerNo || "Invoice-level Adjustments";
  return {
    columns: [
      {
        width: "*",
        stack: [
          { text: header.sellerName, style: "invoiceSellerName", margin: [0, 0, 0, 6] },
          { text: header.subtitle, style: "pageSubtitle" }
        ]
      },
      {
        width: 180,
        stack: [
          { text: "Invoice#", style: "invoiceDocumentTitle", alignment: "right", margin: [0, 0, 0, 4] },
          { text: invoice.invoiceNo, style: "invoiceNumber", alignment: "right", margin: [0, 0, 0, 4] },
          { text: statementLabel, style: "pageSubtitle", alignment: "right" }
        ]
      }
    ],
    columnGap: 24,
    margin: [0, 0, 0, 18]
  };
}

function buildSingleContainerFeeTable(
  items: ReturnType<typeof buildBillingContainerInvoiceItems>,
  totals: ReturnType<typeof getBillingContainerInvoiceTotals>
): Content {
  const body: TableCell[][] = [[
    { text: "ITEM", style: "invoiceItemHeader" },
    { text: "DESCRIPTION", style: "invoiceItemHeader" },
    { text: "QTY", style: "invoiceItemHeader" },
    { text: "RATE", style: "invoiceItemHeader" },
    { text: "AMOUNT", style: "invoiceItemHeader" }
  ]];
  items.forEach((item, index) => {
    body.push([
      bodyCell(item.item, "tableCell", index),
      bodyCell(item.description, "tableCell", index),
      bodyCell(formatNumber(item.quantity), "tableCellRight", index),
      bodyCell(formatRateMoney(item.rate), "tableCellRight", index),
      bodyCell(formatMoney(item.amount), "tableCellRight", index)
    ]);
  });
  body.push([{}, {}, {}, { text: "SUBTOTAL", style: "invoiceTotalLabel" }, { text: formatMoney(totals.subtotal), style: "invoiceTotalValue" }]);
  if (totals.discount !== 0) {
    body.push([{}, {}, {}, { text: "DISCOUNT", style: "invoiceTotalLabel" }, { text: formatMoney(totals.discount), style: "invoiceTotalValue" }]);
  }
  body.push([{}, {}, {}, { text: "TOTAL", style: "invoiceTotalLabel" }, { text: formatMoney(totals.total), style: "invoiceTotalValue" }]);

  return {
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths: [72, "*", 54, 66, 74],
      body
    },
    layout: BILLING_TABLE_LAYOUT_NAME
  };
}

function buildContainerInvoiceMetaStrip(
  invoice: BillingInvoice,
  statement: BillingContainerStatement,
  invoiceDate: string,
  dueDate: string | null,
  timeZone: string
): Content {
  return {
    table: {
      widths: ["*", 86, 96, 86],
      body: [
        [
          { text: "BILL TO", style: "invoiceStripLabel", alignment: "left" },
          { text: "DATE", style: "invoiceStripLabel" },
          { text: "AMOUNT DUE", style: "invoiceStripLabel" },
          { text: "DUE DATE", style: "invoiceStripLabel" }
        ],
        [
          { text: invoice.customerNameSnapshot, style: "invoiceStripValue" },
          { text: formatBillingDate(invoiceDate, timeZone), style: "invoiceStripValue", alignment: "center" },
          { text: formatMoney(statement.totalAmount), style: "invoiceStripAmount" },
          { text: dueDate ? formatBillingDate(dueDate, timeZone) : "-", style: "invoiceStripValue", alignment: "center" }
        ]
      ]
    },
    layout: BILLING_TABLE_LAYOUT_NAME,
    margin: [0, 0, 0, 12]
  };
}

function buildContainerInvoiceContext(invoice: BillingInvoice, statement: BillingContainerStatement): Content {
  const statementLabel = statement.containerNo || "Invoice-level Adjustments";
  return {
    table: {
      widths: [72, "*", 86, 112],
      body: [
        [
          { text: "CONTAINER", style: "invoiceStripLabel" },
          { text: statementLabel, style: "invoiceStripValue" },
          { text: "BILLING PERIOD", style: "invoiceStripLabel" },
          { text: `${invoice.periodStart} to ${invoice.periodEnd}`, style: "invoiceStripValue", alignment: "center" }
        ],
        [
          { text: "RECEIVED", style: "invoiceStripLabel" },
          { text: statement.receivedOn || "-", style: "invoiceStripValue", colSpan: 3 },
          {},
          {}
        ]
      ]
    },
    layout: BILLING_TABLE_LAYOUT_NAME,
    margin: [0, 0, 0, 14]
  };
}

function buildSingleContainerPalletTable(statement: BillingContainerStatement): Content {
  const releaseEvents = statement.releaseEvents.length > 0
    ? statement.releaseEvents.map((event) => `${event.date}: ${formatNumber(event.pallets)} pallets`).join("\n")
    : "No pallet release during this period";
  return {
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths: [70, 70, 70, 70, "*"],
      body: [
        [
          headerCell("Opening Pallets"),
          headerCell("Received Pallets"),
          headerCell("Released Pallets"),
          headerCell("Closing Pallets"),
          headerCell("Release Activity")
        ],
        [
          bodyCell(formatNumber(statement.openingPallets), "tableCellRight"),
          bodyCell(formatNumber(statement.receivedPallets), "tableCellRight"),
          bodyCell(formatNumber(statement.releasedPallets), "tableCellRight"),
          bodyCell(formatNumber(statement.closingPallets), "tableCellRight"),
          bodyCell(releaseEvents)
        ]
      ]
    },
    layout: BILLING_TABLE_LAYOUT_NAME
  };
}

function buildSingleContainerStorageTable(statement: BillingContainerStatement): Content {
  const body: TableCell[][] = [[
    headerCell("Period"),
    headerCell("Pallets"),
    headerCell("Days"),
    headerCell("Pallet-Days"),
    headerCell("Free"),
    headerCell("Billable"),
    headerCell("Amount")
  ]];
  statement.storageSegments.forEach((segment, index) => {
    body.push([
      bodyCell(`${segment.startDate} to ${segment.endDate}`, "tableCellCenter", index),
      bodyCell(formatNumber(segment.dayEndPallets), "tableCellRight", index),
      bodyCell(formatNumber(segment.billedDays), "tableCellRight", index),
      bodyCell(formatNumber(segment.palletDays), "tableCellRight", index),
      bodyCell(formatNumber(segment.freePalletDays ?? 0), "tableCellRight", index),
      bodyCell(formatNumber(segment.billablePalletDays ?? segment.palletDays), "tableCellRight", index),
      bodyCell(formatMoney(segment.amount), "tableCellRight", index)
    ]);
  });

  return {
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths: [112, 56, 42, 66, 58, 64, 72],
      body
    },
    layout: BILLING_TABLE_LAYOUT_NAME
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
  chargeRows: ChargeSummaryRow[]
): Content {
  const showDiscounts = totals.discountTotal !== 0
    || chargeRows.some((row) => row.discountAmount !== 0);
  const summaryRows = buildAmountSummaryChargeRows(chargeRows, showDiscounts);
  if (!showDiscounts) {
    const body: TableCell[][] = [
      [
        headerCell("Summary Item"),
        headerCell("Basis / Source"),
        headerCell("Amount")
      ],
      ...summaryRows,
      [
        { text: "Amount Due", style: "amountDueLabel" },
        { text: "", style: "amountDueValue" },
        { text: formatMoney(totals.grandTotal), style: "amountDueValue" }
      ]
    ];

    return {
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: [118, "*", 82],
        body
      },
      layout: BILLING_TABLE_LAYOUT_NAME
    };
  }

  const body: TableCell[][] = [
    [
      headerCell("Summary Item"),
      headerCell("Basis / Source"),
      headerCell("Gross Charges"),
      headerCell("Discounts"),
      headerCell("Net Amount")
    ],
    ...summaryRows,
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

function buildDiscountDetail(rows: DiscountSourceRow[]): Content {
  return {
    stack: [
      { text: "Discount Detail", style: "detailLabel", margin: [0, 0, 0, 3] },
      {
        table: {
          widths: [105, "*", 62],
          body: rows.map((row, index): TableCell[] => [
            bodyCell(row.source, "tableCell", index),
            bodyCell(`${row.basis}${row.reference !== "-" ? ` | ${row.reference}` : ""}`, "tableCell", index),
            bodyCell(formatDiscountAmount(row.amount), "tableCellRight", index)
          ])
        },
        layout: "lightHorizontalLines"
      }
    ],
    margin: [0, 7, 0, 0]
  };
}

function buildContainerReconciliationTable(details: BillingContainerStatement[]): Content {
  const body: TableCell[][] = [[
    reconciliationHeaderCell("Container"),
    reconciliationHeaderCell("Received"),
    reconciliationHeaderCell("Warehouse"),
    reconciliationHeaderCell("Opening"),
    reconciliationHeaderCell("Received\nPallets"),
    reconciliationHeaderCell("Released"),
    reconciliationHeaderCell("Closing"),
    reconciliationHeaderCell("Billable\nPallet-Days"),
    reconciliationHeaderCell("Inbound"),
    reconciliationHeaderCell("Wrapping"),
    reconciliationHeaderCell("Outbound"),
    reconciliationHeaderCell("Storage\nGross"),
    reconciliationHeaderCell("Storage\nDiscount"),
    reconciliationHeaderCell("Storage\nNet"),
    reconciliationHeaderCell("Adjustments"),
    reconciliationHeaderCell("Container\nTotal")
  ]];

  details.forEach((detail, index) => {
    body.push([
      bodyCell(detail.containerNo || "Invoice-level", "tableCell", index),
      bodyCell(detail.receivedOn || "-", "tableCellCenter", index),
      bodyCell(detail.warehouses.join(", ") || "-", "tableCell", index),
      bodyCell(detail.palletMovementAvailable ? formatNumber(detail.openingPallets) : "-", "tableCellRight", index),
      bodyCell(detail.palletMovementAvailable ? formatNumber(detail.receivedPallets) : "-", "tableCellRight", index),
      bodyCell(detail.palletMovementAvailable ? formatNumber(detail.releasedPallets) : "-", "tableCellRight", index),
      bodyCell(detail.palletMovementAvailable ? formatNumber(detail.closingPallets) : "-", "tableCellRight", index),
      bodyCell(formatNumber(detail.billablePalletDays), "tableCellRight", index),
      bodyCell(formatMoneyOrDash(detail.inboundAmount), "tableCellRight", index),
      bodyCell(formatMoneyOrDash(detail.wrappingAmount), "tableCellRight", index),
      bodyCell(formatMoneyOrDash(detail.outboundAmount), "tableCellRight", index),
      bodyCell(formatMoneyOrDash(detail.storageGrossAmount), "tableCellRight", index),
      bodyCell(detail.storageDiscountAmount > 0 ? formatDiscountAmount(detail.storageDiscountAmount) : "-", "tableCellRight", index),
      bodyCell(formatMoneyOrDash(detail.storageAmount), "tableCellRight", index),
      bodyCell(formatMoneyOrDash(detail.adjustmentAmount), "tableCellRight", index),
      bodyCell(formatMoney(detail.totalAmount), "containerTotal", index)
    ]);
  });

  if (details.length === 0) {
    body.push([{ text: "No container billing detail", colSpan: 16, alignment: "center" }, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}]);
  } else {
    body.push([
      { text: "Invoice Total", colSpan: 15, style: "tableTotalLabel", alignment: "right" },
      {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {},
      {
        text: formatMoney(roundCurrency(details.reduce((total, detail) => total + detail.totalAmount, 0))),
        style: "tableTotalValue"
      }
    ]);
  }

  return {
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths: [58, 42, 42, 28, 33, 30, 28, 46, 38, 38, 38, 42, 40, 42, 38, 46],
      body
    },
    layout: BILLING_RECONCILIATION_LAYOUT_NAME
  };
}

function buildContainerStorageDetailTable(rows: ReturnType<typeof buildBillingContainerStatementRows>): Content {
  const body: TableCell[][] = [[
    headerCell("Container / Received"),
    headerCell("Pallet Activity"),
    headerCell("Storage Period"),
    headerCell("Daily Pallets"),
    headerCell("Days"),
    headerCell("Billable Pallet-Days"),
    headerCell("Gross / Discount"),
    headerCell("Net Storage")
  ]];

  rows.forEach((row, index) => {
    const container = [row.containerNo || "", row.receivedOn || ""].filter(Boolean).join("\n");
    const activity = [
      row.openingPallets === null ? "" : `${formatNumber(row.openingPallets)} opening`,
      row.receivedPallets === null ? "" : `${formatNumber(row.receivedPallets)} received`,
      row.releasedPallets === null ? "" : `${formatNumber(row.releasedPallets)} released${row.releaseDate ? ` on ${row.releaseDate}` : ""}`,
      row.closingPallets === null ? "" : `${formatNumber(row.closingPallets)} closing`
    ].filter(Boolean).join("\n") || "-";
    const period = row.segmentStartDate
      ? `${row.segmentStartDate}\nto ${row.segmentEndDate}`
      : "-";
    const grossAndDiscount = row.storageGrossAmount === null
      ? "-"
      : [
        `${formatMoney(row.storageGrossAmount)} gross`,
        (row.storageDiscountAmount ?? 0) > 0 ? `${formatDiscountAmount(row.storageDiscountAmount ?? 0)} discount` : ""
      ].filter(Boolean).join("\n");
    body.push([
      bodyCell(container, "tableCell", index),
      bodyCell(activity, "tableCellRight", index),
      bodyCell(period, "tableCellCenter", index),
      bodyCell(row.palletsOnHand === null ? "-" : formatNumber(row.palletsOnHand), "tableCellRight", index),
      bodyCell(row.billedDays === null ? "-" : formatNumber(row.billedDays), "tableCellRight", index),
      bodyCell(row.billablePalletDays === null ? "-" : formatNumber(row.billablePalletDays), "tableCellRight", index),
      bodyCell(grossAndDiscount, "tableCellRight", index),
      bodyCell(row.storageFee === null ? "-" : formatMoney(row.storageFee), "tableCellRight", index)
    ]);
  });

  return {
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths: [76, 78, 70, 48, 34, 62, 72, 58],
      body
    },
    layout: BILLING_TABLE_LAYOUT_NAME
  };
}

function buildAmountSummaryChargeRows(
  chargeRows: ChargeSummaryRow[],
  showDiscounts: boolean
) {
  const rows: TableCell[][] = [];
  for (const chargeRow of chargeRows) {
    rows.push(showDiscounts
      ? [
        bodyCell(chargeRow.chargeType, "tableCell", rows.length),
        bodyCell(chargeSummaryBasis(chargeRow), "tableCell", rows.length),
        bodyCell(formatMoney(chargeRow.grossAmount), "tableCellRight", rows.length),
        bodyCell(formatDiscountAmount(chargeRow.discountAmount), "tableCellRight", rows.length),
        bodyCell(formatMoney(chargeRow.netAmount), "tableCellRight", rows.length)
      ]
      : [
        bodyCell(chargeRow.chargeType, "tableCell", rows.length),
        bodyCell(chargeSummaryBasis(chargeRow), "tableCell", rows.length),
        bodyCell(formatMoney(chargeRow.netAmount), "tableCellRight", rows.length)
      ]);
  }
  return rows;
}

function chargeSummaryBasis(row: ChargeSummaryRow) {
  if (row.chargeType === "Storage Charges" && row.billablePalletDays > 0) {
    return `${formatNumber(row.billablePalletDays)} billable pallet-days across ${formatCount(row.containerCount, "container")}`;
  }
  return `${formatCount(row.lineCount, "source line")} across ${formatCount(row.containerCount, "container")}`;
}

function formatCount(value: number, label: string) {
  return `${formatNumber(value)} ${value === 1 ? label : `${label}s`}`;
}

function buildLineDetailTable(lines: BillingInvoiceLineData[], transferInboundFeePerPallet?: number): Content {
  const rows = buildLineDetailRows(lines, transferInboundFeePerPallet);
  const showDiscountSource = rows.some((row) => row.discountSource && row.discountSource !== "-");

  return {
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths: showDiscountSource
        ? [16, 58, 42, "*", 50, 40, 50, 40, 48, 64]
        : [16, 62, 46, "*", 54, 42, 52, 42, 50],
      body: [
        ([
          headerCell("#"),
          headerCell("Container"),
          headerCell("Charge"),
          headerCell("Description"),
          headerCell("Reference"),
          headerCell("Service Date"),
          headerCell("Qty / Basis"),
          headerCell("Unit Rate"),
          headerCell("Amount"),
          ...(showDiscountSource ? [headerCell("Discount Source")] : [])
        ]),
        ...rows.map((row, index) => ([
          bodyCell(row.lineNo, "tableCellCenter", index),
          bodyCell(row.containerNo, "tableCell", index),
          bodyCell(row.charge, "tableCellCenter", index),
          bodyCell(row.description, "tableCell", index),
          bodyCell(row.reference, "tableCell", index),
          bodyCell(row.date, "tableCellCenter", index),
          bodyCell(row.quantity, "tableCellRight", index),
          bodyCell(row.rate, "tableCellRight", index),
          bodyCell(formatMoney(row.amount), "tableCellRight", index),
          ...(showDiscountSource ? [bodyCell(row.discountSource, "tableCell", index)] : [])
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
  lineCount: number;
  containerCount: number;
  billablePalletDays: number;
};

type ChargeSummaryAccumulator = Omit<ChargeSummaryRow, "containerCount"> & {
  containerNos: Set<string>;
};

type DiscountSourceRow = {
  source: string;
  reference: string;
  basis: string;
  amount: number;
};

type LineDetailRow = {
  lineNo: string;
  containerNo: string;
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
  const rows = new Map<string, ChargeSummaryAccumulator>();
  for (const line of lines) {
    if (line.chargeType === "DISCOUNT") {
      continue;
    }
    const chargeType = chargeTypeLabel(line.chargeType);
    const existing = rows.get(chargeType) ?? {
      chargeType,
      grossAmount: 0,
      discountAmount: 0,
      netAmount: 0,
      lineCount: 0,
      billablePalletDays: 0,
      containerNos: new Set<string>()
    };
    const discountAmount = line.details?.discountAmount ?? 0;
    existing.grossAmount = roundCurrency(existing.grossAmount + line.amount + discountAmount);
    existing.discountAmount = roundCurrency(existing.discountAmount + discountAmount);
    existing.netAmount = roundCurrency(existing.netAmount + line.amount);
    existing.lineCount += 1;
    existing.billablePalletDays += line.details?.billablePalletDays ?? 0;
    const containerNo = line.containerNo.trim().toUpperCase();
    if (containerNo) existing.containerNos.add(containerNo);
    rows.set(chargeType, existing);
  }

  return [...rows.values()].map(({ containerNos, ...row }) => ({
    ...row,
    billablePalletDays: roundQuantity(row.billablePalletDays),
    containerCount: containerNos.size
  }));
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

function buildLineDetailRows(lines: BillingInvoiceLineData[], transferInboundFeePerPallet?: number) {
  const rows: LineDetailRow[] = [];

  filterVisibleInvoiceLines(lines).forEach((line, index) => {
    const containerNo = line.containerNo.trim().toUpperCase() || "Invoice-level";
    if (line.chargeType === "DISCOUNT") {
      rows.push({
        lineNo: String(index + 1),
        containerNo,
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
      containerNo,
      charge: chargeTypeDetailLabel(line.chargeType),
      description: line.description || "-",
      reference: line.reference || "-",
      date: line.occurredOn || "-",
      quantity: getLineQuantity(line, transferInboundFeePerPallet),
      rate: formatMoney(line.unitRate),
      amount: roundCurrency(line.amount + embeddedDiscount),
      discountSource: "-"
    });

    if (embeddedDiscount > 0) {
      rows.push({
        lineNo: "",
        containerNo,
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

function compareInvoiceLinesByContainer(left: BillingInvoiceLineData, right: BillingInvoiceLineData) {
  const leftContainer = normalizeContainerNo(left.containerNo);
  const rightContainer = normalizeContainerNo(right.containerNo);
  if (!leftContainer || !rightContainer) {
    if (leftContainer !== rightContainer) return leftContainer ? -1 : 1;
  }
  if (leftContainer !== rightContainer) return leftContainer.localeCompare(rightContainer);
  if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
  return left.id - right.id;
}

function normalizeContainerNo(value: string) {
  return value.trim().toUpperCase();
}

function assertBillingPalletMovementsReconcile(statements: BillingContainerStatement[]) {
  const containers = getUnreconciledBillingPalletMovementContainers(statements);
  if (containers.length > 0) {
    throw new Error(
      `Cannot export billing documents because received pallet movement does not reconcile for: ${containers.join(", ")}.`
    );
  }
}

function filterVisibleInvoiceLines(lines: BillingInvoiceLineData[]) {
  return lines.filter(isVisibleInvoiceLine);
}

function isVisibleInvoiceLine(line: BillingInvoiceLineData) {
  return line.chargeType !== "DISCOUNT" || roundCurrency(line.amount) !== 0;
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

function getLineQuantity(line: BillingInvoiceLineData, transferInboundFeePerPallet?: number) {
  if (line.details?.kind === "STORAGE_CONTAINER_SUMMARY") {
    return formatQuantityWithUnit(line.details.palletDays, "pallet-days");
  }
  return formatQuantityWithUnit(line.quantity, quantityUnitForLine(line, transferInboundFeePerPallet));
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

function quantityUnitForLine(line: BillingInvoiceLineData, transferInboundFeePerPallet?: number) {
  if (line.chargeType === "INBOUND" && isTransferInboundLine(line, transferInboundFeePerPallet)) {
    return "pallets";
  }
  return quantityUnitForChargeType(line.chargeType);
}

function isTransferInboundLine(line: BillingInvoiceLineData, transferInboundFeePerPallet?: number) {
  if (/\btransfer pallets?\b/i.test(`${line.description} ${line.reference} ${line.notes}`)) {
    return true;
  }
  return typeof transferInboundFeePerPallet === "number"
    && transferInboundFeePerPallet > 0
    && numbersClose(line.unitRate, transferInboundFeePerPallet)
    && !numbersClose(line.quantity, 1);
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

function reconciliationHeaderCell(text: string): TableCell {
  return { text, style: "tableHeader", fontSize: 6, margin: [0, 1, 0, 1], noWrap: false };
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

function formatMoneyOrDash(value: number) {
  return roundCurrency(value) === 0 ? "-" : formatMoney(value);
}

function formatRateMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 8
  }).format(value);
}

function roundQuantity(value: number) {
  return Math.round(value * 10_000) / 10_000;
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
