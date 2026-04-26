import { expect, test } from "@playwright/test";

import { buildCustomer, buildItem, buildLocation, mockAppApi } from "./support/mockApi";

test("transfer management posts the selected stock row to the destination warehouse", async ({ page }) => {
  const customer = buildCustomer({ id: 1, name: "Acme Foods" });
  const sourceLocation = buildLocation({ id: 1, name: "NJ Warehouse", sectionNames: ["TEMP", "A"] });
  const destinationLocation = buildLocation({ id: 2, name: "LA Warehouse", sectionNames: ["TEMP", "BULK"] });
  const sourceItem = buildItem({
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
    availableQty: 25,
    quantity: 25
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
    availableQty: 12,
    quantity: 12
  });

  const apiState = await mockAppApi(page, {
    customers: [customer],
    locations: [sourceLocation, destinationLocation],
    items: [sourceItem, siblingItem]
  });

  await page.goto("/transfers");

  await expect(page.getByRole("button", { name: "Inventory Transfer" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Inventory Transfer" }).first().click();

  const dialog = page.getByRole("dialog");
  await dialog.locator("select").first().selectOption(`${customer.id}:${sourceItem.sku}`);

  const lineCard = dialog.locator(".batch-line-card").first();
  await lineCard.getByLabel("Source Inventory Position").selectOption(
    `${customer.id}:${sourceLocation.id}:${sourceItem.storageSection}:${sourceItem.containerNo}:${sourceItem.skuMasterId}`
  );
  await lineCard.getByLabel("Transfer Qty").fill("5");
  await lineCard.getByLabel("Destination Warehouse").selectOption(String(destinationLocation.id));
  await lineCard.getByLabel("To Section").selectOption("BULK");
  await dialog.locator('button[type="submit"]').click();

  await expect.poll(() => apiState.postedTransfers.length).toBe(1);
  expect(apiState.postedTransfers[0]).toMatchObject({
    lines: [
      {
        customerId: customer.id,
        locationId: sourceLocation.id,
        storageSection: sourceItem.storageSection,
        containerNo: sourceItem.containerNo,
        skuMasterId: sourceItem.skuMasterId,
        quantity: 5,
        toLocationId: destinationLocation.id,
        toStorageSection: "BULK"
      }
    ]
  });

  await expect(page.getByText("TR-PW-001")).toBeVisible();
  await expect(page.getByText("NJ Warehouse -> LA Warehouse")).toBeVisible();
});
