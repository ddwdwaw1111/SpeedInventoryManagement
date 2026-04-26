import { expect, test } from "@playwright/test";

import { buildCustomer, buildItem, buildLocation, buildPalletTrace, mockAppApi } from "./support/mockApi";

test("inventory summary launches adjustment workflow and posts selected pallet changes", async ({ page }) => {
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

  await page.goto("/inventory-summary");

  await expect(page.getByRole("heading", { name: "Inventory Summary" })).toBeVisible();
  await page.getByText(item.sku, { exact: true }).click();
  await expect(page.getByRole("button", { name: "Inventory Adjustment" })).toBeVisible();

  await page.getByRole("button", { name: "Inventory Adjustment" }).click();

  await expect(page).toHaveURL(/\/adjustments$/);
  const dialog = page.getByRole("dialog");
  const palletSelect = dialog.getByRole("combobox", { name: "Pallet" });
  const adjustQtyInput = dialog.getByRole("spinbutton", { name: /Adjust Qty/ });
  await expect(dialog.getByText(/Acme Foods \| Item #:\s*ITEM-101 \| SKU-PLAY \| Frozen mango \| On Hand: 25/)).toBeVisible();

  await dialog.getByLabel("Reason Code").fill("DAMAGE");
  await expect(palletSelect).toBeEnabled();
  await palletSelect.selectOption(String(pallet.id));
  await expect(adjustQtyInput).toBeEnabled();
  await adjustQtyInput.fill("-5");
  await dialog.getByLabel("Adjustment No").fill("PW-ADJ-001");
  await dialog.getByRole("button", { name: "Post Adjustment" }).click();

  await expect.poll(() => apiState.postedAdjustments.length).toBe(1);
  expect(apiState.postedAdjustments[0]).toMatchObject({
    adjustmentNo: "PW-ADJ-001",
    reasonCode: "DAMAGE",
    lines: [
      {
        customerId: customer.id,
        locationId: location.id,
        containerNo: item.containerNo,
        palletId: pallet.id,
        skuMasterId: item.skuMasterId,
        adjustQty: -5
      }
    ]
  });

  await expect(page.getByText("PW-ADJ-001")).toBeVisible();
  await expect(page.getByText("DAMAGE")).toBeVisible();
});
