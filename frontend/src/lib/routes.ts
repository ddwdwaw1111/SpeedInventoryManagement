export type PageKey =
  | "dashboard"
  | "all-activity"
  | "customers"
  | "audit-logs"
  | "adjustments"
  | "transfers"
  | "cycle-counts"
  | "sku-master"
  | "stock-by-location"
  | "storage-management"
  | "inbound-management"
  | "outbound-management"
  | "settings";

export const pagePathMap: Record<PageKey, string> = {
  dashboard: "/",
  "all-activity": "/all-activity",
  customers: "/customers",
  "audit-logs": "/audit-logs",
  adjustments: "/adjustments",
  transfers: "/transfers",
  "cycle-counts": "/cycle-counts",
  "sku-master": "/sku-master",
  "stock-by-location": "/stock-by-location",
  "storage-management": "/storage-management",
  "inbound-management": "/inbound-management",
  "outbound-management": "/outbound-management",
  settings: "/settings"
};

export function normalizePagePath(pathname: string): string {
  if (!pathname || pathname === "/") {
    return "/";
  }

  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

export function getPageFromPath(pathname: string): PageKey {
  const normalized = normalizePagePath(pathname);

  if (normalized === "/all-activity") return "all-activity";
  if (normalized === "/audit-logs") return "audit-logs";
  if (normalized === "/adjustments") return "adjustments";
  if (normalized === "/transfers") return "transfers";
  if (normalized === "/cycle-counts") return "cycle-counts";
  if (normalized === "/inbound-management") return "inbound-management";
  if (normalized === "/outbound-management") return "outbound-management";
  if (normalized === "/customers") return "customers";
  if (normalized === "/sku-master") return "sku-master";
  if (normalized === "/stock-by-location") return "stock-by-location";
  if (normalized === "/storage-management") return "storage-management";
  if (normalized === "/settings") return "settings";
  return "dashboard";
}

export function getPathForPage(page: PageKey): string {
  return pagePathMap[page];
}

export function navigateToPage(page: PageKey, setter: (page: PageKey) => void) {
  const path = getPathForPage(page);
  if (normalizePagePath(window.location.pathname) !== path) {
    window.history.pushState({ page }, "", path);
  }

  setter(page);
}
