import * as pdfMake from "pdfmake/build/pdfmake";
import type { Content, CustomTableLayout, Style, TableCell, TDocumentDefinitions, TFontDictionary } from "pdfmake/interfaces";

import { formatDateTimeValue } from "./dates";
import type { BillingExportMode, BillingInvoice, BillingInvoiceLineData, BillingInvoiceType } from "./types";

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
  }
};

export type BillingInvoicePdfInput = {
  invoice: BillingInvoice;
  timeZone: string;
  exportMode?: BillingExportMode;
};

export function downloadBillingInvoicePdf({ invoice, timeZone, exportMode = "SUMMARY" }: BillingInvoicePdfInput) {
  const definition = buildBillingInvoicePdfDefinition({ invoice, timeZone, exportMode });
  const tableLayouts = { [BILLING_TABLE_LAYOUT_NAME]: BILLING_TABLE_LAYOUT };
  void pdfMake.createPdf(definition, tableLayouts, PDF_FONTS).download(buildFileName(invoice.invoiceNo, exportMode));
}

export function buildBillingInvoicePdfDefinition({ invoice, timeZone, exportMode = "SUMMARY" }: BillingInvoicePdfInput): TDocumentDefinitions {
  const storageGraceDiscount = sumStorageGraceDiscount(invoice.lines);
  const metaRows: TableCell[][] = [
    [
      metaBlock("Customer", invoice.customerNameSnapshot),
      metaBlock("Invoice No.", invoice.invoiceNo),
      metaBlock("Billing Period", `${invoice.periodStart} to ${invoice.periodEnd}`),
      metaBlock("Invoice Type", invoiceTypeLabel(invoice.invoiceType))
    ],
    [
      metaBlock("Status", invoice.status),
      metaBlock("Created", formatDateTimeValue(invoice.createdAt, timeZone)),
      metaBlock("Export", exportMode === "DETAILED" ? "Detailed" : "Summary"),
      metaBlock("Grand Total", formatMoney(invoice.grandTotal))
    ]
  ];

  if (invoice.invoiceType === "STORAGE_SETTLEMENT") {
    metaRows.push([
      metaBlock("Container Type", formatContainerType(invoice.containerType)),
      metaBlock("Warehouse", invoice.warehouseNameSnapshot || "-"),
      metaBlock("Grace Discount", formatDiscountMoney(storageGraceDiscount)),
      metaBlock("", ""),
    ]);
  }

  const content: Content[] = [
    { text: "Billing Invoice", style: "pageTitle", margin: [0, 0, 0, 2] },
    { text: `${invoice.invoiceNo} | ${invoice.customerNameSnapshot}`, style: "pageSubtitle", margin: [0, 0, 0, 8] },
    {
      table: {
        widths: ["*", "*", "*", "*"],
        body: metaRows
      },
      layout: "noBorders",
      margin: [0, 0, 0, 8]
    },
    { text: "Invoice Lines", style: "sectionTitle", margin: [0, 0, 0, 4] },
    {
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: [24, 52, 88, 60, 66, 44, 50, 54, "*"],
        body: [
          [
            headerCell("#"),
            headerCell("Charge"),
            headerCell("Reference"),
            headerCell("Container"),
            headerCell("Warehouse"),
            headerCell("Qty"),
            headerCell("Rate"),
            headerCell("Amount"),
            headerCell("Notes")
          ],
          ...invoice.lines.map((line, index) => ([
            bodyCell(String(index + 1), "tableCellCenter", index),
            bodyCell(line.chargeType, "tableCellCenter", index),
            bodyCell(line.reference || "-", "tableCell", index),
            bodyCell(line.containerNo || "-", "tableCellCenter", index),
            bodyCell(line.warehouse || "-", "tableCell", index),
            bodyCell(formatNumber(line.quantity), "tableCellRight", index),
            bodyCell(formatMoney(line.unitRate), "tableCellRight", index),
            bodyCell(formatMoney(line.amount), "tableCellRight", index),
            bodyCell(line.notes || "-", "tableCell", index)
          ])),
          [
            { text: "Subtotal", style: "tableTotalLabel", colSpan: 7 },
            {}, {}, {}, {}, {}, {},
            { text: formatMoney(invoice.subtotal), style: "tableTotalValue" },
            { text: "", style: "tableCell" }
          ],
          ...(invoice.discountTotal !== 0 ? [[
            { text: "Discount", style: "tableTotalLabel", colSpan: 7 },
            {}, {}, {}, {}, {}, {},
            { text: formatMoney(invoice.discountTotal), style: "tableTotalValue" },
            { text: "", style: "tableCell" }
          ]] : []),
          [
            { text: "Grand Total", style: "tableTotalLabel", colSpan: 7 },
            {}, {}, {}, {}, {}, {},
            { text: formatMoney(invoice.grandTotal), style: "tableTotalValue" },
            { text: "", style: "tableCell" }
          ]
        ]
      },
      layout: BILLING_TABLE_LAYOUT_NAME
    }
  ];

  if (exportMode === "DETAILED" && invoice.invoiceType === "STORAGE_SETTLEMENT") {
    const segmentRows = flattenStorageSettlementSegments(invoice.lines);
    if (segmentRows.length > 0) {
      content.push({ text: "Storage Segment Breakdown", style: "sectionTitle", margin: [0, 8, 0, 4] });
      content.push({
        table: {
          headerRows: 1,
          dontBreakRows: true,
          widths: [50, 62, 52, 52, 36, 34, 42, 48, 52],
          body: [
            [
              headerCell("Container"),
              headerCell("Warehouses"),
              headerCell("Segment Start"),
              headerCell("Segment End"),
              headerCell("Pallets"),
              headerCell("Days"),
              headerCell("Pallet-Days"),
              headerCell("Discount"),
              headerCell("Amount")
            ],
            ...segmentRows.map((row, index) => ([
              bodyCell(row.containerNo, "tableCellCenter", index),
              bodyCell(row.warehouses, "tableCell", index),
              bodyCell(row.startDate, "tableCellCenter", index),
              bodyCell(row.endDate, "tableCellCenter", index),
              bodyCell(formatNumber(row.dayEndPallets), "tableCellRight", index),
              bodyCell(formatNumber(row.billedDays), "tableCellRight", index),
              bodyCell(formatNumber(row.palletDays), "tableCellRight", index),
              bodyCell(formatDiscountMoney(row.discountAmount), "tableCellRight", index),
              bodyCell(formatMoney(row.amount), "tableCellRight", index)
            ]))
          ]
        },
        layout: BILLING_TABLE_LAYOUT_NAME
      });
    }
  }

  if (invoice.notes.trim()) {
    content.push({ text: "Invoice Notes", style: "sectionTitle", margin: [0, 8, 0, 4] });
    content.push({ text: invoice.notes, style: "tableCell" });
  }

  return {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [18, 14, 18, 16],
    info: {
      title: `Billing Invoice ${invoice.invoiceNo}`,
      subject: "Billing Invoice Export",
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
        { text: `Billing Invoice ${invoice.invoiceNo}`, style: "footer" },
        { text: `${currentPage} / ${pageCount}`, alignment: "right", style: "footer" }
      ]
    }),
    content
  };
}

function flattenStorageSettlementSegments(lines: BillingInvoiceLineData[]) {
  return lines.flatMap((line) => {
    if (!line.details || line.details.kind !== "STORAGE_CONTAINER_SUMMARY") {
      return [];
    }
    return line.details.segments.map((segment) => ({
      containerNo: line.containerNo || "-",
      warehouses: line.details?.warehousesTouched.join(", ") || line.warehouse || "-",
      startDate: segment.startDate,
      endDate: segment.endDate,
      dayEndPallets: segment.dayEndPallets,
      billedDays: segment.billedDays,
      palletDays: segment.palletDays,
      discountAmount: segment.discountAmount ?? 0,
      amount: segment.amount
    }));
  });
}

function sumStorageGraceDiscount(lines: BillingInvoiceLineData[]) {
  return lines.reduce((total, line) => total + (line.details?.discountAmount ?? 0), 0);
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

function buildFileName(invoiceNo: string, exportMode: BillingExportMode) {
  return `${invoiceNo}-${exportMode.toLowerCase()}.pdf`;
}

function invoiceTypeLabel(invoiceType: BillingInvoiceType) {
  return invoiceType === "STORAGE_SETTLEMENT" ? "Storage Settlement" : "Mixed";
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

function formatDiscountMoney(value: number) {
  return `-${formatMoney(Math.abs(value))}`;
}

function formatContainerType(containerType: BillingInvoice["containerType"]) {
  if (!containerType) {
    return "-";
  }
  return containerType === "WEST_COAST_TRANSFER" ? "Transfer" : "Normal";
}
