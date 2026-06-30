import { expect, test } from "@playwright/test";

import { buildCustomer, buildItem, buildLocation, mockAppApi } from "./support/mockApi";

test("shipment editor schedules a draft shipment with item bucket allocations", async ({ page }) => {
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
    pallets: 1,
    containerNo: "CONT-901"
  });

  const apiState = await mockAppApi(page, {
    customers: [customer],
    locations: [location],
    items: [item]
  });

  await page.goto("/outbound-management/new");

  await expect(page.getByText("Outbound Lines")).toBeVisible();
  const shipmentLine = page.locator(".batch-line-card").first();
  const shipmentSkuInput = shipmentLine.locator('input[id^="shipment-editor-sku-"]');
  const shipmentWarehouseSelect = shipmentLine.locator('select[id^="shipment-editor-warehouse-"]');
  const shipmentQtyInput = shipmentLine.locator('input[id^="shipment-editor-quantity-"]');
  const shipmentPalletInput = shipmentLine.locator('input[id^="shipment-editor-pallets-"]');
  await shipmentSkuInput.fill(item.sku);
  await shipmentWarehouseSelect.selectOption(String(location.id));
  await shipmentQtyInput.fill("5");
  await shipmentPalletInput.fill("1");

  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Details" }).click();
  await expect(page.getByText("CONT-901")).toBeVisible();

  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("checkbox", {
    name: "I confirm the warehouse, SKU, allocated quantities, and pallet count are correct for this shipment."
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
        pickAllocations: [
          {
            itemNumber: item.itemNumber,
            locationId: location.id,
            locationName: location.name,
            storageSection: "TEMP",
            containerNo: "CONT-901",
            allocatedQty: 5,
            pallets: 1
          }
        ]
      }
    ]
  });

  await expect(page).toHaveURL(/\/outbound-management$/);
  await expect(page.getByRole("heading", { name: "Shipments" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New Shipment" })).toBeVisible();
});
