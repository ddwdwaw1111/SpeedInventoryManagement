import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  api: {
    getV2Containers: vi.fn(),
    getV2ContainerLifecycle: vi.fn(),
    updateV2ContainerMetadata: vi.fn()
  }
}));

vi.mock("./ContainerLifecycleView", () => ({
  ContainerLifecycleView: ({ lifecycle, sidePanel }: { lifecycle: ContainerLifecycle | null; sidePanel?: ReactNode }) => (
    <div>
      <div data-testid="receipt-list">
        {(lifecycle?.packingLists ?? []).map((document) => <span key={document.id}>{document.id}</span>)}
      </div>
      {sidePanel}
    </div>
  )
}));

import { api } from "../lib/api";
import type { ContainerLifecycle, ContainerLifecycleEvent, InboundDocument, OutboundDocument } from "../lib/types";
import { renderWithProviders } from "../test/renderWithProviders";
import { createCustomer, createLocation } from "../test/fixtures";
import {
  AdminContainerLifecyclePage,
  buildCurrentInventorySkuRows,
  buildOutboundOrderGoodsRows,
  buildReceivingSkuRows
} from "./AdminContainerLifecyclePage";

const mockedApi = api as unknown as {
  getV2Containers: ReturnType<typeof vi.fn>;
  getV2ContainerLifecycle: ReturnType<typeof vi.fn>;
  updateV2ContainerMetadata: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  mockedApi.getV2Containers.mockReset();
  mockedApi.getV2ContainerLifecycle.mockReset();
  mockedApi.updateV2ContainerMetadata.mockReset();
  mockedApi.getV2Containers.mockResolvedValue([]);
});

describe("AdminContainerLifecyclePage container metadata", () => {
  it("does not expose or submit receipt, location, or inventory status projections", async () => {
    const lifecycle = {
      container: {
        inboundDocumentId: 10,
        locationId: 7,
        containerType: "WEST_COAST_TRANSFER",
        handlingMode: "SEALED_TRANSIT",
        status: "DEPLETED",
        trackingStatus: "ARRIVED_PORT",
        lastEventAt: "2026-04-03T14:30:00Z"
      },
      summary: {
        containerNo: "CONT-1",
        customerId: 1,
        status: "DEPLETED",
        lastActivityAt: "2026-04-03T14:30:00Z"
      },
      packingLists: [
        { id: 10, locationId: 7, status: "CONFIRMED", lines: [] },
        { id: 11, locationId: 8, status: "CONFIRMED", lines: [] }
      ],
      pickingOrders: [],
      movements: [],
      lifecycleEvents: [],
      trackingEvents: [],
      pickupAssignments: [],
      deliveryEvents: []
    } as unknown as ContainerLifecycle;
    mockedApi.getV2ContainerLifecycle.mockResolvedValue(lifecycle);
    mockedApi.updateV2ContainerMetadata.mockResolvedValue(lifecycle.container);

    renderWithProviders(
      <AdminContainerLifecyclePage
        routeScope={{ customerId: 1, containerNo: "CONT-1" }}
        customers={[createCustomer()]}
        locations={[createLocation({ id: 7, name: "Warehouse 7" }), createLocation({ id: 8, name: "Warehouse 8" })]}
        onOpenContainerLifecycle={vi.fn()}
        onOpenContainerDetail={vi.fn()}
        onOpenInboundDetail={vi.fn()}
        onOpenReceiptEditor={vi.fn()}
        onOpenOutboundDocument={vi.fn()}
        onOpenShipmentEditor={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByLabelText("Container Type")).toHaveValue("WEST_COAST_TRANSFER"));

    expect(screen.queryByLabelText("Receipt Detail")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Warehouse")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Status")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Last Activity")).not.toBeInTheDocument();
    expect(screen.getByTestId("receipt-list").children).toHaveLength(2);

    fireEvent.change(screen.getByLabelText("Container Type"), { target: { value: "NORMAL" } });
    fireEvent.change(screen.getByLabelText("Handling Mode"), { target: { value: "PALLETIZED" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(mockedApi.updateV2ContainerMetadata).toHaveBeenCalledTimes(1));
    expect(mockedApi.updateV2ContainerMetadata).toHaveBeenCalledWith("CONT-1", {
      customerId: 1,
      containerType: "NORMAL",
      handlingMode: "PALLETIZED"
    });
    const payload = mockedApi.updateV2ContainerMetadata.mock.calls[0][1];
    expect(payload).not.toHaveProperty("inboundDocumentId");
    expect(payload).not.toHaveProperty("locationId");
    expect(payload).not.toHaveProperty("status");
    expect(payload).not.toHaveProperty("trackingStatus");
    expect(payload).not.toHaveProperty("lastEventAt");
  });

  it("shows receipt-derived metadata read-only until a container record exists", async () => {
    const lifecycle = {
      container: null,
      summary: {
        containerNo: "DRAFT-CONT-1",
        customerId: 1,
        status: "PENDING",
        lastActivityAt: "2026-04-03T14:30:00Z"
      },
      packingLists: [{
        id: 20,
        customerId: 1,
        locationId: 7,
        containerNo: "DRAFT-CONT-1",
        containerType: "WEST_COAST_TRANSFER",
        handlingMode: "SEALED_TRANSIT",
        status: "DRAFT",
        lines: []
      }],
      pickingOrders: [],
      movements: [],
      lifecycleEvents: [],
      trackingEvents: [],
      pickupAssignments: [],
      deliveryEvents: []
    } as unknown as ContainerLifecycle;
    mockedApi.getV2ContainerLifecycle.mockResolvedValue(lifecycle);

    renderWithProviders(
      <AdminContainerLifecyclePage
        routeScope={{ customerId: 1, containerNo: "DRAFT-CONT-1" }}
        customers={[createCustomer()]}
        locations={[createLocation({ id: 7, name: "Warehouse 7" })]}
        onOpenContainerLifecycle={vi.fn()}
        onOpenContainerDetail={vi.fn()}
        onOpenInboundDetail={vi.fn()}
        onOpenReceiptEditor={vi.fn()}
        onOpenOutboundDocument={vi.fn()}
        onOpenShipmentEditor={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByLabelText("Container Type")).toHaveValue("WEST_COAST_TRANSFER"));
    expect(screen.getByLabelText("Container Type")).toBeDisabled();
    expect(screen.getByLabelText("Handling Mode")).toHaveValue("SEALED_TRANSIT");
    expect(screen.getByLabelText("Handling Mode")).toBeDisabled();
    expect(screen.getByText(/metadata becomes editable after a receipt is confirmed/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Changes" })).not.toBeInTheDocument();
    expect(mockedApi.updateV2ContainerMetadata).not.toHaveBeenCalled();
  });
});

describe("buildReceivingSkuRows", () => {
  it("summarizes expected quantity, received pallets, received quantity, and shortage reason by sku", () => {
    const rows = buildReceivingSkuRows([
      {
        id: 10,
        documentNote: "Document shortage note",
        lines: [
          { sku: "SKU-A", expectedQty: 30, receivedQty: 24, pallets: 3, lineNote: "Missing cartons" },
          { sku: "SKU-A", expectedQty: 20, receivedQty: 20, pallets: 2, lineNote: "" },
          { sku: "SKU-B", expectedQty: 10, receivedQty: 12, pallets: 1, lineNote: "Extra cartons" }
        ]
      }
    ] as unknown as InboundDocument[]);

    expect(rows).toMatchObject([
      {
        sku: "SKU-A",
        expectedQuantity: 50,
        receivedPallets: 5,
        receivedQuantity: 44,
        shortageReason: "Missing cartons"
      },
      {
        sku: "SKU-B",
        expectedQuantity: 10,
        receivedPallets: 1,
        receivedQuantity: 12,
        shortageReason: ""
      }
    ]);
    expect(rows[0]).not.toHaveProperty("expectedPallets");
  });
});

describe("buildCurrentInventorySkuRows", () => {
  it("joins lifecycle Item Codes to their receiving SKU row", () => {
    const receivedRows = buildReceivingSkuRows([{
      id: 10,
      lines: [{
        sku: "SKU-A",
        itemNumber: "ITEM-001",
        expectedQty: 20,
        receivedQty: 20,
        pallets: 2
      }]
    }] as unknown as InboundDocument[]);
    const lifecycleEvents = [{
      id: 1,
      itemNumber: "ITEM-001",
      description: "Item A",
      quantityDelta: 20,
      palletDelta: 2,
      receivedQty: 20
    }] as unknown as ContainerLifecycleEvent[];

    expect(buildCurrentInventorySkuRows(lifecycleEvents, receivedRows)).toEqual([{
      sku: "SKU-A",
      pallets: 2,
      quantity: 20,
      referenceQuantity: 20
    }]);
  });
});

describe("buildOutboundOrderGoodsRows", () => {
  it("highlights only goods fulfilled by the current container", () => {
    const rows = buildOutboundOrderGoodsRows({
      id: 20,
      packingListNo: "PO-20",
      orderRef: "",
      lines: [
        {
          id: 1,
          sku: "SKU-A",
          itemNumber: "A",
          description: "Item A",
          quantity: 12,
          pallets: 1,
          pickAllocations: [
            { containerNo: "OTHER", allocatedQty: 12 }
          ]
        },
        {
          id: 2,
          sku: "SKU-B",
          itemNumber: "B",
          description: "Item B",
          quantity: 8,
          pallets: 2,
          pickAllocations: [
            { containerNo: "CNT-1", allocatedQty: 5 },
            { containerNo: "OTHER", allocatedQty: 3 }
          ]
        }
      ]
    } as unknown as OutboundDocument, "cnt-1");

    expect(rows).toMatchObject([
      { sku: "SKU-A", quantity: 12, allocatedQty: 0, highlighted: false },
      { sku: "SKU-B", quantity: 8, allocatedQty: 5, highlighted: true }
    ]);
  });

  it("falls back to highlighting all rows when old orders have no allocation data", () => {
    const rows = buildOutboundOrderGoodsRows({
      id: 21,
      packingListNo: "PO-21",
      orderRef: "",
      lines: [
        {
          id: 1,
          sku: "SKU-A",
          itemNumber: "A",
          description: "Item A",
          quantity: 12,
          pallets: 1,
          pickAllocations: []
        }
      ]
    } as unknown as OutboundDocument, "CNT-1");

    expect(rows).toMatchObject([
      { sku: "SKU-A", quantity: 12, allocatedQty: 12, highlighted: true }
    ]);
  });
});
