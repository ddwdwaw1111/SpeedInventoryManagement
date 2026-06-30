import { parseDateLikeValue, startOfLocalDay, toIsoDateString } from "./dates";
import { formatMoney } from "./formatters";
import type { ContainerType, Customer, InboundDocument, OutboundDocument, PalletLocationEvent, PalletTrace } from "./types";

export type BillingRates = {
  inboundContainerFee: number;
  transferInboundFeePerPallet: number;
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
};

type BuildBillingPreviewInput = {
  startDate: string;
  endDate: string;
  customerId: number | "all";
  locationId?: number | "all";
  containerType?: ContainerType | "all";
  normalPalletGracePeriodEnabled?: boolean;
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

type StorageBalanceEvent = {
  id: string;
  customerId: number;
  customerName: string;
  containerNo: string;
  containerType: ContainerType;
  locationId: number;
  locationName: string;
  occurredOn: string;
  palletDelta: number;
};

type StorageBatch = {
  quantity: number;
  start: Date;
  locationId: number;
  locationName: string;
};

type DocumentStorageRowState = {
  row: MutableStorageRow;
  batches: StorageBatch[];
};

type DocumentStorageScope = {
  containerKeys: Set<string>;
  customerContainerKeys: Set<string>;
};

type StorageChargeResult = {
  storageRows: BillingStorageRow[];
  storageLines: BillingInvoiceLine[];
  dailyBalanceRows: BillingDailyBalanceRow[];
};

type MutableStorageRow = BillingStorageRow & {
  warehouseSet: Set<string>;
  palletIdSet: Set<number>;
  trackedPallets: number;
  dailyBalanceMap: Map<string, number>;
  freeDailyBalanceMap: Map<string, number>;
};

const DEFAULT_UNASSIGNED_CONTAINER = "UNASSIGNED";
const STORAGE_GRACE_DAYS = 7;

export const DEFAULT_BILLING_RATES: BillingRates = {
  inboundContainerFee: 450,
  transferInboundFeePerPallet: 10,
  wrappingFeePerPallet: 15,
  storageFeePerPalletPerWeek: 7,
  storageFeePerPalletPerWeekNormal: 7,
  storageFeePerPalletPerWeekWestCoastTransfer: 7,
  outboundFeePerPallet: 0
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
  const shippedPallets = countShippedPallets(
    input.outboundDocuments,
    input.customerId,
    input.locationId,
    billingRange
  );
  const { storageRows, storageLines, dailyBalanceRows } = buildStorageCharges(
    input.pallets,
    input.palletLocationEvents,
    input.inboundDocuments,
    input.outboundDocuments,
    input.customerId,
    input.locationId,
    input.containerType,
    input.normalPalletGracePeriodEnabled ?? true,
    input.rates,
    billingRange,
    rangeDays
  );

  const invoiceLines = [...inboundLines, ...storageLines]
    .sort(compareInvoiceLines);

  const summary: BillingPreviewSummary = {
    receivedContainers: inboundLines.filter((line) => line.chargeType === "INBOUND").length,
    receivedPallets: inboundLines
      .filter((line) => line.chargeType === "WRAPPING")
      .reduce((total, line) => total + line.quantity, 0),
    shippedPallets,
    palletDays: storageRows.reduce((total, row) => total + row.palletDays, 0),
    inboundAmount: roundCurrency(inboundLines.filter((line) => line.chargeType === "INBOUND").reduce((total, line) => total + line.amount, 0)),
    wrappingAmount: roundCurrency(inboundLines.filter((line) => line.chargeType === "WRAPPING").reduce((total, line) => total + line.amount, 0)),
    storageGrossAmount: roundCurrency(storageRows.reduce((total, row) => total + row.grossAmount, 0)),
    storageDiscountAmount: roundCurrency(storageRows.reduce((total, row) => total + row.discountAmount, 0)),
    storageAmount: roundCurrency(storageRows.reduce((total, row) => total + row.amount, 0)),
    outboundAmount: 0,
    grandTotal: 0
  };
  summary.grandTotal = roundCurrency(summary.inboundAmount + summary.wrappingAmount + summary.storageAmount);

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
    transferInboundFeePerPallet: rates.transferInboundFeePerPallet ?? DEFAULT_BILLING_RATES.transferInboundFeePerPallet,
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
  return containerType === "WEST_COAST_TRANSFER" ? "Transfer" : "Normal";
}

function normalizeContainerTypeValue(containerType?: string | null): ContainerType {
  return containerType === "WEST_COAST_TRANSFER" ? "WEST_COAST_TRANSFER" : "NORMAL";
}

function resolveInboundCharge(containerType: ContainerType, rates: BillingRates, receivedPallets: number) {
  if (containerType === "WEST_COAST_TRANSFER") {
    return {
      quantity: receivedPallets,
      unitRate: rates.transferInboundFeePerPallet,
      amount: roundCurrency(receivedPallets * rates.transferInboundFeePerPallet),
      meta: `${receivedPallets} transfer pallets received`
    };
  }

  return {
    quantity: 1,
    unitRate: rates.inboundContainerFee,
    amount: roundCurrency(rates.inboundContainerFee),
    meta: `${receivedPallets} pallets received`
  };
}

function resolveStorageGraceDays(containerType: ContainerType, normalPalletGracePeriodEnabled: boolean) {
  if (!normalPalletGracePeriodEnabled) {
    return 0;
  }
  return containerType === "WEST_COAST_TRANSFER" ? 0 : STORAGE_GRACE_DAYS;
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
    const documentContainerType = normalizeContainerTypeValue(document.containerType);
    const containerNo = normalizeContainerNo(document.containerNo);
    const warehouseSummary = document.locationName || "-";
    const reference = buildInboundReference(document, containerNo);
    const inboundCharge = resolveInboundCharge(documentContainerType, rates, receivedPallets);

    lines.push({
      id: `inbound-${document.id}`,
      customerId: document.customerId,
      customerName: document.customerName,
      chargeType: "INBOUND",
      reference,
      containerNo,
      warehouseSummary,
      occurredOn,
      quantity: inboundCharge.quantity,
      unitRate: inboundCharge.unitRate,
      amount: inboundCharge.amount,
      meta: inboundCharge.meta
    });

    if (receivedPallets > 0 && documentContainerType !== "WEST_COAST_TRANSFER") {
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

function countShippedPallets(
  outboundDocuments: OutboundDocument[],
  customerId: number | "all",
  locationId: number | "all" | undefined,
  billingRange: BillingRange
) {
  let totalShippedPallets = 0;

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
    totalShippedPallets += shippedPallets;
  }

  return totalShippedPallets;
}

function buildStorageCharges(
  pallets: PalletTrace[],
  palletLocationEvents: PalletLocationEvent[],
  inboundDocuments: InboundDocument[],
  outboundDocuments: OutboundDocument[],
  customerId: number | "all",
  locationId: number | "all" | undefined,
  containerType: ContainerType | "all" | undefined,
  normalPalletGracePeriodEnabled: boolean,
  rates: BillingRates,
  billingRange: BillingRange,
  rangeDays: number
) {
  const documentEvents = buildDocumentStorageEvents(inboundDocuments, outboundDocuments, pallets, palletLocationEvents, customerId, containerType);
  const traceStorageCharges = buildPalletTraceStorageCharges(
    pallets,
    palletLocationEvents,
    customerId,
    locationId,
    containerType,
    normalPalletGracePeriodEnabled,
    rates,
    billingRange,
    rangeDays
  );
  if (documentEvents.length === 0) {
    return traceStorageCharges;
  }

  const documentStorageScope = getDocumentStorageScope(documentEvents, locationId);
  const documentInboundEvents = documentEvents.filter((event) => (
    event.palletDelta > 0 && isDocumentStorageEventInScope(event, documentStorageScope)
  ));
  const documentStorageCharges = buildDocumentStorageCharges(
    documentInboundEvents,
    locationId,
    normalPalletGracePeriodEnabled,
    rates,
    billingRange,
    rangeDays
  );

  return mergeStorageChargeResults(
    traceStorageCharges,
    documentStorageCharges,
    documentEvents.filter((event) => event.palletDelta < 0),
    locationId,
    rates,
    billingRange,
    rangeDays
  );
}

function buildPalletTraceStorageCharges(
  pallets: PalletTrace[],
  palletLocationEvents: PalletLocationEvent[],
  customerId: number | "all",
  locationId: number | "all" | undefined,
  containerType: ContainerType | "all" | undefined,
  normalPalletGracePeriodEnabled: boolean,
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
  const palletsById = new Map(pallets.map((pallet) => [pallet.id, pallet]));
  const intervalsByPalletId = new Map<number, StorageInterval[]>();

  const dailyBalanceMap = new Map<string, number>();
  const rowMap = new Map<string, MutableStorageRow>();

  for (const pallet of pallets) {
    if (!belongsToCustomer(pallet.customerId, customerId)) {
      continue;
    }
    if (containerType && containerType !== "all" && pallet.containerType !== containerType) {
      continue;
    }

    const intervals = getStorageIntervalsForPallet(pallet, eventsByPallet, intervalsByPalletId);
    if (intervals.length === 0) {
      continue;
    }
    const graceIntervals = buildLineageStorageIntervals(pallet, palletsById, eventsByPallet, intervalsByPalletId);

    const containerNo = normalizeContainerNo(
      pallet.currentContainerNo || (eventsByPallet.get(pallet.id) ?? []).find((event) => event.containerNo.trim())?.containerNo || ""
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
      trackedPallets: 0,
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

    const graceDays = resolveStorageGraceDays(pallet.containerType, normalPalletGracePeriodEnabled);
    let countedAnyDay = false;
    for (let dayCursor = new Date(billingRange.start); dayCursor < billingRange.endExclusive; dayCursor = shiftDay(dayCursor, 1)) {
      const nextDay = shiftDay(dayCursor, 1);
      const activeInterval = findActiveIntervalAtDayEnd(intervals, nextDay);
      if (!activeInterval) {
        continue;
      }
      const storageDaysConsumedBeforeDay = countStorageDaysBeforeRange(graceIntervals, dayCursor, graceDays);
      const isGraceDay = graceDays > 0 && storageDaysConsumedBeforeDay + 1 <= graceDays;
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
    row.trackedPallets = row.palletIdSet.size;
    rowMap.set(rowKey, row);
  }

  return finalizeStorageCharges(rowMap, dailyBalanceMap, normalizedRates, billingRange, rangeDays);
}

function buildDocumentStorageCharges(
  documentEvents: StorageBalanceEvent[],
  locationId: number | "all" | undefined,
  normalPalletGracePeriodEnabled: boolean,
  rates: BillingRates,
  billingRange: BillingRange,
  rangeDays: number
) {
  const normalizedRates = normalizeBillingRates(rates);
  const rowStates = new Map<string, DocumentStorageRowState>();
  const rowMap = new Map<string, MutableStorageRow>();
  const dailyBalanceMap = new Map<string, number>();
  const sortedEvents = [...documentEvents].sort(compareStorageBalanceEvents);
  let eventIndex = 0;

  for (let dayCursor = new Date(billingRange.start); dayCursor < billingRange.endExclusive; dayCursor = shiftDay(dayCursor, 1)) {
    const dayKey = toIsoDateString(dayCursor);
    while (eventIndex < sortedEvents.length && sortedEvents[eventIndex]!.occurredOn <= dayKey) {
      applyDocumentStorageEvent(sortedEvents[eventIndex]!, rowStates, rowMap, locationId);
      eventIndex += 1;
    }

    for (const state of rowStates.values()) {
      const graceDays = resolveStorageGraceDays(state.row.containerType, normalPalletGracePeriodEnabled);
      for (const batch of state.batches) {
        if (batch.quantity <= 0) {
          continue;
        }
        if (locationId && locationId !== "all" && batch.locationId !== locationId) {
          continue;
        }

        const daysBefore = Math.max(Math.round((dayCursor.getTime() - startOfLocalDay(batch.start).getTime()) / 86400000), 0);
        const isGraceDay = graceDays > 0 && daysBefore + 1 <= graceDays;
        addStorageDay(state.row, dayKey, batch.quantity, isGraceDay, batch.locationName);
        dailyBalanceMap.set(dayKey, (dailyBalanceMap.get(dayKey) ?? 0) + batch.quantity);
      }
    }
  }

  return finalizeStorageCharges(rowMap, dailyBalanceMap, normalizedRates, billingRange, rangeDays);
}

function buildDocumentStorageEvents(
  inboundDocuments: InboundDocument[],
  outboundDocuments: OutboundDocument[],
  pallets: PalletTrace[],
  palletLocationEvents: PalletLocationEvent[],
  customerId: number | "all",
  containerType: ContainerType | "all" | undefined
) {
  const events: StorageBalanceEvent[] = [];
  const traceCounts = countDocumentTracePallets(inboundDocuments, pallets, customerId);
  const traceOutboundCounts = countTraceOutboundPallets(pallets, palletLocationEvents, customerId);

  for (const document of inboundDocuments) {
    if (!belongsToCustomer(document.customerId, customerId)) {
      continue;
    }
    if (!isBillableDocument(document.status)) {
      continue;
    }
    const documentContainerType = normalizeContainerTypeValue(document.containerType);
    if (containerType && containerType !== "all" && documentContainerType !== containerType) {
      continue;
    }

    const occurredOn = resolveInboundBillingDate(document);
    const documentPallets = sumInboundDocumentPallets(document);
    if (!occurredOn || documentPallets <= 0) {
      continue;
    }

    const containerNo = normalizeContainerNo(document.containerNo);
    const containerKey = buildStorageContainerKey(document.customerId, documentContainerType, containerNo);
    const tracedPallets = consumeDocumentTracePalletCount(traceCounts, document.id, containerKey, documentPallets);
    const documentOnlyPallets = Math.max(documentPallets - tracedPallets, 0);
    if (documentOnlyPallets <= 0) {
      continue;
    }

    events.push({
      id: `inbound-${document.id}`,
      customerId: document.customerId,
      customerName: document.customerName,
      containerNo,
      containerType: documentContainerType,
      locationId: document.locationId,
      locationName: document.locationName,
      occurredOn,
      palletDelta: documentOnlyPallets
    });
  }

  for (const document of outboundDocuments) {
    if (!belongsToCustomer(document.customerId, customerId)) {
      continue;
    }
    if (!isBillableDocument(document.status)) {
      continue;
    }

    const occurredOn = resolveOutboundBillingDate(document);
    if (!occurredOn) {
      continue;
    }

    for (const line of document.lines) {
      line.pickAllocations.forEach((allocation, index) => {
        const pallets = Math.max(allocation.pallets ?? 0, 0);
        if (pallets <= 0 || !allocation.containerNo.trim()) {
          return;
        }

        const consumedTracePallets = consumeTraceOutboundPallets(
          traceOutboundCounts,
          document.customerId,
          allocation.containerNo,
          occurredOn,
          pallets
        );
        const documentOnlyOutboundPallets = pallets - consumedTracePallets;
        if (documentOnlyOutboundPallets <= 0) {
          return;
        }

        events.push({
          id: `outbound-${document.id}-${line.id}-${index}`,
          customerId: document.customerId,
          customerName: document.customerName,
          containerNo: normalizeContainerNo(allocation.containerNo),
          containerType: "NORMAL",
          locationId: allocation.locationId || line.locationId,
          locationName: allocation.locationName || line.locationName,
          occurredOn,
          palletDelta: -documentOnlyOutboundPallets
        });
      });
    }
  }

  return events.sort(compareStorageBalanceEvents);
}

function countDocumentTracePallets(
  inboundDocuments: InboundDocument[],
  pallets: PalletTrace[],
  customerId: number | "all"
) {
  const inboundDocumentIds = new Set(inboundDocuments.map((document) => document.id));
  const byDocumentId = new Map<number, number>();
  const byContainerKey = new Map<string, number>();

  for (const pallet of pallets) {
    if (!belongsToCustomer(pallet.customerId, customerId)) {
      continue;
    }

    if (pallet.sourceInboundDocumentId > 0 && inboundDocumentIds.has(pallet.sourceInboundDocumentId)) {
      byDocumentId.set(pallet.sourceInboundDocumentId, (byDocumentId.get(pallet.sourceInboundDocumentId) ?? 0) + 1);
      continue;
    }

    const containerKey = buildStorageContainerKey(
      pallet.customerId,
      pallet.containerType,
      normalizeContainerNo(pallet.currentContainerNo)
    );
    byContainerKey.set(containerKey, (byContainerKey.get(containerKey) ?? 0) + 1);
  }

  return { byDocumentId, byContainerKey };
}

function consumeDocumentTracePalletCount(
  traceCounts: ReturnType<typeof countDocumentTracePallets>,
  documentId: number,
  containerKey: string,
  documentPallets: number
) {
  let tracedPallets = Math.min(traceCounts.byDocumentId.get(documentId) ?? 0, documentPallets);
  if (tracedPallets >= documentPallets) {
    return tracedPallets;
  }

  const remainingContainerTraces = traceCounts.byContainerKey.get(containerKey) ?? 0;
  const consumedContainerTraces = Math.min(documentPallets - tracedPallets, remainingContainerTraces);
  if (consumedContainerTraces > 0) {
    traceCounts.byContainerKey.set(containerKey, remainingContainerTraces - consumedContainerTraces);
    tracedPallets += consumedContainerTraces;
  }
  return tracedPallets;
}

function countTraceOutboundPallets(
  pallets: PalletTrace[],
  palletLocationEvents: PalletLocationEvent[],
  customerId: number | "all"
) {
  const palletsById = new Map(pallets.map((pallet) => [pallet.id, pallet]));
  const outboundCounts = new Map<string, number>();

  for (const event of palletLocationEvents) {
    if (event.eventType !== "OUTBOUND" || !belongsToCustomer(event.customerId, customerId)) {
      continue;
    }

    const occurredOn = normalizeBusinessCalendarDate(event.eventTime);
    if (!occurredOn) {
      continue;
    }

    const pallet = palletsById.get(event.palletId);
    const containerNo = normalizeContainerNo(event.containerNo || pallet?.currentContainerNo);
    const explicitPalletCount = Math.max(Math.abs(event.palletDelta || 0), 0);
    const palletCount = explicitPalletCount > 0 ? explicitPalletCount : 1;
    if (palletCount <= 0) {
      continue;
    }

    const key = buildTraceOutboundKey(event.customerId, containerNo, occurredOn);
    outboundCounts.set(key, (outboundCounts.get(key) ?? 0) + palletCount);
  }

  return outboundCounts;
}

function consumeTraceOutboundPallets(
  outboundCounts: Map<string, number>,
  customerId: number,
  containerNo: string,
  occurredOn: string,
  requestedPallets: number
) {
  const key = buildTraceOutboundKey(customerId, normalizeContainerNo(containerNo), occurredOn);
  const remainingTracePallets = outboundCounts.get(key) ?? 0;
  const consumedPallets = Math.min(requestedPallets, remainingTracePallets);
  if (consumedPallets > 0) {
    outboundCounts.set(key, remainingTracePallets - consumedPallets);
  }
  return consumedPallets;
}

function getDocumentStorageScope(
  documentEvents: StorageBalanceEvent[],
  locationId: number | "all" | undefined
): DocumentStorageScope {
  const scope: DocumentStorageScope = {
    containerKeys: new Set<string>(),
    customerContainerKeys: new Set<string>()
  };
  if (documentEvents.length === 0) {
    return scope;
  }

  for (const event of documentEvents) {
    if (event.palletDelta <= 0) {
      continue;
    }
    if (locationId && locationId !== "all" && event.locationId !== locationId) {
      continue;
    }

    const containerKey = buildStorageContainerKey(event.customerId, event.containerType, event.containerNo);
    scope.containerKeys.add(containerKey);
    scope.customerContainerKeys.add(buildStorageCustomerContainerKey(event.customerId, event.containerNo));
  }

  return scope;
}

function isDocumentStorageEventInScope(event: StorageBalanceEvent, scope: DocumentStorageScope) {
  if (event.palletDelta > 0) {
    return scope.containerKeys.has(buildStorageContainerKey(event.customerId, event.containerType, event.containerNo));
  }
  return scope.customerContainerKeys.has(buildStorageCustomerContainerKey(event.customerId, event.containerNo));
}

function applyDocumentStorageEvent(
  event: StorageBalanceEvent,
  rowStates: Map<string, DocumentStorageRowState>,
  rowMap: Map<string, MutableStorageRow>,
  locationId: number | "all" | undefined
) {
  const rowKey = resolveDocumentStorageRowKey(event, rowStates);
  let state = rowStates.get(rowKey);

  if (event.palletDelta > 0) {
    if (!state) {
      const row = createMutableStorageRow(event, locationId);
      state = { row, batches: [] };
      rowStates.set(rowKey, state);
      rowMap.set(rowKey, row);
    }

    const start = parseDateLikeValue(event.occurredOn);
    state.batches.push({
      quantity: event.palletDelta,
      start: start ? startOfLocalDay(start) : new Date(0),
      locationId: event.locationId,
      locationName: event.locationName
    });
    state.row.trackedPallets += event.palletDelta;
    state.row.palletsTracked = state.row.trackedPallets;
    return;
  }

  if (!state || event.palletDelta >= 0) {
    return;
  }

  let remaining = Math.abs(event.palletDelta);
  for (const batch of state.batches) {
    if (remaining <= 0) {
      break;
    }
    const consumed = Math.min(batch.quantity, remaining);
    batch.quantity -= consumed;
    remaining -= consumed;
  }
}

function resolveDocumentStorageRowKey(
  event: StorageBalanceEvent,
  rowStates: Map<string, DocumentStorageRowState>
) {
  const exactKey = buildStorageContainerKey(event.customerId, event.containerType, event.containerNo);
  if (event.palletDelta > 0 || rowStates.has(exactKey)) {
    return exactKey;
  }

  for (const [rowKey, state] of rowStates.entries()) {
    if (state.row.customerId === event.customerId && state.row.containerNo === event.containerNo) {
      return rowKey;
    }
  }
  return exactKey;
}

function createMutableStorageRow(
  event: StorageBalanceEvent,
  locationId: number | "all" | undefined
): MutableStorageRow {
  return {
    customerId: event.customerId,
    customerName: event.customerName,
    containerNo: event.containerNo,
    containerType: event.containerType,
    locationId: locationId && locationId !== "all" ? locationId : null,
    locationName: "",
    warehousesTouched: [],
    warehouseSet: new Set<string>(),
    palletIdSet: new Set<number>(),
    trackedPallets: 0,
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
}

function addStorageDay(
  row: MutableStorageRow,
  dayKey: string,
  palletCount: number,
  isGraceDay: boolean,
  locationName: string
) {
  if (row.locationId === null) {
    row.locationName = "";
  } else if (!row.locationName) {
    row.locationName = locationName;
  }
  addWarehouse(row, locationName);
  row.palletDays += palletCount;
  if (isGraceDay) {
    row.freePalletDays += palletCount;
  } else {
    row.billablePalletDays += palletCount;
  }
  row.dailyBalanceMap.set(dayKey, (row.dailyBalanceMap.get(dayKey) ?? 0) + palletCount);
  if (isGraceDay) {
    row.freeDailyBalanceMap.set(dayKey, (row.freeDailyBalanceMap.get(dayKey) ?? 0) + palletCount);
  }
}

function finalizeStorageCharges(
  rowMap: Map<string, MutableStorageRow>,
  dailyBalanceMap: Map<string, number>,
  normalizedRates: BillingRates,
  billingRange: BillingRange,
  rangeDays: number
): StorageChargeResult {
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
        palletsTracked: row.trackedPallets || row.palletIdSet.size,
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
    .sort(compareStorageRows);

  const storageLines = storageRows
    .filter((row) => row.billablePalletDays > 0)
    .map((row) => ({
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
      meta: buildStorageLineMeta(row)
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

function mergeStorageChargeResults(
  traceStorageCharges: StorageChargeResult,
  documentStorageCharges: StorageChargeResult,
  documentOutboundEvents: StorageBalanceEvent[],
  locationId: number | "all" | undefined,
  rates: BillingRates,
  billingRange: BillingRange,
  rangeDays: number
): StorageChargeResult {
  const rowMap = mergeStorageRows([...traceStorageCharges.storageRows, ...documentStorageCharges.storageRows], billingRange);
  applyDocumentOutboundStorageAdjustments(rowMap, documentOutboundEvents, locationId, billingRange);
  recalculateStorageRowTotals(rowMap, billingRange);

  return finalizeStorageCharges(
    rowMap,
    buildStorageDailyBalanceMap(rowMap, billingRange),
    normalizeBillingRates(rates),
    billingRange,
    rangeDays
  );
}

function mergeStorageRows(storageRows: BillingStorageRow[], billingRange: BillingRange) {
  const rowMap = new Map<string, MutableStorageRow>();
  for (const row of storageRows) {
    const rowKey = buildMergedStorageRowKey(row);
    let merged = rowMap.get(rowKey);
    if (!merged) {
      merged = createMutableStorageRowFromStorageRow(row);
      rowMap.set(rowKey, merged);
    }

    merged.trackedPallets += row.palletsTracked;
    merged.palletsTracked = merged.trackedPallets;
    for (const warehouse of row.warehousesTouched.length > 0 ? row.warehousesTouched : [row.locationName]) {
      addWarehouse(merged, warehouse);
    }
    if (!merged.locationName && row.locationName && row.locationId !== null) {
      merged.locationName = row.locationName;
    }

    for (const segment of row.segments) {
      const segmentStart = parseDateLikeValue(segment.startDate);
      const segmentEnd = parseDateLikeValue(segment.endDate);
      if (!segmentStart || !segmentEnd || segment.billedDays <= 0) {
        continue;
      }

      const freePalletCount = segment.freePalletDays / segment.billedDays;
      for (let dayCursor = startOfLocalDay(segmentStart); dayCursor < shiftDay(startOfLocalDay(segmentEnd), 1); dayCursor = shiftDay(dayCursor, 1)) {
        const dayKey = toIsoDateString(dayCursor);
        if (dayCursor < billingRange.start || dayCursor >= billingRange.endExclusive) {
          continue;
        }
        merged.palletDays += segment.dayEndPallets;
        merged.freePalletDays += freePalletCount;
        merged.billablePalletDays += segment.dayEndPallets - freePalletCount;
        merged.dailyBalanceMap.set(dayKey, (merged.dailyBalanceMap.get(dayKey) ?? 0) + segment.dayEndPallets);
        if (freePalletCount > 0) {
          merged.freeDailyBalanceMap.set(dayKey, (merged.freeDailyBalanceMap.get(dayKey) ?? 0) + freePalletCount);
        }
      }
    }
  }
  return rowMap;
}

function applyDocumentOutboundStorageAdjustments(
  rowMap: Map<string, MutableStorageRow>,
  documentOutboundEvents: StorageBalanceEvent[],
  locationId: number | "all" | undefined,
  billingRange: BillingRange
) {
  for (const event of [...documentOutboundEvents].sort(compareStorageBalanceEvents)) {
    if (event.palletDelta >= 0) {
      continue;
    }
    if (locationId && locationId !== "all" && event.locationId !== locationId) {
      continue;
    }

    const row = resolveMergedStorageAdjustmentRow(event, rowMap);
    const eventDate = parseDateLikeValue(event.occurredOn);
    if (!row || !eventDate) {
      continue;
    }

    const reduction = Math.abs(event.palletDelta);
    const adjustmentStart = startOfLocalDay(eventDate);
    const firstDay = adjustmentStart.getTime() < billingRange.start.getTime()
      ? billingRange.start
      : adjustmentStart;
    if ((row.dailyBalanceMap.get(toIsoDateString(firstDay)) ?? 0) <= 0) {
      continue;
    }
    for (let dayCursor = new Date(firstDay); dayCursor < billingRange.endExclusive; dayCursor = shiftDay(dayCursor, 1)) {
      const dayKey = toIsoDateString(dayCursor);
      const currentBalance = row.dailyBalanceMap.get(dayKey) ?? 0;
      if (currentBalance <= 0) {
        continue;
      }

      const nextBalance = Math.max(currentBalance - reduction, 0);
      if (nextBalance > 0) {
        row.dailyBalanceMap.set(dayKey, nextBalance);
      } else {
        row.dailyBalanceMap.delete(dayKey);
      }
    }
  }
}

function resolveMergedStorageAdjustmentRow(
  event: StorageBalanceEvent,
  rowMap: Map<string, MutableStorageRow>
) {
  const exactRow = rowMap.get(buildStorageContainerKey(event.customerId, event.containerType, event.containerNo));
  if (exactRow) {
    return exactRow;
  }

  for (const row of rowMap.values()) {
    if (row.customerId === event.customerId && row.containerNo === event.containerNo) {
      return row;
    }
  }
  return null;
}

function recalculateStorageRowTotals(rowMap: Map<string, MutableStorageRow>, billingRange: BillingRange) {
  for (const row of rowMap.values()) {
    let palletDays = 0;
    let freePalletDays = 0;
    for (let dayCursor = new Date(billingRange.start); dayCursor < billingRange.endExclusive; dayCursor = shiftDay(dayCursor, 1)) {
      const dayKey = toIsoDateString(dayCursor);
      const palletCount = Math.max(row.dailyBalanceMap.get(dayKey) ?? 0, 0);
      if (palletCount <= 0) {
        row.dailyBalanceMap.delete(dayKey);
        row.freeDailyBalanceMap.delete(dayKey);
        continue;
      }

      const freePalletCount = Math.min(Math.max(row.freeDailyBalanceMap.get(dayKey) ?? 0, 0), palletCount);
      row.dailyBalanceMap.set(dayKey, palletCount);
      if (freePalletCount > 0) {
        row.freeDailyBalanceMap.set(dayKey, freePalletCount);
      } else {
        row.freeDailyBalanceMap.delete(dayKey);
      }
      palletDays += palletCount;
      freePalletDays += freePalletCount;
    }

    row.palletDays = palletDays;
    row.freePalletDays = freePalletDays;
    row.billablePalletDays = Math.max(palletDays - freePalletDays, 0);
  }
}

function buildStorageDailyBalanceMap(rowMap: Map<string, MutableStorageRow>, billingRange: BillingRange) {
  const dailyBalanceMap = new Map<string, number>();
  for (let dayCursor = new Date(billingRange.start); dayCursor < billingRange.endExclusive; dayCursor = shiftDay(dayCursor, 1)) {
    const dayKey = toIsoDateString(dayCursor);
    let palletCount = 0;
    for (const row of rowMap.values()) {
      palletCount += row.dailyBalanceMap.get(dayKey) ?? 0;
    }
    if (palletCount > 0) {
      dailyBalanceMap.set(dayKey, palletCount);
    }
  }
  return dailyBalanceMap;
}

function buildMergedStorageRowKey(row: BillingStorageRow) {
  return `${row.customerId}|${row.containerType}|${row.containerNo}`;
}

function createMutableStorageRowFromStorageRow(row: BillingStorageRow): MutableStorageRow {
  return {
    customerId: row.customerId,
    customerName: row.customerName,
    containerNo: row.containerNo,
    containerType: row.containerType,
    locationId: row.locationId,
    locationName: row.locationId === null ? "" : row.locationName,
    warehousesTouched: [],
    warehouseSet: new Set<string>(),
    palletIdSet: new Set<number>(),
    trackedPallets: 0,
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
}

function compareStorageRows(left: BillingStorageRow, right: BillingStorageRow) {
  if (left.customerName !== right.customerName) {
    return left.customerName.localeCompare(right.customerName);
  }
  if (left.containerType !== right.containerType) {
    return left.containerType.localeCompare(right.containerType);
  }
  return left.containerNo.localeCompare(right.containerNo);
}

function buildStorageLineMeta(row: BillingStorageRow) {
  const parts = [
    `${row.palletsTracked} pallets tracked`,
    formatContainerTypeLabel(row.containerType)
  ];

  if (row.freePalletDays > 0) {
    parts.push(`${row.freePalletDays} free pallet-days`);
  }
  if (row.discountAmount > 0) {
    parts.push(`-${formatMoney(row.discountAmount)}`);
  }

  return parts.join(" | ");
}

function getStorageIntervalsForPallet(
  pallet: PalletTrace,
  eventsByPallet: Map<number, PalletLocationEvent[]>,
  intervalsByPalletId: Map<number, StorageInterval[]>
) {
  const cached = intervalsByPalletId.get(pallet.id);
  if (cached) {
    return cached;
  }
  const palletEvents = [...(eventsByPallet.get(pallet.id) ?? [])].sort(compareEventsAscending);
  const intervals = buildStorageIntervals(pallet, palletEvents);
  intervalsByPalletId.set(pallet.id, intervals);
  return intervals;
}

function buildLineageStorageIntervals(
  pallet: PalletTrace,
  palletsById: Map<number, PalletTrace>,
  eventsByPallet: Map<number, PalletLocationEvent[]>,
  intervalsByPalletId: Map<number, StorageInterval[]>
) {
  const lineage: PalletTrace[] = [];
  const seenPalletIds = new Set<number>();
  let current: PalletTrace | undefined = pallet;
  while (current && !seenPalletIds.has(current.id)) {
    lineage.push(current);
    seenPalletIds.add(current.id);
    current = current.parentPalletId > 0 ? palletsById.get(current.parentPalletId) : undefined;
  }
  lineage.reverse();

  const intervals: StorageInterval[] = [];
  for (let index = 0; index < lineage.length; index += 1) {
    const lineagePallet = lineage[index]!;
    const palletIntervals = getStorageIntervalsForPallet(lineagePallet, eventsByPallet, intervalsByPalletId);
    const nextPallet = lineage[index + 1] ?? null;
    const nextPalletFirstStart = nextPallet
      ? getFirstStorageIntervalStart(getStorageIntervalsForPallet(nextPallet, eventsByPallet, intervalsByPalletId))
      : null;
    intervals.push(...truncateStorageIntervals(palletIntervals, nextPalletFirstStart));
  }

  return intervals.sort(compareIntervalsAscending);
}

function getFirstStorageIntervalStart(intervals: StorageInterval[]) {
  return intervals.reduce<Date | null>((earliest, interval) => {
    if (!earliest || interval.start.getTime() < earliest.getTime()) {
      return interval.start;
    }
    return earliest;
  }, null);
}

function truncateStorageIntervals(intervals: StorageInterval[], endExclusive: Date | null) {
  if (!endExclusive) {
    return intervals;
  }

  return intervals.flatMap((interval) => {
    if (interval.start.getTime() >= endExclusive.getTime()) {
      return [];
    }
    const end = interval.end && interval.end.getTime() < endExclusive.getTime()
      ? interval.end
      : endExclusive;
    return [{
      ...interval,
      end
    }];
  });
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

    if (isStorageResumeEvent(event.eventType, event.palletDelta)) {
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

    if (isStorageEndEvent(event.eventType, event.palletDelta) && active && activeStart) {
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

function sumInboundDocumentPallets(document: InboundDocument) {
  return document.lines.reduce((total, line) => total + Math.max(line.pallets, 0), 0);
}

function buildStorageContainerKey(customerId: number, containerType: ContainerType, containerNo: string) {
  return `${customerId}|${containerType}|${containerNo}`;
}

function buildStorageCustomerContainerKey(customerId: number, containerNo: string) {
  return `${customerId}|${containerNo}`;
}

function buildTraceOutboundKey(customerId: number, containerNo: string, occurredOn: string) {
  return `${customerId}|${containerNo}|${occurredOn}`;
}

function resolveInboundBillingDate(document: InboundDocument) {
  return normalizeBusinessCalendarDate(document.actualArrivalDate)
    ?? normalizeIsoCandidate(document.confirmedAt)
    ?? normalizeIsoCandidate(document.createdAt)
    ?? normalizeBusinessCalendarDate(document.expectedArrivalDate);
}

function resolveOutboundBillingDate(document: OutboundDocument) {
  return normalizeBusinessCalendarDate(document.actualShipDate)
    ?? normalizeIsoCandidate(document.confirmedAt)
    ?? normalizeIsoCandidate(document.createdAt)
    ?? normalizeBusinessCalendarDate(document.expectedShipDate);
}

function normalizeIsoCandidate(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }
  const parsed = parseDateLikeValue(typeof value === "string" ? value : value.toISOString());
  return parsed ? toIsoDateString(parsed) : null;
}

function normalizeBusinessCalendarDate(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return toIsoDateString(value);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const directCalendarMatch = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(trimmed);
  if (directCalendarMatch) {
    return directCalendarMatch[1] ?? null;
  }

  const parsed = parseDateLikeValue(trimmed);
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

function compareStorageBalanceEvents(left: StorageBalanceEvent, right: StorageBalanceEvent) {
  const leftTime = parseDateLikeValue(left.occurredOn)?.getTime() ?? 0;
  const rightTime = parseDateLikeValue(right.occurredOn)?.getTime() ?? 0;
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  if (left.palletDelta !== right.palletDelta) {
    return right.palletDelta - left.palletDelta;
  }
  return left.id.localeCompare(right.id);
}

function compareIntervalsAscending(left: StorageInterval, right: StorageInterval) {
  const leftTime = left.start.getTime();
  const rightTime = right.start.getTime();
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return (left.end?.getTime() ?? Number.MAX_SAFE_INTEGER) - (right.end?.getTime() ?? Number.MAX_SAFE_INTEGER);
}

function shiftDay(date: Date, delta: number) {
  const start = startOfLocalDay(date);
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + delta);
}

function isStorageStartEvent(eventType: string) {
  const normalized = eventType.trim().toUpperCase();
  return normalized === "RECEIVED" || normalized === "TRANSFER_IN" || normalized === "REVERSAL";
}

function isStorageResumeEvent(eventType: string, palletDelta = 0) {
  const normalized = eventType.trim().toUpperCase();
  if (normalized === "COUNT") {
    return palletDelta > 0;
  }
  return isStorageStartEvent(normalized);
}

function isStorageEndEvent(eventType: string, palletDelta = 0) {
  const normalized = eventType.trim().toUpperCase();
  if (normalized === "COUNT") {
    return palletDelta < 0;
  }
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
