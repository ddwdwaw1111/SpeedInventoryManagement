import { fireEvent, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../test/renderWithProviders";
import { createItem, createLocation, createMovement } from "../test/fixtures";
import { ContainerDetailPage } from "./ContainerDetailPage";

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
    ["Inventory Adjustment", "adjustments", "sim-adjustments-context"],
    ["Inventory Transfer", "transfers", "sim-transfers-context"],
    ["New Count Sheet", "cycle-counts", "sim-cycle-counts-context"]
  ] as const)("opens %s with the container scope", (buttonName, page, storageKey) => {
    const props = renderPage();

    fireEvent.click(screen.getByRole("button", { name: buttonName }));

    expect(props.onNavigate).toHaveBeenCalledWith(page);
    expect(JSON.parse(window.sessionStorage.getItem(storageKey) || "{}")).toMatchObject({ containerNo });
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

    expect(screen.queryByRole("button", { name: "Inventory Adjustment" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Inventory Transfer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New Count Sheet" })).not.toBeInTheDocument();
  });
});
