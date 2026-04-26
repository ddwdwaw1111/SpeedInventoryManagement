import { expect, test } from "@playwright/test";

import { buildCustomer, buildItem, buildLocation, buildPalletTrace, mockAppApi } from "./support/mockApi";

test("cycle count posts pallet-level counted quantities and refreshes the history grid", async ({ page }) => {
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

  await page.goto("/cycle-counts");

  await expect(page.getByRole("button", { name: "New Count Sheet" }).first()).toBeVisible();
  await page.getByRole("button", { name: "New Count Sheet" }).first().click();
  await page.getByRole("button", { name: "Count Lines" }).last().click();

  const firstLine = page.locator(".batch-line-card").first();
  await firstLine.getByLabel("Inventory Position").selectOption(
    `${customer.id}:${location.id}:${item.storageSection}:${item.containerNo}:${item.skuMasterId}`
  );
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

  await expect(page.getByText("COUNT-PW-001")).toBeVisible();
  await expect(page.locator('[role="row"]').filter({ hasText: "COUNT-PW-001" }).first()).toContainText("-3");
});
