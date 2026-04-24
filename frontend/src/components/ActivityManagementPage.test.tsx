import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedDownloadOutboundPickSheetPdfFromDocument = vi.fn();

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

vi.mock("./RowActionsMenu", () => ({
  RowActionsMenu: ({
    actions
  }: {
    actions: Array<{ key: string; label: string; onClick: () => void }>;
  }) => (
    <div>
      {actions.map((action) => (
        <button key={action.key} type="button" onClick={action.onClick}>
          {action.label}
        </button>
      ))}
    </div>
  )
}));

vi.mock("../lib/api", () => ({
  api: {
    getPallets: vi.fn(),
    createInboundDocument: vi.fn(),
    createOutboundDocument: vi.fn(),
    updateInboundDocument: vi.fn(),
    copyInboundDocument: vi.fn()
  }
}));

vi.mock("../lib/outboundPickSheetPdf", () => ({
  downloadOutboundPickSheetPdfFromDocument: mockedDownloadOutboundPickSheetPdfFromDocument
}));

import { api } from "../lib/api";
import { ActivityManagementPage, buildOutboundSourceOptionsFromPallets, buildPickSheetExportDocument } from "./ActivityManagementPage";
import { renderWithProviders } from "../test/renderWithProviders";
import {
  createCustomer,
  createInboundDocument,
  createInboundDocumentLine,
  createItem,
  createLocation,
  createMovement,
  createOutboundDocument,
  createOutboundDocumentLine,
  createSkuMaster
} from "../test/fixtures";

const mockedApi = api as unknown as {
  getPallets: ReturnType<typeof vi.fn>;
  createInboundDocument: ReturnType<typeof vi.fn>;
  createOutboundDocument: ReturnType<typeof vi.fn>;
  updateInboundDocument: ReturnType<typeof vi.fn>;
  copyInboundDocument: ReturnType<typeof vi.fn>;
};

function createOutboundPalletTrace(overrides?: Partial<{
  palletId: number;
  contentId: number;
  containerNo: string;
  quantity: number;
  sku: string;
  itemNumber: string;
  description: string;
}>){
  const palletId = overrides?.palletId ?? 501;
  const contentId = overrides?.contentId ?? (palletId + 100);
  const sku = overrides?.sku ?? "608333";
  const itemNumber = overrides?.itemNumber ?? sku;
  const description = overrides?.description ?? "VB22GC";
  const quantity = overrides?.quantity ?? 10;
  const containerNo = overrides?.containerNo ?? "GCXU5817233";

  return {
    id: palletId,
    parentPalletId: 0,
    palletCode: `PLT-${palletId}`,
    containerVisitId: 1,
    sourceInboundDocumentId: 1,
    sourceInboundLineId: 1,
    actualArrivalDate: "2026-03-24",
    customerId: 1,
    customerName: "Imperial Bag & Paper",
    skuMasterId: 1,
    sku,
    description,
    currentLocationId: 1,
    currentLocationName: "NJ",
    currentStorageSection: "TEMP",
    currentContainerNo: containerNo,
    containerType: "NORMAL" as const,
    status: "OPEN",
    createdAt: "2026-03-24T10:00:00Z",
    updatedAt: "2026-03-24T10:00:00Z",
    contents: [
      {
        id: contentId,
        palletId,
        skuMasterId: 1,
        itemNumber,
        sku,
        description,
        quantity,
        allocatedQty: 0,
        damagedQty: 0,
        holdQty: 0,
        createdAt: "2026-03-24T10:00:00Z",
        updatedAt: "2026-03-24T10:00:00Z"
      }
    ]
  };
}

describe("ActivityManagementPage", () => {
  beforeEach(() => {
    mockedApi.getPallets.mockReset();
    mockedApi.createInboundDocument.mockReset();
    mockedApi.createOutboundDocument.mockReset();
    mockedApi.updateInboundDocument.mockReset();
    mockedApi.copyInboundDocument.mockReset();
    mockedDownloadOutboundPickSheetPdfFromDocument.mockReset();
  });

  it("submits a new inbound receipt from the receipt form flow", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    mockedApi.createInboundDocument.mockResolvedValue(undefined);

    renderWithProviders(
      <ActivityManagementPage
        mode="IN"
        items={[]}
        skuMasters={[]}
        locations={[createLocation()]}
        customers={[createCustomer()]}
        movements={[]}
        inboundDocuments={[]}
        outboundDocuments={[]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={onRefresh}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "New Receipt" }));
    expect(screen.getByText("Create Receipt")).toBeInTheDocument();

    const dialog = await screen.findByRole("dialog");
    const headerInputs = dialog.querySelectorAll(".sheet-form input");

    fireEvent.change(headerInputs[0] as HTMLInputElement, { target: { value: "2026-03-31" } });
    fireEvent.change(headerInputs[2] as HTMLInputElement, { target: { value: "MSCU1234567" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const inboundLineInputs = dialog.querySelectorAll(".batch-line-grid--inbound input");
    fireEvent.change(inboundLineInputs[0] as HTMLInputElement, { target: { value: "ABC123" } });
    fireEvent.change(inboundLineInputs[1] as HTMLInputElement, { target: { value: "Sample inbound SKU" } });
    fireEvent.change(inboundLineInputs[2] as HTMLInputElement, { target: { value: "8" } });
    fireEvent.change(inboundLineInputs[3] as HTMLInputElement, { target: { value: "8" } });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Receipt" }));

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
        status: "CONFIRMED",
        trackingStatus: "RECEIVED",
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
  });

  it("auto-allocates full pallets plus a remainder pallet based on units per pallet", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    mockedApi.createInboundDocument.mockResolvedValue(undefined);

    renderWithProviders(
      <ActivityManagementPage
        mode="IN"
        items={[]}
        skuMasters={[createSkuMaster({
          id: 2,
          sku: "ABC123",
          itemNumber: "ABC123",
          name: "ABC123",
          description: "Sample inbound SKU",
          defaultUnitsPerPallet: 100,
          reorderLevel: 2
        })]}
        locations={[createLocation()]}
        customers={[createCustomer()]}
        movements={[]}
        inboundDocuments={[]}
        outboundDocuments={[]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={onRefresh}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "New Receipt" }));

    const dialog = await screen.findByRole("dialog");
    const headerInputs = dialog.querySelectorAll(".sheet-form input");

    fireEvent.change(headerInputs[0] as HTMLInputElement, { target: { value: "2026-03-31" } });
    fireEvent.change(headerInputs[2] as HTMLInputElement, { target: { value: "MSCU7654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
  const inboundLineInputs = dialog.querySelectorAll(".batch-line-grid--inbound input");
    fireEvent.change(inboundLineInputs[0] as HTMLInputElement, { target: { value: "ABC123" } });
    fireEvent.change(inboundLineInputs[2] as HTMLInputElement, { target: { value: "1024" } });
    fireEvent.change(inboundLineInputs[3] as HTMLInputElement, { target: { value: "1024" } });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Receipt" }));

    await waitFor(() => {
      expect(mockedApi.createInboundDocument).toHaveBeenCalledWith({
        customerId: 1,
        locationId: 1,
        expectedArrivalDate: "2026-03-31",
        actualArrivalDate: undefined,
        containerNo: "MSCU7654321",
        containerType: "NORMAL",
        handlingMode: "PALLETIZED",
        storageSection: "TEMP",
        unitLabel: "CTN",
        status: "CONFIRMED",
        trackingStatus: "RECEIVED",
        documentNote: undefined,
        lines: [
          {
            sku: "ABC123",
            description: "Sample inbound SKU",
            reorderLevel: 2,
            expectedQty: 1024,
            receivedQty: 1024,
            pallets: 11,
            unitsPerPallet: 100,
            palletsDetailCtns: "10*100+24",
            palletBreakdown: [
              { quantity: 100 },
              { quantity: 100 },
              { quantity: 100 },
              { quantity: 100 },
              { quantity: 100 },
              { quantity: 100 },
              { quantity: 100 },
              { quantity: 100 },
              { quantity: 100 },
              { quantity: 100 },
              { quantity: 24 }
            ],
            storageSection: "TEMP",
            lineNote: undefined
          }
        ]
      });
    });

    expect(onRefresh).toHaveBeenCalled();
  });

  it("uses the manually entered units per pallet when filling a receipt", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    mockedApi.createInboundDocument.mockResolvedValue(undefined);

    renderWithProviders(
      <ActivityManagementPage
        mode="IN"
        items={[]}
        skuMasters={[createSkuMaster({
          id: 3,
          sku: "011424",
          itemNumber: "011424",
          name: "011424",
          description: "Manual pallet SKU",
          defaultUnitsPerPallet: 0,
          reorderLevel: 2
        })]}
        locations={[createLocation()]}
        customers={[createCustomer()]}
        movements={[]}
        inboundDocuments={[]}
        outboundDocuments={[]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={onRefresh}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "New Receipt" }));

    const dialog = await screen.findByRole("dialog");
    const headerInputs = dialog.querySelectorAll(".sheet-form input");

    fireEvent.change(headerInputs[0] as HTMLInputElement, { target: { value: "2026-03-31" } });
    fireEvent.change(headerInputs[2] as HTMLInputElement, { target: { value: "MSCU2222222" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
  const inboundLineInputs = dialog.querySelectorAll(".batch-line-grid--inbound input");
    fireEvent.change(inboundLineInputs[0] as HTMLInputElement, { target: { value: "011424" } });
    fireEvent.change(inboundLineInputs[2] as HTMLInputElement, { target: { value: "1024" } });
    fireEvent.change(inboundLineInputs[3] as HTMLInputElement, { target: { value: "1024" } });
    fireEvent.change(screen.getByLabelText("Units / Pallet"), { target: { value: "100" } });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Receipt" }));

    await waitFor(() => {
      expect(mockedApi.createInboundDocument).toHaveBeenCalledWith({
        customerId: 1,
        locationId: 1,
        expectedArrivalDate: "2026-03-31",
        actualArrivalDate: undefined,
        containerNo: "MSCU2222222",
        containerType: "NORMAL",
        handlingMode: "PALLETIZED",
        storageSection: "TEMP",
        unitLabel: "CTN",
        status: "CONFIRMED",
        trackingStatus: "RECEIVED",
        documentNote: undefined,
        lines: [
          {
            sku: "011424",
            description: "Manual pallet SKU",
            reorderLevel: 2,
            expectedQty: 1024,
            receivedQty: 1024,
            pallets: 11,
            unitsPerPallet: 100,
            palletsDetailCtns: "10*100+24",
            palletBreakdown: [
              { quantity: 100 },
              { quantity: 100 },
              { quantity: 100 },
              { quantity: 100 },
              { quantity: 100 },
              { quantity: 100 },
              { quantity: 100 },
              { quantity: 100 },
              { quantity: 100 },
              { quantity: 100 },
              { quantity: 24 }
            ],
            storageSection: "TEMP",
            lineNote: undefined
          }
        ]
      });
    });

    expect(onRefresh).toHaveBeenCalled();
  });

  it("re-enters confirmed receipts by copying them into a new draft", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    mockedApi.copyInboundDocument.mockResolvedValue(
      createInboundDocument({
        id: 22,
        status: "DRAFT",
        trackingStatus: "SCHEDULED",
        expectedArrivalDate: "2026-03-24",
        containerNo: "GCXU5817233"
      })
    );

    renderWithProviders(
      <ActivityManagementPage
        mode="IN"
        items={[]}
        skuMasters={[]}
        locations={[createLocation()]}
        customers={[createCustomer()]}
        movements={[]}
        inboundDocuments={[
          createInboundDocument({
            id: 11,
            status: "CONFIRMED",
            trackingStatus: "RECEIVED",
            expectedArrivalDate: "2026-03-24",
            containerNo: "GCXU5817233",
            documentNote: "Original note",
            lines: [
              createInboundDocumentLine({
                id: 111,
                documentId: 11,
                sku: "608333",
                description: "VB22GC",
                storageSection: "TEMP",
                reorderLevel: 5,
                expectedQty: 10,
                receivedQty: 10,
                pallets: 1,
                palletsDetailCtns: "1*10"
              })
            ]
          })
        ]}
        outboundDocuments={[]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={onRefresh}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Re-enter Receipt|reEnterReceipt/ }));

    await waitFor(() => {
      expect(mockedApi.copyInboundDocument).toHaveBeenCalledWith(11);
    });

    expect(onRefresh).toHaveBeenCalled();
  });

  it("re-enters confirmed receipts from the detail drawer", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    mockedApi.copyInboundDocument.mockResolvedValue(
      createInboundDocument({
        id: 24,
        status: "DRAFT",
        trackingStatus: "SCHEDULED",
        expectedArrivalDate: "2026-03-24",
        containerNo: "GCXU5817233"
      })
    );

    renderWithProviders(
      <ActivityManagementPage
        mode="IN"
        items={[]}
        skuMasters={[]}
        locations={[createLocation()]}
        customers={[createCustomer()]}
        movements={[]}
        inboundDocuments={[
          createInboundDocument({
            id: 12,
            status: "CONFIRMED",
            trackingStatus: "RECEIVED",
            expectedArrivalDate: "2026-03-24",
            containerNo: "GCXU5817233",
            lines: [
              createInboundDocumentLine({
                id: 121,
                documentId: 12,
                sku: "608333",
                description: "VB22GC",
                storageSection: "TEMP",
                reorderLevel: 5,
                expectedQty: 10,
                receivedQty: 10,
                pallets: 1,
                palletsDetailCtns: "1*10"
              })
            ]
          })
        ]}
        outboundDocuments={[]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={onRefresh}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    fireEvent.click(await screen.findByRole("button", { name: /Re-enter Receipt|reEnterReceipt/ }));

    await waitFor(() => {
      expect(mockedApi.copyInboundDocument).toHaveBeenCalledWith(12);
    });

    expect(onRefresh).toHaveBeenCalled();
  });

  it("walks through the outbound shipment wizard and submits the shipment", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);

    mockedApi.createOutboundDocument.mockResolvedValue(undefined);
    mockedApi.getPallets.mockResolvedValue([
      createOutboundPalletTrace({ palletId: 501, containerNo: "GCXU5817233", quantity: 10 })
    ]);

    renderWithProviders(
      <ActivityManagementPage
        mode="OUT"
        items={[
          createItem({
            id: 1,
            quantity: 10,
            availableQty: 10,
            storageSection: "TEMP",
            containerNo: "GCXU5817233"
          })
        ]}
        skuMasters={[]}
        locations={[createLocation()]}
        customers={[createCustomer()]}
        movements={[createMovement()]}
        inboundDocuments={[]}
        outboundDocuments={[]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={onRefresh}
      />
    );

    await waitFor(() => {
      expect(mockedApi.getPallets).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await mockedApi.getPallets.mock.results[0]?.value;
    });
    fireEvent.click(screen.getByRole("button", { name: "New Shipment" }));
    expect(screen.getByText("Create Shipment")).toBeInTheDocument();

    const dialog = await screen.findByRole("dialog");
    const outboundLineSelect = dialog.querySelector(".batch-line-grid--outbound select");
    const outboundLineInputs = dialog.querySelectorAll(".batch-line-grid--outbound input");

    fireEvent.change(outboundLineSelect as HTMLSelectElement, { target: { value: "1|1|1" } });
    fireEvent.change(outboundLineInputs[1] as HTMLInputElement, { target: { value: "5" } });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Container Pick Plan")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Pick Allocation Preview")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Schedule Shipment" })[1]);

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
            pallets: 0,
            palletsDetailCtns: undefined,
            unitLabel: "PCS",
            cartonSizeMm: undefined,
            netWeightKgs: 0,
            grossWeightKgs: 0,
            lineNote: undefined,
            pickAllocations: [
              {
                itemNumber: "608333",
                locationId: 1,
                locationName: "NJ",
                storageSection: "TEMP",
                containerNo: "GCXU5817233",
                allocatedQty: 5
              }
            ]
          }
        ]
      });
    });

    expect(onRefresh).toHaveBeenCalled();
  });

  it("blocks new outbound shipments until live pallet inventory finishes loading", async () => {
    mockedApi.getPallets.mockImplementation(() => new Promise(() => {}));

    renderWithProviders(
      <ActivityManagementPage
        mode="OUT"
        items={[createItem({ id: 1, quantity: 10, availableQty: 10, storageSection: "TEMP", containerNo: "GCXU5817233" })]}
        skuMasters={[]}
        locations={[createLocation()]}
        customers={[createCustomer()]}
        movements={[createMovement()]}
        inboundDocuments={[]}
        outboundDocuments={[]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "New Shipment" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Live pallet inventory is still loading. Shipment allocation will unlock once pallet data is ready.")).toBeInTheDocument();
  });

  it("hydrates draft pick sheet exports with container rows when the document has no stored pick allocations", async () => {
    const sourceOptions = buildOutboundSourceOptionsFromPallets([
      createOutboundPalletTrace({ palletId: 511, containerNo: "CONTAINER-1", quantity: 10, sku: "011423", itemNumber: "011423", description: "011423" }),
      createOutboundPalletTrace({ palletId: 512, containerNo: "CONTAINER-2", quantity: 20, sku: "011423", itemNumber: "011423", description: "011423" })
    ], new Map());
    const exportedDocument = buildPickSheetExportDocument(createOutboundDocument({
      id: 101,
      status: "DRAFT",
      trackingStatus: "SCHEDULED",
      lines: [
        createOutboundDocumentLine({
          id: 501,
          skuMasterId: 1,
          itemNumber: "011423",
          sku: "011423",
          locationId: 1,
          locationName: "NJ",
          quantity: 15,
          pallets: 3,
          pickAllocations: []
        })
      ]
    }), sourceOptions);

    expect(exportedDocument.lines[0].pickAllocations).toHaveLength(2);
    expect(exportedDocument.lines[0].pickAllocations.map((allocation: { containerNo: string }) => allocation.containerNo)).toEqual([
      "CONTAINER-1",
      "CONTAINER-2"
    ]);
  });
});
