import { describe, expect, it, vi } from "vitest";

vi.mock("pdfmake/build/pdfmake", () => ({
  createPdf: () => ({ download: () => undefined })
}));

import { buildPickSheetDefinition, buildPickSheetDocument } from "./outboundPickSheetPdf";
import type { OutboundDocument } from "./types";

function createOutboundDocumentFixture(): OutboundDocument {
  return {
    id: 12,
    packingListNo: "PL-1001",
    orderRef: "PO-2002",
    customerId: 7,
    customerName: "Imperial Bag & Paper",
    expectedShipDate: "2026-03-24" as unknown as OutboundDocument["expectedShipDate"],
    actualShipDate: "2026-03-24" as unknown as OutboundDocument["actualShipDate"],
    shipToName: "Jersey City",
    shipToAddress: "255 ROUTE 1 & 9, JERSEY CITY, NJ 07306",
    shipToContact: "201-437-7440",
    carrierName: "Internal Fleet",
    documentNote: "Handle with care",
    status: "CONFIRMED",
    trackingStatus: "CONFIRMED",
    confirmedAt: "2026-03-24T12:00:00Z" as unknown as OutboundDocument["confirmedAt"],
    deletedAt: null,
    archivedAt: null,
    totalLines: 2,
    totalQty: 35,
    totalNetWeightKgs: 120.5,
    totalGrossWeightKgs: 130.75,
    storages: "NJ / A, PA / B",
    createdAt: "2026-03-24T10:00:00Z",
    updatedAt: "2026-03-24T12:00:00Z",
    lines: [
      {
        id: 101,
        documentId: 12,
        skuMasterId: 501,
        itemNumber: "608333",
        locationId: 1,
        locationName: "NJ",
        storageSection: "A",
        sku: "608333",
        description: "VB22GC",
        quantity: 20,
        pallets: 2,
        palletsDetailCtns: "2*10",
        unitLabel: "CTN",
        cartonSizeMm: "400*300*200",
        netWeightKgs: 60.25,
        grossWeightKgs: 65.5,
        lineNote: "Top priority",
        createdAt: "2026-03-24T10:00:00Z",
        pickAllocations: [
          {
            id: 1,
            lineId: 101,
            itemNumber: "608333",
            locationId: 1,
            locationName: "NJ",
            storageSection: "A",
            containerNo: "SEGU6542651",
            allocatedQty: 12,
            pallets: 1,
            createdAt: "2026-03-24T10:00:00Z"
          },
          {
            id: 2,
            lineId: 101,
            itemNumber: "608333",
            locationId: 1,
            locationName: "NJ",
            storageSection: "A",
            containerNo: "SHYA1211-2720",
            allocatedQty: 8,
            pallets: 1,
            createdAt: "2026-03-24T10:00:00Z"
          }
        ]
      },
      {
        id: 102,
        documentId: 12,
        skuMasterId: 502,
        itemNumber: "603482",
        locationId: 2,
        locationName: "PA",
        storageSection: "B",
        sku: "603482",
        description: "VBTL",
        quantity: 15,
        pallets: 1,
        palletsDetailCtns: "1*15",
        unitLabel: "CTN",
        cartonSizeMm: "450*320*210",
        netWeightKgs: 60.25,
        grossWeightKgs: 65.25,
        lineNote: "",
        createdAt: "2026-03-24T10:05:00Z",
        pickAllocations: [
          {
            id: 3,
            lineId: 102,
            itemNumber: "603482",
            locationId: 2,
            locationName: "PA",
            storageSection: "B",
            containerNo: "CAJU5283887",
            allocatedQty: 15,
            pallets: 1,
            createdAt: "2026-03-24T10:05:00Z"
          }
        ]
      }
    ]
  };
}

describe("buildPickSheetDocument", () => {
  it("groups rows into sku, warehouse, and container sections with subtotals", () => {
    const document = buildPickSheetDocument(createOutboundDocumentFixture());

    expect(document.skuGroups).toHaveLength(2);

    const sku608333 = document.skuGroups.find((group) => group.sku === "608333");
    const sku603482 = document.skuGroups.find((group) => group.sku === "603482");
    const nj = sku608333?.warehouseGroups.find((group) => group.warehouse === "NJ");
    const pa = sku603482?.warehouseGroups.find((group) => group.warehouse === "PA");

    expect(sku608333).toBeDefined();
    expect(sku603482).toBeDefined();
    expect(nj).toBeDefined();
    expect(pa).toBeDefined();
    expect(sku608333!.totalQty).toBe(20);
    expect(sku608333!.totalPallets).toBe(2);
    expect(sku608333!.warehouseGroups).toHaveLength(1);
    expect(nj!.totalQty).toBe(20);
    expect(nj!.totalPallets).toBe(2);
    expect(nj!.containerGroups).toHaveLength(2);
    expect(pa!.totalQty).toBe(15);
    expect(nj!.rows.map((row) => row.containerNo).sort()).toEqual(["SEGU6542651", "SHYA1211-2720"]);
    expect(pa!.rows[0].containerNo).toBe("CAJU5283887");
    expect(document.skuGroups.flatMap((group) => group.warehouseGroups.flatMap((warehouseGroup) => warehouseGroup.containerGroups.map((containerGroup) => containerGroup.containerNo))).sort()).toEqual(["CAJU5283887", "SEGU6542651", "SHYA1211-2720"]);
    expect(document.totalQty).toBe(35);
    expect(document.totalPallets).toBe(3);
    expect(document.totalContainers).toBe(3);
    expect(document.totalDemandLines).toBe(2);
  });

  it("shows how many warehouses a sku must be picked from", () => {
    const fixture = createOutboundDocumentFixture();
    fixture.lines = [{
      ...fixture.lines[0],
      quantity: 30,
      pallets: 3,
      pickAllocations: [
        {
          id: 11,
          lineId: 101,
          itemNumber: "608333",
          locationId: 1,
          locationName: "NJ",
          storageSection: "A",
          containerNo: "NJ-CONTAINER-1",
          allocatedQty: 12,
          pallets: 1,
          createdAt: "2026-03-24T10:00:00Z"
        },
        {
          id: 12,
          lineId: 101,
          itemNumber: "608333",
          locationId: 2,
          locationName: "PA",
          storageSection: "B",
          containerNo: "PA-CONTAINER-1",
          allocatedQty: 18,
          pallets: 2,
          createdAt: "2026-03-24T10:00:00Z"
        }
      ]
    }];

    const document = buildPickSheetDocument(fixture);
    const skuGroup = document.skuGroups[0];

    expect(skuGroup.totalQty).toBe(30);
    expect(skuGroup.totalPallets).toBe(3);
    expect(skuGroup.warehouseGroups).toHaveLength(2);
    expect(skuGroup.warehouseGroups.map((group) => `${group.warehouse}:${group.totalQty}:${group.totalPallets}`)).toEqual([
      "NJ:12:1",
      "PA:18:2"
    ]);
  });

  it("groups by sku even when item metadata differs", () => {
    const fixture = createOutboundDocumentFixture();
    fixture.lines = [
      {
        ...fixture.lines[0],
        id: 401,
        quantity: 5,
        pallets: 1,
        itemNumber: "ITEM-A",
        description: "Old description",
        unitLabel: "CTN",
        lineNote: "",
        pickAllocations: [
          {
            id: 41,
            lineId: 401,
            itemNumber: "ALLOC-ITEM-A",
            locationId: 1,
            locationName: "NJ",
            storageSection: "A",
            containerNo: "SAME-CONTAINER",
            allocatedQty: 5,
            pallets: 1,
            createdAt: "2026-03-24T10:00:00Z"
          }
        ]
      },
      {
        ...fixture.lines[0],
        id: 402,
        quantity: 7,
        pallets: 1,
        itemNumber: "ITEM-B",
        description: "New description",
        unitLabel: "EA",
        lineNote: "",
        pickAllocations: [
          {
            id: 42,
            lineId: 402,
            itemNumber: "ALLOC-ITEM-B",
            locationId: 1,
            locationName: "NJ",
            storageSection: "A",
            containerNo: "SAME-CONTAINER",
            allocatedQty: 7,
            pallets: 1,
            createdAt: "2026-03-24T10:05:00Z"
          }
        ]
      }
    ];

    const document = buildPickSheetDocument(fixture);
    const skuGroup = document.skuGroups[0];

    expect(document.skuGroups).toHaveLength(1);
    expect(skuGroup.sku).toBe("608333");
    expect(skuGroup.totalQty).toBe(12);
    expect(skuGroup.totalPallets).toBe(2);
    expect(skuGroup.warehouseGroups[0]?.containerGroups[0]?.rows).toHaveLength(2);
  });

  it("preserves allocation container numbers on rows for picker reference", () => {
    const document = buildPickSheetDocument(createOutboundDocumentFixture());
    const containers = document.rows.map((row) => row.containerNo).sort();
    expect(containers).toEqual(["CAJU5283887", "SEGU6542651", "SHYA1211-2720"]);
  });

  it("shows the actual pallet count for the same sku split across different containers", () => {
    const fixture = createOutboundDocumentFixture();
    fixture.lines = [{
      ...fixture.lines[0],
      id: 301,
      itemNumber: "011423",
      sku: "011423",
      description: "Container-split sku",
      quantity: 60,
      pallets: 6,
      pickAllocations: [
        {
          id: 31,
          lineId: 301,
          itemNumber: "011423",
          locationId: 1,
          locationName: "NJ",
          storageSection: "A",
          containerNo: "CONTAINER-1",
          allocatedQty: 10,
          pallets: 1,
          createdAt: "2026-03-24T10:00:00Z"
        },
        {
          id: 32,
          lineId: 301,
          itemNumber: "011423",
          locationId: 1,
          locationName: "NJ",
          storageSection: "A",
          containerNo: "CONTAINER-2",
          allocatedQty: 20,
          pallets: 2,
          createdAt: "2026-03-24T10:00:00Z"
        },
        {
          id: 33,
          lineId: 301,
          itemNumber: "011423",
          locationId: 1,
          locationName: "NJ",
          storageSection: "A",
          containerNo: "CONTAINER-3",
          allocatedQty: 30,
          pallets: 3,
          createdAt: "2026-03-24T10:00:00Z"
        }
      ]
    }];

    const document = buildPickSheetDocument(fixture);
    const skuRows = document.rows.filter((row) => row.sku === "011423");

    expect(skuRows).toHaveLength(3);
    expect(skuRows.map((row) => `${row.containerNo}:${row.pallets}`)).toEqual([
      "CONTAINER-1:1",
      "CONTAINER-2:2",
      "CONTAINER-3:3"
    ]);
    expect(document.totalPallets).toBe(6);
  });

  it("keeps the same container number on every sku row when multiple skus share one container", () => {
    const fixture = createOutboundDocumentFixture();
    fixture.lines = [
      {
        ...fixture.lines[0],
        id: 201,
        skuMasterId: 601,
        itemNumber: "SKU-SHARED-A",
        sku: "SKU-SHARED-A",
        description: "Shared container sku A",
        quantity: 5,
        pallets: 1,
        pickAllocations: [
          {
            id: 21,
            lineId: 201,
            itemNumber: "SKU-SHARED-A",
            locationId: 1,
            locationName: "NJ",
            storageSection: "A",
            containerNo: "MSCU-SHARED-001",
            allocatedQty: 5,
            pallets: 1,
            createdAt: "2026-03-24T10:00:00Z"
          }
        ]
      },
      {
        ...fixture.lines[1],
        id: 202,
        skuMasterId: 602,
        itemNumber: "SKU-SHARED-B",
        sku: "SKU-SHARED-B",
        description: "Shared container sku B",
        locationId: 1,
        locationName: "NJ",
        storageSection: "A",
        quantity: 7,
        pallets: 1,
        pickAllocations: [
          {
            id: 22,
            lineId: 202,
            itemNumber: "SKU-SHARED-B",
            locationId: 1,
            locationName: "NJ",
            storageSection: "A",
            containerNo: "MSCU-SHARED-001",
            allocatedQty: 7,
            pallets: 1,
            createdAt: "2026-03-24T10:05:00Z"
          }
        ]
      }
    ];

    const document = buildPickSheetDocument(fixture);
    const sharedRows = document.rows.filter((row) => row.containerNo === "MSCU-SHARED-001");

    expect(sharedRows).toHaveLength(2);
    expect(sharedRows.map((row) => row.sku).sort()).toEqual(["SKU-SHARED-A", "SKU-SHARED-B"]);
    expect(document.skuGroups).toHaveLength(2);
    expect(document.skuGroups.every((group) => group.warehouseGroups[0]?.containerGroups[0]?.containerNo === "MSCU-SHARED-001")).toBe(true);
    expect(document.totalContainers).toBe(1);
    expect(document.totalPallets).toBe(2);
  });

  it("keeps separate rows for the same container and sku when they satisfy different demand lines", () => {
    const fixture = createOutboundDocumentFixture();
    fixture.lines = [
      {
        ...fixture.lines[0],
        id: 401,
        quantity: 5,
        pallets: 1,
        lineNote: "",
        pickAllocations: [
          {
            id: 41,
            lineId: 401,
            itemNumber: "608333",
            locationId: 1,
            locationName: "NJ",
            storageSection: "A",
            containerNo: "SAME-CONTAINER",
            allocatedQty: 5,
            pallets: 1,
            createdAt: "2026-03-24T10:00:00Z"
          }
        ]
      },
      {
        ...fixture.lines[0],
        id: 402,
        quantity: 7,
        pallets: 1,
        lineNote: "",
        pickAllocations: [
          {
            id: 42,
            lineId: 402,
            itemNumber: "608333",
            locationId: 1,
            locationName: "NJ",
            storageSection: "A",
            containerNo: "SAME-CONTAINER",
            allocatedQty: 7,
            pallets: 1,
            createdAt: "2026-03-24T10:05:00Z"
          }
        ]
      }
    ];

    const document = buildPickSheetDocument(fixture);
    const sameSkuRows = document.rows.filter((row) => row.containerNo === "SAME-CONTAINER" && row.sku === "608333");

    expect(sameSkuRows).toHaveLength(2);
    expect(sameSkuRows.map((row) => row.quantity)).toEqual([5, 7]);
  });

  it("normalizes warehouse names before grouping containers", () => {
    const fixture = createOutboundDocumentFixture();
    fixture.lines = [
      {
        ...fixture.lines[0],
        id: 501,
        quantity: 5,
        pallets: 1,
        lineNote: "",
        pickAllocations: [
          {
            id: 51,
            lineId: 501,
            itemNumber: "608333",
            locationId: 1,
            locationName: "NJ",
            storageSection: "A",
            containerNo: "SAME-CONTAINER",
            allocatedQty: 5,
            pallets: 1,
            createdAt: "2026-03-24T10:00:00Z"
          }
        ]
      },
      {
        ...fixture.lines[0],
        id: 502,
        quantity: 7,
        pallets: 1,
        lineNote: "",
        pickAllocations: [
          {
            id: 52,
            lineId: 502,
            itemNumber: "608333",
            locationId: 1,
            locationName: "NJ ",
            storageSection: "A",
            containerNo: "SAME-CONTAINER",
            allocatedQty: 7,
            pallets: 1,
            createdAt: "2026-03-24T10:05:00Z"
          }
        ]
      }
    ];

    const document = buildPickSheetDocument(fixture);
    const warehouseGroup = document.skuGroups[0]?.warehouseGroups[0];

    expect(document.totalContainers).toBe(1);
    expect(warehouseGroup?.warehouse).toBe("NJ");
    expect(warehouseGroup?.containerGroups).toHaveLength(1);
    expect(warehouseGroup?.containerGroups[0]?.rows).toHaveLength(2);
  });

  it("fails closed when a line has no stored pick allocations", () => {
    const fixture = createOutboundDocumentFixture();
    fixture.lines[0] = {
      ...fixture.lines[0],
      pickAllocations: []
    };

    expect(() => buildPickSheetDocument(fixture)).toThrow(/stored pick allocations/i);
  });

  it("omits plan-only zero-actual lines without requiring pick allocations", () => {
    const fixture = createOutboundDocumentFixture();
    fixture.lines[1] = {
      ...fixture.lines[1],
      plannedQuantity: 15,
      actualQuantity: 0,
      quantity: 0,
      pallets: 0,
      pickAllocations: []
    };

    const document = buildPickSheetDocument(fixture);

    expect(document.rows).toHaveLength(2);
    expect(document.rows.every((row) => row.sku === "608333")).toBe(true);
    expect(document.totalQty).toBe(20);
    expect(document.totalPallets).toBe(2);
    expect(document.totalDemandLines).toBe(1);
  });
});

describe("buildPickSheetDefinition", () => {
  it("renders one sku section with separate warehouse rows when the same sku is split across warehouses", () => {
    const fixture = createOutboundDocumentFixture();
    fixture.lines = [{
      ...fixture.lines[0],
      quantity: 30,
      pallets: 3,
      pickAllocations: [
        {
          id: 11,
          lineId: 101,
          itemNumber: "608333",
          locationId: 1,
          locationName: "NJ",
          storageSection: "A",
          containerNo: "NJ-CONTAINER-1",
          allocatedQty: 12,
          pallets: 1,
          createdAt: "2026-03-24T10:00:00Z"
        },
        {
          id: 12,
          lineId: 101,
          itemNumber: "608333",
          locationId: 2,
          locationName: "PA",
          storageSection: "B",
          containerNo: "PA-CONTAINER-1",
          allocatedQty: 18,
          pallets: 2,
          createdAt: "2026-03-24T10:00:00Z"
        }
      ]
    }];

    const definition = buildPickSheetDefinition(buildPickSheetDocument(fixture));
    const content = definition.content as unknown as Array<Record<string, unknown>>;
    const skuHeaderTables = content.filter((block) => {
      const body = (block?.table as { body?: Array<Array<{ text?: string }>> } | undefined)?.body;
      return body?.[0]?.[0]?.text?.startsWith("SKU: ");
    });

    expect(skuHeaderTables).toHaveLength(1);
    const skuHeaderBody = (skuHeaderTables[0].table as { body: Array<Array<{ text: string }>> }).body;
    expect(skuHeaderBody[0][0].text).toBe("SKU: 608333");
    expect(skuHeaderBody[0][1].text).toBe("Total Qty: 30");
    expect(skuHeaderBody[0][2].text).toBe("Total Pallet: 3");
    expect(skuHeaderBody[0][3].text).toBe("Warehouses: 2");
    expect(skuHeaderBody[0][4].text).toBe("Containers: 2");

    const pickTable = content.find((block) => {
      const body = (block?.table as { body?: Array<Array<{ text?: string }>> } | undefined)?.body;
      return body?.[0]?.[0]?.text === "Container No.";
    });
    expect(pickTable).toBeDefined();
    const pickBody = (pickTable!.table as { body: Array<Array<{ text: string }>> }).body;
    expect(pickBody[1][0].text).toBe("Warehouse: NJ | Containers: 1");
    expect(pickBody[1][2].text).toBe("12");
    expect(pickBody[1][3].text).toBe("1");
    expect(pickBody[2][0].text).toBe("NJ-CONTAINER-1");
    expect(pickBody[2][1].text).toBe("A");
    expect(pickBody[2][2].text).toBe("12");
    expect(pickBody[2][3].text).toBe("1");
    expect(pickBody[3][0].text).toBe("Warehouse: PA | Containers: 1");
    expect(pickBody[3][2].text).toBe("18");
    expect(pickBody[3][3].text).toBe("2");
    expect(pickBody[4][0].text).toBe("PA-CONTAINER-1");
    expect(pickBody[4][1].text).toBe("B");
    expect(pickBody[4][2].text).toBe("18");
    expect(pickBody[4][3].text).toBe("2");
  });

  it("renders sku, warehouse, and container-grouped pick tables", () => {
    const document = buildPickSheetDocument(createOutboundDocumentFixture());
    const definition = buildPickSheetDefinition(document);

    expect(definition.pageOrientation).toBe("portrait");
    const content = definition.content as unknown as Array<Record<string, unknown>>;

    const titleBody = (content[0]?.table as { body: Array<Array<{ stack?: Array<{ text: string }> }>> } | undefined)?.body;
    expect(titleBody?.[0]).toHaveLength(1);

    const metadataBody = (content[1]?.table as { body: Array<Array<{ stack?: Array<{ text: string }> }>> } | undefined)?.body;
    expect(metadataBody?.[0]?.[0]?.stack?.[0]?.text).toBe("Pick Date");
    expect(metadataBody?.[0]?.[0]?.stack?.[1]?.text).toBe("03/24/2026");
    expect(metadataBody?.[0]?.[1]?.stack?.[0]?.text).toBe("Remarks");
    expect(metadataBody?.[0]?.[1]?.stack?.[1]?.text).toBe("Handle with care");

    const serializedContent = JSON.stringify(content);
    expect(serializedContent).toContain("SKU: 608333");
    expect(serializedContent).not.toContain("SKU Pick Plan");
    expect(serializedContent).not.toContain("SKU Total:");
    expect(serializedContent).not.toContain("Total Item Qty");
    expect(serializedContent).not.toContain("Total Pallets");
    expect(serializedContent).not.toContain("Demand Lines");
    expect(serializedContent).not.toContain("Customer");
    expect(serializedContent).not.toContain("Expected Ship Date");
    expect(serializedContent).not.toContain("Actual Ship Date");
    expect(serializedContent).not.toContain("VB22GC");
    expect(serializedContent).not.toContain("VBTL");
    expect(serializedContent).not.toContain("Need CTN");
    expect(serializedContent).not.toContain("Need PLT");
    expect(serializedContent).not.toContain("Pick CTN");
    expect(serializedContent).not.toContain("Pick PLT");
    expect(serializedContent).not.toContain("PLT:");
    expect(serializedContent).not.toContain("WH:");
    expect(serializedContent).not.toContain("Cont.:");
    expect(serializedContent).not.toContain("Picked");
    expect(serializedContent).not.toContain("Demand");
    expect(serializedContent).not.toContain("Container No.:");
    expect(serializedContent).not.toContain("Item / SKU");
    expect(serializedContent).not.toContain("Item Description");

    const skuHeaderTable = content.find((block) => {
      const body = (block?.table as { body?: Array<Array<{ text?: string }>> } | undefined)?.body;
      return body?.[0]?.[0]?.text?.includes("SKU: 608333");
    });
    expect(skuHeaderTable).toBeDefined();
    const skuHeaderBody = (skuHeaderTable!.table as { body: Array<Array<{ text: string }>> }).body;
    expect(skuHeaderBody[0][1].text).toBe("Total Qty: 20");
    expect(skuHeaderBody[0][2].text).toBe("Total Pallet: 2");
    expect(skuHeaderBody[0][3].text).toBe("Warehouses: 1");
    expect(skuHeaderBody[0][4].text).toBe("Containers: 2");

    const pickTable = content.find((block) => {
      const body = (block?.table as { body?: Array<Array<{ text?: string }>> } | undefined)?.body;
      return body?.[0]?.[0]?.text === "Container No.";
    });
    expect(pickTable).toBeDefined();
    const pickBody = (pickTable!.table as { body: Array<Array<{ text: string }>> }).body;
    expect(pickBody[0][0].text).toBe("Container No.");
    expect(pickBody[0][1].text).toBe("Section");
    expect(pickBody[0][2].text).toBe("Qty");
    expect(pickBody[0][3].text).toBe("Pallet Qty");
    expect(pickBody[1][0].text).toBe("Warehouse: NJ | Containers: 2");
    expect(pickBody[1][2].text).toBe("20");
    expect(pickBody[1][3].text).toBe("2");
    expect(pickBody[2][0].text).toBe("SEGU6542651");
    expect(pickBody[2][1].text).toBe("A");
    expect(pickBody[2][2].text).toBe("12");
    expect(pickBody[2][3].text).toBe("1");
    expect(pickBody[3][0].text).toBe("SHYA1211-2720");
    expect(pickBody[3][1].text).toBe("A");
    expect(pickBody[3][2].text).toBe("8");
    expect(pickBody[3][3].text).toBe("1");
    expect(serializedContent).not.toContain("Picked By");
    expect(serializedContent).not.toContain("Checked By");
    expect(serializedContent).not.toContain("Packed By");

    const footer = typeof definition.footer === "function"
      ? definition.footer(1, 1, { width: 595, height: 842, orientation: "portrait" }) as { columns: Array<{ text?: string; stack?: Array<{ text: string }> }> }
      : undefined;
    expect(footer?.columns[0].stack?.[1].text).toBe("Version 1.0");
  });
});
