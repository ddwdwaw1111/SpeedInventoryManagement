export type InventoryActionPage = "adjustments" | "transfers" | "cycle-counts";

export type InventoryActionContext = {
  sourceKey?: string;
  sku?: string;
  customerId?: number;
  containerNo?: string;
  palletId?: number;
};

function getStorageKey(page: InventoryActionPage) {
  return `sim-${page}-context`;
}

function sanitizeInventoryActionContext(context: InventoryActionContext): InventoryActionContext {
  const sourceKey = context.sourceKey?.trim() || undefined;
  const sku = context.sku?.trim().toUpperCase() || undefined;
  const customerId = typeof context.customerId === "number" && context.customerId > 0
    ? context.customerId
    : undefined;
  const containerNo = context.containerNo?.trim().toUpperCase() || undefined;
  const palletId = typeof context.palletId === "number" && context.palletId > 0
    ? context.palletId
    : undefined;

  return {
    sourceKey,
    sku,
    customerId,
    containerNo,
    palletId
  };
}

export function setPendingInventoryActionContext(page: InventoryActionPage, context: InventoryActionContext) {
  window.sessionStorage.setItem(getStorageKey(page), JSON.stringify(sanitizeInventoryActionContext(context)));
}

export function consumePendingInventoryActionContext(page: InventoryActionPage): InventoryActionContext | null {
  const raw = window.sessionStorage.getItem(getStorageKey(page));
  if (!raw) {
    return null;
  }

  window.sessionStorage.removeItem(getStorageKey(page));

  try {
    return sanitizeInventoryActionContext(JSON.parse(raw) as InventoryActionContext);
  } catch {
    return null;
  }
}
