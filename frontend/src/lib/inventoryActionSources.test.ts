import { describe, expect, it } from "vitest";

import { buildInventoryActionSourceKey, buildInventoryActionSourceOptions } from "./inventoryActionSources";
import { createItem } from "../test/fixtures";

describe("inventoryActionSources", () => {
  it("builds stable source keys by customer and normalized SKU", () => {
    expect(buildInventoryActionSourceKey(7, "  sku-1001 ")).toBe("7:SKU-1001");
  });

  it("aggregates inventory rows into one action source per customer and SKU", () => {
    const sources = buildInventoryActionSourceOptions([
      createItem({
        id: 1,
        customerId: 7,
        customerName: "Acme",
        sku: "608333",
        itemNumber: "608333",
        description: "VB22GC",
        quantity: 5,
        availableQty: 4,
        locationId: 1,
        locationName: "NJ",
        storageSection: "TEMP",
        containerNo: "GCXU5817233"
      }),
      createItem({
        id: 2,
        customerId: 7,
        customerName: "Acme",
        sku: "608333",
        itemNumber: "608333",
        description: "VB22GC",
        quantity: 7,
        availableQty: 6,
        locationId: 2,
        locationName: "LA",
        storageSection: "A",
        containerNo: "MRSU6884820"
      })
    ]);

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      key: "7:608333",
      totalOnHand: 12,
      totalAvailable: 10,
      warehouseCount: 2,
      containerCount: 2
    });
  });
});
