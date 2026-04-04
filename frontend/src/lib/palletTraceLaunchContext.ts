export type PalletTraceLaunchContext = {
  sourceInboundDocumentId?: number;
  searchTerm?: string;
};

const STORAGE_KEY = "sim-pallet-trace-launch";

export function setPendingPalletTraceLaunchContext(context: PalletTraceLaunchContext) {
  const hasSourceInboundDocumentId = Boolean(context.sourceInboundDocumentId && context.sourceInboundDocumentId > 0);
  const hasSearchTerm = Boolean(context.searchTerm?.trim());
  if (!hasSourceInboundDocumentId && !hasSearchTerm) {
    window.sessionStorage.removeItem(STORAGE_KEY);
    return;
  }

  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
    sourceInboundDocumentId: hasSourceInboundDocumentId ? context.sourceInboundDocumentId : undefined,
    searchTerm: hasSearchTerm ? context.searchTerm?.trim() : undefined
  }));
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
