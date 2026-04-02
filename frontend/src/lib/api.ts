import type {
  AuditLog,
  AuthResponse,
  BillingInvoice,
  CancelInboundDocumentPayload,
  CustomerRateCard,
  CustomerRateCardPayload,
  CycleCount,
  CycleCountPayload,
  CancelOutboundDocumentPayload,
  CreateUserPayload,
  Customer,
  CustomerPayload,
  DashboardData,
  DocumentTrackingStatusPayload,
  InventoryAdjustment,
  InventoryAdjustmentPayload,
  InventoryTransfer,
  InventoryTransferPayload,
  GenerateBillingInvoicesPayload,
  InboundDocument,
  InboundDocumentPayload,
  InboundPackingListImportPreview,
  Item,
  ItemPayload,
  LoginPayload,
  Location,
  LocationPayload,
  Movement,
  OutboundDocument,
  OutboundDocumentPayload,
  ReceiptLotTrace,
  SKUMaster,
  SKUMasterPayload,
  UIPreference,
  SignUpPayload,
  UpdateUserAccessPayload,
  User
} from "./types";

function normalizeApiBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");

  if (trimmed === "/api" || trimmed.endsWith("/api")) {
    return trimmed;
  }

  return `${trimmed}/api`;
}

const API_BASE_URL = normalizeApiBaseUrl(
  import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.PROD ? "/api" : "http://localhost:8080/api")
);

type ItemQuery = {
  search?: string;
  locationId?: number;
  customerId?: number;
  lowStock?: boolean;
};

type SKUMasterQuery = {
  search?: string;
};

type DocumentArchiveScope = "active" | "archived" | "all";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const bodyIsFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  if (!bodyIsFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    ...init,
    headers
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;

    try {
      const errorPayload = (await response.json()) as { error?: string };
      if (errorPayload.error) {
        message = errorPayload.error;
      }
    } catch {
      // Ignore JSON parse errors for non-JSON failure responses.
    }

    throw new ApiError(response.status, message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const api = {
  getCurrentSession() {
    return request<AuthResponse>("/auth/me");
  },

  login(payload: LoginPayload) {
    return request<AuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  signUp(payload: SignUpPayload) {
    return request<AuthResponse>("/auth/signup", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  logout() {
    return request<void>("/auth/logout", {
      method: "POST"
    });
  },

  getDashboard() {
    return request<DashboardData>("/dashboard");
  },

  getUIPreference<T = unknown>(key: string) {
    return request<UIPreference<T>>(`/ui-preferences/${encodeURIComponent(key)}`);
  },

  updateUIPreference<T = unknown>(key: string, value: T) {
    return request<UIPreference<T>>(`/ui-preferences/${encodeURIComponent(key)}`, {
      method: "PUT",
      body: JSON.stringify({ value })
    });
  },

  getAuditLogs(limit = 200) {
    return request<AuditLog[]>(`/audit-logs?limit=${limit}`);
  },

  getUsers() {
    return request<User[]>("/users");
  },

  createUser(payload: CreateUserPayload) {
    return request<User>("/users", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  updateUserAccess(userId: number, payload: UpdateUserAccessPayload) {
    return request<User>(`/users/${userId}/access`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  },

  getLocations() {
    return request<Location[]>("/locations");
  },

  getCustomers() {
    return request<Customer[]>("/customers");
  },

  createCustomer(payload: CustomerPayload) {
    return request<Customer>("/customers", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  updateCustomer(customerId: number, payload: CustomerPayload) {
    return request<Customer>(`/customers/${customerId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  },

  deleteCustomer(customerId: number) {
    return request<void>(`/customers/${customerId}`, {
      method: "DELETE"
    });
  },

  createLocation(payload: LocationPayload) {
    return request<Location>("/locations", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  updateLocation(locationId: number, payload: LocationPayload) {
    return request<Location>(`/locations/${locationId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  },

  deleteLocation(locationId: number) {
    return request<void>(`/locations/${locationId}`, {
      method: "DELETE"
    });
  },

  getSKUMasters(query?: SKUMasterQuery) {
    const params = new URLSearchParams();

    if (query?.search) {
      params.set("search", query.search);
    }

    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request<SKUMaster[]>(`/sku-master${suffix}`);
  },

  createSKUMaster(payload: SKUMasterPayload) {
    return request<SKUMaster>("/sku-master", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  updateSKUMaster(skuMasterId: number, payload: SKUMasterPayload) {
    return request<SKUMaster>(`/sku-master/${skuMasterId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  },

  deleteSKUMaster(skuMasterId: number) {
    return request<void>(`/sku-master/${skuMasterId}`, {
      method: "DELETE"
    });
  },

  getItems(query?: ItemQuery) {
    const params = new URLSearchParams();

    if (query?.search) {
      params.set("search", query.search);
    }
    if (query?.locationId) {
      params.set("locationId", String(query.locationId));
    }
    if (query?.customerId) {
      params.set("customerId", String(query.customerId));
    }
    if (query?.lowStock) {
      params.set("lowStock", "true");
    }

    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request<Item[]>(`/items${suffix}`);
  },

  createItem(payload: ItemPayload) {
    return request<Item>("/items", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  updateItem(itemId: number, payload: ItemPayload) {
    return request<Item>(`/items/${itemId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  },

  deleteItem(itemId: number) {
    return request<void>(`/items/${itemId}`, {
      method: "DELETE"
    });
  },

  getMovements(limit = 12) {
    return request<Movement[]>(`/movements?limit=${limit}`);
  },

  getReceiptLots(limit = 500, search = "") {
    const params = new URLSearchParams({ limit: String(limit) });
    if (search.trim()) {
      params.set("search", search.trim());
    }
    return request<ReceiptLotTrace[]>(`/receipt-lots?${params.toString()}`);
  },

  getCustomerRateCards() {
    return request<CustomerRateCard[]>("/billing/rate-cards");
  },

  updateCustomerRateCard(customerId: number, payload: CustomerRateCardPayload) {
    return request<CustomerRateCard>(`/billing/rate-cards/${customerId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  },

  getBillingInvoices(billingMonth = "") {
    const params = new URLSearchParams();
    if (billingMonth.trim()) {
      params.set("billingMonth", billingMonth.trim());
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request<BillingInvoice[]>(`/billing/invoices${suffix}`);
  },

  generateBillingInvoices(payload: GenerateBillingInvoicesPayload) {
    return request<BillingInvoice[]>("/billing/invoices/generate", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  getOutboundDocuments(limit = 100, archiveScope: DocumentArchiveScope = "active") {
    return request<OutboundDocument[]>(`/outbound-documents?limit=${limit}&archiveScope=${archiveScope}`);
  },

  createOutboundDocument(payload: OutboundDocumentPayload) {
    return request<OutboundDocument>("/outbound-documents", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  updateOutboundDocument(documentId: number, payload: OutboundDocumentPayload) {
    return request<OutboundDocument>(`/outbound-documents/${documentId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  },

  confirmOutboundDocument(documentId: number) {
    return request<OutboundDocument>(`/outbound-documents/${documentId}/confirm`, {
      method: "POST"
    });
  },

  updateOutboundDocumentTrackingStatus(documentId: number, payload: DocumentTrackingStatusPayload) {
    return request<OutboundDocument>(`/outbound-documents/${documentId}/tracking-status`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  cancelOutboundDocument(documentId: number, payload?: CancelOutboundDocumentPayload) {
    return request<OutboundDocument>(`/outbound-documents/${documentId}/cancel`, {
      method: "POST",
      body: JSON.stringify(payload ?? {})
    });
  },

  archiveOutboundDocument(documentId: number) {
    return request<OutboundDocument>(`/outbound-documents/${documentId}/archive`, {
      method: "POST"
    });
  },

  copyOutboundDocument(documentId: number) {
    return request<OutboundDocument>(`/outbound-documents/${documentId}/copy`, {
      method: "POST"
    });
  },

  getInboundDocuments(limit = 100, archiveScope: DocumentArchiveScope = "active") {
    return request<InboundDocument[]>(`/inbound-documents?limit=${limit}&archiveScope=${archiveScope}`);
  },

  createInboundDocument(payload: InboundDocumentPayload) {
    return request<InboundDocument>("/inbound-documents", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  importInboundDocumentPreview(file: File) {
    const formData = new FormData();
    formData.append("file", file);

    return request<InboundPackingListImportPreview>("/inbound-documents/import-preview", {
      method: "POST",
      body: formData
    });
  },

  updateInboundDocument(documentId: number, payload: InboundDocumentPayload) {
    return request<InboundDocument>(`/inbound-documents/${documentId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  },

  confirmInboundDocument(documentId: number) {
    return request<InboundDocument>(`/inbound-documents/${documentId}/confirm`, {
      method: "POST"
    });
  },

  updateInboundDocumentTrackingStatus(documentId: number, payload: DocumentTrackingStatusPayload) {
    return request<InboundDocument>(`/inbound-documents/${documentId}/tracking-status`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  cancelInboundDocument(documentId: number, payload?: CancelInboundDocumentPayload) {
    return request<InboundDocument>(`/inbound-documents/${documentId}/cancel`, {
      method: "POST",
      body: JSON.stringify(payload ?? {})
    });
  },

  archiveInboundDocument(documentId: number) {
    return request<InboundDocument>(`/inbound-documents/${documentId}/archive`, {
      method: "POST"
    });
  },

  copyInboundDocument(documentId: number) {
    return request<InboundDocument>(`/inbound-documents/${documentId}/copy`, {
      method: "POST"
    });
  },

  getInventoryAdjustments(limit = 100) {
    return request<InventoryAdjustment[]>(`/adjustments?limit=${limit}`);
  },

  createInventoryAdjustment(payload: InventoryAdjustmentPayload) {
    return request<InventoryAdjustment>("/adjustments", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  getInventoryTransfers(limit = 100) {
    return request<InventoryTransfer[]>(`/transfers?limit=${limit}`);
  },

  createInventoryTransfer(payload: InventoryTransferPayload) {
    return request<InventoryTransfer>("/transfers", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  getCycleCounts(limit = 100) {
    return request<CycleCount[]>(`/cycle-counts?limit=${limit}`);
  },

  createCycleCount(payload: CycleCountPayload) {
    return request<CycleCount>("/cycle-counts", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }
};
