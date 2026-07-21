import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import {
  createInboundDocument,
  createInboundDocumentLine,
  createOutboundDocument,
  createOutboundDocumentLine,
  createOutboundPickAllocation
} from "../test/fixtures";
import {
  buildDocumentMigrationPackage,
  buildInboundBulkReimportRows,
  buildOutboundBulkReimportRows
} from "./documentMigrationExport";

describe("document migration export", () => {
  it("builds inbound rows with the exact bulk-import business fields", () => {
    const rows = buildInboundBulkReimportRows(createInboundDocument({
      containerNo: "SEGU6542651",
      locationName: "308",
      actualArrivalDate: null,
      expectedArrivalDate: "2026-04-03",
      containerType: "WEST_COAST_TRANSFER",
      lines: [createInboundDocumentLine({
        sku: "SKU-1",
        itemNumber: "ITEM-1",
        expectedQty: 20,
        receivedQty: 18,
        pallets: 2,
        unitsPerPallet: 9,
        storageSection: "A1"
      })]
    }));

    expect(rows).toEqual([expect.objectContaining({
      containerNo: "SEGU6542651",
      warehouse: "308",
      actualArrivalDate: "2026-04-03",
      containerType: "WEST_COAST_TRANSFER",
      sku: "SKU-1",
      itemNumber: "ITEM-1",
      expectedQty: 20,
      receivedQty: 18,
      pallets: 2,
      unitsPerPallet: 9,
      storageSection: "A1"
    })]);
    expect(rows[0]).not.toHaveProperty("customerId");
    expect(rows[0]).not.toHaveProperty("documentKey");
  });

  it("preserves source effective dates when confirmed documents have no actual date", () => {
    const inboundRows = buildInboundBulkReimportRows(createInboundDocument({
      status: "CONFIRMED",
      actualArrivalDate: null,
      expectedArrivalDate: "2026-04-03",
      confirmedAt: "2026-04-10T15:30:00Z",
      createdAt: "2026-04-01T12:00:00Z"
    }));
    const outboundRows = buildOutboundBulkReimportRows(createOutboundDocument({
      status: "CONFIRMED",
      actualShipDate: null,
      expectedShipDate: "2026-04-05",
      confirmedAt: "2026-04-12T16:45:00Z",
      createdAt: "2026-04-02T12:00:00Z"
    }));

    expect(inboundRows[0].actualArrivalDate).toBe("2026-04-10");
    expect(outboundRows[0].expectedShipDate).toBe("2026-04-05");
    expect(outboundRows[0].actualShipDate).toBe("2026-04-12");
  });

  it("preserves outbound source allocations and keeps inventory and shipping pallets independent", () => {
    const rows = buildOutboundBulkReimportRows(createOutboundDocument({
      packingListNo: "PICK-100",
      lines: [createOutboundDocumentLine({
        quantity: 10,
        actualQuantity: 10,
        plannedQuantity: 12,
        pallets: 5,
        pickAllocations: [
          createOutboundPickAllocation({
            id: 1,
            allocatedQty: 4,
            pallets: 1,
            containerNo: "CONT-A",
            locationName: "308 Herrod Blvd",
            storageSection: "TEMP",
            inventoryPalletsUsed: 1,
            remainingPallets: 0,
            sourceLocationId: 9,
            sourceLocationName: "Overflow",
            sourceStorageSection: "A1",
            sourceStartingPallets: 2,
            sourceRemainingPallets: 1
          }),
          createOutboundPickAllocation({ id: 2, allocatedQty: 6, pallets: 2, containerNo: "CONT-B" })
        ]
      })]
    }));

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.sourceContainer)).toEqual(["CONT-A", "CONT-B"]);
    expect(rows.map((row) => row.quantity)).toEqual([4, 6]);
    expect(rows.map((row) => row.plannedQuantity)).toEqual([5, 7]);
    expect(rows.map((row) => row.inventoryPallets)).toEqual([1, 2]);
    expect(rows.map((row) => row.warehouse)).toEqual(["Overflow", "NJ"]);
    expect(rows.map((row) => row.storageSection)).toEqual(["A1", "TEMP"]);
    expect(rows.map((row) => row.outboundPallets)).toEqual([2, 3]);
  });

  it("packages each customer separately and prevents duplicate document keys from merging", () => {
    const duplicateReceiptA = createInboundDocument({
      id: 1,
      customerId: 1,
      customerName: "Able Pack",
      status: "CONFIRMED",
      containerNo: "SAME-CONT",
      actualArrivalDate: "2026-04-01"
    });
    const duplicateReceiptB = createInboundDocument({
      id: 2,
      customerId: 1,
      customerName: "Able Pack",
      status: "CONFIRMED",
      containerNo: "SAME-CONT",
      actualArrivalDate: "2026-04-01"
    });
    const otherCustomerShipment = createOutboundDocument({
      id: 3,
      customerId: 2,
      customerName: "SpeedWin",
      status: "DRAFT",
      packingListNo: "PICK-3"
    });
    const deletedShipment = createOutboundDocument({
      id: 4,
      customerId: 2,
      customerName: "SpeedWin",
      status: "DELETED",
      deletedAt: "2026-04-05T00:00:00Z",
      packingListNo: "PICK-DELETED"
    });

    const result = buildDocumentMigrationPackage(
      [duplicateReceiptA, duplicateReceiptB],
      [otherCustomerShipment, deletedShipment],
      new Date(2026, 3, 30, 12, 0)
    );
    const files = unzipSync(result.bytes);
    const fileNames = Object.keys(files).sort();

    expect(result.fileName).toBe("document-bulk-reimport-20260430-1200.zip");
    expect(result.summary).toEqual({
      inboundDocuments: 2,
      outboundDocuments: 1,
      workbookCount: 3,
      skippedDocuments: 0
    });
    expect(fileNames.filter((name) => name.startsWith("inbound/able-pack/"))).toHaveLength(2);
    expect(fileNames).toContain("outbound/speedwin/001-draft.xlsx");
    expect(fileNames).toContain("manifest.csv");
    expect(files["manifest.csv"].length).toBeGreaterThan(10);
    expect(strFromU8(files["manifest.csv"])).toContain("Able Pack");
    expect(strFromU8(files["manifest.csv"])).not.toContain("Source Archived");
    expect(strFromU8(files["README.txt"])).toContain("Import order");
    expect(fileNames.some((name) => name.includes("PICK-DELETED"))).toBe(false);
  });

  it("skips confirmed legacy outbound documents without a stored allocation snapshot", () => {
    const legacyDocument = createOutboundDocument({
      id: 10,
      status: "CONFIRMED",
      packingListNo: "LEGACY-10",
      lines: [createOutboundDocumentLine({
        id: 20,
        documentId: 10,
        hasStoredPickAllocations: false,
        pickAllocations: [createOutboundPickAllocation({ allocatedQty: 5, pallets: 1 })]
      })]
    });

    const result = buildDocumentMigrationPackage([], [legacyDocument], new Date(2026, 3, 30, 12, 0));
    const files = unzipSync(result.bytes);

    expect(result.summary).toEqual({
      inboundDocuments: 0,
      outboundDocuments: 0,
      workbookCount: 0,
      skippedDocuments: 1
    });
    expect(Object.keys(files).some((name) => name.endsWith(".xlsx"))).toBe(false);
    expect(strFromU8(files["skipped-documents.csv"])).toContain("legacy record without a current source-allocation snapshot");
  });

  it("writes the exact current Bulk Import headers into re-import workbooks", () => {
    const inbound = createInboundDocument({
      id: 11,
      customerName: "Able Pack",
      containerNo: "CONT-11",
      actualArrivalDate: "2026-04-01"
    });
    const outbound = createOutboundDocument({
      id: 12,
      customerName: "Able Pack",
      packingListNo: "PICK-12"
    });

    const result = buildDocumentMigrationPackage([inbound], [outbound], new Date(2026, 3, 30, 12, 0));
    const files = unzipSync(result.bytes);
    const inboundWorkbookName = Object.keys(files).find((name) => name.startsWith("inbound/") && name.endsWith(".xlsx"));
    const outboundWorkbookName = Object.keys(files).find((name) => name.startsWith("outbound/") && name.endsWith(".xlsx"));
    expect(inboundWorkbookName).toBeTruthy();
    expect(outboundWorkbookName).toBeTruthy();

    const inboundWorkbook = unzipSync(files[inboundWorkbookName!]);
    const outboundWorkbook = unzipSync(files[outboundWorkbookName!]);
    const inboundSheet = strFromU8(inboundWorkbook["xl/worksheets/sheet1.xml"]);
    const outboundSheet = strFromU8(outboundWorkbook["xl/worksheets/sheet1.xml"]);
    for (const header of ["Container No", "Warehouse", "Actual Arrival Date", "SKU", "Received Qty", "Pallets", "CTN per Pallet"]) {
      expect(inboundSheet).toContain(`<t>${header}</t>`);
    }
    for (const header of ["Picking Order No", "Source Container", "Actual Qty", "Inventory Pallets Used", "Outbound Pallets"]) {
      expect(outboundSheet).toContain(`<t>${header}</t>`);
    }
    expect(outboundSheet).not.toContain("Remaining Inventory Pallets");
  });
});
