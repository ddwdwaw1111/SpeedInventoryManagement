import { describe, expect, it } from "vitest";

import { buildBillingPreview, DEFAULT_BILLING_RATES } from "./billingPreview";
import type { Customer, InboundDocument, OutboundDocument, PalletLocationEvent, PalletTrace } from "./types";

const customers: Customer[] = [
  {
    id: 1,
    name: "Acme",
    contactName: "",
    email: "",
    phone: "",
    notes: "",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z"
  }
];

describe("buildBillingPreview", () => {
  it("calculates pallet-day storage with day-end balance logic", () => {
    const pallets: PalletTrace[] = [
      {
        id: 1,
        parentPalletId: 0,
        palletCode: "PLT-001",
        containerVisitId: 1,
        sourceInboundDocumentId: 10,
        sourceInboundLineId: 100,
        customerId: 1,
        customerName: "Acme",
        skuMasterId: 11,
        sku: "SKU-1",
        description: "Widget",
        currentLocationId: 1,
        currentLocationName: "NJ",
        currentStorageSection: "A-01",
        currentContainerNo: "CONT-001",
        status: "SHIPPED",
        createdAt: "2026-04-01T09:00:00Z",
        updatedAt: "2026-04-03T10:00:00Z",
        contents: []
      }
    ];

    const events: PalletLocationEvent[] = [
      {
        id: 1,
        palletId: 1,
        palletCode: "PLT-001",
        containerVisitId: 1,
        customerId: 1,
        customerName: "Acme",
        locationId: 1,
        locationName: "NJ",
        storageSection: "A-01",
        containerNo: "CONT-001",
        eventType: "RECEIVED",
        quantityDelta: 100,
        palletDelta: 1,
        eventTime: "2026-04-01T09:00:00Z",
        createdAt: "2026-04-01T09:00:00Z"
      },
      {
        id: 2,
        palletId: 1,
        palletCode: "PLT-001",
        containerVisitId: 1,
        customerId: 1,
        customerName: "Acme",
        locationId: 1,
        locationName: "NJ",
        storageSection: "A-01",
        containerNo: "CONT-001",
        eventType: "OUTBOUND",
        quantityDelta: -100,
        palletDelta: -1,
        eventTime: "2026-04-03T10:00:00Z",
        createdAt: "2026-04-03T10:00:00Z"
      }
    ];

    const inboundDocuments: InboundDocument[] = [
      {
        id: 10,
        customerId: 1,
        customerName: "Acme",
        locationId: 1,
        locationName: "NJ",
        deliveryDate: "2026-04-01",
        containerNo: "CONT-001",
        handlingMode: "PALLETIZED",
        storageSection: "A-01",
        unitLabel: "CTN",
        documentNote: "",
        status: "CONFIRMED",
        trackingStatus: "RECEIVED",
        confirmedAt: "2026-04-01T09:00:00Z",
        cancelNote: "",
        cancelledAt: null,
        archivedAt: null,
        totalLines: 1,
        totalExpectedQty: 100,
        totalReceivedQty: 100,
        createdAt: "2026-04-01T08:00:00Z",
        updatedAt: "2026-04-01T09:00:00Z",
        lines: [
          {
            id: 100,
            documentId: 10,
            sku: "SKU-1",
            description: "Widget",
            storageSection: "A-01",
            reorderLevel: 0,
            expectedQty: 100,
            receivedQty: 100,
            pallets: 1,
            unitsPerPallet: 100,
            palletsDetailCtns: "100",
            palletBreakdown: [{ quantity: 100 }],
            unitLabel: "CTN",
            lineNote: "",
            createdAt: "2026-04-01T08:00:00Z"
          }
        ]
      }
    ];

    const outboundDocuments: OutboundDocument[] = [
      {
        id: 20,
        packingListNo: "SO-001",
        orderRef: "",
        customerId: 1,
        customerName: "Acme",
        outDate: "2026-04-03",
        shipToName: "",
        shipToAddress: "",
        shipToContact: "",
        carrierName: "",
        documentNote: "",
        status: "CONFIRMED",
        trackingStatus: "SHIPPED",
        confirmedAt: "2026-04-03T10:00:00Z",
        cancelNote: "",
        cancelledAt: null,
        archivedAt: null,
        totalLines: 1,
        totalQty: 100,
        totalNetWeightKgs: 0,
        totalGrossWeightKgs: 0,
        storages: "NJ / A-01",
        createdAt: "2026-04-03T08:00:00Z",
        updatedAt: "2026-04-03T10:00:00Z",
        lines: [
          {
            id: 200,
            documentId: 20,
            skuMasterId: 11,
            itemNumber: "ITM-1",
            locationId: 1,
            locationName: "NJ",
            storageSection: "A-01",
            sku: "SKU-1",
            description: "Widget",
            quantity: 100,
            pallets: 1,
            palletsDetailCtns: "100",
            unitLabel: "CTN",
            cartonSizeMm: "",
            netWeightKgs: 0,
            grossWeightKgs: 0,
            lineNote: "",
            pickAllocations: [],
            createdAt: "2026-04-03T08:00:00Z"
          }
        ]
      }
    ];

    const preview = buildBillingPreview({
      month: "2026-04",
      customerId: 1,
      customers,
      pallets,
      palletLocationEvents: events,
      inboundDocuments,
      outboundDocuments,
      rates: DEFAULT_BILLING_RATES
    });

    expect(preview.summary.palletDays).toBe(2);
    expect(preview.summary.storageAmount).toBe(2);
    expect(preview.summary.inboundAmount).toBe(450);
    expect(preview.summary.wrappingAmount).toBe(10);
    expect(preview.summary.outboundAmount).toBe(10);
    expect(preview.summary.grandTotal).toBe(472);
    expect(preview.dailyBalanceRows.slice(0, 4)).toEqual([
      { date: "2026-04-01", palletCount: 1 },
      { date: "2026-04-02", palletCount: 1 },
      { date: "2026-04-03", palletCount: 0 },
      { date: "2026-04-04", palletCount: 0 }
    ]);
  });
});
