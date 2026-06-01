import { screen, waitFor, within } from "@testing-library/react";
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
      const [section, setSection] = useState<CustomerPortalSection>("picking-orders");
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
    expect(await screen.findByRole("button", { name: /Back to Picking Orders/i })).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: /Start Picking Order/i })).toBeInTheDocument();
    expect(screen.queryByLabelText("Picking Order No.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Submit Picking Order/i })).not.toBeInTheDocument();
  });

  it("opens the standalone picking order flow from the Picking Orders page", async () => {
    const user = userEvent.setup();

    function PortalHarness() {
      const [section, setSection] = useState<CustomerPortalSection>("picking-orders");
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
    await user.click(screen.getByRole("button", { name: /New Picking Order/i }));

    expect(await screen.findByText("Select inventory before creating a picking order.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Back to Inventory/i })).toBeInTheDocument();
  });

  it("summarizes customer work into clear overview action cards", async () => {
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

    expect(await screen.findByText("PL-CUST-42")).toBeInTheDocument();
    expect(screen.getByText("PL-CUST-43")).toBeInTheDocument();

    expect(within(screen.getByText("Packing List Inbound").closest("article") as HTMLElement).getByText("1")).toBeInTheDocument();
    expect(within(screen.getByText("Picking Order Status").closest("article") as HTMLElement).getByText("1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open inbound status/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open outbound status/i })).toBeInTheDocument();
    expect(screen.getAllByText("Awaiting BO").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
  });

  it("shows packing list receiving progress and read-only inbound documents", async () => {
    const user = userEvent.setup();

    function PortalHarness() {
      const [section, setSection] = useState<CustomerPortalSection>("packing-lists");
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
    expect(await screen.findByRole("button", { name: /Back to Packing Lists/i })).toBeInTheDocument();
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

    expect(await screen.findByText("PL-CUST-42")).toBeInTheDocument();
    expect(screen.getByText("Admin Portal Co")).toBeInTheDocument();
    expect(getInventory).toHaveBeenCalledWith("", 77);
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

  it("creates a picking order from customer inventory and uploads custom-named evidence files", async () => {
    const user = userEvent.setup();
    const inventoryItem = createItem({
      id: 88,
      skuMasterId: 321,
      itemNumber: "CUST-SKU-321",
      sku: "CUST-SKU-321",
      description: "Customer owned cartons",
      locationId: 11,
      locationName: "NJ",
      availableQty: 12,
      quantity: 12
    });
    const createdDocument = createOutboundDocument({
      id: 77,
      packingListNo: "PL-PORTAL-77",
      orderRef: "SO-PORTAL-77"
    });

    getInventory.mockResolvedValue([inventoryItem]);
    getPickingOrders
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([createdDocument]);
    createPickingOrder.mockResolvedValue(createdDocument);
    uploadPickingOrderAttachment.mockResolvedValue({
      id: 1,
      documentType: "OUTBOUND",
      documentId: 77,
      displayName: "placeholder",
      originalFileName: "placeholder.pdf",
      contentType: "application/pdf",
      sizeBytes: 12,
      uploadedByUserId: 5,
      createdAt: "2026-03-24T10:00:00Z"
    });

    function PortalHarness() {
      const [section, setSection] = useState<CustomerPortalSection>("inventory");
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
            customerId: 99,
            customerName: "Customer Portal Co",
            createdAt: "2026-03-24T10:00:00Z"
          }}
        />
      );
    }

    renderWithProviders(<PortalHarness />);

    expect(await screen.findByText("CUST-SKU-321")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Start Picking Order/i }));
    expect(await screen.findByText("Selected Inventory")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Picking Order No."), "PL-PORTAL-77");
    await user.type(screen.getByLabelText("Order Ref."), "SO-PORTAL-77");
    await user.type(screen.getByLabelText("Ship-to Name"), "Receiver Dock");

    const fileInput = document.querySelector<HTMLInputElement>("input[type='file']");
    expect(fileInput).not.toBeNull();
    const packingListPdf = new File(["%PDF-packing-list"], "customer-pl.pdf", { type: "application/pdf" });
    const boImage = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "bo.png", { type: "image/png" });
    await user.upload(fileInput as HTMLInputElement, [packingListPdf, boImage]);

    const displayNameInputs = screen.getAllByLabelText("Display Name");
    await user.clear(displayNameInputs[0]);
    await user.type(displayNameInputs[0], "Customer Picking Order");
    await user.clear(displayNameInputs[1]);
    await user.type(displayNameInputs[1], "Signed BO Proof");

    await user.click(screen.getByRole("button", { name: /Submit Picking Order/i }));

    await waitFor(() => {
      expect(createPickingOrder).toHaveBeenCalledWith(expect.objectContaining({
        packingListNo: "PL-PORTAL-77",
        orderRef: "SO-PORTAL-77",
        shipToName: "Receiver Dock",
        lines: [
          expect.objectContaining({
            customerId: 99,
            locationId: 11,
            skuMasterId: 321,
            quantity: 1
          })
        ]
      }), undefined);
    });
    expect(uploadPickingOrderAttachment).toHaveBeenNthCalledWith(1, 77, packingListPdf, "Customer Picking Order", undefined);
    expect(uploadPickingOrderAttachment).toHaveBeenNthCalledWith(2, 77, boImage, "Signed BO Proof", undefined);
    expect(await screen.findByText(/PL-PORTAL-77/)).toBeInTheDocument();
  });

  it("keeps failed picking order attachments visible on the documents tab after submit", async () => {
    const user = userEvent.setup();
    const inventoryItem = createItem({
      id: 89,
      skuMasterId: 322,
      itemNumber: "RETRY-SKU-322",
      sku: "RETRY-SKU-322",
      locationId: 11,
      locationName: "NJ",
      availableQty: 6,
      quantity: 6
    });
    const createdDocument = createOutboundDocument({
      id: 78,
      packingListNo: "PL-RETRY-78",
      orderRef: "SO-RETRY-78"
    });

    getInventory.mockResolvedValue([inventoryItem]);
    getPickingOrders
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([createdDocument]);
    createPickingOrder.mockResolvedValue(createdDocument);
    uploadPickingOrderAttachment.mockRejectedValue(new Error("upload failed"));

    function PortalHarness() {
      const [section, setSection] = useState<CustomerPortalSection>("inventory");
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
            customerId: 99,
            customerName: "Customer Portal Co",
            createdAt: "2026-03-24T10:00:00Z"
          }}
        />
      );
    }

    renderWithProviders(<PortalHarness />);

    expect(await screen.findByText("RETRY-SKU-322")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Start Picking Order/i }));
    await user.type(screen.getByLabelText("Picking Order No."), "PL-RETRY-78");

    const fileInput = document.querySelector<HTMLInputElement>("input[type='file']");
    expect(fileInput).not.toBeNull();
    const proofFile = new File(["retry"], "retry-proof.pdf", { type: "application/pdf" });
    await user.upload(fileInput as HTMLInputElement, proofFile);

    await user.click(screen.getByRole("button", { name: /Submit Picking Order/i }));

    expect(await screen.findByText(/some files could not upload/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Attachments/i })).toHaveAttribute("aria-selected", "true");
    });
    expect(screen.getByText("retry-proof.pdf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Upload$/i })).toBeInTheDocument();
  });

  it("blocks picking order quantities above available customer inventory before submit", async () => {
    const user = userEvent.setup();
    getInventory.mockResolvedValue([
      createItem({
        id: 91,
        skuMasterId: 901,
        itemNumber: "LIMITED-SKU",
        sku: "LIMITED-SKU",
        availableQty: 2,
        quantity: 2
      })
    ]);
    getPickingOrders.mockResolvedValue([]);

    function PortalHarness() {
      const [section, setSection] = useState<CustomerPortalSection>("inventory");
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
            customerId: 99,
            customerName: "Customer Portal Co",
            createdAt: "2026-03-24T10:00:00Z"
          }}
        />
      );
    }

    renderWithProviders(<PortalHarness />);

    expect(await screen.findByText("LIMITED-SKU")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Start Picking Order/i }));

    const quantityInput = screen.getByRole("spinbutton");
    await user.clear(quantityInput);
    await user.type(quantityInput, "3");
    await user.click(screen.getByRole("button", { name: /Submit Picking Order/i }));

    expect((await screen.findAllByText("Requested quantity cannot exceed available inventory.")).length).toBeGreaterThan(0);
    expect(createPickingOrder).not.toHaveBeenCalled();
  });
});
