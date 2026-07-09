import { describe, expect, it } from "vitest";

import { buildBillingPreview, DEFAULT_BILLING_RATES } from "./billingPreview";
import type { BillingRates } from "./billingPreview";
import type { Customer, InboundDocument, OutboundDocument } from "./types";

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
  it("uses actualArrivalDate for inbound billing instead of expected arrival date", () => {
    const preview = buildBillingPreview({
      startDate: "2026-04-01",
      endDate: "2026-04-30",
      customerId: 1,
      customers,
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

    const receiptLines = preview.invoiceLines.filter((line) => line.chargeType !== "STORAGE");
    expect(receiptLines).toHaveLength(2);
    expect(receiptLines[0]?.occurredOn).toBe("2026-04-02");
    expect(receiptLines[1]?.occurredOn).toBe("2026-04-02");
  });

  it("uses actualShipDate when counting shipped pallets for the billing period", () => {
    const preview = buildBillingPreview({
      startDate: "2026-04-01",
      endDate: "2026-04-30",
      customerId: 1,
      customers,
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
              pickAllocations: [],
              createdAt: "2026-03-31T08:00:00Z"
            }
          ]
        }
      ],
      rates: DEFAULT_BILLING_RATES
    });

    expect(preview.invoiceLines).toHaveLength(0);
    expect(preview.summary.shippedPallets).toBe(2);
  });

  it("does not pull an April 1 receipt into the March billing window when the arrival date carries a timezone offset", () => {
    const preview = buildBillingPreview({
      startDate: "2026-03-01",
      endDate: "2026-03-31",
      customerId: 1,
      customers,
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
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Empty / zero-data
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    it("returns zeroed summary and empty collections for completely empty input", () => {
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers: [],
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

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Billability guards â€” status & date range
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    it("skips DELETED inbound documents", () => {
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
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
        inboundDocuments: [makeInboundDoc(1, 1, { actualArrivalDate: "2026-02-28" })],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.invoiceLines.filter((line) => line.chargeType !== "STORAGE")).toHaveLength(0);
    });

    it("includes an inbound document arriving on the billing range endDate (inclusive boundary)", () => {
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
        inboundDocuments: [makeInboundDoc(1, 1, { actualArrivalDate: "2026-03-31", pallets: 3 })],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      // Expect INBOUND + WRAPPING lines both dated on Mar 31
      expect(preview.invoiceLines).toHaveLength(2);
      expect(preview.invoiceLines.every((line) => line.occurredOn === "2026-03-31")).toBe(true);
    });

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Zero-pallet documents
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    it("generates only the container fee and no wrapping line when an inbound document has 0 pallets", () => {
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
        inboundDocuments: [makeInboundDoc(1, 1, { actualArrivalDate: "2026-03-05", pallets: 0 })],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.invoiceLines).toHaveLength(1);
      expect(preview.invoiceLines[0]?.chargeType).toBe("INBOUND");
      expect(preview.summary.wrappingAmount).toBe(0);
    });

    it("generates no invoice line or shipped pallet count for an outbound document with 0 pallets", () => {
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
        inboundDocuments: [],
        outboundDocuments: [makeOutboundDoc(1, 1, { actualShipDate: "2026-03-10", pallets: 0 })],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.invoiceLines).toHaveLength(0);
      expect(preview.summary.shippedPallets).toBe(0);
    });

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Customer scoping
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    it("customerId filter excludes documents belonging to other customers", () => {
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: 1,
        customers,
        inboundDocuments: [
          makeInboundDoc(1, 1, { actualArrivalDate: "2026-03-05", containerNo: "CONT-CX1" }),
          makeInboundDoc(2, 2, { actualArrivalDate: "2026-03-05", containerNo: "CONT-CX2" })
        ],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.invoiceLines.every((line) => line.customerId === 1)).toBe(true);
      expect(preview.storageRows.every((row) => row.customerId === 1)).toBe(true);
    });

    it("customerId all aggregates invoice lines across all customers", () => {
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
        inboundDocuments: [
          makeInboundDoc(1, 1, { actualArrivalDate: "2026-03-05" }),
          makeInboundDoc(2, 2, { actualArrivalDate: "2026-03-10" })
        ],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      // 2 customers Ã— (INBOUND + WRAPPING) = 4 lines
      expect(preview.invoiceLines.filter((line) => line.chargeType !== "STORAGE")).toHaveLength(4);
      expect(preview.summary.inboundAmount).toBe(DEFAULT_BILLING_RATES.inboundContainerFee * 2);
    });

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Date-range normalization
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    it("auto-normalizes a reversed startDate/endDate pair and still bills correctly", () => {
      const preview = buildBillingPreview({
        startDate: "2026-03-31",  // reversed intentionally
        endDate: "2026-03-01",
        customerId: "all",
        customers,
        inboundDocuments: [makeInboundDoc(1, 1, { actualArrivalDate: "2026-03-15" })],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.startDate).toBe("2026-03-01");
      expect(preview.endDate).toBe("2026-03-31");
      // Document at Mar 15 is within the corrected range
      expect(preview.invoiceLines.length).toBeGreaterThan(0);
    });

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Storage interval logic
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Storage row grouping
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Storage fee arithmetic
    // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  });

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  it("calculates storage from document pallet counts", () => {
    const preview = buildBillingPreview({
      startDate: "2026-03-01",
      endDate: "2026-03-12",
      customerId: 1,
      customers,
      inboundDocuments: [
        makeInboundDoc(100, 1, {
          containerNo: "CONT-DIRECT",
          actualArrivalDate: "2026-03-01",
          pallets: 3
        })
      ],
      outboundDocuments: [
        makeOutboundDoc(200, 1, {
          containerNo: "CONT-DIRECT",
          actualShipDate: "2026-03-10",
          pallets: 1
        })
      ],
      rates: DEFAULT_BILLING_RATES
    });

    expect(preview.storageRows).toHaveLength(1);
    expect(preview.summary.palletDays).toBe(33);
    expect(preview.storageRows[0]).toMatchObject({
      containerNo: "CONT-DIRECT",
      palletsTracked: 3,
      palletDays: 33,
      freePalletDays: 21,
      billablePalletDays: 12,
      amount: 12
    });
    expect(preview.dailyBalanceRows.find((row) => row.date === "2026-03-09")?.palletCount).toBe(3);
    expect(preview.dailyBalanceRows.find((row) => row.date === "2026-03-10")?.palletCount).toBe(2);
  });

  it("uses source pallets for storage movement and line pallets for shipped pallet count", () => {
    const preview = buildBillingPreview({
      startDate: "2026-03-01",
      endDate: "2026-03-12",
      customerId: 1,
      customers,
      inboundDocuments: [
        makeInboundDoc(101, 1, {
          containerNo: "CONT-REPACK",
          actualArrivalDate: "2026-03-01",
          pallets: 30
        })
      ],
      outboundDocuments: [
        makeOutboundDoc(201, 1, {
          containerNo: "CONT-REPACK",
          actualShipDate: "2026-03-10",
          pallets: 28,
          sourcePallets: 30
        })
      ],
      rates: DEFAULT_BILLING_RATES
    });

    expect(preview.summary.shippedPallets).toBe(28);
    expect(preview.dailyBalanceRows.find((row) => row.date === "2026-03-09")?.palletCount).toBe(30);
    expect(preview.dailyBalanceRows.find((row) => row.date === "2026-03-10")?.palletCount).toBe(0);
  });

  it("falls back to allocation pallets when source pallets are absent from legacy shipment data", () => {
    const preview = buildBillingPreview({
      startDate: "2026-03-01",
      endDate: "2026-03-12",
      customerId: 1,
      customers,
      inboundDocuments: [
        makeInboundDoc(101, 1, {
          containerNo: "CONT-LEGACY",
          actualArrivalDate: "2026-03-01",
          pallets: 12
        })
      ],
      outboundDocuments: [
        makeOutboundDoc(201, 1, {
          containerNo: "CONT-LEGACY",
          actualShipDate: "2026-03-10",
          pallets: 12
        })
      ],
      rates: DEFAULT_BILLING_RATES
    });

    expect(preview.dailyBalanceRows.find((row) => row.date === "2026-03-10")?.palletCount).toBe(0);
  });

  it("does not fall back to target pallets when source pallets are explicitly zero", () => {
    const preview = buildBillingPreview({
      startDate: "2026-03-01",
      endDate: "2026-03-12",
      customerId: 1,
      customers,
      inboundDocuments: [
        makeInboundDoc(101, 1, {
          containerNo: "CONT-SPLIT",
          actualArrivalDate: "2026-03-01",
          pallets: 12
        })
      ],
      outboundDocuments: [
        makeOutboundDoc(201, 1, {
          containerNo: "CONT-SPLIT",
          actualShipDate: "2026-03-10",
          pallets: 12,
          sourcePallets: 0
        })
      ],
      rates: DEFAULT_BILLING_RATES
    });

    expect(preview.dailyBalanceRows.find((row) => row.date === "2026-03-10")?.palletCount).toBe(12);
  });

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
  //     PLT-001 REVERSAL event â€“ stock correction; must NOT break storage interval
  //
  //   Shipment 1 (Mar 10): PLT-001 OUTBOUND 10:00
  //   Shipment 2 (Mar 18): PLT-002 OUTBOUND 14:00
  //   Inventory adjustment (Mar 20): PLT-003 CANCELLED 11:00
  //
  //   Expected pallet-days (day-end midnight boundary):
  //     PLT-001: Mar 3â€“9  â†’  7 days  (interval.end=Mar10 10:00; not â‰¥ midnight Mar11)
  //     PLT-002: Mar 3â€“17 â†’ 15 days  (interval.end=Mar18 14:00; not â‰¥ midnight Mar19)
  //     PLT-003: Mar 3â€“19 â†’ 17 days  (interval.end=Mar20 11:00; not â‰¥ midnight Mar21)
  //     Total: 39 pallet-days â†’ $39 storage at DEFAULT rates ($1/pallet/day)
  //
  //   Expected invoice lines (3 total):
  //     INBOUND  Mar 3   $450
  //     WRAPPING Mar 3   3 Ã— $10 = $30
  //     STORAGE  â€“       $18 after normal-pallet grace
  //     Grand total: $513
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // Billing date fallbacks and reference formatting
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  describe("billing date fallbacks and reference formatting", () => {

    // â”€â”€ Inbound date fallback chain â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    it("uses confirmedAt as inbound billing date when actualArrivalDate is null", () => {
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
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

    // â”€â”€ Outbound date fallback chain â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    it("uses confirmedAt as the outbound shipped pallet date when actualShipDate is null", () => {
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
        inboundDocuments: [],
        outboundDocuments: [makeOutboundDoc(1, 1, {
          actualShipDate: null,
          confirmedAt: "2026-03-14T08:00:00Z",
          pallets: 2
        })],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.invoiceLines).toHaveLength(0);
      expect(preview.summary.shippedPallets).toBe(2);
    });

    it("uses createdAt as the outbound shipped pallet date when actualShipDate and confirmedAt are both null", () => {
      // makeOutboundDoc sets createdAt = "2026-03-10T09:00:00Z"
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
        inboundDocuments: [],
        outboundDocuments: [makeOutboundDoc(1, 1, {
          actualShipDate: null,
          confirmedAt: null,
          pallets: 2
        })],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.invoiceLines).toHaveLength(0);
      expect(preview.summary.shippedPallets).toBe(2);
    });

    // â”€â”€ DELETED outbound â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    it("skips DELETED outbound documents", () => {
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
        inboundDocuments: [],
        outboundDocuments: [makeOutboundDoc(1, 1, { status: "DELETED", actualShipDate: "2026-03-15", pallets: 2 })],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.invoiceLines).toHaveLength(0);
      expect(preview.summary.shippedPallets).toBe(0);
      expect(preview.summary.outboundAmount).toBe(0);
    });

    // â”€â”€ containerNo normalisation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    it("normalises a blank containerNo to UNASSIGNED and omits it from the inbound reference", () => {
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
        inboundDocuments: [makeInboundDoc(1, 1, { containerNo: "" })],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      const inboundLine = preview.invoiceLines.find((l) => l.chargeType === "INBOUND");
      // Reference should be "Receipt 1" only â€” no "| UNASSIGNED" suffix
      expect(inboundLine?.reference).toBe("Receipt 1");
      expect(preview.storageRows).toHaveLength(1);
      expect(preview.storageRows[0]?.containerNo).toBe("UNASSIGNED");
    });

    // â”€â”€ Outbound reference fallback chain â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    it("does not create an outbound invoice line when packingListNo is blank", () => {
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
        inboundDocuments: [],
        outboundDocuments: [doc],
        rates: DEFAULT_BILLING_RATES
      });

      const outboundLine = preview.invoiceLines.find((l) => l.chargeType === "OUTBOUND");
      expect(outboundLine).toBeUndefined();
      expect(preview.summary.shippedPallets).toBe(1);
    });

    it("does not create an outbound invoice line when outbound references are blank", () => {
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
        inboundDocuments: [],
        outboundDocuments: [doc],
        rates: DEFAULT_BILLING_RATES
      });

      const outboundLine = preview.invoiceLines.find((l) => l.chargeType === "OUTBOUND");
      expect(outboundLine).toBeUndefined();
      expect(preview.summary.shippedPallets).toBe(1);
    });

    // â”€â”€ TRANSFER_IN as storage start event â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  });

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // Container lifecycle edge cases
  //
  // Covers scenarios that exercise individual engine rules in isolation:
  //   â€“ DRAFT documents included (only DELETED is excluded)
  //   â€“ Multi-line inbound: WRAPPING qty = sum of all lines' pallets
  //   â€“ Pallet count movement without explicit timing falls back to actualArrivalDate
  //   â€“ Single-day billing range
  //   â€“ Pallet received on last day of range = 1 pallet-day
  //   â€“ 3-phase partial outbound: correct segments and pallet-day total
  //   â€“ REVERSAL after CANCELLED reopens the storage interval
  //   â€“ Two customers sharing the same containerNo â†’ separate storage rows
  //   â€“ summary.receivedContainers / receivedPallets / shippedPallets
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  describe("container lifecycle edge cases", () => {

    // â”€â”€ DRAFT / status handling â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    it("includes a DRAFT inbound document in billing (only DELETED is excluded)", () => {
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
        inboundDocuments: [makeInboundDoc(1, 1, { status: "DRAFT", actualArrivalDate: "2026-03-10" })],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.invoiceLines.length).toBeGreaterThan(0);
      expect(preview.invoiceLines[0]?.chargeType).toBe("INBOUND");
    });

    it("counts a DRAFT outbound document in shipped pallets without creating a billing line", () => {
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
        inboundDocuments: [],
        outboundDocuments: [makeOutboundDoc(1, 1, { status: "DRAFT", actualShipDate: "2026-03-10", pallets: 2 })],
        rates: DEFAULT_BILLING_RATES
      });

      expect(preview.invoiceLines).toHaveLength(0);
      expect(preview.summary.shippedPallets).toBe(2);
    });

    // â”€â”€ Multi-line inbound â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    it("sums pallets across all inbound document lines when computing the WRAPPING fee", () => {
      // Two lines: 3 pallets + 2 pallets = 5 total â†’ WRAPPING qty=5, amount=$50
      const doc: InboundDocument = {
        ...makeInboundDoc(1, 1, { actualArrivalDate: "2026-03-10" }),
        lines: [
          { ...makeInboundDoc(1, 1).lines[0]!, pallets: 3 },
          {
            id: 9999, documentId: 1, sku: "SKU-2", description: "Gadget",
            storageSection: "A", expectedQty: 20, receivedQty: 20,
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
        inboundDocuments: [doc],
        outboundDocuments: [],
        rates: DEFAULT_BILLING_RATES
      });

      const wrapping = preview.invoiceLines.find((l) => l.chargeType === "WRAPPING");
      expect(wrapping?.quantity).toBe(5);
      expect(wrapping?.amount).toBe(75);
      expect(preview.summary.wrappingAmount).toBe(75);
    });

    // â”€â”€ Pallet event fallback â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    // â”€â”€ Range boundary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    // â”€â”€ 3-phase partial outbound â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    // â”€â”€ REVERSAL reopens a closed interval â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    // â”€â”€ Customer isolation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    // â”€â”€ Summary field correctness â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    it("summary.receivedContainers equals the count of billed inbound receipts", () => {
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
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
      // Doc 1: 3 pallets, Doc 2: 5 pallets â†’ total 8
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
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
      // Doc 1: 3 pallets, Doc 2: 4 pallets â†’ total 7
      const preview = buildBillingPreview({
        startDate: "2026-03-01",
        endDate: "2026-03-31",
        customerId: "all",
        customers,
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Local factory helpers for edge-case tests
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    sourcePallets?: number;
    containerNo?: string;
  } = {}
): OutboundDocument {
  const pallets = overrides.pallets ?? 2;
  const lineId = id * 100;
  const sourceContainerNo = overrides.containerNo ?? `CONT-${String(id).padStart(3, "0")}`;
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
      id: lineId,
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
      pickAllocations: [{
        id: id * 1000,
        lineId,
        itemNumber: "ITM-1",
        locationId: 1,
        locationName: "NJ",
        storageSection: "A",
        containerNo: sourceContainerNo,
        allocatedQty: pallets * 10,
        pallets,
        sourcePallets: overrides.sourcePallets,
        createdAt: "2026-03-10T09:00:00Z"
      }],
      createdAt: "2026-03-10T09:00:00Z"
    }]
  };
}
