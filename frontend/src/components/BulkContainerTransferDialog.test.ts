import { describe, expect, it } from "vitest";

import { buildContainerContentsRows } from "../lib/containerInventory";
import { createItem, createLocation } from "../test/fixtures";
import { buildBulkContainerTransferPlan } from "./BulkContainerTransferDialog";

describe("buildBulkContainerTransferPlan", () => {
  it("builds one atomic transfer payload for multiple full containers and skips stock already at the destination", () => {
    const source = createLocation({ id: 1, name: "99" });
    const destination = createLocation({ id: 2, name: "308" });
    const rows = buildContainerContentsRows([
      createItem({ id: 1, containerNo: "CONT-A", locationId: source.id, locationName: source.name, quantity: 120, availableQty: 120, pallets: 4, availablePallets: 4 }),
      createItem({ id: 2, skuMasterId: 2, sku: "UPC-B", containerNo: "CONT-B", locationId: source.id, locationName: source.name, quantity: 80, availableQty: 80, pallets: 2, availablePallets: 2 }),
      createItem({ id: 3, skuMasterId: 3, sku: "UPC-C", containerNo: "CONT-C", locationId: destination.id, locationName: destination.name, quantity: 40, availableQty: 40, pallets: 1, availablePallets: 1 })
    ], [], [source, destination], "", "all", "all");

    const plan = buildBulkContainerTransferPlan(rows, destination.id, "TEMP", "2026-08-10T09:30", "Physical warehouse move");

    expect(plan.movableContainers).toBe(2);
    expect(plan.alreadyAtDestination).toEqual(["CONT-C"]);
    expect(plan.blockedContainers).toEqual([]);
    expect(plan.totalQty).toBe(200);
    expect(plan.totalPallets).toBe(6);
    expect(plan.payload.lines).toHaveLength(2);
    expect(plan.payload.lines?.every((line) => line.toLocationId === destination.id && line.toStorageSection === "TEMP")).toBe(true);
    expect(plan.payload.notes).toBe("Physical warehouse move");
  });

  it("blocks the whole batch when a selected container is not fully available", () => {
    const source = createLocation({ id: 1, name: "99" });
    const destination = createLocation({ id: 2, name: "308" });
    const rows = buildContainerContentsRows([
      createItem({ id: 10, containerNo: "READY", locationId: source.id, locationName: source.name, quantity: 100, availableQty: 100, pallets: 5, availablePallets: 5 }),
      createItem({ id: 11, skuMasterId: 2, sku: "UPC-HOLD", containerNo: "BLOCKED", locationId: source.id, locationName: source.name, quantity: 60, availableQty: 50, pallets: 3, availablePallets: 3 })
    ], [], [source, destination], "", "all", "all");

    const plan = buildBulkContainerTransferPlan(rows, destination.id, "TEMP");

    expect(plan.blockedContainers).toEqual(["BLOCKED"]);
    expect(plan.movableContainers).toBe(1);
    expect(plan.payload.lines).toHaveLength(1);
  });
});
