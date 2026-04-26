export function waitForNextPaint(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => resolve());
      return;
    }

    window.setTimeout(resolve, 0);
  });
}
