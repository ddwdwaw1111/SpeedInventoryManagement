import { formatDateTimeValue } from "./dates";
import {
  buildExcelWorkbookBytes,
  type ExcelExportCell,
  type ExcelExportColumn,
  type ExcelExportSummaryRow
} from "./excelExport";
import type { BillingContainerStatement } from "./billingContainerStatement";
import type { BillingInvoice } from "./types";

export type BillingContainerInvoiceItem = {
  item: string;
  description: string;
  quantity: number;
  rate: number;
  amount: number;
  isDiscount?: boolean;
};

export type BillingContainerInvoiceTotals = {
  subtotal: number;
  discount: number;
  total: number;
};

export function buildBillingContainerInvoiceItems(
  invoice: BillingInvoice,
  statement: BillingContainerStatement
): BillingContainerInvoiceItem[] {
  const items: BillingContainerInvoiceItem[] = [];

  addCharge(items, {
    item: "INBOUND",
    description: statement.receivedOn
      ? `Container receiving | ${statement.receivedOn}`
      : "Container receiving",
    quantity: statement.inboundUnits,
    amount: statement.inboundAmount
  });
  addCharge(items, {
    item: "WRAPPING",
    description: `${formatQuantity(statement.wrappingPallets)} inventory pallets wrapped`,
    quantity: statement.wrappingPallets,
    amount: statement.wrappingAmount
  });
  addCharge(items, {
    item: "OUTBOUND",
    description: `${formatQuantity(statement.outboundPallets)} outbound pallets shipped`,
    quantity: statement.outboundPallets,
    amount: statement.outboundAmount
  });

  addCharge(items, {
    item: "STORAGE",
    description: `${invoice.periodStart} to ${invoice.periodEnd} | ${formatQuantity(statement.billablePalletDays)} billable pallet-days`,
    quantity: statement.billablePalletDays,
    amount: statement.storageAmount
  });
  addCharge(items, {
    item: statement.containerNo ? "ADJUSTMENT" : "INVOICE ADJUSTMENT",
    description: statement.containerNo ? "Container-level adjustment" : "Invoice-level adjustment",
    quantity: 1,
    amount: statement.adjustmentAmount
  });

  if (items.length === 0) {
    items.push({
      item: "NO CHARGE",
      description: "No billable activity for this statement",
      quantity: 0,
      rate: 0,
      amount: 0
    });
  }

  return items;
}

export function getBillingContainerInvoiceTotals(
  items: BillingContainerInvoiceItem[]
): BillingContainerInvoiceTotals {
  const subtotal = roundCurrency(items
    .filter((item) => !item.isDiscount)
    .reduce((sum, item) => sum + item.amount, 0));
  const discount = roundCurrency(items
    .filter((item) => item.isDiscount)
    .reduce((sum, item) => sum + item.amount, 0));
  return {
    subtotal,
    discount,
    total: roundCurrency(subtotal + discount)
  };
}

export function buildBillingContainerExcelWorkbookBytes({
  invoice,
  statement,
  timeZone
}: {
  invoice: BillingInvoice;
  statement: BillingContainerStatement;
  timeZone: string;
}) {
  const items = buildBillingContainerInvoiceItems(invoice, statement);
  const totals = getBillingContainerInvoiceTotals(items);
  const invoiceDate = getBillingInvoiceDate(invoice);
  const dueDate = getBillingDueDate(invoiceDate, invoice.header.paymentDueDays);
  const containerLabel = statement.containerNo || "Invoice-level Adjustments";
  const columns: ExcelExportColumn[] = [
    { key: "item", label: "ITEM" },
    { key: "description", label: "DESCRIPTION" },
    { key: "quantity", label: "QTY" },
    { key: "rate", label: "RATE", numberFormat: "currencyRate" },
    { key: "amount", label: "AMOUNT", numberFormat: "currency" }
  ];
  const rows: Array<Record<string, ExcelExportCell>> = items.map((item) => ({
    item: item.item,
    description: item.description,
    quantity: item.quantity,
    rate: item.rate,
    amount: item.amount
  }));
  const summaryRows: ExcelExportSummaryRow[] = [
    { label: "SUBTOTAL", value: totals.subtotal, numberFormat: "currency", bold: false },
    ...(totals.discount !== 0
      ? [{ label: "DISCOUNT", value: totals.discount, numberFormat: "currency" as const, bold: false }]
      : []),
    { label: "TOTAL", value: totals.total, numberFormat: "currency", bold: true }
  ];

  return buildExcelWorkbookBytes({
    title: `${invoice.header.sellerName} | ${invoice.invoiceNo} | ${containerLabel}`,
    sheetName: "Container Invoice",
    fileName: `${invoice.invoiceNo}-${containerLabel}`,
    columns,
    rows,
    summaryRows,
    invoiceHeader: {
      sellerName: invoice.header.sellerName,
      subtitle: invoice.header.subtitle,
      invoiceNo: invoice.invoiceNo,
      billTo: invoice.customerNameSnapshot,
      invoiceDate: formatBillingDate(invoiceDate, timeZone),
      dueDate: dueDate ? formatBillingDate(dueDate, timeZone) : "-",
      amountDue: statement.totalAmount,
      containerNo: containerLabel,
      billingPeriod: `${invoice.periodStart} to ${invoice.periodEnd}`,
      receivedOn: statement.receivedOn || "-"
    }
  });
}

export function getBillingInvoiceDate(invoice: BillingInvoice) {
  return invoice.finalizedAt || invoice.createdAt;
}

export function getBillingDueDate(invoiceDate: string, paymentDueDays: number) {
  const parsed = new Date(invoiceDate);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const normalizedDays = Number.isFinite(paymentDueDays) && paymentDueDays >= 0
    ? Math.round(paymentDueDays)
    : 0;
  parsed.setDate(parsed.getDate() + normalizedDays);
  return parsed.toISOString();
}

export function formatBillingDate(value: string, timeZone: string) {
  return formatDateTimeValue(value, timeZone, { dateStyle: "medium" });
}

function addCharge(
  items: BillingContainerInvoiceItem[],
  charge: Omit<BillingContainerInvoiceItem, "rate">
) {
  const amount = roundCurrency(charge.amount);
  if (amount === 0) {
    return;
  }
  const quantity = roundQuantity(charge.quantity);
  const billedQuantity = quantity === 0 ? 1 : quantity;
  items.push({
    ...charge,
    quantity: billedQuantity,
    rate: roundRate(amount / billedQuantity),
    amount
  });
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(value);
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function roundRate(value: number) {
  return Math.round(value * 100_000_000) / 100_000_000;
}

function roundQuantity(value: number) {
  return Math.round(value * 10_000) / 10_000;
}
