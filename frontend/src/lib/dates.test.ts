import { describe, expect, it } from "vitest";

import {
  getLocalDayBucketKey,
  normalizeCalendarDate,
  shiftIsoDate,
  startOfLocalWeek,
  toIsoDateString
} from "./dates";

describe("date helpers", () => {
  it("normalizes date-only values consistently", () => {
    expect(normalizeCalendarDate("2026-03-31")).toBe("2026-03-31");
    expect(normalizeCalendarDate("2026-03-31T00:00:00Z")).toBe("2026-03-31");
  });

  it("shifts iso dates using local calendar days", () => {
    expect(shiftIsoDate("2026-03-31", 1)).toBe("2026-04-01");
    expect(shiftIsoDate("2026-03-31", -1)).toBe("2026-03-30");
  });

  it("derives local week starts and bucket keys from local dates", () => {
    const sample = new Date(2026, 2, 31, 18, 45, 0);
    const weekStart = startOfLocalWeek(sample);

    expect(toIsoDateString(weekStart)).toBe("2026-03-29");
    expect(getLocalDayBucketKey(sample)).toBe("2026-2-31");
  });
});
