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

  it("omits all-valued optional document filters", async () => {
    await api.getInboundDocuments(100, {
      archiveScope: "active",
      customerId: "all",
      locationId: "all",
      status: "all"
    });

    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestUrl.searchParams.get("archiveScope")).toBe("active");
    expect(requestUrl.searchParams.has("customerId")).toBe(false);
    expect(requestUrl.searchParams.has("locationId")).toBe(false);
    expect(requestUrl.searchParams.has("status")).toBe(false);
  });
});
