import { parseDateLikeValue, toIsoDateString } from "./dates";
import type { BillingPreviewResult, ContainerType } from "./types";

export type BillingRates = {
  inboundContainerFee: number;
  transferInboundFeePerPallet: number;
  wrappingFeePerPallet: number;
  storageFeePerPalletPerWeek?: number;
  storageFeePerPalletPerWeekNormal: number;
  storageFeePerPalletPerWeekWestCoastTransfer: number;
  outboundFeePerPallet: number;
  excludeUnderfilledPallets: boolean;
  minimumQtyPerPallet: number;
};

export type BillingInvoiceLine = {
  id: string;
  customerId: number;
  customerName: string;
  chargeType: "INBOUND" | "WRAPPING" | "STORAGE" | "OUTBOUND";
  reference: string;
  containerNo: string;
  warehouseSummary: string;
  occurredOn: string | null;
  quantity: number;
  unitRate: number;
  amount: number;
  meta: string;
};

export type BillingStorageRow = {
  customerId: number;
  customerName: string;
  containerNo: string;
  containerType: ContainerType;
  locationId: number | null;
  locationName: string;
  warehousesTouched: string[];
  palletsTracked: number;
  palletDays: number;
  freePalletDays: number;
  billablePalletDays: number;
  averageDailyPallets: number;
  firstActivityAt: string | null;
  lastActivityAt: string | null;
  grossAmount: number;
  discountAmount: number;
  amount: number;
  segments: BillingStorageSegment[];
};

export type BillingDailyBalanceRow = {
  date: string;
  palletCount: number;
};

export type BillingStorageSegment = {
  startDate: string;
  endDate: string;
  dayEndPallets: number;
  billedDays: number;
  palletDays: number;
  freePalletDays: number;
  billablePalletDays: number;
  grossAmount: number;
  discountAmount: number;
  amount: number;
};

export type BillingPreviewSummary = {
  receivedContainers: number;
  receivedPallets: number;
  shippedPallets: number;
  palletDays: number;
  inboundAmount: number;
  wrappingAmount: number;
  storageGrossAmount: number;
  storageDiscountAmount: number;
  storageAmount: number;
  outboundAmount: number;
  grandTotal: number;
};

export type BillingPreview = {
  startDate: string;
  endDate: string;
  customerId: number | "all";
  customerName: string;
  invoiceLines: BillingInvoiceLine[];
  storageRows: BillingStorageRow[];
  dailyBalanceRows: BillingDailyBalanceRow[];
  summary: BillingPreviewSummary;
  warnings?: string[];
};

export const MAXIMUM_BILLING_QTY_PER_PALLET = 15;

export const DEFAULT_BILLING_RATES: BillingRates = {
  inboundContainerFee: 450,
  transferInboundFeePerPallet: 10,
  wrappingFeePerPallet: 15,
  storageFeePerPalletPerWeek: 7,
  storageFeePerPalletPerWeekNormal: 7,
  storageFeePerPalletPerWeekWestCoastTransfer: 7,
  outboundFeePerPallet: 0,
  excludeUnderfilledPallets: false,
  minimumQtyPerPallet: 10
};

// Billing calculations are authoritative on the backend. The frontend only maps
// that result into display models so invoices cannot silently diverge by client.
export function mapAuthoritativeBillingPreview(result: BillingPreviewResult): BillingPreview {
  const storageRows = (result.storageRows ?? []).map((row): BillingStorageRow => {
    const warehousesTouched = row.warehousesTouched ?? [];
    return {
      customerId: row.customerId,
      customerName: row.customerName,
      containerNo: row.containerNo,
      containerType: normalizeContainerType(row.containerType),
      locationId: row.locationId ?? null,
      locationName: warehousesTouched.length === 1 ? warehousesTouched[0] : "",
      warehousesTouched,
      palletsTracked: row.palletsTracked,
      palletDays: row.palletDays,
      freePalletDays: row.freePalletDays,
      billablePalletDays: row.billablePalletDays,
      averageDailyPallets: row.averageDailyPallets,
      firstActivityAt: row.firstActivityOn || null,
      lastActivityAt: row.lastActivityOn || null,
      grossAmount: row.grossAmount,
      discountAmount: row.discountAmount,
      amount: row.amount,
      segments: (row.segments ?? []).map((segment) => ({ ...segment }))
    };
  });

  return {
    startDate: result.periodStart,
    endDate: result.periodEnd,
    customerId: result.customerId,
    customerName: result.customerName,
    invoiceLines: (result.lines ?? []).map((line) => ({
      id: line.id,
      customerId: result.customerId,
      customerName: result.customerName,
      chargeType: line.chargeType,
      reference: line.reference,
      containerNo: line.containerNo,
      warehouseSummary: line.warehouse,
      occurredOn: line.occurredOn || null,
      quantity: line.quantity,
      unitRate: line.unitRate,
      amount: line.amount,
      meta: line.description
    })),
    storageRows,
    dailyBalanceRows: (result.dailyBalances ?? []).map((row) => ({ ...row })),
    summary: { ...result.summary },
    warnings: [...(result.warnings ?? [])]
  };
}

export function mergeBillingPreviews(
  previews: BillingPreview[],
  scope: Pick<BillingPreview, "startDate" | "endDate" | "customerId" | "customerName">
): BillingPreview {
  const dailyBalances = new Map<string, number>();
  const summary = previews.reduce<BillingPreviewSummary>((total, preview) => {
    for (const row of preview.dailyBalanceRows) {
      dailyBalances.set(row.date, roundQuantity((dailyBalances.get(row.date) ?? 0) + row.palletCount));
    }
    return {
      receivedContainers: total.receivedContainers + preview.summary.receivedContainers,
      receivedPallets: roundQuantity(total.receivedPallets + preview.summary.receivedPallets),
      shippedPallets: roundQuantity(total.shippedPallets + preview.summary.shippedPallets),
      palletDays: roundQuantity(total.palletDays + preview.summary.palletDays),
      inboundAmount: roundCurrency(total.inboundAmount + preview.summary.inboundAmount),
      wrappingAmount: roundCurrency(total.wrappingAmount + preview.summary.wrappingAmount),
      storageGrossAmount: roundCurrency(total.storageGrossAmount + preview.summary.storageGrossAmount),
      storageDiscountAmount: roundCurrency(total.storageDiscountAmount + preview.summary.storageDiscountAmount),
      storageAmount: roundCurrency(total.storageAmount + preview.summary.storageAmount),
      outboundAmount: roundCurrency(total.outboundAmount + preview.summary.outboundAmount),
      grandTotal: roundCurrency(total.grandTotal + preview.summary.grandTotal)
    };
  }, emptyBillingSummary());

  return {
    ...scope,
    invoiceLines: previews.flatMap((preview) => preview.invoiceLines).sort(compareInvoiceLines),
    storageRows: previews
      .flatMap((preview) => preview.storageRows)
      .sort((left, right) => left.customerName.localeCompare(right.customerName) || left.containerNo.localeCompare(right.containerNo)),
    dailyBalanceRows: [...dailyBalances.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, palletCount]) => ({ date, palletCount })),
    summary,
    warnings: [...new Set(previews.flatMap((preview) =>
      (preview.warnings ?? []).map((warning) => `${preview.customerName}: ${warning}`)
    ))].sort((left, right) => left.localeCompare(right))
  };
}

export function getCurrentBillingDateRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { startDate: toIsoDateString(start), endDate: toIsoDateString(end) };
}

function emptyBillingSummary(): BillingPreviewSummary {
  return {
    receivedContainers: 0,
    receivedPallets: 0,
    shippedPallets: 0,
    palletDays: 0,
    inboundAmount: 0,
    wrappingAmount: 0,
    storageGrossAmount: 0,
    storageDiscountAmount: 0,
    storageAmount: 0,
    outboundAmount: 0,
    grandTotal: 0
  };
}

function normalizeContainerType(value: ContainerType | ""): ContainerType {
  return value === "WEST_COAST_TRANSFER" ? "WEST_COAST_TRANSFER" : "NORMAL";
}

function compareInvoiceLines(left: BillingInvoiceLine, right: BillingInvoiceLine) {
  const leftTime = parseDateLikeValue(left.occurredOn)?.getTime() ?? 0;
  const rightTime = parseDateLikeValue(right.occurredOn)?.getTime() ?? 0;
  return leftTime - rightTime
    || left.customerName.localeCompare(right.customerName)
    || left.reference.localeCompare(right.reference);
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function roundQuantity(value: number) {
  return Math.round(value * 100) / 100;
}
