import { describe, expect, it } from "vitest";

import { buildBillingPreview, DEFAULT_BILLING_RATES } from "./billingPreview";
import type { BillingRates } from "./billingPreview";
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
        containerType: "NORMAL",
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
        containerType: "NORMAL",
        handlingMode: "PALLETIZED",
        storageSection: "A-01",
        unitLabel: "CTN",
        documentNote: "",
        status: "CONFIRMED",
        trackingStatus: "RECEIVED",
        confirmedAt: "2026-04-01T09:00:00Z",
        deletedAt: null,
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
        deletedAt: null,
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
    expect(preview.summary.storageAmount).toBe(0);
    expect(preview.summary.inboundAmount).toBe(450);
    expect(preview.summary.wrappingAmount).toBe(15);
    expect(preview.summary.outboundAmount).toBe(0);
    expect(preview.summary.grandTotal).toBe(465);
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
        containerType: "NORMAL",
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
    expect(preview.summary.storageGrossAmount).toBe(225);
    expect(preview.summary.storageDiscountAmount).toBe(70);
    expect(preview.summary.storageAmount).toBe(155);
    expect(preview.storageRows).toHaveLength(1);
    expect(preview.storageRows[0]?.segments).toEqual([
      {
        startDate: "2026-03-01",
        endDate: "2026-03-07",
        dayEndPallets: 10,
        billedDays: 7,
        palletDays: 70,
        freePalletDays: 70,
        billablePalletDays: 0,
        grossAmount: 70,
        discountAmount: 70,
        amount: 0
      },
      {
        startDate: "2026-03-08",
        endDate: "2026-03-14",
        dayEndPallets: 10,
        billedDays: 7,
        palletDays: 70,
        freePalletDays: 0,
        billablePalletDays: 70,
        grossAmount: 70,
        discountAmount: 0,
        amount: 70
      },
      {
        startDate: "2026-03-15",
        endDate: "2026-03-31",
        dayEndPallets: 5,
        billedDays: 17,
        palletDays: 85,
        freePalletDays: 0,
        billablePalletDays: 85,
        grossAmount: 85,
        discountAmount: 0,
        amount: 85
      }
    ]);
  });

  it("supports warehouse-scoped storage settlement using location-aware pallet-day segments", () => {
    const pallets: PalletTrace[] = [
      {
        id: 1,
        parentPalletId: 0,
        palletCode: "PLT-LOC-001",
        containerVisitId: 1,
        sourceInboundDocumentId: 10,
        sourceInboundLineId: 100,
        actualArrivalDate: "2026-03-01",
        customerId: 1,
        customerName: "Acme",
        skuMasterId: 11,
        sku: "SKU-1",
        description: "Widget",
        currentLocationId: 2,
        currentLocationName: "LA",
        currentStorageSection: "B-01",
        currentContainerNo: "CONT-LOC",
        containerType: "NORMAL",
        status: "STORED",
        createdAt: "2026-03-01T09:00:00Z",
        updatedAt: "2026-03-31T09:00:00Z",
        contents: []
      }
    ];

    const events: PalletLocationEvent[] = [
      {
        id: 1,
        palletId: 1,
        palletCode: "PLT-LOC-001",
        containerVisitId: 1,
        customerId: 1,
        customerName: "Acme",
        locationId: 1,
        locationName: "NJ",
        storageSection: "A-01",
        containerNo: "CONT-LOC",
        eventType: "RECEIVED",
        quantityDelta: 100,
        palletDelta: 1,
        eventTime: "2026-03-01T09:00:00Z",
        createdAt: "2026-03-01T09:00:00Z"
      },
      {
        id: 2,
        palletId: 1,
        palletCode: "PLT-LOC-001",
        containerVisitId: 1,
        customerId: 1,
        customerName: "Acme",
        locationId: 1,
        locationName: "NJ",
        storageSection: "A-01",
        containerNo: "CONT-LOC",
        eventType: "TRANSFER_OUT",
        quantityDelta: 0,
        palletDelta: 0,
        eventTime: "2026-03-15T09:00:00Z",
        createdAt: "2026-03-15T09:00:00Z"
      },
      {
        id: 3,
        palletId: 1,
        palletCode: "PLT-LOC-001",
        containerVisitId: 1,
        customerId: 1,
        customerName: "Acme",
        locationId: 2,
        locationName: "LA",
        storageSection: "B-01",
        containerNo: "CONT-LOC",
        eventType: "TRANSFER_IN",
        quantityDelta: 0,
        palletDelta: 0,
        eventTime: "2026-03-15T09:00:00Z",
        createdAt: "2026-03-15T09:00:00Z"
      }
    ];

    const njPreview = buildBillingPreview({
      startDate: "2026-03-01",
      endDate: "2026-03-31",
      customerId: 1,
      locationId: 1,
      customers,
      pallets,
      palletLocationEvents: events,
      inboundDocuments: [],
      outboundDocuments: [],
      rates: DEFAULT_BILLING_RATES
    });

    expect(njPreview.summary.palletDays).toBe(14);
    expect(njPreview.storageRows).toHaveLength(1);
    expect(njPreview.storageRows[0]?.locationId).toBe(1);
    expect(njPreview.storageRows[0]?.locationName).toBe("NJ");
    expect(njPreview.storageRows[0]?.segments).toEqual([
      {
        startDate: "2026-03-01",
        endDate: "2026-03-07",
        dayEndPallets: 1,
        billedDays: 7,
        palletDays: 7,
        freePalletDays: 7,
        billablePalletDays: 0,
        grossAmount: 7,
        discountAmount: 7,
        amount: 0
      },
      {
        startDate: "2026-03-08",
        endDate: "2026-03-14",
        dayEndPallets: 1,
        billedDays: 7,
        palletDays: 7,
        freePalletDays: 0,
        billablePalletDays: 7,
        grossAmount: 7,
        discountAmount: 0,
        amount: 7
      }
    ]);

    const laPreview = buildBillingPreview({
      startDate: "2026-03-01",
      endDate: "2026-03-31",
      customerId: 1,
      locationId: 2,
      customers,
      pallets,
      palletLocationEvents: events,
      inboundDocuments: [],
      outboundDocuments: [],
      rates: DEFAULT_BILLING_RATES
    });

    expect(laPreview.summary.palletDays).toBe(17);
    expect(laPreview.storageRows).toHaveLength(1);
    expect(laPreview.storageRows[0]?.locationId).toBe(2);
    expect(laPreview.storageRows[0]?.locationName).toBe("LA");
    expect(laPreview.storageRows[0]?.segments).toEqual([
      {
        startDate: "2026-03-15",
        endDate: "2026-03-31",
        dayEndPallets: 1,
        billedDays: 17,
        palletDays: 17,
        freePalletDays: 0,
        billablePalletDays: 17,
        grossAmount: 17,
        discountAmount: 0,
        amount: 17
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
          containerType: "NORMAL",
          handlingMode: "PALLETIZED",
          storageSection: "TEMP",
          unitLabel: "CTN",
          documentNote: "",
          status: "CONFIRMED",
          trackingStatus: "RECEIVED",
          confirmedAt: "2026-04-03T09:00:00Z",
          deletedAt: null,
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
          deletedAt: null,
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

  it("does not pull an April 1 receipt into the March billing window when the arrival date carries a timezone offset", () => {
    const preview = buildBillingPreview({
      startDate: "2026-03-01",
      endDate: "2026-03-31",
      customerId: 1,
      customers,
      pallets: [],
      palletLocationEvents: [],
      inboundDocuments: [
        {
          id: 45,
          customerId: 1,
          customerName: "Acme",
          locationId: 1,
          locationName: "NJ",
          expectedArrivalDate: "2026-04-01T00:00:00+00:00",
          actualArrivalDate: "2026-04-01T00:00:00+00:00",
          containerNo: "CONT-045",
          containerType: "NORMAL",
          handlingMode: "PALLETIZED",
          storageSection: "TEMP",
          unitLabel: "CTN",
          documentNote: "",
          status: "CONFIRMED",
          trackingStatus: "RECEIVED",
          confirmedAt: "2026-04-01T01:00:00Z",
          deletedAt: null,
          archivedAt: null,
          totalLines: 1,
          totalExpectedQty: 100,
          totalReceivedQty: 100,
          createdAt: "2026-04-01T01:00:00Z",
          updatedAt: "2026-04-01T01:00:00Z",
          lines: [
            {
              id: 451,
              documentId: 45,
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
              createdAt: "2026-04-01T01:00:00Z"
            }
          ]
        }
      ],
      outboundDocuments: [],
      rates: DEFAULT_BILLING_RATES
    });

    expect(preview.invoiceLines).toHaveLength(0);
    expect(preview.summary.inboundAmount).toBe(0);
    expect(preview.summary.wrappingAmount).toBe(0);
  });

  it("charges transfer inbound per pallet and skips wrapping", () => {
    const preview = buildBillingPreview({
      startDate: "2026-04-01",
      endDate: "2026-04-30",
      customerId: 1,
      customers,
      pallets: [],
      palletLocationEvents: [],
      inboundDocuments: [
        {
          id: 50,
          customerId: 1,
          customerName: "Acme",
          locationId: 1,
          locationName: "NJ",
          expectedArrivalDate: "2026-04-05",
          actualArrivalDate: "2026-04-05",
          containerNo: "CONT-050",
          containerType: "WEST_COAST_TRANSFER",
          handlingMode: "PALLETIZED",
          storageSection: "TEMP",
          unitLabel: "CTN",
          documentNote: "",
          status: "CONFIRMED",
          trackingStatus: "RECEIVED",
          confirmedAt: "2026-04-05T09:00:00Z",
          deletedAt: null,
          archivedAt: null,
          totalLines: 1,
          totalExpectedQty: 300,
          totalReceivedQty: 300,
          createdAt: "2026-04-05T08:00:00Z",
          updatedAt: "2026-04-05T09:00:00Z",
          lines: [
            {
              id: 501,
              documentId: 50,
              sku: "SKU-1",
              description: "Widget",
              storageSection: "TEMP",
              reorderLevel: 0,
              expectedQty: 300,
              receivedQty: 300,
              pallets: 3,
              unitsPerPallet: 100,
              palletsDetailCtns: "3*100",
              palletBreakdown: [{ quantity: 100 }, { quantity: 100 }, { quantity: 100 }],
              unitLabel: "CTN",
              lineNote: "",
              createdAt: "2026-04-05T08:00:00Z"
            }
          ]
        }
      ],
      outboundDocuments: [],
      rates: DEFAULT_BILLING_RATES
    });

    expect(preview.summary.inboundAmount).toBe(30);
    expect(preview.summary.wrappingAmount).toBe(0);
    expect(preview.invoiceLines.filter((line) => line.chargeType === "WRAPPING")).toHaveLength(0);
    expect(preview.invoiceLines.find((line) => line.chargeType === "INBOUND")).toMatchObject({
      quantity: 3,
      unitRate: 10,
      amount: 30
    });
  });

  describe("edge cases", () => {
    // ──────────────────────────────────────────────────────────────
    // Empty / zero-data
    // ──────────────────────────────────────────────────────────────

    it("returns zeroed summary and empty collections for completely empty input", () => {
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers: [],
        pallets: [],
        palletLocationEvents: [],
        inboundDocuments: [],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.invoiceLines).toHaveLength(0);
      expect(preview.storageRows).toHaveLength(0);
      expect(preview.summary.grandTotal).toBe(0);
      expect(preview.summary.palletDays).toBe(0);
      // Daily balance rows still produced for every day in the range (31 days in March)
      expect(preview.dailyBalanceRows).toHaveLength(31);
      expect(preview.dailyBalanceRows.every((row) => row.palletCount === 0)).toBe(true);
    });

    // ──────────────────────────────────────────────────────────────
    // Billability guards — status & date range
    // ──────────────────────────────────────────────────────────────

    it("skips DELETED inbound documents", () => {
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
        pallets: [],
        palletLocationEvents: [],
        inboundDocuments: [makeInboundDoc(1, 1, { status: "DELETED", actualArrivalDate: "2026-03-05" })],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.invoiceLines).toHaveLength(0);
      expect(preview.summary.inboundAmount).toBe(0);
    });

    it("excludes an inbound document whose billing date falls before the range startDate", () => {
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
        pallets: [],
        palletLocationEvents: [],
        inboundDocuments: [makeInboundDoc(1, 1, { actualArrivalDate: "2026-02-28" })],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.invoiceLines).toHaveLength(0);
    });

    it("includes an inbound document arriving on the billing range endDate (inclusive boundary)", () => {
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
        pallets: [],
        palletLocationEvents: [],
        inboundDocuments: [makeInboundDoc(1, 1, { actualArrivalDate: "2026-03-31", pallets: 3 })],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      // Expect INBOUND + WRAPPING lines both dated on Mar 31
      expect(preview.invoiceLines).toHaveLength(2);
      expect(preview.invoiceLines.every((line) => line.occurredOn === "2026-03-31")).toBe(true);
    });

    // ──────────────────────────────────────────────────────────────
    // Zero-pallet documents
    // ──────────────────────────────────────────────────────────────

    it("generates only the container fee and no wrapping line when an inbound document has 0 pallets", () => {
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
        pallets: [],
        palletLocationEvents: [],
        inboundDocuments: [makeInboundDoc(1, 1, { actualArrivalDate: "2026-03-05", pallets: 0 })],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.invoiceLines).toHaveLength(1);
      expect(preview.invoiceLines[0]?.chargeType).toBe("INBOUND");
      expect(preview.summary.wrappingAmount).toBe(0);
    });

    it("generates no invoice line for an outbound document with 0 pallets", () => {
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
        pallets: [],
        palletLocationEvents: [],
        inboundDocuments: [],
        outboundDocuments: [makeOutboundDoc(1, 1, { actualShipDate: "2026-03-10", pallets: 0 })],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.invoiceLines).toHaveLength(0);
    });

    // ──────────────────────────────────────────────────────────────
    // Customer scoping
    // ──────────────────────────────────────────────────────────────

    it("customerId filter excludes documents and pallets belonging to other customers", () => {
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: 1,
        customers,
        pallets: [makePallet(10, 2, "CONT-CX2")],
        palletLocationEvents: [makeEvent(10, 10, "PLT-010", "CONT-CX2", "RECEIVED", "2026-03-01T09:00:00Z", 1, 10, 2)],
        inboundDocuments: [
          makeInboundDoc(1, 1, { actualArrivalDate: "2026-03-05", containerNo: "CONT-CX1" }),
          makeInboundDoc(2, 2, { actualArrivalDate: "2026-03-05", containerNo: "CONT-CX2" })
        ],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      // Only customer 1's INBOUND + WRAPPING lines should appear; customer 2 excluded
      expect(preview.invoiceLines.every((line) => line.customerId === 1)).toBe(true);
      // Storage row for customer 2's pallet excluded
      expect(preview.storageRows.every((row) => row.customerId === 1)).toBe(true);
    });

    it("customerId all aggregates invoice lines across all customers", () => {
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
        pallets: [],
        palletLocationEvents: [],
        inboundDocuments: [
          makeInboundDoc(1, 1, { actualArrivalDate: "2026-03-05" }),
          makeInboundDoc(2, 2, { actualArrivalDate: "2026-03-10" })
        ],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      // 2 customers × (INBOUND + WRAPPING) = 4 lines
      expect(preview.invoiceLines).toHaveLength(4);
      expect(preview.summary.inboundAmount).toBe(DEFAULT_BILLING_RATES.inboundContainerFee * 2);
    });

    // ──────────────────────────────────────────────────────────────
    // Date-range normalization
    // ──────────────────────────────────────────────────────────────

    it("auto-normalizes a reversed startDate/endDate pair and still bills correctly", () => {
      const preview = buildBillingPreview({
        startDate: "2026-03-31",  // reversed intentionally
        endDate: "2026-03-01",
        customerId: "all",
        customers,
        pallets: [],
        palletLocationEvents: [],
        inboundDocuments: [makeInboundDoc(1, 1, { actualArrivalDate: "2026-03-15" })],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.startDate).toBe("2026-03-01");
      expect(preview.endDate).toBe("2026-03-31");
      // Document at Mar 15 is within the corrected range
      expect(preview.invoiceLines.length).toBeGreaterThan(0);
    });

    // ──────────────────────────────────────────────────────────────
    // Storage interval logic
    // ──────────────────────────────────────────────────────────────

    it("bills a STORED pallet for every day in the billing period", () => {
      const pallet = makePallet(1, 1, "CONT-FULL", "STORED");
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: 1,
        customers,
        pallets: [pallet],
        palletLocationEvents: [makeEvent(1, 1, "PLT-001", "CONT-FULL", "RECEIVED", "2026-03-01T09:00:00Z")],
        inboundDocuments: [],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.summary.palletDays).toBe(31);
    });

    it("bills a pallet that arrived before the billing range for the full range duration", () => {
      const pallet = makePallet(1, 1, "CONT-PRE", "STORED", {
        createdAt: "2026-02-01T09:00:00Z",
        updatedAt: "2026-03-31T23:59:00Z"
      });
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: 1,
        customers,
        pallets: [pallet],
        palletLocationEvents: [makeEvent(1, 1, "PLT-001", "CONT-PRE", "RECEIVED", "2026-02-01T09:00:00Z")],
        inboundDocuments: [],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.summary.palletDays).toBe(31);
    });

    it("stops billing storage on the day a CANCELLED event is recorded mid-period", () => {
      // Received Mar 1, cancelled Mar 10 at 12:00.
      // Day-end check uses start-of-next-calendar-day as the boundary:
      //   Mar 1–9 day-ends → interval still open (end=Mar10 12:00 ≥ Mar10 00:00) → 9 counted
      //   Mar 10 day-end → interval.end=Mar10 12:00 < Mar11 00:00 → not counted
      const pallet = makePallet(1, 1, "CONT-CANCEL", "CANCELLED", { updatedAt: "2026-03-10T12:00:00Z" });
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: 1,
        customers,
        pallets: [pallet],
        palletLocationEvents: [
          makeEvent(1, 1, "PLT-001", "CONT-CANCEL", "RECEIVED", "2026-03-01T09:00:00Z"),
          makeEvent(2, 1, "PLT-001", "CONT-CANCEL", "CANCELLED", "2026-03-10T12:00:00Z", -1, -10)
        ],
        inboundDocuments: [],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.summary.palletDays).toBe(9);
    });

    it("produces 0 pallet-days when a pallet is received and shipped on the same calendar day", () => {
      // Received Mar 10 08:00, OUTBOUND Mar 10 20:00.
      // Day-end of Mar 10 → boundary = Mar 11 00:00, interval.end = Mar 10 20:00 < Mar 11 00:00 → not counted.
      // Days before Mar 10 → interval.start = Mar 10 08:00, start < Mar 10 00:00? No → not counted.
      const pallet = makePallet(1, 1, "CONT-SAME", "SHIPPED", { updatedAt: "2026-03-10T20:00:00Z" });
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: 1,
        customers,
        pallets: [pallet],
        palletLocationEvents: [
          makeEvent(1, 1, "PLT-001", "CONT-SAME", "RECEIVED", "2026-03-10T08:00:00Z"),
          makeEvent(2, 1, "PLT-001", "CONT-SAME", "OUTBOUND", "2026-03-10T20:00:00Z", -1, -10)
        ],
        inboundDocuments: [],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.summary.palletDays).toBe(0);
      expect(preview.storageRows).toHaveLength(0);
    });

    it("uses COUNT events when a pallet is created and later deleted by cycle counts", () => {
      const pallet = makePallet(1, 1, "CONT-COUNT", "SHIPPED", {
        sourceInboundDocumentId: 0,
        sourceInboundLineId: 0,
        actualArrivalDate: "2026-03-01",
        createdAt: "2026-03-10T09:00:00Z",
        updatedAt: "2026-03-20T12:00:00Z"
      });
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: 1,
        customers,
        pallets: [pallet],
        palletLocationEvents: [
          makeEvent(1, 1, "PLT-001", "CONT-COUNT", "COUNT", "2026-03-10T09:00:00Z", 1, 2),
          makeEvent(2, 1, "PLT-001", "CONT-COUNT", "COUNT", "2026-03-20T12:00:00Z", -1, -2)
        ],
        inboundDocuments: [],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.summary.palletDays).toBe(10);
      expect(preview.storageRows).toHaveLength(1);
      expect(preview.storageRows[0]?.palletDays).toBe(10);
      expect(preview.storageRows[0]?.firstActivityAt).toBe("2026-03-10");
      expect(preview.storageRows[0]?.lastActivityAt).toBe("2026-03-19");
      expect(preview.dailyBalanceRows.find((row) => row.date === "2026-03-09")?.palletCount).toBe(0);
      expect(preview.dailyBalanceRows.find((row) => row.date === "2026-03-10")?.palletCount).toBe(1);
      expect(preview.dailyBalanceRows.find((row) => row.date === "2026-03-19")?.palletCount).toBe(1);
      expect(preview.dailyBalanceRows.find((row) => row.date === "2026-03-20")?.palletCount).toBe(0);
    });

    // ──────────────────────────────────────────────────────────────
    // Storage row grouping
    // ──────────────────────────────────────────────────────────────

    it("merges multiple pallets from the same container into a single storage row", () => {
      const pallets = [1, 2, 3].map((id) => makePallet(id, 1, "CONT-MULTI"));
      const events = [1, 2, 3].map((id) =>
        makeEvent(id * 10, id, `PLT-00${id}`, "CONT-MULTI", "RECEIVED", "2026-03-01T09:00:00Z")
      );
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-07",
        customerId: 1,
        customers,
        pallets,
        palletLocationEvents: events,
        inboundDocuments: [],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.storageRows).toHaveLength(1);
      expect(preview.storageRows[0]?.palletsTracked).toBe(3);
      expect(preview.storageRows[0]?.palletDays).toBe(21); // 3 pallets × 7 days
    });

    it("creates separate storage rows for different containers of the same customer", () => {
      const pallets = [
        makePallet(1, 1, "CONT-A"),
        makePallet(2, 1, "CONT-B")
      ];
      const events = [
        makeEvent(1, 1, "PLT-001", "CONT-A", "RECEIVED", "2026-03-01T09:00:00Z"),
        makeEvent(2, 2, "PLT-002", "CONT-B", "RECEIVED", "2026-03-01T09:00:00Z")
      ];
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-07",
        customerId: 1,
        customers,
        pallets,
        palletLocationEvents: events,
        inboundDocuments: [],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.storageRows).toHaveLength(2);
      const containerNos = preview.storageRows.map((row) => row.containerNo).sort();
      expect(containerNos).toEqual(["CONT-A", "CONT-B"]);
    });

    // ──────────────────────────────────────────────────────────────
    // Storage fee arithmetic
    // ──────────────────────────────────────────────────────────────

    it("charges transfer storage immediately without grace days", () => {
      const rates: BillingRates = {
        ...DEFAULT_BILLING_RATES,
        storageFeePerPalletPerWeek: 14,
        storageFeePerPalletPerWeekWestCoastTransfer: 14
      };
      const pallet = makePallet(1, 1, "CONT-RATE", "STORED", { containerType: "WEST_COAST_TRANSFER" });
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-07",
        customerId: 1,
        customers,
        pallets: [pallet],
        palletLocationEvents: [makeEvent(1, 1, "PLT-001", "CONT-RATE", "RECEIVED", "2026-03-01T09:00:00Z")],
        inboundDocuments: [],
        outboundDocuments: [],
        rates
      });

      expect(preview.summary.palletDays).toBe(7);
      expect(preview.summary.storageAmount).toBe(14); // 7 × (14/7) = 14
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Full container lifecycle integration
  //
  // Scenario:
  //   Container GCXU5050505, Customer "Acme" (id=1), billing range 2026-03-01..31
  //
  //   Receipt (Mar 3):
  //     PLT-001 RECEIVED 2026-03-03 09:00  (status: SHIPPED after outbound)
  //     PLT-002 RECEIVED 2026-03-03 09:00  (status: SHIPPED after outbound)
  //     PLT-003 RECEIVED 2026-03-03 09:00  (status: CANCELLED)
  //
  //   Adjustment (Mar 8):
  //     PLT-001 REVERSAL event – stock correction; must NOT break storage interval
  //
  //   Shipment 1 (Mar 10): PLT-001 OUTBOUND 10:00
  //   Shipment 2 (Mar 18): PLT-002 OUTBOUND 14:00
  //   Inventory adjustment (Mar 20): PLT-003 CANCELLED 11:00
  //
  //   Expected pallet-days (day-end midnight boundary):
  //     PLT-001: Mar 3–9  →  7 days  (interval.end=Mar10 10:00; not ≥ midnight Mar11)
  //     PLT-002: Mar 3–17 → 15 days  (interval.end=Mar18 14:00; not ≥ midnight Mar19)
  //     PLT-003: Mar 3–19 → 17 days  (interval.end=Mar20 11:00; not ≥ midnight Mar21)
  //     Total: 39 pallet-days → $39 storage at DEFAULT rates ($1/pallet/day)
  //
  //   Expected invoice lines (5 total):
  //     INBOUND  Mar 3   $450
  //     WRAPPING Mar 3   3 × $10 = $30
  //     OUTBOUND Mar 10  1 × $10 = $10  (SO-001 / packingListNo "SO-001")
  //     OUTBOUND Mar 18  1 × $10 = $10  (SO-002 / packingListNo "SO-002")
  //     STORAGE  –       $39
  //     Grand total: $539
  // ═══════════════════════════════════════════════════════════════════════════
  describe("full container lifecycle", () => {
    const CONTAINER = "GCXU5050505";

    // ── pallets ────────────────────────────────────────────────────
    const plt001 = makePallet(1, 1, CONTAINER, "SHIPPED", {
      palletCode: "PLT-001",
      updatedAt: "2026-03-10T10:00:00Z"
    });
    const plt002 = makePallet(2, 1, CONTAINER, "SHIPPED", {
      palletCode: "PLT-002",
      updatedAt: "2026-03-18T14:00:00Z"
    });
    const plt003 = makePallet(3, 1, CONTAINER, "CANCELLED", {
      palletCode: "PLT-003",
      updatedAt: "2026-03-20T11:00:00Z"
    });
    const pallets = [plt001, plt002, plt003];

    // ── pallet-location events ─────────────────────────────────────
    // RECEIVED events (all three pallets arrive together Mar 3)
    const evtRecv001 = makeEvent(101, 1, "PLT-001", CONTAINER, "RECEIVED",  "2026-03-03T09:00:00Z",  1, 100);
    const evtRecv002 = makeEvent(102, 2, "PLT-002", CONTAINER, "RECEIVED",  "2026-03-03T09:00:00Z",  1, 100);
    const evtRecv003 = makeEvent(103, 3, "PLT-003", CONTAINER, "RECEIVED",  "2026-03-03T09:00:00Z",  1,  50);
    // REVERSAL adjustment on PLT-001 Mar 8 – should NOT split the storage interval
    const evtReversal = makeEvent(104, 1, "PLT-001", CONTAINER, "REVERSAL", "2026-03-08T11:00:00Z",  0,  20);
    // OUTBOUND events
    const evtOut001 = makeEvent(105, 1, "PLT-001", CONTAINER, "OUTBOUND", "2026-03-10T10:00:00Z", -1, -100);
    const evtOut002 = makeEvent(106, 2, "PLT-002", CONTAINER, "OUTBOUND", "2026-03-18T14:00:00Z", -1, -100);
    // CANCELLED event on PLT-003 Mar 20
    const evtCancel = makeEvent(107, 3, "PLT-003", CONTAINER, "CANCELLED", "2026-03-20T11:00:00Z", -1,  -50);

    const palletLocationEvents = [
      evtRecv001, evtRecv002, evtRecv003,
      evtReversal,
      evtOut001, evtOut002,
      evtCancel
    ];

    // ── inbound / outbound documents ───────────────────────────────
    const inboundDoc = {
      ...makeInboundDoc(10, 1, {
        containerNo: CONTAINER,
        actualArrivalDate: "2026-03-03",
        pallets: 3
      })
    };

    // Override packingListNo so buildOutboundReference uses "SO-001" / "SO-002"
    const outboundDoc1: OutboundDocument = {
      ...makeOutboundDoc(1, 1, { actualShipDate: "2026-03-10", pallets: 1 }),
      packingListNo: "SO-001",
      confirmedAt: "2026-03-10T10:00:00Z",
      lines: [{
        ...makeOutboundDoc(1, 1, { pallets: 1 }).lines[0]!,
        pallets: 1,
        quantity: 100
      }]
    };
    const outboundDoc2: OutboundDocument = {
      ...makeOutboundDoc(2, 1, { actualShipDate: "2026-03-18", pallets: 1 }),
      packingListNo: "SO-002",
      confirmedAt: "2026-03-18T14:00:00Z",
      lines: [{
        ...makeOutboundDoc(2, 1, { pallets: 1 }).lines[0]!,
        pallets: 1,
        quantity: 100
      }]
    };

    function buildLifecyclePreview(overrides: Partial<Parameters<typeof buildBillingPreview>[0]> = {}) {
      return buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: 1,
        customers,
        pallets,
        palletLocationEvents,
        inboundDocuments: [inboundDoc],
        outboundDocuments: [outboundDoc1, outboundDoc2],
        rates: DEFAULT_BILLING_RATES,
        ...overrides
      });
    }

    // ── tests ──────────────────────────────────────────────────────

    it("grand total is $513: $450 inbound + $45 wrapping + $18 storage + $0 outbound", () => {
      const preview = buildLifecyclePreview();
      expect(preview.summary.inboundAmount).toBe(450);
      expect(preview.summary.wrappingAmount).toBe(45);
      expect(preview.summary.storageAmount).toBe(18);
      expect(preview.summary.outboundAmount).toBe(0);
      expect(preview.summary.grandTotal).toBe(513);
    });

    it("produces exactly 5 invoice lines (INBOUND + WRAPPING + OUTBOUND×2 + STORAGE)", () => {
      const preview = buildLifecyclePreview();
      expect(preview.invoiceLines).toHaveLength(5);
      const types = preview.invoiceLines.map((l) => l.chargeType);
      expect(types.filter((t) => t === "INBOUND")).toHaveLength(1);
      expect(types.filter((t) => t === "WRAPPING")).toHaveLength(1);
      expect(types.filter((t) => t === "OUTBOUND")).toHaveLength(2);
      expect(types.filter((t) => t === "STORAGE")).toHaveLength(1);
    });

    it("invoice lines are sorted chronologically: INBOUND/WRAPPING Mar3, OUTBOUND Mar10, OUTBOUND Mar18, STORAGE", () => {
      const preview = buildLifecyclePreview();
      const nonStorage = preview.invoiceLines.filter((l) => l.chargeType !== "STORAGE");
      const dates = nonStorage.map((l) => l.occurredOn);
      expect(dates).toEqual(["2026-03-03", "2026-03-03", "2026-03-10", "2026-03-18"]);
    });

    it("total storage pallet-days is 39 (7 + 15 + 17)", () => {
      const preview = buildLifecyclePreview();
      expect(preview.summary.palletDays).toBe(39);
    });

    it("all 3 pallets contribute to a single storage row for GCXU5050505 with palletsTracked=3", () => {
      const preview = buildLifecyclePreview();
      expect(preview.storageRows).toHaveLength(1);
      expect(preview.storageRows[0]?.containerNo).toBe(CONTAINER);
      expect(preview.storageRows[0]?.palletsTracked).toBe(3);
      expect(preview.storageRows[0]?.palletDays).toBe(39);
    });

    it("keeps storage segments, storage invoice lines, and summary totals internally consistent", () => {
      const preview = buildLifecyclePreview();
      const storageRow = preview.storageRows[0];
      const storageLine = preview.invoiceLines.find((line) => line.chargeType === "STORAGE");
      const roundCurrency = (value: number) => Math.round(value * 100) / 100;

      expect(storageRow).toBeDefined();
      expect(storageLine).toBeDefined();

      const segmentPalletDays = storageRow!.segments.reduce((total, segment) => total + segment.palletDays, 0);
      const segmentFreePalletDays = storageRow!.segments.reduce((total, segment) => total + segment.freePalletDays, 0);
      const segmentBillablePalletDays = storageRow!.segments.reduce((total, segment) => total + segment.billablePalletDays, 0);
      const segmentGrossAmount = roundCurrency(storageRow!.segments.reduce((total, segment) => total + segment.grossAmount, 0));
      const segmentDiscountAmount = roundCurrency(storageRow!.segments.reduce((total, segment) => total + segment.discountAmount, 0));
      const segmentAmount = roundCurrency(storageRow!.segments.reduce((total, segment) => total + segment.amount, 0));

      expect(storageRow!.palletDays).toBe(segmentPalletDays);
      expect(storageRow!.freePalletDays).toBe(segmentFreePalletDays);
      expect(storageRow!.billablePalletDays).toBe(segmentBillablePalletDays);
      expect(storageRow!.grossAmount).toBe(segmentGrossAmount);
      expect(storageRow!.discountAmount).toBe(segmentDiscountAmount);
      expect(storageRow!.amount).toBe(segmentAmount);

      expect(storageLine).toMatchObject({
        chargeType: "STORAGE",
        containerNo: storageRow!.containerNo,
        quantity: storageRow!.billablePalletDays,
        amount: storageRow!.amount,
        occurredOn: storageRow!.lastActivityAt
      });

      expect(preview.summary.storageAmount).toBe(roundCurrency(preview.storageRows.reduce((total, row) => total + row.amount, 0)));
      expect(preview.summary.grandTotal).toBe(roundCurrency(preview.invoiceLines.reduce((total, line) => total + line.amount, 0)));
    });

    it("storage segments correctly reflect pallet count drops after each shipment/cancellation", () => {
      const preview = buildLifecyclePreview();
      const segments = preview.storageRows[0]?.segments ?? [];

      // Expect 3 segments: [3 pallets Mar3–9, 2 pallets Mar10–17, 1 pallet Mar18–19]
      // Note: a pallet-day is counted for day D if it's active at day-end (midnight D+1).
      // PLT-001 last counted Mar 9 (outbound Mar 10 10:00 → not active at midnight Mar 11).
      // So segment with 3 pallets covers Mar 3–9 = 7 days.
      // Segment with 2 pallets covers Mar 10–17 = 8 days. PLT-002 last counted Mar 17.
      // Segment with 1 pallet covers Mar 18–19 = 2 days. PLT-003 last counted Mar 19.
      const totalPalletDays = segments.reduce((sum, s) => sum + s.palletDays, 0);
      expect(totalPalletDays).toBe(39);

      // The first segment should have 3 pallets and the last should have 1 pallet
      const sorted = [...segments].sort((a, b) => a.startDate.localeCompare(b.startDate));
      expect(sorted[0]?.dayEndPallets).toBe(3);
      expect(sorted[0]?.billedDays).toBe(7);
      expect(sorted[sorted.length - 1]?.dayEndPallets).toBe(1);
      expect(sorted[sorted.length - 1]?.billedDays).toBe(2);
    });

    it("REVERSAL adjustment on Mar 8 does NOT split PLT-001 storage interval — still billed for 7 contiguous days", () => {
      // If REVERSAL incorrectly closed and reopened the interval, PLT-001 would lose the Mar 3–7 days
      // (interval start would become Mar 8), giving only 2 days instead of 7.
      // Verify that PLT-001's contribution accounts for all 7 days Mar 3–9.
      //
      // We check this indirectly: build without REVERSAL and confirm same pallet-day count.
      const withoutReversal = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: 1,
        customers,
        pallets,
        palletLocationEvents: palletLocationEvents.filter((e) => e.eventType !== "REVERSAL"),
        inboundDocuments: [inboundDoc],
        outboundDocuments: [outboundDoc1, outboundDoc2],
        rates: DEFAULT_BILLING_RATES
      });

      const withReversal = buildLifecyclePreview();

      // Both should produce identical pallet-day totals because REVERSAL is a start-event
      // that merely re-opens/continues an existing interval without penalizing prior days.
      expect(withReversal.summary.palletDays).toBe(withoutReversal.summary.palletDays);
    });

    it("CANCELLED pallet (PLT-003) stops accumulating storage on Mar 20, not at month-end", () => {
      // PLT-003 cancelled Mar 20 11:00 → last active day-end: midnight Mar 21 > Mar20 11:00? No.
      // So last counted day is Mar 19 → 17 days (Mar 3–19).
      // If it were STORED all month it would be 29 days; the difference confirms billing stops at cancellation.
      const noCancelPreview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: 1,
        customers,
        pallets: [plt001, plt002, makePallet(3, 1, CONTAINER, "STORED", {
          palletCode: "PLT-003",
          updatedAt: "2026-03-31T23:59:00Z"
        })],
        palletLocationEvents: palletLocationEvents.filter(
          (e) => !(e.palletId === 3 && e.eventType === "CANCELLED")
        ),
        inboundDocuments: [inboundDoc],
        outboundDocuments: [outboundDoc1, outboundDoc2],
        rates: DEFAULT_BILLING_RATES
      });

      const withCancel = buildLifecyclePreview();

      // Without cancellation PLT-003 would run from Mar 3 to Mar 31 = 29 days.
      // With cancellation it's only 17 days — a reduction of 12 days.
      expect(withCancel.summary.palletDays).toBe(noCancelPreview.summary.palletDays - 12);
    });

    it("outbound SO-001 dated Feb 28 is excluded from the March billing period", () => {
      const earlyDoc: OutboundDocument = {
        ...outboundDoc1,
        actualShipDate: "2026-02-28",
        confirmedAt: "2026-02-28T10:00:00Z"
      };

      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: 1,
        customers,
        pallets,
        palletLocationEvents,
        inboundDocuments: [inboundDoc],
        outboundDocuments: [earlyDoc, outboundDoc2],
        rates: DEFAULT_BILLING_RATES
      });

      const outboundLines = preview.invoiceLines.filter((l) => l.chargeType === "OUTBOUND");
      // Only SO-002 (Mar 18) should appear; SO-001 (Feb 28) is out of range
      expect(outboundLines).toHaveLength(1);
      expect(outboundLines[0]?.reference).toContain("SO-002");
      expect(preview.summary.outboundAmount).toBe(0);
    });

    it("inbound reference includes both receipt id and container number", () => {
      const preview = buildLifecyclePreview();
      const inboundLine = preview.invoiceLines.find((l) => l.chargeType === "INBOUND");
      expect(inboundLine?.reference).toContain(String(inboundDoc.id));
      expect(inboundLine?.reference).toContain(CONTAINER);
    });

    it("outbound references use packingListNo (SO-001, SO-002)", () => {
      const preview = buildLifecyclePreview();
      const outboundLines = preview.invoiceLines.filter((l) => l.chargeType === "OUTBOUND");
      const refs = outboundLines.map((l) => l.reference).sort();
      expect(refs[0]).toContain("SO-001");
      expect(refs[1]).toContain("SO-002");
    });

    it("daily balance rows reflect pallet count declining as shipments and cancellation occur", () => {
      const preview = buildLifecyclePreview();
      const rows = preview.dailyBalanceRows;

      // Before receipt there are no pallets (Mar 1–2)
      const beforeReceipt = rows.filter((r) => r.date < "2026-03-03");
      expect(beforeReceipt.every((r) => r.palletCount === 0)).toBe(true);

      // Between receipt and first outbound: 3 pallets (Mar 3–9, using day-end count)
      // The daily balance row for Mar 9 should show count=3
      const mar9 = rows.find((r) => r.date === "2026-03-09");
      expect(mar9?.palletCount).toBe(3);

      // After PLT-001 outbound (Mar 10) and before PLT-002 outbound (Mar 17): 2 pallets
      const mar14 = rows.find((r) => r.date === "2026-03-14");
      expect(mar14?.palletCount).toBe(2);

      // After PLT-002 outbound (Mar 18) and before PLT-003 cancellation (Mar 19): 1 pallet
      const mar19 = rows.find((r) => r.date === "2026-03-19");
      expect(mar19?.palletCount).toBe(1);

      // After PLT-003 cancellation (Mar 20 onwards): 0 pallets
      const mar25 = rows.find((r) => r.date === "2026-03-25");
      expect(mar25?.palletCount).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Billing date fallbacks and reference formatting
  // ═══════════════════════════════════════════════════════════════════════════
  describe("billing date fallbacks and reference formatting", () => {

    // ── Inbound date fallback chain ────────────────────────────────

    it("uses confirmedAt as inbound billing date when actualArrivalDate is null", () => {
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
        pallets: [],
        palletLocationEvents: [],
        inboundDocuments: [makeInboundDoc(1, 1, {
          actualArrivalDate: null,
          confirmedAt: "2026-03-12T10:00:00Z"
        })],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.invoiceLines.length).toBeGreaterThan(0);
      expect(preview.invoiceLines[0]?.occurredOn).toBe("2026-03-12");
    });

    it("uses createdAt as inbound billing date when actualArrivalDate and confirmedAt are both null", () => {
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
        pallets: [],
        palletLocationEvents: [],
        inboundDocuments: [makeInboundDoc(1, 1, {
          actualArrivalDate: null,
          confirmedAt: null
        })],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      // makeInboundDoc sets createdAt = "2026-03-01T09:00:00Z"
      expect(preview.invoiceLines.length).toBeGreaterThan(0);
      expect(preview.invoiceLines[0]?.occurredOn).toBe("2026-03-01");
    });

    // ── Outbound date fallback chain ───────────────────────────────

    it("uses confirmedAt as outbound billing date when actualShipDate is null", () => {
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
        pallets: [],
        palletLocationEvents: [],
        inboundDocuments: [],
        outboundDocuments: [makeOutboundDoc(1, 1, {
          actualShipDate: null,
          confirmedAt: "2026-03-14T08:00:00Z",
          pallets: 2
        })],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.invoiceLines).toHaveLength(1);
      expect(preview.invoiceLines[0]?.occurredOn).toBe("2026-03-14");
    });

    it("uses createdAt as outbound billing date when actualShipDate and confirmedAt are both null", () => {
      // makeOutboundDoc sets createdAt = "2026-03-10T09:00:00Z"
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
        pallets: [],
        palletLocationEvents: [],
        inboundDocuments: [],
        outboundDocuments: [makeOutboundDoc(1, 1, {
          actualShipDate: null,
          confirmedAt: null,
          pallets: 2
        })],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.invoiceLines).toHaveLength(1);
      expect(preview.invoiceLines[0]?.occurredOn).toBe("2026-03-10");
    });

    // ── DELETED outbound ───────────────────────────────────────────

    it("skips DELETED outbound documents", () => {
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
        pallets: [],
        palletLocationEvents: [],
        inboundDocuments: [],
        outboundDocuments: [makeOutboundDoc(1, 1, { status: "DELETED", actualShipDate: "2026-03-15", pallets: 2 })],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.invoiceLines).toHaveLength(0);
      expect(preview.summary.outboundAmount).toBe(0);
    });

    // ── containerNo normalisation ──────────────────────────────────

    it("normalises a blank containerNo to UNASSIGNED and omits it from the inbound reference", () => {
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
        pallets: [],
        palletLocationEvents: [],
        inboundDocuments: [makeInboundDoc(1, 1, { containerNo: "" })],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      const inboundLine = preview.invoiceLines.find((l) => l.chargeType === "INBOUND");
      // Reference should be "Receipt 1" only — no "| UNASSIGNED" suffix
      expect(inboundLine?.reference).toBe("Receipt 1");
      // Storage row (if any pallets were passed) would use "UNASSIGNED" as containerNo;
      // with no pallets the storage row list is empty, confirming no crash
      expect(preview.storageRows).toHaveLength(0);
    });

    it("storage row containerNo is UNASSIGNED when pallet containerNo is blank", () => {
      const pallet = makePallet(1, 1, ""); // blank containerNo
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-07",
        customerId: 1,
        customers,
        pallets: [pallet],
        palletLocationEvents: [makeEvent(1, 1, "PLT-001", "", "RECEIVED", "2026-03-01T09:00:00Z")],
        inboundDocuments: [],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.storageRows).toHaveLength(1);
      expect(preview.storageRows[0]?.containerNo).toBe("UNASSIGNED");
    });

    // ── Outbound reference fallback chain ──────────────────────────

    it("uses orderRef as outbound reference when packingListNo is blank", () => {
      const doc: OutboundDocument = {
        ...makeOutboundDoc(5, 1, { actualShipDate: "2026-03-10", pallets: 1 }),
        packingListNo: "",
        orderRef: "ORD-2026-999"
      };

      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
        pallets: [],
        palletLocationEvents: [],
        inboundDocuments: [],
        outboundDocuments: [doc],
        rates: DEFAULT_BILLING_RATES
      });

      const outboundLine = preview.invoiceLines.find((l) => l.chargeType === "OUTBOUND");
      expect(outboundLine?.reference).toBe("ORD-2026-999");
    });

    it("falls back to 'Shipment {id}' when both packingListNo and orderRef are blank", () => {
      const doc: OutboundDocument = {
        ...makeOutboundDoc(7, 1, { actualShipDate: "2026-03-10", pallets: 1 }),
        packingListNo: "",
        orderRef: ""
      };

      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
        pallets: [],
        palletLocationEvents: [],
        inboundDocuments: [],
        outboundDocuments: [doc],
        rates: DEFAULT_BILLING_RATES
      });

      const outboundLine = preview.invoiceLines.find((l) => l.chargeType === "OUTBOUND");
      expect(outboundLine?.reference).toBe("Shipment 7");
    });

    // ── TRANSFER_IN as storage start event ─────────────────────────

    it("TRANSFER_IN event opens a storage interval and the pallet accrues pallet-days from that point", () => {
      // Pallet transferred in on Mar 5; no RECEIVED event.
      // Should be billed for Mar 5–31 = 27 days.
      const pallet = makePallet(1, 1, "CONT-XFER", "STORED", {
        palletCode: "PLT-001",
        createdAt: "2026-03-05T08:00:00Z",
        updatedAt: "2026-03-31T23:59:00Z"
      });
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: 1,
        customers,
        pallets: [pallet],
        palletLocationEvents: [
          makeEvent(1, 1, "PLT-001", "CONT-XFER", "TRANSFER_IN", "2026-03-05T08:00:00Z")
        ],
        inboundDocuments: [],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.summary.palletDays).toBe(27);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Container lifecycle edge cases
  //
  // Covers scenarios that exercise individual engine rules in isolation:
  //   – DRAFT documents included (only DELETED is excluded)
  //   – Multi-line inbound: WRAPPING qty = sum of all lines' pallets
  //   – Pallet with no location events falls back to actualArrivalDate
  //   – Single-day billing range
  //   – Pallet received on last day of range = 1 pallet-day
  //   – 3-phase partial outbound: correct segments and pallet-day total
  //   – REVERSAL after CANCELLED reopens the storage interval
  //   – Two customers sharing the same containerNo → separate storage rows
  //   – summary.receivedContainers / receivedPallets / shippedPallets
  // ═══════════════════════════════════════════════════════════════════════════
  describe("container lifecycle edge cases", () => {

    // ── DRAFT / status handling ────────────────────────────────────

    it("includes a DRAFT inbound document in billing (only DELETED is excluded)", () => {
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
        pallets: [],
        palletLocationEvents: [],
        inboundDocuments: [makeInboundDoc(1, 1, { status: "DRAFT", actualArrivalDate: "2026-03-10" })],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.invoiceLines.length).toBeGreaterThan(0);
      expect(preview.invoiceLines[0]?.chargeType).toBe("INBOUND");
    });

    it("includes a DRAFT outbound document in billing (only DELETED is excluded)", () => {
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
        pallets: [],
        palletLocationEvents: [],
        inboundDocuments: [],
        outboundDocuments: [makeOutboundDoc(1, 1, { status: "DRAFT", actualShipDate: "2026-03-10", pallets: 2 })],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.invoiceLines).toHaveLength(1);
      expect(preview.invoiceLines[0]?.chargeType).toBe("OUTBOUND");
    });

    // ── Multi-line inbound ─────────────────────────────────────────

    it("sums pallets across all inbound document lines when computing the WRAPPING fee", () => {
      // Two lines: 3 pallets + 2 pallets = 5 total → WRAPPING qty=5, amount=$50
      const doc: InboundDocument = {
        ...makeInboundDoc(1, 1, { actualArrivalDate: "2026-03-10" }),
        lines: [
          { ...makeInboundDoc(1, 1).lines[0]!, pallets: 3 },
          {
            id: 9999, documentId: 1, sku: "SKU-2", description: "Gadget",
            storageSection: "A", reorderLevel: 0, expectedQty: 20, receivedQty: 20,
            pallets: 2, unitsPerPallet: 10, palletsDetailCtns: "2", unitLabel: "CTN",
            lineNote: "", createdAt: "2026-03-10T09:00:00Z"
          }
        ]
      };

      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
        pallets: [],
        palletLocationEvents: [],
        inboundDocuments: [doc],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      const wrapping = preview.invoiceLines.find((l) => l.chargeType === "WRAPPING");
      expect(wrapping?.quantity).toBe(5);
      expect(wrapping?.amount).toBe(75);
      expect(preview.summary.wrappingAmount).toBe(75);
    });

    // ── Pallet event fallback ──────────────────────────────────────

    it("bills a pallet that has no location events using actualArrivalDate as interval start", () => {
      // No events; code falls back to pallet.actualArrivalDate (Mar 5) for interval start.
      // Pallet STORED all month → billed Mar 5–31 = 27 days.
      const pallet = makePallet(1, 1, "CONT-NOEVENT", "STORED", {
        actualArrivalDate: "2026-03-05",
        createdAt: "2026-03-05T10:00:00Z",
        updatedAt: "2026-03-31T23:59:00Z"
      });

      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: 1,
        customers,
        pallets: [pallet],
        palletLocationEvents: [],
        inboundDocuments: [],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.summary.palletDays).toBe(27);
    });

    // ── Range boundary ─────────────────────────────────────────────

    it("a single-day billing range produces exactly 1 pallet-day for a STORED pallet", () => {
      const pallet = makePallet(1, 1, "CONT-ONEDAY", "STORED");

      const preview = buildBillingPreview({
        startDate: "2026-03-15",
        endDate: "2026-03-15",
        customerId: 1,
        customers,
        pallets: [pallet],
        palletLocationEvents: [makeEvent(1, 1, "PLT-001", "CONT-ONEDAY", "RECEIVED", "2026-03-15T09:00:00Z")],
        inboundDocuments: [],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.summary.palletDays).toBe(1);
      expect(preview.dailyBalanceRows).toHaveLength(1);
      expect(preview.dailyBalanceRows[0]?.palletCount).toBe(1);
    });

    it("a pallet received on the last day of the billing range is billed for exactly 1 day", () => {
      // Received Mar 31 08:00, STORED (end=null).
      // Day-end check for Mar 31: boundary = Apr 1 midnight.
      // interval.start=Mar31 08:00 < Apr1 AND interval.end=null → counted. Result = 1 pallet-day.
      const pallet = makePallet(1, 1, "CONT-LASTDAY", "STORED", {
        createdAt: "2026-03-31T08:00:00Z",
        updatedAt: "2026-03-31T23:59:00Z"
      });

      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: 1,
        customers,
        pallets: [pallet],
        palletLocationEvents: [makeEvent(1, 1, "PLT-001", "CONT-LASTDAY", "RECEIVED", "2026-03-31T08:00:00Z")],
        inboundDocuments: [],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.summary.palletDays).toBe(1);
    });

    // ── 3-phase partial outbound ───────────────────────────────────

    it("3-phase partial outbound produces 3 segments and a pallet-day total of 75", () => {
      // 5 pallets all received Mar 1.
      // PLT-001, PLT-002 OUTBOUND Mar 8 10:00 → last counted day = Mar 7 → 7 days each
      // PLT-003, PLT-004 OUTBOUND Mar 16 09:00 → last counted day = Mar 15 → 15 days each
      // PLT-005 STORED all month → 31 days
      // Total: 2×7 + 2×15 + 31 = 75 pallet-days
      //
      // Segments (by day-end pallet count):
      //   Seg 1: 5 pallets, Mar 1–7  (7 days)
      //   Seg 2: 3 pallets, Mar 8–15 (8 days)
      //   Seg 3: 1 pallet,  Mar 16–31(16 days)
      const pallets = [
        makePallet(1, 1, "CONT-PARTIAL", "SHIPPED", { palletCode: "PLT-001", updatedAt: "2026-03-08T10:00:00Z" }),
        makePallet(2, 1, "CONT-PARTIAL", "SHIPPED", { palletCode: "PLT-002", updatedAt: "2026-03-08T10:00:00Z" }),
        makePallet(3, 1, "CONT-PARTIAL", "SHIPPED", { palletCode: "PLT-003", updatedAt: "2026-03-16T09:00:00Z" }),
        makePallet(4, 1, "CONT-PARTIAL", "SHIPPED", { palletCode: "PLT-004", updatedAt: "2026-03-16T09:00:00Z" }),
        makePallet(5, 1, "CONT-PARTIAL", "STORED",  { palletCode: "PLT-005" })
      ];
      const events = [
        makeEvent(11, 1, "PLT-001", "CONT-PARTIAL", "RECEIVED", "2026-03-01T09:00:00Z"),
        makeEvent(12, 2, "PLT-002", "CONT-PARTIAL", "RECEIVED", "2026-03-01T09:00:00Z"),
        makeEvent(13, 3, "PLT-003", "CONT-PARTIAL", "RECEIVED", "2026-03-01T09:00:00Z"),
        makeEvent(14, 4, "PLT-004", "CONT-PARTIAL", "RECEIVED", "2026-03-01T09:00:00Z"),
        makeEvent(15, 5, "PLT-005", "CONT-PARTIAL", "RECEIVED", "2026-03-01T09:00:00Z"),
        makeEvent(21, 1, "PLT-001", "CONT-PARTIAL", "OUTBOUND", "2026-03-08T10:00:00Z", -1, -10),
        makeEvent(22, 2, "PLT-002", "CONT-PARTIAL", "OUTBOUND", "2026-03-08T10:00:00Z", -1, -10),
        makeEvent(23, 3, "PLT-003", "CONT-PARTIAL", "OUTBOUND", "2026-03-16T09:00:00Z", -1, -10),
        makeEvent(24, 4, "PLT-004", "CONT-PARTIAL", "OUTBOUND", "2026-03-16T09:00:00Z", -1, -10)
      ];

      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: 1,
        customers,
        pallets,
        palletLocationEvents: events,
        inboundDocuments: [],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.summary.palletDays).toBe(75);
      expect(preview.storageRows).toHaveLength(1);
      expect(preview.storageRows[0]?.palletsTracked).toBe(5);

      const segments = [...(preview.storageRows[0]?.segments ?? [])].sort((a, b) => a.startDate.localeCompare(b.startDate));
      expect(segments).toHaveLength(3);
      expect(segments[0]?.dayEndPallets).toBe(5);
      expect(segments[0]?.billedDays).toBe(7);
      expect(segments[1]?.dayEndPallets).toBe(3);
      expect(segments[1]?.billedDays).toBe(8);
      expect(segments[2]?.dayEndPallets).toBe(1);
      expect(segments[2]?.billedDays).toBe(16);
    });

    // ── REVERSAL reopens a closed interval ─────────────────────────

    it("REVERSAL after CANCELLED reopens the storage interval and bills both non-contiguous spans", () => {
      // Interval 1: RECEIVED Mar 1 → CANCELLED Mar 5 10:00
      //   Day-end check: Mar 5 boundary = Mar 6 midnight; interval.end = Mar 5 10:00 < Mar 6 → Mar 5 NOT counted.
      //   Counted: Mar 1–4 = 4 days.
      // Gap: Mar 5–9 (no active interval).
      // Interval 2: REVERSAL Mar 10 09:00 → open (STORED)
      //   Counted: Mar 10–31 = 22 days.
      // Total: 4 + 22 = 26 days → 2 non-contiguous segments.
      const pallet = makePallet(1, 1, "CONT-REVERSAL", "STORED", {
        updatedAt: "2026-03-31T23:59:00Z",
        containerType: "WEST_COAST_TRANSFER"
      });

      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: 1,
        customers,
        pallets: [pallet],
        palletLocationEvents: [
          makeEvent(1, 1, "PLT-001", "CONT-REVERSAL", "RECEIVED",  "2026-03-01T09:00:00Z"),
          makeEvent(2, 1, "PLT-001", "CONT-REVERSAL", "CANCELLED", "2026-03-05T10:00:00Z", -1, -10),
          makeEvent(3, 1, "PLT-001", "CONT-REVERSAL", "REVERSAL",  "2026-03-10T09:00:00Z",  1,  10)
        ],
        inboundDocuments: [],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.summary.palletDays).toBe(26);

      const segments = [...(preview.storageRows[0]?.segments ?? [])].sort((a, b) => a.startDate.localeCompare(b.startDate));
      expect(segments).toHaveLength(2);
      expect(segments[0]?.billedDays).toBe(4);  // Mar 1–4
      expect(segments[1]?.billedDays).toBe(22); // Mar 10–31
    });

    // ── Customer isolation ─────────────────────────────────────────

    it("two customers with the same containerNo get separate storage rows (not merged)", () => {
      // rowKey is `${customerId}|${containerNo}`, so same containerNo but different customers → 2 rows.
      const pallet1 = makePallet(1, 1, "CONT-SHARED");
      const pallet2 = makePallet(2, 2, "CONT-SHARED");

      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-07",
        customerId: "all",
        customers,
        pallets: [pallet1, pallet2],
        palletLocationEvents: [
          makeEvent(1, 1, "PLT-001", "CONT-SHARED", "RECEIVED", "2026-03-01T09:00:00Z", 1, 10, 1),
          makeEvent(2, 2, "PLT-002", "CONT-SHARED", "RECEIVED", "2026-03-01T09:00:00Z", 1, 10, 2)
        ],
        inboundDocuments: [],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.storageRows).toHaveLength(2);
      expect(new Set(preview.storageRows.map((r) => r.customerId)).size).toBe(2);
      expect(preview.storageRows.every((r) => r.containerNo === "CONT-SHARED")).toBe(true);
    });

    // ── Summary field correctness ──────────────────────────────────

    it("summary.receivedContainers equals the count of billed inbound receipts", () => {
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
        pallets: [],
        palletLocationEvents: [],
        inboundDocuments: [
          makeInboundDoc(1, 1, { actualArrivalDate: "2026-03-05" }),
          makeInboundDoc(2, 1, { actualArrivalDate: "2026-03-10" })
        ],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.summary.receivedContainers).toBe(2);
    });

    it("summary.receivedPallets sums pallets from all inbound WRAPPING lines", () => {
      // Doc 1: 3 pallets, Doc 2: 5 pallets → total 8
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
        pallets: [],
        palletLocationEvents: [],
        inboundDocuments: [
          makeInboundDoc(1, 1, { actualArrivalDate: "2026-03-05", pallets: 3 }),
          makeInboundDoc(2, 1, { actualArrivalDate: "2026-03-10", pallets: 5 })
        ],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.summary.receivedPallets).toBe(8);
    });

    it("summary.shippedPallets sums pallets from all outbound shipments", () => {
      // Doc 1: 3 pallets, Doc 2: 4 pallets → total 7
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
        pallets: [],
        palletLocationEvents: [],
        inboundDocuments: [],
        outboundDocuments: [
          makeOutboundDoc(1, 1, { actualShipDate: "2026-03-10", pallets: 3 }),
          makeOutboundDoc(2, 1, { actualShipDate: "2026-03-20", pallets: 4 })
        ],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.summary.shippedPallets).toBe(7);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Local factory helpers for edge-case tests
// ─────────────────────────────────────────────────────────────────────────────

function makeInboundDoc(
  id: number,
  customerId: number,
  overrides: {
    containerNo?: string;
    status?: string;
    actualArrivalDate?: string | null;
    confirmedAt?: string | null;
    pallets?: number;
  } = {}
): InboundDocument {
  const pallets = overrides.pallets ?? 2;
  return {
    id,
    customerId,
    customerName: `Customer ${customerId}`,
    locationId: 1,
    locationName: "NJ",
    expectedArrivalDate: "2026-03-01",
    actualArrivalDate: overrides.actualArrivalDate !== undefined ? overrides.actualArrivalDate : "2026-03-01",
    containerNo: overrides.containerNo ?? `CONT-${String(id).padStart(3, "0")}`,
    containerType: "NORMAL",
    handlingMode: "PALLETIZED",
    storageSection: "A",
    unitLabel: "CTN",
    documentNote: "",
    status: overrides.status ?? "CONFIRMED",
    trackingStatus: "RECEIVED",
    confirmedAt: overrides.confirmedAt !== undefined ? overrides.confirmedAt : "2026-03-01T09:00:00Z",
    deletedAt: null,
    archivedAt: null,
    totalLines: 1,
    totalExpectedQty: pallets * 10,
    totalReceivedQty: pallets * 10,
    createdAt: "2026-03-01T09:00:00Z",
    updatedAt: "2026-03-01T09:00:00Z",
    lines: [{
      id: id * 100,
      documentId: id,
      sku: "SKU-1",
      description: "Widget",
      storageSection: "A",
      reorderLevel: 0,
      expectedQty: pallets * 10,
      receivedQty: pallets * 10,
      pallets,
      unitsPerPallet: 10,
      palletsDetailCtns: String(pallets),
      unitLabel: "CTN",
      lineNote: "",
      createdAt: "2026-03-01T09:00:00Z"
    }]
  };
}

function makeOutboundDoc(
  id: number,
  customerId: number,
  overrides: {
    status?: string;
    actualShipDate?: string | null;
    confirmedAt?: string | null;
    pallets?: number;
  } = {}
): OutboundDocument {
  const pallets = overrides.pallets ?? 2;
  return {
    id,
    packingListNo: `SO-${id}`,
    orderRef: "",
    customerId,
    customerName: `Customer ${customerId}`,
    expectedShipDate: "2026-03-10",
    actualShipDate: overrides.actualShipDate !== undefined ? overrides.actualShipDate : "2026-03-10",
    shipToName: "",
    shipToAddress: "",
    shipToContact: "",
    carrierName: "",
    documentNote: "",
    status: overrides.status ?? "CONFIRMED",
    trackingStatus: "SHIPPED",
    confirmedAt: overrides.confirmedAt !== undefined ? overrides.confirmedAt : "2026-03-10T10:00:00Z",
    deletedAt: null,
    archivedAt: null,
    totalLines: 1,
    totalQty: pallets * 10,
    totalNetWeightKgs: 0,
    totalGrossWeightKgs: 0,
    storages: "NJ / A",
    createdAt: "2026-03-10T09:00:00Z",
    updatedAt: "2026-03-10T10:00:00Z",
    lines: [{
      id: id * 100,
      documentId: id,
      skuMasterId: 1,
      itemNumber: "ITM-1",
      locationId: 1,
      locationName: "NJ",
      storageSection: "A",
      sku: "SKU-1",
      description: "Widget",
      quantity: pallets * 10,
      pallets,
      palletsDetailCtns: String(pallets),
      unitLabel: "CTN",
      cartonSizeMm: "",
      netWeightKgs: 0,
      grossWeightKgs: 0,
      lineNote: "",
      pickPallets: [],
      pickAllocations: [],
      createdAt: "2026-03-10T09:00:00Z"
    }]
  };
}

function makePallet(
  id: number,
  customerId: number,
  containerNo: string,
  status: PalletTrace["status"] = "STORED",
  overrides: Partial<PalletTrace> = {}
): PalletTrace {
  return {
    id,
    parentPalletId: 0,
    palletCode: `PLT-${String(id).padStart(3, "0")}`,
    containerVisitId: 1,
    sourceInboundDocumentId: 1,
    sourceInboundLineId: 1,
    actualArrivalDate: "2026-03-01",
    customerId,
    customerName: `Customer ${customerId}`,
    skuMasterId: 1,
    sku: "SKU-1",
    description: "Widget",
    currentLocationId: 1,
    currentLocationName: "NJ",
    currentStorageSection: "A",
    currentContainerNo: containerNo,
    containerType: "NORMAL",
    status,
    createdAt: "2026-03-01T09:00:00Z",
    updatedAt: "2026-03-31T23:59:00Z",
    contents: [],
    ...overrides
  };
}

function makeEvent(
  id: number,
  palletId: number,
  palletCode: string,
  containerNo: string,
  eventType: string,
  eventTime: string,
  palletDelta = 1,
  quantityDelta = 10,
  customerId = 1
): PalletLocationEvent {
  return {
    id,
    palletId,
    palletCode,
    containerVisitId: 1,
    customerId,
    customerName: `Customer ${customerId}`,
    locationId: 1,
    locationName: "NJ",
    storageSection: "A",
    containerNo,
    eventType,
    quantityDelta,
    palletDelta,
    eventTime,
    createdAt: eventTime
  };
}
