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
    routeKey: `/container-contents/${containerNo}`,
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
});
