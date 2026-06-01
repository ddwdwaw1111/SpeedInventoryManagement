import { normalizePagePath } from "../lib/routes";

export function getCustomerPortalCustomerIdFromPath(pathname: string): number | null {
  const normalized = normalizePagePath(pathname);
  const match = /^\/portal\/customers\/(\d+)$/.exec(normalized);
  if (!match) {
    return null;
  }
  const customerId = Number(match[1]);
  return Number.isFinite(customerId) && customerId > 0 ? customerId : null;
}

export function getCustomerPortalPath(customerId?: number) {
  return customerId && customerId > 0 ? `/portal/customers/${customerId}` : "/portal";
}

export function isCustomerPortalPath(pathname: string) {
  const normalized = normalizePagePath(pathname);
  return normalized === "/portal" || /^\/portal\/customers\/\d+$/.test(normalized);
}
