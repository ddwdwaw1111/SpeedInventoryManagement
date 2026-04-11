import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@mui/x-data-grid", () => ({
  DataGrid: ({
    rows = [],
    columns = []
  }: {
    rows?: Array<Record<string, unknown>>;
    columns?: Array<{
      field: string;
      renderCell?: (params: { row: Record<string, unknown>; value: unknown; field: string; id: unknown }) => React.ReactNode;
    }>;
  }) => (
    <div data-testid="mock-data-grid">
      {rows.map((row, rowIndex) => (
        <div key={String(row.id ?? rowIndex)}>
          {columns.map((column) => (
            <div key={column.field}>
              {column.renderCell
                ? column.renderCell({
                    row,
                    value: row[column.field],
                    field: column.field,
                    id: row.id
                  })
                : <span>{String(row[column.field] ?? "")}</span>}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}));

vi.mock("../lib/api", () => ({
  api: {
    getPallets: vi.fn(),
    createOutboundDocument: vi.fn(),
    updateOutboundDocument: vi.fn(),
    updateOutboundDocumentNote: vi.fn(),
    copyOutboundDocument: vi.fn()
  }
}));

import { api } from "../lib/api";
import { renderWithProviders } from "../test/renderWithProviders";
import { createItem, createMovement, createOutboundDocument, createSkuMaster } from "../test/fixtures";
import { OutboundShipmentEditorPage } from "./OutboundShipmentEditorPage";

const mockedApi = api as unknown as {
  getPallets: ReturnType<typeof vi.fn>;
  createOutboundDocument: ReturnType<typeof vi.fn>;
  updateOutboundDocument: ReturnType<typeof vi.fn>;
  updateOutboundDocumentNote: ReturnType<typeof vi.fn>;
  copyOutboundDocument: ReturnType<typeof vi.fn>;
};

describe("OutboundShipmentEditorPage", () => {
  beforeEach(() => {
    mockedApi.getPallets.mockReset();
    mockedApi.createOutboundDocument.mockReset();
    mockedApi.updateOutboundDocument.mockReset();
    mockedApi.updateOutboundDocumentNote.mockReset();
    mockedApi.copyOutboundDocument.mockReset();
    window.sessionStorage.clear();
  });

  it("saves a new shipment as a server draft and opens the edit route", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onOpenShipmentEditor = vi.fn();
    const onOpenOutboundDocument = vi.fn();

    mockedApi.createOutboundDocument.mockResolvedValue(createOutboundDocument({
      id: 99,
      status: "DRAFT",
      trackingStatus: "SCHEDULED"
    }));
    mockedApi.getPallets.mockResolvedValue([
      {
        id: 501,
        parentPalletId: 0,
        palletCode: "PLT-501",
        containerVisitId: 1,
        sourceInboundDocumentId: 1,
        sourceInboundLineId: 1,
        actualArrivalDate: "2026-03-24",
        customerId: 1,
        customerName: "Imperial Bag & Paper",
        skuMasterId: 1,
        sku: "608333",
        description: "VB22GC",
        currentLocationId: 1,
        currentLocationName: "NJ",
        currentStorageSection: "TEMP",
        currentContainerNo: "GCXU5817233",
        status: "OPEN",
        createdAt: "2026-03-24T10:00:00Z",
        updatedAt: "2026-03-24T10:00:00Z",
        contents: [
          {
            id: 601,
            palletId: 501,
            skuMasterId: 1,
            itemNumber: "608333",
            sku: "608333",
            description: "VB22GC",
            quantity: 10,
            allocatedQty: 0,
            damagedQty: 0,
            holdQty: 0,
            createdAt: "2026-03-24T10:00:00Z",
            updatedAt: "2026-03-24T10:00:00Z"
          }
        ]
      }
    ]);

    renderWithProviders(
      <OutboundShipmentEditorPage
        routeKey="/outbound-management/new"
        documentId={null}
        document={null}
        items={[createItem({ id: 1, availableQty: 10, quantity: 10, containerNo: "GCXU5817233" })]}
        skuMasters={[createSkuMaster()]}
        movements={[createMovement()]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={onRefresh}
        onBackToList={vi.fn()}
        onOpenOutboundDocument={onOpenOutboundDocument}
        onOpenShipmentEditor={onOpenShipmentEditor}
      />
    );

    const outboundLineSelect = document.querySelector(".batch-line-grid--outbound select");
    const outboundLineInputs = document.querySelectorAll(".batch-line-grid--outbound input");

    fireEvent.change(outboundLineSelect as HTMLSelectElement, { target: { value: "1|1|1" } });
    fireEvent.change(outboundLineInputs[1] as HTMLInputElement, { target: { value: "5" } });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    await waitFor(() => {
      expect(screen.getByText("PLT-501")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Schedule Shipment" }));

    await waitFor(() => {
      expect(mockedApi.createOutboundDocument).toHaveBeenCalledWith({
        packingListNo: undefined,
        orderRef: undefined,
        expectedShipDate: undefined,
        actualShipDate: undefined,
        shipToName: undefined,
        shipToAddress: undefined,
        shipToContact: undefined,
        carrierName: undefined,
        status: "DRAFT",
        trackingStatus: "SCHEDULED",
        documentNote: undefined,
        lines: [
          {
            customerId: 1,
            locationId: 1,
            skuMasterId: 1,
            quantity: 5,
            pallets: 1,
            palletsDetailCtns: undefined,
            unitLabel: "CTN",
            cartonSizeMm: undefined,
            netWeightKgs: 0,
            grossWeightKgs: 0,
            lineNote: undefined,
            pickPallets: [{ palletId: 501, quantity: 5 }]
          }
        ]
      });
    });

    expect(onRefresh).toHaveBeenCalled();
    expect(onOpenShipmentEditor).toHaveBeenCalledWith(99);
    expect(onOpenOutboundDocument).not.toHaveBeenCalled();
  });

  it("ignores browser session shipment drafts and starts from the source state", async () => {
    mockedApi.getPallets.mockResolvedValue([
      {
        id: 501,
        parentPalletId: 0,
        palletCode: "PLT-501",
        containerVisitId: 1,
        sourceInboundDocumentId: 1,
        sourceInboundLineId: 1,
        actualArrivalDate: "2026-03-24",
        customerId: 1,
        customerName: "Imperial Bag & Paper",
        skuMasterId: 1,
        sku: "608333",
        description: "VB22GC",
        currentLocationId: 1,
        currentLocationName: "NJ",
        currentStorageSection: "TEMP",
        currentContainerNo: "GCXU5817233",
        status: "OPEN",
        createdAt: "2026-03-24T10:00:00Z",
        updatedAt: "2026-03-24T10:00:00Z",
        contents: [
          {
            id: 601,
            palletId: 501,
            skuMasterId: 1,
            itemNumber: "608333",
            sku: "608333",
            description: "VB22GC",
            quantity: 10,
            allocatedQty: 0,
            damagedQty: 0,
            holdQty: 0,
            createdAt: "2026-03-24T10:00:00Z",
            updatedAt: "2026-03-24T10:00:00Z"
          }
        ]
      }
    ]);
    window.sessionStorage.setItem("sim-outbound-shipment-editor-draft:new", JSON.stringify({
      version: 1,
      form: {
        packingListNo: "PL-LOCAL-01",
        orderRef: "SO-LOCAL-01",
        expectedShipDate: "2026-04-02",
        actualShipDate: "",
        shipToName: "Draft Receiver",
        shipToAddress: "Draft Address",
        shipToContact: "201-555-1111",
        carrierName: "Draft Carrier",
        documentNote: "draft shipment note"
      },
      lines: [
        {
          id: "line-1",
          sourceKey: "1|1|1",
          quantity: 4,
          pallets: 0,
          palletsDetailCtns: "",
          unitLabel: "CTN",
          cartonSizeMm: "",
          netWeightKgs: 0,
          grossWeightKgs: 0,
          reason: "draft line note"
        }
      ],
      step: 2
    }));

    renderWithProviders(
      <OutboundShipmentEditorPage
        routeKey="/outbound-management/new"
        documentId={null}
        document={null}
        items={[createItem({ id: 1, availableQty: 10, quantity: 10 })]}
        skuMasters={[createSkuMaster()]}
        movements={[createMovement()]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onBackToList={vi.fn()}
        onOpenOutboundDocument={vi.fn()}
        onOpenShipmentEditor={vi.fn()}
      />
    );

    const headerInputs = document.querySelectorAll(".sheet-form input");
    expect((headerInputs[0] as HTMLInputElement).value).toBe("");
    expect(screen.queryByDisplayValue("Draft Receiver")).not.toBeInTheDocument();
  });

  it("auto-fills expected ship date when actual ship date is entered first", async () => {
    mockedApi.getPallets.mockResolvedValue([]);

    renderWithProviders(
      <OutboundShipmentEditorPage
        routeKey="/outbound-management/new"
        documentId={null}
        document={null}
        items={[createItem({ id: 1, availableQty: 10, quantity: 10 })]}
        skuMasters={[createSkuMaster()]}
        movements={[createMovement()]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onBackToList={vi.fn()}
        onOpenOutboundDocument={vi.fn()}
        onOpenShipmentEditor={vi.fn()}
      />
    );

    const expectedShipInput = screen.getByLabelText("Expected Ship Date") as HTMLInputElement;
    const actualShipInput = screen.getByLabelText("Actual Ship Date") as HTMLInputElement;

    fireEvent.change(actualShipInput, { target: { value: "2026-04-03" } });

    expect(actualShipInput.value).toBe("2026-04-03");
    expect(expectedShipInput.value).toBe("2026-04-03");
  });

  it("lets manual pick mode choose from all pallet and container candidates", async () => {
    mockedApi.getPallets.mockResolvedValue([
      {
        id: 501,
        parentPalletId: 0,
        palletCode: "PLT-501",
        containerVisitId: 1,
        sourceInboundDocumentId: 1,
        sourceInboundLineId: 1,
        actualArrivalDate: "2026-03-24",
        customerId: 1,
        customerName: "Imperial Bag & Paper",
        skuMasterId: 1,
        sku: "608333",
        description: "VB22GC",
        currentLocationId: 1,
        currentLocationName: "NJ",
        currentStorageSection: "TEMP",
        currentContainerNo: "GCXU5817233",
        status: "OPEN",
        createdAt: "2026-03-24T10:00:00Z",
        updatedAt: "2026-03-24T10:00:00Z",
        contents: [
          {
            id: 601,
            palletId: 501,
            skuMasterId: 1,
            itemNumber: "608333",
            sku: "608333",
            description: "VB22GC",
            quantity: 10,
            allocatedQty: 0,
            damagedQty: 0,
            holdQty: 0,
            createdAt: "2026-03-24T10:00:00Z",
            updatedAt: "2026-03-24T10:00:00Z"
          }
        ]
      },
      {
        id: 502,
        parentPalletId: 0,
        palletCode: "PLT-502",
        containerVisitId: 2,
        sourceInboundDocumentId: 2,
        sourceInboundLineId: 2,
        actualArrivalDate: "2026-03-25",
        customerId: 1,
        customerName: "Imperial Bag & Paper",
        skuMasterId: 1,
        sku: "608333",
        description: "VB22GC",
        currentLocationId: 1,
        currentLocationName: "NJ",
        currentStorageSection: "TEMP",
        currentContainerNo: "GCXU5817234",
        status: "OPEN",
        createdAt: "2026-03-25T10:00:00Z",
        updatedAt: "2026-03-25T10:00:00Z",
        contents: [
          {
            id: 602,
            palletId: 502,
            skuMasterId: 1,
            itemNumber: "608333",
            sku: "608333",
            description: "VB22GC",
            quantity: 10,
            allocatedQty: 0,
            damagedQty: 0,
            holdQty: 0,
            createdAt: "2026-03-25T10:00:00Z",
            updatedAt: "2026-03-25T10:00:00Z"
          }
        ]
      }
    ]);

    renderWithProviders(
      <OutboundShipmentEditorPage
        routeKey="/outbound-management/new"
        documentId={null}
        document={null}
        items={[createItem({ id: 1, availableQty: 10, quantity: 10, containerNo: "GCXU5817233" })]}
        skuMasters={[createSkuMaster()]}
        movements={[createMovement()]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onBackToList={vi.fn()}
        onOpenOutboundDocument={vi.fn()}
        onOpenShipmentEditor={vi.fn()}
      />
    );

    const outboundLineSelect = document.querySelector(".batch-line-grid--outbound select");
    const outboundLineInputs = document.querySelectorAll(".batch-line-grid--outbound input");

    fireEvent.change(outboundLineSelect as HTMLSelectElement, { target: { value: "1|1|1" } });
    fireEvent.change(outboundLineInputs[1] as HTMLInputElement, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    const manualPickButton = await screen.findByRole("button", { name: "Manual Pick" });
    fireEvent.click(manualPickButton);

    expect(screen.getByRole("button", { name: "Reset to Auto" })).toBeInTheDocument();
    expect(screen.getByText("PLT-501")).toBeInTheDocument();
    expect(screen.getByText("PLT-502")).toBeInTheDocument();
    expect(screen.getByText("GCXU5817234")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search container or pallet"), { target: { value: "7234" } });

    expect(screen.queryByText("PLT-501")).not.toBeInTheDocument();
    expect(screen.getByText("PLT-502")).toBeInTheDocument();
  });

  it("re-enters confirmed shipments by copying them into a new draft", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onOpenShipmentEditor = vi.fn();

    mockedApi.copyOutboundDocument.mockResolvedValue(createOutboundDocument({
      id: 77,
      status: "DRAFT",
      trackingStatus: "SCHEDULED"
    }));
    mockedApi.getPallets.mockResolvedValue([]);

    renderWithProviders(
      <OutboundShipmentEditorPage
        routeKey="/outbound-management/12"
        documentId={12}
        document={createOutboundDocument({
          id: 12,
          status: "CONFIRMED",
          trackingStatus: "SHIPPED"
        })}
        items={[createItem({ id: 1, availableQty: 10, quantity: 10, containerNo: "GCXU5817233" })]}
        skuMasters={[createSkuMaster()]}
        movements={[createMovement()]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={onRefresh}
        onBackToList={vi.fn()}
        onOpenOutboundDocument={vi.fn()}
        onOpenShipmentEditor={onOpenShipmentEditor}
      />
    );

    expect(screen.getByText("Confirmed shipment details are locked. You can still update the document note.")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /Re-enter Shipment|reEnterShipment/ })[0]);

    await waitFor(() => {
      expect(mockedApi.copyOutboundDocument).toHaveBeenCalledWith(12);
    });

    expect(onRefresh).toHaveBeenCalled();
    expect(onOpenShipmentEditor).toHaveBeenCalledWith(77);
  });

  it("allows confirmed shipments to save document notes independently", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    mockedApi.getPallets.mockResolvedValue([]);
    mockedApi.updateOutboundDocumentNote.mockResolvedValue(createOutboundDocument({
      id: 12,
      status: "CONFIRMED",
      trackingStatus: "SHIPPED",
      documentNote: "Updated confirmed note"
    }));

    renderWithProviders(
      <OutboundShipmentEditorPage
        routeKey="/outbound-management/12"
        documentId={12}
        document={createOutboundDocument({
          id: 12,
          status: "CONFIRMED",
          trackingStatus: "SHIPPED",
          documentNote: "Original confirmed note"
        })}
        items={[createItem({ id: 1, availableQty: 10, quantity: 10, containerNo: "GCXU5817233" })]}
        skuMasters={[createSkuMaster()]}
        movements={[createMovement()]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={onRefresh}
        onBackToList={vi.fn()}
        onOpenOutboundDocument={vi.fn()}
        onOpenShipmentEditor={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Document Notes"), { target: { value: "Updated confirmed note" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Note" }));

    await waitFor(() => {
      expect(mockedApi.updateOutboundDocumentNote).toHaveBeenCalledWith(12, {
        documentNote: "Updated confirmed note"
      });
    });

    expect(onRefresh).toHaveBeenCalled();
  });
});
