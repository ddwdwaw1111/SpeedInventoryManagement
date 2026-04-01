type InventoryByLocationContext = {
  sku?: string;
  customerId?: number;
  locationId?: number;
  containerNo?: string;
  healthFilter?: "ALL" | "IN_STOCK" | "LOW_STOCK" | "MISMATCH";
};

const STORAGE_KEY = "sim-inventory-by-location-context";

export function setPendingInventoryByLocationContext(context: InventoryByLocationContext) {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(context));
}

export function consumePendingInventoryByLocationContext(): InventoryByLocationContext | null {
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  window.sessionStorage.removeItem(STORAGE_KEY);

  try {
    return JSON.parse(raw) as InventoryByLocationContext;
  } catch {
    return null;
  }
}
