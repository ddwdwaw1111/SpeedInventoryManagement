import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./ui/dataGridCompat", () => ({
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
    getPallets: vi.fn(),
    createOutboundDocument: vi.fn(),
    updateOutboundDocument: vi.fn(),
    updateOutboundDocumentNote: vi.fn(),
    copyOutboundDocument: vi.fn()
  }
}));

import { api } from "../lib/api";
import { renderWithProviders } from "../test/renderWithProviders";
import { createItem, createMovement, createOutboundDocument, createOutboundDocumentLine, createSkuMaster } from "../test/fixtures";
import { OutboundShipmentEditorPage } from "./OutboundShipmentEditorPage";

const mockedApi = api as unknown as {
  getPallets: ReturnType<typeof vi.fn>;
  createOutboundDocument: ReturnType<typeof vi.fn>;
  updateOutboundDocument: ReturnType<typeof vi.fn>;
  updateOutboundDocumentNote: ReturnType<typeof vi.fn>;
  copyOutboundDocument: ReturnType<typeof vi.fn>;
};

const OUTBOUND_HEADER_DEFAULTS_STORAGE_KEY = "sim-outbound-shipment-editor-defaults";
const LIVE_PALLET_LOADING_MESSAGE = "Live pallet inventory is still loading. Shipment allocation will unlock once pallet data is ready.";

function createOutboundPalletTrace(overrides?: Partial<{
  palletId: number;
  contentId: number;
  containerNo: string;
  quantity: number;
  skuMasterId: number;
  sku: string;
  itemNumber: string;
  description: string;
  locationId: number;
  locationName: string;
}>){
  const palletId = overrides?.palletId ?? 501;
  const contentId = overrides?.contentId ?? (palletId + 100);
  const skuMasterId = overrides?.skuMasterId ?? 1;
  const sku = overrides?.sku ?? "608333";
  const itemNumber = overrides?.itemNumber ?? sku;
  const description = overrides?.description ?? "VB22GC";
  const quantity = overrides?.quantity ?? 10;
  const containerNo = overrides?.containerNo ?? "GCXU5817233";
  const locationId = overrides?.locationId ?? 1;
  const locationName = overrides?.locationName ?? "NJ";

  return {
    id: palletId,
    parentPalletId: 0,
    palletCode: `PLT-${palletId}`,
    containerVisitId: 1,
    sourceInboundDocumentId: 1,
    sourceInboundLineId: 1,
    actualArrivalDate: "2026-03-24",
    customerId: 1,
    customerName: "Imperial Bag & Paper",
    skuMasterId,
    sku,
    description,
    currentLocationId: locationId,
    currentLocationName: locationName,
    currentStorageSection: "TEMP",
    currentContainerNo: containerNo,
    containerType: "NORMAL" as const,
    status: "OPEN" as const,
    createdAt: "2026-03-24T10:00:00Z",
    updatedAt: "2026-03-24T10:00:00Z",
    contents: [
      {
        id: contentId,
        palletId,
        skuMasterId,
        itemNumber,
        sku,
        description,
        quantity,
        allocatedQty: 0,
        damagedQty: 0,
        holdQty: 0,
        createdAt: "2026-03-24T10:00:00Z",
        updatedAt: "2026-03-24T10:00:00Z"
      }
    ]
  };
}

async function waitForOutboundPalletsToLoad() {
  await waitFor(() => {
    expect(mockedApi.getPallets).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(LIVE_PALLET_LOADING_MESSAGE)).not.toBeInTheDocument();
  });
}

function getShipmentLineWarehouseInputs() {
  return Array.from(document.querySelectorAll('select[id^="shipment-editor-warehouse-"]')) as HTMLSelectElement[];
}

function getShipmentLineSkuInputs() {
  return Array.from(document.querySelectorAll('input[id^="shipment-editor-sku-"]')) as HTMLInputElement[];
}

function getShipmentLineQuantityInputs() {
  return Array.from(document.querySelectorAll('input[id^="shipment-editor-quantity-"]')) as HTMLInputElement[];
}

function selectShipmentLineSource(lineIndex = 0, sku = "608333", warehouseId = "1") {
  fireEvent.change(getShipmentLineSkuInputs()[lineIndex], { target: { value: sku } });
  fireEvent.change(getShipmentLineWarehouseInputs()[lineIndex], { target: { value: warehouseId } });
}

function confirmShipmentReview() {
  fireEvent.click(screen.getByRole("checkbox", { name: /I confirm the warehouse/i }));
}

function expandPickContainer(containerNo: string) {
  fireEvent.click(screen.getByRole("button", { name: `Details: ${containerNo}` }));
}

describe("OutboundShipmentEditorPage", () => {
  beforeEach(() => {
    mockedApi.getPallets.mockReset();
    mockedApi.createOutboundDocument.mockReset();
    mockedApi.updateOutboundDocument.mockReset();
    mockedApi.updateOutboundDocumentNote.mockReset();
    mockedApi.copyOutboundDocument.mockReset();
    window.sessionStorage.clear();
  });

  it("saves a new shipment as a server draft and returns to the shipment list", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onBackToList = vi.fn();
    const onOpenShipmentEditor = vi.fn();
    const onOpenOutboundDocument = vi.fn();

    mockedApi.createOutboundDocument.mockResolvedValue(createOutboundDocument({
      id: 99,
      status: "DRAFT",
      trackingStatus: "SCHEDULED"
    }));
    mockedApi.getPallets.mockResolvedValue([createOutboundPalletTrace()]);

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
        onBackToList={onBackToList}
        onOpenOutboundDocument={onOpenOutboundDocument}
        onOpenShipmentEditor={onOpenShipmentEditor}
      />
    );

    await waitForOutboundPalletsToLoad();
    selectShipmentLineSource();
    fireEvent.change(getShipmentLineQuantityInputs()[0], { target: { value: "5" } });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expandPickContainer("GCXU5817233");
    await waitFor(() => {
      expect(screen.getByText("PLT-501")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    confirmShipmentReview();
    fireEvent.click(screen.getByRole("button", { name: "Schedule Shipment" }));

    await waitFor(() => {
      expect(mockedApi.createOutboundDocument).toHaveBeenCalledWith({
        packingListNo: undefined,
        orderRef: undefined,
        expectedShipDate: undefined,
        actualShipDate: undefined,
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
            lineNote: undefined,
            pickPallets: [{ palletId: 501, quantity: 5 }]
          }
        ]
      });
    });

    expect(onRefresh).toHaveBeenCalled();
    expect(onBackToList).toHaveBeenCalledTimes(1);
    expect(onOpenShipmentEditor).not.toHaveBeenCalled();
    expect(onOpenOutboundDocument).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(OUTBOUND_HEADER_DEFAULTS_STORAGE_KEY)).toBeNull();
  });

  it("uses picked pallets instead of sku defaults when a partial pallet ships", async () => {
    mockedApi.createOutboundDocument.mockResolvedValue(createOutboundDocument({
      id: 101,
      status: "DRAFT",
      trackingStatus: "SCHEDULED"
    }));
    mockedApi.getPallets.mockResolvedValue([createOutboundPalletTrace()]);

    renderWithProviders(
      <OutboundShipmentEditorPage
        routeKey="/outbound-management/new"
        documentId={null}
        document={null}
        items={[createItem({ id: 1, availableQty: 10, quantity: 10, containerNo: "GCXU5817233" })]}
        skuMasters={[createSkuMaster({ defaultUnitsPerPallet: 4 })]}
        movements={[createMovement()]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onBackToList={vi.fn()}
        onOpenOutboundDocument={vi.fn()}
        onOpenShipmentEditor={vi.fn()}
      />
    );

    await waitForOutboundPalletsToLoad();
    selectShipmentLineSource();
    fireEvent.change(getShipmentLineQuantityInputs()[0], { target: { value: "5" } });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expandPickContainer("GCXU5817233");
    await waitFor(() => {
      expect(screen.getByText("PLT-501")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    confirmShipmentReview();
    fireEvent.click(screen.getByRole("button", { name: "Schedule Shipment" }));

    await waitFor(() => {
      expect(mockedApi.createOutboundDocument).toHaveBeenCalledTimes(1);
    });

    const payload = mockedApi.createOutboundDocument.mock.calls[0][0];
    expect(payload.lines[0]).toMatchObject({
      quantity: 5,
      pallets: 1,
      pickPallets: [{ palletId: 501, quantity: 5 }]
    });
  });

  it("blocks shipment allocation until live pallets finish loading", async () => {
    mockedApi.getPallets.mockImplementation(() => new Promise(() => {}));

    renderWithProviders(
      <OutboundShipmentEditorPage
        routeKey="/outbound-management/42"
        documentId={42}
        document={createOutboundDocument({
          id: 42,
          status: "DRAFT",
          trackingStatus: "SCHEDULED",
          lines: [
            createOutboundDocumentLine({
              id: 4201,
              documentId: 42,
              quantity: 5,
              pallets: 1,
              pickPallets: [{ palletId: 501, quantity: 5 }]
            })
          ]
        })}
        items={[createItem({ id: 1, quantity: 10, availableQty: 10, containerNo: "GCXU5817233" })]}
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

    expect(screen.getByText("Live pallet inventory is still loading. Shipment allocation will unlock once pallet data is ready.")).toBeInTheDocument();
    expect(screen.queryByText(/Outbound quantity for SKU 608333 exceeds available stock/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("rebalances auto picks across duplicate source lines before submit", async () => {
    mockedApi.createOutboundDocument.mockResolvedValue(createOutboundDocument({
      id: 103,
      status: "DRAFT",
      trackingStatus: "SCHEDULED"
    }));
    mockedApi.getPallets.mockResolvedValue([
      createOutboundPalletTrace({ quantity: 5 }),
      createOutboundPalletTrace({ palletId: 502, contentId: 602, containerNo: "GCXU5817234", quantity: 5 })
    ]);

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
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onBackToList={vi.fn()}
        onOpenOutboundDocument={vi.fn()}
        onOpenShipmentEditor={vi.fn()}
      />
    );

    await waitForOutboundPalletsToLoad();
    fireEvent.click(screen.getByRole("button", { name: "Add Outbound Line" }));

    const qtyInputs = getShipmentLineQuantityInputs();

    selectShipmentLineSource(0);
    fireEvent.change(qtyInputs[0], { target: { value: "5" } });

    selectShipmentLineSource(1);
    fireEvent.change(qtyInputs[1], { target: { value: "5" } });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Details" })).toHaveLength(2);
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    confirmShipmentReview();
    fireEvent.click(screen.getByRole("button", { name: "Schedule Shipment" }));

    await waitFor(() => {
      expect(mockedApi.createOutboundDocument).toHaveBeenCalledTimes(1);
    });

    const payload = mockedApi.createOutboundDocument.mock.calls[0][0];
    expect(payload.lines).toHaveLength(2);
    expect(payload.lines[0].pickPallets).toEqual([{ palletId: 501, quantity: 5 }]);
    expect(payload.lines[1].pickPallets).toEqual([{ palletId: 502, quantity: 5 }]);
  });

  it("ignores browser session shipment drafts and starts from the source state", async () => {
    mockedApi.getPallets.mockResolvedValue([createOutboundPalletTrace()]);
    window.sessionStorage.setItem("sim-outbound-shipment-editor-draft:new", JSON.stringify({
      version: 1,
      form: {
        packingListNo: "PL-LOCAL-01",
        orderRef: "SO-LOCAL-01",
        expectedShipDate: "2026-04-02",
        actualShipDate: "",
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

    await waitForOutboundPalletsToLoad();
    const headerInputs = document.querySelectorAll(".sheet-form input");
    expect((headerInputs[0] as HTMLInputElement).value).toBe("");
    expect(screen.queryByDisplayValue("Draft Receiver")).not.toBeInTheDocument();
  });

  it("prefills shipment header details from remembered session defaults for a new shipment", async () => {
    mockedApi.getPallets.mockResolvedValue([]);
    window.sessionStorage.setItem(OUTBOUND_HEADER_DEFAULTS_STORAGE_KEY, JSON.stringify({
      shipToName: "Remembered Receiver",
      shipToAddress: "900 Harbor Ave",
      shipToContact: "201-555-0001",
      carrierName: "Remembered Carrier"
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

    await waitForOutboundPalletsToLoad();
    expect((screen.getByLabelText("Ship-to Name") as HTMLInputElement).value).toBe("Remembered Receiver");
    expect((screen.getByLabelText("Ship-to Address") as HTMLInputElement).value).toBe("900 Harbor Ave");
    expect((screen.getByLabelText("Ship-to Contact") as HTMLInputElement).value).toBe("201-555-0001");
    expect((screen.getByLabelText("Carrier") as HTMLInputElement).value).toBe("Remembered Carrier");
    expect(screen.getByText("Last shipment contact and carrier details were filled for this session.")).toBeInTheDocument();
  });

  it("stores ship-to and carrier details after saving a shipment for reuse in the same session", async () => {
    mockedApi.createOutboundDocument.mockResolvedValue(createOutboundDocument({
      id: 102,
      status: "DRAFT",
      trackingStatus: "SCHEDULED"
    }));
    mockedApi.getPallets.mockResolvedValue([createOutboundPalletTrace()]);

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
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onBackToList={vi.fn()}
        onOpenOutboundDocument={vi.fn()}
        onOpenShipmentEditor={vi.fn()}
      />
    );

    await waitForOutboundPalletsToLoad();
    fireEvent.change(screen.getByLabelText("Ship-to Name"), { target: { value: "Receiver A" } });
    fireEvent.change(screen.getByLabelText("Ship-to Address"), { target: { value: "12 Dock Road" } });
    fireEvent.change(screen.getByLabelText("Ship-to Contact"), { target: { value: "201-555-1000" } });
    fireEvent.change(screen.getByLabelText("Carrier"), { target: { value: "FedEx Freight" } });
    selectShipmentLineSource();
    fireEvent.change(getShipmentLineQuantityInputs()[0], { target: { value: "5" } });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    confirmShipmentReview();
    fireEvent.click(screen.getByRole("button", { name: "Schedule Shipment" }));

    await waitFor(() => {
      expect(window.sessionStorage.getItem(OUTBOUND_HEADER_DEFAULTS_STORAGE_KEY)).toContain("Receiver A");
    });

    expect(JSON.parse(window.sessionStorage.getItem(OUTBOUND_HEADER_DEFAULTS_STORAGE_KEY) || "{}")).toEqual({
      shipToName: "Receiver A",
      shipToAddress: "12 Dock Road",
      shipToContact: "201-555-1000",
      carrierName: "FedEx Freight"
    });
  });

  it("auto-fills expected ship date when actual ship date is entered first", async () => {
    mockedApi.getPallets.mockResolvedValue([]);

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

    await waitForOutboundPalletsToLoad();
    const expectedShipInput = screen.getByLabelText("Expected Ship Date") as HTMLInputElement;
    const actualShipInput = screen.getByLabelText("Actual Ship Date") as HTMLInputElement;

    fireEvent.change(actualShipInput, { target: { value: "2026-04-03" } });

    expect(actualShipInput.value).toBe("2026-04-03");
    expect(expectedShipInput.value).toBe("2026-04-03");
  });

  it("lets manual pick mode choose from all pallet and container candidates", async () => {
    mockedApi.getPallets.mockResolvedValue([
      createOutboundPalletTrace(),
      createOutboundPalletTrace({ palletId: 503, contentId: 603 }),
      createOutboundPalletTrace({ palletId: 502, contentId: 602, containerNo: "GCXU5817234" })
    ]);

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
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onBackToList={vi.fn()}
        onOpenOutboundDocument={vi.fn()}
        onOpenShipmentEditor={vi.fn()}
      />
    );

    await waitForOutboundPalletsToLoad();
    expect(screen.queryByText("Create New Shipment")).not.toBeInTheDocument();
    expect(screen.queryByText("A dedicated shipping workspace with staged validation, pick-plan review, and safer draft handling.")).not.toBeInTheDocument();
    selectShipmentLineSource();
    fireEvent.change(getShipmentLineQuantityInputs()[0], { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    const manualPickButton = await screen.findByRole("button", { name: "Switch to Manual Pick" });
    fireEvent.click(manualPickButton);

    expect(screen.getByRole("button", { name: /Reset to Auto/i })).toBeInTheDocument();
    expect(screen.queryByText("Auto-pick is on. Review the pallets and quantities.")).not.toBeInTheDocument();
    const container533Checkbox = screen.getByRole("checkbox", { name: "Select Container: GCXU5817233" }) as HTMLInputElement;
    expect(container533Checkbox).toBeInTheDocument();
    await waitFor(() => {
      expect(container533Checkbox.checked).toBe(true);
      expect(container533Checkbox.indeterminate).toBe(false);
    });
    expect(screen.getByRole("checkbox", { name: "Select Container: GCXU5817234" })).toBeDisabled();
    expandPickContainer("GCXU5817233");
    expandPickContainer("GCXU5817234");
    expect(screen.getByText("PLT-501")).toBeInTheDocument();
    expect(screen.getByText("PLT-502")).toBeInTheDocument();
    expect(screen.getByText("GCXU5817234")).toBeInTheDocument();

    const pallet501Checkbox = screen.getByRole("checkbox", { name: "Select Pallet: PLT-501" }) as HTMLInputElement;

    expect(pallet501Checkbox.checked).toBe(true);

    fireEvent.click(container533Checkbox);

    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "Select Container: GCXU5817234" })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Container: GCXU5817234" }));

    expect((screen.getByLabelText("Pick Qty: PLT-502") as HTMLInputElement).value).toBe("5");

    fireEvent.change(screen.getByPlaceholderText("Search container or pallet"), { target: { value: "7234" } });

    expect(screen.queryByText("PLT-501")).not.toBeInTheDocument();
    expect(screen.getByText("PLT-502")).toBeInTheDocument();
  });

  it("preserves existing pallet quantities when selecting a container", async () => {
    mockedApi.getPallets.mockResolvedValue([
      createOutboundPalletTrace({ palletId: 501, contentId: 601, quantity: 10 }),
      createOutboundPalletTrace({ palletId: 503, contentId: 603, quantity: 10 })
    ]);

    renderWithProviders(
      <OutboundShipmentEditorPage
        routeKey="/outbound-management/new"
        documentId={null}
        document={null}
        items={[createItem({ id: 1, availableQty: 20, quantity: 20, containerNo: "GCXU5817233" })]}
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

    await waitForOutboundPalletsToLoad();
    selectShipmentLineSource();
    fireEvent.change(getShipmentLineQuantityInputs()[0], { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(await screen.findByRole("button", { name: "Switch to Manual Pick" }));
    expandPickContainer("GCXU5817233");

    const pallet501Checkbox = screen.getByRole("checkbox", { name: "Select Pallet: PLT-501" }) as HTMLInputElement;
    fireEvent.click(pallet501Checkbox);

    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "Select Pallet: PLT-503" })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Pallet: PLT-503" }));
    fireEvent.change(screen.getByLabelText("Pick Qty: PLT-503"), { target: { value: "3" } });

    const containerCheckbox = screen.getByRole("checkbox", { name: "Select Container: GCXU5817233" }) as HTMLInputElement;
    await waitFor(() => {
      expect(containerCheckbox.indeterminate).toBe(true);
    });

    fireEvent.click(containerCheckbox);

    await waitFor(() => {
      expect((screen.getByLabelText("Pick Qty: PLT-501") as HTMLInputElement).value).toBe("2");
      expect((screen.getByLabelText("Pick Qty: PLT-503") as HTMLInputElement).value).toBe("3");
    });
  });

  it("supports manual pick qty entry and slash-to-search in manual pick mode", async () => {
    mockedApi.getPallets.mockResolvedValue([
      {
        id: 501,
        parentPalletId: 0,
        palletCode: "PLT-501",
        containerVisitId: 1,
        sourceInboundDocumentId: 1,
        sourceInboundLineId: 1,
        actualArrivalDate: "2026-03-24",
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
        createdAt: "2026-03-24T10:00:00Z",
        updatedAt: "2026-03-24T10:00:00Z",
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
            createdAt: "2026-03-24T10:00:00Z",
            updatedAt: "2026-03-24T10:00:00Z"
          }
        ]
      },
      {
        id: 502,
        parentPalletId: 0,
        palletCode: "PLT-502",
        containerVisitId: 2,
        sourceInboundDocumentId: 2,
        sourceInboundLineId: 2,
        actualArrivalDate: "2026-03-25",
        customerId: 1,
        customerName: "Imperial Bag & Paper",
        skuMasterId: 1,
        sku: "608333",
        description: "VB22GC",
        currentLocationId: 1,
        currentLocationName: "NJ",
        currentStorageSection: "TEMP",
        currentContainerNo: "GCXU5817234",
        containerType: "NORMAL",
        status: "OPEN",
        createdAt: "2026-03-25T10:00:00Z",
        updatedAt: "2026-03-25T10:00:00Z",
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
            createdAt: "2026-03-25T10:00:00Z",
            updatedAt: "2026-03-25T10:00:00Z"
          }
        ]
      },
      {
        id: 503,
        parentPalletId: 0,
        palletCode: "PLT-503",
        containerVisitId: 3,
        sourceInboundDocumentId: 3,
        sourceInboundLineId: 3,
        actualArrivalDate: "2026-03-26",
        customerId: 1,
        customerName: "Imperial Bag & Paper",
        skuMasterId: 1,
        sku: "608333",
        description: "VB22GC",
        currentLocationId: 1,
        currentLocationName: "NJ",
        currentStorageSection: "TEMP",
        currentContainerNo: "GCXU5817235",
        containerType: "NORMAL",
        status: "OPEN",
        createdAt: "2026-03-26T10:00:00Z",
        updatedAt: "2026-03-26T10:00:00Z",
        contents: [
          {
            id: 603,
            palletId: 503,
            skuMasterId: 1,
            itemNumber: "608333",
            sku: "608333",
            description: "VB22GC",
            quantity: 10,
            allocatedQty: 0,
            damagedQty: 0,
            holdQty: 0,
            createdAt: "2026-03-26T10:00:00Z",
            updatedAt: "2026-03-26T10:00:00Z"
          }
        ]
      }
    ]);

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
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onBackToList={vi.fn()}
        onOpenOutboundDocument={vi.fn()}
        onOpenShipmentEditor={vi.fn()}
      />
    );

    await waitForOutboundPalletsToLoad();
    selectShipmentLineSource();
    fireEvent.change(getShipmentLineQuantityInputs()[0], { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Switch to Manual Pick" }));

    expandPickContainer("GCXU5817233");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Pallet: PLT-501" }));

    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "Select Container: GCXU5817234" })).not.toBeDisabled();
    });

    expandPickContainer("GCXU5817234");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Pallet: PLT-502" }));
    fireEvent.change(screen.getByLabelText("Pick Qty: PLT-502"), { target: { value: "3" } });

    expandPickContainer("GCXU5817235");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Pallet: PLT-503" }));
    fireEvent.change(screen.getByLabelText("Pick Qty: PLT-503"), { target: { value: "3" } });

    expect((screen.getByLabelText("Pick Qty: PLT-503") as HTMLInputElement).value).toBe("3");

    fireEvent.keyDown(screen.getByRole("checkbox", { name: "Select Pallet: PLT-503" }), { key: "/" });

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByPlaceholderText("Search container or pallet"));
    });
  });

  it("filters warehouse choices by sku before quantity entry", async () => {
    mockedApi.getPallets.mockResolvedValue([
      createOutboundPalletTrace(),
      createOutboundPalletTrace({
        palletId: 502,
        contentId: 602,
        locationId: 2,
        locationName: "LA",
        skuMasterId: 2,
        sku: "900001",
        itemNumber: "900001",
        description: "West Coast SKU",
        containerNo: "OOLU1234567"
      })
    ]);

    renderWithProviders(
      <OutboundShipmentEditorPage
        routeKey="/outbound-management/new"
        documentId={null}
        document={null}
        items={[
          createItem({ id: 1, skuMasterId: 1, locationId: 1, locationName: "NJ", sku: "608333", itemNumber: "608333", description: "VB22GC" }),
          createItem({ id: 2, skuMasterId: 2, locationId: 2, locationName: "LA", sku: "900001", itemNumber: "900001", description: "West Coast SKU" })
        ]}
        skuMasters={[createSkuMaster(), createSkuMaster({ id: 2, sku: "900001", itemNumber: "900001", description: "West Coast SKU" })]}
        movements={[createMovement()]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onBackToList={vi.fn()}
        onOpenOutboundDocument={vi.fn()}
        onOpenShipmentEditor={vi.fn()}
      />
    );

    await waitForOutboundPalletsToLoad();
    const warehouseSelect = getShipmentLineWarehouseInputs()[0];
    const skuSelect = getShipmentLineSkuInputs()[0];
    const quantityInput = getShipmentLineQuantityInputs()[0];

    expect(skuSelect.disabled).toBe(false);
    expect(warehouseSelect.disabled).toBe(true);
    expect(quantityInput.disabled).toBe(true);

    const initialSkuOptions = Array.from(document.querySelectorAll("datalist option")).map((option) => option.getAttribute("value") || "");
    expect(initialSkuOptions.some((option) => option.includes("West Coast SKU"))).toBe(true);
    expect(initialSkuOptions.some((option) => option.includes("VB22GC"))).toBe(true);

    fireEvent.change(skuSelect, { target: { value: "900001" } });

    expect(warehouseSelect.disabled).toBe(false);
    const warehouseOptions = Array.from(warehouseSelect.options).map((option) => option.textContent || "");
    expect(warehouseOptions.some((option) => option.includes("LA"))).toBe(true);
    expect(warehouseOptions.some((option) => option.includes("NJ"))).toBe(false);

    fireEvent.change(skuSelect, { target: { value: "NOT-A-SKU" } });
    expect(warehouseSelect.disabled).toBe(false);
    expect(quantityInput.disabled).toBe(true);

    fireEvent.change(skuSelect, { target: { value: "900001" } });
    fireEvent.change(warehouseSelect, { target: { value: "2" } });

    expect(quantityInput.disabled).toBe(false);
  });

  it("disables next until line validation passes and moves focus forward", async () => {
    mockedApi.getPallets.mockResolvedValue([createOutboundPalletTrace()]);

    renderWithProviders(
      <OutboundShipmentEditorPage
        routeKey="/outbound-management/new"
        documentId={null}
        document={null}
        items={[createItem({ id: 1, availableQty: 10, quantity: 10, locationId: 1, locationName: "NJ" })]}
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

    await waitForOutboundPalletsToLoad();
    const warehouseSelect = getShipmentLineWarehouseInputs()[0];
    const skuSelect = getShipmentLineSkuInputs()[0];
    const quantityInput = getShipmentLineQuantityInputs()[0];
    const nextButton = screen.getByRole("button", { name: "Next" });

    expect(nextButton).toBeDisabled();
    expect(warehouseSelect).toBeDisabled();

    fireEvent.change(skuSelect, { target: { value: "608333" } });

    await waitFor(() => {
      expect(document.activeElement).toBe(warehouseSelect);
    });

    fireEvent.change(warehouseSelect, { target: { value: "1" } });

    await waitFor(() => {
      expect(document.activeElement).toBe(quantityInput);
    });

    fireEvent.change(quantityInput, { target: { value: "0" } });

    expect(screen.getByText("Enter ship quantity.")).toBeInTheDocument();
    expect(nextButton).toBeDisabled();

    fireEvent.change(quantityInput, { target: { value: "12" } });

    expect(quantityInput.value).toBe("10");

    await waitFor(() => {
      expect(nextButton).not.toBeDisabled();
    });

    fireEvent.change(quantityInput, { target: { value: "5" } });

    await waitFor(() => {
      expect(nextButton).not.toBeDisabled();
    });
  });

  it("starts a newly added outbound line at sku entry", async () => {
    mockedApi.getPallets.mockResolvedValue([createOutboundPalletTrace()]);

    renderWithProviders(
      <OutboundShipmentEditorPage
        routeKey="/outbound-management/new"
        documentId={null}
        document={null}
        items={[createItem({ id: 1, availableQty: 10, quantity: 10, locationId: 1, locationName: "NJ" })]}
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

    await waitForOutboundPalletsToLoad();
    selectShipmentLineSource();
    fireEvent.click(screen.getByRole("button", { name: "Add Outbound Line" }));

    await waitFor(() => {
      const warehouseSelects = getShipmentLineWarehouseInputs();
      const skuInputs = getShipmentLineSkuInputs();
      expect(warehouseSelects).toHaveLength(2);
      expect(warehouseSelects[1].value).toBe("");
      expect(warehouseSelects[1]).toBeDisabled();
      expect(document.activeElement).toBe(skuInputs[1]);
    });
  });

  it("requires a final confirmation check before posting the shipment", async () => {
    mockedApi.getPallets.mockResolvedValue([
      createOutboundPalletTrace({ quantity: 3 }),
      createOutboundPalletTrace({ palletId: 502, contentId: 602, quantity: 10 })
    ]);

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
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onBackToList={vi.fn()}
        onOpenOutboundDocument={vi.fn()}
        onOpenShipmentEditor={vi.fn()}
      />
    );

    await waitForOutboundPalletsToLoad();
    selectShipmentLineSource();
    fireEvent.change(getShipmentLineQuantityInputs()[0], { target: { value: "5" } });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.queryByText("Final Shipment Confirmation")).not.toBeInTheDocument();
    expect(screen.queryByText("Warehouse / Container Summary")).not.toBeInTheDocument();
    expect(screen.queryByText("Ready to Confirm")).not.toBeInTheDocument();
    expect(screen.queryByText("Review the shipment header, warehouse selection, picked pallets, and quantities one last time before posting this shipment.")).not.toBeInTheDocument();
    const finalSummary = screen.getByTestId("shipment-final-summary");
    expect(within(finalSummary).getByText("Warehouses: 1")).toBeInTheDocument();
    expect(within(finalSummary).getByText("Containers: 1")).toBeInTheDocument();
    expect(within(finalSummary).getByText(/Pallets:\s*2/i)).toBeInTheDocument();
    expect(within(finalSummary).getByText("Selected Qty: 5")).toBeInTheDocument();
    expect(screen.getAllByText("Warehouses: 1")).toHaveLength(1);
    expect(screen.getAllByText("Containers: 1")).toHaveLength(1);
    expect(screen.getAllByText(/Pallets:\s*2/i)).toHaveLength(1);
    expect(screen.getAllByText("Selected Qty: 5")).toHaveLength(1);
    expect(screen.getByText("GCXU5817233")).toBeInTheDocument();
    expect(screen.getByText("PLT-501: 3")).toBeInTheDocument();
    expect(screen.getByText("PLT-502: 2")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-data-grid")).not.toBeInTheDocument();

    const scheduleShipmentButtons = screen.getAllByRole("button", { name: "Schedule Shipment" });
    const scheduleShipmentButton = scheduleShipmentButtons[scheduleShipmentButtons.length - 1] as HTMLButtonElement;
    expect(scheduleShipmentButton).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox"));
    expect(scheduleShipmentButton).not.toBeDisabled();
  });

  it("re-enters confirmed shipments by copying them into a new draft", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onOpenShipmentEditor = vi.fn();

    mockedApi.copyOutboundDocument.mockResolvedValue(createOutboundDocument({
      id: 77,
      status: "DRAFT",
      trackingStatus: "SCHEDULED"
    }));
    mockedApi.getPallets.mockResolvedValue([]);

    renderWithProviders(
      <OutboundShipmentEditorPage
        routeKey="/outbound-management/12"
        documentId={12}
        document={createOutboundDocument({
          id: 12,
          status: "CONFIRMED",
          trackingStatus: "SHIPPED"
        })}
        items={[createItem({ id: 1, availableQty: 10, quantity: 10, containerNo: "GCXU5817233" })]}
        skuMasters={[createSkuMaster()]}
        movements={[createMovement()]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={onRefresh}
        onBackToList={vi.fn()}
        onOpenOutboundDocument={vi.fn()}
        onOpenShipmentEditor={onOpenShipmentEditor}
      />
    );

    await waitForOutboundPalletsToLoad();
    expect(screen.getByText("Confirmed shipment details are locked.")).toBeInTheDocument();
    expect(screen.queryByText("Review Confirmed Shipment")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Details" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /Re-enter Shipment|reEnterShipment/ })[0]);

    await waitFor(() => {
      expect(mockedApi.copyOutboundDocument).toHaveBeenCalledWith(12);
    });

    expect(onRefresh).toHaveBeenCalled();
    expect(onOpenShipmentEditor).toHaveBeenCalledWith(77);
  });

  it("locks the re-enter action while copying a confirmed shipment", async () => {
    mockedApi.copyOutboundDocument.mockImplementation(() => new Promise(() => {}));
    mockedApi.getPallets.mockResolvedValue([]);

    renderWithProviders(
      <OutboundShipmentEditorPage
        routeKey="/outbound-management/12"
        documentId={12}
        document={createOutboundDocument({
          id: 12,
          status: "CONFIRMED",
          trackingStatus: "SHIPPED"
        })}
        items={[createItem({ id: 1, availableQty: 10, quantity: 10, containerNo: "GCXU5817233" })]}
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

    await waitForOutboundPalletsToLoad();

    const reEnterButton = screen.getAllByRole("button", { name: /Re-enter Shipment|reEnterShipment/ })[0] as HTMLButtonElement;

    fireEvent.click(reEnterButton);

    expect(reEnterButton).toBeDisabled();
    expect(reEnterButton).toHaveAttribute("aria-busy", "true");
    expect(mockedApi.copyOutboundDocument).toHaveBeenCalledWith(12);
  });

  it("renders confirmed shipment notes as read-only without a standalone save button", async () => {
    mockedApi.getPallets.mockResolvedValue([]);

    renderWithProviders(
      <OutboundShipmentEditorPage
        routeKey="/outbound-management/12"
        documentId={12}
        document={createOutboundDocument({
          id: 12,
          status: "CONFIRMED",
          trackingStatus: "SHIPPED",
          documentNote: "Original confirmed note"
        })}
        items={[createItem({ id: 1, availableQty: 10, quantity: 10, containerNo: "GCXU5817233" })]}
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

    await waitForOutboundPalletsToLoad();
    expect(screen.getByText("Confirmed shipment details are locked.")).toBeInTheDocument();
    expect(screen.getByLabelText("Document Notes")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save Note" })).not.toBeInTheDocument();
    expect(mockedApi.updateOutboundDocumentNote).not.toHaveBeenCalled();
  });
});


