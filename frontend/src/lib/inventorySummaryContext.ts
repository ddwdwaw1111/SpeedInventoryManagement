type InventorySummaryHealthFilter = "ALL" | "LOW_STOCK";

type InventorySummaryContext = {
  searchTerm?: string;
  customerId?: number;
  locationId?: number;
  healthFilter?: InventorySummaryHealthFilter;
};

const STORAGE_KEY = "sim-inventory-summary-context";

export function setPendingInventorySummaryContext(context: InventorySummaryContext) {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(context));
}

export function consumePendingInventorySummaryContext(): InventorySummaryContext | null {
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  window.sessionStorage.removeItem(STORAGE_KEY);

  try {
    return JSON.parse(raw) as InventorySummaryContext;
  } catch {
    return null;
  }
}