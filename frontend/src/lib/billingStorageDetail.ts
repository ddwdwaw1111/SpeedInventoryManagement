import type { BillingStorageRow } from "./billingPreview";
import type { BillingInvoiceLineData } from "./types";

export type BillingDailyStorageChargeRow = {
  id: string;
  date: string;
  customerName: string;
  warehouse: string;
  palletDays: number;
  freePalletDays: number;
  billablePalletDays: number;
  grossAmount: number;
  discountAmount: number;
  amount: number;
  sourceLineIds: number[];
  editableLineId?: number;
};

type MutableDailyStorageChargeRow = Omit<BillingDailyStorageChargeRow, "customerName" | "warehouse" | "sourceLineIds" | "editableLineId"> & {
  customerSet: Set<string>;
  warehouseSet: Set<string>;
  sourceLineIdSet: Set<number>;
  editableLineIdSet: Set<number>;
};

type StorageSegmentSource = {
  customerName?: string;
  warehouse?: string;
  sourceLineId?: number;
  editableLineId?: number;
};

type StorageSegmentLike = {
  startDate: string;
  endDate: string;
  dayEndPallets: number;
  billedDays: number;
  palletDays: number;
  freePalletDays?: number;
  billablePalletDays?: number;
  grossAmount?: number;
  discountAmount?: number;
  amount: number;
};

export function buildDailyStorageChargeRowsFromStorageRows(storageRows: BillingStorageRow[]): BillingDailyStorageChargeRow[] {
  const buckets = new Map<string, MutableDailyStorageChargeRow>();

  for (const storageRow of storageRows) {
    const warehouse = storageRow.locationName || storageRow.warehousesTouched.join(", ");
    for (const segment of storageRow.segments) {
      addSegmentToBuckets(buckets, segment, {
        customerName: storageRow.customerName,
        warehouse
      });
    }
  }

  return finalizeDailyStorageRows(buckets);
}

export function buildDailyStorageChargeRowsFromInvoiceLines(
  lines: BillingInvoiceLineData[],
  customerName?: string
): BillingDailyStorageChargeRow[] {
  const buckets = new Map<string, MutableDailyStorageChargeRow>();

  for (const line of lines) {
    if (line.chargeType !== "STORAGE") {
      continue;
    }

    if (line.details?.kind === "STORAGE_DAILY_SUMMARY") {
      addValuesToBucket(buckets, line.details.date || normalizeDate(line.occurredOn) || "-", {
        customerName,
        warehouse: line.details.warehouseName || line.warehouse,
        sourceLineId: line.id,
        editableLineId: line.id,
        palletDays: line.details.palletDays,
        freePalletDays: line.details.freePalletDays ?? 0,
        billablePalletDays: line.details.billablePalletDays ?? Math.max(0, line.details.palletDays - (line.details.freePalletDays ?? 0)),
        grossAmount: line.details.grossAmount ?? roundCurrency(line.amount + (line.details.discountAmount ?? 0)),
        discountAmount: line.details.discountAmount ?? 0,
        amount: line.details.amount
      });
      continue;
    }

    if (line.details?.kind === "STORAGE_CONTAINER_SUMMARY") {
      for (const segment of line.details.segments) {
        addSegmentToBuckets(buckets, segment, {
          customerName,
          warehouse: line.details.warehouseName || line.details.warehousesTouched.join(", ") || line.warehouse,
          sourceLineId: line.id
        });
      }
      continue;
    }

    const fallbackDate = normalizeDate(line.occurredOn) || "-";
    addValuesToBucket(buckets, fallbackDate, {
      customerName,
      warehouse: line.warehouse,
      sourceLineId: line.id,
      editableLineId: line.id,
      palletDays: line.quantity,
      freePalletDays: 0,
      billablePalletDays: line.quantity,
      grossAmount: line.amount,
      discountAmount: 0,
      amount: line.amount
    });
  }

  return finalizeDailyStorageRows(buckets);
}

export function getStorageLineDiscountAmount(line: BillingInvoiceLineData) {
  return line.details?.kind === "STORAGE_CONTAINER_SUMMARY" || line.details?.kind === "STORAGE_DAILY_SUMMARY"
    ? roundCurrency(line.details.discountAmount ?? 0)
    : 0;
}

function addSegmentToBuckets(
  buckets: Map<string, MutableDailyStorageChargeRow>,
  segment: StorageSegmentLike,
  source: StorageSegmentSource
) {
  const days = enumerateIsoDays(segment.startDate, segment.endDate);
  if (days.length === 0) {
    return;
  }

  const palletDays = distributeNumber(segment.palletDays, days.length);
  const freePalletDays = distributeNumber(segment.freePalletDays ?? 0, days.length);
  const billablePalletDays = distributeNumber(segment.billablePalletDays ?? Math.max(0, segment.palletDays - (segment.freePalletDays ?? 0)), days.length);
  const grossAmounts = distributeCurrency(segment.grossAmount ?? roundCurrency(segment.amount + (segment.discountAmount ?? 0)), days.length);
  const discountAmounts = distributeCurrency(segment.discountAmount ?? 0, days.length);
  const amounts = distributeCurrency(segment.amount, days.length);

  days.forEach((date, index) => {
    addValuesToBucket(buckets, date, {
      ...source,
      palletDays: palletDays[index] ?? 0,
      freePalletDays: freePalletDays[index] ?? 0,
      billablePalletDays: billablePalletDays[index] ?? 0,
      grossAmount: grossAmounts[index] ?? 0,
      discountAmount: discountAmounts[index] ?? 0,
      amount: amounts[index] ?? 0
    });
  });
}

function addValuesToBucket(
  buckets: Map<string, MutableDailyStorageChargeRow>,
  date: string,
  values: StorageSegmentSource & {
    palletDays: number;
    freePalletDays: number;
    billablePalletDays: number;
    grossAmount: number;
    discountAmount: number;
    amount: number;
  }
) {
  const bucket = buckets.get(date) ?? {
    id: `storage-day-${date}`,
    date,
    customerSet: new Set<string>(),
    warehouseSet: new Set<string>(),
    palletDays: 0,
    freePalletDays: 0,
    billablePalletDays: 0,
    grossAmount: 0,
    discountAmount: 0,
    amount: 0,
    sourceLineIdSet: new Set<number>(),
    editableLineIdSet: new Set<number>()
  };

  if (values.customerName?.trim()) {
    bucket.customerSet.add(values.customerName.trim());
  }
  if (values.warehouse?.trim()) {
    bucket.warehouseSet.add(values.warehouse.trim());
  }
  if (typeof values.sourceLineId === "number") {
    bucket.sourceLineIdSet.add(values.sourceLineId);
  }
  if (typeof values.editableLineId === "number") {
    bucket.editableLineIdSet.add(values.editableLineId);
  }

  bucket.palletDays += values.palletDays;
  bucket.freePalletDays += values.freePalletDays;
  bucket.billablePalletDays += values.billablePalletDays;
  bucket.grossAmount += values.grossAmount;
  bucket.discountAmount += values.discountAmount;
  bucket.amount += values.amount;
  buckets.set(date, bucket);
}

function finalizeDailyStorageRows(buckets: Map<string, MutableDailyStorageChargeRow>): BillingDailyStorageChargeRow[] {
  return [...buckets.values()]
    .map((bucket) => {
      const editableLineIds = [...bucket.editableLineIdSet];
      return {
        id: bucket.id,
        date: bucket.date,
        customerName: [...bucket.customerSet].sort((left, right) => left.localeCompare(right)).join(", ") || "-",
        warehouse: [...bucket.warehouseSet].sort((left, right) => left.localeCompare(right)).join(", ") || "-",
        palletDays: roundQuantity(bucket.palletDays),
        freePalletDays: roundQuantity(bucket.freePalletDays),
        billablePalletDays: roundQuantity(bucket.billablePalletDays),
        grossAmount: roundCurrency(bucket.grossAmount),
        discountAmount: roundCurrency(bucket.discountAmount),
        amount: roundCurrency(bucket.amount),
        sourceLineIds: [...bucket.sourceLineIdSet].sort((left, right) => left - right),
        editableLineId: editableLineIds.length === 1 ? editableLineIds[0] : undefined
      };
    })
    .filter((row) => row.palletDays > 0 || row.amount !== 0)
    .sort((left, right) => left.date.localeCompare(right.date));
}

function enumerateIsoDays(startDate: string, endDate: string) {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (!start || !end || start.getTime() > end.getTime()) {
    return [];
  }

  const days: string[] = [];
  for (let day = start; day.getTime() <= end.getTime(); day = shiftUtcDay(day, 1)) {
    days.push(formatIsoDate(day));
  }
  return days;
}

function distributeNumber(total: number, count: number) {
  if (count <= 0) {
    return [];
  }
  const value = total / count;
  return Array.from({ length: count }, () => value);
}

function distributeCurrency(total: number, count: number) {
  if (count <= 0) {
    return [];
  }

  const values: number[] = [];
  let allocated = 0;
  for (let index = 0; index < count; index += 1) {
    if (index === count - 1) {
      values.push(roundCurrency(total - allocated));
      continue;
    }
    const value = roundCurrency(total / count);
    allocated = roundCurrency(allocated + value);
    values.push(value);
  }
  return values;
}

function normalizeDate(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(trimmed) ? trimmed.slice(0, 10) : "";
}

function parseIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function shiftUtcDay(value: Date, days: number) {
  const next = new Date(value.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function roundQuantity(value: number) {
  return Math.round(value * 10000) / 10000;
}
