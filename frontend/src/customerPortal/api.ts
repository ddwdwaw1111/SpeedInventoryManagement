import { ApiError, api } from "../lib/api";
import type { LoginPayload, OutboundDocumentPayload, SignUpPayload } from "./types";

export { ApiError };

export type CustomerPortalPickingOrderQuery = {
  search?: string;
  status?: string;
  trackingStatus?: string;
};

export type CustomerPortalPackingListQuery = CustomerPortalPickingOrderQuery;

export const customerPortalApi = {
  getCurrentSession: () => api.getCurrentSession(),
  login: (payload: LoginPayload) => api.login(payload),
  signUp: (payload: SignUpPayload) => api.signUp(payload),
  logout: () => api.logout(),
  getProfile: (customerId?: number) => api.getCustomerPortalProfile(customerId),
  getInventory: (search = "", customerId?: number) => api.getCustomerPortalInventory(search, customerId),
  getContainers: (search = "", customerId?: number) => api.getCustomerPortalContainers(search, customerId),
  getContainerLifecycle: (containerId: number, customerId?: number) =>
    api.getCustomerPortalContainerLifecycle(containerId, customerId),
  getPackingLists: (limit = 100, query?: CustomerPortalPackingListQuery, customerId?: number) =>
    api.getCustomerPortalPackingLists(limit, query, customerId),
  getPickingOrders: (limit = 100, query?: CustomerPortalPickingOrderQuery, customerId?: number) =>
    api.getCustomerPortalPickingOrders(limit, query, customerId),
  createPickingOrder: (payload: OutboundDocumentPayload, customerId?: number) =>
    api.createCustomerPortalPickingOrder(payload, customerId),
  uploadPickingOrderAttachment: (documentId: number, file: File, displayName: string, customerId?: number) =>
    api.uploadCustomerPortalPickingOrderAttachment(documentId, file, displayName, customerId),
  getPickingOrderAttachmentDownloadUrl: (documentId: number, attachmentId: number, customerId?: number) =>
    api.getCustomerPortalPickingOrderAttachmentDownloadUrl(documentId, attachmentId, customerId),
  getPackingListAttachmentDownloadUrl: (documentId: number, attachmentId: number, customerId?: number) =>
    api.getCustomerPortalPackingListAttachmentDownloadUrl(documentId, attachmentId, customerId),
  deletePickingOrderAttachment: (documentId: number, attachmentId: number, customerId?: number) =>
    api.deleteCustomerPortalPickingOrderAttachment(documentId, attachmentId, customerId)
};
