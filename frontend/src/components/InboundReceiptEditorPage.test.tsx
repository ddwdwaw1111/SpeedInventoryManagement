import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  api: {
    createInboundDocument: vi.fn(),
    updateInboundDocument: vi.fn(),
    updateInboundDocumentNote: vi.fn(),
    copyInboundDocument: vi.fn()
  }
}));

import { api } from "../lib/api";
import { renderWithProviders } from "../test/renderWithProviders";
import { createCustomer, createInboundDocument, createLocation, createSkuMaster } from "../test/fixtures";
import { InboundReceiptEditorPage } from "./InboundReceiptEditorPage";

const mockedApi = api as unknown as {
  createInboundDocument: ReturnType<typeof vi.fn>;
  updateInboundDocument: ReturnType<typeof vi.fn>;
  updateInboundDocumentNote: ReturnType<typeof vi.fn>;
  copyInboundDocument: ReturnType<typeof vi.fn>;
};

describe("InboundReceiptEditorPage", () => {
  beforeEach(() => {
    mockedApi.createInboundDocument.mockReset();
    mockedApi.updateInboundDocument.mockReset();
    mockedApi.updateInboundDocumentNote.mockReset();
    mockedApi.copyInboundDocument.mockReset();
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

    fireEvent.change(screen.getByLabelText("Warehouse"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Customer"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Actual Arrival Date"), { target: { value: "2026-03-31" } });
    fireEvent.change(screen.getByLabelText("Container No."), { target: { value: "MSCU1234567" } });
    expect(screen.queryByLabelText("Inbound Unit")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/SKU.*#1/), { target: { value: "ABC123" } });
    fireEvent.change(screen.getByLabelText("Item Code #1"), { target: { value: "ITEM-ABC123" } });
    fireEvent.change(screen.getByLabelText("Description #1"), { target: { value: "Sample inbound SKU" } });
    fireEvent.change(screen.getByLabelText(/Expected QTY #1/), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Received #1"), { target: { value: "8" } });

    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => {
      expect(mockedApi.createInboundDocument).toHaveBeenCalledWith({
        customerId: 1,
        locationId: 1,
        expectedArrivalDate: "2026-03-31",
        actualArrivalDate: "2026-03-31",
        containerNo: "MSCU1234567",
        containerType: "NORMAL",
        handlingMode: "PALLETIZED",
        storageSection: "TEMP",
        status: "DRAFT",
        trackingStatus: "SCHEDULED",
        documentNote: undefined,
        lines: [
          {
            itemNumber: "ITEM-ABC123",
            sku: "ABC123",
            description: "Sample inbound SKU",
            expectedQty: 8,
            receivedQty: 8,
            pallets: 0,
            unitsPerPallet: undefined,
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

  it("records CTN per Pallet without coupling it to received quantity or pallet count", async () => {
    mockedApi.createInboundDocument.mockResolvedValue(createInboundDocument({
      id: 100,
      status: "CONFIRMED",
      trackingStatus: "RECEIVED",
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
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onBackToList={vi.fn()}
        onOpenInboundDetail={vi.fn()}
        onOpenReceiptEditor={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Warehouse"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Customer"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Actual Arrival Date"), { target: { value: "2026-03-31" } });
    fireEvent.change(screen.getByLabelText("Container No."), { target: { value: "MSCU1234567" } });
    fireEvent.change(screen.getByLabelText(/SKU.*#1/), { target: { value: "ABC123" } });
    fireEvent.change(screen.getByLabelText("Item Code #1"), { target: { value: "ITEM-ABC123" } });
    fireEvent.change(screen.getByLabelText("Description #1"), { target: { value: "Sample inbound SKU" } });
    fireEvent.change(screen.getByLabelText(/Expected QTY #1/), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Received #1"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("PALLETS #1"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("CTN / Pallet #1"), { target: { value: "4" } });

    expect(screen.queryByLabelText("Reorder Level #1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm Receipt" }));

    await waitFor(() => expect(mockedApi.createInboundDocument).toHaveBeenCalledTimes(1));
    expect(mockedApi.createInboundDocument.mock.calls[0][0].lines[0]).toEqual({
      itemNumber: "ITEM-ABC123",
      sku: "ABC123",
      description: "Sample inbound SKU",
      expectedQty: 8,
      receivedQty: 8,
      pallets: 3,
      unitsPerPallet: 4,
      palletsDetailCtns: undefined,
      storageSection: "TEMP",
      lineNote: undefined
    });
    expect(mockedApi.createInboundDocument.mock.calls[0][0].lines[0]).not.toHaveProperty("palletBreakdown");
    expect(mockedApi.createInboundDocument.mock.calls[0][0].lines[0]).not.toHaveProperty("reorderLevel");
  });

  it("keeps SKU and Item Code as separate fields and resolves either identifier", () => {
    renderWithProviders(
      <InboundReceiptEditorPage
        routeKey="/inbound-management/new"
        documentId={null}
        document={null}
        items={[]}
        skuMasters={[createSkuMaster({ sku: "SKU-100", itemNumber: "ITEM-100", description: "Known item" })]}
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

    fireEvent.change(screen.getByLabelText(/SKU.*#1/), { target: { value: "SKU-100" } });
    expect(screen.getByLabelText("Item Code #1")).toHaveValue("ITEM-100");

    fireEvent.change(screen.getByLabelText(/SKU.*#1/), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Item Code #1"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Item Code #1"), { target: { value: "ITEM-100" } });
    expect(screen.getByLabelText(/SKU.*#1/)).toHaveValue("SKU-100");
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
    expect(screen.queryByDisplayValue("2026-04-01")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Warehouse")).toHaveValue("");
    expect(screen.getByLabelText("Customer")).toHaveValue("");
    expect(screen.getByLabelText("Container No.")).toHaveValue("");
  });

  it("adds SKU rows from the dashed table row", () => {
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

    expect(screen.queryByRole("button", { name: "Fill All Received" })).not.toBeInTheDocument();
    expect(document.querySelectorAll("[id^='receipt-editor-line-']")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Add SKU Line" }));

    expect(document.querySelectorAll("[id^='receipt-editor-line-']")).toHaveLength(2);
  });

  it("requires warehouse, actual arrival date, and container number before saving", async () => {
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

    expect(screen.queryByLabelText("Expected Arrival Date")).not.toBeInTheDocument();
    expect(screen.queryByText("Required")).not.toBeInTheDocument();
    expect(screen.queryByText("Optional")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".inbound-entry-field-label__required-mark")).toHaveLength(5);
    expect(screen.getByLabelText("Warehouse")).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    expect(await screen.findByText("Choose a storage location before saving.")).toBeInTheDocument();
    expect(screen.getByLabelText("Warehouse")).toHaveClass("inbound-entry-input--invalid");
    expect(screen.getByLabelText("Customer")).toHaveClass("inbound-entry-input--invalid");
    expect(screen.getByLabelText("Actual Arrival Date")).toHaveClass("inbound-entry-input--invalid");
    expect(screen.getByLabelText("Container No.")).toHaveClass("inbound-entry-input--invalid");
    expect(mockedApi.createInboundDocument).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Warehouse"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Customer"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    expect(await screen.findByText("Choose an actual arrival date before saving.")).toBeInTheDocument();
    expect(screen.getByLabelText("Warehouse")).not.toHaveClass("inbound-entry-input--invalid");
    expect(screen.getByLabelText("Customer")).not.toHaveClass("inbound-entry-input--invalid");
    expect(screen.getByLabelText("Actual Arrival Date")).toHaveClass("inbound-entry-input--invalid");
    expect(screen.getByLabelText("Container No.")).toHaveClass("inbound-entry-input--invalid");
    expect(mockedApi.createInboundDocument).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Actual Arrival Date"), { target: { value: "2026-03-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    expect(await screen.findByText("Enter a container number before saving.")).toBeInTheDocument();
    expect(screen.getByLabelText("Actual Arrival Date")).not.toHaveClass("inbound-entry-input--invalid");
    expect(screen.getByLabelText("Container No.")).toHaveClass("inbound-entry-input--invalid");
    expect(mockedApi.createInboundDocument).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Container No."), { target: { value: "MSCU1234567" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    expect(await screen.findByText("Add at least one SKU line with an expected or received quantity.")).toBeInTheDocument();
    expect(screen.getByLabelText("Actual Arrival Date")).not.toHaveClass("inbound-entry-input--invalid");
    expect(screen.getByLabelText("Container No.")).not.toHaveClass("inbound-entry-input--invalid");
    expect(screen.getByLabelText(/SKU.*#1/)).toHaveClass("inbound-entry-input--invalid");
    expect(screen.getByLabelText(/Expected QTY #1/)).toHaveClass("inbound-entry-input--invalid");
    expect(screen.getByLabelText("Received #1")).toHaveClass("inbound-entry-input--invalid");
    expect(mockedApi.createInboundDocument).not.toHaveBeenCalled();
  });

  it("renders confirmed receipt notes as read-only without a standalone save button", () => {
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
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onBackToList={vi.fn()}
        onOpenInboundDetail={vi.fn()}
        onOpenReceiptEditor={vi.fn()}
      />
    );

    expect(screen.getByText("Confirmed receipt details are locked.")).toBeInTheDocument();
    expect(screen.getByLabelText("Document Notes")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save Note" })).not.toBeInTheDocument();
    expect(mockedApi.updateInboundDocumentNote).not.toHaveBeenCalled();
  });

  it("locks the re-enter action while copying a confirmed receipt", async () => {
    mockedApi.copyInboundDocument.mockImplementation(() => new Promise(() => {}));

    renderWithProviders(
      <InboundReceiptEditorPage
        routeKey="/inbound-management/12"
        documentId={12}
        document={createInboundDocument({
          id: 12,
          status: "CONFIRMED",
          trackingStatus: "RECEIVED"
        })}
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

    const reEnterButton = screen.getByRole("button", { name: /Re-enter Receipt|reEnterReceipt/ });

    fireEvent.click(reEnterButton);

    expect(reEnterButton).toBeDisabled();
    expect(reEnterButton).toHaveAttribute("aria-busy", "true");
    expect(mockedApi.copyInboundDocument).toHaveBeenCalledWith(12);
  });
});
