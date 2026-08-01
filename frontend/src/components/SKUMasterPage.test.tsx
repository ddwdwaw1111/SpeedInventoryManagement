import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSkuMaster } from "../test/fixtures";
import { renderWithProviders } from "../test/renderWithProviders";
import { SKUMasterPage } from "./SKUMasterPage";

const { createSKUMaster, updateSKUMaster, deleteSKUMaster, getUIPreference, updateUIPreference } = vi.hoisted(() => ({
  createSKUMaster: vi.fn(),
  updateSKUMaster: vi.fn(),
  deleteSKUMaster: vi.fn(),
  getUIPreference: vi.fn(),
  updateUIPreference: vi.fn()
}));

vi.mock("../lib/api", () => ({
  api: {
    createSKUMaster,
    updateSKUMaster,
    deleteSKUMaster,
    getUIPreference,
    updateUIPreference
  }
}));

vi.mock("@mui/x-data-grid", () => ({
  DataGrid: () => <div data-testid="mock-data-grid" />
}));

describe("SKUMasterPage", () => {
  beforeEach(() => {
    createSKUMaster.mockReset();
    createSKUMaster.mockResolvedValue(createSkuMaster());
    updateSKUMaster.mockReset();
    deleteSKUMaster.mockReset();
    getUIPreference.mockReset();
    getUIPreference.mockResolvedValue({ value: [] });
    updateUIPreference.mockReset();
    updateUIPreference.mockResolvedValue({ value: [] });
  });

  it("saves weight, cubes, and the outbound pallet pattern with a new UPC master", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(
      <SKUMasterPage
        skuMasters={[]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={onRefresh}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Create Record" }));
    const dialog = screen.getByRole("dialog", { name: "Add UPC master" });

    fireEvent.change(within(dialog).getByLabelText("Item #"), { target: { value: "ITEM-100" } });
    fireEvent.change(within(dialog).getByLabelText("UPC"), { target: { value: "012345678901" } });
    fireEvent.change(within(dialog).getByLabelText("Description"), { target: { value: "Test carton" } });
    fireEvent.change(within(dialog).getByLabelText("Weight"), { target: { value: "12.5" } });
    fireEvent.change(within(dialog).getByLabelText("Cubes"), { target: { value: "0.084" } });
    fireEvent.change(within(dialog).getByLabelText("Cartons per Layer"), { target: { value: "10" } });
    fireEvent.change(within(dialog).getByLabelText("Total Layers"), { target: { value: "6" } });

    fireEvent.click(within(dialog).getByRole("button", { name: "Add row" }));

    await waitFor(() => expect(createSKUMaster).toHaveBeenCalledWith(expect.objectContaining({
      itemNumber: "ITEM-100",
      sku: "012345678901",
      description: "Test carton",
      weight: 12.5,
      cubes: 0.084,
      outboundCartonsPerLayer: 10,
      outboundLayerCount: 6
    })));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
