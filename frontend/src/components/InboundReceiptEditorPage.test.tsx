import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  api: {
    createInboundDocument: vi.fn(),
    updateInboundDocument: vi.fn(),
    updateInboundDocumentNote: vi.fn()
  }
}));

import { api } from "../lib/api";
import { renderWithProviders } from "../test/renderWithProviders";
import { createCustomer, createInboundDocument, createLocation } from "../test/fixtures";
import { InboundReceiptEditorPage } from "./InboundReceiptEditorPage";

const mockedApi = api as unknown as {
  createInboundDocument: ReturnType<typeof vi.fn>;
  updateInboundDocument: ReturnType<typeof vi.fn>;
  updateInboundDocumentNote: ReturnType<typeof vi.fn>;
};

describe("InboundReceiptEditorPage", () => {
  beforeEach(() => {
    mockedApi.createInboundDocument.mockReset();
    mockedApi.updateInboundDocument.mockReset();
    mockedApi.updateInboundDocumentNote.mockReset();
    window.sessionStorage.clear();
  });

  it("saves a new receipt as a server draft and opens the edit route", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onOpenReceiptEditor = vi.fn();
    const onOpenInboundDetail = vi.fn();

    mockedApi.createInboundDocument.mockResolvedValue(createInboundDocument({
      id: 99,
      status: "DRAFT",
      trackingStatus: "SCHEDULED",
      containerNo: "MSCU1234567"
    }));

    renderWithProviders(
      <InboundReceiptEditorPage
        routeKey="/inbound-management/new"
        documentId={null}
        document={null}
        items={[]}
        skuMasters={[]}
        locations={[createLocation()]}
        customers={[createCustomer()]}
        inboundDocuments={[]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={onRefresh}
        onBackToList={vi.fn()}
        onOpenInboundDetail={onOpenInboundDetail}
        onOpenReceiptEditor={onOpenReceiptEditor}
      />
    );

    const headerInputs = document.querySelectorAll(".sheet-form input");
    fireEvent.change(headerInputs[0] as HTMLInputElement, { target: { value: "2026-03-31" } });
    fireEvent.change(headerInputs[2] as HTMLInputElement, { target: { value: "MSCU1234567" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    const inboundLineInputs = document.querySelectorAll(".batch-line-grid--inbound input");
    fireEvent.change(inboundLineInputs[0] as HTMLInputElement, { target: { value: "ABC123" } });
    fireEvent.change(inboundLineInputs[1] as HTMLInputElement, { target: { value: "Sample inbound SKU" } });
    fireEvent.change(inboundLineInputs[2] as HTMLInputElement, { target: { value: "8" } });
    fireEvent.change(inboundLineInputs[3] as HTMLInputElement, { target: { value: "8" } });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => {
      expect(mockedApi.createInboundDocument).toHaveBeenCalledWith({
        customerId: 1,
        locationId: 1,
        expectedArrivalDate: "2026-03-31",
        actualArrivalDate: undefined,
        containerNo: "MSCU1234567",
        containerType: "NORMAL",
        handlingMode: "PALLETIZED",
        storageSection: "TEMP",
        unitLabel: "CTN",
        status: "DRAFT",
        trackingStatus: "SCHEDULED",
        documentNote: undefined,
        lines: [
          {
            sku: "ABC123",
            description: "Sample inbound SKU",
            reorderLevel: 2,
            expectedQty: 8,
            receivedQty: 8,
            pallets: 0,
            palletsDetailCtns: undefined,
            storageSection: "TEMP",
            lineNote: undefined
          }
        ]
      });
    });

    expect(onRefresh).toHaveBeenCalled();
    expect(onOpenReceiptEditor).toHaveBeenCalledWith(99);
    expect(onOpenInboundDetail).not.toHaveBeenCalled();
  });

  it("ignores browser session drafts and starts from the source state", async () => {
    window.sessionStorage.setItem("sim-inbound-receipt-editor-draft:new", JSON.stringify({
      version: 1,
      form: {
        expectedArrivalDate: "2026-04-01",
        containerNo: "MSCU7654321",
        handlingMode: "PALLETIZED",
        customerId: "1",
        locationId: "1",
        storageSection: "TEMP",
        unitLabel: "CTN",
        documentNote: "temporary receipt note"
      },
      lines: [
        {
          id: "line-1",
          sku: "022334",
          description: "Local draft SKU",
          storageSection: "TEMP",
          reorderLevel: 1,
          expectedQty: 5,
          receivedQty: 5,
          pallets: 0,
          unitsPerPallet: 0,
          palletsDetailCtns: "",
          palletBreakdown: [],
          palletBreakdownExplicit: false,
          palletBreakdownTouched: false,
          lineNote: "draft line note"
        }
      ],
      step: 2,
      inboundEditorIntent: null
    }));

    renderWithProviders(
      <InboundReceiptEditorPage
        routeKey="/inbound-management/new"
        documentId={null}
        document={null}
        items={[]}
        skuMasters={[]}
        locations={[createLocation()]}
        customers={[createCustomer()]}
        inboundDocuments={[]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onBackToList={vi.fn()}
        onOpenInboundDetail={vi.fn()}
        onOpenReceiptEditor={vi.fn()}
      />
    );

    expect(screen.queryByDisplayValue("Local draft SKU")).not.toBeInTheDocument();
    const headerInputs = document.querySelectorAll(".sheet-form input");
    expect((headerInputs[2] as HTMLInputElement).value).toBe("");
  });

  it("auto-fills expected arrival date when actual arrival date is entered first", () => {
    renderWithProviders(
      <InboundReceiptEditorPage
        routeKey="/inbound-management/new"
        documentId={null}
        document={null}
        items={[]}
        skuMasters={[]}
        locations={[createLocation()]}
        customers={[createCustomer()]}
        inboundDocuments={[]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onBackToList={vi.fn()}
        onOpenInboundDetail={vi.fn()}
        onOpenReceiptEditor={vi.fn()}
      />
    );

    const expectedArrivalInput = screen.getByLabelText("Expected Arrival Date") as HTMLInputElement;
    const actualArrivalInput = screen.getByLabelText("Actual Arrival Date") as HTMLInputElement;

    fireEvent.change(actualArrivalInput, { target: { value: "2026-04-02" } });

    expect(actualArrivalInput.value).toBe("2026-04-02");
    expect(expectedArrivalInput.value).toBe("2026-04-02");
  });

  it("allows confirmed receipts to save document notes independently", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    mockedApi.updateInboundDocumentNote.mockResolvedValue(createInboundDocument({
      id: 12,
      status: "CONFIRMED",
      trackingStatus: "RECEIVED",
      documentNote: "Updated confirmed receipt note"
    }));

    renderWithProviders(
      <InboundReceiptEditorPage
        routeKey="/inbound-management/12"
        documentId={12}
        document={createInboundDocument({
          id: 12,
          status: "CONFIRMED",
          trackingStatus: "RECEIVED",
          documentNote: "Original confirmed receipt note"
        })}
        items={[]}
        skuMasters={[]}
        locations={[createLocation()]}
        customers={[createCustomer()]}
        inboundDocuments={[]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={onRefresh}
        onBackToList={vi.fn()}
        onOpenInboundDetail={vi.fn()}
        onOpenReceiptEditor={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Document Notes"), { target: { value: "Updated confirmed receipt note" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Note" }));

    await waitFor(() => {
      expect(mockedApi.updateInboundDocumentNote).toHaveBeenCalledWith(12, {
        documentNote: "Updated confirmed receipt note"
      });
    });

    expect(onRefresh).toHaveBeenCalled();
  });
});
