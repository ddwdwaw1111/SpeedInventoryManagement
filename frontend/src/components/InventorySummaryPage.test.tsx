import type { ReactNode } from "react";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@mui/x-data-grid", () => ({
  DataGrid: ({
    rows = [],
    columns = [],
    onRowClick,
    loading
  }: {
    rows?: Array<Record<string, unknown>>;
    columns?: Array<{
      field: string;
      valueFormatter?: (value: unknown) => string;
      renderCell?: (params: { row: Record<string, unknown>; value: unknown; field: string; id: unknown }) => ReactNode;
    }>;
    onRowClick?: (params: { row: Record<string, unknown> }) => void;
    loading?: boolean;
  }) => (
    <table data-testid="mock-data-grid" aria-label="Inventory Summary" aria-busy={loading ? "true" : "false"}>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr
            key={String(row.id ?? rowIndex)}
            data-testid={`grid-row-${String(row.id ?? rowIndex)}`}
            onClick={() => onRowClick?.({ row })}
          >
            {columns.map((column) => (
              <td key={column.field} data-field={column.field}>
                {column.renderCell
                  ? column.renderCell({ row, value: row[column.field], field: column.field, id: row.id })
                  : <span>{column.valueFormatter
                      ? column.valueFormatter(row[column.field])
                      : String(row[column.field] ?? "")}</span>}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}));

// Suppress useSharedColumnOrder API calls
vi.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    getPallets: vi.fn().mockResolvedValue([]),
    getUIPreference: vi.fn().mockResolvedValue({ value: null }),
    updateUIPreference: vi.fn().mockResolvedValue({ value: null })
  }
}));

import { api } from "../lib/api";
import { setPendingInventorySummaryContext } from "../lib/inventorySummaryContext";
import { setPendingInventoryActionContext } from "../lib/inventoryActionContext";
import { setPendingAllActivityContext } from "../lib/allActivityContext";
import { setPendingContainerContentsContext } from "../lib/containerContentsContext";
import { InventorySummaryPage } from "./InventorySummaryPage";
import { renderWithProviders } from "../test/renderWithProviders";
import { createCustomer, createItem, createLocation } from "../test/fixtures";

const mockedApi = api as unknown as {
  getPallets: ReturnType<typeof vi.fn>;
  getUIPreference: ReturnType<typeof vi.fn>;
  updateUIPreference: ReturnType<typeof vi.fn>;
};

function defaultProps(overrides: Partial<Parameters<typeof InventorySummaryPage>[0]> = {}) {
  return {
    items: [],
    movements: [],
    customers: [createCustomer()],
    locations: [createLocation()],
    currentUserRole: "admin" as const,
    isLoading: false,
    onNavigate: vi.fn(),
    ...overrides
  };
}

describe("InventorySummaryPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    mockedApi.getPallets.mockReset();
    mockedApi.getPallets.mockResolvedValue([]);
  });

  // ──────────────────────────────────────────────────────────────
  // Basic rendering
  // ──────────────────────────────────────────────────────────────

  it("renders the page heading, search field, and filter dropdowns", () => {
    renderWithProviders(<InventorySummaryPage {...defaultProps()} />);

    expect(screen.getByRole("heading", { name: "Inventory Summary" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/SKU, description/i)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Customer" })).toBeInTheDocument();
  });

  it("renders each inventory item as a row in the grid", () => {
    renderWithProviders(
      <InventorySummaryPage
        {...defaultProps({
          items: [
            createItem({ id: 1, sku: "MANGO-CTN", itemNumber: "ITEM-001", description: "Mango Crate" }),
            createItem({ id: 2, sku: "APPLE-CTN", itemNumber: "ITEM-002", description: "Apple Box" })
          ]
        })}
      />
    );

    const grid = screen.getByTestId("mock-data-grid");
    expect(within(grid).getByText("MANGO-CTN")).toBeInTheDocument();
    expect(within(grid).getByText("Mango Crate")).toBeInTheDocument();
    expect(within(grid).getByText("APPLE-CTN")).toBeInTheDocument();
    expect(within(grid).getByText("Apple Box")).toBeInTheDocument();
  });

  // ──────────────────────────────────────────────────────────────
  // Summary stats strip
  // ──────────────────────────────────────────────────────────────

  it("shows correct SKU count and on-hand total in the summary stats strip", () => {
    const { container } = renderWithProviders(
      <InventorySummaryPage
        {...defaultProps({
          items: [
            createItem({ id: 1, sku: "SKU-A", quantity: 20, availableQty: 18 }),
            createItem({ id: 2, sku: "SKU-B", quantity: 10, availableQty: 8 })
          ]
        })}
      />
    );

    // Stat cards are always in order: [SKU count, On Hand, Available Qty, Low Stock, Warehouses]
    const statCards = container.querySelectorAll(".workspace-summary-card");
    const skuValue = statCards[0]?.querySelector(".workspace-summary-card__value");
    const onHandValue = statCards[1]?.querySelector(".workspace-summary-card__value");
    expect(skuValue?.textContent).toBe("2");  // 2 distinct SKUs
    expect(onHandValue?.textContent).toBe("30"); // 20 + 10
  });

  it("aggregates items with the same SKU and customer across locations into one summary row", () => {
    renderWithProviders(
      <InventorySummaryPage
        {...defaultProps({
          items: [
            createItem({ id: 1, sku: "WIDGET", locationId: 1, locationName: "NJ", quantity: 15, availableQty: 12 }),
            createItem({ id: 2, sku: "WIDGET", locationId: 2, locationName: "LA", quantity: 10, availableQty: 9 })
          ]
        })}
      />
    );

    const grid = screen.getByTestId("mock-data-grid");
    const rows = within(grid).getAllByRole("row");
    // Both items share the same customer+SKU key → 1 merged row
    expect(rows).toHaveLength(1);
    // Combined on-hand shown
    expect(within(grid).getByText("25")).toBeInTheDocument();
  });

  it("shows 2 in the low-stock stat card when two SKU rows have items at or below their reorder level", () => {
    const { container } = renderWithProviders(
      <InventorySummaryPage
        {...defaultProps({
          items: [
            createItem({ id: 1, sku: "LOW-A", reorderLevel: 10, availableQty: 5 }),
            createItem({ id: 2, sku: "LOW-B", reorderLevel: 5, availableQty: 5 }),  // equals threshold
            createItem({ id: 3, sku: "OK", reorderLevel: 5, availableQty: 20 })
          ]
        })}
      />
    );

    // Stat cards order: [SKU count(0), On Hand(1), Available(2), Low Stock(3), Warehouses(4)]
    const statCards = container.querySelectorAll(".workspace-summary-card");
    const lowStockValue = statCards[3]?.querySelector(".workspace-summary-card__value");
    expect(lowStockValue?.textContent).toBe("2");
  });

  it("does not count an item as low stock when its reorderLevel is 0", () => {
    const { container } = renderWithProviders(
      <InventorySummaryPage
        {...defaultProps({
          items: [createItem({ sku: "NO-THRESHOLD", reorderLevel: 0, availableQty: 0 })]
        })}
      />
    );

    const statCards = container.querySelectorAll(".workspace-summary-card");
    const lowStockValue = statCards[3]?.querySelector(".workspace-summary-card__value");
    expect(lowStockValue?.textContent).toBe("0");
  });

  // ──────────────────────────────────────────────────────────────
  // Filtering — search
  // ──────────────────────────────────────────────────────────────

  it("filters grid rows to only matching items when the user types a search term", async () => {
    renderWithProviders(
      <InventorySummaryPage
        {...defaultProps({
          items: [
            createItem({ id: 1, sku: "MANGO", description: "Mango Crate" }),
            createItem({ id: 2, sku: "APPLE", description: "Apple Box" })
          ]
        })}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/SKU, description/i), { target: { value: "mango" } });

    await waitFor(() => {
      const grid = screen.getByTestId("mock-data-grid");
      const rows = within(grid).getAllByRole("row");
      expect(rows).toHaveLength(1);
      expect(within(rows[0]).getByText("MANGO")).toBeInTheDocument();
    });
  });

  it("matches search against item number, customer name, and container number", async () => {
    renderWithProviders(
      <InventorySummaryPage
        {...defaultProps({
          items: [
            createItem({ id: 1, sku: "ALPHA", itemNumber: "ITEM-111", customerName: "Acme Corp", containerNo: "CONT-A" }),
            createItem({ id: 2, sku: "BETA",  itemNumber: "ITEM-222", customerName: "Beta Ltd",  containerNo: "CONT-B" })
          ]
        })}
      />
    );

    // Matches by container number
    fireEvent.change(screen.getByPlaceholderText(/SKU, description/i), { target: { value: "CONT-A" } });

    await waitFor(() => {
      const grid = screen.getByTestId("mock-data-grid");
      expect(within(grid).getAllByRole("row")).toHaveLength(1);
      expect(within(grid).getByText("ALPHA")).toBeInTheDocument();
    });
  });

  it("shows empty grid and no matching rows when the search term matches nothing", async () => {
    renderWithProviders(
      <InventorySummaryPage
        {...defaultProps({ items: [createItem({ sku: "WIDGET" })] })}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/SKU, description/i), { target: { value: "ZZZZZZZ" } });

    await waitFor(() => {
      const grid = screen.getByTestId("mock-data-grid");
      expect(within(grid).queryAllByRole("row")).toHaveLength(0);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Filtering — customer dropdown
  // ──────────────────────────────────────────────────────────────

  it("shows only the selected customer's items when the customer dropdown is changed", async () => {
    const customer1 = createCustomer({ id: 1, name: "Acme" });
    const customer2 = createCustomer({ id: 2, name: "Beta Ltd" });

    renderWithProviders(
      <InventorySummaryPage
        {...defaultProps({
          items: [
            createItem({ id: 1, sku: "SKU-1", customerId: 1, customerName: "Acme" }),
            createItem({ id: 2, sku: "SKU-2", customerId: 2, customerName: "Beta Ltd" })
          ],
          customers: [customer1, customer2]
        })}
      />
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Customer" }), { target: { value: "2" } });

    await waitFor(() => {
      const grid = screen.getByTestId("mock-data-grid");
      const rows = within(grid).getAllByRole("row");
      expect(rows).toHaveLength(1);
      expect(within(grid).getByText("SKU-2")).toBeInTheDocument();
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Filtering — health filter
  // ──────────────────────────────────────────────────────────────

  it("hides in-stock rows and shows only low-stock rows when the LOW_STOCK health filter is selected", async () => {
    renderWithProviders(
      <InventorySummaryPage
        {...defaultProps({
          items: [
            createItem({ id: 1, sku: "LOW-A", reorderLevel: 10, availableQty: 3 }),
            createItem({ id: 2, sku: "OK-B",  reorderLevel: 10, availableQty: 50 })
          ]
        })}
      />
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Stock Health" }), {
      target: { value: "LOW_STOCK" }
    });

    await waitFor(() => {
      const grid = screen.getByTestId("mock-data-grid");
      const rows = within(grid).getAllByRole("row");
      expect(rows).toHaveLength(1);
      expect(within(grid).getByText("LOW-A")).toBeInTheDocument();
      expect(within(grid).queryByText("OK-B")).not.toBeInTheDocument();
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Session storage context pre-fill
  // ──────────────────────────────────────────────────────────────

  it("pre-fills the search field from session storage context on mount", async () => {
    setPendingInventorySummaryContext({ searchTerm: "WIDGET", customerId: undefined });

    renderWithProviders(
      <InventorySummaryPage
        {...defaultProps({ items: [createItem({ sku: "WIDGET" })] })}
      />
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/SKU, description/i)).toHaveValue("WIDGET");
    });
    // Context is consumed once — should not be set any more
    expect(window.sessionStorage.getItem("sim-inventory-summary-context")).toBeNull();
  });

  it("pre-fills customer and health filters from session storage context", async () => {
    setPendingInventorySummaryContext({ customerId: 1, healthFilter: "LOW_STOCK" });

    renderWithProviders(<InventorySummaryPage {...defaultProps()} />);

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Customer" })).toHaveValue("1");
      expect(screen.getByRole("combobox", { name: "Stock Health" })).toHaveValue("LOW_STOCK");
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Row click → drawer
  // ──────────────────────────────────────────────────────────────

  it("opens the details drawer showing warehouse and container breakdowns when a row is clicked", async () => {
    renderWithProviders(
      <InventorySummaryPage
        {...defaultProps({
          items: [
            createItem({
              id: 1,
              sku: "608333",
              description: "VB22GC",
              quantity: 20,
              availableQty: 15,
              locationId: 1,
              locationName: "NJ",
              storageSection: "TEMP",
              containerNo: "GCXU5817233"
            })
          ]
        })}
      />
    );

    const row = screen.getByTestId("grid-row-1:608333");
    fireEvent.click(row);

    await waitFor(() => {
      const drawer = document.querySelector(".document-drawer");
      expect(drawer).toBeInTheDocument();
      expect(within(drawer as HTMLElement).getByText("Warehouse Breakdown")).toBeInTheDocument();
      expect(within(drawer as HTMLElement).getByText("Container Breakdown")).toBeInTheDocument();
      expect(within(drawer as HTMLElement).getByText("NJ")).toBeInTheDocument();
    });
  });

  it("shows pallet counts in the container breakdown drawer rows", async () => {
    mockedApi.getPallets.mockResolvedValue([
      {
        id: 501,
        parentPalletId: 0,
        palletCode: "PLT-501",
        containerVisitId: 1,
        sourceInboundDocumentId: 1,
        sourceInboundLineId: 1,
        actualArrivalDate: "2026-04-01",
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
        createdAt: "2026-04-01T10:00:00Z",
        updatedAt: "2026-04-01T10:00:00Z",
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
            createdAt: "2026-04-01T10:00:00Z",
            updatedAt: "2026-04-01T10:00:00Z"
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
        actualArrivalDate: "2026-04-01",
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
        createdAt: "2026-04-01T11:00:00Z",
        updatedAt: "2026-04-01T11:00:00Z",
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
            createdAt: "2026-04-01T11:00:00Z",
            updatedAt: "2026-04-01T11:00:00Z"
          }
        ]
      }
    ]);

    renderWithProviders(
      <InventorySummaryPage
        {...defaultProps({
          items: [
            createItem({
              id: 1,
              skuMasterId: 1,
              sku: "608333",
              description: "VB22GC",
              quantity: 20,
              availableQty: 15,
              locationId: 1,
              locationName: "NJ",
              storageSection: "TEMP",
              containerNo: "GCXU5817233"
            })
          ]
        })}
      />
    );

    fireEvent.click(screen.getByTestId("grid-row-1:608333"));

    await waitFor(() => {
      const drawer = document.querySelector(".document-drawer");
      expect(drawer).toBeInTheDocument();
      const palletsLabel = within(drawer as HTMLElement).getAllByText(/pallets/i).find((element) =>
        element.tagName.toLowerCase() === "strong"
      );
      expect(palletsLabel).toBeInTheDocument();
      expect(palletsLabel?.nextElementSibling?.textContent).toBe("2");
    });
  });

  it("shows aggregate on-hand and available-qty in the drawer status bar", async () => {
    renderWithProviders(
      <InventorySummaryPage
        {...defaultProps({
          items: [
            createItem({ id: 1, sku: "608333", quantity: 20, availableQty: 15 })
          ]
        })}
      />
    );

    fireEvent.click(screen.getByTestId("grid-row-1:608333"));

    await waitFor(() => {
      const statusBar = document.querySelector(".document-drawer__status-bar");
      expect(statusBar).toBeInTheDocument();
      expect(within(statusBar as HTMLElement).getByText("20")).toBeInTheDocument();
      expect(within(statusBar as HTMLElement).getByText("15")).toBeInTheDocument();
    });
  });

  it("closes the drawer when the close button is clicked", async () => {
    renderWithProviders(
      <InventorySummaryPage
        {...defaultProps({ items: [createItem({ id: 1, sku: "608333" })] })}
      />
    );

    fireEvent.click(screen.getByTestId("grid-row-1:608333"));

    await waitFor(() => expect(screen.getByText("Warehouse Breakdown")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.queryByText("Warehouse Breakdown")).not.toBeInTheDocument();
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Drawer — navigation actions
  // ──────────────────────────────────────────────────────────────

  it("navigates to the adjustments page when the Inventory Adjustment button is clicked", async () => {
    const onNavigate = vi.fn();

    renderWithProviders(
      <InventorySummaryPage
        {...defaultProps({ items: [createItem({ id: 1, sku: "608333", customerId: 1 })], onNavigate })}
      />
    );

    fireEvent.click(screen.getByTestId("grid-row-1:608333"));
    await waitFor(() => expect(screen.getByText("Inventory Adjustment")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Inventory Adjustment" }));
    expect(onNavigate).toHaveBeenCalledWith("adjustments");
  });

  it("navigates to the transfers page when the Inventory Transfer button is clicked", async () => {
    const onNavigate = vi.fn();

    renderWithProviders(
      <InventorySummaryPage
        {...defaultProps({ items: [createItem({ id: 1, sku: "608333" })], onNavigate })}
      />
    );

    fireEvent.click(screen.getByTestId("grid-row-1:608333"));
    await waitFor(() => expect(screen.getByText("Inventory Transfer")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Inventory Transfer" }));
    expect(onNavigate).toHaveBeenCalledWith("transfers");
  });

  it("navigates to container-contents page when Open Container Contents is clicked", async () => {
    const onNavigate = vi.fn();

    renderWithProviders(
      <InventorySummaryPage
        {...defaultProps({ items: [createItem({ id: 1, sku: "608333" })], onNavigate })}
      />
    );

    fireEvent.click(screen.getByTestId("grid-row-1:608333"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Open Container Contents" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Open Container Contents" }));
    expect(onNavigate).toHaveBeenCalledWith("container-contents");
  });

  it("navigates to all-activity page when Inventory Ledger is clicked", async () => {
    const onNavigate = vi.fn();

    renderWithProviders(
      <InventorySummaryPage
        {...defaultProps({ items: [createItem({ id: 1, sku: "608333" })], onNavigate })}
      />
    );

    fireEvent.click(screen.getByTestId("grid-row-1:608333"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Inventory Ledger" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Inventory Ledger" }));
    expect(onNavigate).toHaveBeenCalledWith("all-activity");
  });

  it("sets context sidecars when navigating from the drawer to adjustments and all-activity", async () => {
    const setPendingInventoryActionContextSpy = vi.spyOn({ setPendingInventoryActionContext }, "setPendingInventoryActionContext");
    const setPendingAllActivityContextSpy = vi.spyOn({ setPendingAllActivityContext }, "setPendingAllActivityContext");
    const onNavigate = vi.fn();
    void setPendingInventoryActionContextSpy; // silence unused
    void setPendingAllActivityContextSpy;

    const item = createItem({ id: 1, sku: "608333", customerId: 1 });
    renderWithProviders(
      <InventorySummaryPage {...defaultProps({ items: [item], onNavigate })} />
    );

    fireEvent.click(screen.getByTestId("grid-row-1:608333"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Inventory Adjustment" })).toBeInTheDocument());

    // Navigate to adjustments — downstream context should be set in sessionStorage
    fireEvent.click(screen.getByRole("button", { name: "Inventory Adjustment" }));

    expect(onNavigate).toHaveBeenCalledWith("adjustments");
  });

  // ──────────────────────────────────────────────────────────────
  // Role-based visibility
  // ──────────────────────────────────────────────────────────────

  it("hides Inventory Adjustment and Inventory Transfer buttons for viewer-role users", async () => {
    renderWithProviders(
      <InventorySummaryPage
        {...defaultProps({
          items: [createItem({ id: 1, sku: "608333" })],
          currentUserRole: "viewer"
        })}
      />
    );

    fireEvent.click(screen.getByTestId("grid-row-1:608333"));

    await waitFor(() => expect(screen.getByText("Warehouse Breakdown")).toBeInTheDocument());

    expect(screen.queryByRole("button", { name: "Inventory Adjustment" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Inventory Transfer" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Container Contents" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inventory Ledger" })).toBeInTheDocument();
  });

  it("shows Inventory Adjustment and Transfer buttons for operator-role users", async () => {
    renderWithProviders(
      <InventorySummaryPage
        {...defaultProps({
          items: [createItem({ id: 1, sku: "608333" })],
          currentUserRole: "operator"
        })}
      />
    );

    fireEvent.click(screen.getByTestId("grid-row-1:608333"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Inventory Adjustment" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Inventory Transfer" })).toBeInTheDocument();
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Drawer — shows correct item count in meta section
  // ──────────────────────────────────────────────────────────────

  it("shows the correct current inventory rows count in the drawer meta section", async () => {
    // Two items with the same SKU in different containers → merged row, count = 2
    renderWithProviders(
      <InventorySummaryPage
        {...defaultProps({
          items: [
            createItem({ id: 1, sku: "608333", containerNo: "CONT-A" }),
            createItem({ id: 2, sku: "608333", containerNo: "CONT-B" })
          ]
        })}
      />
    );

    fireEvent.click(screen.getByTestId("grid-row-1:608333"));

    await waitFor(() => {
      const drawer = document.querySelector(".document-drawer");
      expect(drawer).toBeInTheDocument();
      const metaSection = drawer!.querySelector(".document-drawer__meta");
      const currentPositionsLabel = Array.from(metaSection!.querySelectorAll("strong"))
        .find(el => el.textContent === "Current Inventory Positions");
      expect(currentPositionsLabel).toBeInTheDocument();
      const valueSpan = currentPositionsLabel!.nextElementSibling;
      expect(valueSpan?.textContent).toBe("2");
    });
  });
});
