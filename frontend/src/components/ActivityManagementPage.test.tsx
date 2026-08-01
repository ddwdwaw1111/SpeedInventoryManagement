import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedDownloadOutboundPickSheetPdfFromDocument = vi.fn();

vi.mock("@mui/x-data-grid", () => ({
  GRID_CHECKBOX_SELECTION_COL_DEF: { field: "__check__", width: 48 },
  gridPaginatedVisibleSortedGridRowIdsSelector: vi.fn(() => []),
  useGridApiContext: () => ({ current: { isRowSelectable: vi.fn(() => true) } }),
  useGridSelector: vi.fn(() => []),
  DataGrid: ({
    rows = [],
    columns = [],
    checkboxSelection = false,
    rowSelectionModel,
    onRowSelectionModelChange,
    isRowSelectable
  }: {
    rows?: Array<Record<string, unknown>>;
    columns?: Array<{
      field: string;
      renderCell?: (params: { row: Record<string, unknown>; value: unknown; field: string; id: unknown }) => React.ReactNode;
    }>;
    checkboxSelection?: boolean;
    rowSelectionModel?: { type: "include" | "exclude"; ids: Set<unknown> };
    onRowSelectionModelChange?: (model: { type: "include" | "exclude"; ids: Set<unknown> }) => void;
    isRowSelectable?: (params: { row: Record<string, unknown> }) => boolean;
  }) => (
    <div data-testid="mock-data-grid">
      {checkboxSelection ? (
        <button
          type="button"
          aria-label="Select all rows"
          onClick={() => onRowSelectionModelChange?.({ type: "include", ids: new Set(rows.map((row) => row.id)) })}
        >
          Select all rows
        </button>
      ) : null}
      {rows.map((row, rowIndex) => (
        <div key={String(row.id ?? rowIndex)}>
          {checkboxSelection ? (
            <input
              type="checkbox"
              aria-label={`Select row ${String(row.id)}`}
              checked={rowSelectionModel?.ids.has(row.id) ?? false}
              disabled={isRowSelectable ? !isRowSelectable({ row }) : false}
              onChange={(event) => {
                const ids = new Set(rowSelectionModel?.ids ?? []);
                if (event.target.checked) ids.add(row.id);
                else ids.delete(row.id);
                onRowSelectionModelChange?.({ type: "include", ids });
              }}
            />
          ) : null}
          {columns.filter((column) => column.field !== "__check__").map((column) => (
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
    getInboundDocuments: vi.fn(),
    getOutboundDocuments: vi.fn(),
    createInboundDocument: vi.fn(),
    createOutboundDocument: vi.fn(),
    updateInboundDocument: vi.fn(),
    bulkUpdateInboundDocumentStatus: vi.fn(),
    bulkConfirmOutboundDocuments: vi.fn(),
    bulkDeleteOutboundDocuments: vi.fn(),
    copyInboundDocument: vi.fn()
  }
}));

vi.mock("../lib/outboundPickSheetPdf", () => ({
  downloadOutboundPickSheetPdfFromDocument: mockedDownloadOutboundPickSheetPdfFromDocument
}));

import { api } from "../lib/api";
import { ActivityManagementPage, buildOutboundSourceOptionsFromItems, buildPickSheetExportDocument, toggleCurrentPageRowSelection } from "./ActivityManagementPage";
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
  createOutboundSourceReference,
  createSkuMaster
} from "../test/fixtures";

const mockedApi = api as unknown as {
  getInboundDocuments: ReturnType<typeof vi.fn>;
  getOutboundDocuments: ReturnType<typeof vi.fn>;
  createInboundDocument: ReturnType<typeof vi.fn>;
  createOutboundDocument: ReturnType<typeof vi.fn>;
  updateInboundDocument: ReturnType<typeof vi.fn>;
  bulkUpdateInboundDocumentStatus: ReturnType<typeof vi.fn>;
  bulkConfirmOutboundDocuments: ReturnType<typeof vi.fn>;
  bulkDeleteOutboundDocuments: ReturnType<typeof vi.fn>;
  copyInboundDocument: ReturnType<typeof vi.fn>;
};

describe("ActivityManagementPage", () => {
  beforeEach(() => {
    mockedApi.getInboundDocuments.mockReset();
    mockedApi.getOutboundDocuments.mockReset();
    mockedApi.createInboundDocument.mockReset();
    mockedApi.createOutboundDocument.mockReset();
    mockedApi.updateInboundDocument.mockReset();
    mockedApi.bulkUpdateInboundDocumentStatus.mockReset();
    mockedApi.bulkConfirmOutboundDocuments.mockReset();
    mockedApi.bulkDeleteOutboundDocuments.mockReset();
    mockedApi.copyInboundDocument.mockReset();
    mockedDownloadOutboundPickSheetPdfFromDocument.mockReset();
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

  it("toggles selection for the current page without clearing other pages", () => {
    const initial = { type: "include" as const, ids: new Set<string | number>([1]) };
    const selected = toggleCurrentPageRowSelection(initial, [2, 3], 100);
    expect([...selected.selection.ids]).toEqual([1, 2, 3]);
    expect(selected.exceeded).toBe(false);

    const deselected = toggleCurrentPageRowSelection(selected.selection, [2, 3], 100);
    expect([...deselected.selection.ids]).toEqual([1]);
  });

  it("bulk updates the selected draft receipts to confirmed", async () => {
    const first = createInboundDocument({ id: 11, containerNo: "BULK-11", status: "DRAFT" });
    const second = createInboundDocument({ id: 12, containerNo: "BULK-12", status: "DRAFT" });
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    mockedApi.bulkUpdateInboundDocumentStatus.mockResolvedValue({
      updatedDocuments: 2,
      status: "CONFIRMED",
      documents: [{ ...first, status: "CONFIRMED" }, { ...second, status: "CONFIRMED" }]
    });

    renderWithProviders(
      <ActivityManagementPage
        mode="IN"
        items={[]}
        skuMasters={[]}
        locations={[createLocation()]}
        customers={[createCustomer()]}
        movements={[]}
        inboundDocuments={[first, second]}
        outboundDocuments={[]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={onRefresh}
      />
    );

    fireEvent.click(screen.getByLabelText("Select row 11"));
    fireEvent.click(screen.getByLabelText("Select row 12"));
    fireEvent.change(screen.getByLabelText("Target status"), { target: { value: "CONFIRMED" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply to 2 selected" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmed" }));

    await waitFor(() => expect(mockedApi.bulkUpdateInboundDocumentStatus).toHaveBeenCalledWith([11, 12], "CONFIRMED"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Updated 2 receipt statuses.")).toBeInTheDocument();
  });

  it("does not offer direct confirmation for sealed-transit drafts", () => {
    renderWithProviders(
      <ActivityManagementPage
        mode="IN"
        items={[]}
        skuMasters={[]}
        locations={[createLocation()]}
        customers={[createCustomer()]}
        movements={[]}
        inboundDocuments={[createInboundDocument({ id: 13, status: "DRAFT", handlingMode: "SEALED_TRANSIT" })]}
        outboundDocuments={[]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByRole("button", { name: "Edit Draft" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm Receipt" })).not.toBeInTheDocument();
  });

  it("hides deleted receipts from the operational list", () => {
    renderWithProviders(
      <ActivityManagementPage
        mode="IN"
        items={[]}
        skuMasters={[]}
        locations={[createLocation()]}
        customers={[createCustomer()]}
        movements={[]}
        inboundDocuments={[
          createInboundDocument({ id: 21, containerNo: "ACTIVE-21", status: "DRAFT" }),
          createInboundDocument({ id: 22, containerNo: "DELETED-22", status: "DELETED", deletedAt: "2026-07-12T12:00:00Z" })
        ]}
        outboundDocuments={[]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getByText("ACTIVE-21")).toBeInTheDocument();
    expect(screen.queryByText("DELETED-22")).not.toBeInTheDocument();
    const statusFilter = screen.getByLabelText("Status") as HTMLSelectElement;
    expect([...statusFilter.options].map((option) => option.value)).toEqual(["all", "DRAFT", "CONFIRMED"]);
  });

  it("caps bulk receipt status selection at the backend limit", () => {
    const documents = Array.from({ length: 101 }, (_, index) => createInboundDocument({
      id: index + 1,
      containerNo: `LIMIT-${index + 1}`,
      status: "DRAFT"
    }));
    renderWithProviders(
      <ActivityManagementPage
        mode="IN"
        items={[]}
        skuMasters={[]}
        locations={[createLocation()]}
        customers={[createCustomer()]}
        movements={[]}
        inboundDocuments={documents}
        outboundDocuments={[]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Select all rows" }));

    expect(screen.getByRole("button", { name: "Apply to 0 selected" })).toBeInTheDocument();
    expect(screen.getAllByText("Select no more than 100 receipts at a time.").length).toBeGreaterThan(0);
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

    const statusFilter = screen.getByLabelText("Status") as HTMLSelectElement;
    expect([...statusFilter.options].map((option) => option.value)).toEqual(["all", "DRAFT", "CONFIRMED", "ARCHIVED"]);

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

  it("bulk confirms selected draft shipments and surfaces reload warnings", async () => {
    const first = createOutboundDocument({ id: 31, packingListNo: "PICK-31", status: "DRAFT", trackingStatus: "SCHEDULED" });
    const second = createOutboundDocument({ id: 32, packingListNo: "PICK-32", status: "DRAFT", trackingStatus: "SCHEDULED" });
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    mockedApi.bulkConfirmOutboundDocuments.mockResolvedValue({
      updatedDocuments: 2,
      failedDocuments: 0,
      unprocessedDocuments: 0,
      interrupted: false,
      documents: [
        { ...first, status: "CONFIRMED", trackingStatus: "SHIPPED" },
        { ...second, status: "CONFIRMED", trackingStatus: "SHIPPED" }
      ],
      results: [
        { documentId: first.id, success: true, warning: "confirmed but reload failed" },
        { documentId: second.id, success: true }
      ]
    });

    renderWithProviders(
      <ActivityManagementPage
        mode="OUT"
        items={[]}
        skuMasters={[createSkuMaster()]}
        locations={[createLocation()]}
        customers={[createCustomer()]}
        movements={[]}
        inboundDocuments={[]}
        outboundDocuments={[first, second]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={onRefresh}
      />
    );

    fireEvent.click(screen.getByLabelText("Select row 31"));
    fireEvent.click(screen.getByLabelText("Select row 32"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm 2 selected" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm Shipment" }));

    await waitFor(() => expect(mockedApi.bulkConfirmOutboundDocuments).toHaveBeenCalledWith([31, 32]));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Confirmed 2 shipments. Confirmed shipments not reloaded: 1. Refresh to verify their latest details.")).toBeInTheDocument();
  });

  it("keeps failed and unprocessed shipments selected after an interrupted bulk confirmation", async () => {
    const first = createOutboundDocument({ id: 41, packingListNo: "PICK-41", status: "DRAFT", trackingStatus: "SCHEDULED" });
    const second = createOutboundDocument({ id: 42, packingListNo: "PICK-42", status: "DRAFT", trackingStatus: "SCHEDULED" });
    const third = createOutboundDocument({ id: 43, packingListNo: "PICK-43", status: "DRAFT", trackingStatus: "SCHEDULED" });
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    mockedApi.bulkConfirmOutboundDocuments.mockResolvedValue({
      updatedDocuments: 1,
      failedDocuments: 1,
      unprocessedDocuments: 1,
      interrupted: true,
      interruptionError: "database connection lost",
      documents: [{ ...first, status: "CONFIRMED", trackingStatus: "SHIPPED" }],
      results: [
        { documentId: first.id, success: true },
        { documentId: second.id, success: false, error: "begin outbound confirm transaction: database connection lost" }
      ]
    });

    renderWithProviders(
      <ActivityManagementPage
        mode="OUT"
        items={[]}
        skuMasters={[createSkuMaster()]}
        locations={[createLocation()]}
        customers={[createCustomer()]}
        movements={[]}
        inboundDocuments={[]}
        outboundDocuments={[first, second, third]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={onRefresh}
      />
    );

    fireEvent.click(screen.getByLabelText("Select row 41"));
    fireEvent.click(screen.getByLabelText("Select row 42"));
    fireEvent.click(screen.getByLabelText("Select row 43"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm 3 selected" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm Shipment" }));

    await waitFor(() => expect(mockedApi.bulkConfirmOutboundDocuments).toHaveBeenCalledWith([41, 42, 43]));
    expect(await screen.findAllByText(/Confirmed 1 shipments; 1 failed.*database connection lost.*Unattempted shipments: 1/)).not.toHaveLength(0);
    expect(screen.getByLabelText("Select row 41")).not.toBeChecked();
    expect(screen.getByLabelText("Select row 42")).toBeChecked();
    expect(screen.getByLabelText("Select row 43")).toBeChecked();
  });

  it("bulk deletes selected draft and confirmed shipments", async () => {
    const draft = createOutboundDocument({ id: 51, packingListNo: "PICK-51", status: "DRAFT", trackingStatus: "PICKING" });
    const confirmed = createOutboundDocument({ id: 52, packingListNo: "PICK-52", status: "CONFIRMED", trackingStatus: "SHIPPED" });
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    mockedApi.bulkDeleteOutboundDocuments.mockResolvedValue({
      deletedDocuments: 2,
      failedDocuments: 0,
      unprocessedDocuments: 0,
      interrupted: false,
      documents: [draft, confirmed],
      results: [
        { documentId: draft.id, success: true, document: draft },
        { documentId: confirmed.id, success: true, document: confirmed }
      ]
    });

    renderWithProviders(
      <ActivityManagementPage
        mode="OUT"
        items={[]}
        skuMasters={[createSkuMaster()]}
        locations={[createLocation()]}
        customers={[createCustomer()]}
        movements={[]}
        inboundDocuments={[]}
        outboundDocuments={[draft, confirmed]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={onRefresh}
      />
    );

    fireEvent.click(screen.getByLabelText("Select row 51"));
    fireEvent.click(screen.getByLabelText("Select row 52"));
    fireEvent.click(screen.getByRole("button", { name: "Delete 2 selected" }));
    fireEvent.click(await screen.findByRole("button", { name: "Permanently Delete" }));

    await waitFor(() => expect(mockedApi.bulkDeleteOutboundDocuments).toHaveBeenCalledWith([51, 52]));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Deleted 2 shipments.")).toBeInTheDocument();
    expect(screen.getByLabelText("Select row 51")).not.toBeChecked();
    expect(screen.getByLabelText("Select row 52")).not.toBeChecked();
  });

  it("reports a refresh warning without claiming a completed bulk deletion failed", async () => {
    const draft = createOutboundDocument({ id: 53, packingListNo: "PICK-53", status: "DRAFT", trackingStatus: "PICKING" });
    const onRefresh = vi.fn().mockRejectedValue(new Error("refresh unavailable"));
    mockedApi.bulkDeleteOutboundDocuments.mockResolvedValue({
      deletedDocuments: 1,
      failedDocuments: 0,
      unprocessedDocuments: 0,
      interrupted: false,
      documents: [draft],
      results: [{ documentId: draft.id, success: true, document: draft }]
    });

    renderWithProviders(
      <ActivityManagementPage
        mode="OUT"
        items={[]}
        skuMasters={[createSkuMaster()]}
        locations={[createLocation()]}
        customers={[createCustomer()]}
        movements={[]}
        inboundDocuments={[]}
        outboundDocuments={[draft]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={onRefresh}
      />
    );

    fireEvent.click(screen.getByLabelText("Select row 53"));
    fireEvent.click(screen.getByRole("button", { name: "Delete 1 selected" }));
    fireEvent.click(await screen.findByRole("button", { name: "Permanently Delete" }));

    await waitFor(() => expect(mockedApi.bulkDeleteOutboundDocuments).toHaveBeenCalledWith([53]));
    expect(await screen.findAllByText(/Deleted 1 shipments\. The deletion was saved, but the shipment list could not be refreshed\./)).not.toHaveLength(0);
    expect(screen.queryByText("Could not delete the selected shipments.")).not.toBeInTheDocument();
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

  it("routes the embedded outbound shortcut through the full shipment editor", async () => {
    const onClose = vi.fn();
    const onOpenOutboundShipmentEditor = vi.fn();

    renderWithProviders(
      <ActivityManagementPage
        mode="OUT"
        items={[]}
        skuMasters={[]}
        outboundSourceReferences={[]}
        locations={[]}
        customers={[]}
        movements={[]}
        inboundDocuments={[]}
        outboundDocuments={[]}
        currentUserRole="operator"
        isLoading={false}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onOpenOutboundShipmentEditor={onOpenOutboundShipmentEditor}
        embeddedComposer={{ initialDate: "2026-07-20", onClose }}
      />
    );

    await waitFor(() => expect(onOpenOutboundShipmentEditor).toHaveBeenCalledWith(null, { scheduledDate: "2026-07-20" }));
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Create Shipment" })).not.toBeInTheDocument();
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

  it("keeps archived documents as an outbound-only filter", async () => {
    const archivedDocument = createOutboundDocument({
      id: 64,
      packingListNo: "ARCHIVED-OUT-64",
      archivedAt: "2026-03-25T10:00:00Z",
      status: "CONFIRMED"
    });
    mockedApi.getOutboundDocuments.mockResolvedValue([archivedDocument]);

    renderWithProviders(
      <ActivityManagementPage
        mode="OUT"
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
      expect(mockedApi.getOutboundDocuments).toHaveBeenLastCalledWith(50000, {
        archiveScope: "archived",
        customerId: undefined,
        locationId: undefined,
        status: undefined
      });
    });
    expect(await screen.findByText("ARCHIVED-OUT-64")).toBeInTheDocument();
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
    fireEvent.change(inboundLineInputs[1] as HTMLInputElement, { target: { value: "ITEM-ABC123" } });
    fireEvent.change(inboundLineInputs[2] as HTMLInputElement, { target: { value: "Sample inbound SKU" } });
    fireEvent.change(inboundLineInputs[3] as HTMLInputElement, { target: { value: "8" } });
    fireEvent.change(inboundLineInputs[4] as HTMLInputElement, { target: { value: "8" } });
    fireEvent.change(inboundLineInputs[5] as HTMLInputElement, { target: { value: "3" } });
    fireEvent.change(inboundLineInputs[6] as HTMLInputElement, { target: { value: "4" } });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Receipt" }));

    await waitFor(() => {
      expect(mockedApi.createInboundDocument).toHaveBeenCalledWith({
        customerId: 1,
        locationId: 1,
        expectedArrivalDate: undefined,
        actualArrivalDate: "2026-03-31",
        containerNo: "MSCU1234567",
        containerType: "NORMAL",
        handlingMode: "PALLETIZED",
        storageSection: "TEMP",
        status: "CONFIRMED",
        trackingStatus: "RECEIVED",
        documentNote: undefined,
        lines: [
          {
            itemNumber: "ITEM-ABC123",
            sku: "ABC123",
            description: "Sample inbound SKU",
            reorderLevel: 0,
            expectedQty: 8,
            receivedQty: 8,
            pallets: 3,
            unitsPerPallet: 4,
            palletsDetailCtns: undefined,
            storageSection: "TEMP",
            lineNote: undefined
          }
        ]
      });
    });

    expect(onRefresh).toHaveBeenCalled();
  });

  it("keeps the declared pallet count independent from default CTN per Pallet", async () => {
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
    fireEvent.change(inboundLineInputs[3] as HTMLInputElement, { target: { value: "1024" } });
    fireEvent.change(inboundLineInputs[4] as HTMLInputElement, { target: { value: "1024" } });
    fireEvent.change(inboundLineInputs[5] as HTMLInputElement, { target: { value: "3" } });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Receipt" }));

    await waitFor(() => {
      expect(mockedApi.createInboundDocument).toHaveBeenCalledWith({
        customerId: 1,
        locationId: 1,
        expectedArrivalDate: undefined,
        actualArrivalDate: "2026-03-31",
        containerNo: "MSCU7654321",
        containerType: "NORMAL",
        handlingMode: "PALLETIZED",
        storageSection: "TEMP",
        status: "CONFIRMED",
        trackingStatus: "RECEIVED",
        documentNote: undefined,
        lines: [
          {
            itemNumber: "ABC123",
            sku: "ABC123",
            description: "Sample inbound SKU",
            reorderLevel: 0,
            expectedQty: 1024,
            receivedQty: 1024,
            pallets: 3,
            unitsPerPallet: 100,
            palletsDetailCtns: undefined,
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
    fireEvent.change(inboundLineInputs[3] as HTMLInputElement, { target: { value: "1024" } });
    fireEvent.change(inboundLineInputs[4] as HTMLInputElement, { target: { value: "1024" } });
    fireEvent.change(inboundLineInputs[5] as HTMLInputElement, { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("CTN / Pallet"), { target: { value: "100" } });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Receipt" }));

    await waitFor(() => {
      expect(mockedApi.createInboundDocument).toHaveBeenCalledWith({
        customerId: 1,
        locationId: 1,
        expectedArrivalDate: undefined,
        actualArrivalDate: "2026-03-31",
        containerNo: "MSCU2222222",
        containerType: "NORMAL",
        handlingMode: "PALLETIZED",
        storageSection: "TEMP",
        status: "CONFIRMED",
        trackingStatus: "RECEIVED",
        documentNote: undefined,
        lines: [
          {
            itemNumber: "011424",
            sku: "011424",
            description: "Manual pallet SKU",
            reorderLevel: 0,
            expectedQty: 1024,
            receivedQty: 1024,
            pallets: 7,
            unitsPerPallet: 100,
            palletsDetailCtns: undefined,
            storageSection: "TEMP",
            lineNote: undefined
          }
        ]
      });
    });

    expect(onRefresh).toHaveBeenCalled();
  });

  it("keeps actual and expected arrival dates independent and presents actual first", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "New Receipt" }));
    const dialog = await screen.findByRole("dialog");
    const dateInputs = dialog.querySelectorAll('.sheet-form input[type="date"]');
    const actualArrival = screen.getByLabelText("Actual Arrival Date") as HTMLInputElement;
    const expectedArrival = screen.getByLabelText("Expected Arrival Date") as HTMLInputElement;

    expect(dateInputs[0]).toBe(actualArrival);
    expect(dateInputs[1]).toBe(expectedArrival);
    fireEvent.change(actualArrival, { target: { value: "2026-04-03" } });
    expect(expectedArrival).toHaveValue("");
    fireEvent.change(expectedArrival, { target: { value: "2026-04-10" } });
    expect(actualArrival).toHaveValue("2026-04-03");
  });

  it("treats Item Code as reference text without changing SKU metadata", async () => {
    renderWithProviders(
      <ActivityManagementPage
        mode="IN"
        items={[]}
        skuMasters={[
          createSkuMaster({ sku: "SKU-A", itemNumber: "CODE-A", description: "Description A", defaultUnitsPerPallet: 10 }),
          createSkuMaster({ id: 2, sku: "SKU-B", itemNumber: "CODE-B", description: "Description B", defaultUnitsPerPallet: 20 })
        ]}
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

    fireEvent.click(screen.getByRole("button", { name: "New Receipt" }));
    const dialog = await screen.findByRole("dialog");
    const headerInputs = dialog.querySelectorAll(".sheet-form input");
    fireEvent.change(headerInputs[0] as HTMLInputElement, { target: { value: "2026-04-01" } });
    fireEvent.change(headerInputs[2] as HTMLInputElement, { target: { value: "ITEM-CODE-REFERENCE" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(dialog.querySelector(".batch-line-grid--inbound")).not.toBeNull());
    const lineInputs = dialog.querySelectorAll(".batch-line-grid--inbound input");
    const skuInput = lineInputs[0] as HTMLInputElement;
    const itemCodeInput = lineInputs[1] as HTMLInputElement;
    const descriptionInput = lineInputs[2] as HTMLInputElement;
    const unitsPerPalletInput = lineInputs[6] as HTMLInputElement;

    fireEvent.change(skuInput, { target: { value: "SKU-A" } });
    expect(itemCodeInput).toHaveValue("CODE-A");
    expect(descriptionInput).toHaveValue("Description A");
    expect(unitsPerPalletInput).toHaveValue(10);

    fireEvent.change(itemCodeInput, { target: { value: "CODE-B" } });
    expect(skuInput).toHaveValue("SKU-A");
    expect(descriptionInput).toHaveValue("Description A");
    expect(unitsPerPalletInput).toHaveValue(10);
  });

  it("allows zero received Qty, pallets, and CTN per Pallet when confirming", async () => {
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
        onRefresh={vi.fn().mockResolvedValue(undefined)}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "New Receipt" }));
    const dialog = await screen.findByRole("dialog");
    const headerInputs = dialog.querySelectorAll(".sheet-form input");
    fireEvent.change(headerInputs[0] as HTMLInputElement, { target: { value: "2026-04-01" } });
    fireEvent.change(headerInputs[2] as HTMLInputElement, { target: { value: "CONT-INDEPENDENT" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    let inboundLineInputs = dialog.querySelectorAll(".batch-line-grid--inbound input");
    fireEvent.change(inboundLineInputs[0] as HTMLInputElement, { target: { value: "SKU-INDEPENDENT" } });
    fireEvent.change(inboundLineInputs[2] as HTMLInputElement, { target: { value: "Independent quantities" } });
    fireEvent.change(inboundLineInputs[3] as HTMLInputElement, { target: { value: "10" } });
    fireEvent.change(inboundLineInputs[4] as HTMLInputElement, { target: { value: "0" } });
    fireEvent.change(inboundLineInputs[5] as HTMLInputElement, { target: { value: "0" } });
    fireEvent.change(inboundLineInputs[6] as HTMLInputElement, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm Receipt" }));

    await waitFor(() => expect(mockedApi.createInboundDocument).toHaveBeenCalledTimes(1));
    const payload = mockedApi.createInboundDocument.mock.calls[0][0];
    expect(payload).toMatchObject({
      expectedArrivalDate: undefined,
      actualArrivalDate: "2026-04-01",
      lines: [{ expectedQty: 10, receivedQty: 0, pallets: 0, unitsPerPallet: 0 }]
    });
  });

  it("sorts receipts by actual arrival before expected arrival", async () => {
    const expectedOnly = createInboundDocument({
      id: 201,
      containerNo: "EXPECTED-ONLY",
      expectedArrivalDate: "2026-04-30",
      actualArrivalDate: null
    });
    const actuallyReceived = createInboundDocument({
      id: 202,
      containerNo: "ACTUAL-FIRST",
      expectedArrivalDate: "2026-04-01",
      actualArrivalDate: "2026-05-01"
    });
    mockedApi.getInboundDocuments.mockResolvedValue([expectedOnly, actuallyReceived]);

    renderWithProviders(
      <ActivityManagementPage
        mode="IN"
        items={[]}
        skuMasters={[]}
        locations={[createLocation()]}
        customers={[createCustomer()]}
        movements={[]}
        inboundDocuments={[expectedOnly, actuallyReceived]}
        outboundDocuments={[]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
      />
    );

    await screen.findByText("ACTUAL-FIRST");
    const gridText = screen.getByTestId("mock-data-grid").textContent || "";
    expect(gridText.indexOf("ACTUAL-FIRST")).toBeLessThan(gridText.indexOf("EXPECTED-ONLY"));
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

    const reEnterButton = await screen.findByRole("button", { name: /Re-enter Receipt|reEnterReceipt/ });

    fireEvent.click(reEnterButton);

    expect(reEnterButton).toBeDisabled();
    expect(reEnterButton).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Delete Receipt" })).toBeDisabled();
    expect(mockedApi.copyInboundDocument).toHaveBeenCalledWith(14);
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
            pallets: 2,
            availablePallets: 2,
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

    fireEvent.change(outboundLineSelect as HTMLSelectElement, { target: { value: "1|1|1" } });
    fireEvent.change(within(dialog).getByLabelText("Planned Ship Qty"), { target: { value: "5" } });
    fireEvent.change(within(dialog).getByLabelText("Actual Ship Qty"), { target: { value: "5" } });
    fireEvent.change(within(dialog).getByLabelText(/pallets/i), { target: { value: "2" } });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Container Pick Plan")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Pick Allocation Preview")).toBeInTheDocument();
    const lineReview = await screen.findByTestId("batch-outbound-line-review");
    expect(lineReview).toHaveTextContent("Planned Ship Qty: 5");
    expect(lineReview).toHaveTextContent("Actual Ship Qty: 5");
    expect(lineReview).toHaveTextContent(/Pallets: 2/i);

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
            plannedQuantity: 5,
            actualQuantity: 5,
            pallets: 2,
            palletsDetailCtns: undefined,
            unitLabel: "CTN",
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
                allocatedQty: 5,
                pallets: 0,
                inventoryPalletsUsed: 1,
                startingPallets: 2,
                remainingPallets: 2
              }
            ]
          }
        ]
      });
    });

    expect(onRefresh).toHaveBeenCalled();
  });

  it("allows a plan-only shipment to be saved when no inventory is currently available", async () => {
    mockedApi.createOutboundDocument.mockResolvedValue(undefined);

    renderWithProviders(
      <ActivityManagementPage
        mode="OUT"
        items={[]}
        skuMasters={[]}
        outboundSourceReferences={[createOutboundSourceReference()]}
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

    fireEvent.click(screen.getByRole("button", { name: "New Shipment" }));
    const dialog = await screen.findByRole("dialog");
    const outboundLineSelect = dialog.querySelector(".batch-line-grid--outbound select");

    expect(outboundLineSelect?.querySelector('option[value="1|1|1"]')).toBeNull();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Search Shipment Source #1" }), { target: { value: "608333" } });
    await waitFor(() => expect(outboundLineSelect?.querySelector('option[value="1|1|1"]')).not.toBeNull());
    fireEvent.change(outboundLineSelect as HTMLSelectElement, { target: { value: "1|1|1" } });
    fireEvent.change(within(dialog).getByLabelText("Planned Ship Qty"), { target: { value: "12" } });
    expect(within(dialog).getByLabelText(/pallets/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Schedule Shipment" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const lineReview = await screen.findByTestId("batch-outbound-line-review");
    expect(lineReview).toHaveTextContent("608333");
    expect(lineReview).toHaveTextContent("Planned Ship Qty: 12");
    expect(lineReview).toHaveTextContent("Actual Ship Qty: 0");
    expect(lineReview).toHaveTextContent(/Pallets: 0/i);
    const finalSubmit = screen.getByRole("button", { name: "Schedule Shipment" });
    expect(finalSubmit).toBeEnabled();
    fireEvent.click(finalSubmit);

    await waitFor(() => expect(mockedApi.createOutboundDocument).toHaveBeenCalledTimes(1));
    expect(mockedApi.createOutboundDocument.mock.calls[0][0].lines[0]).toMatchObject({
      plannedQuantity: 12,
      actualQuantity: 0,
      quantity: 0,
      pallets: 0,
      pickAllocations: undefined
    });
  });

  it("blocks an unresolved outbound row instead of silently dropping it", async () => {
    renderWithProviders(
      <ActivityManagementPage
        mode="OUT"
        items={[]}
        skuMasters={[]}
        outboundSourceReferences={[createOutboundSourceReference()]}
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

    fireEvent.click(screen.getByRole("button", { name: "New Shipment" }));
    const dialog = await screen.findByRole("dialog");
    const firstLineSelect = dialog.querySelector(".batch-line-grid--outbound select") as HTMLSelectElement;
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Search Shipment Source #1" }), { target: { value: "608333" } });
    await waitFor(() => expect(firstLineSelect.querySelector('option[value="1|1|1"]')).not.toBeNull());
    fireEvent.change(firstLineSelect, { target: { value: "1|1|1" } });
    fireEvent.change(within(dialog).getByLabelText("Planned Ship Qty"), { target: { value: "12" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Outbound Line" }));
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Search Shipment Source #2" }), { target: { value: "UNRESOLVED" } });

    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));

    expect(await within(dialog).findByText("Choose a UPC and enter a stock impact quantity.")).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "Search Shipment Source #2" })).toBeInTheDocument();
    expect(mockedApi.createOutboundDocument).not.toHaveBeenCalled();
  });

  it("hydrates draft pick sheet exports with container rows when the document has no stored pick allocations", async () => {
    const sourceOptions = buildOutboundSourceOptionsFromItems([
      createItem({ id: 511, containerNo: "CONTAINER-1", quantity: 10, availableQty: 10, sku: "011423", itemNumber: "011423", description: "011423" }),
      createItem({ id: 512, containerNo: "CONTAINER-2", quantity: 20, availableQty: 20, sku: "011423", itemNumber: "011423", description: "011423" })
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

  it("does not hydrate plan-only zero-actual lines for draft pick sheets", () => {
    const document = createOutboundDocument({
      id: 102,
      status: "DRAFT",
      trackingStatus: "SCHEDULED",
      lines: [createOutboundDocumentLine({
        id: 502,
        plannedQuantity: 15,
        actualQuantity: 0,
        quantity: 0,
        pallets: 0,
        pickAllocations: []
      })]
    });

    expect(buildPickSheetExportDocument(document, []).lines[0].pickAllocations).toEqual([]);
  });
});
