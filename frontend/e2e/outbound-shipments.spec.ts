import { expect, test } from "@playwright/test";

import { buildCustomer, buildItem, buildLocation, buildPalletTrace, mockAppApi } from "./support/mockApi";

test("shipment editor schedules a draft shipment with auto-picked pallets", async ({ page }) => {
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
    availableQty: 25,
    quantity: 25,
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

  const apiState = await mockAppApi(page, {
    customers: [customer],
    locations: [location],
    items: [item],
    pallets: [pallet]
  });

  await page.goto("/outbound-management/new");

  await expect(page.getByRole("heading", { name: "Create New Shipment" })).toBeVisible();
  const shipmentLine = page.locator(".batch-line-card").first();
  const shipmentSkuInput = shipmentLine.locator('input[id^="shipment-editor-sku-"]');
  const shipmentQtyInput = shipmentLine.locator('input[id^="shipment-editor-quantity-"]');
  await shipmentLine.getByLabel("Warehouse").selectOption(String(location.id));
  await shipmentSkuInput.fill(item.sku);
  await shipmentQtyInput.fill("5");

  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Details" }).click();
  await expect(page.getByText("PLT-9001")).toBeVisible();

  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("checkbox", {
    name: "I confirm the warehouse, SKU, quantities, and pallet picks are correct for this shipment."
  }).check();
  await page.getByRole("button", { name: "Schedule Shipment" }).last().click();

  await expect.poll(() => apiState.postedOutboundDocuments.length).toBe(1);
  expect(apiState.postedOutboundDocuments[0]).toMatchObject({
    status: "DRAFT",
    trackingStatus: "SCHEDULED",
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
  });

  await expect(page).toHaveURL(/\/outbound-management$/);
  await expect(page.getByRole("heading", { name: "Shipments" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New Shipment" })).toBeVisible();
});
