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
  amount: number;
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
  startDate: string;
  endDate: string;
  customerId: number | "all";
  customerName: string;
  invoiceLines: BillingInvoiceLine[];
  storageRows: BillingStorageRow[];
  dailyBalanceRows: BillingDailyBalanceRow[];
  summary: BillingPreviewSummary;
};

type BuildBillingPreviewInput = {
  startDate: string;
  endDate: string;
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
  dailyBalanceMap: Map<string, number>;
};

const DEFAULT_UNASSIGNED_CONTAINER = "UNASSIGNED";

export const DEFAULT_BILLING_RATES: BillingRates = {
  inboundContainerFee: 450,
  wrappingFeePerPallet: 10,
  storageFeePerPalletPerWeek: 7,
  outboundFeePerPallet: 10
};

export function buildBillingPreview(input: BuildBillingPreviewInput): BillingPreview {
  const billingRange = getBillingRange(input.startDate, input.endDate);
  const rangeDays = getRangeLength(billingRange);
  const customerName = resolveCustomerName(input.customerId, input.customers);

  const inboundLines = buildInboundInvoiceLines(input.inboundDocuments, input.customerId, input.rates, billingRange);
  const outboundLines = buildOutboundInvoiceLines(input.outboundDocuments, input.customerId, input.rates, billingRange);
  const { storageRows, storageLines, dailyBalanceRows } = buildStorageCharges(
    input.pallets,
    input.palletLocationEvents,
    input.customerId,
    input.rates,
    billingRange,
    rangeDays
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
    startDate: billingRange.startDate,
    endDate: billingRange.endDate,
    customerId: input.customerId,
    customerName,
    invoiceLines,
    storageRows,
    dailyBalanceRows,
    summary
  };
}

export function getCurrentBillingDateRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return {
    startDate: toIsoDateString(start),
    endDate: toIsoDateString(end)
  };
}

function buildInboundInvoiceLines(
  inboundDocuments: InboundDocument[],
  customerId: number | "all",
  rates: BillingRates,
  billingRange: BillingRange
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
    if (!isWithinRange(occurredOn, billingRange)) {
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
  billingRange: BillingRange
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
    if (!isWithinRange(occurredOn, billingRange)) {
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
  billingRange: BillingRange,
  rangeDays: number
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
      amount: 0,
      segments: [],
      dailyBalanceMap: new Map<string, number>()
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
    for (let dayCursor = new Date(billingRange.start); dayCursor < billingRange.endExclusive; dayCursor = shiftDay(dayCursor, 1)) {
      const nextDay = shiftDay(dayCursor, 1);
      if (!isActiveAtDayEnd(intervals, nextDay)) {
        continue;
      }
      countedAnyDay = true;
      row.palletDays += 1;
      const dayKey = toIsoDateString(dayCursor);
      dailyBalanceMap.set(dayKey, (dailyBalanceMap.get(dayKey) ?? 0) + 1);
      row.dailyBalanceMap.set(dayKey, (row.dailyBalanceMap.get(dayKey) ?? 0) + 1);
    }

    if (!countedAnyDay) {
      continue;
    }

    row.palletIdSet.add(pallet.id);
    rowMap.set(rowKey, row);
  }

  const storageRows = [...rowMap.values()]
    .map((row) => {
      const segments = buildStorageSegments(row.dailyBalanceMap, billingRange, storageRatePerDay);
      return {
        customerId: row.customerId,
        customerName: row.customerName,
        containerNo: row.containerNo,
        warehousesTouched: [...row.warehouseSet].sort((left, right) => left.localeCompare(right)),
        palletsTracked: row.palletIdSet.size,
        palletDays: row.palletDays,
        averageDailyPallets: roundQuantity(row.palletDays / rangeDays),
        firstActivityAt: row.firstActivityAt,
        lastActivityAt: row.lastActivityAt,
        amount: roundCurrency(row.palletDays * storageRatePerDay),
        segments
      };
    })
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
  for (let dayCursor = new Date(billingRange.start); dayCursor < billingRange.endExclusive; dayCursor = shiftDay(dayCursor, 1)) {
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
  const fallbackStart = parseDateLikeValue(firstStartEvent?.eventTime ?? pallet.actualArrivalDate ?? pallet.createdAt);
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

type BillingRange = {
  startDate: string;
  endDate: string;
  start: Date;
  endInclusive: Date;
  endExclusive: Date;
};

function getBillingRange(startDateInput: string, endDateInput: string): BillingRange {
  const fallback = getCurrentBillingDateRange();
  const normalizedStart = normalizeIsoCandidate(startDateInput) ?? fallback.startDate;
  const normalizedEnd = normalizeIsoCandidate(endDateInput) ?? fallback.endDate;
  const start = parseDateLikeValue(normalizedStart) ?? parseDateLikeValue(fallback.startDate)!;
  const endCandidate = parseDateLikeValue(normalizedEnd) ?? parseDateLikeValue(fallback.endDate)!;
  const [safeStart, safeEnd] = start.getTime() <= endCandidate.getTime() ? [start, endCandidate] : [endCandidate, start];
  return {
    startDate: toIsoDateString(safeStart),
    endDate: toIsoDateString(safeEnd),
    start: safeStart,
    endInclusive: safeEnd,
    endExclusive: shiftDay(safeEnd, 1)
  };
}

function buildStorageSegments(
  dailyBalanceMap: Map<string, number>,
  billingRange: BillingRange,
  storageRatePerDay: number
) {
  const segments: BillingStorageSegment[] = [];
  let activeSegment: {
    startDate: string;
    endDate: string;
    dayEndPallets: number;
    billedDays: number;
  } | null = null;

  for (let dayCursor = new Date(billingRange.start); dayCursor < billingRange.endExclusive; dayCursor = shiftDay(dayCursor, 1)) {
    const dayKey = toIsoDateString(dayCursor);
    const palletCount = dailyBalanceMap.get(dayKey) ?? 0;

    if (palletCount <= 0) {
      if (activeSegment) {
        segments.push(finalizeStorageSegment(activeSegment, storageRatePerDay));
        activeSegment = null;
      }
      continue;
    }

    if (!activeSegment) {
      activeSegment = {
        startDate: dayKey,
        endDate: dayKey,
        dayEndPallets: palletCount,
        billedDays: 1
      };
      continue;
    }

    if (activeSegment.dayEndPallets === palletCount) {
      activeSegment.endDate = dayKey;
      activeSegment.billedDays += 1;
      continue;
    }

    segments.push(finalizeStorageSegment(activeSegment, storageRatePerDay));
    activeSegment = {
      startDate: dayKey,
      endDate: dayKey,
      dayEndPallets: palletCount,
      billedDays: 1
    };
  }

  if (activeSegment) {
    segments.push(finalizeStorageSegment(activeSegment, storageRatePerDay));
  }

  return segments;
}

function finalizeStorageSegment(
  segment: {
    startDate: string;
    endDate: string;
    dayEndPallets: number;
    billedDays: number;
  },
  storageRatePerDay: number
): BillingStorageSegment {
  const palletDays = segment.dayEndPallets * segment.billedDays;
  return {
    startDate: segment.startDate,
    endDate: segment.endDate,
    dayEndPallets: segment.dayEndPallets,
    billedDays: segment.billedDays,
    palletDays,
    amount: roundCurrency(palletDays * storageRatePerDay)
  };
}

function getRangeLength(range: BillingRange) {
  return Math.max(Math.round((range.endExclusive.getTime() - range.start.getTime()) / 86400000), 1);
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
  return normalizeIsoCandidate(
    document.actualArrivalDate
      ?? document.confirmedAt
      ?? document.createdAt
      ?? document.expectedArrivalDate
  );
}

function resolveOutboundBillingDate(document: OutboundDocument) {
  return normalizeIsoCandidate(
    document.actualShipDate
    ?? document.confirmedAt
    ?? document.createdAt
    ?? document.expectedShipDate
  );
}

function normalizeIsoCandidate(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }
  const parsed = parseDateLikeValue(typeof value === "string" ? value : value.toISOString());
  return parsed ? toIsoDateString(parsed) : null;
}

function isWithinRange(value: string | null, billingRange: BillingRange) {
  if (!value) {
    return false;
  }
  const parsed = parseDateLikeValue(value);
  if (!parsed) {
    return false;
  }

  return parsed.getTime() >= billingRange.start.getTime() && parsed.getTime() < billingRange.endExclusive.getTime();
}

function isBillableDocument(status: string) {
  const normalized = status.trim().toUpperCase();
  return normalized !== "DELETED";
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
