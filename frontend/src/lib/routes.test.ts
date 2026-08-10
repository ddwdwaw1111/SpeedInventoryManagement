import { describe, expect, it, vi } from "vitest";

import {
  getContainerDetailRouteFromPath,
  getPageFromPath,
  navigateToContainerDetail
} from "./routes";

describe("container detail routes", () => {
  it("builds and parses a customer-scoped container route", () => {
    const setter = vi.fn();
    window.history.replaceState({}, "", "/");

    navigateToContainerDetail(setter, 42, " cont / 001 ");

    expect(window.location.pathname).toBe("/container-contents/42/CONT%20%2F%20001");
    expect(getPageFromPath(window.location.pathname)).toBe("container-detail");
    expect(getContainerDetailRouteFromPath(window.location.pathname)).toEqual({
      customerId: 42,
      containerNo: "CONT / 001"
    });
  });

  it("rejects an unscoped container route", () => {
    expect(getContainerDetailRouteFromPath("/container-contents/SHARED-001")).toBeNull();
  });
});
