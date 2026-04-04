import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@mui/x-data-grid", () => ({
  DataGrid: ({
    rows = [],
    columns = []
  }: {
    rows?: Array<Record<string, unknown>>;
    columns?: Array<{
      field: string;
      renderCell?: (params: { row: Record<string, unknown>; value: unknown; field: string; id: unknown }) => React.ReactNode;
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

vi.mock("../lib/api", () => ({
  api: {
    createOutboundDocument: vi.fn(),
    updateOutboundDocument: vi.fn()
  }
}));

import { api } from "../lib/api";
import { renderWithProviders } from "../test/renderWithProviders";
import { createItem, createMovement, createOutboundDocument, createSkuMaster } from "../test/fixtures";
import { OutboundShipmentEditorPage } from "./OutboundShipmentEditorPage";

const mockedApi = api as unknown as {
  createOutboundDocument: ReturnType<typeof vi.fn>;
  updateOutboundDocument: ReturnType<typeof vi.fn>;
};

describe("OutboundShipmentEditorPage", () => {
  beforeEach(() => {
    mockedApi.createOutboundDocument.mockReset();
    mockedApi.updateOutboundDocument.mockReset();
    window.sessionStorage.clear();
  });

  it("saves a new shipment as a server draft and opens the edit route", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onOpenShipmentEditor = vi.fn();
    const onOpenOutboundDocument = vi.fn();

    mockedApi.createOutboundDocument.mockResolvedValue(createOutboundDocument({
      id: 99,
      status: "DRAFT",
      trackingStatus: "SCHEDULED"
    }));

    renderWithProviders(
      <OutboundShipmentEditorPage
        routeKey="/outbound-management/new"
        documentId={null}
        document={null}
        items={[createItem({ id: 1, availableQty: 10, quantity: 10, containerNo: "GCXU5817233" })]}
        skuMasters={[createSkuMaster()]}
        movements={[createMovement()]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={onRefresh}
        onBackToList={vi.fn()}
        onOpenOutboundDocument={onOpenOutboundDocument}
        onOpenShipmentEditor={onOpenShipmentEditor}
      />
    );

    const outboundLineSelect = document.querySelector(".batch-line-grid--outbound select");
    const outboundLineInputs = document.querySelectorAll(".batch-line-grid--outbound input");

    fireEvent.change(outboundLineSelect as HTMLSelectElement, { target: { value: "1|1|1" } });
    fireEvent.change(outboundLineInputs[1] as HTMLInputElement, { target: { value: "5" } });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Schedule Shipment" }));

    await waitFor(() => {
      expect(mockedApi.createOutboundDocument).toHaveBeenCalledWith({
        packingListNo: undefined,
        orderRef: undefined,
        outDate: undefined,
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
            pallets: 1,
            palletsDetailCtns: undefined,
            unitLabel: "CTN",
            cartonSizeMm: undefined,
            netWeightKgs: 0,
            grossWeightKgs: 0,
            lineNote: undefined
          }
        ]
      });
    });

    expect(onRefresh).toHaveBeenCalled();
    expect(onOpenShipmentEditor).toHaveBeenCalledWith(99);
    expect(onOpenOutboundDocument).not.toHaveBeenCalled();
  });

  it("restores and discards a local shipment draft", async () => {
    window.sessionStorage.setItem("sim-outbound-shipment-editor-draft:new", JSON.stringify({
      version: 1,
      form: {
        packingListNo: "PL-LOCAL-01",
        orderRef: "SO-LOCAL-01",
        outDate: "2026-04-02",
        shipToName: "Draft Receiver",
        shipToAddress: "Draft Address",
        shipToContact: "201-555-1111",
        carrierName: "Draft Carrier",
        documentNote: "draft shipment note"
      },
      lines: [
        {
          id: "line-1",
          sourceKey: "1|1|1",
          quantity: 4,
          pallets: 0,
          palletsDetailCtns: "",
          unitLabel: "CTN",
          cartonSizeMm: "",
          netWeightKgs: 0,
          grossWeightKgs: 0,
          reason: "draft line note"
        }
      ],
      step: 2
    }));

    renderWithProviders(
      <OutboundShipmentEditorPage
        routeKey="/outbound-management/new"
        documentId={null}
        document={null}
        items={[createItem({ id: 1, availableQty: 10, quantity: 10 })]}
        skuMasters={[createSkuMaster()]}
        movements={[createMovement()]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onBackToList={vi.fn()}
        onOpenOutboundDocument={vi.fn()}
        onOpenShipmentEditor={vi.fn()}
      />
    );

    expect(screen.getByText("Restored the unsaved shipment draft from this browser session.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "1 Shipment" }));
    const restoredHeaderInputs = document.querySelectorAll(".sheet-form input");
    expect((restoredHeaderInputs[0] as HTMLInputElement).value).toBe("PL-LOCAL-01");

    fireEvent.click(screen.getByRole("button", { name: "Discard local draft" }));

    await waitFor(() => {
      expect(screen.queryByText("Restored the unsaved shipment draft from this browser session.")).not.toBeInTheDocument();
    });

    const resetHeaderInputs = document.querySelectorAll(".sheet-form input");
    expect((resetHeaderInputs[0] as HTMLInputElement).value).toBe("");
    const savedResetDraft = JSON.parse(window.sessionStorage.getItem("sim-outbound-shipment-editor-draft:new") || "null");
    expect(savedResetDraft?.form?.packingListNo).toBe("");
  });
});