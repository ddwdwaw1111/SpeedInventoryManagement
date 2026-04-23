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
        pickPallets: [],
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
        pickPallets: [],
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
            createdAt: "2026-03-24T10:05:00Z"
          }
        ]
      }
    ]
  };
}

describe("buildPickSheetDocument", () => {
  it("groups rows into separate warehouse sections with subtotals", () => {
    const document = buildPickSheetDocument(createOutboundDocumentFixture());

    expect(document.warehouseGroups).toHaveLength(2);

    const nj = document.warehouseGroups.find((group) => group.warehouse === "NJ");
    const pa = document.warehouseGroups.find((group) => group.warehouse === "PA");

    expect(nj).toBeDefined();
    expect(pa).toBeDefined();
    expect(nj!.totalQty).toBe(20);
    expect(pa!.totalQty).toBe(15);
    expect(nj!.rows.map((row) => row.containerNo).sort()).toEqual(["SEGU6542651", "SHYA1211-2720"]);
    expect(pa!.rows[0].containerNo).toBe("CAJU5283887");
    expect(document.totalQty).toBe(35);
  });

  it("preserves allocation container numbers on rows for picker reference", () => {
    const document = buildPickSheetDocument(createOutboundDocumentFixture());
    const containers = document.rows.map((row) => row.containerNo).sort();
    expect(containers).toEqual(["CAJU5283887", "SEGU6542651", "SHYA1211-2720"]);
  });
});

describe("buildPickSheetDefinition", () => {
  it("renders a titled header per warehouse and a per-section table", () => {
    const document = buildPickSheetDocument(createOutboundDocumentFixture());
    const definition = buildPickSheetDefinition(document);

    expect(definition.pageOrientation).toBe("landscape");
    const content = definition.content as unknown as Array<Record<string, unknown>>;

    const headerTexts = content
      .map((block) => {
        const body = (block?.table as { body?: Array<Array<{ text?: string }>> } | undefined)?.body;
        return body?.[0]?.[0]?.text;
      })
      .filter((text): text is string => typeof text === "string");

    expect(headerTexts.some((text) => text.includes("Warehouse: NJ"))).toBe(true);
    expect(headerTexts.some((text) => text.includes("Warehouse: PA"))).toBe(true);

    const firstRowTable = content.find((block) => {
      const body = (block?.table as { body?: Array<Array<{ text?: string }>> } | undefined)?.body;
      return body?.[0]?.[0]?.text === "SN";
    });
    expect(firstRowTable).toBeDefined();
    const body = (firstRowTable!.table as { body: Array<Array<{ text: string }>> }).body;
    expect(body[0][5].text).toBe("Container No.");
    expect(body[0][7].text).toBe("Pallets");
  });
});
