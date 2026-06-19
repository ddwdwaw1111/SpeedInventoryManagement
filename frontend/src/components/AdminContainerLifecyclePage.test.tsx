import { describe, expect, it } from "vitest";

import type { InboundDocument, OutboundDocument } from "../lib/types";
import { buildOutboundOrderGoodsRows, buildReceivingSkuRows } from "./AdminContainerLifecyclePage";

describe("buildReceivingSkuRows", () => {
  it("summarizes expected quantity, received pallets, received quantity, and shortage reason by sku", () => {
    const rows = buildReceivingSkuRows([
      {
        id: 10,
        documentNote: "Document shortage note",
        lines: [
          { sku: "SKU-A", expectedQty: 30, receivedQty: 24, pallets: 3, lineNote: "Missing cartons" },
          { sku: "SKU-A", expectedQty: 20, receivedQty: 20, pallets: 2, lineNote: "" },
          { sku: "SKU-B", expectedQty: 10, receivedQty: 12, pallets: 1, lineNote: "Extra cartons" }
        ]
      }
    ] as unknown as InboundDocument[]);

    expect(rows).toMatchObject([
      {
        sku: "SKU-A",
        expectedQuantity: 50,
        receivedPallets: 5,
        receivedQuantity: 44,
        shortageReason: "Missing cartons"
      },
      {
        sku: "SKU-B",
        expectedQuantity: 10,
        receivedPallets: 1,
        receivedQuantity: 12,
        shortageReason: ""
      }
    ]);
    expect(rows[0]).not.toHaveProperty("expectedPallets");
  });
});

describe("buildOutboundOrderGoodsRows", () => {
  it("highlights only goods fulfilled by the current container", () => {
    const rows = buildOutboundOrderGoodsRows({
      id: 20,
      packingListNo: "PO-20",
      orderRef: "",
      lines: [
        {
          id: 1,
          sku: "SKU-A",
          itemNumber: "A",
          description: "Item A",
          quantity: 12,
          pallets: 1,
          pickAllocations: [
            { containerNo: "OTHER", allocatedQty: 12 }
          ]
        },
        {
          id: 2,
          sku: "SKU-B",
          itemNumber: "B",
          description: "Item B",
          quantity: 8,
          pallets: 2,
          pickAllocations: [
            { containerNo: "CNT-1", allocatedQty: 5 },
            { containerNo: "OTHER", allocatedQty: 3 }
          ]
        }
      ]
    } as unknown as OutboundDocument, "cnt-1");

    expect(rows).toMatchObject([
      { sku: "SKU-A", quantity: 12, allocatedQty: 0, highlighted: false },
      { sku: "SKU-B", quantity: 8, allocatedQty: 5, highlighted: true }
    ]);
  });

  it("falls back to highlighting all rows when old orders have no allocation data", () => {
    const rows = buildOutboundOrderGoodsRows({
      id: 21,
      packingListNo: "PO-21",
      orderRef: "",
      lines: [
        {
          id: 1,
          sku: "SKU-A",
          itemNumber: "A",
          description: "Item A",
          quantity: 12,
          pallets: 1,
          pickAllocations: []
        }
      ]
    } as unknown as OutboundDocument, "CNT-1");

    expect(rows).toMatchObject([
      { sku: "SKU-A", quantity: 12, allocatedQty: 12, highlighted: true }
    ]);
  });
});
