import { expect, test } from "@playwright/test";

import { buildCustomer, buildItem, buildLocation, mockAppApi } from "./support/mockApi";

test("inventory summary launches transfer workflow with the selected sku context", async ({ page }) => {
  const customer = buildCustomer({ id: 1, name: "Acme Foods" });
  const sourceLocation = buildLocation({ id: 1, name: "NJ Warehouse", sectionNames: ["TEMP", "A"] });
  const destinationLocation = buildLocation({ id: 2, name: "LA Warehouse", sectionNames: ["TEMP", "BULK"] });
  const selectedItem = buildItem({
    id: 1,
    skuMasterId: 101,
    itemNumber: "ITEM-101",
    sku: "SKU-PLAY",
    description: "Frozen mango",
    customerId: customer.id,
    customerName: customer.name,
    locationId: sourceLocation.id,
    locationName: sourceLocation.name,
    storageSection: "TEMP",
    containerNo: "CONT-901",
    quantity: 25,
    availableQty: 25
  });
  const siblingItem = buildItem({
    id: 2,
    skuMasterId: 101,
    itemNumber: "ITEM-101",
    sku: "SKU-PLAY",
    description: "Frozen mango",
    customerId: customer.id,
    customerName: customer.name,
    locationId: sourceLocation.id,
    locationName: sourceLocation.name,
    storageSection: "A",
    containerNo: "CONT-902",
    quantity: 12,
    availableQty: 12
  });

  const apiState = await mockAppApi(page, {
    customers: [customer],
    locations: [sourceLocation, destinationLocation],
    items: [selectedItem, siblingItem]
  });

  await page.goto("/inventory-summary");

  await expect(page.getByRole("heading", { name: "Inventory Summary" })).toBeVisible();
  await page.getByText(selectedItem.sku, { exact: true }).click();
  await page.getByRole("button", { name: "Inventory Transfer" }).click();

  await expect(page).toHaveURL(/\/transfers$/);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/Acme Foods \| Item #:\s*ITEM-101 \| SKU-PLAY \| Frozen mango \| On Hand: 37 \| Available Qty: 37 \| Warehouses: 1 \| Containers: 2/)).toBeVisible();

  const lineCard = dialog.locator(".batch-line-card").first();
  await lineCard.getByLabel("Source Inventory Position").selectOption(
    `${customer.id}:${sourceLocation.id}:${selectedItem.storageSection}:${selectedItem.containerNo}:${selectedItem.skuMasterId}`
  );
  await lineCard.getByLabel("Transfer Qty").fill("5");
  await lineCard.getByLabel("Pallet Qty").fill("1");
  await lineCard.getByLabel("Destination Warehouse").selectOption(String(destinationLocation.id));
  await lineCard.getByLabel("To Section").selectOption("BULK");
  await dialog.locator('button[type="submit"]').click();

  await expect.poll(() => apiState.postedTransfers.length).toBe(1);
  expect(apiState.postedTransfers[0]).toMatchObject({
    lines: [
      {
        customerId: customer.id,
        locationId: sourceLocation.id,
        storageSection: selectedItem.storageSection,
        containerNo: selectedItem.containerNo,
        skuMasterId: selectedItem.skuMasterId,
        quantity: 5,
        pallets: 1,
        toLocationId: destinationLocation.id,
        toStorageSection: "BULK"
      }
    ]
  });
});
