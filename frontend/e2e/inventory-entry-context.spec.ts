import { expect, test } from "@playwright/test";

import { buildCustomer, buildItem, buildLocation, buildPalletTrace, mockAppApi } from "./support/mockApi";

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
        toLocationId: destinationLocation.id,
        toStorageSection: "BULK"
      }
    ]
  });
});

test("inventory summary launches cycle count workflow with the selected sku context", async ({ page }) => {
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
    storageSection: "TEMP",
    containerNo: "CONT-901",
    quantity: 25,
    availableQty: 25
  });
  const firstPallet = buildPalletTrace({
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
        quantity: 21,
        allocatedQty: 0,
        damagedQty: 0,
        holdQty: 0,
        createdAt: "2026-04-25T09:30:00Z",
        updatedAt: "2026-04-25T09:30:00Z"
      }
    ]
  });
  const secondPallet = buildPalletTrace({
    id: 9002,
    palletCode: "PLT-9002",
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
        id: 9102,
        palletId: 9002,
        skuMasterId: item.skuMasterId,
        itemNumber: item.itemNumber,
        sku: item.sku,
        description: item.description,
        quantity: 4,
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
    pallets: [firstPallet, secondPallet]
  });

  await page.goto("/inventory-summary");

  await expect(page.getByText(item.sku, { exact: true })).toBeVisible();
  await page.getByText(item.sku, { exact: true }).click();
  await page.getByRole("button", { name: "New Count Sheet" }).click();

  await expect(page).toHaveURL(/\/cycle-counts$/);
  await expect(page.getByText("Loaded 1 inventory position(s) into this count sheet from your launch context.")).toBeVisible();
  await expect(page.getByText("PLT-9001")).toBeVisible();
  await page.getByLabel("Counted Qty: PLT-9001").fill("18");
  await page.getByRole("button", { name: "Review & Post" }).last().click();
  await page.getByRole("button", { name: "Post Count Sheet" }).click();

  await expect.poll(() => apiState.postedCycleCounts.length).toBe(1);
  expect(apiState.postedCycleCounts[0]).toMatchObject({
    lines: [
      {
        customerId: customer.id,
        locationId: location.id,
        storageSection: item.storageSection,
        containerNo: item.containerNo,
        palletId: firstPallet.id,
        skuMasterId: item.skuMasterId,
        countedQty: 18
      },
      {
        customerId: customer.id,
        locationId: location.id,
        storageSection: item.storageSection,
        containerNo: item.containerNo,
        palletId: secondPallet.id,
        skuMasterId: item.skuMasterId,
        countedQty: 4
      }
    ]
  });
});
