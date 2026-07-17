import { describe, expect, it } from "vitest";

import {
  createCustomer,
  createInboundDocument,
  createInboundDocumentLine,
  createOutboundDocument,
  createOutboundDocumentLine,
  createOutboundPickAllocation
} from "../test/fixtures";
import { buildBillingPreview, DEFAULT_BILLING_RATES } from "./billingPreview";
import type { ContainerLifecycleEvent } from "./types";

const customer = createCustomer({ id: 1, name: "Acme" });

function lifecycleEvent(
  id: number,
  eventTime: string,
  palletDelta: number,
  overrides: Partial<ContainerLifecycleEvent> = {}
): ContainerLifecycleEvent {
  return {
    id,
    stockLedgerId: id,
    customerId: 1,
    customerName: "Acme",
    locationId: 1,
    locationName: "NJ",
    storageSection: "TEMP",
    containerNo: "GCXU5050505",
    eventType: palletDelta >= 0 ? "RECEIVE" : "SHIP",
    eventTime,
    quantityDelta: palletDelta * 100,
    palletDelta,
    skuMasterId: 1,
    sourceDocumentType: palletDelta >= 0 ? "INBOUND" : "OUTBOUND",
    sourceDocumentId: id,
    sourceLineId: id,
    packingListNo: "",
    orderRef: "",
    itemNumber: "SKU-A",
    description: "Widget",
    expectedQty: 0,
    receivedQty: 0,
    pallets: Math.abs(palletDelta),
    documentNote: "",
    reason: "",
    referenceCode: "",
    createdAt: eventTime,
    ...overrides
  };
}

function baseInput(overrides: Partial<Parameters<typeof buildBillingPreview>[0]> = {}) {
  return {
    startDate: "2026-03-01",
    endDate: "2026-03-31",
    customerId: 1 as const,
    customers: [customer],
    containerLifecycleEvents: [] as ContainerLifecycleEvent[],
    inboundDocuments: [],
    outboundDocuments: [],
    rates: DEFAULT_BILLING_RATES,
    ...overrides
  };
}

describe("buildBillingPreview", () => {
  it("calculates container-level pallet-day storage through partial outbound", () => {
    const events = [
      lifecycleEvent(1, "2026-03-03T09:00:00Z", 3),
      lifecycleEvent(2, "2026-03-10T10:00:00Z", -1),
      lifecycleEvent(3, "2026-03-18T14:00:00Z", -1),
      lifecycleEvent(4, "2026-03-20T11:00:00Z", -1)
    ];

    const preview = buildBillingPreview(baseInput({
      containerLifecycleEvents: events,
      normalPalletGracePeriodEnabled: false
    }));

    expect(preview.summary.palletDays).toBe(39);
    expect(preview.summary.storageAmount).toBe(39);
    expect(preview.storageRows).toHaveLength(1);
    expect(preview.storageRows[0]).toMatchObject({
      containerNo: "GCXU5050505",
      palletsTracked: 3,
      palletDays: 39,
      billablePalletDays: 39
    });
    expect(preview.storageRows[0]?.segments.map((segment) => segment.dayEndPallets)).toEqual([3, 2, 1]);
  });

  it("keeps quantity deltas independent from pallet billing deltas", () => {
    const preview = buildBillingPreview(baseInput({
      containerLifecycleEvents: [
        lifecycleEvent(1, "2026-03-03T09:00:00Z", 3, { quantityDelta: 1 }),
        lifecycleEvent(2, "2026-03-10T10:00:00Z", -1, { quantityDelta: -999 })
      ],
      normalPalletGracePeriodEnabled: false
    }));

    expect(preview.storageRows[0]?.palletDays).toBe(65);
    expect(preview.storageRows[0]?.palletsTracked).toBe(3);
  });

  it("uses actual arrival and actual ship dates for document charges", () => {
    const inbound = createInboundDocument({
      id: 10,
      customerId: 1,
      customerName: "Acme",
      containerNo: "GCXU5050505",
      status: "CONFIRMED",
      expectedArrivalDate: "2026-04-01",
      actualArrivalDate: "2026-03-03",
      lines: [createInboundDocumentLine({ pallets: 3 })]
    });
    const outbound = createOutboundDocument({
      id: 20,
      customerId: 1,
      customerName: "Acme",
      status: "CONFIRMED",
      expectedShipDate: "2026-04-01",
      actualShipDate: "2026-03-18",
      lines: [createOutboundDocumentLine({
        pallets: 2,
        pickAllocations: [createOutboundPickAllocation({ containerNo: "GCXU5050505", pallets: 2 })]
      })]
    });

    const preview = buildBillingPreview(baseInput({
      inboundDocuments: [inbound],
      outboundDocuments: [outbound]
    }));

    expect(preview.summary.receivedContainers).toBe(1);
    expect(preview.summary.receivedPallets).toBe(3);
    expect(preview.summary.shippedPallets).toBe(2);
    expect(preview.invoiceLines.filter((line) => line.chargeType === "INBOUND")[0]?.occurredOn).toBe("2026-03-03");
  });

  it("bills repalletized outbound pallets instead of inventory pallet deductions", () => {
    const outbound = createOutboundDocument({
      id: 21,
      customerId: 1,
      customerName: "Acme",
      packingListNo: "PO-21",
      status: "CONFIRMED",
      actualShipDate: "2026-03-18",
      lines: [createOutboundDocumentLine({
        quantity: 10,
        pallets: 3,
        pickAllocations: [
          createOutboundPickAllocation({ containerNo: "CONT-A", allocatedQty: 6, pallets: 1 }),
          createOutboundPickAllocation({ containerNo: "CONT-B", allocatedQty: 4, pallets: 1 })
        ]
      })]
    });

    const preview = buildBillingPreview(baseInput({ outboundDocuments: [outbound] }));
    const outboundLines = preview.invoiceLines.filter((line) => line.chargeType === "OUTBOUND");

    expect(preview.summary.shippedPallets).toBe(3);
    expect(outboundLines.map((line) => line.quantity)).toEqual([2, 1]);
    expect(outboundLines.reduce((total, line) => total + line.quantity, 0)).toBe(3);
  });

  it("supports warehouse-scoped settlement without pallet identities", () => {
    const events = [
      lifecycleEvent(1, "2026-03-05T09:00:00Z", 2),
      lifecycleEvent(2, "2026-03-05T09:00:00Z", 4, {
        locationId: 2,
        locationName: "PA",
        containerNo: "MSCU1234567"
      })
    ];

    const preview = buildBillingPreview(baseInput({
      locationId: 2,
      containerLifecycleEvents: events,
      normalPalletGracePeriodEnabled: false
    }));

    expect(preview.storageRows).toHaveLength(1);
    expect(preview.storageRows[0]?.containerNo).toBe("MSCU1234567");
    expect(preview.storageRows[0]?.palletsTracked).toBe(4);
    expect(preview.dailyBalanceRows[preview.dailyBalanceRows.length - 1]?.palletCount).toBe(4);
  });

  it("returns zero storage when no aggregate lifecycle events exist", () => {
    const preview = buildBillingPreview(baseInput());

    expect(preview.storageRows).toEqual([]);
    expect(preview.summary.palletDays).toBe(0);
    expect(preview.summary.storageAmount).toBe(0);
  });
});
