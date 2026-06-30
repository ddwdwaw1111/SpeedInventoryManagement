import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../test/renderWithProviders";
import { createItem, createLocation, createMovement } from "../test/fixtures";
import { ContainerDetailPage } from "./ContainerDetailPage";

const { getPallets } = vi.hoisted(() => ({
  getPallets: vi.fn()
}));

const { getPalletLocationEvents } = vi.hoisted(() => ({
  getPalletLocationEvents: vi.fn()
}));

const { createInventoryAdjustment, createInventoryTransfer } = vi.hoisted(() => ({
  createInventoryAdjustment: vi.fn(),
  createInventoryTransfer: vi.fn()
}));

vi.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    getPallets,
    getPalletLocationEvents,
    createInventoryAdjustment,
    createInventoryTransfer
  }
}));

describe("ContainerDetailPage", () => {
  beforeEach(() => {
    getPallets.mockReset();
    getPalletLocationEvents.mockReset();
    createInventoryAdjustment.mockReset();
    createInventoryTransfer.mockReset();
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem("sim-timezone", "UTC");
    getPalletLocationEvents.mockResolvedValue([]);
  });

  it("renders current SKU cards without loading pallet UI data", async () => {
    renderWithProviders(
      <ContainerDetailPage
        routeKey="/container-contents/GCXU5817233"
        containerNo="GCXU5817233"
        items={[
          createItem({
            id: 1,
            containerNo: "GCXU5817233",
            sku: "608333",
            itemNumber: "608333",
            description: "VB22GC",
            quantity: 6,
            availableQty: 5,
            damagedQty: 1
          })
        ]}
        movements={[
          createMovement({
            id: 1,
            containerNo: "GCXU5817233",
            movementType: "IN",
            quantityChange: 6,
            createdAt: "2026-04-01T08:30:00Z"
          })
        ]}
        locations={[createLocation()]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onNavigate={vi.fn()}
        onBackToList={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "608333" })).toBeInTheDocument();
    expect(screen.queryByText("PLT-001")).not.toBeInTheDocument();
    expect(getPallets).not.toHaveBeenCalled();
  });

  it("does not show cycle count actions", async () => {
    const onNavigate = vi.fn();
    getPallets.mockResolvedValue([]);

    renderWithProviders(
      <ContainerDetailPage
        routeKey="/container-contents/GCXU5817233"
        containerNo="GCXU5817233"
        items={[createItem({ containerNo: "GCXU5817233" })]}
        movements={[createMovement({ containerNo: "GCXU5817233" })]}
        locations={[createLocation()]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onNavigate={onNavigate}
        onBackToList={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: "New Count Sheet" })).not.toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalledWith("cycle-counts");
    expect(window.sessionStorage.getItem("sim-cycle-counts-context")).toBeNull();
  });

  it("keeps cycle count actions hidden when the container has historical activity but no current inventory", async () => {
    getPallets.mockResolvedValue([]);

    renderWithProviders(
      <ContainerDetailPage
        routeKey="/container-contents/GCXU5817233"
        containerNo="GCXU5817233"
        items={[]}
        movements={[createMovement({ containerNo: "GCXU5817233", movementType: "OUT" })]}
        locations={[createLocation()]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onNavigate={vi.fn()}
        onBackToList={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: "New Count Sheet" })).not.toBeInTheDocument();
  });

  it("shows only historical activity tied to the current container", async () => {
    getPallets.mockResolvedValue([]);

    renderWithProviders(
      <ContainerDetailPage
        routeKey="/container-contents/GCXU5817233"
        containerNo="GCXU5817233"
        items={[createItem({ containerNo: "GCXU5817233" })]}
        movements={[
          createMovement({
            id: 1,
            containerNo: "GCXU5817233",
            movementType: "IN",
            orderRef: "PO-882910",
            createdAt: "2026-04-01T08:30:00Z"
          }),
          createMovement({
            id: 2,
            containerNo: "GCXU5817233",
            movementType: "OUT",
            orderRef: "SO-99125",
            createdAt: "2026-04-02T14:10:00Z"
          }),
          createMovement({
            id: 3,
            containerNo: "MSCU0000001",
            movementType: "IN",
            orderRef: "PO-OTHER",
            createdAt: "2026-04-03T08:30:00Z"
          })
        ]}
        locations={[createLocation()]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onNavigate={vi.fn()}
        onBackToList={vi.fn()}
      />
    );

    expect(await screen.findByText("Container Activity History")).toBeInTheDocument();
    expect(screen.getByText("PO-882910")).toBeInTheDocument();
    expect(screen.getByText("SO-99125")).toBeInTheDocument();
    expect(screen.queryByText("PO-OTHER")).not.toBeInTheDocument();
  });

  it("posts transfer inside the current page and shows success feedback", async () => {
    const onNavigate = vi.fn();
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    createInventoryTransfer.mockResolvedValue({ id: 1 });

    renderWithProviders(
      <ContainerDetailPage
        routeKey="/container-contents/GCXU5817233"
        containerNo="GCXU5817233"
        items={[createItem({ containerId: 101, containerNo: "GCXU5817233", quantity: 8, availableQty: 8, pallets: 1 })]}
        movements={[createMovement({ containerNo: "GCXU5817233" })]}
        locations={[createLocation(), createLocation({ id: 2, name: "LA", sectionNames: ["TEMP", "BULK"] })]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={onRefresh}
        onNavigate={onNavigate}
        onBackToList={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Inventory Transfer" }));
    fireEvent.change(screen.getByLabelText("Destination Warehouse"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Post Transfer" }));

    await waitFor(() => {
      expect(createInventoryTransfer).toHaveBeenCalledWith({
        notes: undefined,
        lines: [{
          customerId: 1,
          locationId: 1,
          storageSection: "TEMP",
          containerId: 101,
          containerNo: "GCXU5817233",
          skuMasterId: 1,
          quantity: 8,
          pallets: 1,
          toLocationId: 2,
          toStorageSection: "TEMP",
          lineNote: undefined
        }]
      });
    });
    expect(onRefresh).toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(await screen.findByText("Transfer saved successfully.")).toBeInTheDocument();
  });

  it("posts aggregate SKU rows from the transfer dialog", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    createInventoryTransfer.mockResolvedValue({ id: 2 });

    renderWithProviders(
      <ContainerDetailPage
        routeKey="/container-contents/GCXU5817233"
        containerNo="GCXU5817233"
        items={[
          createItem({ id: 1, containerId: 101, containerNo: "GCXU5817233", skuMasterId: 1, sku: "608333", quantity: 4, availableQty: 4, pallets: 1 }),
          createItem({ id: 2, containerId: 101, containerNo: "GCXU5817233", skuMasterId: 2, sku: "999999", quantity: 3, availableQty: 3, pallets: 1 })
        ]}
        movements={[createMovement({ containerNo: "GCXU5817233" })]}
        locations={[createLocation(), createLocation({ id: 2, name: "LA", sectionNames: ["TEMP", "BULK"] })]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={onRefresh}
        onNavigate={vi.fn()}
        onBackToList={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Inventory Transfer" }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText("Destination Warehouse"), { target: { value: "2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Post Transfer" }));

    await waitFor(() => {
      expect(createInventoryTransfer).toHaveBeenCalledWith({
        notes: undefined,
        lines: [
          {
            customerId: 1,
            locationId: 1,
            storageSection: "TEMP",
            containerId: 101,
            containerNo: "GCXU5817233",
            skuMasterId: 1,
            quantity: 4,
            pallets: 1,
            toLocationId: 2,
            toStorageSection: "TEMP",
            lineNote: undefined
          },
          {
            customerId: 1,
            locationId: 1,
            storageSection: "TEMP",
            containerId: 101,
            containerNo: "GCXU5817233",
            skuMasterId: 2,
            quantity: 3,
            pallets: 1,
            toLocationId: 2,
            toStorageSection: "TEMP",
            lineNote: undefined
          }
        ]
      });
    });
    expect(onRefresh).toHaveBeenCalled();
  });

  it("skips partial pallet-bearing SKU rows in the transfer dialog", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    createInventoryTransfer.mockResolvedValue({ id: 3 });

    renderWithProviders(
      <ContainerDetailPage
        routeKey="/container-contents/GCXU5817233"
        containerNo="GCXU5817233"
        items={[
          createItem({ id: 1, containerId: 101, containerNo: "GCXU5817233", skuMasterId: 1, sku: "PARTIAL", quantity: 10, availableQty: 6, pallets: 2 }),
          createItem({ id: 2, containerId: 101, containerNo: "GCXU5817233", skuMasterId: 2, sku: "FULL", quantity: 3, availableQty: 3, pallets: 1 })
        ]}
        movements={[createMovement({ containerNo: "GCXU5817233" })]}
        locations={[createLocation(), createLocation({ id: 2, name: "LA", sectionNames: ["TEMP", "BULK"] })]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={onRefresh}
        onNavigate={vi.fn()}
        onBackToList={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Inventory Transfer" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).queryByText("PARTIAL")).not.toBeInTheDocument();
    expect(within(dialog).getByText("FULL")).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("Destination Warehouse"), { target: { value: "2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Post Transfer" }));

    await waitFor(() => {
      expect(createInventoryTransfer).toHaveBeenCalledWith({
        notes: undefined,
        lines: [{
          customerId: 1,
          locationId: 1,
          storageSection: "TEMP",
          containerId: 101,
          containerNo: "GCXU5817233",
          skuMasterId: 2,
          quantity: 3,
          pallets: 1,
          toLocationId: 2,
          toStorageSection: "TEMP",
          lineNote: undefined
        }]
      });
    });
    expect(onRefresh).toHaveBeenCalled();
  });

});
