import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BillingPreviewResult, ContainerLifecycleEvent } from "../lib/types";
import { createCustomer, createLocation } from "../test/fixtures";
import { renderWithProviders } from "../test/renderWithProviders";
import { BillingContainerDetailPage } from "./BillingContainerDetailPage";

const { getContainerLifecycleEvents, previewBilling } = vi.hoisted(() => ({
  getContainerLifecycleEvents: vi.fn(),
  previewBilling: vi.fn()
}));

vi.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: { getContainerLifecycleEvents, previewBilling }
}));

function authoritativePreview(lines: BillingPreviewResult["lines"] = []): BillingPreviewResult {
  return {
    calculationVersion: "container-v1",
    sourceFingerprint: "fingerprint-container-detail",
    customerId: 1,
    customerName: "Imperial Bag & Paper",
    warehouseLocationId: null,
    containerType: "",
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
    lines,
    storageRows: [],
    dailyBalances: [],
    summary: {
      receivedContainers: 0,
      receivedPallets: 0,
      shippedPallets: 0,
      palletDays: 0,
      inboundAmount: 0,
      wrappingAmount: 0,
      storageGrossAmount: 0,
      storageDiscountAmount: 0,
      storageAmount: 0,
      outboundAmount: 0,
      grandTotal: 0
    },
    warnings: []
  };
}

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

function renderPage(
  containerNo: string,
  options?: { customerId?: number | "all"; onOpenContainerDetail?: ReturnType<typeof vi.fn> }
) {
  const customerId = options?.customerId ?? "all";
  const onOpenContainerDetail = options?.onOpenContainerDetail ?? vi.fn();
  renderWithProviders(
    <BillingContainerDetailPage
      routeKey={`/billing/container/2026-03-01/2026-03-31/${customerId}/all/${containerNo}`}
      startDate="2026-03-01"
      endDate="2026-03-31"
      customerId={customerId}
      warehouseLocationId="all"
      containerNo={containerNo}
      customers={[createCustomer()]}
      locations={[createLocation()]}
      inboundDocuments={[]}
      outboundDocuments={[]}
      onBackToBilling={vi.fn()}
      onOpenContainerDetail={onOpenContainerDetail}
    />
  );
  return { onOpenContainerDetail };
}

describe("BillingContainerDetailPage", () => {
  beforeEach(() => {
    getContainerLifecycleEvents.mockReset();
    previewBilling.mockReset();
    previewBilling.mockResolvedValue(authoritativePreview());
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

  it("preserves the billed customer when opening the inventory container detail", async () => {
    getContainerLifecycleEvents.mockResolvedValue([]);
    const onOpenContainerDetail = vi.fn();
    renderPage("GCXU5817233", { customerId: 1, onOpenContainerDetail });

    fireEvent.click(screen.getByRole("button", { name: "View Detail" }));

    expect(onOpenContainerDetail).toHaveBeenCalledWith("GCXU5817233", 1);
    await screen.findByText("No billing detail found for this container.");
    expect(getContainerLifecycleEvents).toHaveBeenCalledWith(50000, "GCXU5817233", 1);
  });

  it("uses the authoritative server preview for a customer-scoped billing detail", async () => {
    getContainerLifecycleEvents.mockResolvedValue([]);
    previewBilling.mockResolvedValue(authoritativePreview([{
      id: "server-inbound-91",
      chargeType: "INBOUND",
      sourceType: "INBOUND_DOCUMENT",
      sourceId: 91,
      reference: "SERVER-ONLY-REFERENCE",
      containerNo: "GCXU5817233",
      containerType: "NORMAL",
      warehouse: "NJ",
      occurredOn: "2026-03-05",
      quantity: 1,
      unitRate: 450,
      amount: 450,
      description: "Inbound container fee"
    }]));

    renderPage("GCXU5817233", { customerId: 1 });

    const invoiceTable = await screen.findByRole("table", { name: "Invoice Preview" });
    expect(within(invoiceTable).getByText("SERVER-ONLY-REFERENCE")).toBeInTheDocument();
    expect(previewBilling).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 1,
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31"
    }));
  });
});
