import { expect, test } from "@playwright/test";

import { buildCustomer, buildItem, buildLocation, buildPalletTrace, mockAppApi } from "./support/mockApi";

test("container detail posts an inventory adjustment for all selected pallets", async ({ page }) => {
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
    currentStorageSection: "TEMP",
    currentContainerNo: item.containerNo,
    contents: [
      {
        id: 9101,
        palletId: 9001,
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
    currentStorageSection: "TEMP",
    currentContainerNo: item.containerNo,
    contents: [
      {
        id: 9102,
        palletId: 9002,
        skuMasterId: item.skuMasterId,
        itemNumber: item.itemNumber,
        sku: item.sku,
        description: item.description,
        quantity: 3,
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

  await page.goto(`/container-contents/${item.containerNo}`);

  await expect(page.getByRole("button", { name: "Inventory Adjustment" })).toBeVisible();
  await page.getByRole("button", { name: "Inventory Adjustment" }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Select All" }).click();
  await expect(dialog.getByRole("button", { name: "Clear" })).toBeVisible();
  await dialog.getByLabel("Reason Code").fill("COUNT_LOSS");
  await dialog.locator('button[type="submit"]').click();

  await expect.poll(() => apiState.postedAdjustments.length).toBe(1);
  expect(apiState.postedAdjustments[0]).toMatchObject({
    reasonCode: "COUNT_LOSS",
    lines: [
      {
        customerId: customer.id,
        locationId: location.id,
        storageSection: "TEMP",
        containerNo: item.containerNo,
        palletId: firstPallet.id,
        skuMasterId: item.skuMasterId,
        adjustQty: -4
      },
      {
        customerId: customer.id,
        locationId: location.id,
        storageSection: "TEMP",
        containerNo: item.containerNo,
        palletId: secondPallet.id,
        skuMasterId: item.skuMasterId,
        adjustQty: -3
      }
    ]
  });

  await expect(page.getByText("Adjustment saved successfully.")).toBeVisible();
});

test("container detail posts an inventory transfer for all selected pallets", async ({ page }) => {
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
    availableQty: 7
  });
  const firstPallet = buildPalletTrace({
    id: 9001,
    palletCode: "PLT-9001",
    customerId: customer.id,
    customerName: customer.name,
    skuMasterId: item.skuMasterId,
    sku: item.sku,
    description: item.description,
    currentLocationId: sourceLocation.id,
    currentLocationName: sourceLocation.name,
    currentStorageSection: "TEMP",
    currentContainerNo: item.containerNo,
    contents: [
      {
        id: 9101,
        palletId: 9001,
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
  const secondPallet = buildPalletTrace({
    id: 9002,
    palletCode: "PLT-9002",
    customerId: customer.id,
    customerName: customer.name,
    skuMasterId: item.skuMasterId,
    sku: item.sku,
    description: item.description,
    currentLocationId: sourceLocation.id,
    currentLocationName: sourceLocation.name,
    currentStorageSection: "TEMP",
    currentContainerNo: item.containerNo,
    contents: [
      {
        id: 9102,
        palletId: 9002,
        skuMasterId: item.skuMasterId,
        itemNumber: item.itemNumber,
        sku: item.sku,
        description: item.description,
        quantity: 3,
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
    locations: [sourceLocation, destinationLocation],
    items: [item],
    pallets: [firstPallet, secondPallet]
  });

  await page.goto(`/container-contents/${item.containerNo}`);

  await expect(page.getByRole("button", { name: "Inventory Transfer" })).toBeVisible();
  await page.getByRole("button", { name: "Inventory Transfer" }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Select All" }).click();
  await expect(dialog.getByRole("button", { name: "Clear" })).toBeVisible();
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
        palletId: firstPallet.id,
        skuMasterId: item.skuMasterId,
        quantity: 4,
        toLocationId: destinationLocation.id,
        toStorageSection: "BULK"
      },
      {
        customerId: customer.id,
        locationId: sourceLocation.id,
        storageSection: "TEMP",
        containerNo: item.containerNo,
        palletId: secondPallet.id,
        skuMasterId: item.skuMasterId,
        quantity: 3,
        toLocationId: destinationLocation.id,
        toStorageSection: "BULK"
      }
    ]
  });

  await expect(page.getByText("Transfer saved successfully.")).toBeVisible();
});

test("container detail launches cycle count with container scope and posts all scoped pallet counts", async ({ page }) => {
  const customer = buildCustomer({ id: 1, name: "Acme Foods" });
  const location = buildLocation({ id: 1, name: "NJ Warehouse" });
  const firstItem = buildItem({
    id: 1,
    skuMasterId: 101,
    itemNumber: "ITEM-101",
    sku: "SKU-PLAY-A",
    description: "Frozen mango",
    customerId: customer.id,
    customerName: customer.name,
    locationId: location.id,
    locationName: location.name,
    storageSection: "TEMP",
    containerNo: "CONT-901",
    quantity: 21,
    availableQty: 21
  });
  const secondItem = buildItem({
    id: 2,
    skuMasterId: 102,
    itemNumber: "ITEM-102",
    sku: "SKU-PLAY-B",
    description: "Frozen peach",
    customerId: customer.id,
    customerName: customer.name,
    locationId: location.id,
    locationName: location.name,
    storageSection: "TEMP",
    containerNo: "CONT-901",
    quantity: 9,
    availableQty: 9
  });
  const firstPallet = buildPalletTrace({
    id: 9001,
    palletCode: "PLT-9001",
    customerId: customer.id,
    customerName: customer.name,
    skuMasterId: firstItem.skuMasterId,
    sku: firstItem.sku,
    description: firstItem.description,
    currentLocationId: location.id,
    currentLocationName: location.name,
    currentStorageSection: "TEMP",
    currentContainerNo: firstItem.containerNo,
    contents: [
      {
        id: 9101,
        palletId: 9001,
        skuMasterId: firstItem.skuMasterId,
        itemNumber: firstItem.itemNumber,
        sku: firstItem.sku,
        description: firstItem.description,
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
    skuMasterId: secondItem.skuMasterId,
    sku: secondItem.sku,
    description: secondItem.description,
    currentLocationId: location.id,
    currentLocationName: location.name,
    currentStorageSection: "TEMP",
    currentContainerNo: secondItem.containerNo,
    contents: [
      {
        id: 9102,
        palletId: 9002,
        skuMasterId: secondItem.skuMasterId,
        itemNumber: secondItem.itemNumber,
        sku: secondItem.sku,
        description: secondItem.description,
        quantity: 9,
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
    items: [firstItem, secondItem],
    pallets: [firstPallet, secondPallet]
  });

  await page.goto(`/container-contents/${firstItem.containerNo}`);

  await expect(page.getByRole("button", { name: "New Count Sheet" })).toBeVisible();
  await page.getByRole("button", { name: "New Count Sheet" }).click();

  await expect(page).toHaveURL(/\/cycle-counts$/);
  await expect(page.getByText("Loaded 2 inventory position(s) into this count sheet from your launch context.")).toBeVisible();
  await expect(page.getByText("PLT-9001")).toBeVisible();
  await expect(page.getByText("PLT-9002")).toBeVisible();
  await page.getByLabel("Counted Qty: PLT-9001").fill("18");
  await page.getByRole("button", { name: "Review & Post" }).last().click();
  await page.getByRole("button", { name: "Post Count Sheet" }).click();

  await expect.poll(() => apiState.postedCycleCounts.length).toBe(1);
  expect(apiState.postedCycleCounts[0]).toMatchObject({
    lines: [
      {
        customerId: customer.id,
        locationId: location.id,
        storageSection: "TEMP",
        containerNo: firstItem.containerNo,
        palletId: firstPallet.id,
        skuMasterId: firstItem.skuMasterId,
        countedQty: 18
      },
      {
        customerId: customer.id,
        locationId: location.id,
        storageSection: "TEMP",
        containerNo: secondItem.containerNo,
        palletId: secondPallet.id,
        skuMasterId: secondItem.skuMasterId,
        countedQty: 9
      }
    ]
  });
});
