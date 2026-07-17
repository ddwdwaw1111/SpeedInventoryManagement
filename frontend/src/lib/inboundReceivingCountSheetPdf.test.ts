import { describe, expect, it, vi } from "vitest";

vi.mock("pdfmake/build/pdfmake", () => ({
  createPdf: () => ({ download: () => undefined })
}));

import {
  buildInboundReceivingCountSheetDefinition,
  buildInboundReceivingCountSheetDocument,
  buildInboundReceivingCountSheetInputFromDocument
} from "./inboundReceivingCountSheetPdf";
import type { InboundReceivingCountSheetInput } from "./inboundReceivingCountSheetPdf";

function createPackingListPreviewFixture(): InboundReceivingCountSheetInput {
  return {
    sourceFileName: "CHEN208-3220 PL.pdf",
    title: "Packing List",
    containerNo: "CHEN208-3220",
    referenceCode: "PO-7788",
    customerName: "Imperial Bag & Paper",
    warehouseName: "2801 Route",
    scheduledArrivalDate: "2026-04-25",
    receivingDate: "2026-04-26",
    unloadingDock: "Dock 3",
    remarks: "Count pallets after unloading.",
    unitLabel: "CTN",
    totalQty: 150,
    totalCartons: 150,
    totalNetWeightKgs: 1200,
    totalGrossWeightKgs: 1320,
    lines: [
      {
        sequence: 1,
        itemNumber: "ITM-100",
        sku: "608333",
        description: "Black nitrile gloves",
        quantity: 100,
        unitLabel: "CTN",
        cartonSizeMm: "400*300*200",
        cartonCount: 100,
        netWeightKgs: 800,
        grossWeightKgs: 880
      },
      {
        sequence: 2,
        itemNumber: "ITM-200",
        sku: "603482",
        description: "Clear liner",
        quantity: 50,
        unitLabel: "CTN",
        cartonSizeMm: "450*320*210",
        cartonCount: 50,
        netWeightKgs: 400,
        grossWeightKgs: 440
      }
    ]
  };
}

describe("buildInboundReceivingCountSheetDocument", () => {
  it("keeps packing-list quantities and leaves pallet count for dock counting", () => {
    const document = buildInboundReceivingCountSheetDocument(createPackingListPreviewFixture());

    expect(document.fileName).toBe("receiving-tally-sheet-chen208-3220.pdf");
    expect(document.containerNo).toBe("CHEN208-3220");
    expect(document.rows).toHaveLength(2);
    expect(document.rows[0]).toMatchObject({
      sequence: 1,
      sku: "608333",
      itemNumber: "ITM-100",
      description: "Black nitrile gloves",
      expectedQty: 100,
      actualQty: null,
      expectedPalletQty: null,
      actualPalletQty: null,
      palletDetails: ""
    });
    expect(document.totalPallets).toBeNull();
  });

  it("can build the count sheet input from an inbound document", () => {
    const input = buildInboundReceivingCountSheetInputFromDocument({
      id: 42,
      customerId: 1,
      customerName: "Imperial Bag & Paper",
      locationId: 2,
      locationName: "2801 Route",
      expectedArrivalDate: "2026-04-25",
      actualArrivalDate: null,
      containerNo: "CHEN208-3220",
      containerType: "NORMAL",
      handlingMode: "PALLETIZED",
      storageSection: "TEMP",
      unitLabel: "CTN",
      documentNote: "Count pallets after unloading.",
      status: "DRAFT",
      trackingStatus: "SCHEDULED",
      confirmedAt: null,
      deletedAt: null,
      archivedAt: null,
      totalLines: 1,
      totalExpectedQty: 120,
      totalReceivedQty: 0,
      createdAt: "2026-04-24T12:00:00Z",
      updatedAt: "2026-04-24T12:00:00Z",
      lines: [{
        id: 1,
        documentId: 42,
        sku: "608333",
        description: "Black nitrile gloves",
        storageSection: "TEMP",
        reorderLevel: 0,
        expectedQty: 120,
        receivedQty: 0,
        pallets: 4,
        unitsPerPallet: 0,
        palletsDetailCtns: "4 pallets on dock",
        unitLabel: "CTN",
        lineNote: "",
        createdAt: "2026-04-24T12:00:00Z"
      }]
    });

    expect(input.sourceFileName).toBe("Inbound Receipt #42");
    expect(input.customerName).toBe("Imperial Bag & Paper");
    expect(input.warehouseName).toBe("2801 Route");
    expect(input.containerType).toBe("NORMAL");
    expect(input.totalPallets).toBeNull();
    expect(input.totalQty).toBe(120);
    expect(input.totalCartons).toBe(120);
    expect(input.lines[0]).toMatchObject({
      sequence: 1,
      sku: "608333",
      quantity: 120,
      actualQty: null,
      cartonCount: 120,
      expectedPalletQty: 4,
      palletDetails: ""
    });
  });
});

describe("buildInboundReceivingCountSheetDefinition", () => {
  it("renders a dock count template with writable receipt fields", () => {
    const document = buildInboundReceivingCountSheetDocument(createPackingListPreviewFixture());
    const definition = buildInboundReceivingCountSheetDefinition(document);

    expect(definition.pageSize).toBe("LETTER");
    expect(definition.pageOrientation).toBe("portrait");
    const content = definition.content as unknown as Array<Record<string, unknown>>;
    const serializedContent = JSON.stringify(content);

    expect(serializedContent).toContain("RECEIVING TALLY SHEET");
    expect(serializedContent).not.toContain("Customer");
    expect(serializedContent).not.toContain("Inbound Date");
    expect(serializedContent).not.toContain("Imperial Bag & Paper");
    expect(serializedContent).toContain("CHEN208-3220");
    expect(serializedContent).toContain("Container Type");
    expect(serializedContent).toContain("Expected\\nQty (CTN)");
    expect(serializedContent).toContain("Actual\\nQty (CTN)");
    expect(serializedContent).toContain("Expected\\nPallet Qty");
    expect(serializedContent).toContain("Actual\\nPallet Qty");
    expect(serializedContent).toContain("Pallet Details");
    expect(serializedContent).toContain("Recived At");
    expect(serializedContent).not.toContain("Exception Log");
    expect(serializedContent).not.toContain("Counted Qty");

    const countTable = content.find((block) => {
      const body = (block?.table as { body?: Array<Array<{ text?: string }>> } | undefined)?.body;
      return body?.[0]?.[0]?.text === "SKU" && body?.[0]?.[1]?.text === "Expected\nQty (CTN)";
    });
    expect(countTable).toBeDefined();
    const countBody = (countTable!.table as { body: Array<Array<{ text?: string; stack?: Array<{ text: string }> }>> }).body;
    expect(countBody[0][1].text).toBe("Expected\nQty (CTN)");
    expect(countBody[0][2].text).toBe("Actual\nQty (CTN)");
    expect(countBody[0][3].text).toBe("Expected\nPallet Qty");
    expect(countBody[0][4].text).toBe("Actual\nPallet Qty");
    expect(countBody[0][5].text).toBe("Pallet Details");
    expect(countBody[1][0].stack?.[0].text).toBe("608333");
    expect(countBody[1][0].stack?.[1].text).toBe("Black nitrile gloves");
    expect(countBody[1][1].text).toBe("100");
    expect(countBody[1][2].text).toBe("");
    expect(countBody[1][3].text).toBe("");
    expect(countBody[1][4].text).toBe("");
    expect(countBody[1][5].text).toBe("");
    expect(countBody).toHaveLength(8);
  });

  it("keeps a 36-line count sheet plus five blank rows on one page", () => {
    const input = createPackingListPreviewFixture();
    const document = buildInboundReceivingCountSheetDocument({
      ...input,
      lines: Array.from({ length: 36 }, (_, index) => ({
        ...input.lines[index % input.lines.length],
        sequence: index + 1,
        sku: `SKU-${String(index + 1).padStart(2, "0")}`,
        description: `Line ${index + 1}`
      }))
    });

    const definition = buildInboundReceivingCountSheetDefinition(document);
    const serializedContent = JSON.stringify(definition.content);

    expect(serializedContent).not.toContain("\"pageBreak\":\"after\"");
    const countTable = (definition.content as unknown as Array<Record<string, unknown>>).find((block) => {
      const body = (block?.table as { body?: Array<Array<{ text?: string }>> } | undefined)?.body;
      return body?.[0]?.[0]?.text === "SKU" && body?.[0]?.[1]?.text === "Expected\nQty (CTN)";
    });
    const countBody = (countTable!.table as { body: unknown[] }).body;
    expect(countBody).toHaveLength(42);
  });
});
