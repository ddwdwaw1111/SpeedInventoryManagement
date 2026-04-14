import { parseDateLikeValue, startOfLocalDay, toIsoDateString } from "./dates";
import type { ContainerType, Customer, InboundDocument, OutboundDocument, PalletLocationEvent, PalletTrace } from "./types";

export type BillingRates = {
  inboundContainerFee: number;
  wrappingFeePerPallet: number;
  storageFeePerPalletPerWeek?: number;
  storageFeePerPalletPerWeekNormal: number;
  storageFeePerPalletPerWeekWestCoastTransfer: number;
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
  locationId?: number | "all";
  containerType?: ContainerType | "all";
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
  locationId: number;
  locationName: string;
};

type MutableStorageRow = BillingStorageRow & {
  warehouseSet: Set<string>;
  palletIdSet: Set<number>;
  dailyBalanceMap: Map<string, number>;
  freeDailyBalanceMap: Map<string, number>;
};

const DEFAULT_UNASSIGNED_CONTAINER = "UNASSIGNED";
const STORAGE_GRACE_DAYS = 7;

export const DEFAULT_BILLING_RATES: BillingRates = {
  inboundContainerFee: 450,
  wrappingFeePerPallet: 10,
  storageFeePerPalletPerWeek: 7,
  storageFeePerPalletPerWeekNormal: 7,
  storageFeePerPalletPerWeekWestCoastTransfer: 7,
  outboundFeePerPallet: 10
};

export function buildBillingPreview(input: BuildBillingPreviewInput): BillingPreview {
  const billingRange = getBillingRange(input.startDate, input.endDate);
  const rangeDays = getRangeLength(billingRange);
  const customerName = resolveCustomerName(input.customerId, input.customers);

  const inboundLines = buildInboundInvoiceLines(
    input.inboundDocuments,
    input.customerId,
    input.locationId,
    input.containerType,
    input.rates,
    billingRange
  );
  const outboundLines = buildOutboundInvoiceLines(
    input.outboundDocuments,
    input.customerId,
    input.locationId,
    input.rates,
    billingRange
  );
  const { storageRows, storageLines, dailyBalanceRows } = buildStorageCharges(
    input.pallets,
    input.palletLocationEvents,
    input.customerId,
    input.locationId,
    input.containerType,
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

function normalizeBillingRates(rates: BillingRates): BillingRates {
  if (
    (rates.storageFeePerPalletPerWeekNormal ?? 0) <= 0
    && (rates.storageFeePerPalletPerWeekWestCoastTransfer ?? 0) <= 0
    && (rates.storageFeePerPalletPerWeek ?? 0) > 0
  ) {
    return {
      ...rates,
      storageFeePerPalletPerWeekNormal: rates.storageFeePerPalletPerWeek ?? 0,
      storageFeePerPalletPerWeekWestCoastTransfer: rates.storageFeePerPalletPerWeek ?? 0
    };
  }

  return {
    ...rates,
    storageFeePerPalletPerWeek: rates.storageFeePerPalletPerWeek ?? rates.storageFeePerPalletPerWeekNormal
  };
}

function resolveStorageRatePerDay(containerType: ContainerType, rates: BillingRates) {
  const weeklyRate = containerType === "WEST_COAST_TRANSFER"
    ? rates.storageFeePerPalletPerWeekWestCoastTransfer
    : rates.storageFeePerPalletPerWeekNormal;
  return weeklyRate / 7;
}

function formatContainerTypeLabel(containerType: ContainerType) {
  return containerType === "WEST_COAST_TRANSFER" ? "West Coast Transfer" : "Normal";
}

function normalizeContainerTypeValue(containerType?: string | null): ContainerType {
  return containerType === "WEST_COAST_TRANSFER" ? "WEST_COAST_TRANSFER" : "NORMAL";
}

function buildInboundInvoiceLines(
  inboundDocuments: InboundDocument[],
  customerId: number | "all",
  locationId: number | "all" | undefined,
  containerType: ContainerType | "all" | undefined,
  rates: BillingRates,
  billingRange: BillingRange
) {
  const lines: BillingInvoiceLine[] = [];

  for (const document of inboundDocuments) {
    if (!belongsToCustomer(document.customerId, customerId)) {
      continue;
    }
    if (locationId && locationId !== "all" && document.locationId !== locationId) {
      continue;
    }
    if (containerType && containerType !== "all" && normalizeContainerTypeValue(document.containerType) !== containerType) {
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
  locationId: number | "all" | undefined,
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

    const lineScope = locationId && locationId !== "all"
      ? document.lines.filter((line) => line.locationId === locationId)
      : document.lines;

    const occurredOn = resolveOutboundBillingDate(document);
    if (!isWithinRange(occurredOn, billingRange)) {
      continue;
    }

    const shippedPallets = lineScope.reduce((total, line) => total + Math.max(line.pallets, 0), 0);
    if (shippedPallets <= 0) {
      continue;
    }
    const warehouseSummary = locationId && locationId !== "all"
      ? (lineScope[0]?.locationName || document.storages || "-")
      : (document.storages || "-");

    lines.push({
      id: `outbound-${document.id}`,
      customerId: document.customerId,
      customerName: document.customerName,
      chargeType: "OUTBOUND",
      reference: buildOutboundReference(document),
      containerNo: "-",
      warehouseSummary,
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
  locationId: number | "all" | undefined,
  containerType: ContainerType | "all" | undefined,
  rates: BillingRates,
  billingRange: BillingRange,
  rangeDays: number
) {
  const normalizedRates = normalizeBillingRates(rates);
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
    if (containerType && containerType !== "all" && pallet.containerType !== containerType) {
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
    const rowKey = `${pallet.customerId}|${pallet.containerType}|${containerNo}`;
    const row = rowMap.get(rowKey) ?? {
      customerId: pallet.customerId,
      customerName: pallet.customerName,
      containerNo,
      containerType: pallet.containerType,
      locationId: locationId && locationId !== "all" ? locationId : null,
      locationName: "",
      warehousesTouched: [],
      warehouseSet: new Set<string>(),
      palletIdSet: new Set<number>(),
      palletsTracked: 0,
      palletDays: 0,
      freePalletDays: 0,
      billablePalletDays: 0,
      averageDailyPallets: 0,
      firstActivityAt: null,
      lastActivityAt: null,
      grossAmount: 0,
      discountAmount: 0,
      amount: 0,
      segments: [],
      dailyBalanceMap: new Map<string, number>(),
      freeDailyBalanceMap: new Map<string, number>()
    };

    let storageDaysConsumed = countStorageDaysBeforeRange(intervals, billingRange.start, STORAGE_GRACE_DAYS);
    let countedAnyDay = false;
    for (let dayCursor = new Date(billingRange.start); dayCursor < billingRange.endExclusive; dayCursor = shiftDay(dayCursor, 1)) {
      const nextDay = shiftDay(dayCursor, 1);
      const activeInterval = findActiveIntervalAtDayEnd(intervals, nextDay);
      if (!activeInterval) {
        continue;
      }
      storageDaysConsumed += 1;
      const isGraceDay = storageDaysConsumed <= STORAGE_GRACE_DAYS;
      if (locationId && locationId !== "all" && activeInterval.locationId !== locationId) {
        continue;
      }
      countedAnyDay = true;
      if (row.locationId === null) {
        row.locationName = "";
      } else if (!row.locationName) {
        row.locationName = activeInterval.locationName;
      }
      addWarehouse(row, activeInterval.locationName);
      row.palletDays += 1;
      if (isGraceDay) {
        row.freePalletDays += 1;
      } else {
        row.billablePalletDays += 1;
      }
      const dayKey = toIsoDateString(dayCursor);
      dailyBalanceMap.set(dayKey, (dailyBalanceMap.get(dayKey) ?? 0) + 1);
      row.dailyBalanceMap.set(dayKey, (row.dailyBalanceMap.get(dayKey) ?? 0) + 1);
      if (isGraceDay) {
        row.freeDailyBalanceMap.set(dayKey, (row.freeDailyBalanceMap.get(dayKey) ?? 0) + 1);
      }
    }

    if (!countedAnyDay) {
      continue;
    }

    row.palletIdSet.add(pallet.id);
    rowMap.set(rowKey, row);
  }

  const storageRows = [...rowMap.values()]
    .map((row) => {
      const storageRatePerDay = resolveStorageRatePerDay(row.containerType, normalizedRates);
      const segments = buildStorageSegments(row.dailyBalanceMap, row.freeDailyBalanceMap, billingRange, storageRatePerDay);
      const firstActivityAt = segments[0]?.startDate ?? null;
      const lastActivityAt = segments[segments.length - 1]?.endDate ?? null;
      const grossAmount = roundCurrency(row.palletDays * storageRatePerDay);
      const discountAmount = roundCurrency(row.freePalletDays * storageRatePerDay);
      return {
        customerId: row.customerId,
        customerName: row.customerName,
        containerNo: row.containerNo,
        containerType: row.containerType,
        locationId: row.locationId,
        locationName: row.locationId === null
          ? ([...row.warehouseSet].sort((left, right) => left.localeCompare(right)).join(", "))
          : row.locationName,
        warehousesTouched: [...row.warehouseSet].sort((left, right) => left.localeCompare(right)),
        palletsTracked: row.palletIdSet.size,
        palletDays: row.palletDays,
        freePalletDays: row.freePalletDays,
        billablePalletDays: row.billablePalletDays,
        averageDailyPallets: roundQuantity(row.palletDays / rangeDays),
        firstActivityAt,
        lastActivityAt,
        grossAmount,
        discountAmount,
        amount: roundCurrency(grossAmount - discountAmount),
        segments
      };
    })
    .filter((row) => row.palletDays > 0)
    .sort((left, right) => {
      if (left.customerName !== right.customerName) {
        return left.customerName.localeCompare(right.customerName);
      }
      if (left.containerType !== right.containerType) {
        return left.containerType.localeCompare(right.containerType);
      }
      return left.containerNo.localeCompare(right.containerNo);
    });

  const storageLines = storageRows.map((row) => ({
    id: `storage-${row.customerId}-${row.containerType}-${row.containerNo}`,
    customerId: row.customerId,
    customerName: row.customerName,
    chargeType: "STORAGE" as const,
    reference: `Storage | ${row.containerNo}`,
    containerNo: row.containerNo,
    warehouseSummary: row.warehousesTouched.join(", ") || "-",
    occurredOn: row.lastActivityAt,
    quantity: row.billablePalletDays,
    unitRate: roundCurrency(resolveStorageRatePerDay(row.containerType, normalizedRates)),
    amount: row.amount,
    meta: `${row.palletsTracked} pallets tracked | ${formatContainerTypeLabel(row.containerType)} | ${row.freePalletDays} free pallet-days | -${formatMoney(row.discountAmount)}`
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
  let activeStart: Date | null = null;
  let activeLocationID = 0;
  let activeLocationName = "";
  let active = false;
  let hasStartEvent = false;

  for (const event of sortedEvents) {
    const eventTime = parseDateLikeValue(event.eventTime);
    if (!eventTime) {
      continue;
    }

    if (isStorageResumeEvent(event.eventType)) {
      hasStartEvent = true;
      if (!active) {
        activeStart = eventTime;
        activeLocationID = event.locationId;
        activeLocationName = event.locationName;
        active = true;
        continue;
      }
      if (activeStart && (activeLocationID != event.locationId || activeLocationName != event.locationName)) {
        intervals.push({
          start: activeStart,
          end: eventTime,
          locationId: activeLocationID,
          locationName: activeLocationName
        });
        activeStart = eventTime;
        activeLocationID = event.locationId;
        activeLocationName = event.locationName;
      }
      continue;
    }

    if (isStorageEndEvent(event.eventType) && active && activeStart) {
      intervals.push({
        start: activeStart,
        end: eventTime,
        locationId: activeLocationID,
        locationName: activeLocationName
      });
      active = false;
      activeStart = null;
    }
  }

  if (!hasStartEvent) {
    const fallbackStart = parseDateLikeValue(pallet.actualArrivalDate ?? pallet.createdAt);
    if (!fallbackStart) {
      return intervals;
    }
    activeStart = fallbackStart;
    activeLocationID = pallet.currentLocationId;
    activeLocationName = pallet.currentLocationName;
    active = true;
  }

  if (active) {
    const closedAt = isClosedPalletStatus(pallet.status) ? parseDateLikeValue(pallet.updatedAt) : null;
    if (activeStart) {
      intervals.push({
        start: activeStart,
        end: closedAt,
        locationId: activeLocationID,
        locationName: activeLocationName
      });
    }
  }

  return intervals;
}

function findActiveIntervalAtDayEnd(intervals: StorageInterval[], boundaryExclusive: Date) {
  return intervals.find((interval) => (
    interval.start.getTime() < boundaryExclusive.getTime()
      && (interval.end === null || interval.end.getTime() >= boundaryExclusive.getTime())
  )) ?? null;
}

function countStorageDaysBeforeRange(intervals: StorageInterval[], rangeStart: Date, cap: number) {
  if (cap <= 0) {
    return 0;
  }

  let total = 0;
  for (const interval of intervals) {
    const startDay = startOfLocalDay(interval.start);
    const intervalEndDay = interval.end ? startOfLocalDay(interval.end) : null;
    const effectiveEnd = intervalEndDay && intervalEndDay.getTime() < rangeStart.getTime()
      ? intervalEndDay
      : rangeStart;

    if (startDay.getTime() >= effectiveEnd.getTime()) {
      continue;
    }

    total += Math.round((effectiveEnd.getTime() - startDay.getTime()) / 86400000);
    if (total >= cap) {
      return cap;
    }
  }

  return total;
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
  freeDailyBalanceMap: Map<string, number>,
  billingRange: BillingRange,
  storageRatePerDay: number
) {
  const segments: BillingStorageSegment[] = [];
  let activeSegment: {
    startDate: string;
    endDate: string;
    dayEndPallets: number;
    dayEndFreePallets: number;
    billedDays: number;
  } | null = null;

  for (let dayCursor = new Date(billingRange.start); dayCursor < billingRange.endExclusive; dayCursor = shiftDay(dayCursor, 1)) {
    const dayKey = toIsoDateString(dayCursor);
    const palletCount = dailyBalanceMap.get(dayKey) ?? 0;
    const freePalletCount = Math.min(freeDailyBalanceMap.get(dayKey) ?? 0, palletCount);

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
        dayEndFreePallets: freePalletCount,
        billedDays: 1
      };
      continue;
    }

    if (activeSegment.dayEndPallets === palletCount && activeSegment.dayEndFreePallets === freePalletCount) {
      activeSegment.endDate = dayKey;
      activeSegment.billedDays += 1;
      continue;
    }

    segments.push(finalizeStorageSegment(activeSegment, storageRatePerDay));
    activeSegment = {
      startDate: dayKey,
      endDate: dayKey,
      dayEndPallets: palletCount,
      dayEndFreePallets: freePalletCount,
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
    dayEndFreePallets: number;
    billedDays: number;
  },
  storageRatePerDay: number
): BillingStorageSegment {
  const palletDays = segment.dayEndPallets * segment.billedDays;
  const freePalletDays = segment.dayEndFreePallets * segment.billedDays;
  const billablePalletDays = palletDays - freePalletDays;
  const grossAmount = roundCurrency(palletDays * storageRatePerDay);
  const discountAmount = roundCurrency(freePalletDays * storageRatePerDay);
  return {
    startDate: segment.startDate,
    endDate: segment.endDate,
    dayEndPallets: segment.dayEndPallets,
    billedDays: segment.billedDays,
    palletDays,
    freePalletDays,
    billablePalletDays,
    grossAmount,
    discountAmount,
    amount: roundCurrency(grossAmount - discountAmount)
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
  return normalized === "OUTBOUND" || normalized === "CANCELLED" || normalized === "TRANSFER_OUT";
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

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}
