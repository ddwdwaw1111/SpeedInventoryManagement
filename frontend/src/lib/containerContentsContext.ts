type ContainerContentsContext = {
  sku?: string;
  customerId?: number;
  locationId?: number;
  containerNo?: string;
};

const STORAGE_KEY = "sim-container-contents-context";

export function setPendingContainerContentsContext(context: ContainerContentsContext) {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(context));
}

export function consumePendingContainerContentsContext(): ContainerContentsContext | null {
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  window.sessionStorage.removeItem(STORAGE_KEY);

  try {
    return JSON.parse(raw) as ContainerContentsContext;
  } catch {
    return null;
  }
}
