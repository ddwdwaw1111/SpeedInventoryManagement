import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CustomerPortalPage } from "./CustomerPortalPage";
import type { CustomerPortalSection } from "./navigation";
import { createItem } from "../test/fixtures";
import { renderWithProviders } from "../test/renderWithProviders";

const {
  getInventory,
  getPackingLists,
  getPickingOrders,
  uploadPickingOrderAttachment,
  getPickingOrderAttachmentDownloadUrl,
  getPackingListAttachmentDownloadUrl,
  deletePickingOrderAttachment,
  createPickingOrder
} = vi.hoisted(() => ({
  getInventory: vi.fn(),
  getPackingLists: vi.fn(),
  getPickingOrders: vi.fn(),
  uploadPickingOrderAttachment: vi.fn(),
  getPickingOrderAttachmentDownloadUrl: vi.fn(),
  getPackingListAttachmentDownloadUrl: vi.fn(),
  deletePickingOrderAttachment: vi.fn(),
  createPickingOrder: vi.fn()
}));

vi.mock("./api", () => ({
  customerPortalApi: {
    getInventory,
    getPackingLists,
    getPickingOrders,
    uploadPickingOrderAttachment,
    getPickingOrderAttachmentDownloadUrl,
    getPackingListAttachmentDownloadUrl,
    deletePickingOrderAttachment,
    createPickingOrder
  }
}));

const customerUser = {
  id: 5,
  email: "customer@example.com",
  fullName: "Customer User",
  role: "customer",
  isActive: true,
  customerId: 1,
  customerName: "Imperial Bag & Paper",
  createdAt: "2026-03-24T10:00:00Z"
} as const;

const adminUser = {
  id: 1,
  email: "admin@example.com",
  fullName: "Admin User",
  role: "admin",
  isActive: true,
  customerId: 0,
  customerName: "",
  createdAt: "2026-03-24T10:00:00Z"
} as const;

describe("CustomerPortalPage", () => {
  beforeEach(() => {
    getInventory.mockReset();
    getPackingLists.mockReset();
    getPickingOrders.mockReset();
    uploadPickingOrderAttachment.mockReset();
    getPickingOrderAttachmentDownloadUrl.mockReset();
    getPackingListAttachmentDownloadUrl.mockReset();
    deletePickingOrderAttachment.mockReset();
    createPickingOrder.mockReset();

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
        quantity: 12
      })
    ]);
    getPackingLists.mockResolvedValue([]);
    getPickingOrders.mockResolvedValue([]);
  });

  function renderPortal(activeSection?: CustomerPortalSection, portalCustomerId?: number) {
    return renderWithProviders(
      <CustomerPortalPage
        activeSection={activeSection}
        currentUser={portalCustomerId ? adminUser : customerUser}
        portalCustomerId={portalCustomerId}
        portalCustomerName={portalCustomerId ? "Admin Portal Co" : undefined}
      />
    );
  }

  it("renders inventory lookup as the only customer portal feature", async () => {
    renderPortal("inventory");

    expect(await screen.findByText("CUST-SKU-321")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /Inventory/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Start Outbound Order/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Outbound Orders/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Inbound Shipments/i)).not.toBeInTheDocument();
    expect(getPackingLists).not.toHaveBeenCalled();
    expect(getPickingOrders).not.toHaveBeenCalled();
  });

  it("falls back to inventory when a hidden legacy section is requested", async () => {
    renderPortal("outbound-orders");

    expect(await screen.findByText("CUST-SKU-321")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /Inventory/i })).toBeInTheDocument();
    expect(screen.queryByText(/Select an outbound order/i)).not.toBeInTheDocument();
    expect(getPackingLists).not.toHaveBeenCalled();
    expect(getPickingOrders).not.toHaveBeenCalled();
  });

  it("loads admin-scoped inventory for the selected customer only", async () => {
    renderPortal("inventory", 77);

    await waitFor(() => {
      expect(getInventory).toHaveBeenCalledWith("", 77);
    });
    expect(getPackingLists).not.toHaveBeenCalled();
    expect(getPickingOrders).not.toHaveBeenCalled();
  });

  it("applies inventory search against the active customer scope", async () => {
    renderPortal("inventory", 77);

    expect(await screen.findByText("CUST-SKU-321")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: /Search/i }), {
      target: { value: "FILTER-SKU" }
    });
    fireEvent.click(screen.getByRole("button", { name: /Apply/i }));

    await waitFor(() => {
      expect(getInventory).toHaveBeenLastCalledWith("FILTER-SKU", 77);
    });
    expect(getPackingLists).not.toHaveBeenCalled();
    expect(getPickingOrders).not.toHaveBeenCalled();
  });
});
