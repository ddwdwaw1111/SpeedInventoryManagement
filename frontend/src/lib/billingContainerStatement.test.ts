import { describe, expect, it } from "vitest";

import {
  buildBillingContainerStatementRows,
  buildBillingContainerStatements
} from "./billingContainerStatement";
import type { BillingInvoice, BillingInvoiceLineData } from "./types";

function line(overrides: Partial<BillingInvoiceLineData>): BillingInvoiceLineData {
  return {
    id: 1,
    invoiceId: 10,
    chargeType: "STORAGE",
    description: "Container storage pallet-days",
    reference: "",
    containerNo: "CONT-A",
    warehouse: "308",
    occurredOn: "2026-06-30",
    quantity: 578,
    unitRate: 6 / 7,
    amount: 423.43,
    notes: "",
    sourceType: "AUTO",
    sortOrder: 1,
    createdAt: "2026-07-01T00:00:00Z",
    details: {
      kind: "STORAGE_CONTAINER_SUMMARY",
      receivedOn: "2026-03-16",
      warehousesTouched: ["308"],
      openingPallets: 34,
      closingPallets: 4,
      palletReleaseEvents: [{ date: "2026-06-12", pallets: 30 }],
      palletsTracked: 34,
      palletDays: 450,
      freePalletDays: 0,
      billablePalletDays: 450,
      grossAmount: 423.43,
      discountAmount: 0,
      segments: [
        {
          startDate: "2026-06-01",
          endDate: "2026-06-11",
          dayEndPallets: 34,
          billedDays: 11,
          palletDays: 374,
          freePalletDays: 0,
          billablePalletDays: 374,
          grossAmount: 320.57,
          discountAmount: 0,
          amount: 320.57
        },
        {
          startDate: "2026-06-12",
          endDate: "2026-06-30",
          dayEndPallets: 4,
          billedDays: 19,
          palletDays: 76,
          freePalletDays: 0,
          billablePalletDays: 76,
          grossAmount: 102.86,
          discountAmount: 0,
          amount: 102.86
        }
      ]
    },
    ...overrides
  };
}

function invoice(): BillingInvoice {
  return {
    id: 10,
    invoiceNo: "INV-10",
    invoiceType: "MIXED",
    customerId: 1,
    customerNameSnapshot: "Customer",
    warehouseLocationId: null,
    warehouseNameSnapshot: "",
    containerType: "NORMAL",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
    currencyCode: "USD",
    rates: {
      inboundContainerFee: 450,
      transferInboundFeePerPallet: 0,
      wrappingFeePerPallet: 0,
      storageFeePerPalletPerWeek: 6,
      storageFeePerPalletPerWeekNormal: 6,
      storageFeePerPalletPerWeekWestCoastTransfer: 6,
      outboundFeePerPallet: 0
    },
    header: {
      sellerName: "Seller",
      subtitle: "Invoice",
      remitTo: "Seller",
      terms: "Net 30",
      paymentDueDays: 30,
      paymentInstructions: ""
    },
    subtotal: 873.43,
    discountTotal: 0,
    grandTotal: 873.43,
    status: "DRAFT",
    notes: "",
    finalizedAt: null,
    finalizedByUserId: null,
    paidAt: null,
    voidedAt: null,
    createdByUserId: 1,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    lineCount: 2,
    lines: [
      line({}),
      line({
        id: 2,
        chargeType: "INBOUND",
        occurredOn: "2026-03-16",
        quantity: 1,
        unitRate: 450,
        amount: 450,
        details: null
      })
    ]
  };
}

describe("container billing statement", () => {
  it("shows period balances and pallet releases without using invoice references", () => {
    const statements = buildBillingContainerStatements(invoice());

    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatchObject({
      containerNo: "CONT-A",
      receivedOn: "2026-03-16",
      openingPallets: 34,
      releasedPallets: 30,
      closingPallets: 4,
      storageAmount: 423.43,
      otherAmount: 450,
      totalAmount: 873.43,
      releaseEvents: [{ date: "2026-06-12", pallets: 30 }]
    });
  });

  it("exports one auditable row per storage segment", () => {
    const rows = buildBillingContainerStatementRows(invoice());

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      receivedOn: "2026-03-16",
      containerNo: "CONT-A",
      openingPallets: 34,
      segmentStartDate: "2026-06-01",
      segmentEndDate: "2026-06-11",
      palletsOnHand: 34,
      storageGrossAmount: 320.57,
      storageDiscountAmount: 0,
      storageFee: 320.57
    });
    expect(rows[1]).toMatchObject({
      releasedPallets: 30,
      releaseDate: "2026-06-12",
      closingPallets: 4,
      otherFees: 450,
      containerTotal: 873.43
    });
  });

  it("uses the authoritative reconciled storage segment amounts", () => {
    const value = invoice();
    const storageLine = value.lines[0];
    if (!storageLine.details) throw new Error("storage detail fixture is required");
    value.lines = [{
      ...storageLine,
      amount: 1.71,
      details: {
        ...storageLine.details,
        palletDays: 2,
        billablePalletDays: 2,
        grossAmount: 1.71,
        palletReleaseEvents: [],
        segments: [
          {
            startDate: "2026-06-01",
            endDate: "2026-06-01",
            dayEndPallets: 1,
            billedDays: 1,
            palletDays: 1,
            freePalletDays: 0,
            billablePalletDays: 1,
            grossAmount: 0.86,
            discountAmount: 0,
            amount: 0.86
          },
          {
            startDate: "2026-06-03",
            endDate: "2026-06-03",
            dayEndPallets: 1,
            billedDays: 1,
            palletDays: 1,
            freePalletDays: 0,
            billablePalletDays: 1,
            grossAmount: 0.85,
            discountAmount: 0,
            amount: 0.85
          }
        ]
      }
    }];
    value.subtotal = 1.71;
    value.grandTotal = 1.71;

    const rows = buildBillingContainerStatementRows(value);

    expect(rows.map((row) => row.storageFee)).toEqual([0.86, 0.85]);
    expect(rows.map((row) => row.storageGrossAmount)).toEqual([0.86, 0.85]);
    expect(rows.map((row) => row.storageDiscountAmount)).toEqual([0, 0]);
    expect(rows.reduce((total, row) => total + (row.storageFee ?? 0), 0)).toBe(1.71);
  });

  it("keeps a zero-charge row when the period contains actual pallet releases", () => {
    const value = invoice();
    const storageLine = value.lines[0];
    if (!storageLine.details) throw new Error("storage detail fixture is required");
    value.lines = [{
      ...storageLine,
      amount: 0,
      quantity: 0,
      details: {
        ...storageLine.details,
        openingPallets: 1,
        closingPallets: 0,
        palletReleaseEvents: [{ date: "2026-06-01", pallets: 1 }],
        palletDays: 0,
        billablePalletDays: 0,
        grossAmount: 0,
        segments: []
      }
    }];
    value.subtotal = 0;
    value.grandTotal = 0;

    const rows = buildBillingContainerStatementRows(value);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      containerNo: "CONT-A",
      openingPallets: 1,
      releasedPallets: 1,
      closingPallets: 0,
      releaseDate: "2026-06-01",
      storageFee: 0
    });
  });
});
