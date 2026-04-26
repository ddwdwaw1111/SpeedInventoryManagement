import { expect, test } from "@playwright/test";

import { buildCustomer, buildItem, buildLocation, buildMovement, mockAppApi } from "./support/mockApi";

test("inventory summary opens all activity with sku and customer filters applied", async ({ page }) => {
  const customer = buildCustomer({ id: 1, name: "Acme Foods" });
  const otherCustomer = buildCustomer({ id: 2, name: "Beta Foods" });
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
    locationName: location.name
  });
  const targetMovement = buildMovement({
    id: 1001,
    sku: item.sku,
    description: item.description,
    customerId: customer.id,
    customerName: customer.name,
    locationName: location.name,
    itemNumber: item.itemNumber,
    orderRef: "SO-TARGET-SKU",
    movementType: "OUT"
  });
  const wrongCustomerMovement = buildMovement({
    id: 1002,
    sku: item.sku,
    description: item.description,
    customerId: otherCustomer.id,
    customerName: otherCustomer.name,
    locationName: location.name,
    itemNumber: item.itemNumber,
    orderRef: "SO-OTHER-CUSTOMER",
    movementType: "OUT"
  });
  const wrongSkuMovement = buildMovement({
    id: 1003,
    sku: "SKU-OTHER",
    description: "Other stock",
    customerId: customer.id,
    customerName: customer.name,
    locationName: location.name,
    itemNumber: "ITEM-999",
    orderRef: "SO-OTHER-SKU",
    movementType: "OUT"
  });

  await mockAppApi(page, {
    customers: [customer, otherCustomer],
    locations: [location],
    items: [item],
    movements: [targetMovement, wrongCustomerMovement, wrongSkuMovement]
  });

  await page.goto("/inventory-summary");

  await expect(page.getByText(item.sku, { exact: true })).toBeVisible();
  await page.getByText(item.sku, { exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Inventory Ledger" }).click();

  await expect(page).toHaveURL(/\/all-activity$/);
  await expect(page.getByRole("heading", { name: "Inventory Ledger" })).toBeVisible();
  const filterBar = page.locator(".filter-bar");
  await expect(filterBar.getByLabel("Search")).toHaveValue(item.sku);
  await expect(filterBar.getByLabel("Customer")).toHaveValue(String(customer.id));
  await expect(filterBar.getByLabel("Warehouse")).toHaveValue("all");
  await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem("sim-all-activity-context"))).toBeNull();

  const rowGroup = page.locator('[role="rowgroup"]');
  const dataRows = rowGroup.locator('[role="row"]');
  await expect(dataRows).toHaveCount(1);
  await expect(dataRows.first()).toContainText(item.sku);
  await expect(dataRows.first()).toContainText(customer.name);
  await expect(rowGroup.getByText(otherCustomer.name)).toHaveCount(0);
  await expect(rowGroup.getByText("SKU-OTHER")).toHaveCount(0);
});

test("container detail opens all activity with container, customer, and location filters applied", async ({ page }) => {
  const customer = buildCustomer({ id: 1, name: "Acme Foods" });
  const location = buildLocation({ id: 1, name: "NJ Warehouse" });
  const otherLocation = buildLocation({ id: 2, name: "LA Warehouse" });
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
  const targetMovement = buildMovement({
    id: 2001,
    sku: item.sku,
    description: item.description,
    customerId: customer.id,
    customerName: customer.name,
    locationName: location.name,
    containerNo: item.containerNo,
    itemNumber: item.itemNumber,
    orderRef: "SO-CONT-TARGET",
    movementType: "OUT"
  });
  const wrongLocationMovement = buildMovement({
    id: 2002,
    sku: item.sku,
    description: item.description,
    customerId: customer.id,
    customerName: customer.name,
    locationName: otherLocation.name,
    containerNo: item.containerNo,
    itemNumber: item.itemNumber,
    orderRef: "SO-CONT-LA",
    movementType: "TRANSFER_OUT"
  });
  const wrongContainerMovement = buildMovement({
    id: 2003,
    sku: item.sku,
    description: item.description,
    customerId: customer.id,
    customerName: customer.name,
    locationName: location.name,
    containerNo: "CONT-OTHER",
    itemNumber: item.itemNumber,
    orderRef: "SO-OTHER-CONTAINER",
    movementType: "OUT"
  });

  await mockAppApi(page, {
    customers: [customer],
    locations: [location, otherLocation],
    items: [item],
    movements: [targetMovement, wrongLocationMovement, wrongContainerMovement]
  });

  await page.goto(`/container-contents/${item.containerNo}`);

  const historySection = page.locator("#section-history");
  await expect(historySection.getByText("Container Activity History")).toBeVisible();
  await historySection.getByRole("button", { name: "Inventory Ledger" }).click();

  await expect(page).toHaveURL(/\/all-activity$/);
  await expect(page.getByRole("heading", { name: "Inventory Ledger" })).toBeVisible();
  const filterBar = page.locator(".filter-bar");
  await expect(filterBar.getByLabel("Search")).toHaveValue(item.containerNo);
  await expect(filterBar.getByLabel("Customer")).toHaveValue(String(customer.id));
  await expect(filterBar.getByLabel("Warehouse")).toHaveValue(String(location.id));
  await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem("sim-all-activity-context"))).toBeNull();

  const rowGroup = page.locator('[role="rowgroup"]');
  const dataRows = rowGroup.locator('[role="row"]');
  await expect(dataRows).toHaveCount(1);
  await expect(dataRows.first()).toContainText(item.sku);
  await expect(dataRows.first()).toContainText(customer.name);
  await expect(dataRows.first()).toContainText(location.name);
  await expect(rowGroup.getByText(otherLocation.name)).toHaveCount(0);
  await expect(rowGroup.getByText("CONT-OTHER")).toHaveCount(0);
});
