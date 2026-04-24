import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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

const OUTBOUND_HEADER_DEFAULTS_STORAGE_KEY = "sim-outbound-shipment-editor-defaults";

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
        containerType: "NORMAL",
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

    fireEvent.change(screen.getByLabelText("Current Storage"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("SKU"), { target: { value: "608333" } });
    fireEvent.change(screen.getByLabelText("Ship Qty"), { target: { value: "5" } });

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
    expect(window.sessionStorage.getItem(OUTBOUND_HEADER_DEFAULTS_STORAGE_KEY)).toBeNull();
  });

  it("uses picked pallets instead of sku defaults when a partial pallet ships", async () => {
    mockedApi.createOutboundDocument.mockResolvedValue(createOutboundDocument({
      id: 101,
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
        containerType: "NORMAL",
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
        skuMasters={[createSkuMaster({ defaultUnitsPerPallet: 4 })]}
        movements={[createMovement()]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onBackToList={vi.fn()}
        onOpenOutboundDocument={vi.fn()}
        onOpenShipmentEditor={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Current Storage"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("SKU"), { target: { value: "608333" } });
    fireEvent.change(screen.getByLabelText("Ship Qty"), { target: { value: "5" } });

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
      expect(mockedApi.createOutboundDocument).toHaveBeenCalledTimes(1);
    });

    const payload = mockedApi.createOutboundDocument.mock.calls[0][0];
    expect(payload.lines[0]).toMatchObject({
      quantity: 5,
      pallets: 1,
      pickPallets: [{ palletId: 501, quantity: 5 }]
    });
  });

  it("rebalances auto picks across duplicate source lines before submit", async () => {
    mockedApi.createOutboundDocument.mockResolvedValue(createOutboundDocument({
      id: 103,
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
        containerType: "NORMAL",
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
            quantity: 5,
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
        containerVisitId: 1,
        sourceInboundDocumentId: 1,
        sourceInboundLineId: 1,
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
        containerType: "NORMAL",
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
            quantity: 5,
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

    fireEvent.click(screen.getByRole("button", { name: "Add Outbound Line" }));

    const storageInputs = screen.getAllByLabelText("Current Storage");
    const skuInputs = screen.getAllByLabelText("SKU");
    const qtyInputs = screen.getAllByLabelText("Ship Qty");

    fireEvent.change(storageInputs[0], { target: { value: "1" } });
    fireEvent.change(skuInputs[0], { target: { value: "608333" } });
    fireEvent.change(qtyInputs[0], { target: { value: "5" } });

    fireEvent.change(storageInputs[1], { target: { value: "1" } });
    fireEvent.change(skuInputs[1], { target: { value: "608333" } });
    fireEvent.change(qtyInputs[1], { target: { value: "5" } });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(screen.getByText("PLT-501")).toBeInTheDocument();
      expect(screen.getByText("PLT-502")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Schedule Shipment" }));

    await waitFor(() => {
      expect(mockedApi.createOutboundDocument).toHaveBeenCalledTimes(1);
    });

    const payload = mockedApi.createOutboundDocument.mock.calls[0][0];
    expect(payload.lines).toHaveLength(2);
    expect(payload.lines[0].pickPallets).toEqual([{ palletId: 501, quantity: 5 }]);
    expect(payload.lines[1].pickPallets).toEqual([{ palletId: 502, quantity: 5 }]);
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
        containerType: "NORMAL",
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

  it("prefills shipment header details from remembered session defaults for a new shipment", async () => {
    mockedApi.getPallets.mockResolvedValue([]);
    window.sessionStorage.setItem(OUTBOUND_HEADER_DEFAULTS_STORAGE_KEY, JSON.stringify({
      shipToName: "Remembered Receiver",
      shipToAddress: "900 Harbor Ave",
      shipToContact: "201-555-0001",
      carrierName: "Remembered Carrier"
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

    expect((screen.getByLabelText("Ship To Name") as HTMLInputElement).value).toBe("Remembered Receiver");
    expect((screen.getByLabelText("Ship To Address") as HTMLInputElement).value).toBe("900 Harbor Ave");
    expect((screen.getByLabelText("Ship To Contact") as HTMLInputElement).value).toBe("201-555-0001");
    expect((screen.getByLabelText("Carrier") as HTMLInputElement).value).toBe("Remembered Carrier");
    expect(screen.getByText("Last shipment contact and carrier details were filled for this session.")).toBeInTheDocument();
  });

  it("stores ship-to and carrier details after saving a shipment for reuse in the same session", async () => {
    mockedApi.createOutboundDocument.mockResolvedValue(createOutboundDocument({
      id: 102,
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
        containerType: "NORMAL",
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
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onBackToList={vi.fn()}
        onOpenOutboundDocument={vi.fn()}
        onOpenShipmentEditor={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Ship To Name"), { target: { value: "Receiver A" } });
    fireEvent.change(screen.getByLabelText("Ship To Address"), { target: { value: "12 Dock Road" } });
    fireEvent.change(screen.getByLabelText("Ship To Contact"), { target: { value: "201-555-1000" } });
    fireEvent.change(screen.getByLabelText("Carrier"), { target: { value: "FedEx Freight" } });
    fireEvent.change(screen.getByLabelText("Current Storage"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("SKU"), { target: { value: "608333" } });
    fireEvent.change(screen.getByLabelText("Ship Qty"), { target: { value: "5" } });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Schedule Shipment" }));

    await waitFor(() => {
      expect(window.sessionStorage.getItem(OUTBOUND_HEADER_DEFAULTS_STORAGE_KEY)).toContain("Receiver A");
    });

    expect(JSON.parse(window.sessionStorage.getItem(OUTBOUND_HEADER_DEFAULTS_STORAGE_KEY) || "{}")).toEqual({
      shipToName: "Receiver A",
      shipToAddress: "12 Dock Road",
      shipToContact: "201-555-1000",
      carrierName: "FedEx Freight"
    });
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
        containerType: "NORMAL",
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
        containerType: "NORMAL",
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

    fireEvent.change(screen.getByLabelText("Current Storage"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("SKU"), { target: { value: "608333" } });
    fireEvent.change(screen.getByLabelText("Ship Qty"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    const manualPickButton = await screen.findByRole("button", { name: "Switch to Manual Pick" });
    fireEvent.click(manualPickButton);

    expect(screen.getByRole("button", { name: /Reset to Auto/i })).toBeInTheDocument();
    expect(screen.getByText("PLT-501")).toBeInTheDocument();
    expect(screen.getByText("PLT-502")).toBeInTheDocument();
    expect(screen.getByText("GCXU5817234")).toBeInTheDocument();

    const pallet501Checkbox = screen.getByRole("checkbox", { name: "Select Pallet: PLT-501" }) as HTMLInputElement;
    const pallet502Checkbox = screen.getByRole("checkbox", { name: "Select Pallet: PLT-502" }) as HTMLInputElement;

    expect(pallet501Checkbox.checked).toBe(true);
    expect(pallet502Checkbox).toBeDisabled();

    fireEvent.click(pallet501Checkbox);

    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "Select Pallet: PLT-502" })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Pallet: PLT-502" }));

    expect((screen.getByLabelText("Pick Qty: PLT-502") as HTMLInputElement).value).toBe("5");

    fireEvent.change(screen.getByPlaceholderText("Search container or pallet"), { target: { value: "7234" } });

    expect(screen.queryByText("PLT-501")).not.toBeInTheDocument();
    expect(screen.getByText("PLT-502")).toBeInTheDocument();
  });

  it("supports repeat-last pick qty and slash-to-search in manual pick mode", async () => {
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
        containerType: "NORMAL",
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
        containerType: "NORMAL",
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
      },
      {
        id: 503,
        parentPalletId: 0,
        palletCode: "PLT-503",
        containerVisitId: 3,
        sourceInboundDocumentId: 3,
        sourceInboundLineId: 3,
        actualArrivalDate: "2026-03-26",
        customerId: 1,
        customerName: "Imperial Bag & Paper",
        skuMasterId: 1,
        sku: "608333",
        description: "VB22GC",
        currentLocationId: 1,
        currentLocationName: "NJ",
        currentStorageSection: "TEMP",
        currentContainerNo: "GCXU5817235",
        containerType: "NORMAL",
        status: "OPEN",
        createdAt: "2026-03-26T10:00:00Z",
        updatedAt: "2026-03-26T10:00:00Z",
        contents: [
          {
            id: 603,
            palletId: 503,
            skuMasterId: 1,
            itemNumber: "608333",
            sku: "608333",
            description: "VB22GC",
            quantity: 10,
            allocatedQty: 0,
            damagedQty: 0,
            holdQty: 0,
            createdAt: "2026-03-26T10:00:00Z",
            updatedAt: "2026-03-26T10:00:00Z"
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

    fireEvent.change(screen.getByLabelText("Current Storage"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("SKU"), { target: { value: "608333" } });
    fireEvent.change(screen.getByLabelText("Ship Qty"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Switch to Manual Pick" }));

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Pallet: PLT-501" }));

    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "Select Pallet: PLT-502" })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Pallet: PLT-502" }));
    fireEvent.change(screen.getByLabelText("Pick Qty: PLT-502"), { target: { value: "3" } });

    const pallet503Card = screen.getByText("PLT-503").closest(".rounded-2xl");
    expect(pallet503Card).toBeInstanceOf(HTMLElement);
    if (!(pallet503Card instanceof HTMLElement)) {
      throw new Error("Expected pallet 503 card");
    }

    const pallet503Scope = within(pallet503Card);
    fireEvent.click(pallet503Scope.getByRole("button", { name: "Repeat Last" }));

    expect((screen.getByLabelText("Pick Qty: PLT-503") as HTMLInputElement).value).toBe("3");

    fireEvent.keyDown(screen.getByRole("checkbox", { name: "Select Pallet: PLT-503" }), { key: "/" });

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByPlaceholderText("Search container or pallet"));
    });
  });

  it("filters sku choices by warehouse before quantity entry", async () => {
    mockedApi.getPallets.mockResolvedValue([]);

    renderWithProviders(
      <OutboundShipmentEditorPage
        routeKey="/outbound-management/new"
        documentId={null}
        document={null}
        items={[
          createItem({ id: 1, skuMasterId: 1, locationId: 1, locationName: "NJ", sku: "608333", itemNumber: "608333", description: "VB22GC" }),
          createItem({ id: 2, skuMasterId: 2, locationId: 2, locationName: "LA", sku: "900001", itemNumber: "900001", description: "West Coast SKU" })
        ]}
        skuMasters={[createSkuMaster(), createSkuMaster({ id: 2, sku: "900001", itemNumber: "900001", description: "West Coast SKU" })]}
        movements={[createMovement()]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onBackToList={vi.fn()}
        onOpenOutboundDocument={vi.fn()}
        onOpenShipmentEditor={vi.fn()}
      />
    );

    const warehouseSelect = screen.getByLabelText("Current Storage") as HTMLSelectElement;
    const skuSelect = screen.getByLabelText("SKU") as HTMLInputElement;
    const quantityInput = screen.getByLabelText("Ship Qty") as HTMLInputElement;

    expect(skuSelect.disabled).toBe(true);
    expect(quantityInput.disabled).toBe(true);

    fireEvent.change(warehouseSelect, { target: { value: "2" } });

    expect(skuSelect.disabled).toBe(false);
    const skuOptions = Array.from(document.querySelectorAll("datalist option")).map((option) => option.getAttribute("value") || "");
    expect(skuOptions.some((option) => option.includes("West Coast SKU"))).toBe(true);
    expect(skuOptions.some((option) => option.includes("VB22GC"))).toBe(false);

    fireEvent.change(skuSelect, { target: { value: "NOT-A-SKU" } });

    expect(quantityInput.disabled).toBe(true);
    expect(screen.getByText("Choose a valid SKU from the list.")).toBeInTheDocument();

    fireEvent.change(skuSelect, { target: { value: "900001" } });

    expect(quantityInput.disabled).toBe(false);
  });

  it("disables next until line validation passes and moves focus forward", async () => {
    mockedApi.getPallets.mockResolvedValue([]);

    renderWithProviders(
      <OutboundShipmentEditorPage
        routeKey="/outbound-management/new"
        documentId={null}
        document={null}
        items={[createItem({ id: 1, availableQty: 10, quantity: 10, locationId: 1, locationName: "NJ" })]}
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

    const warehouseSelect = screen.getByLabelText("Current Storage") as HTMLSelectElement;
    const skuSelect = screen.getByLabelText("SKU") as HTMLInputElement;
    const quantityInput = screen.getByLabelText("Ship Qty") as HTMLInputElement;
    const nextButton = screen.getByRole("button", { name: "Next" });

    expect(nextButton).toBeDisabled();

    fireEvent.change(warehouseSelect, { target: { value: "1" } });

    await waitFor(() => {
      expect(document.activeElement).toBe(skuSelect);
    });

    fireEvent.change(skuSelect, { target: { value: "608333" } });

    await waitFor(() => {
      expect(document.activeElement).toBe(quantityInput);
    });

    fireEvent.change(quantityInput, { target: { value: "0" } });

    expect(screen.getByText("Enter ship quantity.")).toBeInTheDocument();
    expect(nextButton).toBeDisabled();

    fireEvent.change(quantityInput, { target: { value: "12" } });

    expect(quantityInput.value).toBe("10");

    await waitFor(() => {
      expect(nextButton).not.toBeDisabled();
    });

    fireEvent.change(quantityInput, { target: { value: "5" } });

    await waitFor(() => {
      expect(nextButton).not.toBeDisabled();
    });
  });

  it("copies the previous warehouse into a newly added outbound line", async () => {
    mockedApi.getPallets.mockResolvedValue([]);

    renderWithProviders(
      <OutboundShipmentEditorPage
        routeKey="/outbound-management/new"
        documentId={null}
        document={null}
        items={[createItem({ id: 1, availableQty: 10, quantity: 10, locationId: 1, locationName: "NJ" })]}
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

    fireEvent.change(screen.getByLabelText("Current Storage"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Outbound Line" }));

    await waitFor(() => {
      const warehouseSelects = screen.getAllByLabelText("Current Storage") as HTMLSelectElement[];
      expect(warehouseSelects).toHaveLength(2);
      expect(warehouseSelects[1].value).toBe("1");
      expect(document.activeElement).toBe(warehouseSelects[1]);
    });
  });

  it("requires a final confirmation check before posting the shipment", async () => {
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
        containerType: "NORMAL",
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
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onBackToList={vi.fn()}
        onOpenOutboundDocument={vi.fn()}
        onOpenShipmentEditor={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Current Storage"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("SKU"), { target: { value: "608333" } });
    fireEvent.change(screen.getByLabelText("Ship Qty"), { target: { value: "5" } });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Warehouse / Container Summary")).toBeInTheDocument();
    expect(screen.getByText("Review the confirmed picks grouped by warehouse and source container before posting this shipment.")).toBeInTheDocument();
    expect(screen.getByText("Containers: 1 · Pallets: 1 · Selected Qty: 5 · Total Lines: 1")).toBeInTheDocument();

    const scheduleShipmentButton = screen.getByRole("button", { name: "Schedule Shipment" });
    expect(scheduleShipmentButton).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(scheduleShipmentButton).not.toBeDisabled();
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


