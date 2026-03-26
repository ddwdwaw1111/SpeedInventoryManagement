type InventoryActionPage = "adjustments" | "transfers";

type InventoryActionContext = {
  sourceKey?: string;
  sku?: string;
  customerId?: number;
};

function getStorageKey(page: InventoryActionPage) {
  return `sim-${page}-context`;
}

export function setPendingInventoryActionContext(page: InventoryActionPage, context: InventoryActionContext) {
  window.sessionStorage.setItem(getStorageKey(page), JSON.stringify(context));
}

export function consumePendingInventoryActionContext(page: InventoryActionPage): InventoryActionContext | null {
  const raw = window.sessionStorage.getItem(getStorageKey(page));
  if (!raw) {
    return null;
  }

  window.sessionStorage.removeItem(getStorageKey(page));

  try {
    return JSON.parse(raw) as InventoryActionContext;
  } catch {
    return null;
  }
}
