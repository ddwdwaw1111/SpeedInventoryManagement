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
import { setPendingInboundReceiptEditorLaunchContext } from "../lib/inboundReceiptEditorLaunchContext";
import { renderWithProviders } from "../test/renderWithProviders";
import { createCustomer, createInboundDocument, createLocation } from "../test/fixtures";
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

    const inboundLineInputs = document.querySelectorAll(".batch-line-grid--inbound input");
    fireEvent.change(inboundLineInputs[0] as HTMLInputElement, { target: { value: "ABC123" } });
    fireEvent.change(inboundLineInputs[1] as HTMLInputElement, { target: { value: "Sample inbound SKU" } });
    fireEvent.change(inboundLineInputs[2] as HTMLInputElement, { target: { value: "8" } });
    fireEvent.change(inboundLineInputs[3] as HTMLInputElement, { target: { value: "8" } });

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
        unitLabel: "CTN",
        status: "DRAFT",
        trackingStatus: "SCHEDULED",
        documentNote: undefined,
        lines: [
          {
            sku: "ABC123",
            description: "Sample inbound SKU",
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

  it("prefills new receipt header from launch context", () => {
    setPendingInboundReceiptEditorLaunchContext({
      containerId: 42,
      containerNo: "mscu1234567",
      customerId: 1,
      locationId: 1,
      containerType: "WEST_COAST_TRANSFER",
      forceHandlingMode: "PALLETIZED",
      storageSection: "BULK"
    });

    renderWithProviders(
      <InboundReceiptEditorPage
        routeKey="/inbound-management/new"
        documentId={null}
        document={null}
        items={[]}
        skuMasters={[]}
        locations={[createLocation({ sectionNames: ["TEMP", "BULK"] })]}
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

    expect(screen.getByLabelText("Warehouse")).toHaveValue("1");
    expect(screen.getByLabelText("Customer")).toHaveValue("1");
    expect(screen.getByLabelText("Container No.")).toHaveValue("MSCU1234567");
    expect(screen.getByLabelText("Handling Mode")).toHaveValue("PALLETIZED");
    expect(screen.getByLabelText("Container Type")).toHaveValue("WEST_COAST_TRANSFER");
    expect(screen.getByLabelText("Section #1")).toHaveValue("BULK");
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

  it("saves editable confirmed receipt fields while keeping SKU and line count locked", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onOpenInboundDetail = vi.fn();
    mockedApi.updateInboundDocument.mockResolvedValue(createInboundDocument({
      id: 12,
      status: "CONFIRMED",
      trackingStatus: "RECEIVED",
      actualArrivalDate: "2026-03-24",
      documentNote: "Adjusted confirmed receipt note",
      totalReceivedQty: 12
    }));

    renderWithProviders(
      <InboundReceiptEditorPage
        routeKey="/inbound-management/12"
        documentId={12}
        document={createInboundDocument({
          id: 12,
          status: "CONFIRMED",
          trackingStatus: "RECEIVED",
          actualArrivalDate: "2026-03-24",
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
        onOpenInboundDetail={onOpenInboundDetail}
        onOpenReceiptEditor={vi.fn()}
      />
    );

    expect(screen.getByText("Confirmed receipt edits update inventory automatically. SKU and line count stay locked.")).toBeInTheDocument();
    expect(screen.getByLabelText(/SKU.*#1/)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add SKU Line" })).toBeDisabled();
    expect(screen.getByLabelText("Document Notes")).not.toBeDisabled();

    fireEvent.change(screen.getByLabelText("Document Notes"), { target: { value: "Adjusted confirmed receipt note" } });
    fireEvent.change(screen.getByLabelText("Received #1"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(mockedApi.updateInboundDocument).toHaveBeenCalledWith(12, expect.objectContaining({
        status: "CONFIRMED",
        trackingStatus: "RECEIVED",
        documentNote: "Adjusted confirmed receipt note",
        lines: [expect.objectContaining({
          sku: "608333",
          receivedQty: 12
        })]
      }));
    });
    expect(onRefresh).toHaveBeenCalled();
    expect(onOpenInboundDetail).toHaveBeenCalledWith(12);
    expect(mockedApi.updateInboundDocumentNote).not.toHaveBeenCalled();
  });

  it("does not offer re-enter for a confirmed receipt", () => {
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

    expect(screen.queryByRole("button", { name: /Re-enter Receipt|reEnterReceipt/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeInTheDocument();
    expect(mockedApi.copyInboundDocument).not.toHaveBeenCalled();
  });
});
