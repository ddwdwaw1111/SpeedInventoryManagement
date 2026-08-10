import type { ReactNode } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMovements } = vi.hoisted(() => ({
  getMovements: vi.fn()
}));

vi.mock("@mui/x-data-grid", () => ({
  GRID_CHECKBOX_SELECTION_COL_DEF: { field: "__check__" },
  gridPaginatedVisibleSortedGridRowIdsSelector: vi.fn(),
  useGridApiContext: vi.fn(),
  useGridSelector: vi.fn(),
  DataGrid: ({
    rows = [],
    columns = [],
    checkboxSelection = false,
    rowSelectionModel,
    onRowSelectionModelChange
  }: {
    rows?: Array<Record<string, unknown>>;
    columns?: Array<{
      field: string;
      renderCell?: (params: { row: Record<string, unknown>; value: unknown; field: string; id: unknown }) => ReactNode;
    }>;
    checkboxSelection?: boolean;
    rowSelectionModel?: { type: "include" | "exclude"; ids: Set<unknown> };
    onRowSelectionModelChange?: (model: { type: "include" | "exclude"; ids: Set<unknown> }) => void;
  }) => (
    <div data-testid="mock-data-grid">
      {checkboxSelection && rows[0] ? (
        <button
          type="button"
          aria-label="Select first container row"
          onClick={() => onRowSelectionModelChange?.({ type: "include", ids: new Set([rows[0]!.id]) })}
        >
          {rowSelectionModel?.ids.has(rows[0]!.id) ? "Selected" : "Select"}
        </button>
      ) : null}
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
  ApiError: class ApiError extends Error {},
  api: {
    getMovements
  }
}));

import { formatDateTimeValue } from "../lib/dates";
import { renderWithProviders } from "../test/renderWithProviders";
import { createCustomer, createItem, createLocation, createMovement } from "../test/fixtures";
import { ContainerContentsPage } from "./ContainerContentsPage";

describe("ContainerContentsPage", () => {
  beforeEach(() => {
    getMovements.mockReset();
    getMovements.mockResolvedValue([]);
    window.localStorage.clear();
    window.localStorage.setItem("sim-timezone", "UTC");
  });

  it("shows the received timestamp and keeps shipped time open while the container still has stock", () => {
    const receivedAt = "2026-04-01T08:30:00Z";
    const partialShipAt = "2026-04-02T10:15:00Z";
    const onOpenContainerDetail = vi.fn();

    renderWithProviders(
      <ContainerContentsPage
        items={[
          createItem({
            containerNo: "GCXU5817233",
            quantity: 5,
            availableQty: 5,
            pallets: 4,
            deliveryDate: "2026-04-01",
            lastRestockedAt: receivedAt
          })
        ]}
        movements={[
          createMovement({
            id: 1,
            containerNo: "GCXU5817233",
            movementType: "IN",
            quantityChange: 10,
            createdAt: receivedAt,
            deliveryDate: "2026-04-01"
          }),
          createMovement({
            id: 2,
            inboundDocumentId: 0,
            inboundDocumentLineId: 0,
            outboundDocumentId: 2,
            outboundDocumentLineId: 1,
            containerNo: "GCXU5817233",
            movementType: "OUT",
            quantityChange: -5,
            createdAt: partialShipAt,
            outDate: "2026-04-02"
          })
        ]}
        customers={[createCustomer()]}
        locations={[createLocation()]}
        currentUserRole="admin"
        isLoading={false}
        onOpenContainerDetail={onOpenContainerDetail}
        onNavigate={vi.fn()}
      />
    );

    const receivedLabel = formatDateTimeValue(receivedAt, "UTC");
    expect(screen.getByText(receivedLabel)).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getAllByText("Not Shipped").length).toBeGreaterThan(0);
    expect(screen.queryByText(formatDateTimeValue(partialShipAt, "UTC"))).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View Detail GCXU5817233" }));

    expect(onOpenContainerDetail).toHaveBeenCalledWith("GCXU5817233", 1);
  });

  it("shows fully shipped containers from movement history and still offers the secondary detail page", () => {
    const receivedAt = "2026-03-28T07:00:00Z";
    const shippedAt = "2026-03-30T16:45:00Z";
    const onOpenContainerDetail = vi.fn();

    renderWithProviders(
      <ContainerContentsPage
        items={[]}
        movements={[
          createMovement({
            id: 11,
            containerNo: "MRSU6884820",
            movementType: "IN",
            createdAt: receivedAt,
            deliveryDate: "2026-03-28",
            locationName: "NJ",
            storageSection: "TEMP",
            sku: "SKU-HISTORY-1",
            itemNumber: "SKU-HISTORY-1"
          }),
          createMovement({
            id: 12,
            inboundDocumentId: 0,
            inboundDocumentLineId: 0,
            outboundDocumentId: 3,
            outboundDocumentLineId: 1,
            containerNo: "MRSU6884820",
            movementType: "OUT",
            quantityChange: -10,
            createdAt: shippedAt,
            outDate: "2026-03-30",
            locationName: "NJ",
            storageSection: "TEMP",
            sku: "SKU-HISTORY-1",
            itemNumber: "SKU-HISTORY-1"
          })
        ]}
        customers={[createCustomer()]}
        locations={[createLocation()]}
        currentUserRole="admin"
        isLoading={false}
        onOpenContainerDetail={onOpenContainerDetail}
        onNavigate={vi.fn()}
      />
    );

    expect(screen.getByText(formatDateTimeValue(shippedAt, "UTC"))).toBeInTheDocument();
    expect(screen.queryByText("Not Shipped")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View Detail MRSU6884820" }));

    expect(onOpenContainerDetail).toHaveBeenCalledWith("MRSU6884820", 1);
  });

  it("loads filtered movement history from the backend when searching historical containers", async () => {
    const onOpenContainerDetail = vi.fn();
    getMovements.mockResolvedValue([
      createMovement({
        id: 21,
        containerNo: "OLDU1234567",
        movementType: "OUT",
        quantityChange: -12,
        outDate: "2026-02-15",
        createdAt: "2026-02-15T15:00:00Z",
        sku: "SKU-HISTORY-2",
        itemNumber: "SKU-HISTORY-2"
      })
    ]);

    renderWithProviders(
      <ContainerContentsPage
        items={[]}
        movements={[]}
        customers={[createCustomer()]}
        locations={[createLocation()]}
        currentUserRole="admin"
        isLoading={false}
        onOpenContainerDetail={onOpenContainerDetail}
        onNavigate={vi.fn()}
      />
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Customer" }), { target: { value: "1" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Warehouse" }), { target: { value: "1" } });
    const searchInput = screen.getByRole("searchbox", { name: "Search" });
    fireEvent.change(searchInput, { target: { value: "OLDU1234567" } });
    fireEvent.click(screen.getByRole("button", { name: "Search (Enter)" }));

    await waitFor(() => {
      expect(getMovements).toHaveBeenCalledWith(20000, {
        search: "oldu1234567",
        customerId: 1,
        locationId: 1
      });
    });

    fireEvent.click(await screen.findByRole("button", { name: "View Detail OLDU1234567" }));

    expect(onOpenContainerDetail).toHaveBeenCalledWith("OLDU1234567", 1);
  });

  it("uses actual restock time instead of business receipt date for backfilled containers", () => {
    const actualRecordedAt = "2026-04-03T12:45:00Z";

    renderWithProviders(
      <ContainerContentsPage
        items={[
          createItem({
            containerNo: "OOLU1234567",
            quantity: 8,
            availableQty: 8,
            deliveryDate: "2025-12-15",
            lastRestockedAt: null,
            createdAt: actualRecordedAt
          })
        ]}
        movements={[]}
        customers={[createCustomer()]}
        locations={[createLocation()]}
        currentUserRole="admin"
        isLoading={false}
        onOpenContainerDetail={vi.fn()}
        onNavigate={vi.fn()}
      />
    );

    expect(screen.getByText(formatDateTimeValue(actualRecordedAt, "UTC"))).toBeInTheDocument();
  });

  it("keeps identical container numbers separate for different customers", () => {
    const onOpenContainerDetail = vi.fn();
    const sharedContainerNo = "SHARED-CONT-001";

    renderWithProviders(
      <ContainerContentsPage
        items={[
          createItem({ id: 1, customerId: 1, customerName: "Customer Alpha", containerNo: sharedContainerNo, quantity: 5, availableQty: 5 }),
          createItem({ id: 2, customerId: 2, customerName: "Customer Beta", containerNo: sharedContainerNo, quantity: 9, availableQty: 9 })
        ]}
        movements={[
          createMovement({ id: 1, customerId: 1, customerName: "Customer Alpha", containerNo: sharedContainerNo }),
          createMovement({ id: 2, customerId: 2, customerName: "Customer Beta", containerNo: sharedContainerNo })
        ]}
        customers={[
          createCustomer({ id: 1, name: "Customer Alpha" }),
          createCustomer({ id: 2, name: "Customer Beta" })
        ]}
        locations={[createLocation()]}
        currentUserRole="admin"
        isLoading={false}
        onOpenContainerDetail={onOpenContainerDetail}
        onNavigate={vi.fn()}
      />
    );

    const detailButtons = screen.getAllByRole("button", { name: `View Detail ${sharedContainerNo}` });
    expect(detailButtons).toHaveLength(2);
    fireEvent.click(detailButtons[0]!);
    fireEvent.click(detailButtons[1]!);
    expect(onOpenContainerDetail).toHaveBeenNthCalledWith(1, sharedContainerNo, 1);
    expect(onOpenContainerDetail).toHaveBeenNthCalledWith(2, sharedContainerNo, 2);
  });

  it("clears selected containers when the source warehouse filter changes", async () => {
    const source = createLocation({ id: 1, name: "99" });
    const otherSource = createLocation({ id: 2, name: "600" });
    const containerNo = "MULTI-WAREHOUSE-CONT";

    renderWithProviders(
      <ContainerContentsPage
        items={[
          createItem({ id: 1, containerNo, locationId: source.id, locationName: source.name, quantity: 20, availableQty: 20 }),
          createItem({ id: 2, skuMasterId: 2, sku: "UPC-2", containerNo, locationId: otherSource.id, locationName: otherSource.name, quantity: 30, availableQty: 30 })
        ]}
        movements={[]}
        customers={[createCustomer()]}
        locations={[source, otherSource]}
        currentUserRole="admin"
        isLoading={false}
        onOpenContainerDetail={vi.fn()}
        onNavigate={vi.fn()}
      />
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Warehouse" }), { target: { value: String(source.id) } });
    fireEvent.click(screen.getByRole("button", { name: "Select first container row" }));
    expect(screen.getByRole("button", { name: "Transfer Selected (1)" })).toBeEnabled();

    fireEvent.change(screen.getByRole("combobox", { name: "Warehouse" }), { target: { value: String(otherSource.id) } });

    await waitFor(() => expect(screen.getByRole("button", { name: "Transfer Selected (0)" })).toBeDisabled());
  });
});
