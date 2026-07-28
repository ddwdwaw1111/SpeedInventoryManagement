import type {
  BillingInvoice,
  BillingInvoiceContainerDetailData,
  BillingInvoiceLineData
} from "./types";

type ContainerDetailAccumulator = {
  detail: BillingInvoiceContainerDetailData;
  warehouses: Set<string>;
  references: Set<string>;
};

const INVOICE_LEVEL_KEY = "\u0000INVOICE_LEVEL";

/**
 * Uses the server-built snapshot ledger when available. The line-based
 * fallback keeps invoices created by an older backend readable during a
 * rolling deployment.
 */
export function resolveBillingInvoiceContainerDetails(invoice: BillingInvoice) {
  if (Array.isArray(invoice.containerDetails)) {
    return [...invoice.containerDetails].sort(compareContainerDetails);
  }
  return buildBillingInvoiceContainerDetails(invoice.lines);
}

export function buildBillingInvoiceContainerDetails(lines: BillingInvoiceLineData[]) {
  const byContainer = new Map<string, ContainerDetailAccumulator>();

  for (const line of lines) {
    const containerNo = normalizeContainerNo(line.containerNo);
    const key = containerNo || INVOICE_LEVEL_KEY;
    let entry = byContainer.get(key);
    if (!entry) {
      entry = {
        detail: emptyContainerDetail(containerNo),
        warehouses: new Set<string>(),
        references: new Set<string>()
      };
      byContainer.set(key, entry);
    }

    if (line.warehouse.trim()) entry.warehouses.add(line.warehouse.trim());
    if (line.reference.trim()) entry.references.add(line.reference.trim());
    entry.detail.lineCount += 1;
    entry.detail.totalAmount += line.amount;

    switch (line.chargeType.trim().toUpperCase()) {
      case "INBOUND":
        entry.detail.inboundUnits += line.quantity;
        entry.detail.inboundAmount += line.amount;
        break;
      case "WRAPPING":
        entry.detail.wrappingPallets += line.quantity;
        entry.detail.wrappingAmount += line.amount;
        break;
      case "STORAGE": {
        const details = line.details?.kind === "STORAGE_CONTAINER_SUMMARY" ? line.details : null;
        const discount = details?.discountAmount ?? 0;
        entry.detail.palletsTracked = Math.max(entry.detail.palletsTracked, details?.palletsTracked ?? 0);
        entry.detail.palletDays += details?.palletDays ?? line.quantity;
        entry.detail.freePalletDays += details?.freePalletDays ?? 0;
        entry.detail.billablePalletDays += details?.billablePalletDays ?? line.quantity;
        entry.detail.storageGrossAmount += details?.grossAmount ?? line.amount + discount;
        entry.detail.storageDiscountAmount += discount;
        entry.detail.storageAmount += line.amount;
        break;
      }
      case "OUTBOUND":
        entry.detail.outboundPallets += line.quantity;
        entry.detail.outboundAmount += line.amount;
        break;
      default:
        entry.detail.adjustmentAmount += line.amount;
        break;
    }
  }

  return [...byContainer.values()]
    .map(({ detail, warehouses, references }) => ({
      ...roundContainerDetail(detail),
      warehouses: [...warehouses].sort(),
      references: [...references].sort()
    }))
    .sort(compareContainerDetails);
}

export function sumBillingContainerDetailTotals(details: BillingInvoiceContainerDetailData[]) {
  return roundCurrency(details.reduce((total, detail) => total + detail.totalAmount, 0));
}

function emptyContainerDetail(containerNo: string): BillingInvoiceContainerDetailData {
  return {
    containerNo,
    warehouses: [],
    references: [],
    inboundUnits: 0,
    wrappingPallets: 0,
    palletsTracked: 0,
    palletDays: 0,
    freePalletDays: 0,
    billablePalletDays: 0,
    outboundPallets: 0,
    inboundAmount: 0,
    wrappingAmount: 0,
    storageGrossAmount: 0,
    storageDiscountAmount: 0,
    storageAmount: 0,
    outboundAmount: 0,
    adjustmentAmount: 0,
    totalAmount: 0,
    lineCount: 0
  };
}

function roundContainerDetail(detail: BillingInvoiceContainerDetailData): BillingInvoiceContainerDetailData {
  return {
    ...detail,
    inboundUnits: roundQuantity(detail.inboundUnits),
    wrappingPallets: roundQuantity(detail.wrappingPallets),
    palletsTracked: roundQuantity(detail.palletsTracked),
    palletDays: roundQuantity(detail.palletDays),
    freePalletDays: roundQuantity(detail.freePalletDays),
    billablePalletDays: roundQuantity(detail.billablePalletDays),
    outboundPallets: roundQuantity(detail.outboundPallets),
    inboundAmount: roundCurrency(detail.inboundAmount),
    wrappingAmount: roundCurrency(detail.wrappingAmount),
    storageGrossAmount: roundCurrency(detail.storageGrossAmount),
    storageDiscountAmount: roundCurrency(detail.storageDiscountAmount),
    storageAmount: roundCurrency(detail.storageAmount),
    outboundAmount: roundCurrency(detail.outboundAmount),
    adjustmentAmount: roundCurrency(detail.adjustmentAmount),
    totalAmount: roundCurrency(detail.totalAmount)
  };
}

function compareContainerDetails(
  left: BillingInvoiceContainerDetailData,
  right: BillingInvoiceContainerDetailData
) {
  if (!left.containerNo || !right.containerNo) {
    return left.containerNo ? -1 : right.containerNo ? 1 : 0;
  }
  return left.containerNo.localeCompare(right.containerNo);
}

function normalizeContainerNo(value: string) {
  return value.trim().toUpperCase();
}

function roundQuantity(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}
