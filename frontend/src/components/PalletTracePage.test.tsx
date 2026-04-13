import type { ReactNode } from "react";
import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PalletContent, PalletTrace } from "../lib/types";
import { renderWithProviders } from "../test/renderWithProviders";
import { PalletTracePage } from "./PalletTracePage";

const { getPallets } = vi.hoisted(() => ({
  getPallets: vi.fn()
}));

vi.mock("@mui/x-data-grid", () => ({
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
    getPallets
  }
}));

describe("PalletTracePage", () => {
  beforeEach(() => {
    getPallets.mockReset();
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
      expect(getPallets).toHaveBeenCalledWith(50000, "", undefined);
    });

    const grid = await screen.findByTestId("mock-data-grid");
    const row = within(grid).getByTestId("grid-row-11");
    const quantityCell = row.querySelector('[data-field="quantity"]');

    expect(quantityCell?.textContent).toContain("12");
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
    status: "OPEN",
    createdAt: "2026-04-01T08:30:00Z",
    updatedAt: "2026-04-01T08:30:00Z",
    contents: [createPalletContent()],
    ...overrides
  };
}
