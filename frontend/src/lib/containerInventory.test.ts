import { describe, expect, it } from "vitest";

import { createItem, createLocation, createMovement } from "../test/fixtures";
import { buildAllContainerContentsRows, buildContainerContentsRows } from "./containerInventory";

describe("container inventory identity", () => {
  it("separates inventory and timelines for customers sharing a container number", () => {
    const containerNo = "SHARED-CONT-001";
    const shippedAt = "2026-04-02T10:00:00Z";
    const rows = buildAllContainerContentsRows(
      [
        createItem({ id: 1, customerId: 1, customerName: "Customer Alpha", containerNo, quantity: 5, availableQty: 5 })
      ],
      [
        createMovement({ id: 1, customerId: 1, customerName: "Customer Alpha", containerNo, movementType: "IN" }),
        createMovement({ id: 2, customerId: 2, customerName: "Customer Beta", containerNo, movementType: "OUT", createdAt: shippedAt, outDate: "2026-04-02" })
      ],
      [createLocation()]
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.id)).toEqual([`1:${containerNo}`, `2:${containerNo}`]);
    expect(rows.find((row) => row.customerId === 1)).toMatchObject({ onHand: 5, shippedAt: null });
    expect(rows.find((row) => row.customerId === 2)).toMatchObject({ onHand: 0, shippedAt });
  });

  it("keeps the original inbound warehouse separate from the current warehouse", () => {
    const containerNo = "ORIGIN-CONT-001";
    const rows = buildAllContainerContentsRows(
      [
        createItem({
          id: 1,
          customerId: 1,
          customerName: "Customer Alpha",
          containerNo,
          locationName: "Warehouse 308",
          quantity: 5,
          availableQty: 5
        })
      ],
      [
        createMovement({ id: 1, customerId: 1, customerName: "Customer Alpha", containerNo, movementType: "IN", locationName: "Warehouse 99", deliveryDate: "2026-04-01", createdAt: "2026-04-01T09:00:00Z" }),
        createMovement({ id: 2, customerId: 1, customerName: "Customer Alpha", containerNo, movementType: "TRANSFER_IN", locationName: "Warehouse 308", createdAt: "2026-04-02T09:00:00Z" })
      ],
      [createLocation({ id: 1, name: "Warehouse 99" }), createLocation({ id: 2, name: "Warehouse 308" })]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      originalInboundWarehouse: "Warehouse 99",
      warehouseSummary: "Warehouse 308"
    });
  });

  it("uses UPC search to match a container without trimming its other inventory lines", () => {
    const rows = buildContainerContentsRows(
      [
        createItem({ id: 1, skuMasterId: 1, sku: "MATCH-UPC", containerNo: "FULL-CONT", quantity: 80, availableQty: 80, pallets: 2, availablePallets: 2 }),
        createItem({ id: 2, skuMasterId: 2, sku: "OTHER-UPC", containerNo: "FULL-CONT", quantity: 120, availableQty: 120, pallets: 3, availablePallets: 3 })
      ],
      [],
      [createLocation()],
      "match-upc",
      "all",
      "all"
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.items.map((item) => item.sku).sort()).toEqual(["MATCH-UPC", "OTHER-UPC"]);
    expect(rows[0]).toMatchObject({ onHand: 200, palletCount: 5, skuCount: 2 });
  });

  it("keeps the selected warehouse as the inventory scope after a container matches search", () => {
    const source = createLocation({ id: 1, name: "99" });
    const destination = createLocation({ id: 2, name: "308" });
    const rows = buildContainerContentsRows(
      [
        createItem({ id: 1, skuMasterId: 1, sku: "MATCH-UPC", containerNo: "SPLIT-CONT", locationId: source.id, locationName: source.name, quantity: 80, availableQty: 80 }),
        createItem({ id: 2, skuMasterId: 2, sku: "OTHER-UPC", containerNo: "SPLIT-CONT", locationId: source.id, locationName: source.name, quantity: 120, availableQty: 120 }),
        createItem({ id: 3, skuMasterId: 3, sku: "DEST-UPC", containerNo: "SPLIT-CONT", locationId: destination.id, locationName: destination.name, quantity: 40, availableQty: 40 })
      ],
      [],
      [source, destination],
      "match-upc",
      "all",
      String(source.id)
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.items.map((item) => item.sku).sort()).toEqual(["MATCH-UPC", "OTHER-UPC"]);
    expect(rows[0]?.items.every((item) => item.locationId === source.id)).toBe(true);
  });
});
