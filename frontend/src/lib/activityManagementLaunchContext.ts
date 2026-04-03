export type ActivityManagementMode = "IN" | "OUT";
export type InboundHandlingMode = "PALLETIZED" | "SEALED_TRANSIT";
export type InboundLaunchIntent = "convert-sealed-transit";

export type ActivityManagementLaunchContext = {
  scheduledDate?: string;
  openCreate?: boolean;
  openEditor?: boolean;
  documentId?: number;
  selectedStatus?: string;
  forceInboundHandlingMode?: InboundHandlingMode;
  inboundIntent?: InboundLaunchIntent;
};

function getStorageKey(mode: ActivityManagementMode) {
  return `sim-activity-management-launch-${mode.toLowerCase()}`;
}

export function setPendingActivityManagementLaunchContext(
  mode: ActivityManagementMode,
  context: ActivityManagementLaunchContext
) {
  window.sessionStorage.setItem(getStorageKey(mode), JSON.stringify(context));
}

export function consumePendingActivityManagementLaunchContext(mode: ActivityManagementMode) {
  const raw = window.sessionStorage.getItem(getStorageKey(mode));
  if (!raw) {
    return null;
  }

  window.sessionStorage.removeItem(getStorageKey(mode));

  try {
    return JSON.parse(raw) as ActivityManagementLaunchContext;
  } catch {
    return null;
  }
}
