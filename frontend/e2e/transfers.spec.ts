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
    quantity: 25,
    pallets: 2,
    availablePallets: 2
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
    quantity: 12,
    pallets: 1,
    availablePallets: 1
  });

  const apiState = await mockAppApi(page, {
    customers: [customer],
    locations: [sourceLocation, destinationLocation],
    items: [sourceItem, siblingItem]
  });

  await page.goto("/transfers");

  const addTransferButton = page.locator("main").getByRole("button", { name: "Inventory Transfer" });
  await expect(addTransferButton).toBeVisible();
  await addTransferButton.click();

  const dialog = page.getByRole("dialog");
  await dialog.locator("#transfer-container-select").selectOption(`${customer.id}:${sourceLocation.id}:${sourceItem.containerNo}`);
  await dialog.getByRole("button", { name: /Partial Container/ }).click();
  await dialog.locator("#transfer-destination-location").selectOption(String(destinationLocation.id));
  await dialog.locator("#transfer-destination-section").selectOption("BULK");
  await dialog.getByRole("spinbutton", { name: `Transfer Qty - ${sourceItem.sku} - ${sourceItem.storageSection}` }).fill("5");
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
