import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  api: {
    getPallets: vi.fn(),
    createOutboundDocument: vi.fn(),
    updateOutboundDocument: vi.fn(),
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
  copyOutboundDocument: ReturnType<typeof vi.fn>;
};

function renderEditor(options?: {
  documentId?: number | null;
  document?: ReturnType<typeof createOutboundDocument> | null;
  items?: ReturnType<typeof createItem>[];
  skuMasters?: ReturnType<typeof createSkuMaster>[];
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
      movements={[createMovement()]}
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

function getPalletInputs() {
  return Array.from(document.querySelectorAll('input[aria-label^="PALLETS #"]')) as HTMLInputElement[];
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
    mockedApi.getPallets.mockReset();
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
        containerNo: "GCXU5817233",
        palletProfiles: [palletProfile(2, 1), palletProfile(3, 2)]
      })]
    });

    await selectContainerSource(0, "GCXU5817233");
    setLineQuantity(0, 5);
    setLinePallets(0, 2);
    await submitReviewedDraft();

    await waitFor(() => expect(mockedApi.createOutboundDocument).toHaveBeenCalledTimes(1));
    expect(mockedApi.getPallets).not.toHaveBeenCalled();
    expect(mockedApi.createOutboundDocument.mock.calls[0][0].lines[0]).toEqual({
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
      lineNote: undefined,
      pickAllocations: [{
        itemNumber: "608333",
        locationId: 1,
        locationName: "NJ",
        storageSection: "TEMP",
        containerNo: "GCXU5817233",
        allocatedQty: 5,
        pallets: 2
      }]
    });
    expect(mockedApi.createOutboundDocument.mock.calls[0][0].lines[0]).not.toHaveProperty("pickPallets");
    expect(onBackToList).toHaveBeenCalledTimes(1);
  });

  it("keeps outbound quantity and pallet count independent from SKU pallet defaults", async () => {
    mockedApi.createOutboundDocument.mockResolvedValue(createOutboundDocument({ id: 100, status: "DRAFT" }));
    renderEditor({
      skuMasters: [createSkuMaster({ defaultUnitsPerPallet: 2 })],
      items: [createItem({
        quantity: 9,
        availableQty: 9,
        pallets: 3,
        palletProfiles: [palletProfile(3, 3)]
      })]
    });

    await selectContainerSource(0, "GCXU5817233");
    setLineQuantity(0, 9);
    setLinePallets(0, 3);
    await submitReviewedDraft();

    await waitFor(() => expect(mockedApi.createOutboundDocument).toHaveBeenCalledTimes(1));
    expect(mockedApi.createOutboundDocument.mock.calls[0][0].lines[0]).toMatchObject({ quantity: 9, pallets: 3 });
  });

  it("ships the same SKU from multiple containers as separate allocation rows", async () => {
    mockedApi.createOutboundDocument.mockResolvedValue(createOutboundDocument({ id: 101, status: "DRAFT" }));
    renderEditor({
      items: [
        createItem({ id: 1, quantity: 10, availableQty: 10, pallets: 5, containerNo: "GCXU5817233", palletProfiles: [palletProfile(2, 5)] }),
        createItem({ id: 2, quantity: 12, availableQty: 12, pallets: 2, containerNo: "OOLU1234567", palletProfiles: [palletProfile(6, 2)] })
      ]
    });

    fireEvent.click(screen.getByRole("button", { name: "Add Outbound Line" }));
    await selectContainerSource(0, "GCXU5817233");
    setLineQuantity(0, 4);
    setLinePallets(0, 2);
    await selectContainerSource(1, "OOLU1234567");
    setLineQuantity(1, 6);
    setLinePallets(1, 1);
    await submitReviewedDraft();

    await waitFor(() => expect(mockedApi.createOutboundDocument).toHaveBeenCalledTimes(1));
    const lines = mockedApi.createOutboundDocument.mock.calls[0][0].lines;
    expect(lines).toHaveLength(2);
    expect(lines.map((line: { quantity: number; pallets: number; pickAllocations: Array<{ containerNo: string }> }) => ({
      containerNo: line.pickAllocations[0].containerNo,
      quantity: line.quantity,
      pallets: line.pallets
    }))).toEqual([
      { containerNo: "GCXU5817233", quantity: 4, pallets: 2 },
      { containerNo: "OOLU1234567", quantity: 6, pallets: 1 }
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
        palletProfiles: [palletProfile(3, 3)]
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
      pickAllocations: [{ allocatedQty: 5, pallets: 2 }]
    });
  });

  it("keeps Qty and Pallets as independent editable inputs", async () => {
    renderEditor({
      items: [createItem({
        quantity: 8,
        availableQty: 8,
        pallets: 3,
        palletProfiles: [palletProfile(2, 1), palletProfile(3, 2)]
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

  it("caps pallet input at the selected container balance", async () => {
    renderEditor({
      items: [createItem({
        quantity: 10,
        availableQty: 10,
        pallets: 2
      })]
    });
    await selectContainerSource(0, "GCXU5817233");
    setLineQuantity(0, 1);
    setLinePallets(0, 3);

    expect(getPalletInputs()[0]).toHaveValue(2);
  });

  it("hydrates an existing allocation by container and preserves its declared pallets", async () => {
    const draft = createOutboundDocument({
      id: 42,
      status: "DRAFT",
      trackingStatus: "SCHEDULED",
      lines: [createOutboundDocumentLine({
        id: 4201,
        documentId: 42,
        quantity: 5,
        pallets: 2,
        pickPallets: [{ palletId: 501, quantity: 5 }],
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
    expect(line).not.toHaveProperty("pickPallets");
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
