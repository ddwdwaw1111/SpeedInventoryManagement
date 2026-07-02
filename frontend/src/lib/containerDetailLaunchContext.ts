export type ContainerDetailLaunchContext = {
  openTransferDialog?: boolean;
  openAdjustmentDialog?: boolean;
};

const STORAGE_KEY = "sim-container-detail-launch";

export function setPendingContainerDetailLaunchContext(context: ContainerDetailLaunchContext) {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(context));
}

export function consumePendingContainerDetailLaunchContext(): ContainerDetailLaunchContext | null {
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  window.sessionStorage.removeItem(STORAGE_KEY);

  try {
    return JSON.parse(raw) as ContainerDetailLaunchContext;
  } catch {
    return null;
  }
}
