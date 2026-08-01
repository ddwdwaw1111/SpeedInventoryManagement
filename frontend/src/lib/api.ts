import type {
  AuditLog,
  AuthResponse,
  BillingInvoice,
  BillingInvoiceSettings,
  BillingPreviewPayload,
  BillingPreviewResult,
  BulkImportBatch,
  BulkImportType,
  BulkConfirmOutboundDocumentsResponse,
  BulkDeleteOutboundDocumentsResponse,
  BulkUpdateInboundDocumentStatusResponse,
  CreateBillingInvoicePayload,
  GenerateBillingInvoicePayload,
  AddBillingInvoiceLinePayload,
  UpdateBillingInvoiceLinePayload,
  ContainerLifecycle,
	ContainerLifecycleEvent,
  ContainerPayload,
  ContainerPickupAssignment,
  ContainerPickupAssignmentPayload,
  ContainerRecord,
  ContainerTrackingEvent,
  ContainerTrackingEventPayload,
  UpdateContainerMetadataPayload,
  CustomerPortalContainerLifecycle,
  CustomerPortalContainerSummary,
  CycleCount,
  CycleCountPayload,
  CreateUserPayload,
  Customer,
  CustomerPayload,
  DashboardData,
  DeliveryEvent,
  DeliveryEventPayload,
  DocumentAttachment,
  DocumentTrackingStatusPayload,
  InventoryAdjustment,
  InventoryAdjustmentPayload,
  InventoryTransfer,
  InventoryTransferPayload,
  BulkTransferImportCommitPayload,
  BulkTransferImportCommitResponse,
  BulkTransferImportPreview,
  BulkTransferImportRevalidatePayload,
  InboundDocument,
  InboundDocumentPayload,
  InboundBulkImportCommitPayload,
  InboundBulkImportCommitResponse,
  InboundBulkImportPreview,
  InboundBulkImportRevalidatePayload,
  UpdateInboundDocumentContainerTypePayload,
  UpdateInboundDocumentNotePayload,
  InboundPackingListImportPreview,
  Item,
  LoginPayload,
  Location,
  LocationPayload,
  Movement,
  OperationsReport,
  OperationsReportGranularity,
  OutboundDocument,
  OutboundDocumentPayload,
  OutboundSourceReference,
  OutboundBulkImportCommitPayload,
  OutboundBulkImportCommitResponse,
  OutboundBulkImportPreview,
  OutboundBulkImportRevalidatePayload,
  UpdateOutboundDocumentNotePayload,
  SKUMaster,
  SKUMasterPayload,
  SKUFlowReport,
  UIPreference,
  SignUpPayload,
  UpdateBillingInvoiceSettingsPayload,
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
  containerNo?: string;
  lowStock?: boolean;
};

type SKUMasterQuery = {
  search?: string;
};

type MovementQuery = {
  search?: string;
  customerId?: number;
  locationId?: number;
  movementType?: string;
  startDate?: string;
  endDate?: string;
  startAt?: string;
  endBefore?: string;
};

type DocumentArchiveScope = "active" | "archived" | "all";

type DocumentListQuery = {
  archiveScope?: DocumentArchiveScope;
  exportCursor?: boolean;
  beforeId?: number;
  search?: string;
  customerId?: number | "all";
  locationId?: number | "all";
  status?: string;
  trackingStatus?: string;
};

type V2ContainerQuery = {
  search?: string;
  customerId?: number | "all";
  limit?: number;
};

type OperationsReportQuery = {
  startDate: string;
  endDate: string;
  locationId?: number | "all";
  customerId?: number | "all";
  search?: string;
  granularity?: OperationsReportGranularity;
};

type SKUFlowReportQuery = {
  skuMasterId: number;
  startDate: string;
  endDate: string;
  locationId?: number | "all";
  customerId?: number | "all";
};

export type DocumentAttachmentDownloadUrl = {
  url: string;
  expiresAt: string;
};

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

async function requestFile(path: string): Promise<{ blob: Blob; fileName: string }> {
  const response = await fetch(`${API_BASE_URL}${path}`, { credentials: "include" });
  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const errorPayload = (await response.json()) as { error?: string };
      if (errorPayload.error) message = errorPayload.error;
    } catch {
      // Ignore JSON parse errors for non-JSON failure responses.
    }
    throw new ApiError(response.status, message);
  }

  const disposition = response.headers.get("Content-Disposition") ?? "";
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const quotedName = disposition.match(/filename="([^"]+)"/i)?.[1];
  const plainName = disposition.match(/filename=([^;]+)/i)?.[1]?.trim();
  let fileName = quotedName || plainName || "bulk-import.xlsx";
  if (encodedName) {
    try {
      fileName = decodeURIComponent(encodedName);
    } catch {
      fileName = encodedName;
    }
  }
  return { blob: await response.blob(), fileName };
}

function buildDocumentListQueryParams(limit: number, archiveScopeOrQuery: DocumentArchiveScope | DocumentListQuery) {
  const query = typeof archiveScopeOrQuery === "string"
    ? { archiveScope: archiveScopeOrQuery }
    : archiveScopeOrQuery;
  const params = new URLSearchParams({
    limit: String(limit),
    archiveScope: query.archiveScope ?? "active"
  });

  if (query.exportCursor) {
    params.set("exportCursor", "true");
  }
  if (query.beforeId && query.beforeId > 0) {
    params.set("beforeId", String(query.beforeId));
  }

  if (query.customerId && query.customerId !== "all") {
    params.set("customerId", String(query.customerId));
  }
  if (query.locationId && query.locationId !== "all") {
    params.set("locationId", String(query.locationId));
  }
  if (query.status?.trim() && query.status.trim() !== "all") {
    params.set("status", query.status.trim());
  }
  if (query.trackingStatus?.trim() && query.trackingStatus.trim() !== "all") {
    params.set("trackingStatus", query.trackingStatus.trim());
  }
  if (query.search?.trim()) {
    params.set("search", query.search.trim());
  }

  return params;
}

function customerPortalBasePath(customerId?: number) {
  if (customerId && customerId > 0) {
    return `/admin/customer-portal/customers/${customerId}`;
  }
  return "/customer-portal";
}

function customerPortalV2BasePath(customerId?: number) {
  if (customerId && customerId > 0) {
    return `/v2/admin/customer-portal/customers/${customerId}`;
  }
  return "/v2/customer-portal";
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

  getCustomerPortalProfile(customerId?: number) {
    return request<Customer>(`${customerPortalBasePath(customerId)}/profile`);
  },

  getDashboard() {
    return request<DashboardData>("/dashboard");
  },

  getOperationsReport(query: OperationsReportQuery) {
    const params = new URLSearchParams();
    params.set("startDate", query.startDate);
    params.set("endDate", query.endDate);
    if (query.locationId && query.locationId !== "all") {
      params.set("locationId", String(query.locationId));
    }
    if (query.customerId && query.customerId !== "all") {
      params.set("customerId", String(query.customerId));
    }
    if (query.search?.trim()) {
      params.set("search", query.search.trim());
    }
    if (query.granularity) {
      params.set("granularity", query.granularity);
    }
    return request<OperationsReport>(`/reports/operations?${params.toString()}`);
  },

  getSKUFlowReport(query: SKUFlowReportQuery) {
    const params = new URLSearchParams();
    params.set("skuMasterId", String(query.skuMasterId));
    params.set("startDate", query.startDate);
    params.set("endDate", query.endDate);
    if (query.locationId && query.locationId !== "all") {
      params.set("locationId", String(query.locationId));
    }
    if (query.customerId && query.customerId !== "all") {
      params.set("customerId", String(query.customerId));
    }
    return request<SKUFlowReport>(`/reports/sku-flow?${params.toString()}`);
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

  getBillingInvoiceSettings() {
    return request<BillingInvoiceSettings>("/billing/settings");
  },

  updateBillingInvoiceSettings(payload: UpdateBillingInvoiceSettingsPayload) {
    return request<BillingInvoiceSettings>("/billing/settings", {
      method: "PUT",
      body: JSON.stringify(payload)
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

  getOutboundSourceReferences() {
    return request<OutboundSourceReference[]>("/outbound-source-references");
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
    if (query?.containerNo?.trim()) {
      params.set("containerNo", query.containerNo.trim());
    }
    if (query?.lowStock) {
      params.set("lowStock", "true");
    }

    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request<Item[]>(`/items${suffix}`);
  },

  getCustomerPortalInventory(search = "", customerId?: number) {
    const params = new URLSearchParams();
    if (search.trim()) {
      params.set("search", search.trim());
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request<Item[]>(`${customerPortalBasePath(customerId)}/inventory${suffix}`);
  },

  getCustomerPortalContainers(search = "", customerId?: number) {
    const params = new URLSearchParams();
    if (search.trim()) {
      params.set("search", search.trim());
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request<CustomerPortalContainerSummary[]>(`${customerPortalV2BasePath(customerId)}/containers${suffix}`);
  },

  getCustomerPortalContainerLifecycle(containerNo: string, customerId?: number) {
    return request<CustomerPortalContainerLifecycle>(
      `${customerPortalV2BasePath(customerId)}/containers/${encodeURIComponent(containerNo)}/lifecycle`
    );
  },

  getV2Containers(query: V2ContainerQuery = {}) {
    const params = new URLSearchParams();
    if (query.limit && query.limit > 0) {
      params.set("limit", String(query.limit));
    }
    if (query.customerId && query.customerId !== "all") {
      params.set("customerId", String(query.customerId));
    }
    if (query.search?.trim()) {
      params.set("search", query.search.trim());
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request<CustomerPortalContainerSummary[]>(`/v2/containers${suffix}`);
  },

  getV2ContainerLifecycle(containerNo: string, customerId: number) {
    const params = new URLSearchParams({ customerId: String(customerId) });
    return request<ContainerLifecycle>(`/v2/containers/${encodeURIComponent(containerNo)}/lifecycle?${params.toString()}`);
  },

  saveV2Container(payload: ContainerPayload) {
    return request<ContainerRecord>("/v2/containers", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  updateV2ContainerMetadata(containerNo: string, payload: UpdateContainerMetadataPayload) {
    return request<ContainerRecord>(`/v2/containers/${encodeURIComponent(containerNo)}/metadata`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  },

  createV2ContainerTrackingEvent(containerNo: string, payload: ContainerTrackingEventPayload) {
    return request<ContainerTrackingEvent>(`/v2/containers/${encodeURIComponent(containerNo)}/tracking-events`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  createV2ContainerPickupAssignment(containerNo: string, payload: ContainerPickupAssignmentPayload) {
    return request<ContainerPickupAssignment>(`/v2/containers/${encodeURIComponent(containerNo)}/pickup-assignments`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  createV2DeliveryEvent(payload: DeliveryEventPayload) {
    return request<DeliveryEvent>("/v2/deliveries", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  receiveV2DeliveryBOL(deliveryEventId: number, payload: DeliveryEventPayload) {
    return request<DeliveryEvent>(`/v2/deliveries/${deliveryEventId}/bol`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  getCustomerPortalPickingOrders(limit = 100, query?: { search?: string; status?: string; trackingStatus?: string }, customerId?: number) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (query?.search?.trim()) {
      params.set("search", query.search.trim());
    }
    if (query?.status?.trim() && query.status.trim() !== "all") {
      params.set("status", query.status.trim());
    }
    if (query?.trackingStatus?.trim() && query.trackingStatus.trim() !== "all") {
      params.set("trackingStatus", query.trackingStatus.trim());
    }
    return request<OutboundDocument[]>(`${customerPortalBasePath(customerId)}/picking-orders?${params.toString()}`);
  },

  getCustomerPortalPackingLists(limit = 100, query?: { search?: string; status?: string; trackingStatus?: string }, customerId?: number) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (query?.search?.trim()) {
      params.set("search", query.search.trim());
    }
    if (query?.status?.trim() && query.status.trim() !== "all") {
      params.set("status", query.status.trim());
    }
    if (query?.trackingStatus?.trim() && query.trackingStatus.trim() !== "all") {
      params.set("trackingStatus", query.trackingStatus.trim());
    }
    return request<InboundDocument[]>(`${customerPortalBasePath(customerId)}/packing-lists?${params.toString()}`);
  },

  createCustomerPortalPickingOrder(payload: OutboundDocumentPayload, customerId?: number) {
    return request<OutboundDocument>(`${customerPortalBasePath(customerId)}/picking-orders`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  getMovements(limit = 12, query?: MovementQuery) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (query?.search?.trim()) {
      params.set("search", query.search.trim());
    }
    if (query?.customerId && query.customerId > 0) {
      params.set("customerId", String(query.customerId));
    }
    if (query?.locationId && query.locationId > 0) {
      params.set("locationId", String(query.locationId));
    }
    if (query?.movementType?.trim()) {
      params.set("movementType", query.movementType.trim());
    }
    if (query?.startDate?.trim()) {
      params.set("startDate", query.startDate.trim());
    }
    if (query?.endDate?.trim()) {
      params.set("endDate", query.endDate.trim());
    }
    if (query?.startAt?.trim()) {
      params.set("startAt", query.startAt.trim());
    }
    if (query?.endBefore?.trim()) {
      params.set("endBefore", query.endBefore.trim());
    }
    return request<Movement[]>(`/movements?${params.toString()}`);
  },

  getOutboundDocuments(limit = 100, archiveScopeOrQuery: DocumentArchiveScope | DocumentListQuery = "active") {
    const params = buildDocumentListQueryParams(limit, archiveScopeOrQuery);
    return request<OutboundDocument[]>(`/outbound-documents?${params.toString()}`);
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

  updateOutboundDocumentNote(documentId: number, payload: UpdateOutboundDocumentNotePayload) {
    return request<OutboundDocument>(`/outbound-documents/${documentId}/document-note`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  },

  confirmOutboundDocument(documentId: number) {
    return request<OutboundDocument>(`/outbound-documents/${documentId}/confirm`, {
      method: "POST"
    });
  },

  bulkConfirmOutboundDocuments(documentIds: number[]) {
    return request<BulkConfirmOutboundDocumentsResponse>("/outbound-documents/bulk-confirm", {
      method: "POST",
      body: JSON.stringify({ documentIds })
    });
  },

  bulkDeleteOutboundDocuments(documentIds: number[]) {
    return request<BulkDeleteOutboundDocumentsResponse>("/outbound-documents/bulk-delete", {
      method: "POST",
      body: JSON.stringify({ documentIds })
    });
  },

  updateOutboundDocumentTrackingStatus(documentId: number, payload: DocumentTrackingStatusPayload) {
    return request<OutboundDocument>(`/outbound-documents/${documentId}/tracking-status`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  cancelOutboundDocument(documentId: number) {
    return request<void>(`/outbound-documents/${documentId}/cancel`, {
      method: "POST"
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

  uploadOutboundDocumentAttachment(documentId: number, file: File, displayName: string) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("displayName", displayName);

    return request<DocumentAttachment>(`/outbound-documents/${documentId}/attachments`, {
      method: "POST",
      body: formData
    });
  },

  getOutboundDocumentAttachmentDownloadUrl(documentId: number, attachmentId: number) {
    return request<DocumentAttachmentDownloadUrl>(`/outbound-documents/${documentId}/attachments/${attachmentId}/download-url`);
  },

  deleteOutboundDocumentAttachment(documentId: number, attachmentId: number) {
    return request<void>(`/outbound-documents/${documentId}/attachments/${attachmentId}`, {
      method: "DELETE"
    });
  },

  uploadCustomerPortalPickingOrderAttachment(documentId: number, file: File, displayName: string, customerId?: number) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("displayName", displayName);

    return request<DocumentAttachment>(`${customerPortalBasePath(customerId)}/picking-orders/${documentId}/attachments`, {
      method: "POST",
      body: formData
    });
  },

  getCustomerPortalPickingOrderAttachmentDownloadUrl(documentId: number, attachmentId: number, customerId?: number) {
    return request<DocumentAttachmentDownloadUrl>(`${customerPortalBasePath(customerId)}/picking-orders/${documentId}/attachments/${attachmentId}/download-url`);
  },

  getCustomerPortalPackingListAttachmentDownloadUrl(documentId: number, attachmentId: number, customerId?: number) {
    return request<DocumentAttachmentDownloadUrl>(`${customerPortalBasePath(customerId)}/packing-lists/${documentId}/attachments/${attachmentId}/download-url`);
  },

  deleteCustomerPortalPickingOrderAttachment(documentId: number, attachmentId: number, customerId?: number) {
    return request<void>(`${customerPortalBasePath(customerId)}/picking-orders/${documentId}/attachments/${attachmentId}`, {
      method: "DELETE"
    });
  },

  getInboundDocuments(limit = 100, archiveScopeOrQuery: DocumentArchiveScope | DocumentListQuery = "active") {
    const params = buildDocumentListQueryParams(limit, archiveScopeOrQuery);
    return request<InboundDocument[]>(`/inbound-documents?${params.toString()}`);
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

	getContainerLifecycleEvents(limit = 2000, containerNo = "", customerId?: number) {
		const params = new URLSearchParams({ limit: String(limit) });
		if (containerNo.trim()) params.set("containerNo", containerNo.trim());
		if (customerId && customerId > 0) params.set("customerId", String(customerId));
		return request<ContainerLifecycleEvent[]>(`/container-lifecycle-events?${params.toString()}`);
	},

  previewInboundBulkImport(file: File, customerId: number) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("customerId", String(customerId));

    return request<InboundBulkImportPreview>("/inbound-documents/bulk-import-preview", {
      method: "POST",
      body: formData
    });
  },

  commitInboundBulkImport(payload: InboundBulkImportCommitPayload) {
    return request<InboundBulkImportCommitResponse>("/inbound-documents/bulk-import-commit", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  revalidateInboundBulkImport(payload: InboundBulkImportRevalidatePayload) {
    return request<InboundBulkImportPreview>("/inbound-documents/bulk-import-revalidate", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  previewOutboundBulkImport(file: File, customerId: number) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("customerId", String(customerId));
    return request<OutboundBulkImportPreview>("/outbound-documents/bulk-import-preview", {
      method: "POST",
      body: formData
    });
  },

  revalidateOutboundBulkImport(payload: OutboundBulkImportRevalidatePayload) {
    return request<OutboundBulkImportPreview>("/outbound-documents/bulk-import-revalidate", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  commitOutboundBulkImport(payload: OutboundBulkImportCommitPayload) {
    return request<OutboundBulkImportCommitResponse>("/outbound-documents/bulk-import-commit", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  getBulkImportBatches(importType: BulkImportType, limit = 100, customerId?: number, beforeId?: number) {
    const params = new URLSearchParams({ importType, limit: String(limit) });
    if (customerId && customerId > 0) params.set("customerId", String(customerId));
    if (beforeId && beforeId > 0) params.set("beforeId", String(beforeId));
    return request<BulkImportBatch[]>(`/bulk-import-batches?${params.toString()}`);
  },

  downloadBulkImportBatchFile(batchId: number) {
    return requestFile(`/bulk-import-batches/${batchId}/file`);
  },

  updateInboundDocument(documentId: number, payload: InboundDocumentPayload) {
    return request<InboundDocument>(`/inbound-documents/${documentId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  },

  updateInboundDocumentNote(documentId: number, payload: UpdateInboundDocumentNotePayload) {
    return request<InboundDocument>(`/inbound-documents/${documentId}/document-note`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  },

  updateInboundDocumentContainerType(documentId: number, payload: UpdateInboundDocumentContainerTypePayload) {
    return request<InboundDocument>(`/inbound-documents/${documentId}/container-type`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  },

  confirmInboundDocument(documentId: number) {
    return request<InboundDocument>(`/inbound-documents/${documentId}/confirm`, {
      method: "POST"
    });
  },

  bulkUpdateInboundDocumentStatus(documentIds: number[], status: "CONFIRMED" | "DELETED") {
    return request<BulkUpdateInboundDocumentStatusResponse>("/inbound-documents/bulk-status", {
      method: "POST",
      body: JSON.stringify({ documentIds, status })
    });
  },

  updateInboundDocumentTrackingStatus(documentId: number, payload: DocumentTrackingStatusPayload) {
    return request<InboundDocument>(`/inbound-documents/${documentId}/tracking-status`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  cancelInboundDocument(documentId: number) {
    return request<void>(`/inbound-documents/${documentId}/cancel`, {
      method: "POST"
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

  uploadInboundDocumentAttachment(documentId: number, file: File, displayName: string) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("displayName", displayName);

    return request<DocumentAttachment>(`/inbound-documents/${documentId}/attachments`, {
      method: "POST",
      body: formData
    });
  },

  getInboundDocumentAttachmentDownloadUrl(documentId: number, attachmentId: number) {
    return request<DocumentAttachmentDownloadUrl>(`/inbound-documents/${documentId}/attachments/${attachmentId}/download-url`);
  },

  deleteInboundDocumentAttachment(documentId: number, attachmentId: number) {
    return request<void>(`/inbound-documents/${documentId}/attachments/${attachmentId}`, {
      method: "DELETE"
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

  previewBulkTransferImport(file: File, customerId: number) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("customerId", String(customerId));
    return request<BulkTransferImportPreview>("/transfers/bulk-import-preview", {
      method: "POST",
      body: formData
    });
  },

  revalidateBulkTransferImport(payload: BulkTransferImportRevalidatePayload) {
    return request<BulkTransferImportPreview>("/transfers/bulk-import-revalidate", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  commitBulkTransferImport(payload: BulkTransferImportCommitPayload) {
    return request<BulkTransferImportCommitResponse>("/transfers/bulk-import-commit", {
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
  },

  // --- Billing Invoices ---

  previewBilling(payload: BillingPreviewPayload) {
    return request<BillingPreviewResult>("/billing/preview", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  generateBillingInvoice(payload: GenerateBillingInvoicePayload) {
    return request<BillingInvoice>("/billing/invoices/generate", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  getBillingInvoices(customerId?: number, status?: string, invoiceType?: string) {
    const params = new URLSearchParams();
    if (customerId) params.set("customerId", String(customerId));
    if (status) params.set("status", status);
    if (invoiceType) params.set("invoiceType", invoiceType);
    const qs = params.toString();
    return request<BillingInvoice[]>(`/billing/invoices${qs ? `?${qs}` : ""}`);
  },

  getBillingInvoice(invoiceId: number) {
    return request<BillingInvoice>(`/billing/invoices/${invoiceId}`);
  },

  createBillingInvoice(payload: CreateBillingInvoicePayload) {
    return request<BillingInvoice>("/billing/invoices", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  updateBillingInvoice(invoiceId: number, payload: { customerName?: string; notes?: string; header?: BillingInvoice["header"] }) {
    return request<BillingInvoice>(`/billing/invoices/${invoiceId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  },

  addBillingInvoiceLine(invoiceId: number, payload: AddBillingInvoiceLinePayload) {
    return request<BillingInvoice>(`/billing/invoices/${invoiceId}/lines`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  updateBillingInvoiceLine(invoiceId: number, lineId: number, payload: UpdateBillingInvoiceLinePayload) {
    return request<BillingInvoice>(`/billing/invoices/${invoiceId}/lines/${lineId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  },

  deleteBillingInvoiceLine(invoiceId: number, lineId: number) {
    return request<BillingInvoice>(`/billing/invoices/${invoiceId}/lines/${lineId}`, {
      method: "DELETE"
    });
  },

  finalizeBillingInvoice(invoiceId: number) {
    return request<BillingInvoice>(`/billing/invoices/${invoiceId}/finalize`, {
      method: "POST"
    });
  },

  markBillingInvoicePaid(invoiceId: number) {
    return request<BillingInvoice>(`/billing/invoices/${invoiceId}/mark-paid`, {
      method: "POST"
    });
  },

  voidBillingInvoice(invoiceId: number) {
    return request<BillingInvoice>(`/billing/invoices/${invoiceId}/void`, {
      method: "POST"
    });
  },

  deleteBillingInvoice(invoiceId: number) {
    return request<{ ok: boolean }>(`/billing/invoices/${invoiceId}`, {
      method: "DELETE"
    });
  }
};
