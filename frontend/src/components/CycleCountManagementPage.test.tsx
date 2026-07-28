import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../test/renderWithProviders";
import { createItem } from "../test/fixtures";
import { CycleCountManagementPage } from "./CycleCountManagementPage";

const { createCycleCount } = vi.hoisted(() => ({ createCycleCount: vi.fn() }));

vi.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: { createCycleCount }
}));

function renderPage(items = [createItem({ id: 20, containerNo: "CONT-COUNT", quantity: 80, pallets: 6 })]) {
  const onRefresh = vi.fn().mockResolvedValue(undefined);
  renderWithProviders(
    <CycleCountManagementPage
      cycleCounts={[]}
      items={items}
      currentUserRole="admin"
      isLoading={false}
      onRefresh={onRefresh}
    />
  );
  return { onRefresh };
}

function openPreparedForm() {
  fireEvent.click(screen.getByRole("button", { name: "New Count Sheet" }));
  const dialog = screen.getByRole("dialog");
  const skuSelect = within(dialog).getAllByRole("combobox")[0];
  fireEvent.change(skuSelect, { target: { value: (skuSelect as HTMLSelectElement).options[1]?.value } });
  return dialog;
}

describe("CycleCountManagementPage", () => {
  beforeEach(() => {
    createCycleCount.mockReset();
    createCycleCount.mockResolvedValue({});
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("submits counted quantity and counted pallets independently for a container bucket", async () => {
    const { onRefresh } = renderPage();
    const dialog = openPreparedForm();

    fireEvent.change(within(dialog).getByLabelText("Counted Qty", { selector: "input:not([readonly])" }), { target: { value: "75" } });
    fireEvent.change(within(dialog).getByLabelText(/Counted Qty \(Pallets\)/i), { target: { value: "5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Post Count Sheet" }));

    await waitFor(() => expect(createCycleCount).toHaveBeenCalledTimes(1));
    expect(createCycleCount.mock.calls[0][0].lines[0]).toMatchObject({
      containerNo: "CONT-COUNT",
      countedQty: 75,
      countedPallets: 5
    });
    expect(createCycleCount.mock.calls[0][0].lines[0]).not.toHaveProperty("createPallet");
    expect(onRefresh).toHaveBeenCalled();
  });

  it("allows pallet count to change while quantity remains unchanged", async () => {
    renderPage();
    const dialog = openPreparedForm();

    fireEvent.change(within(dialog).getByLabelText(/Counted Qty \(Pallets\)/i), { target: { value: "7" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Post Count Sheet" }));

    await waitFor(() => expect(createCycleCount).toHaveBeenCalledTimes(1));
    expect(createCycleCount.mock.calls[0][0].lines[0]).toMatchObject({ countedQty: 80, countedPallets: 7 });
  });

  it("does not expose create-pallet controls", () => {
    renderPage();
    const dialog = openPreparedForm();

    expect(within(dialog).queryByText(/Create Pallet/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Pallet Code/i)).not.toBeInTheDocument();
  });

  it("shows both SKU and Item Number in the inventory source selector", () => {
    renderPage([createItem({
      id: 20,
      containerNo: "CONT-COUNT",
      sku: "SKU-COUNT",
      itemNumber: "ITEM-COUNT"
    })]);

    fireEvent.click(screen.getByRole("button", { name: "New Count Sheet" }));
    const sourceSelect = within(screen.getByRole("dialog")).getAllByRole("combobox")[0];

    expect(within(sourceSelect).getByRole("option", {
      name: /SKU-COUNT.*ITEM-COUNT/
    })).toBeInTheDocument();
  });
});
