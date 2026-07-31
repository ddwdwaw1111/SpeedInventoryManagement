import { resolveBillingInvoiceContainerDetails } from "./billingContainerLedger";
import type {
  BillingInvoice,
  BillingInvoiceContainerDetailData,
  BillingInvoiceLineData,
  BillingStorageSegmentDetail
} from "./types";

export type BillingContainerRelease = {
  date: string;
  pallets: number;
};

export type BillingContainerStatement = BillingInvoiceContainerDetailData & {
  receivedOn: string;
  palletMovementAvailable: boolean;
  openingPallets: number;
  receivedPallets: number;
  closingPallets: number;
  releasedPallets: number;
  palletMovementReconciles: boolean;
  releaseEvents: BillingContainerRelease[];
  storageSegments: BillingStorageSegmentDetail[];
  otherAmount: number;
};

export type BillingContainerStatementRow = {
  receivedOn: string;
  containerNo: string;
  warehouses: string;
  openingPallets: number | null;
  receivedPallets: number | null;
  releasedPallets: number | null;
  closingPallets: number | null;
  releaseDate: string;
  segmentStartDate: string;
  segmentEndDate: string;
  palletsOnHand: number | null;
  billedDays: number | null;
  palletDays: number | null;
  freePalletDays: number | null;
  billablePalletDays: number | null;
  storageGrossAmount: number | null;
  storageDiscountAmount: number | null;
  storageFee: number | null;
  otherFees: number | null;
  containerTotal: number | null;
};

type StatementSource = {
  line: BillingInvoiceLineData;
  segments: BillingStorageSegmentDetail[];
};

export function buildBillingContainerStatements(invoice: BillingInvoice): BillingContainerStatement[] {
  const storageSources = new Map<string, StatementSource>();
  const inboundDates = new Map<string, string>();

  for (const line of invoice.lines) {
    const containerNo = normalizeContainerNo(line.containerNo);
    if (!containerNo) continue;
    if (line.chargeType.trim().toUpperCase() === "INBOUND" && line.occurredOn) {
      const current = inboundDates.get(containerNo);
      if (!current || line.occurredOn < current) inboundDates.set(containerNo, line.occurredOn);
    }
    if (line.details?.kind === "STORAGE_CONTAINER_SUMMARY") {
      storageSources.set(containerNo, {
        line,
        segments: [...line.details.segments].sort(compareStorageSegments)
      });
    }
  }

  return resolveBillingInvoiceContainerDetails(invoice).map((detail) => {
    const containerNo = normalizeContainerNo(detail.containerNo);
    const source = storageSources.get(containerNo);
    const segments = source?.segments ?? [];
    const openingPallets = roundQuantity(
      source?.line.details?.openingPallets
      ?? balanceOnDate(segments, invoice.periodStart)
    );
    const closingPallets = roundQuantity(
      source?.line.details?.closingPallets
      ?? balanceOnDate(segments, invoice.periodEnd)
    );
    const releaseEvents = source?.line.details?.palletReleaseEvents
      ? source.line.details.palletReleaseEvents.map((event) => ({
        date: event.date,
        pallets: roundQuantity(event.pallets)
      }))
      : buildReleaseEvents(
        segments,
        invoice.periodStart,
        invoice.periodEnd,
        openingPallets
      );
    const receivedOn = source?.line.details?.receivedOn
      || inboundDates.get(containerNo)
      || segments[0]?.startDate
      || "";
    const palletMovementAvailable = source !== undefined;
    const releasedPallets = roundQuantity(releaseEvents.reduce((sum, event) => sum + event.pallets, 0));
    const receivedPallets = palletMovementAvailable
      ? roundQuantity(closingPallets + releasedPallets - openingPallets)
      : 0;
    const palletMovementReconciles = !palletMovementAvailable
      || (
        receivedPallets >= 0
        && quantitiesEqual(openingPallets + receivedPallets - releasedPallets, closingPallets)
      );

    return {
      ...detail,
      receivedOn,
      palletMovementAvailable,
      openingPallets,
      receivedPallets,
      closingPallets,
      releasedPallets,
      palletMovementReconciles,
      releaseEvents,
      storageSegments: segments,
      otherAmount: roundCurrency(detail.totalAmount - detail.storageAmount)
    };
  }).filter(hasBillingStatementImpact);
}

export function getUnreconciledBillingPalletMovementContainers(statements: BillingContainerStatement[]) {
  return statements
    .filter((statement) => statement.containerNo !== "" && !statement.palletMovementReconciles)
    .map((statement) => statement.containerNo);
}

export function buildBillingContainerStatementRows(
  invoice: BillingInvoice,
  statements = buildBillingContainerStatements(invoice)
): BillingContainerStatementRow[] {
  return statements
    .filter((statement) =>
      statement.storageSegments.length > 0
      || statement.storageAmount !== 0
      || statement.openingPallets !== 0
      || statement.closingPallets !== 0
      || statement.releaseEvents.length > 0
    )
    .flatMap((statement) => buildStatementRows(invoice, statement));
}

function buildStatementRows(invoice: BillingInvoice, statement: BillingContainerStatement) {
  type DatedRow = {
    date: string;
    segment?: BillingStorageSegmentDetail;
    release?: BillingContainerRelease;
  };

  const rowsByDate = new Map<string, DatedRow>();
  for (const segment of statement.storageSegments) {
    rowsByDate.set(segment.startDate, { date: segment.startDate, segment });
  }
  for (const release of statement.releaseEvents) {
    const row = rowsByDate.get(release.date) ?? { date: release.date };
    row.release = release;
    rowsByDate.set(release.date, row);
  }

  const datedRows = [...rowsByDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  if (datedRows.length === 0) {
    datedRows.push({ date: invoice.periodStart });
  }

  return datedRows.map((row, index): BillingContainerStatementRow => {
    const first = index === 0;
    const last = index === datedRows.length - 1;
    const segment = row.segment;
    return {
      receivedOn: first ? statement.receivedOn : "",
      containerNo: first ? (statement.containerNo || "Invoice-level") : "",
      warehouses: first ? (statement.warehouses.join(", ") || "-") : "",
      openingPallets: first && statement.palletMovementAvailable ? statement.openingPallets : null,
      receivedPallets: first && statement.palletMovementAvailable ? statement.receivedPallets : null,
      releasedPallets: row.release?.pallets ?? null,
      closingPallets: last && statement.palletMovementAvailable ? statement.closingPallets : null,
      releaseDate: row.release?.date ?? "",
      segmentStartDate: segment?.startDate ?? "",
      segmentEndDate: segment?.endDate ?? "",
      palletsOnHand: segment?.dayEndPallets ?? null,
      billedDays: segment?.billedDays ?? null,
      palletDays: segment?.palletDays ?? null,
      freePalletDays: segment?.freePalletDays ?? null,
      billablePalletDays: segment?.billablePalletDays ?? segment?.palletDays ?? null,
      storageGrossAmount: segment
        ? roundCurrency(segment.grossAmount ?? segment.amount + (segment.discountAmount ?? 0))
        : (statement.storageSegments.length === 0 && last ? statement.storageGrossAmount : null),
      storageDiscountAmount: segment
        ? roundCurrency(segment.discountAmount ?? 0)
        : (statement.storageSegments.length === 0 && last ? statement.storageDiscountAmount : null),
      storageFee: segment?.amount
        ?? (statement.storageSegments.length === 0 && last ? statement.storageAmount : null),
      otherFees: last ? statement.otherAmount : null,
      containerTotal: last ? statement.totalAmount : null
    };
  });
}

function buildReleaseEvents(
  segments: BillingStorageSegmentDetail[],
  periodStart: string,
  periodEnd: string,
  openingPallets: number
) {
  const balances = buildDailyBalances(segments);
  const events: BillingContainerRelease[] = [];
  let previous = openingPallets;
  for (const date of enumerateIsoDates(periodStart, periodEnd)) {
    const current = balances.get(date) ?? 0;
    if (current < previous) {
      events.push({ date, pallets: roundQuantity(previous - current) });
    }
    previous = current;
  }
  return events;
}

function buildDailyBalances(segments: BillingStorageSegmentDetail[]) {
  const balances = new Map<string, number>();
  for (const segment of segments) {
    for (const date of enumerateIsoDates(segment.startDate, segment.endDate)) {
      balances.set(date, roundQuantity(segment.dayEndPallets));
    }
  }
  return balances;
}

function balanceOnDate(segments: BillingStorageSegmentDetail[], date: string) {
  const segment = segments.find((candidate) => candidate.startDate <= date && candidate.endDate >= date);
  return segment?.dayEndPallets ?? 0;
}

function enumerateIsoDates(startDate: string, endDate: string) {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (!Number.isNaN(cursor.getTime()) && cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function compareStorageSegments(left: BillingStorageSegmentDetail, right: BillingStorageSegmentDetail) {
  if (left.startDate !== right.startDate) return left.startDate.localeCompare(right.startDate);
  return left.endDate.localeCompare(right.endDate);
}

function normalizeContainerNo(value: string) {
  return value.trim().toUpperCase();
}

function hasBillingStatementImpact(statement: BillingContainerStatement) {
  return [
    statement.inboundUnits,
    statement.wrappingPallets,
    statement.palletsTracked,
    statement.palletDays,
    statement.freePalletDays,
    statement.billablePalletDays,
    statement.outboundPallets,
    statement.inboundAmount,
    statement.wrappingAmount,
    statement.storageGrossAmount,
    statement.storageDiscountAmount,
    statement.storageAmount,
    statement.outboundAmount,
    statement.adjustmentAmount,
    statement.totalAmount,
    statement.openingPallets,
    statement.receivedPallets,
    statement.closingPallets,
    statement.releasedPallets
  ].some((value) => !quantitiesEqual(value, 0))
    || statement.releaseEvents.length > 0
    || statement.storageSegments.length > 0;
}

function roundQuantity(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function quantitiesEqual(left: number, right: number) {
  return Math.round(left * 10_000) === Math.round(right * 10_000);
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}
