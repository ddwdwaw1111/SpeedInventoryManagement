import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  api: {
    createOutboundDocument: vi.fn(),
    updateOutboundDocument: vi.fn(),
    copyOutboundDocument: vi.fn()
  }
}));

import { api } from "../lib/api";
import { renderWithProviders } from "../test/renderWithProviders";
import { createItem, createLocation, createOutboundDocument, createOutboundDocumentLine, createOutboundSourceReference, createSkuMaster } from "../test/fixtures";
import { OutboundShipmentEditorPage } from "./OutboundShipmentEditorPage";

const mockedApi = api as unknown as {
  createOutboundDocument: ReturnType<typeof vi.fn>;
  updateOutboundDocument: ReturnType<typeof vi.fn>;
  copyOutboundDocument: ReturnType<typeof vi.fn>;
};

function renderEditor(options?: {
  documentId?: number | null;
  document?: ReturnType<typeof createOutboundDocument> | null;
  items?: ReturnType<typeof createItem>[];
  skuMasters?: ReturnType<typeof createSkuMaster>[];
  outboundSourceReferences?: ReturnType<typeof createOutboundSourceReference>[];
  locations?: ReturnType<typeof createLocation>[];
  onRefresh?: ReturnType<typeof vi.fn>;
  onBackToList?: ReturnType<typeof vi.fn>;
  onOpenOutboundDocument?: ReturnType<typeof vi.fn>;
  onOpenShipmentEditor?: ReturnType<typeof vi.fn>;
}) {
  const documentId = options?.documentId ?? null;
  const document = options?.document ?? null;
  const onRefresh = options?.onRefresh ?? vi.fn().mockResolvedValue(undefined);
  const onBackToList = options?.onBackToList ?? vi.fn();
  const onOpenOutboundDocument = options?.onOpenOutboundDocument ?? vi.fn();
  const onOpenShipmentEditor = options?.onOpenShipmentEditor ?? vi.fn();

  renderWithProviders(
    <OutboundShipmentEditorPage
      routeKey={documentId ? `/outbound-management/${documentId}/edit` : "/outbound-management/new"}
      documentId={documentId}
      document={document}
      items={options?.items ?? [createItem({ id: 1, quantity: 10, availableQty: 10, pallets: 4, containerNo: "GCXU5817233" })]}
      skuMasters={options?.skuMasters ?? [createSkuMaster()]}
      outboundSourceReferences={options?.outboundSourceReferences ?? [createOutboundSourceReference()]}
      locations={options?.locations ?? [createLocation()]}
      currentUserRole="admin"
      isLoading={false}
      onRefresh={onRefresh as () => Promise<void>}
      onBackToList={onBackToList}
      onOpenOutboundDocument={onOpenOutboundDocument}
      onOpenShipmentEditor={onOpenShipmentEditor}
    />
  );

  return { onRefresh, onBackToList, onOpenOutboundDocument, onOpenShipmentEditor };
}

function getSkuInputs() {
  return Array.from(document.querySelectorAll('input[id^="shipment-editor-sku-"]')) as HTMLInputElement[];
}

function getWarehouseInputs() {
  return Array.from(document.querySelectorAll('select[id^="shipment-editor-warehouse-"]')) as HTMLSelectElement[];
}

function getQuantityInputs() {
  return Array.from(document.querySelectorAll('input[id^="shipment-editor-quantity-"]')) as HTMLInputElement[];
}

function getPlannedQuantityInputs() {
  return Array.from(document.querySelectorAll('input[id^="shipment-editor-planned-quantity-"]')) as HTMLInputElement[];
}

function getPalletInputs() {
  return Array.from(document.querySelectorAll('input[aria-label^="Shipping Pallets #"]')) as HTMLInputElement[];
}

function sourceLabel(containerNo: string, sku = "608333", description = "VB22GC") {
  return `${sku} | ${sku} | Imperial Bag & Paper | ${containerNo} | ${description}`;
}

async function selectContainerSource(lineIndex: number, containerNo: string, warehouseId = "1", sku = "608333", description = "VB22GC") {
  fireEvent.change(getSkuInputs()[lineIndex], { target: { value: sourceLabel(containerNo, sku, description) } });
  await waitFor(() => expect(getWarehouseInputs()[lineIndex]).not.toBeDisabled());
  fireEvent.change(getWarehouseInputs()[lineIndex], { target: { value: warehouseId } });
  await waitFor(() => expect(getQuantityInputs()[lineIndex]).not.toBeDisabled());
}

function setLineQuantity(lineIndex: number, quantity: number) {
  fireEvent.change(getQuantityInputs()[lineIndex], { target: { value: String(quantity) } });
}

function setLinePallets(lineIndex: number, pallets: number) {
  fireEvent.change(getPalletInputs()[lineIndex], { target: { value: String(pallets) } });
}

const palletProfile = (ctnPerPallet: number, palletCount: number) => ({
  ctnPerPallet,
  palletCount,
  availablePallets: palletCount,
  allocatedPallets: 0,
  damagedPallets: 0,
  holdPallets: 0
});

async function submitReviewedDraft() {
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("Pick Allocations");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("checkbox", { name: /I confirm the Container/i }));
  fireEvent.click(screen.getByRole("button", { name: "Schedule Shipment" }));
}

describe("OutboundShipmentEditorPage container-centric flow", () => {
  beforeEach(() => {
    mockedApi.createOutboundDocument.mockReset();
    mockedApi.updateOutboundDocument.mockReset();
    mockedApi.copyOutboundDocument.mockReset();
    window.sessionStorage.clear();
  });

  it("saves a container allocation without exposing or submitting pallet entity IDs", async () => {
    mockedApi.createOutboundDocument.mockResolvedValue(createOutboundDocument({ id: 99, status: "DRAFT" }));
    const { onBackToList } = renderEditor({
      items: [createItem({
        id: 1,
        quantity: 10,
        availableQty: 10,
        pallets: 3,
        availablePallets: 3,
        containerNo: "GCXU5817233"
      })]
    });

    await selectContainerSource(0, "GCXU5817233");
    setLineQuantity(0, 5);
    setLinePallets(0, 2);
    await submitReviewedDraft();

    await waitFor(() => expect(mockedApi.createOutboundDocument).toHaveBeenCalledTimes(1));
    expect(mockedApi.createOutboundDocument.mock.calls[0][0].lines[0]).toEqual({
      customerId: 1,
      locationId: 1,
      skuMasterId: 1,
      quantity: 5,
      plannedQuantity: 5,
      actualQuantity: 5,
      pallets: 2,
      palletsDetailCtns: undefined,
      unitLabel: "CTN",
      cartonSizeMm: undefined,
      netWeightKgs: 0,
      grossWeightKgs: 0,
      lineNote: undefined,
      pickAllocations: [{
        itemNumber: "608333",
        locationId: 1,
        locationName: "NJ",
        storageSection: "TEMP",
        containerNo: "GCXU5817233",
        allocatedQty: 5,
        pallets: 0,
        inventoryPalletsUsed: 2,
        startingPallets: 3,
        remainingPallets: 3
      }]
    });
    expect(onBackToList).toHaveBeenCalledTimes(1);
  });

  it("keeps a planned line when actual quantity and shipping pallets are zero", async () => {
    mockedApi.createOutboundDocument.mockResolvedValue(createOutboundDocument({ id: 100, status: "DRAFT" }));
    renderEditor({ items: [] });

    expect(document.querySelectorAll('datalist[id^="shipment-editor-sku-options-"] option')).toHaveLength(0);
    await selectContainerSource(0, "-");
    fireEvent.change(getPlannedQuantityInputs()[0], { target: { value: "12" } });
    expect(getPalletInputs()[0]).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Pick Allocations");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    const lineReview = await screen.findByTestId("shipment-line-review");
    expect(lineReview).toHaveTextContent("608333");
    expect(lineReview).toHaveTextContent("Planned Ship Qty: 12");
    expect(lineReview).toHaveTextContent("Actual Ship Qty: 0");
    expect(lineReview).toHaveTextContent(/Pallets: 0/i);

    fireEvent.click(screen.getByRole("checkbox", { name: /I confirm the Container/i }));
    fireEvent.click(screen.getByRole("button", { name: "Schedule Shipment" }));

    await waitFor(() => expect(mockedApi.createOutboundDocument).toHaveBeenCalledTimes(1));
    expect(mockedApi.createOutboundDocument.mock.calls[0][0].lines[0]).toMatchObject({
      plannedQuantity: 12,
      actualQuantity: 0,
      quantity: 0,
      pallets: 0,
      pickAllocations: undefined
    });
  });

  it("shows planned and actual quantities for a partially fulfilled line", async () => {
    renderEditor();

    await selectContainerSource(0, "GCXU5817233");
    fireEvent.change(getPlannedQuantityInputs()[0], { target: { value: "12" } });
    setLineQuantity(0, 5);
    setLinePallets(0, 2);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Pick Allocations");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    const lineReview = await screen.findByTestId("shipment-line-review");
    expect(lineReview).toHaveTextContent("608333");
    expect(lineReview).toHaveTextContent("Planned Ship Qty: 12");
    expect(lineReview).toHaveTextContent("Actual Ship Qty: 5");
    expect(lineReview).toHaveTextContent(/Pallets: 2/i);
  });

  it("clears shipping pallets when actual quantity is reset to zero", async () => {
    renderEditor();

    await selectContainerSource(0, "GCXU5817233");
    setLineQuantity(0, 5);
    setLinePallets(0, 2);
    setLineQuantity(0, 0);

    expect(getPalletInputs()[0]).toHaveValue(null);
    expect(getPalletInputs()[0]).toBeDisabled();
  });

  it("releases manual pick selections when actual quantity is reset to zero", async () => {
    renderEditor({
      items: [
        createItem({ id: 1, quantity: 10, availableQty: 10, pallets: 5, availablePallets: 5, containerNo: "GCXU5817233" }),
        createItem({ id: 2, quantity: 12, availableQty: 12, pallets: 2, availablePallets: 2, containerNo: "OOLU1234567" })
      ]
    });

    await selectContainerSource(0, "GCXU5817233");
    setLineQuantity(0, 16);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(await screen.findByRole("spinbutton", { name: "Selected Qty GCXU5817233" }), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    setLineQuantity(0, 0);
    fireEvent.click(screen.getByRole("button", { name: "Add Outbound Line" }));
    await waitFor(() => expect(getSkuInputs()).toHaveLength(2));
    await selectContainerSource(1, "GCXU5817233");
    setLineQuantity(1, 16);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    const firstContainerSelections = await screen.findAllByRole("spinbutton", { name: "Selected Qty GCXU5817233" });
    expect(firstContainerSelections).toHaveLength(2);
    expect(firstContainerSelections[0]).toHaveValue(null);
    expect(firstContainerSelections[1]).toHaveValue(10);
  });

  it("does not add unrelated plan-only SKUs for a full live source label", async () => {
    renderEditor({
      outboundSourceReferences: [
        createOutboundSourceReference(),
        createOutboundSourceReference({
          skuMasterId: 2,
          sku: "609999",
          itemNumber: "ITEM-609999",
          description: "OTHER ITEM"
        })
      ]
    });

    fireEvent.change(getSkuInputs()[0], { target: { value: sourceLabel("GCXU5817233") } });

    await waitFor(() => {
      const optionValues = Array.from(
        document.querySelectorAll('datalist[id^="shipment-editor-sku-options-"] option')
      ).map((option) => (option as HTMLOptionElement).value);
      expect(optionValues.some((value) => value.includes("609999"))).toBe(false);
    });
  });

  it("allows a positive actual quantity with zero shipping pallets", async () => {
    mockedApi.createOutboundDocument.mockResolvedValue(createOutboundDocument({ id: 100, status: "DRAFT" }));
    renderEditor();

    await selectContainerSource(0, "GCXU5817233");
    setLineQuantity(0, 5);
    expect(getPalletInputs()[0]).toHaveValue(null);
    await submitReviewedDraft();

    await waitFor(() => expect(mockedApi.createOutboundDocument).toHaveBeenCalledTimes(1));
    expect(mockedApi.createOutboundDocument.mock.calls[0][0].lines[0]).toMatchObject({
      actualQuantity: 5,
      quantity: 5,
      pallets: 0
    });
  });

  it("keeps outbound quantity and pallet count independent from SKU pallet defaults", async () => {
    mockedApi.createOutboundDocument.mockResolvedValue(createOutboundDocument({ id: 100, status: "DRAFT" }));
    renderEditor({
      skuMasters: [createSkuMaster({ defaultUnitsPerPallet: 2 })],
      items: [createItem({
        quantity: 9,
        availableQty: 9,
        pallets: 3,
        availablePallets: 3
      })]
    });

    await selectContainerSource(0, "GCXU5817233");
    setLineQuantity(0, 9);
    setLinePallets(0, 3);
    await submitReviewedDraft();

    await waitFor(() => expect(mockedApi.createOutboundDocument).toHaveBeenCalledTimes(1));
    expect(mockedApi.createOutboundDocument.mock.calls[0][0].lines[0]).toMatchObject({ quantity: 9, pallets: 3 });
  });

  it("preserves every selected container allocation for one outbound line", async () => {
    mockedApi.createOutboundDocument.mockResolvedValue(createOutboundDocument({ id: 101, status: "DRAFT" }));
    renderEditor({
      items: [
        createItem({ id: 1, quantity: 10, availableQty: 10, pallets: 5, availablePallets: 5, containerNo: "GCXU5817233" }),
        createItem({ id: 2, quantity: 12, availableQty: 12, pallets: 2, availablePallets: 2, containerNo: "OOLU1234567" })
      ]
    });

    await selectContainerSource(0, "GCXU5817233");
    setLineQuantity(0, 16);
    setLinePallets(0, 3);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.change(await screen.findByRole("spinbutton", { name: "Selected Qty GCXU5817233" }), { target: { value: "8" } });
    fireEvent.change(await screen.findByRole("spinbutton", { name: "Selected Qty OOLU1234567" }), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /I confirm the Container/i }));
    fireEvent.click(screen.getByRole("button", { name: "Schedule Shipment" }));

    await waitFor(() => expect(mockedApi.createOutboundDocument).toHaveBeenCalledTimes(1));
    const lines = mockedApi.createOutboundDocument.mock.calls[0][0].lines;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ quantity: 16, pallets: 3 });
    expect(lines[0].pickAllocations.map((allocation: { containerNo: string; allocatedQty: number; pallets: number; inventoryPalletsUsed: number; remainingPallets: number }) => ({
      containerNo: allocation.containerNo,
      allocatedQty: allocation.allocatedQty,
      pallets: allocation.pallets,
      inventoryPalletsUsed: allocation.inventoryPalletsUsed,
      remainingPallets: allocation.remainingPallets
    }))).toEqual([
      { containerNo: "GCXU5817233", allocatedQty: 8, pallets: 0, inventoryPalletsUsed: 5, remainingPallets: 5 },
      { containerNo: "OOLU1234567", allocatedQty: 8, pallets: 0, inventoryPalletsUsed: 1, remainingPallets: 2 }
    ]);
    expect(screen.queryByText(/PLT-/)).not.toBeInTheDocument();
  });

  it("allows Qty and Pallets that do not match a per-pallet CTN profile", async () => {
    mockedApi.createOutboundDocument.mockResolvedValue(createOutboundDocument({ id: 102, status: "DRAFT" }));
    renderEditor({
      items: [createItem({
        quantity: 9,
        availableQty: 9,
        pallets: 3,
        availablePallets: 3
      })]
    });
    await selectContainerSource(0, "GCXU5817233");
    fireEvent.change(getQuantityInputs()[0], { target: { value: "5" } });
    setLinePallets(0, 2);
    await submitReviewedDraft();

    await waitFor(() => expect(mockedApi.createOutboundDocument).toHaveBeenCalledTimes(1));
    expect(mockedApi.createOutboundDocument.mock.calls[0][0].lines[0]).toMatchObject({
      quantity: 5,
      pallets: 2,
      pickAllocations: [{ allocatedQty: 5, pallets: 0, inventoryPalletsUsed: 2, startingPallets: 3, remainingPallets: 3 }]
    });
  });

  it("keeps physical pallets when all available quantity is picked but another draft still reserves stock", async () => {
    mockedApi.createOutboundDocument.mockResolvedValue(createOutboundDocument({ id: 109, status: "DRAFT" }));
    renderEditor({
      items: [createItem({
        quantity: 10,
        availableQty: 4,
        allocatedQty: 6,
        pallets: 1,
        availablePallets: 1,
        allocatedPallets: 0
      })]
    });

    await selectContainerSource(0, "GCXU5817233");
    setLineQuantity(0, 4);
    setLinePallets(0, 1);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByRole("spinbutton", { name: "Remaining Inventory Pallets GCXU5817233" })).toHaveValue(1);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /I confirm the Container/i }));
    fireEvent.click(screen.getByRole("button", { name: "Schedule Shipment" }));

    await waitFor(() => expect(mockedApi.createOutboundDocument).toHaveBeenCalledTimes(1));
    expect(mockedApi.createOutboundDocument.mock.calls[0][0].lines[0]).toMatchObject({
      quantity: 4,
      pickAllocations: [{ allocatedQty: 4, pallets: 0, startingPallets: 1, remainingPallets: 1 }]
    });
  });

  it("keeps Qty and Pallets as independent editable inputs", async () => {
    renderEditor({
      items: [createItem({
        quantity: 8,
        availableQty: 8,
        pallets: 3
      })]
    });
    await selectContainerSource(0, "GCXU5817233");
    setLineQuantity(0, 5);

    expect(getPalletInputs()[0]).toHaveValue(null);
    expect(getPalletInputs()[0]).not.toHaveAttribute("readonly");
    setLinePallets(0, 2);
    expect(getPalletInputs()[0]).toHaveValue(2);
    setLineQuantity(0, 6);
    expect(getPalletInputs()[0]).toHaveValue(2);
  });

  it("does not cap shipping pallets at the inventory pallet balance", async () => {
    renderEditor({
      items: [createItem({
        quantity: 10,
        availableQty: 10,
        pallets: 2,
        availablePallets: 2
      })]
    });
    await selectContainerSource(0, "GCXU5817233");
    setLineQuantity(0, 1);
    setLinePallets(0, 3);

    expect(getPalletInputs()[0]).toHaveValue(3);
  });

  it("keeps shipping pallets independent while enforcing each allocation's available inventory pallets", async () => {
    mockedApi.createOutboundDocument.mockResolvedValue(createOutboundDocument({ id: 103, status: "DRAFT" }));
    renderEditor({
      items: [createItem({
        quantity: 10,
        availableQty: 10,
        pallets: 3,
        availablePallets: 3
      })]
    });

    await selectContainerSource(0, "GCXU5817233");
    setLineQuantity(0, 10);
    setLinePallets(0, 7);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const inventoryPalletInput = await screen.findByRole("spinbutton", { name: "Inventory Pallets Used GCXU5817233" });
    fireEvent.change(inventoryPalletInput, { target: { value: "8" } });
    expect(inventoryPalletInput).toHaveValue(3);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /I confirm the Container/i }));
    fireEvent.click(screen.getByRole("button", { name: "Schedule Shipment" }));

    await waitFor(() => expect(mockedApi.createOutboundDocument).toHaveBeenCalledTimes(1));
    expect(mockedApi.createOutboundDocument.mock.calls[0][0].lines[0]).toMatchObject({
      quantity: 10,
      pallets: 7,
      pickAllocations: [{ allocatedQty: 10, pallets: 3, inventoryPalletsUsed: 3, startingPallets: 3, remainingPallets: 0 }]
    });
  });

  it("blocks a pallet release larger than Inventory Pallets Used", async () => {
    renderEditor({
      items: [createItem({
        quantity: 10,
        availableQty: 10,
        pallets: 3,
        availablePallets: 3
      })]
    });

    await selectContainerSource(0, "GCXU5817233");
    setLineQuantity(0, 10);
    setLinePallets(0, 1);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    const inventoryPalletInput = await screen.findByRole("spinbutton", { name: "Inventory Pallets Used GCXU5817233" });
    fireEvent.change(inventoryPalletInput, { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect((await screen.findAllByText(/Check Inventory Pallets Used and Remaining Inventory Pallets/i)).length).toBeGreaterThan(0);
    expect(mockedApi.createOutboundDocument).not.toHaveBeenCalled();
  });

  it("hydrates an existing allocation by container and preserves its declared pallets", async () => {
    const draft = createOutboundDocument({
      id: 42,
      status: "DRAFT",
      trackingStatus: "PICKING",
      lines: [createOutboundDocumentLine({
        id: 4201,
        documentId: 42,
        quantity: 5,
        pallets: 2,
        pickAllocations: [{
          id: 1,
          lineId: 4201,
          itemNumber: "608333",
          locationId: 1,
          locationName: "NJ",
          storageSection: "TEMP",
          containerNo: "GCXU5817233",
          allocatedQty: 5,
          pallets: 2,
          createdAt: "2026-03-24T10:00:00Z"
        }]
      })]
    });
    mockedApi.updateOutboundDocument.mockResolvedValue(draft);
    renderEditor({ documentId: 42, document: draft });

    await waitFor(() => expect(getPalletInputs()).toHaveLength(1));
    expect(getPalletInputs()[0].value).toBe("2");
    expect(getSkuInputs()[0].value).toContain("GCXU5817233");
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(mockedApi.updateOutboundDocument).toHaveBeenCalledTimes(1));
    const line = mockedApi.updateOutboundDocument.mock.calls[0][1].lines[0];
    expect(line.pallets).toBe(2);
    expect(line.pickAllocations[0]).toMatchObject({ containerNo: "GCXU5817233", allocatedQty: 5, pallets: 2 });
  });

  it("restores a picking draft's own reservations once per physical inventory bucket", async () => {
    const draft = createOutboundDocument({
      id: 52,
      status: "DRAFT",
      trackingStatus: "PICKING",
      lines: [
        createOutboundDocumentLine({
          id: 5201,
          documentId: 52,
          quantity: 5,
          pallets: 7,
          pickAllocations: [{
            id: 11,
            lineId: 5201,
            itemNumber: "608333",
            locationId: 1,
            locationName: "NJ",
            storageSection: "TEMP",
            containerNo: "GCXU5817233",
            allocatedQty: 5,
            pallets: 1,
            createdAt: "2026-03-24T10:00:00Z"
          }]
        }),
        createOutboundDocumentLine({
          id: 5202,
          documentId: 52,
          quantity: 5,
          pallets: 4,
          pickAllocations: [{
            id: 12,
            lineId: 5202,
            itemNumber: "608333",
            locationId: 1,
            locationName: "NJ",
            storageSection: "TEMP",
            containerNo: "GCXU5817233",
            allocatedQty: 5,
            pallets: 1,
            createdAt: "2026-03-24T10:00:00Z"
          }]
        })
      ]
    });
    renderEditor({
      documentId: 52,
      document: draft,
      items: [createItem({
        id: 5201001,
        quantity: 100,
        availableQty: 90,
        pallets: 10,
        availablePallets: 8,
        containerNo: "GCXU5817233"
      })]
    });

    await waitFor(() => expect(getPalletInputs()).toHaveLength(2));
    expect(getPalletInputs().map((input) => input.value)).toEqual(["7", "4"]);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    const selectedQtyInputs = await screen.findAllByRole("spinbutton", { name: "Selected Qty GCXU5817233" });
    const inventoryPalletInputs = screen.getAllByRole("spinbutton", { name: "Inventory Pallets Used GCXU5817233" });
    expect(selectedQtyInputs).toHaveLength(2);
    expect(selectedQtyInputs.map((input) => input.getAttribute("max"))).toEqual(["100", "95"]);
    expect(selectedQtyInputs.map((input) => (input as HTMLInputElement).value)).toEqual(["5", "5"]);
    expect(inventoryPalletInputs.map((input) => input.getAttribute("max"))).toEqual(["10", "9"]);
    expect(inventoryPalletInputs.map((input) => (input as HTMLInputElement).value)).toEqual(["1", "1"]);
  });

  it("does not add scheduled draft allocations back to live inventory", async () => {
    const draft = createOutboundDocument({
      id: 53,
      status: "DRAFT",
      trackingStatus: "SCHEDULED",
      lines: [createOutboundDocumentLine({
        id: 5301,
        documentId: 53,
        quantity: 5,
        pallets: 2,
        pickAllocations: [{
          id: 13,
          lineId: 5301,
          itemNumber: "608333",
          locationId: 1,
          locationName: "NJ",
          storageSection: "TEMP",
          containerNo: "GCXU5817233",
          allocatedQty: 5,
          pallets: 2,
          createdAt: "2026-03-24T10:00:00Z"
        }]
      })]
    });
    renderEditor({
      documentId: 53,
      document: draft,
      items: [createItem({
        id: 5301001,
        quantity: 100,
        availableQty: 90,
        pallets: 10,
        availablePallets: 8,
        containerNo: "GCXU5817233"
      })]
    });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByRole("spinbutton", { name: "Selected Qty GCXU5817233" })).toHaveAttribute("max", "90");
    expect(screen.getByRole("spinbutton", { name: "Inventory Pallets Used GCXU5817233" })).toHaveAttribute("max", "10");
  });

  it("keeps persisted draft buckets separate from colliding real inventory IDs", async () => {
    const draft = createOutboundDocument({
      id: 1,
      status: "DRAFT",
      lines: [createOutboundDocumentLine({
        id: 1,
        documentId: 1,
        quantity: 5,
        pallets: 1,
        pickAllocations: [{
          id: 21,
          lineId: 1,
          itemNumber: "608333",
          locationId: 1,
          locationName: "NJ",
          storageSection: "TEMP",
          containerNo: "GCXU5817233",
          allocatedQty: 5,
          pallets: 1,
          createdAt: "2026-03-24T10:00:00Z"
        }]
      })]
    });
    renderEditor({
      documentId: 1,
      document: draft,
      items: [
        createItem({ id: 2, availableQty: 5, availablePallets: 1, containerNo: "GCXU5817233" }),
        createItem({ id: 1001, availableQty: 10, availablePallets: 2, containerNo: "OOLU1234567" })
      ]
    });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("spinbutton", { name: "Selected Qty GCXU5817233" })).toHaveValue(5);
    expect(screen.getByRole("spinbutton", { name: "Selected Qty OOLU1234567" })).toHaveValue(null);
  });

  it("snapshots the reservation-aware auto pick before editing a later line manually", async () => {
    renderEditor({
      items: [
        createItem({ id: 1, availableQty: 10, availablePallets: 5, containerNo: "GCXU5817233", deliveryDate: "2026-03-01" }),
        createItem({ id: 2, availableQty: 10, availablePallets: 2, containerNo: "OOLU1234567", deliveryDate: "2026-03-02" })
      ]
    });

    await selectContainerSource(0, "GCXU5817233");
    setLineQuantity(0, 10);
    setLinePallets(0, 3);
    fireEvent.click(screen.getByRole("button", { name: "Add Outbound Line" }));
    await waitFor(() => expect(getSkuInputs()).toHaveLength(2));
    await selectContainerSource(1, "GCXU5817233");
    setLineQuantity(1, 10);
    setLinePallets(1, 4);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    const ooluInventoryPalletInputs = await screen.findAllByRole("spinbutton", { name: "Inventory Pallets Used OOLU1234567" });
    const secondLineInventoryPallets = ooluInventoryPalletInputs.find((input) => !(input as HTMLInputElement).disabled);
    expect(secondLineInventoryPallets).toBeDefined();
    expect(secondLineInventoryPallets).toHaveValue(2);
    fireEvent.change(secondLineInventoryPallets as HTMLInputElement, { target: { value: "1" } });

    await waitFor(() => {
      expect(screen.getAllByRole("spinbutton", { name: "Selected Qty OOLU1234567" })
        .some((input) => (input as HTMLInputElement).value === "10")).toBe(true);
      expect(screen.getAllByRole("spinbutton", { name: "Inventory Pallets Used OOLU1234567" })
        .some((input) => (input as HTMLInputElement).value === "1")).toBe(true);
    });
  });

  it("re-enters a confirmed shipment through the existing copy workflow", async () => {
    const confirmed = createOutboundDocument({ id: 77, status: "CONFIRMED", trackingStatus: "SHIPPED" });
    mockedApi.copyOutboundDocument.mockResolvedValue(createOutboundDocument({ id: 78, status: "DRAFT" }));
    const { onOpenShipmentEditor } = renderEditor({ documentId: 77, document: confirmed });

    fireEvent.click(screen.getAllByRole("button", { name: "Re-enter Shipment" })[0]);

    await waitFor(() => expect(mockedApi.copyOutboundDocument).toHaveBeenCalledWith(77));
    expect(onOpenShipmentEditor).toHaveBeenCalledWith(78);
  });

  it("auto-fills expected ship date when actual ship date is entered first", () => {
    renderEditor();
    const expected = screen.getByLabelText("Expected Ship Date") as HTMLInputElement;
    const actual = screen.getByLabelText("Actual Ship Date") as HTMLInputElement;

    fireEvent.change(actual, { target: { value: "2026-04-03" } });

    expect(actual.value).toBe("2026-04-03");
    expect(expected.value).toBe("2026-04-03");
  });
});
