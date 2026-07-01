import { expect, test } from "@playwright/test";

import {
  buildCustomer,
  buildInboundDocument,
  buildItem,
  buildLocation,
  buildOutboundDocument,
  mockAppApi
} from "./support/mockApi";

test("receipt editor opens the inbound detail page for the current document", async ({ page }) => {
  const customer = buildCustomer({ id: 1, name: "Acme Foods" });
  const location = buildLocation({ id: 1, name: "NJ Warehouse" });
  const inboundDocument = buildInboundDocument({
    customerId: customer.id,
    locationId: location.id,
    expectedArrivalDate: "2026-04-22",
    actualArrivalDate: "2026-04-22",
    containerNo: "MSCU1234567",
    status: "CONFIRMED",
    trackingStatus: "RECEIVED",
    lines: [
      {
        sku: "SKU-PLAY",
        description: "Frozen mango",
        storageSection: "TEMP",
        reorderLevel: 5,
        expectedQty: 25,
        receivedQty: 25,
        pallets: 1,
        unitsPerPallet: 25,
        palletsDetailCtns: "1*25"
      }
    ]
  }, 91, [customer], [location]);

  await mockAppApi(page, {
    customers: [customer],
    locations: [location],
    inboundDocuments: [inboundDocument]
  });

  await page.goto(`/inbound-management/${inboundDocument.id}/edit`);

  await expect(page.getByText("Confirmed receipt details are locked.")).toBeVisible();
  await page.getByRole("button", { name: "Details" }).first().click();

  await expect(page).toHaveURL(new RegExp(`/inbound-management/${inboundDocument.id}$`));
  await expect(page.getByText("Inbound Receipt")).toBeVisible();
  await expect(page.getByRole("heading", { name: inboundDocument.containerNo })).toBeVisible();
});

test("receipt editor re-enters a confirmed receipt into a copied draft editor", async ({ page }) => {
  const customer = buildCustomer({ id: 1, name: "Acme Foods" });
  const location = buildLocation({ id: 1, name: "NJ Warehouse" });
  const inboundDocument = buildInboundDocument({
    customerId: customer.id,
    locationId: location.id,
    expectedArrivalDate: "2026-04-22",
    actualArrivalDate: "2026-04-22",
    containerNo: "MSCU7654321",
    status: "CONFIRMED",
    trackingStatus: "RECEIVED",
    lines: [
      {
        sku: "SKU-PLAY",
        description: "Frozen mango",
        storageSection: "TEMP",
        reorderLevel: 5,
        expectedQty: 12,
        receivedQty: 12,
        pallets: 1,
        unitsPerPallet: 12,
        palletsDetailCtns: "1*12"
      }
    ]
  }, 92, [customer], [location]);

  const apiState = await mockAppApi(page, {
    customers: [customer],
    locations: [location],
    inboundDocuments: [inboundDocument]
  });

  await page.goto(`/inbound-management/${inboundDocument.id}/edit`);

  await expect(page.getByText("Confirmed receipt details are locked.")).toBeVisible();
  await page.getByRole("button", { name: /Re-enter Receipt|reEnterReceipt/ }).click();

  await expect.poll(() => apiState.copiedInboundDocuments.length).toBe(1);
  const copiedDocumentId = apiState.copiedInboundDocuments[0]?.copiedDocumentId;
  expect(apiState.copiedInboundDocuments[0]).toEqual({
    sourceDocumentId: inboundDocument.id,
    copiedDocumentId
  });

  await expect(page).toHaveURL(new RegExp(`/inbound-management/${copiedDocumentId}/edit$`));
  await expect(page.getByLabel("Actual Arrival Date")).toHaveValue("2026-04-22");
  await expect(page.getByLabel("Container No.")).toHaveValue(inboundDocument.containerNo);
});

test("shipment editor loads the current confirmed shipment", async ({ page }) => {
  const customer = buildCustomer({ id: 1, name: "Acme Foods" });
  const location = buildLocation({ id: 1, name: "NJ Warehouse" });
  const outboundDocument = buildOutboundDocument({
    packingListNo: "PL-DETAIL-001",
    orderRef: "SO-DETAIL-001",
    expectedShipDate: "2026-04-24",
    shipToName: "Receiver East",
    status: "CONFIRMED",
    trackingStatus: "SHIPPED",
    lines: [
      {
        customerId: customer.id,
        locationId: location.id,
        skuMasterId: 101,
        quantity: 10,
        pallets: 1
      }
    ]
  }, 101, [customer], [location]);

  await mockAppApi(page, {
    customers: [customer],
    locations: [location],
    outboundDocuments: [outboundDocument]
  });

  await page.goto(`/outbound-management/${outboundDocument.id}/edit`);

  await expect(page.getByText("Confirmed shipment details are locked.")).toBeVisible();
  await expect(page.getByLabel("Picking Order #")).toHaveValue(outboundDocument.packingListNo);
  await expect(page.getByLabel("Order Ref.")).toHaveValue(outboundDocument.orderRef);
  await expect(page.getByLabel("Ship-to Name")).toHaveValue(outboundDocument.shipToName);
});

test("shipment editor re-enters a confirmed shipment into a copied draft editor", async ({ page }) => {
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
    containerId: 901,
    quantity: 25,
    availableQty: 25,
    containerNo: "CONT-901"
  });
  const outboundDocument = buildOutboundDocument({
    packingListNo: "PL-REENTER-001",
    orderRef: "SO-REENTER-001",
    expectedShipDate: "2026-04-24",
    shipToName: "Receiver West",
    shipToAddress: "12 Receiver Ave",
    shipToContact: "+1 555 010 0200",
    carrierName: "FedEx",
    status: "CONFIRMED",
    trackingStatus: "SHIPPED",
    lines: [
      {
        customerId: customer.id,
        locationId: location.id,
        skuMasterId: item.skuMasterId,
        quantity: 5,
        pallets: 1,
        pickAllocations: [
          {
            itemNumber: item.itemNumber,
            locationId: location.id,
            locationName: location.name,
            storageSection: item.storageSection,
            containerId: item.containerId,
            containerNo: item.containerNo,
            allocatedQty: 5,
            pallets: 1
          }
        ]
      }
    ]
  }, 102, [customer], [location]);

  const apiState = await mockAppApi(page, {
    customers: [customer],
    locations: [location],
    items: [item],
    outboundDocuments: [outboundDocument]
  });

  await page.goto(`/outbound-management/${outboundDocument.id}/edit`);

  await expect(page.getByText("Confirmed shipment details are locked.")).toBeVisible();
  await page.getByRole("button", { name: /Re-enter Shipment|reEnterShipment/ }).first().click();

  await expect.poll(() => apiState.copiedOutboundDocuments.length).toBe(1);
  const copiedDocumentId = apiState.copiedOutboundDocuments[0]?.copiedDocumentId;
  expect(apiState.copiedOutboundDocuments[0]).toEqual({
    sourceDocumentId: outboundDocument.id,
    copiedDocumentId
  });

  await expect(page).toHaveURL(new RegExp(`/outbound-management/${copiedDocumentId}/edit$`));
  await expect(page.getByLabel("Picking Order #")).toHaveValue(outboundDocument.packingListNo);
  await expect(page.getByLabel("Order Ref.")).toHaveValue(outboundDocument.orderRef);
  await expect(page.getByLabel("Expected Ship Date")).toHaveValue("2026-04-24");
  await expect(page.getByLabel("Ship-to Name")).toHaveValue(outboundDocument.shipToName);
});
