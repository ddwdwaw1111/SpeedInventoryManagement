import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CustomerPortalPage } from "./CustomerPortalPage";
import { createCustomer, createItem, createOutboundDocument } from "../test/fixtures";
import { renderWithProviders } from "../test/renderWithProviders";

const {
  getInventory,
  getPackingLists,
  uploadPackingListAttachment,
  getPackingListAttachmentDownloadUrl,
  deletePackingListAttachment,
  createPackingList
} = vi.hoisted(() => ({
  getInventory: vi.fn(),
  getPackingLists: vi.fn(),
  uploadPackingListAttachment: vi.fn(),
  getPackingListAttachmentDownloadUrl: vi.fn(),
  deletePackingListAttachment: vi.fn(),
  createPackingList: vi.fn()
}));

vi.mock("./api", () => ({
  customerPortalApi: {
    getInventory,
    getPackingLists,
    uploadPackingListAttachment,
    getPackingListAttachmentDownloadUrl,
    deletePackingListAttachment,
    createPackingList
  }
}));

describe("CustomerPortalPage", () => {
  beforeEach(() => {
    getInventory.mockReset();
    getPackingLists.mockReset();
    uploadPackingListAttachment.mockReset();
    getPackingListAttachmentDownloadUrl.mockReset();
    deletePackingListAttachment.mockReset();
    createPackingList.mockReset();

    getInventory.mockResolvedValue([]);
    getPackingLists.mockResolvedValue([
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

  it("shows packing list attachments from the detail Documents tab", async () => {
    const user = userEvent.setup();

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
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("tab", { name: /Attachments/i }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Attachments/i })).toHaveAttribute("aria-selected", "true");
    });
    expect(screen.getByText("Customer BO.pdf")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Add Files/i }).length).toBeGreaterThan(0);
  });

  it("summarizes open and BO-completed packing lists for the customer", async () => {
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

    expect(within(screen.getByText("Open PLs").closest("article") as HTMLElement).getByText("1")).toBeInTheDocument();
    expect(within(screen.getByText("Completed PLs").closest("article") as HTMLElement).getByText("1")).toBeInTheDocument();
    expect(screen.getAllByText("Awaiting BO").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
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
  });

  it("creates a packing list from customer inventory and uploads custom-named evidence files", async () => {
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
    getPackingLists
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([createdDocument]);
    createPackingList.mockResolvedValue(createdDocument);
    uploadPackingListAttachment.mockResolvedValue({
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

    renderWithProviders(
      <CustomerPortalPage
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

    expect(await screen.findByText("CUST-SKU-321")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Add to PL/i }));

    await user.type(screen.getByLabelText("Packing List No."), "PL-PORTAL-77");
    await user.type(screen.getByLabelText("Order Ref."), "SO-PORTAL-77");
    await user.type(screen.getByLabelText("Ship-to Name"), "Receiver Dock");

    const fileInput = document.querySelector<HTMLInputElement>("input[type='file']");
    expect(fileInput).not.toBeNull();
    const packingListPdf = new File(["%PDF-packing-list"], "customer-pl.pdf", { type: "application/pdf" });
    const boImage = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "bo.png", { type: "image/png" });
    await user.upload(fileInput as HTMLInputElement, [packingListPdf, boImage]);

    const displayNameInputs = screen.getAllByLabelText("Display Name");
    await user.clear(displayNameInputs[0]);
    await user.type(displayNameInputs[0], "Customer Packing List");
    await user.clear(displayNameInputs[1]);
    await user.type(displayNameInputs[1], "Signed BO Proof");

    await user.click(screen.getByRole("button", { name: /Submit Packing List/i }));

    await waitFor(() => {
      expect(createPackingList).toHaveBeenCalledWith(expect.objectContaining({
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
    expect(uploadPackingListAttachment).toHaveBeenNthCalledWith(1, 77, packingListPdf, "Customer Packing List", undefined);
    expect(uploadPackingListAttachment).toHaveBeenNthCalledWith(2, 77, boImage, "Signed BO Proof", undefined);
    expect(await screen.findByText("PL-PORTAL-77")).toBeInTheDocument();
  });

  it("blocks packing list quantities above available customer inventory before submit", async () => {
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
    getPackingLists.mockResolvedValue([]);

    renderWithProviders(
      <CustomerPortalPage
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

    expect(await screen.findByText("LIMITED-SKU")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Add to PL/i }));

    const quantityInput = screen.getByRole("spinbutton");
    await user.clear(quantityInput);
    await user.type(quantityInput, "3");
    await user.click(screen.getByRole("button", { name: /Submit Packing List/i }));

    expect((await screen.findAllByText("Requested quantity cannot exceed available inventory.")).length).toBeGreaterThan(0);
    expect(createPackingList).not.toHaveBeenCalled();
  });
});
