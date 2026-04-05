import assert from "node:assert/strict";

import { buildPickSheetDocument, buildPickSheetDefinition } from "../.test-dist/lib/outboundPickSheetPdf.js";
import { buildDeliveryNoteDefinition, buildDeliveryNoteDocumentFromDocument } from "../.test-dist/lib/outboundPackingListPdf.js";

function createOutboundDocumentFixture() {
  return {
    id: 12,
    packingListNo: "PL-1001",
    orderRef: "PO-2002",
    customerId: 7,
    customerName: "Imperial Bag & Paper",
    expectedShipDate: "2026-03-24",
    actualShipDate: "2026-03-24",
    shipToName: "Jersey City",
    shipToAddress: "255 ROUTE 1 & 9, JERSEY CITY, NJ 07306",
    shipToContact: "201-437-7440",
    carrierName: "Internal Fleet",
    documentNote: "Handle with care",
    status: "CONFIRMED",
    confirmedAt: "2026-03-24T12:00:00Z",
    cancelNote: "",
    cancelledAt: null,
    totalLines: 2,
    totalQty: 35,
    totalNetWeightKgs: 120.5,
    totalGrossWeightKgs: 130.75,
    storages: "NJ / A",
    createdAt: "2026-03-24T10:00:00Z",
    updatedAt: "2026-03-24T12:00:00Z",
    lines: [
      {
        id: 101,
        documentId: 12,
        movementId: 1001,
        itemId: 501,
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
            movementId: 1001,
            itemId: 501,
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
            movementId: 1002,
            itemId: 501,
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
        movementId: 1003,
        itemId: 502,
        itemNumber: "603482",
        locationId: 1,
        locationName: "NJ",
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
            movementId: 1003,
            itemId: 502,
            itemNumber: "603482",
            locationId: 1,
            locationName: "NJ",
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

function runTest(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

runTest("buildPickSheetDocument expands pick allocations into warehouse pick rows", () => {
  const document = buildPickSheetDocument(createOutboundDocumentFixture());

  assert.equal(document.fileName, "warehouse-pick-sheet-pl-1001.pdf");
  assert.equal(document.rows.length, 3);
  assert.deepEqual(
    document.rows.map((row) => row.containerNo),
    ["SEGU6542651", "SHYA1211-2720", "CAJU5283887"]
  );
  assert.deepEqual(
    document.rows.map((row) => row.quantity),
    [12, 8, 15]
  );
  assert.equal(document.rows[0].pallets, 2);
  assert.equal(document.rows[0].palletsDetailCtns, "2*10");
  assert.equal(document.totalQty, 35);
});

runTest("buildPickSheetDefinition keeps internal pick-sheet fields visible", () => {
  const document = buildPickSheetDocument(createOutboundDocumentFixture());
  const definition = buildPickSheetDefinition(document);

  assert.equal(definition.pageOrientation, "landscape");
  assert.equal(definition.info?.title, "Warehouse Pick Sheet PL-1001");
  assert.ok(Array.isArray(definition.content));
  const tableBlock = definition.content[2];
  assert.ok(tableBlock?.table);
  assert.equal(tableBlock.table.body[0][6].text, "Container No.");
  assert.equal(tableBlock.table.body[0][8].text, "Pallets");
});

runTest("buildDeliveryNoteDocumentFromDocument keeps outward-facing shipment totals and pallet data", () => {
  const document = buildDeliveryNoteDocumentFromDocument(createOutboundDocumentFixture());

  assert.equal(document.fileName, "delivery-note-pl-1001.pdf");
  assert.equal(document.rows.length, 2);
  assert.equal(document.rows[0].itemNumber, "608333");
  assert.equal(document.rows[0].pallets, 2);
  assert.equal(document.rows[1].palletsDetailCtns, "1*15");
  assert.equal(document.totalQty, 35);
  assert.equal(document.totalGrossWeightKgs, 130.75);
});

runTest("buildDeliveryNoteDefinition keeps delivery-note metadata in English and generated time in footer", () => {
  const document = buildDeliveryNoteDocumentFromDocument(createOutboundDocumentFixture());
  const definition = buildDeliveryNoteDefinition(document);

  assert.equal(definition.pageOrientation, "landscape");
  assert.equal(definition.info?.title, "Delivery Note PL-1001");
  assert.ok(Array.isArray(definition.content));
  const metadataBlock = definition.content[1];
  assert.ok(metadataBlock?.table);
  assert.equal(metadataBlock.table.body[0][0].stack[0].text, "Packing List No.");
  assert.equal(metadataBlock.table.body[1][2].stack[0].text, "Carrier");

  const footer = definition.footer?.(1, 1);
  assert.ok(footer?.columns);
  assert.match(footer.columns[1].text, /Printed At:/);
});
