import { describe, expect, it } from "vitest";

import {
  DEFAULT_BILLING_RATES,
  mapAuthoritativeBillingPreview,
  mergeBillingPreviews,
  type BillingPreview
} from "./billingPreview";
import type { BillingPreviewResult } from "./types";

const emptySummary = {
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

describe("authoritative billing preview mapping", () => {
  it("maps nullable backend collections into safe empty display collections", () => {
    const result: BillingPreviewResult = {
      calculationVersion: "container-v1",
      sourceFingerprint: "fingerprint",
      customerId: 1,
      customerName: "Acme",
      containerType: "",
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      normalPalletGracePeriodEnabled: true,
      rates: DEFAULT_BILLING_RATES,
      lines: null,
      storageRows: null,
      dailyBalances: null,
      summary: emptySummary,
      warnings: null
    };

    const preview = mapAuthoritativeBillingPreview(result);

    expect(preview.customerName).toBe("Acme");
    expect(preview.invoiceLines).toEqual([]);
    expect(preview.storageRows).toEqual([]);
    expect(preview.dailyBalanceRows).toEqual([]);
  });

  it("merges backend previews without recalculating charges from frontend documents", () => {
    const first: BillingPreview = {
      startDate: "2026-03-01",
      endDate: "2026-03-31",
      customerId: 1,
      customerName: "Acme",
      invoiceLines: [],
      storageRows: [],
      dailyBalanceRows: [{ date: "2026-03-31", palletCount: 3 }],
      summary: { ...emptySummary, receivedContainers: 1, inboundAmount: 450, grandTotal: 450 },
      warnings: ["Outbound line 11 is unassigned."]
    };
    const second: BillingPreview = {
      ...first,
      customerId: 2,
      customerName: "Bravo",
      dailyBalanceRows: [
        { date: "2026-03-30", palletCount: 2 },
        { date: "2026-03-31", palletCount: 4 }
      ],
      summary: { ...emptySummary, receivedContainers: 2, storageAmount: 24.5, grandTotal: 24.5 },
      warnings: ["Outbound line 11 is unassigned.", "Outbound line 22 is unassigned."]
    };

    const merged = mergeBillingPreviews([first, second], {
      startDate: "2026-03-01",
      endDate: "2026-03-31",
      customerId: "all",
      customerName: "All customers"
    });

    expect(merged.summary).toMatchObject({ receivedContainers: 3, inboundAmount: 450, storageAmount: 24.5, grandTotal: 474.5 });
    expect(merged.dailyBalanceRows).toEqual([
      { date: "2026-03-30", palletCount: 2 },
      { date: "2026-03-31", palletCount: 7 }
    ]);
    expect(merged.warnings).toEqual([
      "Acme: Outbound line 11 is unassigned.",
      "Bravo: Outbound line 11 is unassigned.",
      "Bravo: Outbound line 22 is unassigned."
    ]);
  });
});
