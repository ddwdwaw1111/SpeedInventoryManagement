import { expect, test } from "@playwright/test";

import {
  buildCustomer,
  buildInboundDocument,
  buildItem,
  buildLocation,
  buildOutboundDocument,
  buildPalletTrace,
  mockAppApi
} from "./support/mockApi";

test("daily operations advances a scheduled receipt to arrived", async ({ page }) => {
  const customer = buildCustomer({ id: 1, name: "Acme Foods" });
  const location = buildLocation({ id: 1, name: "NJ Warehouse" });
  const inboundDocument = buildInboundDocument({
    customerId: customer.id,
    locationId: location.id,
    expectedArrivalDate: "2026-04-22",
    actualArrivalDate: "",
    containerNo: "CONT-IN-001",
    status: "DRAFT",
    trackingStatus: "SCHEDULED",
    lines: [
      {
        sku: "SKU-PLAY",
        description: "Frozen mango",
        storageSection: "TEMP",
        reorderLevel: 5,
        expectedQty: 25,
        receivedQty: 0,
        pallets: 1,
        unitsPerPallet: 25,
        palletsDetailCtns: "1*25"
      }
    ]
  }, 41, [customer], [location]);

  const apiState = await mockAppApi(page, {
    customers: [customer],
    locations: [location],
    inboundDocuments: [inboundDocument]
  });

  await page.goto("/daily-operations/2026-04-22");

  const receiptCard = page.locator("article").filter({ hasText: "CONT-IN-001" });
  await expect(receiptCard).toHaveCount(1);
  await expect(receiptCard.getByRole("button", { name: "Mark Arrived" })).toBeVisible();

  await receiptCard.getByRole("button", { name: "Mark Arrived" }).click();

  await expect.poll(() => apiState.updatedInboundTrackingStatuses.length).toBe(1);
  expect(apiState.updatedInboundTrackingStatuses[0]).toEqual({
    documentId: inboundDocument.id,
    trackingStatus: "ARRIVED"
  });
  await expect(receiptCard.getByRole("button", { name: "Start Receiving" })).toBeVisible();
  await expect(page.getByText("Receipt status updated successfully.")).toBeVisible();
});

test("daily operations advances a scheduled shipment to picking", async ({ page }) => {
  const customer = buildCustomer({ id: 1, name: "Acme Foods" });
  const location = buildLocation({ id: 1, name: "NJ Warehouse" });
  const outboundDocument = buildOutboundDocument({
    packingListNo: "PL-ADV-001",
    orderRef: "SO-ADV-001",
    expectedShipDate: "2026-04-23",
    shipToName: "Receiver East",
    status: "DRAFT",
    trackingStatus: "SCHEDULED",
    lines: [
      {
        customerId: customer.id,
        locationId: location.id,
        skuMasterId: 101,
        quantity: 10,
        pallets: 1
      }
    ]
  }, 51, [customer], [location]);

  const apiState = await mockAppApi(page, {
    customers: [customer],
    locations: [location],
    outboundDocuments: [outboundDocument]
  });

  await page.goto("/daily-operations/2026-04-23");

  const shipmentCard = page.locator("article").filter({ hasText: "PL-ADV-001" });
  await expect(shipmentCard).toHaveCount(1);
  await expect(shipmentCard.getByRole("button", { name: "Start Picking" })).toBeVisible();

  await shipmentCard.getByRole("button", { name: "Start Picking" }).click();

  await expect.poll(() => apiState.updatedOutboundTrackingStatuses.length).toBe(1);
  expect(apiState.updatedOutboundTrackingStatuses[0]).toEqual({
    documentId: outboundDocument.id,
    trackingStatus: "PICKING"
  });
  await expect(shipmentCard.getByRole("button", { name: "Mark Packed" })).toBeVisible();
  await expect(page.getByText("Shipment status updated successfully.")).toBeVisible();
});

test("daily operations copies a shipment and opens the copied draft editor", async ({ page }) => {
  const customer = buildCustomer({ id: 1, name: "Acme Foods" });
  const location = buildLocation({ id: 1, name: "NJ Warehouse" });
  const item = buildItem({
    id: 1,
    skuMasterId: 101,
    itemNumber: "ITEM-101",
    sku: "SKU-PLAY",
    description: "Frozen mango",
    customerId: customer.id,
    customerName: customer.name,
    locationId: location.id,
    locationName: location.name,
    quantity: 25,
    availableQty: 25,
    containerNo: "CONT-901"
  });
  const pallet = buildPalletTrace({
    id: 9001,
    palletCode: "PLT-9001",
    customerId: customer.id,
    customerName: customer.name,
    skuMasterId: item.skuMasterId,
    sku: item.sku,
    description: item.description,
    currentLocationId: location.id,
    currentLocationName: location.name,
    currentContainerNo: item.containerNo,
    contents: [
      {
        id: 9101,
        palletId: 9001,
        skuMasterId: item.skuMasterId,
        itemNumber: item.itemNumber,
        sku: item.sku,
        description: item.description,
        quantity: 25,
        allocatedQty: 0,
        damagedQty: 0,
        holdQty: 0,
        createdAt: "2026-04-25T09:30:00Z",
        updatedAt: "2026-04-25T09:30:00Z"
      }
    ]
  });
  const outboundDocument = buildOutboundDocument({
    packingListNo: "PL-COPY-001",
    orderRef: "SO-COPY-001",
    expectedShipDate: "2026-04-24",
    shipToName: "Receiver West",
    shipToAddress: "12 Receiver Ave",
    shipToContact: "+1 555 010 0200",
    carrierName: "FedEx",
    status: "DRAFT",
    trackingStatus: "PACKED",
    lines: [
      {
        customerId: customer.id,
        locationId: location.id,
        skuMasterId: item.skuMasterId,
        quantity: 5,
        pallets: 1,
        pickPallets: [
          {
            palletId: pallet.id,
            quantity: 5
          }
        ]
      }
    ]
  }, 52, [customer], [location]);

  const apiState = await mockAppApi(page, {
    customers: [customer],
    locations: [location],
    items: [item],
    pallets: [pallet],
    outboundDocuments: [outboundDocument]
  });

  await page.goto("/daily-operations/2026-04-24");

  const shipmentCard = page.locator("article").filter({ hasText: "PL-COPY-001" });
  await expect(shipmentCard).toHaveCount(1);
  await expect(shipmentCard.getByRole("button", { name: /Re-enter Shipment|reEnterShipment/ })).toBeVisible();

  await shipmentCard.getByRole("button", { name: /Re-enter Shipment|reEnterShipment/ }).click();

  await expect.poll(() => apiState.copiedOutboundDocuments.length).toBe(1);
  const copiedDocumentId = apiState.copiedOutboundDocuments[0]?.copiedDocumentId;
  expect(apiState.copiedOutboundDocuments[0]).toEqual({
    sourceDocumentId: outboundDocument.id,
    copiedDocumentId
  });

  await expect(page).toHaveURL(new RegExp(`/outbound-management/${copiedDocumentId}/edit$`));
  await expect(page.getByRole("heading", { name: "Edit Shipment Draft" })).toBeVisible();
  await expect(page.getByLabel("Packing List No.")).toHaveValue(outboundDocument.packingListNo);
  await expect(page.getByLabel("Order Ref.")).toHaveValue(outboundDocument.orderRef);
  await expect(page.getByLabel("Expected Ship Date")).toHaveValue("2026-04-24");
  await expect(page.getByLabel("Ship-to Name")).toHaveValue(outboundDocument.shipToName);
});
