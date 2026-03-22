import type { Movement } from "./types";

type AllActivityContext = {
  searchTerm?: string;
  customerId?: number;
  locationId?: number;
  movementType?: Movement["movementType"];
};

const STORAGE_KEY = "sim-all-activity-context";

export function setPendingAllActivityContext(context: AllActivityContext) {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(context));
}

export function consumePendingAllActivityContext(): AllActivityContext | null {
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  window.sessionStorage.removeItem(STORAGE_KEY);

  try {
    return JSON.parse(raw) as AllActivityContext;
  } catch {
    return null;
  }
}
