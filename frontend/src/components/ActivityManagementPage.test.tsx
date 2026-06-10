import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { within } from "@testing-library/react";

const mockedDownloadOutboundPickSheetPdfFromDocument = vi.fn();

vi.mock("./ui/dataGridCompat", () => ({
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
    getInboundDocuments: vi.fn(),
    getOutboundDocuments: vi.fn(),
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
  getInboundDocuments: ReturnType<typeof vi.fn>;
  getOutboundDocuments: ReturnType<typeof vi.fn>;
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
    mockedApi.getInboundDocuments.mockReset();
    mockedApi.getOutboundDocuments.mockReset();
    mockedApi.createInboundDocument.mockReset();
    mockedApi.createOutboundDocument.mockReset();
    mockedApi.updateInboundDocument.mockReset();
    mockedApi.copyInboundDocument.mockReset();
    mockedDownloadOutboundPickSheetPdfFromDocument.mockReset();
    mockedApi.getPallets.mockResolvedValue([]);
    mockedApi.getInboundDocuments.mockResolvedValue([]);
    mockedApi.getOutboundDocuments.mockResolvedValue([]);
  });

  it("loads inbound documents from the backend when customer, warehouse, or status filters change", async () => {
    const customer = createCustomer({ id: 2, name: "Beta Foods" });
    const location = createLocation({ id: 2, name: "LA" });
    const fetchedDocument = createInboundDocument({
      id: 42,
      customerId: customer.id,
      customerName: customer.name,
      locationId: location.id,
      locationName: location.name,
      containerNo: "FILT-IN-42",
      status: "CONFIRMED",
      trackingStatus: "RECEIVED",
      lines: [createInboundDocumentLine({ documentId: 42 })]
    });
    mockedApi.getInboundDocuments.mockResolvedValue([fetchedDocument]);

    renderWithProviders(
      <ActivityManagementPage
        mode="IN"
        items={[]}
        skuMasters={[]}
        locations={[createLocation(), location]}
        customers={[createCustomer(), customer]}
        movements={[]}
        inboundDocuments={[]}
        outboundDocuments={[]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
      />
    );

    fireEvent.change(screen.getByLabelText("Customer"), { target: { value: String(customer.id) } });
    fireEvent.change(screen.getByLabelText("Warehouse"), { target: { value: String(location.id) } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "CONFIRMED" } });

    await waitFor(() => {
      expect(mockedApi.getInboundDocuments).toHaveBeenLastCalledWith(50000, {
        archiveScope: "active",
        customerId: customer.id,
        locationId: location.id,
        status: "CONFIRMED"
      });
    });
    expect(await screen.findByText("FILT-IN-42")).toBeInTheDocument();
  });

  it("loads outbound documents from the backend when customer, warehouse, or status filters change", async () => {
    const customer = createCustomer({ id: 2, name: "Beta Foods" });
    const location = createLocation({ id: 2, name: "LA" });
    const fetchedDocument = createOutboundDocument({
      id: 84,
      packingListNo: "PL-FILTER-84",
      customerId: customer.id,
      customerName: customer.name,
      status: "CONFIRMED",
      trackingStatus: "SHIPPED",
      lines: [createOutboundDocumentLine({
        documentId: 84,
        locationId: location.id,
        locationName: location.name
      })]
    });
    mockedApi.getOutboundDocuments.mockResolvedValue([fetchedDocument]);

    renderWithProviders(
      <ActivityManagementPage
        mode="OUT"
        items={[]}
        skuMasters={[createSkuMaster()]}
        locations={[createLocation(), location]}
        customers={[createCustomer(), customer]}
        movements={[]}
        inboundDocuments={[]}
        outboundDocuments={[]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
      />
    );

    fireEvent.change(screen.getByLabelText("Customer"), { target: { value: String(customer.id) } });
    fireEvent.change(screen.getByLabelText("Warehouse"), { target: { value: String(location.id) } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "CONFIRMED" } });

    await waitFor(() => {
      expect(mockedApi.getOutboundDocuments).toHaveBeenLastCalledWith(50000, {
        archiveScope: "active",
        customerId: customer.id,
        locationId: location.id,
        status: "CONFIRMED"
      });
    });
    expect(await screen.findByText("PL-FILTER-84")).toBeInTheDocument();
  });

  it("shows customer-created draft packing lists in the outbound queue and opens them for warehouse processing", async () => {
    const onOpenOutboundShipmentEditor = vi.fn();
    const customer = createCustomer({ id: 9, name: "Customer Portal Co" });
    const location = createLocation({ id: 4, name: "NJ Dock" });
    const customerPortalDocument = createOutboundDocument({
      id: 210,
      packingListNo: "PL-CUSTOMER-210",
      orderRef: "SO-CUSTOMER-210",
      customerId: customer.id,
      customerName: customer.name,
      status: "DRAFT",
      trackingStatus: "SCHEDULED",
      totalQty: 7,
      storages: "NJ Dock / TEMP",
      lines: [
        createOutboundDocumentLine({
          id: 211,
          documentId: 210,
          locationId: location.id,
          locationName: location.name,
          quantity: 7,
          pickAllocations: []
        })
      ]
    });

    renderWithProviders(
      <ActivityManagementPage
        mode="OUT"
        items={[]}
        skuMasters={[createSkuMaster()]}
        locations={[location]}
        customers={[customer]}
        movements={[]}
        inboundDocuments={[]}
        outboundDocuments={[customerPortalDocument]}
        currentUserRole="operator"
        isLoading={false}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenOutboundShipmentEditor={onOpenOutboundShipmentEditor}
      />
    );

    expect(await screen.findByText("PL-CUSTOMER-210")).toBeInTheDocument();
    expect(screen.getByText("SO-CUSTOMER-210")).toBeInTheDocument();
    expect(screen.getAllByText("Customer Portal Co").length).toBeGreaterThan(0);
    expect(screen.getByText("NJ Dock / TEMP")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit Draft" }));

    expect(onOpenOutboundShipmentEditor).toHaveBeenCalledWith(210);
  });

  it("loads inbound documents from the backend only after the search is submitted", async () => {
    const fetchedDocument = createInboundDocument({
      id: 43,
      containerNo: "GCXU-SEARCH-43",
      lines: [createInboundDocumentLine({ documentId: 43, sku: "FIND-IN-43" })]
    });
    mockedApi.getInboundDocuments.mockResolvedValue([fetchedDocument]);

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
        onRefresh={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const searchInput = screen.getByRole("searchbox", { name: "Search" });
    fireEvent.change(searchInput, { target: { value: " GCXU-SEARCH " } });
    expect(mockedApi.getInboundDocuments).not.toHaveBeenCalled();

    fireEvent.keyDown(searchInput, { key: "Enter" });

    await waitFor(() => {
      expect(mockedApi.getInboundDocuments).toHaveBeenLastCalledWith(50000, {
        archiveScope: "active",
        customerId: undefined,
        locationId: undefined,
        status: undefined,
        search: "gcxu-search"
      });
    });
    expect(await screen.findByText("GCXU-SEARCH-43")).toBeInTheDocument();
  });

  it("loads outbound documents from the backend when the search icon is clicked", async () => {
    const fetchedDocument = createOutboundDocument({
      id: 85,
      packingListNo: "PL-SEARCH-85",
      lines: [createOutboundDocumentLine({ documentId: 85, sku: "FIND-OUT-85" })]
    });
    mockedApi.getOutboundDocuments.mockResolvedValue([fetchedDocument]);

    renderWithProviders(
      <ActivityManagementPage
        mode="OUT"
        items={[]}
        skuMasters={[createSkuMaster()]}
        locations={[createLocation()]}
        customers={[createCustomer()]}
        movements={[]}
        inboundDocuments={[]}
        outboundDocuments={[]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
      />
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "Search" }), { target: { value: " PL-SEARCH " } });
    expect(mockedApi.getOutboundDocuments).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Search (Enter)" }));

    await waitFor(() => {
      expect(mockedApi.getOutboundDocuments).toHaveBeenLastCalledWith(50000, {
        archiveScope: "active",
        customerId: undefined,
        locationId: undefined,
        status: undefined,
        search: "pl-search"
      });
    });
    expect(await screen.findByText("PL-SEARCH-85")).toBeInTheDocument();
  });

  it("uses the backend-filtered inbound document over a stale preloaded copy", async () => {
    const staleDocument = createInboundDocument({
      id: 55,
      containerNo: "STALE-IN-55",
      status: "DRAFT",
      trackingStatus: "SCHEDULED"
    });
    const freshDocument = createInboundDocument({
      id: 55,
      containerNo: "FRESH-IN-55",
      status: "CONFIRMED",
      trackingStatus: "RECEIVED"
    });
    mockedApi.getInboundDocuments.mockResolvedValue([freshDocument]);

    renderWithProviders(
      <ActivityManagementPage
        mode="IN"
        items={[]}
        skuMasters={[]}
        locations={[createLocation()]}
        customers={[createCustomer()]}
        movements={[]}
        inboundDocuments={[staleDocument]}
        outboundDocuments={[]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
      />
    );

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "CONFIRMED" } });

    await waitFor(() => {
      expect(mockedApi.getInboundDocuments).toHaveBeenLastCalledWith(50000, {
        archiveScope: "active",
        customerId: undefined,
        locationId: undefined,
        status: "CONFIRMED"
      });
    });
    expect(await screen.findByText("FRESH-IN-55")).toBeInTheDocument();
    expect(screen.queryByText("STALE-IN-55")).not.toBeInTheDocument();
  });

  it("requests archived documents by archive scope instead of status", async () => {
    const archivedDocument = createInboundDocument({
      id: 64,
      containerNo: "ARCHIVED-IN-64",
      archivedAt: "2026-03-25T10:00:00Z",
      status: "CONFIRMED"
    });
    mockedApi.getInboundDocuments.mockResolvedValue([archivedDocument]);

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
        onRefresh={vi.fn().mockResolvedValue(undefined)}
      />
    );

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "ARCHIVED" } });

    await waitFor(() => {
      expect(mockedApi.getInboundDocuments).toHaveBeenLastCalledWith(50000, {
        archiveScope: "archived",
        customerId: undefined,
        locationId: undefined,
        status: undefined
      });
    });
    expect(await screen.findByText("ARCHIVED-IN-64")).toBeInTheDocument();
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

  it("locks drawer actions while a receipt copy is in progress", async () => {
    mockedApi.copyInboundDocument.mockImplementation(() => new Promise(() => {}));

    const { container } = renderWithProviders(
      <ActivityManagementPage
        mode="IN"
        items={[]}
        skuMasters={[]}
        locations={[createLocation()]}
        customers={[createCustomer()]}
        movements={[]}
        inboundDocuments={[
          createInboundDocument({
            id: 14,
            status: "CONFIRMED",
            trackingStatus: "RECEIVED",
            expectedArrivalDate: "2026-03-24",
            containerNo: "GCXU5817233",
            lines: [
              createInboundDocumentLine({
                id: 141,
                documentId: 14,
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
        onRefresh={vi.fn().mockResolvedValue(undefined)}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Details" }));

    const drawer = await waitFor(() => {
      const element = container.querySelector(".document-drawer");
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    const reEnterButton = await within(drawer).findByRole("button", { name: /Re-enter Receipt|reEnterReceipt/ });

    fireEvent.click(reEnterButton);

    expect(reEnterButton).toBeDisabled();
    expect(reEnterButton).toHaveAttribute("aria-busy", "true");
    expect(within(drawer).getByRole("button", { name: "Cancel Receipt" })).toBeDisabled();
    expect(mockedApi.copyInboundDocument).toHaveBeenCalledWith(14);
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
