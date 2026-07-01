import type { InboundHandlingMode, InboundLaunchIntent } from "./activityManagementLaunchContext";
import type { ContainerType } from "./types";

export type InboundReceiptEditorLaunchContext = {
  scheduledDate?: string;
  forceHandlingMode?: InboundHandlingMode;
  inboundIntent?: InboundLaunchIntent;
  containerId?: number;
  containerNo?: string;
  containerType?: ContainerType;
  customerId?: number;
  locationId?: number;
  storageSection?: string;
};

const STORAGE_KEY = "sim-inbound-receipt-editor-launch";

export function setPendingInboundReceiptEditorLaunchContext(context: InboundReceiptEditorLaunchContext) {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(context));
}

export function consumePendingInboundReceiptEditorLaunchContext() {
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  window.sessionStorage.removeItem(STORAGE_KEY);

  try {
    return JSON.parse(raw) as InboundReceiptEditorLaunchContext;
  } catch {
    return null;
  }
}
