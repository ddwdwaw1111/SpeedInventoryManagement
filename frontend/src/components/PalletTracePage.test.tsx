import type { ReactNode } from "react";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PalletContent, PalletTrace } from "../lib/types";
import { renderWithProviders } from "../test/renderWithProviders";
import { PalletTracePage } from "./PalletTracePage";

const { getCustomers, getLocations, getPallets } = vi.hoisted(() => ({
  getCustomers: vi.fn(),
  getLocations: vi.fn(),
  getPallets: vi.fn()
}));

vi.mock("./ui/dataGridCompat", () => ({
  DataGrid: ({
    rows = [],
    columns = [],
    loading
  }: {
    rows?: Array<Record<string, unknown>>;
    columns?: Array<{
      field: string;
      renderCell?: (params: { row: Record<string, unknown>; value: unknown; field: string; id: unknown }) => ReactNode;
    }>;
    loading?: boolean;
  }) => (
    <table data-testid="mock-data-grid" aria-label="Pallet Trace" aria-busy={loading ? "true" : "false"}>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={String(row.id ?? rowIndex)} data-testid={`grid-row-${String(row.id ?? rowIndex)}`}>
            {columns.map((column) => (
              <td key={column.field} data-field={column.field}>
                {column.renderCell
                  ? column.renderCell({ row, value: row[column.field], field: column.field, id: row.id })
                  : <span>{String(row[column.field] ?? "")}</span>}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}));

vi.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    getCustomers,
    getLocations,
    getPallets
  }
}));

describe("PalletTracePage", () => {
  beforeEach(() => {
    getCustomers.mockReset();
    getLocations.mockReset();
    getPallets.mockReset();
    getCustomers.mockResolvedValue([
      { id: 1, name: "Alpha Foods" },
      { id: 2, name: "Beta Goods" }
    ]);
    getLocations.mockResolvedValue([
      { id: 1, name: "NJ" },
      { id: 2, name: "LA" }
    ]);
    getPallets.mockResolvedValue([]);
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem("sim-timezone", "UTC");
  });

  it("loads the full pallet trace limit and shows pallet total quantity", async () => {
    getPallets.mockResolvedValue([
      createPalletTrace({
        id: 11,
        palletCode: "PLT-001",
        contents: [
          createPalletContent({ id: 21, palletId: 11, quantity: 7 }),
          createPalletContent({ id: 22, palletId: 11, quantity: 5 })
        ]
      })
    ]);

    renderWithProviders(<PalletTracePage />);

    await waitFor(() => {
      expect(getPallets).toHaveBeenCalledWith(50000, {
        search: "",
        sourceInboundDocumentId: undefined,
        customerId: undefined,
        locationId: undefined,
        status: undefined
      });
    });

    const grid = await screen.findByTestId("mock-data-grid");
    const row = within(grid).getByTestId("grid-row-11");
    const quantityCell = row.querySelector('[data-field="quantity"]');

    expect(quantityCell?.textContent).toContain("12");
  });

  it("renders a compact top summary without duplicate content-row count", async () => {
    getPallets.mockResolvedValue([
      createPalletTrace({ id: 11, status: "OPEN" }),
      createPalletTrace({ id: 12, status: "PARTIAL" }),
      createPalletTrace({ id: 13, status: "SHIPPED" })
    ]);

    renderWithProviders(<PalletTracePage />);

    await waitFor(() => {
      expect(getPallets).toHaveBeenCalledWith(50000, {
        search: "",
        sourceInboundDocumentId: undefined,
        customerId: undefined,
        locationId: undefined,
        status: undefined
      });
    });

    const summaryStrip = document.querySelector(".pallet-trace-summary-strip");
    expect(summaryStrip).toBeInstanceOf(HTMLElement);
    if (!(summaryStrip instanceof HTMLElement)) {
      throw new Error("Expected pallet trace summary strip");
    }

    expect(within(summaryStrip).getByText("Records")).toBeInTheDocument();
    expect(within(summaryStrip).getByText("Unshipped Pallets")).toBeInTheDocument();
    expect(within(summaryStrip).getByText("Shipped")).toBeInTheDocument();
    expect(within(summaryStrip).queryByText("Pallet Contents")).not.toBeInTheDocument();
  });

  it("filters pallet rows by search, customer, warehouse, and status", async () => {
    getPallets.mockResolvedValue([
      createPalletTrace({
        id: 11,
        palletCode: "PLT-A",
        customerId: 1,
        customerName: "Alpha Foods",
        currentLocationId: 1,
        currentLocationName: "NJ",
        currentContainerNo: "CONT-A",
        status: "OPEN"
      }),
      createPalletTrace({
        id: 12,
        palletCode: "PLT-B",
        customerId: 2,
        customerName: "Beta Goods",
        currentLocationId: 2,
        currentLocationName: "LA",
        currentContainerNo: "CONT-B",
        status: "SHIPPED"
      }),
      createPalletTrace({
        id: 13,
        palletCode: "PLT-C",
        customerId: 2,
        customerName: "Beta Goods",
        currentLocationId: 1,
        currentLocationName: "NJ",
        currentContainerNo: "CONT-C",
        status: "PARTIAL"
      })
    ]);

    renderWithProviders(<PalletTracePage />);

    await waitFor(() => {
      expect(within(screen.getByTestId("mock-data-grid")).getByText("PLT-A")).toBeInTheDocument();
      expect(within(screen.getByTestId("mock-data-grid")).getByText("PLT-B")).toBeInTheDocument();
      expect(within(screen.getByTestId("mock-data-grid")).getByText("PLT-C")).toBeInTheDocument();
    });

    const searchInput = screen.getByRole("searchbox", { name: "Search" });
    const callsBeforeTyping = getPallets.mock.calls.length;
    fireEvent.change(searchInput, { target: { value: "CONT-C" } });
    expect(getPallets).toHaveBeenCalledTimes(callsBeforeTyping);
    fireEvent.keyDown(searchInput, { key: "Enter" });

    await waitFor(() => {
      expect(getPallets).toHaveBeenLastCalledWith(50000, expect.objectContaining({ search: "cont-c" }));
    });

    await waitFor(() => {
      const grid = screen.getByTestId("mock-data-grid");
      expect(within(grid).queryByText("PLT-A")).not.toBeInTheDocument();
      expect(within(grid).queryByText("PLT-B")).not.toBeInTheDocument();
      expect(within(grid).getByText("PLT-C")).toBeInTheDocument();
    });

    fireEvent.change(searchInput, { target: { value: "" } });
    fireEvent.keyDown(searchInput, { key: "Enter" });
    fireEvent.change(screen.getByRole("combobox", { name: "Customer" }), { target: { value: "2" } });

    await waitFor(() => {
      const grid = screen.getByTestId("mock-data-grid");
      expect(within(grid).queryByText("PLT-A")).not.toBeInTheDocument();
      expect(within(grid).getByText("PLT-B")).toBeInTheDocument();
      expect(within(grid).getByText("PLT-C")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByRole("combobox", { name: "Warehouse" }), { target: { value: "2" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Status" }), { target: { value: "SHIPPED" } });

    await waitFor(() => {
      expect(getPallets).toHaveBeenLastCalledWith(50000, expect.objectContaining({
        customerId: 2,
        locationId: 2,
        status: "SHIPPED"
      }));
    });

    await waitFor(() => {
      const grid = screen.getByTestId("mock-data-grid");
      expect(within(grid).queryByText("PLT-A")).not.toBeInTheDocument();
      expect(within(grid).getByText("PLT-B")).toBeInTheDocument();
      expect(within(grid).queryByText("PLT-C")).not.toBeInTheDocument();
    });
  });

  it("launches a pallet-specific adjustment context for actionable pallets", async () => {
    const onNavigate = vi.fn();
    getPallets.mockResolvedValue([
      createPalletTrace({
        id: 11,
        palletCode: "PLT-001",
        currentContainerNo: "GCXU5817233",
        contents: [createPalletContent({ palletId: 11, quantity: 6 })]
      })
    ]);

    renderWithProviders(<PalletTracePage onNavigate={onNavigate} currentUserRole="admin" />);

    const adjustButton = await screen.findByRole("button", { name: "Adjust Pallet" });
    fireEvent.click(adjustButton);

    expect(onNavigate).toHaveBeenCalledWith("adjustments");
    expect(window.sessionStorage.getItem("sim-adjustments-context")).toBe(JSON.stringify({
      sourceKey: "1:608333",
      sku: "608333",
      customerId: 1,
      containerNo: "GCXU5817233",
      palletId: 11
    }));
  });
});

function createPalletContent(overrides: Partial<PalletContent> = {}): PalletContent {
  return {
    id: 21,
    palletId: 11,
    skuMasterId: 1,
    itemNumber: "608333",
    sku: "608333",
    description: "VB22GC",
    quantity: 6,
    allocatedQty: 0,
    damagedQty: 0,
    holdQty: 0,
    createdAt: "2026-04-01T08:30:00Z",
    updatedAt: "2026-04-01T08:30:00Z",
    ...overrides
  };
}

function createPalletTrace(overrides: Partial<PalletTrace> = {}): PalletTrace {
  return {
    id: 11,
    parentPalletId: 0,
    palletCode: "PLT-001",
    containerVisitId: 1,
    sourceInboundDocumentId: 1,
    sourceInboundLineId: 1,
    actualArrivalDate: "2026-04-01T00:00:00Z",
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
    createdAt: "2026-04-01T08:30:00Z",
    updatedAt: "2026-04-01T08:30:00Z",
    contents: [createPalletContent()],
    ...overrides
  };
}
