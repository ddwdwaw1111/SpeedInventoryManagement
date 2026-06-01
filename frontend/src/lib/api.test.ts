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
});
