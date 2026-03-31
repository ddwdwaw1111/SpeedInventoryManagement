import { describe, expect, it } from "vitest";

import { buildItemContainerBalances, formatContainerDistributionSummary } from "./containerBalances";
import { createItem, createMovement } from "../test/fixtures";

describe("containerBalances", () => {
  it("reconstructs container balances from movements when current inventory is merged", () => {
    const balances = buildItemContainerBalances(
      [
        createItem({
          id: 1,
          quantity: 10,
          availableQty: 10,
          storageSection: "TEMP",
          containerNo: ""
        })
      ],
      [
        createMovement({
          id: 101,
          quantityChange: 6,
          containerNo: "GCXU5817233",
          createdAt: "2026-03-24T08:00:00Z"
        }),
        createMovement({
          id: 102,
          quantityChange: 4,
          containerNo: "MRSU6884820",
          createdAt: "2026-03-24T09:00:00Z"
        })
      ]
    );

    expect(balances).toHaveLength(2);
    expect(balances.map((balance) => ({
      containerNo: balance.containerNo,
      onHandQty: balance.onHandQty,
      availableQty: balance.availableQty
    }))).toEqual([
      { containerNo: "GCXU5817233", onHandQty: 6, availableQty: 6 },
      { containerNo: "MRSU6884820", onHandQty: 4, availableQty: 4 }
    ]);
  });

  it("keeps current named container balances when the inventory is already split into containers", () => {
    const balances = buildItemContainerBalances(
      [
        createItem({
          id: 1,
          quantity: 5,
          availableQty: 5,
          containerNo: "GCXU5817233",
          createdAt: "2026-03-24T08:00:00Z"
        }),
        createItem({
          id: 2,
          quantity: 5,
          availableQty: 5,
          containerNo: "MRSU6884820",
          createdAt: "2026-03-24T09:00:00Z"
        })
      ],
      [
        createMovement({
          id: 201,
          quantityChange: 10,
          containerNo: "GCXU5817233"
        })
      ]
    );

    expect(balances).toHaveLength(2);
    expect(balances.map((balance) => balance.containerNo)).toEqual(["GCXU5817233", "MRSU6884820"]);
  });

  it("formats a stable container distribution summary with location fallback labels", () => {
    const summary = formatContainerDistributionSummary([
      {
        containerNo: "",
        availableQty: 2,
        locationName: "NJ",
        storageSection: "TEMP"
      },
      {
        containerNo: "MRSU6884820",
        availableQty: 4,
        locationName: "NJ",
        storageSection: "A"
      },
      {
        containerNo: "GCXU5817233",
        availableQty: 6,
        locationName: "NJ",
        storageSection: "TEMP"
      }
    ]);

    expect(summary).toBe("GCXU5817233:6 | MRSU6884820:4 | NJ/TEMP:2");
  });
});
