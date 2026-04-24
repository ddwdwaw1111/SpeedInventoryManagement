import type { ReactNode } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
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
    <table data-testid="mock-data-grid" aria-label="Cycle Counts" aria-busy={loading ? "true" : "false"}>
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

const { createCycleCount, getPallets, getUIPreference, updateUIPreference } = vi.hoisted(() => ({
  createCycleCount: vi.fn(),
  getPallets: vi.fn(),
  getUIPreference: vi.fn(),
  updateUIPreference: vi.fn()
}));

vi.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    createCycleCount,
    getPallets,
    getUIPreference,
    updateUIPreference
  }
}));

import { buildInventoryActionSourceKey } from "../lib/inventoryActionSources";
import { setPendingInventoryActionContext } from "../lib/inventoryActionContext";
import type { PalletContent, PalletTrace } from "../lib/types";
import { renderWithProviders } from "../test/renderWithProviders";
import { createItem } from "../test/fixtures";
import { CycleCountManagementPage } from "./CycleCountManagementPage";

function defaultProps(overrides: Partial<Parameters<typeof CycleCountManagementPage>[0]> = {}) {
  return {
    cycleCounts: [],
    items: [],
    currentUserRole: "admin" as const,
    isLoading: false,
    onRefresh: vi.fn().mockResolvedValue(undefined),
    onNavigate: vi.fn(),
    ...overrides
  };
}

describe("CycleCountManagementPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    createCycleCount.mockReset();
    getPallets.mockReset();
    getUIPreference.mockReset();
    updateUIPreference.mockReset();
    getPallets.mockResolvedValue([]);
    getUIPreference.mockResolvedValue({ value: null });
    updateUIPreference.mockResolvedValue({ value: null });
  });

  it("auto-prefills matching inventory positions from SKU launch context and limits selectable options", async () => {
    setPendingInventoryActionContext("cycle-counts", {
      sourceKey: buildInventoryActionSourceKey(1, "608333"),
      sku: "608333",
      customerId: 1
    });

    renderWithProviders(
      <CycleCountManagementPage
        {...defaultProps({
          items: [
            createItem({ id: 1, skuMasterId: 1, sku: "608333", quantity: 10, availableQty: 10, locationId: 1, locationName: "NJ", containerNo: "CONT-A" }),
            createItem({ id: 2, skuMasterId: 1, sku: "608333", quantity: 4, availableQty: 4, locationId: 2, locationName: "LA", containerNo: "CONT-B" }),
            createItem({ id: 3, skuMasterId: 2, sku: "OTHER-SKU", quantity: 9, availableQty: 9, containerNo: "OTHER-CONT" })
          ]
        })}
      />
    );

    expect(await screen.findByText("Loaded 2 inventory position(s) into this count sheet from your launch context.")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Inventory Position")).toHaveLength(2);
    expect(screen.queryByRole("option", { name: /OTHER-SKU/i })).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem("sim-cycle-counts-context")).toBeNull();
  });

  it("auto-prefills matching inventory positions from container launch context", async () => {
    setPendingInventoryActionContext("cycle-counts", {
      containerNo: "GCXU5817233"
    });

    renderWithProviders(
      <CycleCountManagementPage
        {...defaultProps({
          items: [
            createItem({ id: 1, skuMasterId: 1, sku: "SKU-A", quantity: 6, availableQty: 6, containerNo: "GCXU5817233" }),
            createItem({ id: 2, skuMasterId: 2, sku: "SKU-B", quantity: 3, availableQty: 3, containerNo: "GCXU5817233" }),
            createItem({ id: 3, skuMasterId: 3, sku: "SKU-C", quantity: 8, availableQty: 8, containerNo: "MSCU0000001" })
          ]
        })}
      />
    );

    await screen.findByText("Count Lines");

    expect(screen.getAllByLabelText("Inventory Position")).toHaveLength(2);
    expect(screen.getAllByRole("option", { name: /SKU-A/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("option", { name: /SKU-B/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("option", { name: /SKU-C/i })).not.toBeInTheDocument();
  });

  it("shows a warning and keeps the editor closed when launch context no longer matches inventory", async () => {
    setPendingInventoryActionContext("cycle-counts", {
      sourceKey: buildInventoryActionSourceKey(99, "MISSING"),
      sku: "MISSING",
      customerId: 99
    });

    renderWithProviders(
      <CycleCountManagementPage
        {...defaultProps({
          items: [createItem({ id: 1, skuMasterId: 1, sku: "608333", quantity: 10, availableQty: 10 })]
        })}
      />
    );

    expect(await screen.findByText("The requested inventory scope is no longer available. Start a new count manually if needed.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Inventory Position")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "New Count Sheet" }).length).toBeGreaterThan(0);
  });

  it("submits pallet-level counted quantities when matching pallet breakdown exists", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    createCycleCount.mockResolvedValue({ id: 1 });
    getPallets.mockResolvedValue([
      createPalletTrace({
        id: 11,
        palletCode: "PLT-11",
        currentContainerNo: "GCXU5817233",
        contents: [createPalletContent({ palletId: 11, skuMasterId: 1, quantity: 6 })]
      }),
      createPalletTrace({
        id: 12,
        palletCode: "PLT-12",
        currentContainerNo: "GCXU5817233",
        contents: [createPalletContent({ palletId: 12, skuMasterId: 1, quantity: 4 })]
      })
    ]);
    setPendingInventoryActionContext("cycle-counts", {
      sourceKey: buildInventoryActionSourceKey(1, "608333"),
      sku: "608333",
      customerId: 1
    });

    renderWithProviders(
      <CycleCountManagementPage
        {...defaultProps({
          items: [createItem({ id: 1, skuMasterId: 1, sku: "608333", quantity: 10, availableQty: 10, customerId: 1, locationId: 1, containerNo: "GCXU5817233" })],
          onRefresh
        })}
      />
    );

    expect(await screen.findByText("PLT-11")).toBeInTheDocument();
    expect(screen.getByText("PLT-12")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Counted Qty: PLT-11"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Counted Qty: PLT-12"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Review & Post" }));
    fireEvent.click(screen.getByRole("button", { name: "Post Count Sheet" }));

    await waitFor(() => {
      expect(createCycleCount).toHaveBeenCalledWith({
        countNo: undefined,
        notes: undefined,
        lines: [
          {
            customerId: 1,
            locationId: 1,
            storageSection: "TEMP",
            containerNo: "GCXU5817233",
            palletId: 11,
            skuMasterId: 1,
            countedQty: 5,
            lineNote: undefined
          },
          {
            customerId: 1,
            locationId: 1,
            storageSection: "TEMP",
            containerNo: "GCXU5817233",
            palletId: 12,
            skuMasterId: 1,
            countedQty: 3,
            lineNote: undefined
          }
        ]
      });
    });
    expect(onRefresh).toHaveBeenCalled();
  });

  it("adds a new pallet row and submits it as createPallet", async () => {
    createCycleCount.mockResolvedValue({ id: 1 });
    getPallets.mockResolvedValue([
      createPalletTrace({
        id: 11,
        palletCode: "PLT-11",
        currentContainerNo: "GCXU5817233",
        contents: [createPalletContent({ palletId: 11, skuMasterId: 1, quantity: 6 })]
      }),
      createPalletTrace({
        id: 12,
        palletCode: "PLT-12",
        currentContainerNo: "GCXU5817233",
        contents: [createPalletContent({ palletId: 12, skuMasterId: 1, quantity: 4 })]
      })
    ]);
    setPendingInventoryActionContext("cycle-counts", {
      sourceKey: buildInventoryActionSourceKey(1, "608333"),
      sku: "608333",
      customerId: 1
    });

    renderWithProviders(
      <CycleCountManagementPage
        {...defaultProps({
          items: [createItem({ id: 1, skuMasterId: 1, sku: "608333", quantity: 10, availableQty: 10, customerId: 1, locationId: 1, containerNo: "GCXU5817233" })]
        })}
      />
    );

    expect(await screen.findByText("PLT-11")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add Pallet" }));
    const newPalletQtyInput = screen.getByLabelText("Counted Qty: New Pallet 3");
    const newPalletCode = newPalletQtyInput.getAttribute("aria-label")?.replace("Counted Qty: ", "");
    expect(newPalletCode).toBe("New Pallet 3");
    fireEvent.change(newPalletQtyInput, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Review & Post" }));
    fireEvent.click(screen.getByRole("button", { name: "Post Count Sheet" }));

    await waitFor(() => {
      expect(createCycleCount).toHaveBeenCalledWith({
        countNo: undefined,
        notes: undefined,
        lines: [
          {
            customerId: 1,
            locationId: 1,
            storageSection: "TEMP",
            containerNo: "GCXU5817233",
            palletId: 11,
            skuMasterId: 1,
            countedQty: 6,
            lineNote: undefined
          },
          {
            customerId: 1,
            locationId: 1,
            storageSection: "TEMP",
            containerNo: "GCXU5817233",
            palletId: 12,
            skuMasterId: 1,
            countedQty: 4,
            lineNote: undefined
          },
          {
            customerId: 1,
            locationId: 1,
            storageSection: "TEMP",
            containerNo: "GCXU5817233",
            createPallet: true,
            skuMasterId: 1,
            countedQty: 2,
            lineNote: undefined
          }
        ]
      });
    });
  });

  it("removes an existing pallet row by posting zero counted qty for that pallet", async () => {
    createCycleCount.mockResolvedValue({ id: 1 });
    getPallets.mockResolvedValue([
      createPalletTrace({
        id: 11,
        palletCode: "PLT-11",
        currentContainerNo: "GCXU5817233",
        contents: [createPalletContent({ palletId: 11, skuMasterId: 1, quantity: 6 })]
      }),
      createPalletTrace({
        id: 12,
        palletCode: "PLT-12",
        currentContainerNo: "GCXU5817233",
        contents: [createPalletContent({ palletId: 12, skuMasterId: 1, quantity: 4 })]
      })
    ]);
    setPendingInventoryActionContext("cycle-counts", {
      sourceKey: buildInventoryActionSourceKey(1, "608333"),
      sku: "608333",
      customerId: 1
    });

    renderWithProviders(
      <CycleCountManagementPage
        {...defaultProps({
          items: [createItem({ id: 1, skuMasterId: 1, sku: "608333", quantity: 10, availableQty: 10, customerId: 1, locationId: 1, containerNo: "GCXU5817233" })]
        })}
      />
    );

    expect(await screen.findByText("PLT-11")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove Pallet: PLT-12" }));
    fireEvent.click(screen.getByRole("button", { name: "Review & Post" }));
    fireEvent.click(screen.getByRole("button", { name: "Post Count Sheet" }));

    await waitFor(() => {
      expect(createCycleCount).toHaveBeenCalledWith({
        countNo: undefined,
        notes: undefined,
        lines: [
          {
            customerId: 1,
            locationId: 1,
            storageSection: "TEMP",
            containerNo: "GCXU5817233",
            palletId: 11,
            skuMasterId: 1,
            countedQty: 6,
            lineNote: undefined
          },
          {
            customerId: 1,
            locationId: 1,
            storageSection: "TEMP",
            containerNo: "GCXU5817233",
            palletId: 12,
            skuMasterId: 1,
            countedQty: 0,
            lineNote: undefined
          }
        ]
      });
    });
  });

  it("blocks posting when a selected count line has no pallet breakdown", async () => {
    setPendingInventoryActionContext("cycle-counts", {
      sourceKey: buildInventoryActionSourceKey(1, "608333"),
      sku: "608333",
      customerId: 1
    });

    renderWithProviders(
      <CycleCountManagementPage
        {...defaultProps({
          items: [createItem({ id: 1, skuMasterId: 1, sku: "608333", quantity: 10, availableQty: 10, customerId: 1, locationId: 1, containerNo: "GCXU5817233" })]
        })}
      />
    );

    await screen.findByText("Count Lines");
    expect(screen.getByText("No active pallets match this inventory position. Cycle counts are pallet-only until pallet data is repaired.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Pallet" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Review & Post" }));

    expect(screen.getByText("Select an inventory position for every draft line, then confirm its pallet breakdown before posting.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Post Count Sheet" })).toBeDisabled();
    expect(createCycleCount).not.toHaveBeenCalled();
  });
});

function createPalletContent(overrides: Partial<PalletContent> = {}): PalletContent {
  return {
    id: 1,
    palletId: 11,
    skuMasterId: 1,
    itemNumber: "608333",
    sku: "608333",
    description: "VB22GC",
    quantity: 6,
    allocatedQty: 0,
    damagedQty: 0,
    holdQty: 0,
    createdAt: "2026-03-24T10:00:00Z",
    updatedAt: "2026-03-24T10:00:00Z",
    ...overrides
  };
}

function createPalletTrace(overrides: Partial<PalletTrace> = {}): PalletTrace {
  return {
    id: 11,
    parentPalletId: 0,
    palletCode: "PLT-11",
    containerVisitId: 1,
    sourceInboundDocumentId: 1,
    sourceInboundLineId: 1,
    actualArrivalDate: "2026-03-24",
    containerType: "NORMAL",
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
    contents: [createPalletContent()],
    ...overrides
  };
}
