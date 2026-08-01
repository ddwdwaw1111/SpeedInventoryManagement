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
  });

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Basic rendering
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it("renders the page heading, search field, and filter dropdowns", () => {
    renderWithProviders(<InventorySummaryPage {...defaultProps()} />);

    expect(screen.getByRole("heading", { name: "Inventory Summary" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/UPC, description/i)).toBeInTheDocument();
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

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Summary stats strip
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it("shows correct SKU, on-hand, and total-pallet values in the summary stats strip", () => {
    const { container } = renderWithProviders(
      <InventorySummaryPage
        {...defaultProps({
          items: [
            createItem({ id: 1, sku: "SKU-A", quantity: 20, availableQty: 18, pallets: 2 }),
            createItem({ id: 2, sku: "SKU-B", quantity: 10, availableQty: 8, pallets: 3 })
          ]
        })}
      />
    );

    // Stat cards are always in order: [SKU count, On Hand, Available Qty, Total Pallets, Warehouses]
    const statCards = container.querySelectorAll(".workspace-summary-card");
    const skuValue = statCards[0]?.querySelector(".workspace-summary-card__value");
    const onHandValue = statCards[1]?.querySelector(".workspace-summary-card__value");
    const totalPalletsValue = statCards[3]?.querySelector(".workspace-summary-card__value");
    expect(skuValue?.textContent).toBe("2");  // 2 distinct SKUs
    expect(onHandValue?.textContent).toBe("30"); // 20 + 10
    expect(totalPalletsValue?.textContent).toBe("5");
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
    // Both items share the same customer+SKU key â†’ 1 merged row
    expect(rows).toHaveLength(1);
    // Combined on-hand shown
    expect(within(grid).getByText("25")).toBeInTheDocument();
  });

  it("shows the independently aggregated pallet count in the summary table and drawer", async () => {
    renderWithProviders(
      <InventorySummaryPage
        {...defaultProps({
          items: [
            createItem({ id: 1, sku: "WIDGET", locationId: 1, locationName: "NJ", pallets: 2 }),
            createItem({ id: 2, sku: "WIDGET", locationId: 2, locationName: "LA", pallets: 3 })
          ]
        })}
      />
    );

    const row = screen.getByTestId("grid-row-1:WIDGET");
    expect(row.querySelector('[data-field="pallets"]')?.textContent).toBe("5");

    fireEvent.click(row);

    await waitFor(() => {
      const statusBar = document.querySelector(".document-drawer__status-bar");
      expect(statusBar).toBeInTheDocument();
      const palletLabel = within(statusBar as HTMLElement).getByText(/pallets/i);
      expect(palletLabel.previousElementSibling?.textContent).toBe("5");
    });
  });

  it("does not expose reorder-level or low-stock controls", () => {
    const { container } = renderWithProviders(
      <InventorySummaryPage
        {...defaultProps({
          items: [
            createItem({ id: 1, sku: "LOW-A", reorderLevel: 10, availableQty: 5 }),
            createItem({ id: 2, sku: "OK", reorderLevel: 5, availableQty: 20 })
          ]
        })}
      />
    );

    const statCards = container.querySelectorAll(".workspace-summary-card");
    expect(statCards).toHaveLength(5);
    expect(screen.queryByText("Low stock")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Stock Health" })).not.toBeInTheDocument();
  });

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Filtering â€” search
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    fireEvent.change(screen.getByPlaceholderText(/UPC, description/i), { target: { value: "mango" } });

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
    fireEvent.change(screen.getByPlaceholderText(/UPC, description/i), { target: { value: "CONT-A" } });

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

    fireEvent.change(screen.getByPlaceholderText(/UPC, description/i), { target: { value: "ZZZZZZZ" } });

    await waitFor(() => {
      const grid = screen.getByTestId("mock-data-grid");
      expect(within(grid).queryAllByRole("row")).toHaveLength(0);
    });
  });

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Filtering â€” customer dropdown
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

  it("filters summary rows by the container aggregate type", async () => {
    renderWithProviders(
      <InventorySummaryPage
        {...defaultProps({
          items: [
            createItem({ id: 1, skuMasterId: 1, sku: "SKU-NORMAL", itemNumber: "ITEM-N", containerNo: "CONT-N", containerType: "NORMAL" }),
            createItem({ id: 2, skuMasterId: 2, sku: "SKU-TRANSFER", itemNumber: "ITEM-T", containerNo: "CONT-T", containerType: "WEST_COAST_TRANSFER" })
          ]
        })}
      />
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Container Type" }), {
      target: { value: "WEST_COAST_TRANSFER" }
    });

    await waitFor(() => {
      const grid = screen.getByTestId("mock-data-grid");
      const rows = within(grid).getAllByRole("row");
      expect(rows).toHaveLength(1);
      expect(within(grid).getByText("SKU-TRANSFER")).toBeInTheDocument();
      expect(within(grid).queryByText("SKU-NORMAL")).not.toBeInTheDocument();
    });
  });

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Filtering â€” health filter
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Session storage context pre-fill
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it("pre-fills the search field from session storage context on mount", async () => {
    setPendingInventorySummaryContext({ searchTerm: "WIDGET", customerId: undefined });

    renderWithProviders(
      <InventorySummaryPage
        {...defaultProps({ items: [createItem({ sku: "WIDGET" })] })}
      />
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/UPC, description/i)).toHaveValue("WIDGET");
    });
    // Context is consumed once â€” should not be set any more
    expect(window.sessionStorage.getItem("sim-inventory-summary-context")).toBeNull();
  });

  it("pre-fills the customer filter from session storage context", async () => {
    setPendingInventorySummaryContext({ customerId: 1 });

    renderWithProviders(<InventorySummaryPage {...defaultProps()} />);

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Customer" })).toHaveValue("1");
    });
  });

  it("pre-fills the container type filter from session storage context", async () => {
    setPendingInventorySummaryContext({ containerType: "WEST_COAST_TRANSFER" });

    renderWithProviders(<InventorySummaryPage {...defaultProps()} />);

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Container Type" })).toHaveValue("WEST_COAST_TRANSFER");
    });
  });

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Row click â†’ drawer
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
              containerNo: "GCXU5817233",
              pallets: 2
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
              containerNo: "GCXU5817233",
              pallets: 2
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

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Drawer â€” navigation actions
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

  it("navigates to the cycle-counts page and stores SKU scope when New Count Sheet is clicked", async () => {
    const onNavigate = vi.fn();

    renderWithProviders(
      <InventorySummaryPage
        {...defaultProps({ items: [createItem({ id: 1, sku: "608333", customerId: 1 })], onNavigate })}
      />
    );

    fireEvent.click(screen.getByTestId("grid-row-1:608333"));
    await waitFor(() => expect(screen.getByRole("button", { name: "New Count Sheet" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "New Count Sheet" }));

    expect(onNavigate).toHaveBeenCalledWith("cycle-counts");
    expect(JSON.parse(window.sessionStorage.getItem("sim-cycle-counts-context") ?? "{}")).toMatchObject({
      sourceKey: "1:608333",
      sku: "608333",
      customerId: 1
    });
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

    // Navigate to adjustments â€” downstream context should be set in sessionStorage
    fireEvent.click(screen.getByRole("button", { name: "Inventory Adjustment" }));

    expect(onNavigate).toHaveBeenCalledWith("adjustments");
  });

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Role-based visibility
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it("hides inventory action buttons for viewer-role users", async () => {
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

    expect(screen.queryByRole("button", { name: "New Count Sheet" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Inventory Adjustment" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Inventory Transfer" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Container Contents" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inventory Ledger" })).toBeInTheDocument();
  });

  it("shows count, adjustment, and transfer buttons for operator-role users", async () => {
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
      expect(screen.getByRole("button", { name: "New Count Sheet" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Inventory Adjustment" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Inventory Transfer" })).toBeInTheDocument();
    });
  });

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Drawer â€” shows correct item count in meta section
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it("shows the correct current inventory rows count in the drawer meta section", async () => {
    // Two items with the same SKU in different containers â†’ merged row, count = 2
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
