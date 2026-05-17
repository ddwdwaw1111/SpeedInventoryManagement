import assert from "node:assert/strict";
import { createServer } from "vite";

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "error",
  server: { hmr: false, middlewareMode: true }
});

const {
  buildInboundReceivingCountSheetDefinition,
  buildInboundReceivingCountSheetDocument
} = await vite.ssrLoadModule("/src/lib/inboundReceivingCountSheetPdf.ts");
const {
  buildPickSheetDocument,
  buildPickSheetDefinition
} = await vite.ssrLoadModule("/src/lib/outboundPickSheetPdf.ts");
const {
  buildDeliveryNoteDefinition,
  buildDeliveryNoteDocumentFromDocument
} = await vite.ssrLoadModule("/src/lib/outboundPackingListPdf.ts");

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
            pallets: 1,
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
            pallets: 1,
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
            movementId: 1003,
            itemId: 502,
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

let firstFailure = null;

function runTest(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    firstFailure ??= error;
  }
}

function createInboundPackingListPreviewFixture() {
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

runTest("buildPickSheetDocument expands pick allocations into warehouse pick rows", () => {
  const document = buildPickSheetDocument(createOutboundDocumentFixture());

  assert.equal(document.fileName, "warehouse-pick-sheet-pl-1001.pdf");
  assert.equal(document.rows.length, 3);
  assert.deepEqual(
    document.rows.map((row) => row.containerNo).sort(),
    ["CAJU5283887", "SEGU6542651", "SHYA1211-2720"]
  );
  assert.equal(document.totalQty, 35);
});

runTest("buildPickSheetDocument groups rows into sku, warehouse, and container sections", () => {
  const document = buildPickSheetDocument(createOutboundDocumentFixture());

  assert.equal(document.skuGroups.length, 2);
  const sku608333 = document.skuGroups.find((group) => group.sku === "608333");
  const sku603482 = document.skuGroups.find((group) => group.sku === "603482");
  assert.ok(sku608333);
  assert.ok(sku603482);
  assert.equal(sku608333.totalQty, 20);
  assert.equal(sku608333.totalPallets, 2);
  assert.equal(sku608333.warehouseGroups.length, 1);

  const njGroup = sku608333.warehouseGroups.find((group) => group.warehouse === "NJ");
  assert.ok(njGroup);
  assert.equal(njGroup.rows.length, 2);
  assert.equal(njGroup.totalQty, 20);
  assert.equal(njGroup.totalPallets, 2);
  assert.equal(njGroup.containerGroups.length, 2);
  assert.deepEqual(
    njGroup.containerGroups.map((group) => group.containerNo),
    ["SEGU6542651", "SHYA1211-2720"]
  );

  const paGroup = sku603482.warehouseGroups.find((group) => group.warehouse === "PA");
  assert.ok(paGroup);
  assert.equal(paGroup.rows.length, 1);
  assert.equal(paGroup.totalQty, 15);
  assert.equal(paGroup.totalPallets, 1);
  assert.equal(paGroup.containerGroups[0].containerNo, "CAJU5283887");
  assert.equal(document.totalContainers, 3);
  assert.equal(document.totalDemandLines, 2);
});

runTest("buildPickSheetDocument fails when a line has no stored pick allocations", () => {
  const fixture = createOutboundDocumentFixture();
  fixture.lines[0] = {
    ...fixture.lines[0],
    pickAllocations: []
  };

  assert.throws(
    () => buildPickSheetDocument(fixture),
    /stored pick allocations/i
  );
});

runTest("buildPickSheetDefinition renders sku, warehouse, and container grouped sections", () => {
  const document = buildPickSheetDocument(createOutboundDocumentFixture());
  const definition = buildPickSheetDefinition(document);

  assert.equal(definition.pageOrientation, "portrait");
  assert.equal(definition.info?.title, "Warehouse Pick Sheet PL-1001");
  assert.ok(Array.isArray(definition.content));

  const serializedContent = JSON.stringify(definition.content);
  assert.ok(serializedContent.includes("SKU: 608333"));
  assert.ok(serializedContent.includes("Total Qty: 20"));
  assert.ok(serializedContent.includes("Total Pallet: 2"));
  assert.ok(serializedContent.includes("Warehouses: 1"));
  assert.ok(serializedContent.includes("Containers: 2"));
  assert.ok(serializedContent.includes("Pick Date"));
  assert.ok(serializedContent.includes("Remarks"));
  assert.doesNotMatch(serializedContent, /SKU Pick Plan|SKU Total:|Total Item Qty|Total Pallets|Demand Lines|Customer|Expected Ship Date|Actual Ship Date/);
  assert.doesNotMatch(serializedContent, /PLT:|WH:|Cont\.:/);
  assert.doesNotMatch(serializedContent, /Need CTN|Need PLT|Pick CTN|Pick PLT|Picked|Demand|Container No\.:/);
  assert.doesNotMatch(serializedContent, /VB22GC|VBTL|Item \/ SKU|Item Description/);

  const firstRowTable = definition.content.find((block) => {
    const first = block?.table?.body?.[0]?.[0]?.text;
    return typeof first === "string" && first === "Container No.";
  });
  assert.ok(firstRowTable);
  assert.equal(firstRowTable.table.body[0][0].text, "Container No.");
  assert.equal(firstRowTable.table.body[0][1].text, "Section");
  assert.equal(firstRowTable.table.body[0][2].text, "Qty");
  assert.equal(firstRowTable.table.body[0][3].text, "Pallet Qty");
  assert.equal(firstRowTable.table.body[1][0].text, "Warehouse: NJ | Containers: 2");
  assert.equal(firstRowTable.table.body[1][2].text, "20");
  assert.equal(firstRowTable.table.body[1][3].text, "2");
  assert.equal(firstRowTable.table.body[2][0].text, "SEGU6542651");
  assert.equal(firstRowTable.table.body[2][1].text, "A");
  assert.equal(firstRowTable.table.body[2][2].text, "12");
  assert.equal(firstRowTable.table.body[2][3].text, "1");
  assert.equal(firstRowTable.table.body[3][0].text, "SHYA1211-2720");
  assert.equal(firstRowTable.table.body[3][1].text, "A");
  assert.equal(firstRowTable.table.body[3][2].text, "8");
  assert.equal(firstRowTable.table.body[3][3].text, "1");
  assert.doesNotMatch(serializedContent, /Picked By|Checked By|Packed By/);
});

runTest("buildInboundReceivingCountSheetDefinition renders a dock count template", () => {
  const document = buildInboundReceivingCountSheetDocument(createInboundPackingListPreviewFixture());
  const definition = buildInboundReceivingCountSheetDefinition(document);

  assert.equal(document.fileName, "receiving-tally-sheet-chen208-3220.pdf");
  assert.equal(document.containerNo, "CHEN208-3220");
  assert.equal(document.totalPallets, null);
  assert.equal(definition.pageSize, "LETTER");
  assert.equal(definition.pageOrientation, "portrait");

  const serializedContent = JSON.stringify(definition.content);
  assert.match(serializedContent, /RECEIVING TALLY SHEET/);
  assert.doesNotMatch(serializedContent, /Customer|Inbound Date|Imperial Bag & Paper/);
  assert.match(serializedContent, /Container Type/);
  assert.match(serializedContent, /Expected\\nQty \(CTN\)/);
  assert.match(serializedContent, /Actual\\nQty \(CTN\)/);
  assert.match(serializedContent, /Expected\\nPallet Qty/);
  assert.match(serializedContent, /Actual\\nPallet Qty/);
  assert.match(serializedContent, /Pallet Details/);
  assert.match(serializedContent, /Recived At/);
  assert.doesNotMatch(serializedContent, /Exception Log|Counted Qty|Variance/);

  const countTable = definition.content.find((block) => {
    const body = block?.table?.body;
    return body?.[0]?.[0]?.text === "SKU" && body?.[0]?.[1]?.text === "Expected\nQty (CTN)";
  });
  assert.ok(countTable);
  assert.equal(countTable.table.body[1][0].stack[0].text, "608333");
  assert.match(countTable.table.body[1][0].stack[1].text, /Black nitrile gloves/);
  assert.equal(countTable.table.body[1][1].text, "100");
  assert.equal(countTable.table.body[1][2].text, "");
  assert.equal(countTable.table.body[1][3].text, "");
  assert.equal(countTable.table.body[1][4].text, "");
  assert.equal(countTable.table.body[1][5].text, "");
});

runTest("buildDeliveryNoteDocumentFromDocument keeps outward-facing shipment totals and pallet data", () => {
  const document = buildDeliveryNoteDocumentFromDocument(createOutboundDocumentFixture());

  assert.equal(document.fileName, "delivery-note-pl-1001.pdf");
  assert.equal(document.rows.length, 2);
  assert.equal(document.rows[0].itemNumber, "608333");
  assert.equal(document.rows[0].pallets, 2);
  assert.equal(document.rows[1].pallets, 1);
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

await vite.close();

if (firstFailure) {
  throw firstFailure;
}
