export type PalletTraceLaunchContext = {
  sourceInboundDocumentId?: number;
};

const STORAGE_KEY = "sim-pallet-trace-launch";

export function setPendingPalletTraceLaunchContext(context: PalletTraceLaunchContext) {
  if (!context.sourceInboundDocumentId || context.sourceInboundDocumentId <= 0) {
    window.sessionStorage.removeItem(STORAGE_KEY);
    return;
  }

  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(context));
}

export function consumePendingPalletTraceLaunchContext() {
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  window.sessionStorage.removeItem(STORAGE_KEY);

  try {
    return JSON.parse(raw) as PalletTraceLaunchContext;
  } catch {
    return null;
  }
}
