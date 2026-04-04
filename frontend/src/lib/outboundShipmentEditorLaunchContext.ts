export type OutboundShipmentEditorLaunchContext = {
  scheduledDate?: string;
};

const STORAGE_KEY = "sim-outbound-shipment-editor-launch";

export function setPendingOutboundShipmentEditorLaunchContext(context: OutboundShipmentEditorLaunchContext) {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(context));
}

export function consumePendingOutboundShipmentEditorLaunchContext() {
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  window.sessionStorage.removeItem(STORAGE_KEY);

  try {
    return JSON.parse(raw) as OutboundShipmentEditorLaunchContext;
  } catch {
    return null;
  }
}