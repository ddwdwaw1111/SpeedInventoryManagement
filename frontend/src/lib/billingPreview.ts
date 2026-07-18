import { parseDateLikeValue, startOfLocalDay, toIsoDateString } from "./dates";
import { isOperationalInboundDocument } from "./documentTracking";
import { formatMoney } from "./formatters";
import type {
  BillingPreviewResult,
  ContainerLifecycleEvent,
  ContainerType,
  Customer,
  InboundDocument,
  OutboundDocument
} from "./types";

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
  warnings?: string[];
};

type BuildBillingPreviewInput = {
  startDate: string;
  endDate: string;
  customerId: number | "all";
  locationId?: number | "all";
  containerType?: ContainerType | "all";
  normalPalletGracePeriodEnabled?: boolean;
  customers: Customer[];
  containerLifecycleEvents?: ContainerLifecycleEvent[];
  inboundDocuments: InboundDocument[];
  outboundDocuments: OutboundDocument[];
  rates: BillingRates;
};

type BillingRange = {
  startDate: string;
  endDate: string;
  start: Date;
  endInclusive: Date;
  endExclusive: Date;
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
	const outboundLines = buildOutboundInvoiceLines(
		input.outboundDocuments,
		input.customerId,
		input.locationId,
		input.rates,
		billingRange
	);
	const { storageRows, storageLines, dailyBalanceRows } = buildContainerLifecycleStorageCharges(
		input.containerLifecycleEvents ?? [],
		input.inboundDocuments,
		input.customerId,
		input.locationId,
		input.containerType,
		input.normalPalletGracePeriodEnabled ?? true,
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
    shippedPallets,
    palletDays: storageRows.reduce((total, row) => total + row.palletDays, 0),
    inboundAmount: roundCurrency(inboundLines.filter((line) => line.chargeType === "INBOUND").reduce((total, line) => total + line.amount, 0)),
    wrappingAmount: roundCurrency(inboundLines.filter((line) => line.chargeType === "WRAPPING").reduce((total, line) => total + line.amount, 0)),
    storageGrossAmount: roundCurrency(storageRows.reduce((total, row) => total + row.grossAmount, 0)),
    storageDiscountAmount: roundCurrency(storageRows.reduce((total, row) => total + row.discountAmount, 0)),
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
  }, {
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
  });

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

function normalizeContainerType(value: ContainerType | ""): ContainerType {
  return value === "WEST_COAST_TRANSFER" ? "WEST_COAST_TRANSFER" : "NORMAL";
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
    if (!isOperationalInboundDocument(document)) {
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

function buildOutboundInvoiceLines(
	outboundDocuments: OutboundDocument[],
	customerId: number | "all",
	locationId: number | "all" | undefined,
	rates: BillingRates,
	billingRange: BillingRange
) {
	const lines: BillingInvoiceLine[] = [];
	for (const document of outboundDocuments) {
		if (!belongsToCustomer(document.customerId, customerId) || !isBillableDocument(document.status)) {
			continue;
		}
		const occurredOn = resolveOutboundBillingDate(document);
		if (!isWithinRange(occurredOn, billingRange)) {
			continue;
		}

		const groups = new Map<string, { containerNo: string; warehouseSummary: string; pallets: number }>();
		for (const documentLine of document.lines) {
			if (locationId && locationId !== "all" && documentLine.locationId !== locationId) {
				continue;
			}
			const outboundPalletShares = splitOutboundPalletsByQuantity(
				documentLine.pallets,
				documentLine.pickAllocations.map((allocation) => allocation.allocatedQty)
			);
			for (const [allocationIndex, allocation] of documentLine.pickAllocations.entries()) {
				if (locationId && locationId !== "all" && allocation.locationId !== locationId) {
					continue;
				}
				const containerNo = normalizeContainerNo(allocation.containerNo);
				const warehouseSummary = allocation.locationName || documentLine.locationName || "-";
				const key = `${containerNo}|${allocation.locationId || documentLine.locationId}`;
				const group = groups.get(key) ?? { containerNo, warehouseSummary, pallets: 0 };
				group.pallets += outboundPalletShares[allocationIndex] ?? 0;
				groups.set(key, group);
			}
		}

		for (const [key, group] of groups) {
			if (group.pallets <= 0) {
				continue;
			}
			const shipmentReference = document.packingListNo || document.orderRef || String(document.id);
			lines.push({
				id: `outbound-${document.id}-${key}`,
				customerId: document.customerId,
				customerName: document.customerName,
				chargeType: "OUTBOUND",
				reference: `Shipment ${shipmentReference} | ${group.containerNo}`,
				containerNo: group.containerNo,
				warehouseSummary: group.warehouseSummary,
				occurredOn,
				quantity: group.pallets,
				unitRate: rates.outboundFeePerPallet,
				amount: roundCurrency(group.pallets * rates.outboundFeePerPallet),
				meta: `${group.pallets} shipped pallets`
			});
		}
	}
	return lines;
}

function splitOutboundPalletsByQuantity(totalPallets: number, quantities: number[]) {
	const result = new Array<number>(quantities.length).fill(0);
	let remainingPallets = Math.max(0, Math.trunc(totalPallets));
	let remainingQty = quantities.reduce((total, quantity) => total + Math.max(0, quantity), 0);
	if (remainingPallets === 0 || remainingQty === 0) {
		return result;
	}

	for (let index = 0; index < quantities.length; index += 1) {
		const quantity = Math.max(0, quantities[index] ?? 0);
		if (quantity === 0) {
			continue;
		}
		const share = index === quantities.length - 1 || remainingQty <= quantity
			? remainingPallets
			: Math.min(remainingPallets, Math.round(remainingPallets * quantity / remainingQty));
		result[index] = share;
		remainingPallets -= share;
		remainingQty -= quantity;
	}
	return result;
}

function buildContainerLifecycleStorageCharges(
	events: ContainerLifecycleEvent[],
	inboundDocuments: InboundDocument[],
	customerId: number | "all",
	locationId: number | "all" | undefined,
	containerType: ContainerType | "all" | undefined,
	normalPalletGracePeriodEnabled: boolean,
	rates: BillingRates,
	billingRange: BillingRange,
	rangeDays: number
) {
	const normalizedRates = normalizeBillingRates(rates);
	const typeByContainer = new Map<string, ContainerType>();
	for (const document of inboundDocuments) {
		if (!isOperationalInboundDocument(document)) continue;
		typeByContainer.set(
			`${document.customerId}|${normalizeContainerNo(document.containerNo)}`,
			normalizeContainerTypeValue(document.containerType)
		);
	}

	type Group = {
		customerId: number;
		customerName: string;
		containerNo: string;
		containerType: ContainerType;
		events: Array<ContainerLifecycleEvent & { parsedAt: Date }>;
	};
	const groups = new Map<string, Group>();
	for (const event of events) {
		if (!belongsToCustomer(event.customerId, customerId) || !event.palletDelta) continue;
		const parsedAt = parseDateLikeValue(event.eventTime);
		if (!parsedAt || parsedAt >= billingRange.endExclusive) continue;
		const containerNo = normalizeContainerNo(event.containerNo);
		const resolvedType = typeByContainer.get(`${event.customerId}|${containerNo}`) ?? "NORMAL";
		if (containerType && containerType !== "all" && resolvedType !== containerType) continue;
		const key = `${event.customerId}|${resolvedType}|${containerNo}`;
		const group = groups.get(key) ?? {
			customerId: event.customerId,
			customerName: event.customerName,
			containerNo,
			containerType: resolvedType,
			events: []
		};
		group.events.push({ ...event, parsedAt });
		groups.set(key, group);
	}

	const totalDailyBalance = new Map<string, number>();
	const storageRows: BillingStorageRow[] = [];
	for (const group of groups.values()) {
		group.events.sort((left, right) => left.parsedAt.getTime() - right.parsedAt.getTime() || left.id - right.id);
		const balancesByLocation = new Map<number, number>();
		const locationNames = new Map<number, string>();
		const dailyBalanceMap = new Map<string, number>();
		const freeDailyBalanceMap = new Map<string, number>();
		const warehousesTouched = new Set<string>();
		const firstPositiveEvent = group.events.find((event) => event.palletDelta > 0)?.parsedAt ?? null;
		const graceDays = resolveStorageGraceDays(group.containerType, normalPalletGracePeriodEnabled);
		let eventIndex = 0;
		let palletDays = 0;
		let freePalletDays = 0;
		let maximumPallets = 0;

		for (let dayCursor = new Date(billingRange.start); dayCursor < billingRange.endExclusive; dayCursor = shiftDay(dayCursor, 1)) {
			const nextDay = shiftDay(dayCursor, 1);
			while (eventIndex < group.events.length && group.events[eventIndex].parsedAt < nextDay) {
				const event = group.events[eventIndex];
				const nextBalance = Math.max(0, (balancesByLocation.get(event.locationId) ?? 0) + event.palletDelta);
				balancesByLocation.set(event.locationId, nextBalance);
				locationNames.set(event.locationId, event.locationName || `Warehouse #${event.locationId}`);
				eventIndex += 1;
			}

			let dayEndPallets = 0;
			for (const [eventLocationId, balance] of balancesByLocation) {
				if (balance <= 0 || (locationId && locationId !== "all" && eventLocationId !== locationId)) continue;
				dayEndPallets += balance;
				warehousesTouched.add(locationNames.get(eventLocationId) ?? `Warehouse #${eventLocationId}`);
			}
			if (dayEndPallets <= 0) continue;

			const dayKey = toIsoDateString(dayCursor);
			const graceEnd = firstPositiveEvent ? shiftDay(firstPositiveEvent, graceDays) : null;
			const isGraceDay = graceDays > 0 && graceEnd !== null && dayCursor < graceEnd;
			dailyBalanceMap.set(dayKey, dayEndPallets);
			totalDailyBalance.set(dayKey, (totalDailyBalance.get(dayKey) ?? 0) + dayEndPallets);
			palletDays += dayEndPallets;
			maximumPallets = Math.max(maximumPallets, dayEndPallets);
			if (isGraceDay) {
				freeDailyBalanceMap.set(dayKey, dayEndPallets);
				freePalletDays += dayEndPallets;
			}
		}

		if (palletDays <= 0) continue;
		const storageRatePerDay = resolveStorageRatePerDay(group.containerType, normalizedRates);
		const segments = buildStorageSegments(dailyBalanceMap, freeDailyBalanceMap, billingRange, storageRatePerDay);
		const grossAmount = roundCurrency(palletDays * storageRatePerDay);
		const discountAmount = roundCurrency(freePalletDays * storageRatePerDay);
		storageRows.push({
			customerId: group.customerId,
			customerName: group.customerName,
			containerNo: group.containerNo,
			containerType: group.containerType,
			locationId: locationId && locationId !== "all" ? locationId : null,
			locationName: [...warehousesTouched].sort().join(", "),
			warehousesTouched: [...warehousesTouched].sort(),
			palletsTracked: maximumPallets,
			palletDays,
			freePalletDays,
			billablePalletDays: palletDays - freePalletDays,
			averageDailyPallets: roundQuantity(palletDays / rangeDays),
			firstActivityAt: segments[0]?.startDate ?? null,
			lastActivityAt: segments[segments.length - 1]?.endDate ?? null,
			grossAmount,
			discountAmount,
			amount: roundCurrency(grossAmount - discountAmount),
			segments
		});
	}

	storageRows.sort((left, right) => left.customerName.localeCompare(right.customerName) || left.containerNo.localeCompare(right.containerNo));
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
		meta: buildStorageLineMeta(row)
	}));
	const dailyBalanceRows: BillingDailyBalanceRow[] = [];
	for (let dayCursor = new Date(billingRange.start); dayCursor < billingRange.endExclusive; dayCursor = shiftDay(dayCursor, 1)) {
		const date = toIsoDateString(dayCursor);
		dailyBalanceRows.push({ date, palletCount: totalDailyBalance.get(date) ?? 0 });
	}
	return { storageRows, storageLines, dailyBalanceRows };
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

function shiftDay(date: Date, delta: number) {
  const start = startOfLocalDay(date);
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + delta);
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function roundQuantity(value: number) {
  return Math.round(value * 100) / 100;
}
