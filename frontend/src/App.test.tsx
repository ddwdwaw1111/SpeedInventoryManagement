import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { createCustomer } from "./test/fixtures";
import { renderWithProviders } from "./test/renderWithProviders";

const { ApiError, apiMocks, portalApiMocks } = vi.hoisted(() => {
  class ApiError extends Error {
    status: number;

    constructor(status: number, message: string) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }

  return {
    ApiError,
    apiMocks: {
      getCurrentSession: vi.fn(),
      getLocations: vi.fn(),
      getCustomers: vi.fn(),
      getSKUMasters: vi.fn(),
      getOutboundSourceReferences: vi.fn(),
      getItems: vi.fn(),
      getMovements: vi.fn(),
      getInboundDocuments: vi.fn(),
      getOutboundDocuments: vi.fn(),
      getInventoryAdjustments: vi.fn(),
      getInventoryTransfers: vi.fn(),
      getCycleCounts: vi.fn(),
      getAuditLogs: vi.fn(),
      getUsers: vi.fn(),
      getBillingInvoiceSettings: vi.fn(),
      logout: vi.fn()
    },
    portalApiMocks: {
      getCurrentSession: vi.fn(),
      login: vi.fn(),
      signUp: vi.fn(),
      logout: vi.fn(),
      getProfile: vi.fn(),
      getInventory: vi.fn(),
      getContainers: vi.fn(),
      getPackingLists: vi.fn(),
      getPickingOrders: vi.fn()
    }
  };
});

vi.mock("./lib/api", () => ({
  ApiError,
  api: apiMocks
}));

vi.mock("./customerPortal/api", () => ({
  ApiError,
  customerPortalApi: portalApiMocks
}));

const customerUser = {
  id: 12,
  email: "customer@example.com",
  fullName: "Customer User",
  role: "customer",
  isActive: true,
  customerId: 99,
  customerName: "Customer Portal Co",
  createdAt: "2026-03-24T10:00:00Z"
};

const operatorUser = {
  id: 2,
  email: "ops@example.com",
  fullName: "Ops User",
  role: "operator",
  isActive: true,
  customerId: 0,
  customerName: "",
  createdAt: "2026-03-24T10:00:00Z"
};

const adminUser = {
  id: 1,
  email: "admin@example.com",
  fullName: "Admin User",
  role: "admin",
  isActive: true,
  customerId: 0,
  customerName: "",
  createdAt: "2026-03-24T10:00:00Z"
};

const staffDataApiNames = [
  "getLocations",
  "getCustomers",
  "getSKUMasters",
  "getOutboundSourceReferences",
  "getItems",
  "getMovements",
  "getInboundDocuments",
  "getOutboundDocuments",
  "getInventoryAdjustments",
  "getInventoryTransfers",
  "getCycleCounts"
] as const;

describe("App role routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, "", "/dashboard");
    portalApiMocks.getInventory.mockResolvedValue([]);
    portalApiMocks.getContainers.mockResolvedValue([]);
    portalApiMocks.getPackingLists.mockResolvedValue([]);
    portalApiMocks.getProfile.mockResolvedValue(createCustomer({ id: 99, name: "Customer Portal Co" }));
    portalApiMocks.getPickingOrders.mockResolvedValue([]);
    apiMocks.getBillingInvoiceSettings.mockResolvedValue({
      header: {
        sellerName: "Speed Inventory Management",
        subtitle: "Business services invoice",
        remitTo: "Speed Inventory Management",
        terms: "Net 30",
        paymentDueDays: 30,
        paymentInstructions: "Payment due within 30 days of invoice date. Please reference the invoice number with payment. Amounts are in USD."
      }
    });
    for (const name of staffDataApiNames) {
      apiMocks[name].mockResolvedValue([]);
    }
    apiMocks.getAuditLogs.mockResolvedValue([]);
    apiMocks.getUsers.mockResolvedValue([]);
  });

  it("routes customer users to the portal without loading staff workspace data", async () => {
    apiMocks.getCurrentSession.mockResolvedValue({
      user: customerUser,
      expiresAt: "2026-03-25T10:00:00Z"
    });
    portalApiMocks.getCurrentSession.mockResolvedValue({
      user: customerUser,
      expiresAt: "2026-03-25T10:00:00Z"
    });

    renderWithProviders(<App />);

    expect(await screen.findByRole("button", { name: /Inventory/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(window.location.pathname).toBe("/portal");
    });
    expect(screen.getAllByText("Customer Portal").length).toBeGreaterThan(0);
    expect(screen.getByRole("navigation", { name: /Customer Portal/i })).toBeInTheDocument();
    expect(document.querySelector(".app-sidebar")).toBeNull();
    expect(screen.queryByRole("button", { name: /Overview/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Packing Lists/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Picking Orders/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New Picking Order/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Picking Order Documents/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Home$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Shipments$/i })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(portalApiMocks.getInventory).toHaveBeenCalled();
      expect(portalApiMocks.getContainers).toHaveBeenCalled();
      expect(portalApiMocks.getPackingLists).toHaveBeenCalled();
      expect(portalApiMocks.getPickingOrders).toHaveBeenCalled();
    });
    for (const name of staffDataApiNames) {
      expect(apiMocks[name]).not.toHaveBeenCalled();
    }
    expect(apiMocks.getAuditLogs).not.toHaveBeenCalled();
    expect(apiMocks.getUsers).not.toHaveBeenCalled();
    expect(apiMocks.getBillingInvoiceSettings).not.toHaveBeenCalled();
  });

  it("routes staff users away from the customer portal and loads warehouse data", async () => {
    window.history.pushState({}, "", "/portal");
    apiMocks.getCurrentSession.mockResolvedValue({
      user: operatorUser,
      expiresAt: "2026-03-25T10:00:00Z"
    });
    portalApiMocks.getCurrentSession.mockResolvedValue({
      user: operatorUser,
      expiresAt: "2026-03-25T10:00:00Z"
    });

    renderWithProviders(<App />);

    await waitFor(() => {
      expect(window.location.pathname).toBe("/admin");
    });
    expect(screen.queryByRole("navigation", { name: /Customer Portal/i })).not.toBeInTheDocument();
    for (const name of staffDataApiNames) {
      expect(apiMocks[name]).toHaveBeenCalled();
    }
    expect(portalApiMocks.getInventory).not.toHaveBeenCalled();
    expect(portalApiMocks.getContainers).not.toHaveBeenCalled();
    expect(portalApiMocks.getPackingLists).not.toHaveBeenCalled();
    expect(portalApiMocks.getPickingOrders).not.toHaveBeenCalled();
  });

  it("lets admin users open a scoped customer portal", async () => {
    window.history.pushState({}, "", "/portal/customers/7");
    portalApiMocks.getCurrentSession.mockResolvedValue({
      user: adminUser,
      expiresAt: "2026-03-25T10:00:00Z"
    });
    portalApiMocks.getProfile.mockResolvedValue(createCustomer({ id: 7, name: "Portal Customer" }));

    renderWithProviders(<App />);

    expect(await screen.findByRole("button", { name: /Inventory/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(portalApiMocks.getProfile).toHaveBeenCalledWith(7);
      expect(portalApiMocks.getInventory).toHaveBeenCalledWith("", 7);
    });
    expect(portalApiMocks.getPackingLists).toHaveBeenCalledWith(100, {
      search: "",
      status: "all",
      trackingStatus: "all"
    }, 7);
    expect(portalApiMocks.getPickingOrders).toHaveBeenCalledWith(100, {
      search: "",
      status: "all",
      trackingStatus: "all"
    }, 7);
    expect(screen.getByRole("navigation", { name: /Customer Portal/i })).toBeInTheDocument();
    expect(document.querySelector(".app-sidebar")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Home$/i })).not.toBeInTheDocument();
  });

  it("keeps admin users in the warehouse workspace from the admin entry path", async () => {
    window.history.pushState({}, "", "/admin");
    apiMocks.getCurrentSession.mockResolvedValue({
      user: adminUser,
      expiresAt: "2026-03-25T10:00:00Z"
    });

    renderWithProviders(<App />);

    expect(await screen.findByRole("button", { name: /^Home$/i })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/admin");
    for (const name of staffDataApiNames) {
      expect(apiMocks[name]).toHaveBeenCalled();
    }
    expect(apiMocks.getAuditLogs).toHaveBeenCalledWith(500);
    expect(apiMocks.getUsers).toHaveBeenCalled();
    expect(portalApiMocks.getInventory).not.toHaveBeenCalled();
    expect(portalApiMocks.getPackingLists).not.toHaveBeenCalled();
    expect(portalApiMocks.getPickingOrders).not.toHaveBeenCalled();
  });

  it("shows an admin entrance on the sign-in page", async () => {
    apiMocks.getCurrentSession.mockRejectedValue(new ApiError(401, "unauthorized"));

    renderWithProviders(<App />);

    expect(await screen.findByRole("link", { name: /Admin entrance/i })).toHaveAttribute("href", "/admin");
  });
});
