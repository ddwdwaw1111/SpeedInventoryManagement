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
    <table data-testid="mock-data-grid" aria-label="Adjustments" aria-busy={loading ? "true" : "false"}>
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

const { createInventoryAdjustment, getPallets, getUIPreference, updateUIPreference } = vi.hoisted(() => ({
  createInventoryAdjustment: vi.fn(),
  getPallets: vi.fn(),
  getUIPreference: vi.fn(),
  updateUIPreference: vi.fn()
}));

vi.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    createInventoryAdjustment,
    getPallets,
    getUIPreference,
    updateUIPreference
  }
}));

import { setPendingInventoryActionContext } from "../lib/inventoryActionContext";
import { buildInventoryActionSourceKey } from "../lib/inventoryActionSources";
import type { PalletContent, PalletTrace } from "../lib/types";
import { renderWithProviders } from "../test/renderWithProviders";
import { createItem } from "../test/fixtures";
import { AdjustmentManagementPage } from "./AdjustmentManagementPage";

function defaultProps(overrides: Partial<Parameters<typeof AdjustmentManagementPage>[0]> = {}) {
  return {
    adjustments: [],
    items: [],
    currentUserRole: "admin" as const,
    isLoading: false,
    onRefresh: vi.fn().mockResolvedValue(undefined),
    onNavigate: vi.fn(),
    ...overrides
  };
}

describe("AdjustmentManagementPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    createInventoryAdjustment.mockReset();
    getPallets.mockReset();
    getUIPreference.mockReset();
    updateUIPreference.mockReset();
    createInventoryAdjustment.mockResolvedValue({ id: 1 });
    getPallets.mockResolvedValue([]);
    getUIPreference.mockResolvedValue({ value: null });
    updateUIPreference.mockResolvedValue({ value: null });
  });

  it("submits the selected palletId in the adjustment payload", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    setPendingInventoryActionContext("adjustments", {
      sourceKey: buildInventoryActionSourceKey(1, "608333"),
      sku: "608333",
      customerId: 1,
      containerNo: "GCXU5817233",
      palletId: 11
    });
    getPallets.mockResolvedValue([
      createPalletTrace({
        id: 11,
        palletCode: "PLT-001",
        currentContainerNo: "GCXU5817233",
        contents: [createPalletContent({ palletId: 11, quantity: 6 })]
      })
    ]);

    renderWithProviders(
      <AdjustmentManagementPage
        {...defaultProps({
          items: [
            createItem({
              id: 1,
              skuMasterId: 1,
              sku: "608333",
              quantity: 10,
              availableQty: 10,
              customerId: 1,
              locationId: 1,
              locationName: "NJ",
              storageSection: "TEMP",
              containerNo: "GCXU5817233"
            })
          ],
          onRefresh
        })}
      />
    );

    await waitFor(() => {
      expect(getPallets).toHaveBeenCalledWith(50000);
    });
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("option", { name: /PLT-001/i });

    fireEvent.change(within(dialog).getByLabelText("Reason Code"), { target: { value: "DAMAGE" } });
    fireEvent.change(within(dialog).getByLabelText("Pallet"), { target: { value: "11" } });
    fireEvent.change(within(dialog).getAllByRole("spinbutton")[0]!, { target: { value: "-3" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Post Adjustment" }));

    await waitFor(() => {
      expect(createInventoryAdjustment).toHaveBeenCalledWith({
        adjustmentNo: undefined,
        reasonCode: "DAMAGE",
        actualAdjustedAt: undefined,
        notes: undefined,
        lines: [
          {
            customerId: 1,
            locationId: 1,
            storageSection: "TEMP",
            containerNo: "GCXU5817233",
            palletId: 11,
            skuMasterId: 1,
            adjustQty: -3,
            lineNote: undefined
          }
        ]
      });
    });
    expect(onRefresh).toHaveBeenCalled();
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
