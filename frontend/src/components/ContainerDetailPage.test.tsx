import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../test/renderWithProviders";
import { createItem, createLocation, createMovement } from "../test/fixtures";
import { ContainerDetailPage } from "./ContainerDetailPage";

const { createInventoryAdjustment, createInventoryTransfer } = vi.hoisted(() => ({
  createInventoryAdjustment: vi.fn(),
  createInventoryTransfer: vi.fn()
}));

vi.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: { createInventoryAdjustment, createInventoryTransfer }
}));

const containerNo = "GCXU5817233";

function renderPage(overrides: Partial<ComponentProps<typeof ContainerDetailPage>> = {}) {
  const props: ComponentProps<typeof ContainerDetailPage> = {
    routeKey: `/container-contents/1/${containerNo}`,
    customerId: 1,
    containerNo,
    items: [createItem({ containerNo, quantity: 24, availableQty: 18, allocatedQty: 6, pallets: 3 })],
    movements: [createMovement({ containerNo, quantityChange: -4, pallets: 1 })],
    locations: [createLocation()],
    currentUserRole: "admin",
    isLoading: false,
    onRefresh: vi.fn().mockResolvedValue(undefined),
    onNavigate: vi.fn(),
    onBackToList: vi.fn(),
    ...overrides
  };
  renderWithProviders(<ContainerDetailPage {...props} />);
  return props;
}

describe("ContainerDetailPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem("sim-timezone", "UTC");
    createInventoryAdjustment.mockReset();
    createInventoryAdjustment.mockResolvedValue({});
    createInventoryTransfer.mockReset();
    createInventoryTransfer.mockResolvedValue({});
  });

  it("shows container-level quantity and pallet totals without a pallet manifest", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: containerNo })).toBeInTheDocument();
    expect(screen.getAllByText("24").length).toBeGreaterThan(0);
    expect(screen.getByText(/3 PALLETS/i)).toBeInTheDocument();
    expect(screen.getByText("VB22GC")).toBeInTheDocument();
    expect(screen.queryByText(/Pallet Code/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/PLT-/i)).not.toBeInTheDocument();
  });

  it("shows SKU and Item Number as separate values in contents and history", () => {
    renderPage({
      items: [createItem({ containerNo, sku: "SKU-CURRENT", itemNumber: "ITEM-CURRENT" })],
      movements: [createMovement({ containerNo, sku: "SKU-HISTORY", itemNumber: "ITEM-HISTORY" })]
    });

    expect(screen.getByText("SKU-CURRENT")).toBeInTheDocument();
    expect(screen.getByText("ITEM-CURRENT")).toBeInTheDocument();
    expect(screen.getByText("SKU-HISTORY")).toBeInTheDocument();
    expect(screen.getByText("ITEM-HISTORY")).toBeInTheDocument();
  });

  it.each([
    ["New Count Sheet", "cycle-counts", "sim-cycle-counts-context"]
  ] as const)("opens %s with the container scope", (buttonName, page, storageKey) => {
    const props = renderPage();

    fireEvent.click(screen.getByRole("button", { name: buttonName }));

    expect(props.onNavigate).toHaveBeenCalledWith(page);
    expect(JSON.parse(window.sessionStorage.getItem(storageKey) || "{}")).toMatchObject({ containerNo });
  });

  it("posts an adjustment directly from the selected container", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    renderPage({ onRefresh });

    fireEvent.click(screen.getByRole("button", { name: "Quick Adjustment" }));
    expect(screen.getByRole("heading", { name: /^Quick Adjustment/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Container No.")).not.toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "CORRECTION" }));
    fireEvent.change(screen.getByLabelText("Final Qty - 608333 - TEMP"), { target: { value: "23" } });
    fireEvent.click(screen.getByRole("button", { name: "Post Adjustment" }));

    await waitFor(() => expect(createInventoryAdjustment).toHaveBeenCalledTimes(1));
    expect(createInventoryAdjustment).toHaveBeenCalledWith(expect.objectContaining({
      reasonCode: "CORRECTION",
      lines: [expect.objectContaining({ containerNo, finalQty: 23, finalPallets: 3 })]
    }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });

  it("posts a transfer directly from the selected container", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    renderPage({
      items: [createItem({
        containerNo,
        locationId: 1,
        locationName: "New Jersey",
        storageSection: "TEMP",
        quantity: 24,
        availableQty: 24,
        allocatedQty: 0,
        pallets: 3,
        availablePallets: 3
      })],
      locations: [
        createLocation({ id: 1, name: "New Jersey", sectionNames: ["TEMP", "A"] }),
        createLocation({ id: 2, name: "Los Angeles", sectionNames: ["TEMP"] })
      ],
      onRefresh
    });

    fireEvent.click(screen.getByRole("button", { name: "Quick Transfer" }));
    expect(screen.getByRole("heading", { name: /^Quick Transfer/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Container No.")).not.toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: /Entire Container/ }));
    fireEvent.change(screen.getByLabelText("Destination Warehouse"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Post Transfer" }));

    await waitFor(() => expect(createInventoryTransfer).toHaveBeenCalledTimes(1));
    expect(createInventoryTransfer).toHaveBeenCalledWith(expect.objectContaining({
      entireContainer: expect.objectContaining({
        containerNo,
        toLocationId: 2
      })
    }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });

  it("shows only movements belonging to the selected container", () => {
    renderPage({
      movements: [
        createMovement({ id: 1, containerNo, description: "Selected container movement" }),
        createMovement({ id: 2, containerNo: "OTHER", description: "Other container movement" })
      ]
    });

    expect(screen.getByText(/Selected container movement/)).toBeInTheDocument();
    expect(screen.queryByText(/Other container movement/)).not.toBeInTheDocument();
  });

  it("hides inventory mutation actions from viewers", () => {
    renderPage({ currentUserRole: "viewer" });

    expect(screen.queryByRole("button", { name: "Quick Adjustment" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quick Transfer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New Count Sheet" })).not.toBeInTheDocument();
  });

  it("scopes contents, history, and quick operations by customer identity", () => {
    renderPage({
      customerId: 2,
      routeKey: `/container-contents/2/${containerNo}`,
      items: [
        createItem({ id: 1, customerId: 1, customerName: "Customer Alpha", sku: "SKU-C1", itemNumber: "SKU-C1", description: "Customer one goods", containerNo }),
        createItem({ id: 2, customerId: 2, customerName: "Customer Beta", sku: "SKU-C2", itemNumber: "SKU-C2", description: "Customer two goods", containerNo })
      ],
      movements: [
        createMovement({ id: 1, customerId: 1, customerName: "Customer Alpha", containerNo, description: "Customer one movement" }),
        createMovement({ id: 2, customerId: 2, customerName: "Customer Beta", containerNo, description: "Customer two movement" })
      ]
    });

    expect(screen.getByText("Customer two goods")).toBeInTheDocument();
    expect(screen.queryByText("Customer one goods")).not.toBeInTheDocument();
    expect(screen.getByText(/Customer two movement/)).toBeInTheDocument();
    expect(screen.queryByText(/Customer one movement/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Quick Adjustment" }));
    expect(screen.getByLabelText("Final Qty - SKU-C2 - TEMP")).toBeInTheDocument();
    expect(screen.queryByLabelText("Final Qty - SKU-C1 - TEMP")).not.toBeInTheDocument();
  });

  it("does not resolve an ambiguous legacy container-only route", () => {
    renderPage({
      customerId: null,
      routeKey: `/container-contents/${containerNo}`,
      items: [
        createItem({ id: 1, customerId: 1, customerName: "Customer Alpha", description: "Customer one goods", containerNo }),
        createItem({ id: 2, customerId: 2, customerName: "Customer Beta", description: "Customer two goods", containerNo })
      ]
    });

    expect(screen.getByText("No current or historical records matched this container number.")).toBeInTheDocument();
    expect(screen.queryByText("Customer one goods")).not.toBeInTheDocument();
    expect(screen.queryByText("Customer two goods")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quick Adjustment" })).not.toBeInTheDocument();
  });
});
