import { describe, expect, it } from "vitest";

import { getErrorMessage } from "./errors";

describe("error helpers", () => {
  it("uses error messages when available", () => {
    expect(getErrorMessage(new Error("failed"), "fallback")).toBe("failed");
  });

  it("falls back for unknown or empty errors", () => {
    expect(getErrorMessage("failed", "fallback")).toBe("fallback");
    expect(getErrorMessage(new Error(""), "fallback")).toBe("fallback");
  });
});
