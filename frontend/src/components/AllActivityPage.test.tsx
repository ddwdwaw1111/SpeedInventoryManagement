import type { ReactNode } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Customer, Location, Movement } from "../lib/types";
import { renderWithProviders } from "../test/renderWithProviders";
import { AllActivityPage } from "./AllActivityPage";

const { getMovements } = vi.hoisted(() => ({
  getMovements: vi.fn()
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
    <table data-testid="mock-data-grid" aria-label="All Activity" aria-busy={loading ? "true" : "false"}>
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
    getMovements
  }
}));

describe("AllActivityPage", () => {
  const customers: Customer[] = [
    createCustomer({ id: 1, name: "Alpha Foods" }),
    createCustomer({ id: 2, name: "Beta Goods" })
  ];
  const locations: Location[] = [
    createLocation({ id: 1, name: "NJ" }),
    createLocation({ id: 2, name: "LA" })
  ];

  beforeEach(() => {
    getMovements.mockReset();
    getMovements.mockResolvedValue([
      createMovement({
        id: 11,
        customerId: 2,
        customerName: "Beta Goods",
        locationName: "LA",
        movementType: "OUT",
        containerNo: "CONT-B",
        outDate: "2026-04-20T00:00:00Z"
      })
    ]);
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem("sim-timezone", "UTC");
  });

  it("loads activity rows with backend search and filter parameters", async () => {
    renderWithProviders(
      <AllActivityPage
        movements={[createMovement()]}
        customers={customers}
        locations={locations}
        currentUserRole="admin"
        isLoading={false}
        onNavigate={() => undefined}
      />
    );

    expect(getMovements).not.toHaveBeenCalled();

    const searchInput = screen.getByRole("searchbox", { name: "Search" });
    fireEvent.change(searchInput, { target: { value: "CONT-B" } });
    expect(getMovements).not.toHaveBeenCalled();
    fireEvent.keyDown(searchInput, { key: "Enter" });
    fireEvent.change(screen.getByRole("combobox", { name: "Customer" }), { target: { value: "2" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Warehouse" }), { target: { value: "2" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Movement Type" }), { target: { value: "OUT" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-04-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-04-30" } });

    await waitFor(() => {
      expect(getMovements).toHaveBeenCalledWith(20000, {
        search: "cont-b",
        customerId: 2,
        locationId: 2,
        movementType: "OUT",
        startDate: "2026-04-01",
        endDate: "2026-04-30",
        startAt: "2026-04-01T00:00:00.000Z",
        endBefore: "2026-05-01T00:00:00.000Z"
      });
    });
  });
});

function createCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 1,
    name: "Alpha Foods",
    contactName: "",
    email: "",
    phone: "",
    notes: "",
    createdAt: "2026-04-01T08:30:00Z",
    updatedAt: "2026-04-01T08:30:00Z",
    ...overrides
  };
}

function createLocation(overrides: Partial<Location> = {}): Location {
  return {
    id: 1,
    name: "NJ",
    address: "",
    description: "",
    capacity: 100,
    sectionNames: ["TEMP"],
    layoutBlocks: [],
    createdAt: "2026-04-01T08:30:00Z",
    ...overrides
  };
}

function createMovement(overrides: Partial<Movement> = {}): Movement {
  return {
    id: 10,
    itemId: 1,
    inboundDocumentId: 1,
    inboundDocumentLineId: 1,
    outboundDocumentId: 0,
    outboundDocumentLineId: 0,
    itemName: "Widget",
    sku: "SKU-1",
    description: "Widget",
    customerId: 1,
    customerName: "Alpha Foods",
    locationName: "NJ",
    storageSection: "TEMP",
    movementType: "IN",
    quantityChange: 10,
    deliveryDate: "2026-04-10T00:00:00Z",
    containerNo: "CONT-A",
    packingListNo: "",
    orderRef: "",
    itemNumber: "ITEM-1",
    expectedQty: 10,
    receivedQty: 10,
    pallets: 1,
    palletsDetailCtns: "",
    cartonSizeMm: "",
    cartonCount: 0,
    unitLabel: "CTN",
    netWeightKgs: 0,
    grossWeightKgs: 0,
    heightIn: 0,
    outDate: null,
    documentNote: "",
    reason: "",
    referenceCode: "",
    createdAt: "2026-04-10T08:30:00Z",
    ...overrides
  };
}
