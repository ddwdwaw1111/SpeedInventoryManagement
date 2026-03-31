import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { HomeDashboardPage } from "./HomeDashboardPage";
import { renderWithProviders } from "../test/renderWithProviders";
import { createInboundDocument, createItem, createOutboundDocument } from "../test/fixtures";

describe("HomeDashboardPage", () => {
  it("renders the operations board and routes users to core workflows", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const onOpenDailyOperations = vi.fn();

    renderWithProviders(
      <HomeDashboardPage
        currentUserRole="admin"
        items={[
          createItem(),
          createItem({
            id: 2,
            sku: "603482",
            itemNumber: "603482",
            quantity: 2,
            availableQty: 2,
            reorderLevel: 5,
            containerNo: "MRSU6884820"
          })
        ]}
        inboundDocuments={[
          createInboundDocument({
            id: 11,
            status: "DRAFT",
            trackingStatus: "ARRIVED"
          })
        ]}
        outboundDocuments={[
          createOutboundDocument({
            id: 21,
            status: "DRAFT",
            trackingStatus: "PICKING"
          })
        ]}
        adjustments={[]}
        transfers={[]}
        cycleCounts={[]}
        isLoading={false}
        errorMessage=""
        onNavigate={onNavigate}
        onOpenDailyOperations={onOpenDailyOperations}
      />
    );

    expect(screen.getByRole("heading", { name: "Operational Overview" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Warehouse Throughput" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Processing Calendar" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Inbound Appointments" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Outbound Execution" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Schedule Receipts" }));
    expect(onNavigate).toHaveBeenCalledWith("inbound-management");

    await user.click(screen.getByRole("button", { name: "Schedule Shipments" }));
    expect(onNavigate).toHaveBeenCalledWith("outbound-management");

    await user.click(screen.getByRole("button", { name: "View Full Logs" }));
    expect(onNavigate).toHaveBeenCalledWith("all-activity");

    await user.click(screen.getAllByRole("button", { name: /Open the day board for/i })[0]);
    expect(onOpenDailyOperations).toHaveBeenCalled();
  });
});
