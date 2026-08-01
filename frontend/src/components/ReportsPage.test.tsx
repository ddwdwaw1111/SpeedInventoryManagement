import { describe, expect, it } from "vitest";

import { DEFAULT_BILLING_RATES } from "../lib/billingPreview";
import type { BillingWorkspaceContext } from "../lib/billingWorkspaceContext";
import { formatTrendLabel, mapDailyStorageRows, resolveReportDailyStorageRate } from "./ReportsPage";

describe("ReportsPage trend labels", () => {
  it("formats valid report bucket keys", () => {
    expect(formatTrendLabel("2026-07-31", "day")).toBe("Jul 31");
    expect(formatTrendLabel("2026-07", "month")).toBe("Jul 2026");
    expect(formatTrendLabel("2026", "year")).toBe("2026");
  });

  it("uses the key shape when a previous report is rendered during a granularity change", () => {
    expect(formatTrendLabel("2026-07-31", "month")).toBe("Jul 31");
    expect(formatTrendLabel("2026-07", "year")).toBe("Jul 2026");
  });

  it("returns a readable fallback instead of throwing for invalid keys", () => {
    expect(formatTrendLabel("not-a-date", "day")).toBe("not-a-date");
    expect(formatTrendLabel("2026-02-31", "day")).toBe("2026-02-31");
    expect(formatTrendLabel("", "month")).toBe("-");
  });
});

describe("ReportsPage daily storage rows", () => {
  it("calculates the opening balance and daily storage estimate from pallet flow", () => {
    const rows = mapDailyStorageRows([
      {
        dateKey: "2026-07-30",
        label: "Jul 30",
        inbound: 4,
        outbound: 1,
        transferIn: 2,
        transferOut: 2,
        adjustmentDelta: 0,
        endOfDay: 13
      },
      {
        dateKey: "2026-07-31",
        label: "Jul 31",
        inbound: 2,
        outbound: 5,
        transferIn: 2,
        transferOut: 1,
        adjustmentDelta: 0,
        endOfDay: 11
      }
    ], 1.25);

    expect(rows.map((row) => row.openingBalance)).toEqual([10, 13]);
    expect(rows.map((row) => row.storageAmount)).toEqual([16.25, 13.75]);
  });

  it("uses zero for an invalid storage rate", () => {
    const [row] = mapDailyStorageRows([{
      dateKey: "2026-07-31",
      label: "Jul 31",
      inbound: 0,
      outbound: 0,
      transferIn: 0,
      transferOut: 0,
      adjustmentDelta: 0,
      endOfDay: 10
    }], Number.NaN);

    expect(row.storageAmount).toBe(0);
  });
});

describe("ReportsPage daily storage rate", () => {
  const context = (containerType: BillingWorkspaceContext["containerType"]): BillingWorkspaceContext => ({
    startDate: "2026-07-01",
    endDate: "2026-07-31",
    customerId: "all",
    warehouseLocationId: "all",
    containerType,
    normalPalletGracePeriodEnabled: true,
    rates: {
      ...DEFAULT_BILLING_RATES,
      storageFeePerPalletPerWeekNormal: 14,
      storageFeePerPalletPerWeekWestCoastTransfer: 21
    }
  });

  it("uses the shared Billing workspace rate when normal and transfer storage rates match", () => {
    expect(resolveReportDailyStorageRate(null)).toBe(1);
    const sharedRateContext = context("all");
    sharedRateContext.rates.storageFeePerPalletPerWeekWestCoastTransfer = 14;

    expect(resolveReportDailyStorageRate(sharedRateContext)).toBe(2);
  });

  it("requires an explicit rate whenever the Billing workspace has different storage rates", () => {
    expect(resolveReportDailyStorageRate(context("all"))).toBeNull();
    expect(resolveReportDailyStorageRate(context("NORMAL"))).toBeNull();
    expect(resolveReportDailyStorageRate(context("WEST_COAST_TRANSFER"))).toBeNull();
  });
});
