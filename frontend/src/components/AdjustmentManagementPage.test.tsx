import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../test/renderWithProviders";
import { createItem } from "../test/fixtures";
import { AdjustmentManagementPage } from "./AdjustmentManagementPage";

const { createInventoryAdjustment } = vi.hoisted(() => ({ createInventoryAdjustment: vi.fn() }));

vi.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: { createInventoryAdjustment }
}));

function defaultItems() {
  return [createItem({
    id: 10,
    containerNo: "CONT-A",
    quantity: 100,
    availableQty: 90,
    pallets: 7,
    availablePallets: 7
  })];
}

function renderPage(items = defaultItems(), onRefresh = vi.fn().mockResolvedValue(undefined)) {
  renderWithProviders(
    <AdjustmentManagementPage
      adjustments={[]}
      items={items}
      currentUserRole="admin"
      isLoading={false}
      onRefresh={onRefresh}
      onNavigate={vi.fn()}
    />
  );
  return { onRefresh };
}

function openPreparedForm() {
  fireEvent.click(screen.getByRole("button", { name: "Inventory Adjustment" }));
  const dialog = screen.getByRole("dialog");
  const containerSelect = within(dialog).getByLabelText("Container No.") as HTMLSelectElement;
  fireEvent.change(containerSelect, { target: { value: containerSelect.options[1]?.value } });
  fireEvent.click(within(dialog).getByRole("button", { name: "CORRECTION" }));
  return dialog;
}

describe("AdjustmentManagementPage", () => {
  beforeEach(() => {
    createInventoryAdjustment.mockReset();
    createInventoryAdjustment.mockResolvedValue({});
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("submits final quantity and pallet balances for atomic server-side calculation", async () => {
    const { onRefresh } = renderPage();
    const dialog = openPreparedForm();

    fireEvent.change(within(dialog).getByLabelText("Final Qty - 608333 - TEMP"), { target: { value: "88" } });
    fireEvent.change(within(dialog).getByLabelText("Final Pallets - 608333 - TEMP"), { target: { value: "5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Post Adjustment" }));

    await waitFor(() => expect(createInventoryAdjustment).toHaveBeenCalledTimes(1));
    expect(createInventoryAdjustment.mock.calls[0][0]).toMatchObject({
      reasonCode: "CORRECTION",
      lines: [expect.objectContaining({
        containerNo: "CONT-A",
        finalQty: 88,
        finalPallets: 5
      })]
    });
    expect(onRefresh).toHaveBeenCalled();
  });

  it("allows a pallet-only correction without changing quantity", async () => {
    renderPage();
    const dialog = openPreparedForm();

    fireEvent.change(within(dialog).getByLabelText("Final Pallets - 608333 - TEMP"), { target: { value: "8" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Post Adjustment" }));

    await waitFor(() => expect(createInventoryAdjustment).toHaveBeenCalledTimes(1));
    expect(createInventoryAdjustment.mock.calls[0][0].lines[0]).toMatchObject({ finalQty: 100, finalPallets: 8 });
  });

  it("supports entering positive and negative change amounts directly", async () => {
    renderPage();
    const dialog = openPreparedForm();

    fireEvent.click(within(dialog).getByRole("button", { name: /^Change Amount/ }));
    fireEvent.change(within(dialog).getByLabelText("Adjust Qty - 608333 - TEMP"), { target: { value: "15" } });
    fireEvent.change(within(dialog).getByLabelText(/Adjustment \(Pallets\) - 608333 - TEMP/i), { target: { value: "-1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Post Adjustment" }));

    await waitFor(() => expect(createInventoryAdjustment).toHaveBeenCalledTimes(1));
    expect(createInventoryAdjustment.mock.calls[0][0].lines[0]).toMatchObject({ adjustQty: 15, adjustPallets: -1 });
  });

  it("submits only changed rows from a multi-SKU container", async () => {
    renderPage([
      ...defaultItems(),
      createItem({
        id: 11,
        skuMasterId: 2,
        itemNumber: "ITEM-B",
        sku: "SKU-B",
        description: "Second item",
        containerNo: "CONT-A",
        storageSection: "A",
        quantity: 30,
        availableQty: 30,
        pallets: 3,
        availablePallets: 3
      })
    ]);
    const dialog = openPreparedForm();

    expect(within(dialog).getByLabelText("Final Qty - 608333 - TEMP")).toHaveValue(100);
    fireEvent.change(within(dialog).getByLabelText("Final Qty - SKU-B - A"), { target: { value: "28" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Post Adjustment" }));

    await waitFor(() => expect(createInventoryAdjustment).toHaveBeenCalledTimes(1));
    expect(createInventoryAdjustment.mock.calls[0][0].lines).toEqual([
      expect.objectContaining({ skuMasterId: 2, finalQty: 28, finalPallets: 3 })
    ]);
  });

  it("blocks final balances below reserved quantity or allocated pallets", () => {
    renderPage([createItem({
      id: 10,
      containerNo: "CONT-A",
      quantity: 100,
      availableQty: 80,
      allocatedQty: 10,
      damagedQty: 5,
      holdQty: 5,
      pallets: 7,
      availablePallets: 5,
      allocatedPallets: 2
    })]);
    const dialog = openPreparedForm();

    fireEvent.change(within(dialog).getByLabelText("Final Qty - 608333 - TEMP"), { target: { value: "19" } });
    fireEvent.change(within(dialog).getByLabelText("Final Pallets - 608333 - TEMP"), { target: { value: "1" } });

    expect(within(dialog).getByText(/minimum 20/)).toBeInTheDocument();
    expect(within(dialog).getByText(/allocated pallets \(minimum 2\)/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Post Adjustment" })).toBeDisabled();
  });

  it("does not show any pallet entity selector", () => {
    renderPage();
    const dialog = openPreparedForm();

    expect(within(dialog).queryByText(/Pallet Code/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Pallet ID/i)).not.toBeInTheDocument();
  });

  it("keeps the adjustment dialog locked until refreshed inventory is available", async () => {
    let resolveRefresh!: () => void;
    const refreshPromise = new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    });
    const onRefresh = vi.fn(() => refreshPromise);
    renderPage(defaultItems(), onRefresh);
    const dialog = openPreparedForm();

    fireEvent.change(within(dialog).getByLabelText("Final Qty - 608333 - TEMP"), { target: { value: "88" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Post Adjustment" }));

    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(within(dialog).getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await act(async () => resolveRefresh());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
