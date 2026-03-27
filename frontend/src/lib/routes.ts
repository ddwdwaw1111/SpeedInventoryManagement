export type PageKey =
  | "dashboard"
  | "export-center"
  | "reports"
  | "all-activity"
  | "container-contents"
  | "customers"
  | "audit-logs"
  | "user-management"
  | "inventory-summary"
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
  "export-center": "/export-center",
  reports: "/reports",
  "all-activity": "/all-activity",
  "container-contents": "/container-contents",
  customers: "/customers",
  "audit-logs": "/audit-logs",
  "user-management": "/user-management",
  "inventory-summary": "/inventory-summary",
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

  if (normalized === "/reports") return "reports";
  if (normalized === "/export-center") return "export-center";
  if (normalized === "/all-activity") return "all-activity";
  if (normalized === "/container-contents") return "container-contents";
  if (normalized === "/audit-logs") return "audit-logs";
  if (normalized === "/user-management") return "user-management";
  if (normalized === "/inventory-summary") return "inventory-summary";
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
