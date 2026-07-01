import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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
  createOutboundDocument: ReturnType<typeof vi.fn>;
  updateOutboundDocument: ReturnType<typeof vi.fn>;
  updateOutboundDocumentNote: ReturnType<typeof vi.fn>;
  copyOutboundDocument: ReturnType<typeof vi.fn>;
};

const OUTBOUND_HEADER_DEFAULTS_STORAGE_KEY = "sim-outbound-shipment-editor-defaults";

function getShipmentLineWarehouseInputs() {
  return Array.from(document.querySelectorAll('select[id^="shipment-editor-warehouse-"]')) as HTMLSelectElement[];
}

function getShipmentLineSkuInputs() {
  return Array.from(document.querySelectorAll('input[id^="shipment-editor-sku-"]')) as HTMLInputElement[];
}

function getShipmentLineQuantityInputs() {
  return Array.from(document.querySelectorAll('input[id^="shipment-editor-quantity-"]')) as HTMLInputElement[];
}

function getShipmentLinePalletInputs() {
  return Array.from(document.querySelectorAll('input[id^="shipment-editor-pallets-"]')) as HTMLInputElement[];
}

function selectShipmentLineSource(lineIndex = 0, sku = "608333", warehouseId = "1") {
  fireEvent.change(getShipmentLineSkuInputs()[lineIndex], { target: { value: sku } });
  fireEvent.change(getShipmentLineWarehouseInputs()[lineIndex], { target: { value: warehouseId } });
}

function confirmShipmentReview() {
  fireEvent.click(screen.getByRole("checkbox", { name: /I confirm the warehouse/i }));
}

function submitShipmentForm() {
  fireEvent.click(screen.getByRole("button", { name: /Schedule Shipment|Save Changes/ }));
}

function expandPickContainer(containerNo: string) {
  fireEvent.click(screen.getByRole("button", { name: `Details: ${containerNo}` }));
}

describe("OutboundShipmentEditorPage", () => {
  beforeEach(() => {
    mockedApi.createOutboundDocument.mockReset();
    mockedApi.updateOutboundDocument.mockReset();
    mockedApi.updateOutboundDocumentNote.mockReset();
    mockedApi.copyOutboundDocument.mockReset();
    window.sessionStorage.clear();
  });

  it("saves a new shipment with item bucket allocations and independent pallet count", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onBackToList = vi.fn();
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
        items={[createItem({ id: 1, availableQty: 10, quantity: 10, pallets: 4, containerNo: "GCXU5817233" })]}
        skuMasters={[createSkuMaster({ defaultUnitsPerPallet: 4 })]}
        movements={[createMovement()]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={onRefresh}
        onBackToList={onBackToList}
        onOpenOutboundDocument={onOpenOutboundDocument}
        onOpenShipmentEditor={onOpenShipmentEditor}
      />
    );

    selectShipmentLineSource();
    fireEvent.change(getShipmentLineQuantityInputs()[0], { target: { value: "5" } });
    fireEvent.change(getShipmentLinePalletInputs()[0], { target: { value: "2" } });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expandPickContainer("GCXU5817233");
    await waitFor(() => {
      expect(screen.getAllByText("Source Container:").length).toBeGreaterThan(0);
      expect(screen.getAllByText("GCXU5817233").length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    confirmShipmentReview();
    submitShipmentForm();

    await waitFor(() => {
      expect(mockedApi.createOutboundDocument).toHaveBeenCalledTimes(1);
    });

    const payload = mockedApi.createOutboundDocument.mock.calls[0][0];
    expect(payload).toMatchObject({
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
      documentNote: undefined
    });
    expect(payload.lines).toHaveLength(1);
    expect(payload.lines[0]).toMatchObject({
      customerId: 1,
      locationId: 1,
      skuMasterId: 1,
      quantity: 5,
      pallets: 2,
      palletsDetailCtns: undefined,
      unitLabel: "CTN",
      cartonSizeMm: undefined,
      netWeightKgs: 0,
      grossWeightKgs: 0,
      lineNote: undefined
    });
    expect(payload.lines[0]).not.toHaveProperty("pickAllocations");
    expect(payload.lines[0]).not.toHaveProperty("pickPallets");
    expect(onRefresh).toHaveBeenCalled();
    expect(onBackToList).toHaveBeenCalledTimes(1);
    expect(onOpenShipmentEditor).not.toHaveBeenCalled();
    expect(onOpenOutboundDocument).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(OUTBOUND_HEADER_DEFAULTS_STORAGE_KEY)).toBeNull();
  });

  it("allocates duplicate source lines across item buckets before submit", async () => {
    mockedApi.createOutboundDocument.mockResolvedValue(createOutboundDocument({
      id: 103,
      status: "DRAFT",
      trackingStatus: "SCHEDULED"
    }));

    renderWithProviders(
      <OutboundShipmentEditorPage
        routeKey="/outbound-management/new"
        documentId={null}
        document={null}
        items={[
          createItem({ id: 1, availableQty: 5, quantity: 5, pallets: 1, containerNo: "GCXU5817233" }),
          createItem({ id: 2, availableQty: 5, quantity: 5, pallets: 1, containerNo: "GCXU5817234" })
        ]}
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

    fireEvent.click(screen.getByRole("button", { name: "Add Outbound Line" }));

    selectShipmentLineSource(0);
    fireEvent.change(getShipmentLineQuantityInputs()[0], { target: { value: "5" } });
    fireEvent.change(getShipmentLinePalletInputs()[0], { target: { value: "1" } });

    selectShipmentLineSource(1);
    fireEvent.change(getShipmentLineQuantityInputs()[1], { target: { value: "5" } });
    fireEvent.change(getShipmentLinePalletInputs()[1], { target: { value: "1" } });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Details" })).toHaveLength(2);
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    confirmShipmentReview();
    submitShipmentForm();

    await waitFor(() => {
      expect(mockedApi.createOutboundDocument).toHaveBeenCalledTimes(1);
    });

    const payload = mockedApi.createOutboundDocument.mock.calls[0][0];
    expect(payload.lines).toHaveLength(2);
    expect(payload.lines[0]).not.toHaveProperty("pickAllocations");
    expect(payload.lines[1]).not.toHaveProperty("pickAllocations");
    expect(payload.lines[0]).not.toHaveProperty("pickPallets");
    expect(payload.lines[1]).not.toHaveProperty("pickPallets");
  });

  it("ignores browser session shipment drafts and starts from the source state", () => {
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

    const headerInputs = document.querySelectorAll(".sheet-form input");
    expect((headerInputs[0] as HTMLInputElement).value).toBe("");
    expect(screen.queryByDisplayValue("Draft Receiver")).not.toBeInTheDocument();
  });

  it("prefills shipment header details from remembered session defaults for a new shipment", () => {
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

    fireEvent.change(screen.getByLabelText("Ship-to Name"), { target: { value: "Receiver A" } });
    fireEvent.change(screen.getByLabelText("Ship-to Address"), { target: { value: "12 Dock Road" } });
    fireEvent.change(screen.getByLabelText("Ship-to Contact"), { target: { value: "201-555-1000" } });
    fireEvent.change(screen.getByLabelText("Carrier"), { target: { value: "FedEx Freight" } });
    selectShipmentLineSource();
    fireEvent.change(getShipmentLineQuantityInputs()[0], { target: { value: "5" } });
    fireEvent.change(getShipmentLinePalletInputs()[0], { target: { value: "1" } });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    confirmShipmentReview();
    submitShipmentForm();

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

  it("auto-fills expected ship date when actual ship date is entered first", () => {
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

    const expectedShipInput = screen.getByLabelText("Expected Ship Date") as HTMLInputElement;
    const actualShipInput = screen.getByLabelText("Actual Ship Date") as HTMLInputElement;

    fireEvent.change(actualShipInput, { target: { value: "2026-04-03" } });

    expect(actualShipInput.value).toBe("2026-04-03");
    expect(expectedShipInput.value).toBe("2026-04-03");
  });

  it("filters warehouse choices by sku before quantity entry", () => {
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

    const warehouseSelect = getShipmentLineWarehouseInputs()[0];
    const skuSelect = getShipmentLineSkuInputs()[0];
    const quantityInput = getShipmentLineQuantityInputs()[0];
    const palletInput = getShipmentLinePalletInputs()[0];
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
    expect(screen.getByText("Enter pallet count.")).toBeInTheDocument();
    expect(nextButton).toBeDisabled();

    fireEvent.change(palletInput, { target: { value: "1" } });
    await waitFor(() => {
      expect(nextButton).not.toBeDisabled();
    });

    fireEvent.change(quantityInput, { target: { value: "5" } });

    await waitFor(() => {
      expect(nextButton).not.toBeDisabled();
    });
  });

  it("starts a newly added outbound line at sku entry", async () => {
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
    renderWithProviders(
      <OutboundShipmentEditorPage
        routeKey="/outbound-management/new"
        documentId={null}
        document={null}
        items={[
          createItem({ id: 1, availableQty: 3, quantity: 3, pallets: 1, containerNo: "GCXU5817233" }),
          createItem({ id: 2, availableQty: 10, quantity: 10, pallets: 1, containerNo: "GCXU5817234" })
        ]}
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

    selectShipmentLineSource();
    fireEvent.change(getShipmentLineQuantityInputs()[0], { target: { value: "5" } });
    fireEvent.change(getShipmentLinePalletInputs()[0], { target: { value: "2" } });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.queryByText("Final Shipment Confirmation")).not.toBeInTheDocument();
    expect(screen.queryByText("Warehouse / Container Summary")).not.toBeInTheDocument();
    expect(screen.queryByText("Ready to Confirm")).not.toBeInTheDocument();
    const finalSummary = screen.getByTestId("shipment-final-summary");
    expect(within(finalSummary).getByText("Warehouses: 1")).toBeInTheDocument();
    expect(within(finalSummary).getByText("Containers: 2")).toBeInTheDocument();
    expect(within(finalSummary).getByText(/Pallets:\s*2/i)).toBeInTheDocument();
    expect(within(finalSummary).getByText("Selected Qty: 5")).toBeInTheDocument();
    expect(screen.getAllByText("Warehouses: 1")).toHaveLength(1);
    expect(screen.getAllByText("Containers: 2")).toHaveLength(1);
    expect(screen.getAllByText(/Pallets:\s*2/i)).toHaveLength(1);
    expect(screen.getAllByText("Selected Qty: 5")).toHaveLength(1);
    expect(screen.getByText("GCXU5817233: 3")).toBeInTheDocument();
    expect(screen.getByText("GCXU5817234: 2")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-data-grid")).not.toBeInTheDocument();

    const scheduleShipmentButtons = screen.getAllByRole("button", { name: "Schedule Shipment" });
    const scheduleShipmentButton = scheduleShipmentButtons[scheduleShipmentButtons.length - 1] as HTMLButtonElement;
    expect(scheduleShipmentButton).toBeDisabled();

    confirmShipmentReview();
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

  it("locks the re-enter action while copying a confirmed shipment", () => {
    mockedApi.copyOutboundDocument.mockImplementation(() => new Promise(() => {}));

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

    const reEnterButton = screen.getAllByRole("button", { name: /Re-enter Shipment|reEnterShipment/ })[0] as HTMLButtonElement;

    fireEvent.click(reEnterButton);

    expect(reEnterButton).toBeDisabled();
    expect(reEnterButton).toHaveAttribute("aria-busy", "true");
    expect(mockedApi.copyOutboundDocument).toHaveBeenCalledWith(12);
  });

  it("renders confirmed shipment notes as read-only without a standalone save button", () => {
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

    expect(screen.getByText("Confirmed shipment details are locked.")).toBeInTheDocument();
    expect(screen.getByLabelText("Document Notes")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save Note" })).not.toBeInTheDocument();
    expect(mockedApi.updateOutboundDocumentNote).not.toHaveBeenCalled();
  });

  it("loads persisted pick allocations for a draft shipment without legacy picks", async () => {
    mockedApi.updateOutboundDocument.mockResolvedValue(createOutboundDocument({
      id: 42,
      status: "DRAFT",
      trackingStatus: "SCHEDULED"
    }));

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
              pickAllocations: [
                {
                  id: 9901,
                  lineId: 4201,
                  itemNumber: "608333",
                  locationId: 1,
                  locationName: "NJ",
                  storageSection: "TEMP",
                  containerNo: "GCXU5817233",
                  allocatedQty: 5,
                  pallets: 1,
                  createdAt: "2026-03-24T10:00:00Z"
                }
              ]
            })
          ]
        })}
        items={[]}
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

    expect(getShipmentLineQuantityInputs()[0].value).toBe("5");
    expect(getShipmentLinePalletInputs()[0].value).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    confirmShipmentReview();
    submitShipmentForm();

    await waitFor(() => {
      expect(mockedApi.updateOutboundDocument).toHaveBeenCalledTimes(1);
    });

    const payload = mockedApi.updateOutboundDocument.mock.calls[0][1];
    expect(payload.lines[0]).not.toHaveProperty("pickAllocations");
    expect(payload.lines[0]).not.toHaveProperty("pickPallets");
  });
});
