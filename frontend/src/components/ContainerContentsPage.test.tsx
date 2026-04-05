import type { ReactNode } from "react";
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@mui/x-data-grid", () => ({
  DataGrid: ({
    rows = [],
    columns = []
  }: {
    rows?: Array<Record<string, unknown>>;
    columns?: Array<{
      field: string;
      renderCell?: (params: { row: Record<string, unknown>; value: unknown; field: string; id: unknown }) => ReactNode;
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

import { formatDateTimeValue } from "../lib/dates";
import { renderWithProviders } from "../test/renderWithProviders";
import { createCustomer, createItem, createLocation, createMovement } from "../test/fixtures";
import { ContainerContentsPage } from "./ContainerContentsPage";

describe("ContainerContentsPage", () => {
  beforeEach(() => {
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
      />
    );

    const receivedLabel = formatDateTimeValue(receivedAt, "UTC");
    expect(screen.getByText(receivedLabel)).toBeInTheDocument();
    expect(screen.getAllByText("Not Shipped").length).toBeGreaterThan(0);
    expect(screen.queryByText(formatDateTimeValue(partialShipAt, "UTC"))).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View Detail GCXU5817233" }));

    expect(onOpenContainerDetail).toHaveBeenCalledWith("GCXU5817233");
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
      />
    );

    expect(screen.getByText(formatDateTimeValue(shippedAt, "UTC"))).toBeInTheDocument();
    expect(screen.queryByText("Not Shipped")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View Detail MRSU6884820" }));

    expect(onOpenContainerDetail).toHaveBeenCalledWith("MRSU6884820");
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
      />
    );

    expect(screen.getByText(formatDateTimeValue(actualRecordedAt, "UTC"))).toBeInTheDocument();
  });
});
