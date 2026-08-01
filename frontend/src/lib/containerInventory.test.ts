import { describe, expect, it } from "vitest";

import { createItem, createLocation, createMovement } from "../test/fixtures";
import { buildAllContainerContentsRows } from "./containerInventory";

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
});
