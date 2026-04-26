import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  api: {
    updateInboundDocumentTrackingStatus: vi.fn(),
    updateOutboundDocumentTrackingStatus: vi.fn(),
    copyInboundDocument: vi.fn(),
    copyOutboundDocument: vi.fn()
  }
}));

import { api } from "../lib/api";
import { renderWithProviders } from "../test/renderWithProviders";
import { createInboundDocument, createOutboundDocument } from "../test/fixtures";
import { DailyOperationsPage } from "./DailyOperationsPage";

const mockedApi = api as unknown as {
  updateInboundDocumentTrackingStatus: ReturnType<typeof vi.fn>;
  updateOutboundDocumentTrackingStatus: ReturnType<typeof vi.fn>;
  copyInboundDocument: ReturnType<typeof vi.fn>;
  copyOutboundDocument: ReturnType<typeof vi.fn>;
};

describe("DailyOperationsPage", () => {
  beforeEach(() => {
    mockedApi.updateInboundDocumentTrackingStatus.mockReset();
    mockedApi.updateOutboundDocumentTrackingStatus.mockReset();
    mockedApi.copyInboundDocument.mockReset();
    mockedApi.copyOutboundDocument.mockReset();
  });

  it("locks row actions while a receipt tracking update is running", () => {
    mockedApi.updateInboundDocumentTrackingStatus.mockImplementation(() => new Promise(() => {}));

    renderWithProviders(
      <DailyOperationsPage
        selectedDate="2026-03-24"
        inboundDocuments={[
          createInboundDocument({
            id: 11,
            expectedArrivalDate: "2026-03-24",
            status: "DRAFT",
            trackingStatus: "SCHEDULED",
            containerNo: "GCXU5817233"
          })
        ]}
        outboundDocuments={[]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onNavigate={vi.fn()}
        onOpenDate={vi.fn()}
        onOpenInboundDetail={vi.fn()}
        onOpenCreateInboundReceipt={vi.fn()}
        onOpenCreateOutboundShipment={vi.fn()}
        onOpenInboundReceiptEditor={vi.fn()}
        onOpenOutboundShipmentEditor={vi.fn()}
      />
    );

    const advanceButton = screen.getByRole("button", { name: "Mark Arrived" });
    const detailsButton = screen.getByRole("button", { name: "Details" });

    fireEvent.click(advanceButton);

    expect(advanceButton).toBeDisabled();
    expect(advanceButton).toHaveAttribute("aria-busy", "true");
    expect(detailsButton).toBeDisabled();
    expect(mockedApi.updateInboundDocumentTrackingStatus).toHaveBeenCalledWith(11, { trackingStatus: "ARRIVED" });
  });

  it("locks copy while a shipment re-entry request is running", () => {
    mockedApi.copyOutboundDocument.mockImplementation(() => new Promise(() => {}));

    renderWithProviders(
      <DailyOperationsPage
        selectedDate="2026-03-24"
        inboundDocuments={[]}
        outboundDocuments={[
          createOutboundDocument({
            id: 21,
            expectedShipDate: "2026-03-24",
            status: "DRAFT",
            trackingStatus: "PACKED",
            packingListNo: "PL-00021"
          })
        ]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onNavigate={vi.fn()}
        onOpenDate={vi.fn()}
        onOpenInboundDetail={vi.fn()}
        onOpenCreateInboundReceipt={vi.fn()}
        onOpenCreateOutboundShipment={vi.fn()}
        onOpenInboundReceiptEditor={vi.fn()}
        onOpenOutboundShipmentEditor={vi.fn()}
      />
    );

    const copyButton = screen.getByRole("button", { name: /Re-enter Shipment|reEnterShipment/ });

    fireEvent.click(copyButton);

    expect(copyButton).toBeDisabled();
    expect(copyButton).toHaveAttribute("aria-busy", "true");
    expect(mockedApi.copyOutboundDocument).toHaveBeenCalledWith(21);
  });
});
