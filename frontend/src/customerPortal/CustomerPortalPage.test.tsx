import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CustomerPortalPage } from "./CustomerPortalPage";
import type { CustomerPortalSection } from "./navigation";
import { createCustomer, createInboundDocument, createInboundDocumentLine, createItem, createOutboundDocument } from "../test/fixtures";
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
    getPackingLists.mockReset();
    getPickingOrders.mockReset();
    uploadPickingOrderAttachment.mockReset();
    getPickingOrderAttachmentDownloadUrl.mockReset();
    getPackingListAttachmentDownloadUrl.mockReset();
    deletePickingOrderAttachment.mockReset();
    createPickingOrder.mockReset();

    getInventory.mockResolvedValue([]);
    getPackingLists.mockResolvedValue([
      createInboundDocument({
        id: 11,
        containerNo: "CNT-CUST-11",
        trackingStatus: "RECEIVING",
        totalExpectedQty: 24,
        totalReceivedQty: 12,
        lines: [
          createInboundDocumentLine({
            id: 111,
            documentId: 11,
            sku: "INBOUND-SKU-11",
            expectedQty: 24,
            receivedQty: 12
          })
        ],
        attachments: [
          {
            id: 8,
            documentType: "INBOUND",
            documentId: 11,
            displayName: "Customer Packing List.pdf",
            originalFileName: "packing-list.pdf",
            contentType: "application/pdf",
            sizeBytes: 1024,
            uploadedByUserId: 5,
            createdAt: "2026-03-24T10:00:00Z"
          }
        ]
      }),
      createInboundDocument({
        id: 12,
        containerNo: "CNT-CUST-12",
        status: "CONFIRMED",
        trackingStatus: "RECEIVED"
      })
    ]);
    getPickingOrders.mockResolvedValue([
      createOutboundDocument({
        id: 42,
        packingListNo: "PL-CUST-42",
        attachments: [
          {
            id: 9,
            documentType: "OUTBOUND",
            documentId: 42,
            displayName: "Customer BO.pdf",
            originalFileName: "bo.pdf",
            contentType: "application/pdf",
            sizeBytes: 2048,
            uploadedByUserId: 5,
            createdAt: "2026-03-24T10:00:00Z"
          }
        ]
      }),
      createOutboundDocument({
        id: 43,
        packingListNo: "PL-CUST-43",
        trackingStatus: "BO_RECEIVED"
      })
    ]);
  });

  it("shows picking order attachments from the detail Documents tab", async () => {
    const user = userEvent.setup();

    function PortalHarness() {
      const [section, setSection] = useState<CustomerPortalSection>("outbound-orders");
      return (
        <CustomerPortalPage
          activeSection={section}
          onSectionChange={setSection}
          currentUser={{
            id: 5,
            email: "customer@example.com",
            fullName: "Customer User",
            role: "customer",
            isActive: true,
            customerId: 1,
            customerName: "Imperial Bag & Paper",
            createdAt: "2026-03-24T10:00:00Z"
          }}
        />
      );
    }

    renderWithProviders(<PortalHarness />);

    expect(await screen.findByText("PL-CUST-42")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Details PL-CUST-42/i }));
    expect(await screen.findByRole("button", { name: /Back to Outbound Orders/i })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Attachments/i }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Attachments/i })).toHaveAttribute("aria-selected", "true");
    });
    expect(screen.getByText("Customer BO.pdf")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Add Files/i }).length).toBeGreaterThan(0);
  });

  it("keeps inventory as a single-purpose stock view", async () => {
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

    renderWithProviders(
      <CustomerPortalPage
        activeSection="inventory"
        currentUser={{
          id: 5,
          email: "customer@example.com",
          fullName: "Customer User",
          role: "customer",
          isActive: true,
          customerId: 1,
          customerName: "Imperial Bag & Paper",
          createdAt: "2026-03-24T10:00:00Z"
        }}
      />
    );

    expect(await screen.findByText("CUST-SKU-321")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Search$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Start Outbound Order/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Picking Order #")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Submit Outbound Order/i })).not.toBeInTheDocument();
  });

  it("disables inventory search and shows a table loading indicator while refreshing", async () => {
    const user = userEvent.setup();
    const refreshInventory = createDeferred<ReturnType<typeof createItem>[]>();
    getInventory
      .mockResolvedValueOnce([
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
      ])
      .mockReturnValueOnce(refreshInventory.promise);

    renderWithProviders(
      <CustomerPortalPage
        activeSection="inventory"
        currentUser={{
          id: 5,
          email: "customer@example.com",
          fullName: "Customer User",
          role: "customer",
          isActive: true,
          customerId: 1,
          customerName: "Imperial Bag & Paper",
          createdAt: "2026-03-24T10:00:00Z"
        }}
      />
    );

    expect(await screen.findByText("CUST-SKU-321")).toBeInTheDocument();

    const searchButton = screen.getByRole("button", { name: /^Search$/i });
    await user.click(searchButton);

    expect(searchButton).toBeDisabled();
    expect(searchButton).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("table", { name: /Inventory/i })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Loading records")).toBeInTheDocument();
    expect(screen.queryByText("CUST-SKU-321")).not.toBeInTheDocument();

    refreshInventory.resolve([]);

    await waitFor(() => {
      expect(searchButton).not.toBeDisabled();
    });
  });

  it("hides standalone outbound order creation from the Outbound Orders page", async () => {
    renderWithProviders(
      <CustomerPortalPage
        activeSection="outbound-orders"
        currentUser={{
          id: 5,
          email: "customer@example.com",
          fullName: "Customer User",
          role: "customer",
          isActive: true,
          customerId: 1,
          customerName: "Imperial Bag & Paper",
          createdAt: "2026-03-24T10:00:00Z"
        }}
      />
    );

    expect(await screen.findByText("PL-CUST-42")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Search$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New Outbound Order/i })).not.toBeInTheDocument();
  });

  it("defaults to the inventory lookup as the first customer portal feature", async () => {
    getInventory.mockResolvedValue([
      createItem({
        id: 90,
        skuMasterId: 323,
        itemNumber: "DEFAULT-SKU-323",
        sku: "DEFAULT-SKU-323",
        locationName: "NJ",
        availableQty: 4,
        quantity: 4
      })
    ]);

    renderWithProviders(
      <CustomerPortalPage
        currentUser={{
          id: 5,
          email: "customer@example.com",
          fullName: "Customer User",
          role: "customer",
          isActive: true,
          customerId: 1,
          customerName: "Imperial Bag & Paper",
          createdAt: "2026-03-24T10:00:00Z"
        }}
      />
    );

    expect(await screen.findByText("DEFAULT-SKU-323")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /Inventory/i })).toBeInTheDocument();
    expect(screen.queryByText("PL-CUST-42")).not.toBeInTheDocument();
  });

  it("filters and paginates inventory, then resets search when the input is cleared", async () => {
    const user = userEvent.setup();
    const inventoryRows = Array.from({ length: 12 }, (_, index) => {
      const itemNo = index + 1;
      const isCalifornia = itemNo > 10;
      return createItem({
        id: 200 + itemNo,
        skuMasterId: 900 + itemNo,
        itemNumber: `SKU-PAGE-${String(itemNo).padStart(2, "0")}`,
        sku: `SKU-PAGE-${String(itemNo).padStart(2, "0")}`,
        description: `Paged inventory ${itemNo}`,
        locationId: isCalifornia ? 22 : 11,
        locationName: isCalifornia ? "CA" : "NJ",
        availableQty: isCalifornia ? 0 : itemNo,
        quantity: itemNo
      });
    });
    getInventory.mockResolvedValue(inventoryRows);

    renderWithProviders(
      <CustomerPortalPage
        activeSection="inventory"
        currentUser={{
          id: 5,
          email: "customer@example.com",
          fullName: "Customer User",
          role: "customer",
          isActive: true,
          customerId: 1,
          customerName: "Imperial Bag & Paper",
          createdAt: "2026-03-24T10:00:00Z"
        }}
      />
    );

    expect(await screen.findByText("SKU-PAGE-01")).toBeInTheDocument();
    expect(screen.queryByText("SKU-PAGE-11")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Next Page/i }));
    expect(screen.getByText("SKU-PAGE-11")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Warehouse"), "22");
    expect(screen.getByText("SKU-PAGE-12")).toBeInTheDocument();
    expect(screen.queryByText("SKU-PAGE-01")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Inventory status"), "available");
    expect(screen.getByText("No inventory rows match the current filters.")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Inventory status"), "all");
    const searchInput = screen.getByLabelText("Search");
    await user.type(searchInput, "cartons");
    await user.click(screen.getByRole("button", { name: /^Search$/i }));
    await waitFor(() => {
      expect(getInventory).toHaveBeenLastCalledWith("cartons", undefined);
    });

    await user.clear(searchInput);
    await waitFor(() => {
      expect(getInventory).toHaveBeenLastCalledWith("", undefined);
    });
  });

  it("shows inbound shipment receiving progress and read-only inbound documents", async () => {
    const user = userEvent.setup();

    function PortalHarness() {
      const [section, setSection] = useState<CustomerPortalSection>("inbound-shipments");
      return (
        <CustomerPortalPage
          activeSection={section}
          onSectionChange={setSection}
          currentUser={{
            id: 5,
            email: "customer@example.com",
            fullName: "Customer User",
            role: "customer",
            isActive: true,
            customerId: 1,
            customerName: "Imperial Bag & Paper",
            createdAt: "2026-03-24T10:00:00Z"
          }}
        />
      );
    }

    renderWithProviders(<PortalHarness />);

    expect((await screen.findAllByText("CNT-CUST-11")).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: /Details CNT-CUST-11/i }));
    expect(await screen.findByRole("button", { name: /Back to Inbound Shipments/i })).toBeInTheDocument();
    expect(screen.getByText("INBOUND-SKU-11")).toBeInTheDocument();
    expect(screen.getAllByText("Receiving / Received").length).toBeGreaterThan(0);
    expect(screen.getAllByText("12 CTN").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("tab", { name: /Attachments/i }));

    expect(await screen.findByText("Customer Packing List.pdf")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add Files/i })).not.toBeInTheDocument();
  });

  it("loads admin-scoped portal data for a selected customer", async () => {
    const portalCustomer = createCustomer({ id: 77, name: "Admin Portal Co" });

    renderWithProviders(
      <CustomerPortalPage
        currentUser={{
          id: 1,
          email: "admin@example.com",
          fullName: "Admin User",
          role: "admin",
          isActive: true,
          customerId: 0,
          customerName: "",
          createdAt: "2026-03-24T10:00:00Z"
        }}
        portalCustomerId={portalCustomer.id}
        portalCustomerName={portalCustomer.name}
      />
    );

    await waitFor(() => {
      expect(getInventory).toHaveBeenCalledWith("", 77);
    });
    expect(getPackingLists).toHaveBeenCalledWith(100, {
      search: "",
      status: "all",
      trackingStatus: "all"
    }, 77);
    expect(getPickingOrders).toHaveBeenCalledWith(100, {
      search: "",
      status: "all",
      trackingStatus: "all"
    }, 77);
  });

});
