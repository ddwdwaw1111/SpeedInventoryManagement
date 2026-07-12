import { describe, expect, it } from "vitest";

import { createLocation } from "../test/fixtures";
import { buildInboundBulkImportSampleRows, INBOUND_BULK_IMPORT_TEMPLATE_COLUMNS } from "./inboundBulkImportTemplate";

describe("inbound bulk import template", () => {
  it("uses actual arrival date without expected arrival date or document note", () => {
    const keys = INBOUND_BULK_IMPORT_TEMPLATE_COLUMNS.map((column) => column.key);

    expect(keys).toContain("actualArrivalDate");
    expect(keys).toContain("warehouse");
    expect(keys).not.toContain("expectedArrivalDate");
    expect(keys).not.toContain("documentNote");
    expect(keys).toContain("lineNote");
  });

  it("builds grouped sample receipts across available warehouses", () => {
    const rows = buildInboundBulkImportSampleRows([
      createLocation({ id: 1, name: "NJ", sectionNames: ["A"] }),
      createLocation({ id: 2, name: "LA", sectionNames: ["B"] })
    ], new Date(2026, 6, 11));

    expect(rows).toHaveLength(3);
    expect(rows[0].documentKey).toBe(rows[1].documentKey);
    expect(rows[0].containerNo).toBe(rows[1].containerNo);
    expect(rows[0]).toMatchObject({ warehouse: "NJ", storageSection: "A" });
    expect(rows[0].actualArrivalDate).toBe("2026-06-11");
    expect(rows[1].actualArrivalDate).toBe("2026-06-11");
    expect(rows[2]).toMatchObject({ warehouse: "LA", storageSection: "B", actualArrivalDate: "2026-07-04" });
    expect(rows[2].documentKey).not.toBe(rows[0].documentKey);
  });
});
