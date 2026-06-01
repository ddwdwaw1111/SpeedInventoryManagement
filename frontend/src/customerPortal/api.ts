import { ApiError, api } from "../lib/api";
import type { LoginPayload, OutboundDocumentPayload, SignUpPayload } from "./types";

export { ApiError };

export type CustomerPortalPackingListQuery = {
  search?: string;
  status?: string;
  trackingStatus?: string;
};

export const customerPortalApi = {
  getCurrentSession: () => api.getCurrentSession(),
  login: (payload: LoginPayload) => api.login(payload),
  signUp: (payload: SignUpPayload) => api.signUp(payload),
  logout: () => api.logout(),
  getProfile: (customerId?: number) => api.getCustomerPortalProfile(customerId),
  getInventory: (search = "", customerId?: number) => api.getCustomerPortalInventory(search, customerId),
  getPackingLists: (limit = 100, query?: CustomerPortalPackingListQuery, customerId?: number) =>
    api.getCustomerPortalPackingLists(limit, query, customerId),
  createPackingList: (payload: OutboundDocumentPayload, customerId?: number) =>
    api.createCustomerPortalPackingList(payload, customerId),
  uploadPackingListAttachment: (documentId: number, file: File, displayName: string, customerId?: number) =>
    api.uploadCustomerPortalPackingListAttachment(documentId, file, displayName, customerId),
  getPackingListAttachmentDownloadUrl: (documentId: number, attachmentId: number, customerId?: number) =>
    api.getCustomerPortalPackingListAttachmentDownloadUrl(documentId, attachmentId, customerId),
  deletePackingListAttachment: (documentId: number, attachmentId: number, customerId?: number) =>
    api.deleteCustomerPortalPackingListAttachment(documentId, attachmentId, customerId)
};
