import { describe, expect, it } from "vitest";

import { formatDiscountMoney, formatMoney, formatNumber, formatSignedNumber } from "./formatters";

describe("format helpers", () => {
  it("formats USD money consistently", () => {
    expect(formatMoney(1234)).toBe("$1,234.00");
    expect(formatMoney(12.345)).toBe("$12.35");
  });

  it("formats discounts as negative money except zero", () => {
    expect(formatDiscountMoney(10)).toBe("-$10.00");
    expect(formatDiscountMoney(-10)).toBe("-$10.00");
    expect(formatDiscountMoney(0)).toBe("$0.00");
  });

  it("formats integer and decimal numbers with the existing precision", () => {
    expect(formatNumber(42)).toBe("42");
    expect(formatNumber(42.5)).toBe("42.50");
    expect(formatNumber(42.555)).toBe("42.56");
  });

  it("adds a plus sign for positive signed numbers", () => {
    expect(formatSignedNumber(5)).toBe("+5");
    expect(formatSignedNumber(0)).toBe("0");
    expect(formatSignedNumber(-5.5)).toBe("-5.50");
  });
});
