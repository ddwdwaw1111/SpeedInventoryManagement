import { expect, test } from "@playwright/test";

import { buildCustomer, buildItem, buildLocation, mockAppApi } from "./support/mockApi";

test("container detail hides pallet adjustment while aggregate transfer stays available", async ({ page }) => {
  const customer = buildCustomer({ id: 1, name: "Acme Foods" });
  const location = buildLocation({ id: 1, name: "NJ Warehouse", sectionNames: ["TEMP", "A"] });
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
    storageSection: "TEMP",
    containerNo: "CONT-901",
    quantity: 7,
    availableQty: 7
  });

  await mockAppApi(page, {
    customers: [customer],
    locations: [location],
    items: [item]
  });

  await page.goto(`/container-contents/${item.containerNo}`);

  await expect(page.getByRole("button", { name: "Inventory Transfer" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Inventory Adjustment" })).toHaveCount(0);
});

test("container detail posts an aggregate inventory transfer for the container SKU", async ({ page }) => {
  const customer = buildCustomer({ id: 1, name: "Acme Foods" });
  const sourceLocation = buildLocation({ id: 1, name: "NJ Warehouse", sectionNames: ["TEMP", "A"] });
  const destinationLocation = buildLocation({ id: 2, name: "LA Warehouse", sectionNames: ["TEMP", "BULK"] });
  const item = buildItem({
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
    quantity: 7,
    availableQty: 7,
    pallets: 2
  });

  const apiState = await mockAppApi(page, {
    customers: [customer],
    locations: [sourceLocation, destinationLocation],
    items: [item]
  });

  await page.goto(`/container-contents/${item.containerNo}`);

  await expect(page.getByRole("button", { name: "Inventory Transfer" })).toBeVisible();
  await page.getByRole("button", { name: "Inventory Transfer" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(item.sku, { exact: true })).toBeVisible();
  await dialog.getByLabel("Destination Warehouse").selectOption(String(destinationLocation.id));
  await dialog.getByLabel("To Section").selectOption("BULK");
  await dialog.locator('button[type="submit"]').click();

  await expect.poll(() => apiState.postedTransfers.length).toBe(1);
  expect(apiState.postedTransfers[0]).toMatchObject({
    lines: [
      {
        customerId: customer.id,
        locationId: sourceLocation.id,
        storageSection: "TEMP",
        containerNo: item.containerNo,
        skuMasterId: item.skuMasterId,
        quantity: 7,
        pallets: 2,
        toLocationId: destinationLocation.id,
        toStorageSection: "BULK"
      }
    ]
  });

  await expect(page.getByText("Transfer saved successfully.")).toBeVisible();
});
