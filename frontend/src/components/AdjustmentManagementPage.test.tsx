import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../test/renderWithProviders";
import { createItem } from "../test/fixtures";
import { AdjustmentManagementPage } from "./AdjustmentManagementPage";

const { createInventoryAdjustment } = vi.hoisted(() => ({ createInventoryAdjustment: vi.fn() }));

vi.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: { createInventoryAdjustment }
}));

function renderPage() {
  const onRefresh = vi.fn().mockResolvedValue(undefined);
  renderWithProviders(
    <AdjustmentManagementPage
      adjustments={[]}
      items={[createItem({ id: 10, containerNo: "CONT-A", quantity: 100, availableQty: 90, pallets: 7 })]}
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
  const skuSelect = within(dialog).getByLabelText(/SKU/);
  fireEvent.change(skuSelect, { target: { value: (skuSelect as HTMLSelectElement).options[1]?.value } });
  fireEvent.change(within(dialog).getByLabelText("Reason Code"), { target: { value: "CORRECTION" } });
  return dialog;
}

describe("AdjustmentManagementPage", () => {
  beforeEach(() => {
    createInventoryAdjustment.mockReset();
    createInventoryAdjustment.mockResolvedValue({});
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("posts quantity and pallet deltas as independent aggregate values", async () => {
    const { onRefresh } = renderPage();
    const dialog = openPreparedForm();

    fireEvent.change(within(dialog).getByLabelText("Adjust Qty"), { target: { value: "-12" } });
    fireEvent.change(within(dialog).getByLabelText(/Adjustment \(Pallets\)/i), { target: { value: "-2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Post Adjustment" }));

    await waitFor(() => expect(createInventoryAdjustment).toHaveBeenCalledTimes(1));
    expect(createInventoryAdjustment.mock.calls[0][0].lines[0]).toMatchObject({
      containerNo: "CONT-A",
      adjustQty: -12,
      adjustPallets: -2
    });
    expect(onRefresh).toHaveBeenCalled();
  });

  it("allows a pallet-only correction without changing quantity", async () => {
    renderPage();
    const dialog = openPreparedForm();

    fireEvent.change(within(dialog).getByLabelText(/Adjustment \(Pallets\)/i), { target: { value: "1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Post Adjustment" }));

    await waitFor(() => expect(createInventoryAdjustment).toHaveBeenCalledTimes(1));
    expect(createInventoryAdjustment.mock.calls[0][0].lines[0]).toMatchObject({ adjustQty: 0, adjustPallets: 1 });
  });

  it("does not show any pallet entity selector", () => {
    renderPage();
    const dialog = openPreparedForm();

    expect(within(dialog).queryByText(/Pallet Code/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Pallet ID/i)).not.toBeInTheDocument();
  });
});
