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
        actualArrivalDate: "2026-04-01",
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
        expectedArrivalDate: "2026-04-01",
        actualArrivalDate: null,
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
        expectedShipDate: "2026-04-03",
        actualShipDate: null,
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
            pickPallets: [],
            pickAllocations: [],
            createdAt: "2026-04-03T08:00:00Z"
          }
        ]
      }
    ];

    const preview = buildBillingPreview({
      startDate: "2026-04-01",
      endDate: "2026-04-30",
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

  it("builds storage segments when pallet counts change inside the billing period", () => {
    const pallets: PalletTrace[] = Array.from({ length: 10 }, (_, index) => {
      const palletId = index + 1;
      const shipped = palletId > 5;
      return {
        id: palletId,
        parentPalletId: 0,
        palletCode: `PLT-${String(palletId).padStart(3, "0")}`,
        containerVisitId: 1,
        sourceInboundDocumentId: 10,
        sourceInboundLineId: 100,
        actualArrivalDate: "2026-03-01",
        customerId: 1,
        customerName: "Acme",
        skuMasterId: 11,
        sku: "SKU-1",
        description: "Widget",
        currentLocationId: 1,
        currentLocationName: "NJ",
        currentStorageSection: "A-01",
        currentContainerNo: "CONT-SEG",
        status: shipped ? "SHIPPED" : "STORED",
        createdAt: "2026-03-01T09:00:00Z",
        updatedAt: shipped ? "2026-03-15T09:00:00Z" : "2026-03-31T09:00:00Z",
        contents: []
      };
    });

    const palletLocationEvents: PalletLocationEvent[] = pallets.flatMap((pallet) => {
      const receivedEvent: PalletLocationEvent = {
        id: pallet.id * 10,
        palletId: pallet.id,
        palletCode: pallet.palletCode,
        containerVisitId: 1,
        customerId: 1,
        customerName: "Acme",
        locationId: 1,
        locationName: "NJ",
        storageSection: "A-01",
        containerNo: "CONT-SEG",
        eventType: "RECEIVED",
        quantityDelta: 100,
        palletDelta: 1,
        eventTime: "2026-03-01T09:00:00Z",
        createdAt: "2026-03-01T09:00:00Z"
      };

      if (pallet.status !== "SHIPPED") {
        return [receivedEvent];
      }

      const outboundEvent: PalletLocationEvent = {
        id: pallet.id * 10 + 1,
        palletId: pallet.id,
        palletCode: pallet.palletCode,
        containerVisitId: 1,
        customerId: 1,
        customerName: "Acme",
        locationId: 1,
        locationName: "NJ",
        storageSection: "A-01",
        containerNo: "CONT-SEG",
        eventType: "OUTBOUND",
        quantityDelta: -100,
        palletDelta: -1,
        eventTime: "2026-03-15T09:00:00Z",
        createdAt: "2026-03-15T09:00:00Z"
      };

      return [receivedEvent, outboundEvent];
    });

    const preview = buildBillingPreview({
      startDate: "2026-03-01",
      endDate: "2026-03-31",
      customerId: 1,
      customers,
      pallets,
      palletLocationEvents,
      inboundDocuments: [],
      outboundDocuments: [],
      rates: DEFAULT_BILLING_RATES
    });

    expect(preview.summary.palletDays).toBe(225);
    expect(preview.summary.storageAmount).toBe(225);
    expect(preview.storageRows).toHaveLength(1);
    expect(preview.storageRows[0]?.segments).toEqual([
      {
        startDate: "2026-03-01",
        endDate: "2026-03-14",
        dayEndPallets: 10,
        billedDays: 14,
        palletDays: 140,
        amount: 140
      },
      {
        startDate: "2026-03-15",
        endDate: "2026-03-31",
        dayEndPallets: 5,
        billedDays: 17,
        palletDays: 85,
        amount: 85
      }
    ]);
  });

  it("uses actualArrivalDate for inbound billing instead of expected arrival date", () => {
    const preview = buildBillingPreview({
      startDate: "2026-04-01",
      endDate: "2026-04-30",
      customerId: 1,
      customers,
      pallets: [],
      palletLocationEvents: [],
      inboundDocuments: [
        {
          id: 30,
          customerId: 1,
          customerName: "Acme",
          locationId: 1,
          locationName: "NJ",
          expectedArrivalDate: "2026-03-31",
          actualArrivalDate: "2026-04-02",
          containerNo: "CONT-030",
          handlingMode: "PALLETIZED",
          storageSection: "TEMP",
          unitLabel: "CTN",
          documentNote: "",
          status: "CONFIRMED",
          trackingStatus: "RECEIVED",
          confirmedAt: "2026-04-03T09:00:00Z",
          cancelNote: "",
          cancelledAt: null,
          archivedAt: null,
          totalLines: 1,
          totalExpectedQty: 100,
          totalReceivedQty: 100,
          createdAt: "2026-03-31T08:00:00Z",
          updatedAt: "2026-04-03T09:00:00Z",
          lines: [
            {
              id: 301,
              documentId: 30,
              sku: "SKU-1",
              description: "Widget",
              storageSection: "TEMP",
              reorderLevel: 0,
              expectedQty: 100,
              receivedQty: 100,
              pallets: 1,
              unitsPerPallet: 100,
              palletsDetailCtns: "100",
              palletBreakdown: [{ quantity: 100 }],
              unitLabel: "CTN",
              lineNote: "",
              createdAt: "2026-03-31T08:00:00Z"
            }
          ]
        }
      ],
      outboundDocuments: [],
      rates: DEFAULT_BILLING_RATES
    });

    expect(preview.invoiceLines).toHaveLength(2);
    expect(preview.invoiceLines[0]?.occurredOn).toBe("2026-04-02");
    expect(preview.invoiceLines[1]?.occurredOn).toBe("2026-04-02");
  });

  it("uses actualShipDate for outbound billing instead of business ship date", () => {
    const preview = buildBillingPreview({
      startDate: "2026-04-01",
      endDate: "2026-04-30",
      customerId: 1,
      customers,
      pallets: [],
      palletLocationEvents: [],
      inboundDocuments: [],
      outboundDocuments: [
        {
          id: 40,
          packingListNo: "SO-040",
          orderRef: "",
          customerId: 1,
          customerName: "Acme",
          expectedShipDate: "2026-03-31",
          actualShipDate: "2026-04-01",
          shipToName: "",
          shipToAddress: "",
          shipToContact: "",
          carrierName: "",
          documentNote: "",
          status: "CONFIRMED",
          trackingStatus: "SHIPPED",
          confirmedAt: "2026-04-02T10:00:00Z",
          cancelNote: "",
          cancelledAt: null,
          archivedAt: null,
          totalLines: 1,
          totalQty: 100,
          totalNetWeightKgs: 0,
          totalGrossWeightKgs: 0,
          storages: "NJ / A-01",
          createdAt: "2026-03-31T08:00:00Z",
          updatedAt: "2026-04-02T10:00:00Z",
          lines: [
            {
              id: 401,
              documentId: 40,
              skuMasterId: 11,
              itemNumber: "ITM-1",
              locationId: 1,
              locationName: "NJ",
              storageSection: "A-01",
              sku: "SKU-1",
              description: "Widget",
              quantity: 100,
              pallets: 2,
              palletsDetailCtns: "2*50",
              unitLabel: "CTN",
              cartonSizeMm: "",
              netWeightKgs: 0,
              grossWeightKgs: 0,
              lineNote: "",
              pickPallets: [],
              pickAllocations: [],
              createdAt: "2026-03-31T08:00:00Z"
            }
          ]
        }
      ],
      rates: DEFAULT_BILLING_RATES
    });

    expect(preview.invoiceLines).toHaveLength(1);
    expect(preview.invoiceLines[0]?.occurredOn).toBe("2026-04-01");
  });
});
