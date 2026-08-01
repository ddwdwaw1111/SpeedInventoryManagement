import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../test/renderWithProviders";
import { createCustomer, createItem, createLocation } from "../test/fixtures";
import { setPendingInventoryActionContext } from "../lib/inventoryActionContext";
import { TransferManagementPage } from "./TransferManagementPage";

const { createInventoryTransfer, getUIPreference, updateUIPreference } = vi.hoisted(() => ({
  createInventoryTransfer: vi.fn(),
  getUIPreference: vi.fn(),
  updateUIPreference: vi.fn()
}));

vi.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    createInventoryTransfer,
    getUIPreference,
    updateUIPreference
  }
}));

function buildDefaultItems() {
  return [
    createItem({
      id: 10,
      locationId: 1,
      locationName: "New Jersey",
      storageSection: "TEMP",
      containerNo: "CONT-A",
      quantity: 100,
      availableQty: 100,
      pallets: 8,
      availablePallets: 8
    }),
    createItem({
      id: 11,
      skuMasterId: 2,
      itemNumber: "ITEM-B",
      sku: "SKU-B",
      name: "SKU-B",
      description: "Second item in container",
      locationId: 1,
      locationName: "New Jersey",
      storageSection: "A",
      containerNo: "CONT-A",
      quantity: 24,
      availableQty: 24,
      pallets: 3,
      availablePallets: 3
    })
  ];
}

function buildDefaultLocations() {
  return [
    createLocation({ id: 1, name: "New Jersey", sectionNames: ["TEMP", "A"] }),
    createLocation({ id: 2, name: "Los Angeles", sectionNames: ["TEMP", "RACK"] })
  ];
}

function renderPage({
  items = buildDefaultItems(),
  locations = buildDefaultLocations()
}: {
  items?: ReturnType<typeof createItem>[];
  locations?: ReturnType<typeof createLocation>[];
} = {}) {
  const onRefresh = vi.fn().mockResolvedValue(undefined);
  renderWithProviders(
    <TransferManagementPage
      transfers={[]}
      items={items}
      locations={locations}
      customers={[createCustomer({ id: 1, name: "Test Customer" })]}
      currentUserRole="admin"
      isLoading={false}
      onRefresh={onRefresh}
      onNavigate={vi.fn()}
    />
  );
  return { onRefresh };
}

function openTransferDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Inventory Transfer" }));
  return screen.getByRole("dialog");
}

describe("TransferManagementPage", () => {
  beforeEach(() => {
    createInventoryTransfer.mockReset();
    createInventoryTransfer.mockResolvedValue({});
    getUIPreference.mockReset();
    getUIPreference.mockResolvedValue({ value: [] });
    updateUIPreference.mockReset();
    updateUIPreference.mockResolvedValue({ value: [] });
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("requires an explicit scope and destination before moving an entire multi-section container", async () => {
    const { onRefresh } = renderPage();
    const dialog = openTransferDialog();

    const containerSelect = within(dialog).getByLabelText("Container No.") as HTMLSelectElement;
    expect(containerSelect.options).toHaveLength(2);
    fireEvent.change(containerSelect, { target: { value: containerSelect.options[1]?.value } });

    const entireContainerButton = within(dialog).getByRole("button", { name: /^Entire Container/ });
    const partialContainerButton = within(dialog).getByRole("button", { name: /^Partial Container/ });
    const destinationWarehouse = within(dialog).getByLabelText("Destination Warehouse");
    const postTransfer = within(dialog).getByRole("button", { name: "Post Transfer" });
    expect(entireContainerButton).toHaveAttribute("aria-pressed", "false");
    expect(partialContainerButton).toHaveAttribute("aria-pressed", "false");
    expect(destinationWarehouse).toBeDisabled();
    expect(destinationWarehouse).toHaveValue("");
    expect(postTransfer).toBeDisabled();
    expect(within(dialog).getByText("SKU-B")).toBeInTheDocument();

    fireEvent.click(entireContainerButton);
    expect(entireContainerButton).toHaveAttribute("aria-pressed", "true");
    expect(destinationWarehouse).toBeEnabled();
    expect(destinationWarehouse).toHaveValue("");
    fireEvent.change(destinationWarehouse, { target: { value: "2" } });
    expect(within(dialog).getByLabelText("To Section")).toHaveValue("TEMP");
    fireEvent.click(postTransfer);

    await waitFor(() => expect(createInventoryTransfer).toHaveBeenCalledTimes(1));
    expect(createInventoryTransfer.mock.calls[0][0]).toMatchObject({
      entireContainer: {
        customerId: 1,
        locationId: 1,
        containerNo: "CONT-A",
        toLocationId: 2,
        toStorageSection: "TEMP"
      }
    });
    expect(createInventoryTransfer.mock.calls[0][0].lines).toBeUndefined();
    expect(onRefresh).toHaveBeenCalled();
  });

  it("submits only selected UPC quantities in partial-container mode", async () => {
    renderPage();
    const dialog = openTransferDialog();
    const containerSelect = within(dialog).getByLabelText("Container No.") as HTMLSelectElement;
    fireEvent.change(containerSelect, { target: { value: containerSelect.options[1]?.value } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Partial Container/ }));
    fireEvent.change(within(dialog).getByLabelText("Destination Warehouse"), { target: { value: "2" } });

    const firstQty = within(dialog).getByLabelText("Transfer Qty - 608333 - TEMP");
    const firstPallets = within(dialog).getByLabelText("Source Inventory Pallets Released - 608333 - TEMP");
    const secondQty = within(dialog).getByLabelText("Transfer Qty - SKU-B - A");
    expect(firstQty).toHaveValue(null);
    expect(firstPallets).toHaveValue(null);
    expect(secondQty).toHaveValue(null);

    fireEvent.change(firstQty, { target: { value: "25" } });
    fireEvent.change(firstPallets, { target: { value: "3" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Post Transfer" }));

    await waitFor(() => expect(createInventoryTransfer).toHaveBeenCalledTimes(1));
    expect(createInventoryTransfer.mock.calls[0][0].lines).toEqual([
      expect.objectContaining({
        skuMasterId: 1,
        quantity: 25,
        sourcePallets: 3,
        destinationPallets: 0,
        toLocationId: 2
      })
    ]);
  });

  it("keeps the transfer dialog locked until the save and refresh finish", async () => {
    let resolveTransfer: ((value: unknown) => void) | undefined;
    createInventoryTransfer.mockImplementation(() => new Promise((resolve) => {
      resolveTransfer = resolve;
    }));
    const { onRefresh } = renderPage();
    const dialog = openTransferDialog();
    const containerSelect = within(dialog).getByLabelText("Container No.") as HTMLSelectElement;
    fireEvent.change(containerSelect, { target: { value: containerSelect.options[1]?.value } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Partial Container/ }));
    fireEvent.change(within(dialog).getByLabelText("Destination Warehouse"), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText("Transfer Qty - 608333 - TEMP"), { target: { value: "10" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Post Transfer" }));

    await waitFor(() => expect(createInventoryTransfer).toHaveBeenCalledTimes(1));
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    resolveTransfer?.({});
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(createInventoryTransfer).toHaveBeenCalledTimes(1);
  });

  it("allows pallet-only transfers when quantity is already zero", async () => {
    renderPage({
      items: [createItem({
        id: 15,
        locationId: 1,
        locationName: "New Jersey",
        storageSection: "TEMP",
        containerNo: "EMPTY-PALLETS",
        quantity: 0,
        availableQty: 0,
        pallets: 2,
        availablePallets: 2
      })]
    });
    const dialog = openTransferDialog();
    const containerSelect = within(dialog).getByLabelText("Container No.") as HTMLSelectElement;
    expect(containerSelect.options).toHaveLength(2);
    fireEvent.change(containerSelect, { target: { value: containerSelect.options[1]?.value } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Partial Container/ }));
    fireEvent.change(within(dialog).getByLabelText("Destination Warehouse"), { target: { value: "2" } });

    const palletInput = within(dialog).getByLabelText("Source Inventory Pallets Released - 608333 - TEMP");
    expect(palletInput).toBeEnabled();
    fireEvent.change(palletInput, { target: { value: "1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Post Transfer" }));

    await waitFor(() => expect(createInventoryTransfer).toHaveBeenCalledTimes(1));
    expect(createInventoryTransfer.mock.calls[0][0].lines).toEqual([
      expect.objectContaining({
        quantity: 0,
        sourcePallets: 1,
        destinationPallets: 0,
        toLocationId: 2
      })
    ]);
  });

  it("blocks entire-container transfer when any physical stock is unavailable", () => {
    const items = buildDefaultItems();
    items.push(createItem({
      id: 12,
      skuMasterId: 3,
      itemNumber: "ITEM-C",
      sku: "SKU-C",
      name: "SKU-C",
      locationId: 1,
      locationName: "New Jersey",
      storageSection: "TEMP",
      containerNo: "CONT-A",
      quantity: 20,
      availableQty: 0,
      allocatedQty: 20,
      pallets: 2,
      availablePallets: 0,
      allocatedPallets: 2
    }));
    renderPage({ items });
    const dialog = openTransferDialog();
    const containerSelect = within(dialog).getByLabelText("Container No.") as HTMLSelectElement;
    fireEvent.change(containerSelect, { target: { value: containerSelect.options[1]?.value } });

    expect(within(dialog).getByRole("button", { name: /^Entire Container/ })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: /^Partial Container/ })).toBeEnabled();
    expect(within(dialog).getByText("SKU-C")).toBeInTheDocument();
    expect(within(dialog).getByText(/Entire Container is unavailable because some QTY or pallets are allocated/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Destination Warehouse")).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Post Transfer" })).toBeDisabled();
  });

  it("does not preselect an arbitrary container from an ambiguous SKU context", async () => {
    const items = buildDefaultItems();
    items.push(createItem({
      id: 13,
      locationId: 1,
      locationName: "New Jersey",
      storageSection: "TEMP",
      containerNo: "CONT-B",
      quantity: 40,
      availableQty: 40,
      pallets: 4,
      availablePallets: 4
    }));
    setPendingInventoryActionContext("transfers", {
      sourceKey: "1:608333",
      sku: "608333",
      customerId: 1
    });
    renderPage({ items });

    const dialog = await screen.findByRole("dialog");
    const containerSelect = within(dialog).getByLabelText("Container No.") as HTMLSelectElement;
    expect(containerSelect.options).toHaveLength(3);
    expect(containerSelect).toHaveValue("");
    expect(within(dialog).getByRole("button", { name: "Post Transfer" })).toBeDisabled();
  });

  it("distinguishes the same SKU stored in different source sections", () => {
    const firstItem = buildDefaultItems()[0]!;
    const items = [
      firstItem,
      createItem({
        ...firstItem,
        id: 14,
        storageSection: "A",
        quantity: 30,
        availableQty: 30,
        pallets: 3,
        availablePallets: 3
      })
    ];
    renderPage({ items });
    const dialog = openTransferDialog();
    const containerSelect = within(dialog).getByLabelText("Container No.") as HTMLSelectElement;
    fireEvent.change(containerSelect, { target: { value: containerSelect.options[1]?.value } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Partial Container/ }));

    expect(within(dialog).getByText("Section: A")).toBeInTheDocument();
    expect(within(dialog).getByText("Section: TEMP")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Transfer Qty - 608333 - A")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Transfer Qty - 608333 - TEMP")).toBeInTheDocument();
  });

  it("clears a destination that becomes a selected source section", async () => {
    renderPage();
    const dialog = openTransferDialog();
    const containerSelect = within(dialog).getByLabelText("Container No.") as HTMLSelectElement;
    fireEvent.change(containerSelect, { target: { value: containerSelect.options[1]?.value } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Partial Container/ }));

    fireEvent.change(within(dialog).getByLabelText("Transfer Qty - 608333 - TEMP"), { target: { value: "10" } });
    const destinationWarehouse = within(dialog).getByLabelText("Destination Warehouse");
    fireEvent.change(destinationWarehouse, { target: { value: "1" } });
    expect(within(dialog).getByLabelText("To Section")).toHaveValue("A");

    fireEvent.change(within(dialog).getByLabelText("Transfer Qty - SKU-B - A"), { target: { value: "5" } });

    await waitFor(() => expect(destinationWarehouse).toHaveValue(""));
    expect(within(dialog).getAllByText(/Destination was cleared because it matches the source section/).length).toBeGreaterThan(0);
    expect(within(dialog).getByRole("button", { name: "Post Transfer" })).toBeDisabled();
  });
});
