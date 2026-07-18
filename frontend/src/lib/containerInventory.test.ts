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
});
