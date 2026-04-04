import { parseDateLikeValue, startOfLocalDay, toIsoDateString } from "./dates";
import type { Customer, InboundDocument, OutboundDocument, PalletLocationEvent, PalletTrace } from "./types";

export type BillingRates = {
  inboundContainerFee: number;
  wrappingFeePerPallet: number;
  storageFeePerPalletPerWeek: number;
  outboundFeePerPallet: number;
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
  warehousesTouched: string[];
  palletsTracked: number;
  palletDays: number;
  averageDailyPallets: number;
  firstActivityAt: string | null;
  lastActivityAt: string | null;
  amount: number;
};

export type BillingDailyBalanceRow = {
  date: string;
  palletCount: number;
};

export type BillingPreviewSummary = {
  receivedContainers: number;
  receivedPallets: number;
  shippedPallets: number;
  palletDays: number;
  inboundAmount: number;
  wrappingAmount: number;
  storageAmount: number;
  outboundAmount: number;
  grandTotal: number;
};

export type BillingPreview = {
  month: string;
  customerId: number | "all";
  customerName: string;
  invoiceLines: BillingInvoiceLine[];
  storageRows: BillingStorageRow[];
  dailyBalanceRows: BillingDailyBalanceRow[];
  summary: BillingPreviewSummary;
};

type BuildBillingPreviewInput = {
  month: string;
  customerId: number | "all";
  customers: Customer[];
  pallets: PalletTrace[];
  palletLocationEvents: PalletLocationEvent[];
  inboundDocuments: InboundDocument[];
  outboundDocuments: OutboundDocument[];
  rates: BillingRates;
};

type StorageInterval = {
  start: Date;
  end: Date | null;
};

type MutableStorageRow = BillingStorageRow & {
  warehouseSet: Set<string>;
  palletIdSet: Set<number>;
};

const DEFAULT_UNASSIGNED_CONTAINER = "UNASSIGNED";

export const DEFAULT_BILLING_RATES: BillingRates = {
  inboundContainerFee: 450,
  wrappingFeePerPallet: 10,
  storageFeePerPalletPerWeek: 7,
  outboundFeePerPallet: 10
};

export function buildBillingPreview(input: BuildBillingPreviewInput): BillingPreview {
  const monthRange = getMonthRange(input.month);
  const monthDays = getMonthLength(input.month);
  const customerName = resolveCustomerName(input.customerId, input.customers);

  const inboundLines = buildInboundInvoiceLines(input.inboundDocuments, input.customerId, input.rates, monthRange);
  const outboundLines = buildOutboundInvoiceLines(input.outboundDocuments, input.customerId, input.rates, monthRange);
  const { storageRows, storageLines, dailyBalanceRows } = buildStorageCharges(
    input.pallets,
    input.palletLocationEvents,
    input.customerId,
    input.rates,
    monthRange,
    monthDays
  );

  const invoiceLines = [...inboundLines, ...storageLines, ...outboundLines]
    .sort(compareInvoiceLines);

  const summary: BillingPreviewSummary = {
    receivedContainers: inboundLines.filter((line) => line.chargeType === "INBOUND").length,
    receivedPallets: inboundLines
      .filter((line) => line.chargeType === "WRAPPING")
      .reduce((total, line) => total + line.quantity, 0),
    shippedPallets: outboundLines.reduce((total, line) => total + line.quantity, 0),
    palletDays: storageRows.reduce((total, row) => total + row.palletDays, 0),
    inboundAmount: roundCurrency(inboundLines.filter((line) => line.chargeType === "INBOUND").reduce((total, line) => total + line.amount, 0)),
    wrappingAmount: roundCurrency(inboundLines.filter((line) => line.chargeType === "WRAPPING").reduce((total, line) => total + line.amount, 0)),
    storageAmount: roundCurrency(storageRows.reduce((total, row) => total + row.amount, 0)),
    outboundAmount: roundCurrency(outboundLines.reduce((total, line) => total + line.amount, 0)),
    grandTotal: 0
  };
  summary.grandTotal = roundCurrency(summary.inboundAmount + summary.wrappingAmount + summary.storageAmount + summary.outboundAmount);

  return {
    month: input.month,
    customerId: input.customerId,
    customerName,
    invoiceLines,
    storageRows,
    dailyBalanceRows,
    summary
  };
}

export function getCurrentMonthInputValue(now = new Date()) {
  return `${now.getFullYear()}-${`${now.getMonth() + 1}`.padStart(2, "0")}`;
}

function buildInboundInvoiceLines(
  inboundDocuments: InboundDocument[],
  customerId: number | "all",
  rates: BillingRates,
  monthRange: { start: Date; endExclusive: Date }
) {
  const lines: BillingInvoiceLine[] = [];

  for (const document of inboundDocuments) {
    if (!belongsToCustomer(document.customerId, customerId)) {
      continue;
    }
    if (!isBillableDocument(document.status)) {
      continue;
    }

    const occurredOn = resolveInboundBillingDate(document);
    if (!isWithinMonth(occurredOn, monthRange)) {
      continue;
    }

    const receivedPallets = document.lines.reduce((total, line) => total + Math.max(line.pallets, 0), 0);
    const containerNo = normalizeContainerNo(document.containerNo);
    const warehouseSummary = document.locationName || "-";
    const reference = buildInboundReference(document, containerNo);

    lines.push({
      id: `inbound-${document.id}`,
      customerId: document.customerId,
      customerName: document.customerName,
      chargeType: "INBOUND",
      reference,
      containerNo,
      warehouseSummary,
      occurredOn,
      quantity: 1,
      unitRate: rates.inboundContainerFee,
      amount: roundCurrency(rates.inboundContainerFee),
      meta: `${receivedPallets} pallets received`
    });

    if (receivedPallets > 0) {
      lines.push({
        id: `wrapping-${document.id}`,
        customerId: document.customerId,
        customerName: document.customerName,
        chargeType: "WRAPPING",
        reference,
        containerNo,
        warehouseSummary,
        occurredOn,
        quantity: receivedPallets,
        unitRate: rates.wrappingFeePerPallet,
        amount: roundCurrency(receivedPallets * rates.wrappingFeePerPallet),
        meta: `${receivedPallets} wrapped pallets`
      });
    }
  }

  return lines;
}

function buildOutboundInvoiceLines(
  outboundDocuments: OutboundDocument[],
  customerId: number | "all",
  rates: BillingRates,
  monthRange: { start: Date; endExclusive: Date }
) {
  const lines: BillingInvoiceLine[] = [];

  for (const document of outboundDocuments) {
    if (!belongsToCustomer(document.customerId, customerId)) {
      continue;
    }
    if (!isBillableDocument(document.status)) {
      continue;
    }

    const occurredOn = resolveOutboundBillingDate(document);
    if (!isWithinMonth(occurredOn, monthRange)) {
      continue;
    }

    const shippedPallets = document.lines.reduce((total, line) => total + Math.max(line.pallets, 0), 0);
    if (shippedPallets <= 0) {
      continue;
    }

    lines.push({
      id: `outbound-${document.id}`,
      customerId: document.customerId,
      customerName: document.customerName,
      chargeType: "OUTBOUND",
      reference: buildOutboundReference(document),
      containerNo: "-",
      warehouseSummary: document.storages || "-",
      occurredOn,
      quantity: shippedPallets,
      unitRate: rates.outboundFeePerPallet,
      amount: roundCurrency(shippedPallets * rates.outboundFeePerPallet),
      meta: `${shippedPallets} shipped pallets`
    });
  }

  return lines;
}

function buildStorageCharges(
  pallets: PalletTrace[],
  palletLocationEvents: PalletLocationEvent[],
  customerId: number | "all",
  rates: BillingRates,
  monthRange: { start: Date; endExclusive: Date },
  monthDays: number
) {
  const storageRatePerDay = rates.storageFeePerPalletPerWeek / 7;
  const eventsByPallet = new Map<number, PalletLocationEvent[]>();
  for (const event of palletLocationEvents) {
    const bucket = eventsByPallet.get(event.palletId) ?? [];
    bucket.push(event);
    eventsByPallet.set(event.palletId, bucket);
  }

  const dailyBalanceMap = new Map<string, number>();
  const rowMap = new Map<string, MutableStorageRow>();

  for (const pallet of pallets) {
    if (!belongsToCustomer(pallet.customerId, customerId)) {
      continue;
    }

    const palletEvents = [...(eventsByPallet.get(pallet.id) ?? [])].sort(compareEventsAscending);
    const intervals = buildStorageIntervals(pallet, palletEvents);
    if (intervals.length === 0) {
      continue;
    }

    const containerNo = normalizeContainerNo(
      pallet.currentContainerNo || palletEvents.find((event) => event.containerNo.trim())?.containerNo || ""
    );
    const rowKey = `${pallet.customerId}|${containerNo}`;
    const row = rowMap.get(rowKey) ?? {
      customerId: pallet.customerId,
      customerName: pallet.customerName,
      containerNo,
      warehousesTouched: [],
      warehouseSet: new Set<string>(),
      palletIdSet: new Set<number>(),
      palletsTracked: 0,
      palletDays: 0,
      averageDailyPallets: 0,
      firstActivityAt: null,
      lastActivityAt: null,
      amount: 0
    };

    const lastKnownActivity = maxIsoValue([
      pallet.createdAt,
      pallet.updatedAt,
      ...palletEvents.map((event) => event.eventTime)
    ]);
    row.firstActivityAt = minIsoValue([
      row.firstActivityAt,
      pallet.createdAt,
      ...palletEvents.map((event) => event.eventTime)
    ]);
    row.lastActivityAt = maxIsoValue([row.lastActivityAt, lastKnownActivity]);

    addWarehouse(row, pallet.currentLocationName);
    for (const event of palletEvents) {
      addWarehouse(row, event.locationName);
    }

    let countedAnyDay = false;
    for (let dayCursor = new Date(monthRange.start); dayCursor < monthRange.endExclusive; dayCursor = shiftDay(dayCursor, 1)) {
      const nextDay = shiftDay(dayCursor, 1);
      if (!isActiveAtDayEnd(intervals, nextDay)) {
        continue;
      }
      countedAnyDay = true;
      row.palletDays += 1;
      dailyBalanceMap.set(toIsoDateString(dayCursor), (dailyBalanceMap.get(toIsoDateString(dayCursor)) ?? 0) + 1);
    }

    if (!countedAnyDay) {
      continue;
    }

    row.palletIdSet.add(pallet.id);
    rowMap.set(rowKey, row);
  }

  const storageRows = [...rowMap.values()]
    .map((row) => ({
      customerId: row.customerId,
      customerName: row.customerName,
      containerNo: row.containerNo,
      warehousesTouched: [...row.warehouseSet].sort((left, right) => left.localeCompare(right)),
      palletsTracked: row.palletIdSet.size,
      palletDays: row.palletDays,
      averageDailyPallets: roundQuantity(row.palletDays / monthDays),
      firstActivityAt: row.firstActivityAt,
      lastActivityAt: row.lastActivityAt,
      amount: roundCurrency(row.palletDays * storageRatePerDay)
    }))
    .filter((row) => row.palletDays > 0)
    .sort((left, right) => {
      if (left.customerName !== right.customerName) {
        return left.customerName.localeCompare(right.customerName);
      }
      return left.containerNo.localeCompare(right.containerNo);
    });

  const storageLines = storageRows.map((row) => ({
    id: `storage-${row.customerId}-${row.containerNo}`,
    customerId: row.customerId,
    customerName: row.customerName,
    chargeType: "STORAGE" as const,
    reference: `Storage | ${row.containerNo}`,
    containerNo: row.containerNo,
    warehouseSummary: row.warehousesTouched.join(", ") || "-",
    occurredOn: row.lastActivityAt,
    quantity: row.palletDays,
    unitRate: roundCurrency(storageRatePerDay),
    amount: row.amount,
    meta: `${row.palletsTracked} pallets tracked`
  }));

  const dailyBalanceRows: BillingDailyBalanceRow[] = [];
  for (let dayCursor = new Date(monthRange.start); dayCursor < monthRange.endExclusive; dayCursor = shiftDay(dayCursor, 1)) {
    const key = toIsoDateString(dayCursor);
    dailyBalanceRows.push({
      date: key,
      palletCount: dailyBalanceMap.get(key) ?? 0
    });
  }

  return { storageRows, storageLines, dailyBalanceRows };
}

function buildStorageIntervals(pallet: PalletTrace, palletEvents: PalletLocationEvent[]) {
  const intervals: StorageInterval[] = [];
  const sortedEvents = [...palletEvents].sort(compareEventsAscending);
  const firstStartEvent = sortedEvents.find((event) => isStorageStartEvent(event.eventType));
  const fallbackStart = parseDateLikeValue(firstStartEvent?.eventTime ?? pallet.createdAt);
  if (!fallbackStart) {
    return intervals;
  }

  let activeStart = fallbackStart;
  let active = true;

  for (const event of sortedEvents) {
    const eventTime = parseDateLikeValue(event.eventTime);
    if (!eventTime) {
      continue;
    }

    if (isStorageEndEvent(event.eventType) && active) {
      intervals.push({ start: activeStart, end: eventTime });
      active = false;
      continue;
    }

    if (isStorageResumeEvent(event.eventType) && !active) {
      activeStart = eventTime;
      active = true;
    }
  }

  if (active) {
    const closedAt = isClosedPalletStatus(pallet.status) ? parseDateLikeValue(pallet.updatedAt) : null;
    intervals.push({ start: activeStart, end: closedAt });
  }

  return intervals;
}

function isActiveAtDayEnd(intervals: StorageInterval[], boundaryExclusive: Date) {
  return intervals.some((interval) => (
    interval.start.getTime() < boundaryExclusive.getTime()
      && (interval.end === null || interval.end.getTime() >= boundaryExclusive.getTime())
  ));
}

function getMonthRange(month: string) {
  const parsed = /^(\d{4})-(\d{2})$/.exec(month.trim());
  if (!parsed) {
    const fallback = getCurrentMonthInputValue();
    return getMonthRange(fallback);
  }

  const [, yearValue, monthValue] = parsed;
  const year = Number(yearValue);
  const monthIndex = Number(monthValue) - 1;
  const start = new Date(year, monthIndex, 1);
  const endExclusive = new Date(year, monthIndex + 1, 1);
  return { start, endExclusive };
}

function getMonthLength(month: string) {
  const { start, endExclusive } = getMonthRange(month);
  return Math.max(Math.round((endExclusive.getTime() - start.getTime()) / 86400000), 1);
}

function resolveCustomerName(customerId: number | "all", customers: Customer[]) {
  if (customerId === "all") {
    return "All Customers";
  }

  return customers.find((customer) => customer.id === customerId)?.name ?? `Customer #${customerId}`;
}

function belongsToCustomer(targetCustomerId: number, customerId: number | "all") {
  return customerId === "all" || targetCustomerId === customerId;
}

function resolveInboundBillingDate(document: InboundDocument) {
  return normalizeIsoCandidate(document.confirmedAt ?? document.deliveryDate ?? document.createdAt);
}

function resolveOutboundBillingDate(document: OutboundDocument) {
  return normalizeIsoCandidate(document.outDate ?? document.confirmedAt ?? document.createdAt);
}

function normalizeIsoCandidate(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }
  const parsed = parseDateLikeValue(typeof value === "string" ? value : value.toISOString());
  return parsed ? toIsoDateString(parsed) : null;
}

function isWithinMonth(value: string | null, monthRange: { start: Date; endExclusive: Date }) {
  if (!value) {
    return false;
  }
  const parsed = parseDateLikeValue(value);
  if (!parsed) {
    return false;
  }

  return parsed.getTime() >= monthRange.start.getTime() && parsed.getTime() < monthRange.endExclusive.getTime();
}

function isBillableDocument(status: string) {
  const normalized = status.trim().toUpperCase();
  return normalized !== "CANCELLED";
}

function normalizeContainerNo(value: string | null | undefined) {
  const normalized = (value ?? "").trim().toUpperCase();
  return normalized || DEFAULT_UNASSIGNED_CONTAINER;
}

function buildInboundReference(document: InboundDocument, containerNo: string) {
  if (containerNo !== DEFAULT_UNASSIGNED_CONTAINER) {
    return `Receipt ${document.id} | ${containerNo}`;
  }
  return `Receipt ${document.id}`;
}

function buildOutboundReference(document: OutboundDocument) {
  return document.packingListNo.trim()
    || document.orderRef.trim()
    || `Shipment ${document.id}`;
}

function compareInvoiceLines(left: BillingInvoiceLine, right: BillingInvoiceLine) {
  const leftTime = parseDateLikeValue(left.occurredOn)?.getTime() ?? 0;
  const rightTime = parseDateLikeValue(right.occurredOn)?.getTime() ?? 0;
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  if (left.customerName !== right.customerName) {
    return left.customerName.localeCompare(right.customerName);
  }
  return left.reference.localeCompare(right.reference);
}

function compareEventsAscending(left: PalletLocationEvent, right: PalletLocationEvent) {
  const leftTime = parseDateLikeValue(left.eventTime)?.getTime() ?? 0;
  const rightTime = parseDateLikeValue(right.eventTime)?.getTime() ?? 0;
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return left.id - right.id;
}

function shiftDay(date: Date, delta: number) {
  const start = startOfLocalDay(date);
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + delta);
}

function isStorageStartEvent(eventType: string) {
  const normalized = eventType.trim().toUpperCase();
  return normalized === "RECEIVED" || normalized === "TRANSFER_IN" || normalized === "REVERSAL";
}

function isStorageResumeEvent(eventType: string) {
  return isStorageStartEvent(eventType);
}

function isStorageEndEvent(eventType: string) {
  const normalized = eventType.trim().toUpperCase();
  return normalized === "OUTBOUND" || normalized === "CANCELLED";
}

function isClosedPalletStatus(status: string) {
  const normalized = status.trim().toUpperCase();
  return normalized === "SHIPPED" || normalized === "CANCELLED";
}

function minIsoValue(values: Array<string | null | undefined>) {
  let selected: Date | null = null;
  for (const value of values) {
    const parsed = parseDateLikeValue(value ?? undefined);
    if (!parsed) {
      continue;
    }
    if (!selected || parsed.getTime() < selected.getTime()) {
      selected = parsed;
    }
  }
  return selected ? selected.toISOString() : null;
}

function maxIsoValue(values: Array<string | null | undefined>) {
  let selected: Date | null = null;
  for (const value of values) {
    const parsed = parseDateLikeValue(value ?? undefined);
    if (!parsed) {
      continue;
    }
    if (!selected || parsed.getTime() > selected.getTime()) {
      selected = parsed;
    }
  }
  return selected ? selected.toISOString() : null;
}

function addWarehouse(row: MutableStorageRow, warehouseName: string | null | undefined) {
  const normalized = (warehouseName ?? "").trim();
  if (!normalized) {
    return;
  }
  row.warehouseSet.add(normalized);
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function roundQuantity(value: number) {
  return Math.round(value * 100) / 100;
}
