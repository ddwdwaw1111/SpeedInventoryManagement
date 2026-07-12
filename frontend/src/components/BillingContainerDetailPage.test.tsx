import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ContainerLifecycleEvent } from "../lib/types";
import { createCustomer, createLocation } from "../test/fixtures";
import { renderWithProviders } from "../test/renderWithProviders";
import { BillingContainerDetailPage } from "./BillingContainerDetailPage";

const { getContainerLifecycleEvents } = vi.hoisted(() => ({
  getContainerLifecycleEvents: vi.fn()
}));

vi.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: { getContainerLifecycleEvents }
}));

function event(
  id: number,
  containerNo: string,
  eventType: string,
  eventTime: string,
  quantityDelta: number,
  palletDelta: number
): ContainerLifecycleEvent {
  return {
    id,
    stockLedgerId: id,
    customerId: 1,
    customerName: "Imperial Bag & Paper",
    locationId: 1,
    locationName: "NJ",
    storageSection: "TEMP",
    containerNo,
    eventType,
    eventTime,
    quantityDelta,
    palletDelta,
    skuMasterId: 1,
    sourceDocumentType: eventType === "RECEIVE" ? "INBOUND" : "OUTBOUND",
    sourceDocumentId: id,
    sourceLineId: id,
    packingListNo: "",
    orderRef: "",
    itemNumber: "608333",
    description: "VB22GC",
    expectedQty: 0,
    receivedQty: 0,
    pallets: Math.abs(palletDelta),
    documentNote: "",
    reason: "",
    referenceCode: "",
    createdAt: eventTime
  };
}

function renderPage(containerNo: string) {
  renderWithProviders(
    <BillingContainerDetailPage
      routeKey={"/billing/container/2026-03-01/2026-03-31/all/all/" + containerNo}
      startDate="2026-03-01"
      endDate="2026-03-31"
      customerId="all"
      warehouseLocationId="all"
      containerNo={containerNo}
      customers={[createCustomer()]}
      locations={[createLocation()]}
      inboundDocuments={[]}
      outboundDocuments={[]}
      onBackToBilling={vi.fn()}
      onOpenContainerDetail={vi.fn()}
    />
  );
}

describe("BillingContainerDetailPage", () => {
  beforeEach(() => {
    getContainerLifecycleEvents.mockReset();
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem("sim-timezone", "UTC");
  });

  it("shows aggregate container events and cumulative independent deltas", async () => {
    getContainerLifecycleEvents.mockResolvedValue([
      event(101, "GCXU5817233", "RECEIVE", "2026-03-02T10:00:00Z", 10, 3),
      event(102, "GCXU5817233", "TRANSFER_IN", "2026-03-12T12:00:00Z", 0, 0),
      event(103, "GCXU5817233", "SHIP", "2026-03-20T10:00:00Z", -4, -1),
      event(104, "GCXU5817233", "RECEIVE", "2026-04-01T08:00:00Z", 99, 7),
      event(105, "MSCU0000001", "RECEIVE", "2026-03-06T08:00:00Z", 5, 1)
    ]);

    renderPage("GCXU5817233");

    const timelineTable = await screen.findByRole("table", { name: "Container Change Timeline" });
    expect(getContainerLifecycleEvents).toHaveBeenCalledWith(50000, "GCXU5817233", undefined);
    expect(within(timelineTable).getAllByRole("row")).toHaveLength(4);
    expect(within(timelineTable).getByText("RECEIVE")).toBeInTheDocument();
    expect(within(timelineTable).getByText("TRANSFER_IN")).toBeInTheDocument();
    expect(within(timelineTable).getByText("SHIP")).toBeInTheDocument();
    expect(within(timelineTable).queryByText("+99")).not.toBeInTheDocument();
    expect(within(timelineTable).queryByText("+5")).not.toBeInTheDocument();
    expect(within(timelineTable).getAllByText("+10").length).toBeGreaterThan(0);
    expect(within(timelineTable).getAllByText("+6").length).toBeGreaterThan(0);
    expect(within(timelineTable).getAllByText("+3").length).toBeGreaterThan(0);
    expect(within(timelineTable).getByText("-1")).toBeInTheDocument();
  });

  it("does not synthesize outbound rows from a receive-only lifecycle", async () => {
    getContainerLifecycleEvents.mockResolvedValue([
      event(201, "MSCU1234567", "RECEIVE", "2026-03-05T08:00:00Z", 12, 1)
    ]);

    renderPage("MSCU1234567");

    const timelineTable = await screen.findByRole("table", { name: "Container Change Timeline" });
    expect(within(timelineTable).getByText("RECEIVE")).toBeInTheDocument();
    expect(within(timelineTable).queryByText("SHIP")).not.toBeInTheDocument();
  });
});
