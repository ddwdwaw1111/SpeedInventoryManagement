import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CustomerPortalPage } from "./CustomerPortalPage";
import { createItem } from "../test/fixtures";
import { renderWithProviders } from "../test/renderWithProviders";

const { getInventory } = vi.hoisted(() => ({
  getInventory: vi.fn()
}));

vi.mock("./api", () => ({
  customerPortalApi: {
    getInventory
  }
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe("CustomerPortalPage", () => {
  beforeEach(() => {
    getInventory.mockReset();
    getInventory.mockResolvedValue([]);
  });

  it("renders a read-only inventory workspace with no mutation controls", async () => {
    getInventory.mockResolvedValue([
      createItem({
        id: 88,
        skuMasterId: 321,
        itemNumber: "CUST-SKU-321",
        sku: "CUST-SKU-321",
        description: "Customer owned cartons",
        locationId: 11,
        locationName: "NJ",
        availableQty: 12,
        quantity: 14
      })
    ]);

    renderWithProviders(<CustomerPortalPage />);

    expect(await screen.findByText("CUST-SKU-321")).toBeInTheDocument();
    expect(screen.getByText("Read-only access")).toBeInTheDocument();
    expect(screen.getByText("Customer owned cartons")).toBeInTheDocument();
    expect(screen.getAllByText("NJ").length).toBeGreaterThan(0);
    expect(screen.getByText("14")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Warehouse" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create|add|edit|delete|upload|submit/i })).not.toBeInTheDocument();
    expect(getInventory).toHaveBeenCalledWith("", undefined);
  });

  it("uses the selected customer scope for an admin preview", async () => {
    renderWithProviders(<CustomerPortalPage portalCustomerId={7} />);

    await waitFor(() => {
      expect(getInventory).toHaveBeenCalledWith("", 7);
    });
  });

  it("shows a loading state while refreshing inventory", async () => {
    const user = userEvent.setup();
    const refreshInventory = createDeferred<ReturnType<typeof createItem>[]>();
    getInventory
      .mockResolvedValueOnce([
        createItem({
          id: 88,
          skuMasterId: 321,
          sku: "CUST-SKU-321",
          locationId: 11,
          locationName: "NJ",
          availableQty: 12,
          quantity: 12
        })
      ])
      .mockReturnValueOnce(refreshInventory.promise);

    renderWithProviders(<CustomerPortalPage />);

    expect(await screen.findByText("CUST-SKU-321")).toBeInTheDocument();
    const searchButton = screen.getByRole("button", { name: /^Search$/i });
    await user.click(searchButton);

    expect(searchButton).toBeDisabled();
    expect(screen.getByRole("table", { name: /Inventory/i })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Loading records")).toBeInTheDocument();

    refreshInventory.resolve([]);
    await waitFor(() => {
      expect(searchButton).not.toBeDisabled();
    });
  });

  it("searches inventory and resets when the query is cleared", async () => {
    const user = userEvent.setup();
    getInventory
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    renderWithProviders(<CustomerPortalPage />);

    const searchInput = await screen.findByRole("searchbox");
    await user.type(searchInput, "CUST-SKU");
    await user.click(screen.getByRole("button", { name: /^Search$/i }));

    await waitFor(() => {
      expect(getInventory).toHaveBeenCalledWith("CUST-SKU", undefined);
    });

    await user.clear(searchInput);
    await waitFor(() => {
      expect(getInventory).toHaveBeenLastCalledWith("", undefined);
    });
  });

  it("shows an inventory error without exposing another portal module", async () => {
    getInventory.mockRejectedValue(new Error("Inventory is temporarily unavailable"));

    renderWithProviders(<CustomerPortalPage />);

    expect((await screen.findAllByText("Inventory is temporarily unavailable")).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Container lifecycle/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Outbound Orders/i)).not.toBeInTheDocument();
  });
});
