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
    createInboundDocument: vi.fn(),
    createOutboundDocument: vi.fn(),
    updateInboundDocument: vi.fn(),
    copyInboundDocument: vi.fn()
  }
}));

import { api } from "../lib/api";
import { ActivityManagementPage } from "./ActivityManagementPage";
import { renderWithProviders } from "../test/renderWithProviders";
import { createCustomer, createInboundDocument, createInboundDocumentLine, createItem, createLocation, createMovement, createSkuMaster } from "../test/fixtures";

const mockedApi = api as unknown as {
  createInboundDocument: ReturnType<typeof vi.fn>;
  createOutboundDocument: ReturnType<typeof vi.fn>;
  updateInboundDocument: ReturnType<typeof vi.fn>;
  copyInboundDocument: ReturnType<typeof vi.fn>;
};

describe("ActivityManagementPage", () => {
  beforeEach(() => {
    mockedApi.createInboundDocument.mockReset();
    mockedApi.createOutboundDocument.mockReset();
    mockedApi.updateInboundDocument.mockReset();
    mockedApi.copyInboundDocument.mockReset();
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

    fireEvent.click(screen.getByRole("button", { name: "Confirm Shipment" }));

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
        status: "CONFIRMED",
        trackingStatus: "SHIPPED",
        documentNote: undefined,
        lines: [
          {
            customerId: 1,
            locationId: 1,
            skuMasterId: 1,
            quantity: 5,
            pallets: 0,
            palletsDetailCtns: undefined,
            unitLabel: "CTN",
            cartonSizeMm: undefined,
            netWeightKgs: 0,
            grossWeightKgs: 0,
            lineNote: undefined
          }
        ]
      });
    });

    expect(onRefresh).toHaveBeenCalled();
  });
});
