export type ActivityManagementMode = "IN" | "OUT";

export type ActivityManagementLaunchContext = {
  scheduledDate?: string;
  openCreate?: boolean;
  documentId?: number;
  selectedStatus?: string;
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
