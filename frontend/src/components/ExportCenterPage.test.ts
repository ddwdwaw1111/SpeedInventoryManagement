import { describe, expect, it } from "vitest";

import { createItem } from "../test/fixtures";
import {
  buildContainerContentsExportRows,
  buildInventoryDetailExportRows,
  buildInventorySummaryExportRows
} from "./ExportCenterPage";

describe("inventory exports", () => {
  it("exports aggregated Qty and Pallets in the inventory summary", () => {
    const rows = buildInventorySummaryExportRows([
      createItem({ id: 1, quantity: 10, pallets: 2, locationId: 1, containerNo: "CONT-A" }),
      createItem({ id: 2, quantity: 15, pallets: 3, locationId: 2, containerNo: "CONT-B" })
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ onHand: 25, pallets: 5 });
  });

  it("exports Qty and Pallets for inventory detail and container contents", () => {
    const item = createItem({ quantity: 18, pallets: 4, containerNo: "CONT-A" });

    expect(buildInventoryDetailExportRows([item])[0]).toMatchObject({ quantity: 18, pallets: 4 });
    expect(buildContainerContentsExportRows([item])[0]).toMatchObject({ onHand: 18, pallets: 4 });
  });
});
