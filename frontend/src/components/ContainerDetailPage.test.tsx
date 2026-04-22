import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PalletContent, PalletTrace } from "../lib/types";
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

  it("renders current SKU cards and only the pallets assigned to the selected container", async () => {
    getPallets.mockResolvedValue([
      createPalletTrace({
        id: 11,
        palletCode: "PLT-001",
        currentContainerNo: "GCXU5817233",
        status: "OPEN",
        contents: [createPalletContent({ id: 21, palletId: 11, itemNumber: "608333", sku: "608333", description: "VB22GC", quantity: 6 })]
      }),
      createPalletTrace({
        id: 12,
        palletCode: "PLT-OTHER",
        currentContainerNo: "MSCU0000001",
        status: "OPEN",
        contents: [createPalletContent({ id: 22, palletId: 12, itemNumber: "999999", sku: "999999", description: "Other SKU", quantity: 3 })]
      })
    ]);

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

    expect(await screen.findByText("PLT-001")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "608333" })).toBeInTheDocument();
    expect(screen.queryByText("PLT-OTHER")).not.toBeInTheDocument();
    expect(getPallets).toHaveBeenCalledWith(300, "GCXU5817233");
  });

  it("navigates to cycle-counts and stores the container scope when New Count Sheet is clicked", async () => {
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

    await waitFor(() => expect(getPallets).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "New Count Sheet" }));

    expect(onNavigate).toHaveBeenCalledWith("cycle-counts");
    expect(JSON.parse(window.sessionStorage.getItem("sim-cycle-counts-context") ?? "{}")).toMatchObject({
      containerNo: "GCXU5817233"
    });
  });

  it("disables New Count Sheet when the container has historical activity but no current inventory", async () => {
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

    await waitFor(() => expect(getPallets).toHaveBeenCalled());

    expect(screen.getByRole("button", { name: "New Count Sheet" })).toBeDisabled();
  });

  it("shows only historical activity tied to the current container", async () => {
    getPallets.mockResolvedValue([]);
    getPalletLocationEvents.mockResolvedValue([
      {
        id: 91,
        palletId: 11,
        palletCode: "PLT-001",
        containerVisitId: 1,
        customerId: 1,
        customerName: "Imperial Bag & Paper",
        locationId: 1,
        locationName: "NJ",
        storageSection: "TEMP",
        containerNo: "GCXU5817233",
        eventType: "RECEIVED",
        quantityDelta: 6,
        palletDelta: 1,
        eventTime: "2026-04-01T08:45:00Z",
        createdAt: "2026-04-01T08:45:00Z"
      },
      {
        id: 92,
        palletId: 12,
        palletCode: "PLT-OTHER",
        containerVisitId: 2,
        customerId: 1,
        customerName: "Imperial Bag & Paper",
        locationId: 1,
        locationName: "NJ",
        storageSection: "TEMP",
        containerNo: "MSCU0000001",
        eventType: "RECEIVED",
        quantityDelta: 3,
        palletDelta: 1,
        eventTime: "2026-04-03T08:45:00Z",
        createdAt: "2026-04-03T08:45:00Z"
      }
    ]);

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
    expect(screen.getByText("PLT-001")).toBeInTheDocument();
    expect(screen.queryByText("PO-OTHER")).not.toBeInTheDocument();
    expect(screen.queryByText("PLT-OTHER")).not.toBeInTheDocument();
  });

  it("filters pallet trace cards by warehouse tab", async () => {
    getPallets.mockResolvedValue([
      createPalletTrace({
        id: 11,
        palletCode: "PLT-NJ",
        currentContainerNo: "GCXU5817233",
        currentLocationName: "NJ",
        currentStorageSection: "TEMP",
        status: "OPEN",
        contents: [createPalletContent({ id: 21, palletId: 11, quantity: 4 })]
      }),
      createPalletTrace({
        id: 12,
        palletCode: "PLT-LA",
        currentContainerNo: "GCXU5817233",
        currentLocationName: "LA",
        currentStorageSection: "BULK",
        status: "OPEN",
        contents: [createPalletContent({ id: 22, palletId: 12, quantity: 3 })]
      })
    ]);

    renderWithProviders(
      <ContainerDetailPage
        routeKey="/container-contents/GCXU5817233"
        containerNo="GCXU5817233"
        items={[createItem({ containerNo: "GCXU5817233" })]}
        movements={[createMovement({ containerNo: "GCXU5817233" })]}
        locations={[createLocation(), createLocation({ id: 2, name: "LA", sectionNames: ["TEMP", "BULK"] })]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onNavigate={vi.fn()}
        onBackToList={vi.fn()}
      />
    );

    expect(await screen.findByText("PLT-NJ")).toBeInTheDocument();
    expect(screen.getByText("PLT-LA")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /LA/i }));

    expect(await screen.findByText("PLT-LA")).toBeInTheDocument();
    expect(screen.queryByText("PLT-NJ")).not.toBeInTheDocument();
  });

  it("posts inventory adjustment using the selected pallet contents", async () => {
    const onNavigate = vi.fn();
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    getPallets.mockResolvedValue([
      createPalletTrace({
        id: 11,
        palletCode: "PLT-001",
        currentContainerNo: "GCXU5817233",
        status: "OPEN",
        contents: [createPalletContent({ id: 21, palletId: 11, quantity: 4 })]
      })
    ]);
    createInventoryAdjustment.mockResolvedValue({ id: 1 });

    renderWithProviders(
      <ContainerDetailPage
        routeKey="/container-contents/GCXU5817233"
        containerNo="GCXU5817233"
        items={[createItem({ containerNo: "GCXU5817233", customerId: 1, customerName: "Imperial Bag & Paper", sku: "608333", itemNumber: "608333" })]}
        movements={[createMovement({ containerNo: "GCXU5817233" })]}
        locations={[createLocation()]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={onRefresh}
        onNavigate={onNavigate}
        onBackToList={vi.fn()}
      />
    );

    await waitFor(() => expect(getPallets).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Inventory Adjustment" }));

    fireEvent.change(screen.getByLabelText("Reason Code"), { target: { value: "DAMAGE" } });
    fireEvent.click(screen.getByRole("button", { name: "Post Adjustment" }));

    await waitFor(() => {
      expect(createInventoryAdjustment).toHaveBeenCalledWith({
        reasonCode: "DAMAGE",
        notes: undefined,
        lines: [{
          customerId: 1,
          locationId: 1,
          storageSection: "TEMP",
          containerNo: "GCXU5817233",
          palletId: 11,
          skuMasterId: 1,
          adjustQty: -4,
          lineNote: undefined
        }]
      });
    });
    expect(onRefresh).toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(await screen.findByText("Adjustment saved successfully.")).toBeInTheDocument();
  });

  it("posts transfer inside the current page and shows success feedback", async () => {
    const onNavigate = vi.fn();
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    getPallets.mockResolvedValue([
      createPalletTrace({
        id: 12,
        palletCode: "PLT-002",
        currentContainerNo: "GCXU5817233",
        status: "OPEN",
        contents: [createPalletContent({ id: 22, palletId: 12, quantity: 3 })]
      })
    ]);
    createInventoryTransfer.mockResolvedValue({ id: 1 });

    renderWithProviders(
      <ContainerDetailPage
        routeKey="/container-contents/GCXU5817233"
        containerNo="GCXU5817233"
        items={[createItem({ containerNo: "GCXU5817233", availableQty: 8 })]}
        movements={[createMovement({ containerNo: "GCXU5817233" })]}
        locations={[createLocation(), createLocation({ id: 2, name: "LA", sectionNames: ["TEMP", "BULK"] })]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={onRefresh}
        onNavigate={onNavigate}
        onBackToList={vi.fn()}
      />
    );

    await waitFor(() => expect(getPallets).toHaveBeenCalled());

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
          containerNo: "GCXU5817233",
          palletId: 12,
          skuMasterId: 1,
          quantity: 3,
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

  it("paginates pallet cards and removes pallet-level action buttons", async () => {
    const onNavigate = vi.fn();
    getPallets.mockResolvedValue(
      Array.from({ length: 7 }, (_, index) => createPalletTrace({
        id: index + 1,
        palletCode: `PLT-00${index + 1}`,
        currentContainerNo: "GCXU5817233",
        status: "OPEN",
        contents: [createPalletContent({
          id: index + 101,
          palletId: index + 1,
          itemNumber: "608333",
          sku: "608333",
          description: "VB22GC",
          quantity: 1
        })]
      }))
    );

    renderWithProviders(
      <ContainerDetailPage
        routeKey="/container-contents/GCXU5817233"
        containerNo="GCXU5817233"
        items={[createItem({ containerNo: "GCXU5817233", sku: "608333", itemNumber: "608333" })]}
        movements={[createMovement({ containerNo: "GCXU5817233" })]}
        locations={[createLocation()]}
        currentUserRole="admin"
        isLoading={false}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onNavigate={onNavigate}
        onBackToList={vi.fn()}
      />
    );

    expect(await screen.findByText("PLT-001")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    expect(screen.queryByText("PLT-007")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View Trace" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next Page" }));

    expect(await screen.findByText("PLT-007")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    expect(screen.queryByText("PLT-001")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "View Trace" })).not.toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalledWith("pallet-trace");
  });
});

function createPalletContent(overrides: Partial<PalletContent> = {}): PalletContent {
  return {
    id: 1,
    palletId: 1,
    skuMasterId: 1,
    itemNumber: "608333",
    sku: "608333",
    description: "VB22GC",
    quantity: 6,
    allocatedQty: 0,
    damagedQty: 0,
    holdQty: 0,
    createdAt: "2026-04-01T08:30:00Z",
    updatedAt: "2026-04-01T08:30:00Z",
    ...overrides
  };
}

function createPalletTrace(overrides: Partial<PalletTrace> = {}): PalletTrace {
  return {
    id: 1,
    parentPalletId: 0,
    palletCode: "PLT-001",
    containerVisitId: 1,
    sourceInboundDocumentId: 1,
    sourceInboundLineId: 1,
    actualArrivalDate: "2026-04-01",
    customerId: 1,
    customerName: "Imperial Bag & Paper",
    skuMasterId: 1,
    sku: "608333",
    description: "VB22GC",
    currentLocationId: 1,
    currentLocationName: "NJ",
    currentStorageSection: "TEMP",
    currentContainerNo: "GCXU5817233",
    containerType: "NORMAL",
    status: "OPEN",
    createdAt: "2026-04-01T08:30:00Z",
    updatedAt: "2026-04-01T09:30:00Z",
    contents: [createPalletContent()],
    ...overrides
  };
}
