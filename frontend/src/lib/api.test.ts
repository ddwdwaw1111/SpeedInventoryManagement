import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "./api";

const fetchMock = vi.fn();

function mockJsonResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(payload)
  };
}

describe("api document list queries", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(mockJsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);
  });

  it("serializes inbound document filter query parameters", async () => {
    await api.getInboundDocuments(25, {
      archiveScope: "archived",
      search: " GCXU5817233 ",
      customerId: 12,
      locationId: 34,
      status: "CONFIRMED"
    });

    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestUrl.pathname).toBe("/api/inbound-documents");
    expect(requestUrl.searchParams.get("limit")).toBe("25");
    expect(requestUrl.searchParams.get("archiveScope")).toBe("archived");
    expect(requestUrl.searchParams.get("customerId")).toBe("12");
    expect(requestUrl.searchParams.get("locationId")).toBe("34");
    expect(requestUrl.searchParams.get("status")).toBe("CONFIRMED");
    expect(requestUrl.searchParams.get("search")).toBe("GCXU5817233");
  });

  it("posts selected receipt IDs and the target bulk status", async () => {
    fetchMock.mockResolvedValue(mockJsonResponse({ updatedDocuments: 2, status: "CONFIRMED", documents: [] }));

    await api.bulkUpdateInboundDocumentStatus([11, 12], "CONFIRMED");

    const [requestUrl, options] = fetchMock.mock.calls[0];
    expect(new URL(String(requestUrl)).pathname).toBe("/api/inbound-documents/bulk-status");
    expect(options).toEqual(expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ documentIds: [11, 12], status: "CONFIRMED" })
    }));
  });

  it("posts selected shipment IDs for atomic bulk confirmation", async () => {
    fetchMock.mockResolvedValue(mockJsonResponse({ updatedDocuments: 2, documents: [] }));

    await api.bulkConfirmOutboundDocuments([21, 22]);

    const [requestUrl, options] = fetchMock.mock.calls[0];
    expect(new URL(String(requestUrl)).pathname).toBe("/api/outbound-documents/bulk-confirm");
    expect(options).toEqual(expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ documentIds: [21, 22] })
    }));
  });

  it("keeps the legacy outbound archive scope argument", async () => {
    await api.getOutboundDocuments(300, "all");

    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestUrl.pathname).toBe("/api/outbound-documents");
    expect(requestUrl.searchParams.get("limit")).toBe("300");
    expect(requestUrl.searchParams.get("archiveScope")).toBe("all");
    expect(requestUrl.searchParams.has("customerId")).toBe(false);
    expect(requestUrl.searchParams.has("locationId")).toBe(false);
    expect(requestUrl.searchParams.has("status")).toBe(false);
  });

  it("serializes outbound tracking status filters", async () => {
    await api.getOutboundDocuments(50, {
      archiveScope: "all",
      status: "CONFIRMED",
      trackingStatus: "BO_RECEIVED"
    });

    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestUrl.pathname).toBe("/api/outbound-documents");
    expect(requestUrl.searchParams.get("trackingStatus")).toBe("BO_RECEIVED");
  });

  it("serializes an exact container inventory position filter", async () => {
    await api.getItems({ containerNo: " GCXU5817233 ", customerId: 12, locationId: 34 });

    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestUrl.pathname).toBe("/api/items");
    expect(requestUrl.searchParams.get("containerNo")).toBe("GCXU5817233");
    expect(requestUrl.searchParams.get("customerId")).toBe("12");
    expect(requestUrl.searchParams.get("locationId")).toBe("34");
  });

  it("updates only explicit metadata for a customer-scoped container", async () => {
    const payload = {
      customerId: 12,
      containerType: "WEST_COAST_TRANSFER" as const,
      handlingMode: "PALLETIZED" as const
    };

    await api.updateV2ContainerMetadata(" CONT/100 ", payload);

    const [requestUrl, options] = fetchMock.mock.calls[0];
    expect(new URL(String(requestUrl)).pathname).toBe("/api/v2/containers/%20CONT%2F100%20/metadata");
    expect(options).toEqual(expect.objectContaining({
      method: "PUT",
      body: JSON.stringify(payload)
    }));
  });

  it("serializes customer portal picking order tracking status filters", async () => {
    await api.getCustomerPortalPickingOrders(25, {
      search: " PO-100 ",
      status: "CONFIRMED",
      trackingStatus: "SHIPPED"
    });

    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestUrl.pathname).toBe("/api/customer-portal/picking-orders");
    expect(requestUrl.searchParams.get("limit")).toBe("25");
    expect(requestUrl.searchParams.get("search")).toBe("PO-100");
    expect(requestUrl.searchParams.get("status")).toBe("CONFIRMED");
    expect(requestUrl.searchParams.get("trackingStatus")).toBe("SHIPPED");
  });

  it("serializes customer portal packing list tracking status filters", async () => {
    await api.getCustomerPortalPackingLists(25, {
      search: " CNT-100 ",
      status: "DRAFT",
      trackingStatus: "RECEIVING_RECEIVED"
    });

    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestUrl.pathname).toBe("/api/customer-portal/packing-lists");
    expect(requestUrl.searchParams.get("limit")).toBe("25");
    expect(requestUrl.searchParams.get("search")).toBe("CNT-100");
    expect(requestUrl.searchParams.get("status")).toBe("DRAFT");
    expect(requestUrl.searchParams.get("trackingStatus")).toBe("RECEIVING_RECEIVED");
  });

  it("serializes admin-scoped customer portal picking order filters", async () => {
    await api.getCustomerPortalPickingOrders(25, {
      search: " PO-100 ",
      status: "CONFIRMED",
      trackingStatus: "SHIPPED"
    }, 42);

    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestUrl.pathname).toBe("/api/admin/customer-portal/customers/42/picking-orders");
    expect(requestUrl.searchParams.get("limit")).toBe("25");
    expect(requestUrl.searchParams.get("search")).toBe("PO-100");
    expect(requestUrl.searchParams.get("status")).toBe("CONFIRMED");
    expect(requestUrl.searchParams.get("trackingStatus")).toBe("SHIPPED");
  });

  it("serializes admin-scoped customer portal packing list filters", async () => {
    await api.getCustomerPortalPackingLists(25, {
      search: " CNT-100 ",
      status: "DRAFT",
      trackingStatus: "RECEIVING_RECEIVED"
    }, 42);

    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestUrl.pathname).toBe("/api/admin/customer-portal/customers/42/packing-lists");
    expect(requestUrl.searchParams.get("limit")).toBe("25");
    expect(requestUrl.searchParams.get("search")).toBe("CNT-100");
    expect(requestUrl.searchParams.get("status")).toBe("DRAFT");
    expect(requestUrl.searchParams.get("trackingStatus")).toBe("RECEIVING_RECEIVED");
  });

  it("loads customer portal profile through the portal API", async () => {
    await api.getCustomerPortalProfile();

    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestUrl.pathname).toBe("/api/customer-portal/profile");
  });

  it("loads admin-scoped customer portal profile without the staff customer list API", async () => {
    await api.getCustomerPortalProfile(42);

    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestUrl.pathname).toBe("/api/admin/customer-portal/customers/42/profile");
  });

  it("omits all-valued optional document filters", async () => {
    await api.getInboundDocuments(100, {
      archiveScope: "active",
      search: "   ",
      customerId: "all",
      locationId: "all",
      status: "all",
      trackingStatus: "all"
    });

    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestUrl.searchParams.get("archiveScope")).toBe("active");
    expect(requestUrl.searchParams.has("customerId")).toBe(false);
    expect(requestUrl.searchParams.has("locationId")).toBe(false);
    expect(requestUrl.searchParams.has("status")).toBe(false);
    expect(requestUrl.searchParams.has("trackingStatus")).toBe(false);
    expect(requestUrl.searchParams.has("search")).toBe(false);
  });

  it("posts an authoritative billing preview scope", async () => {
    const payload = {
      customerId: 12,
      warehouseLocationId: 34,
      containerType: "NORMAL" as const,
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      normalPalletGracePeriodEnabled: true,
      rates: {
        inboundContainerFee: 450,
        transferInboundFeePerPallet: 10,
        wrappingFeePerPallet: 15,
        storageFeePerPalletPerWeek: 7,
        storageFeePerPalletPerWeekNormal: 7,
        storageFeePerPalletPerWeekWestCoastTransfer: 7,
        outboundFeePerPallet: 0
      }
    };

    await api.previewBilling(payload);

    const [requestUrl, options] = fetchMock.mock.calls[0];
    expect(new URL(String(requestUrl)).pathname).toBe("/api/billing/preview");
    expect(options).toEqual(expect.objectContaining({
      method: "POST",
      body: JSON.stringify(payload)
    }));
  });

  it("generates an invoice from scope and fingerprint without client-calculated lines", async () => {
    const payload = {
      invoiceType: "MIXED" as const,
      customerId: 12,
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      normalPalletGracePeriodEnabled: true,
      rates: {
        inboundContainerFee: 450,
        transferInboundFeePerPallet: 10,
        wrappingFeePerPallet: 15,
        storageFeePerPalletPerWeek: 7,
        storageFeePerPalletPerWeekNormal: 7,
        storageFeePerPalletPerWeekWestCoastTransfer: 7,
        outboundFeePerPallet: 0
      },
      sourceFingerprint: "source-fingerprint"
    };

    await api.generateBillingInvoice(payload);

    const [requestUrl, options] = fetchMock.mock.calls[0];
    expect(new URL(String(requestUrl)).pathname).toBe("/api/billing/invoices/generate");
    expect(options).toEqual(expect.objectContaining({
      method: "POST",
      body: JSON.stringify(payload)
    }));
    expect(JSON.parse(String(options.body))).not.toHaveProperty("lines");
  });
});
