import { expect, test } from "@playwright/test";

import { buildCustomer, buildItem, buildLocation, buildMovement, mockAppApi } from "./support/mockApi";

test("container detail paginates history and filters ledger events by type", async ({ page }) => {
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
    containerId: 901,
    containerNo: "CONT-901",
    quantity: 25,
    availableQty: 25
  });
  const movements = Array.from({ length: 16 }, (_, index) => {
    const entryNo = index + 1;
    const isOutbound = entryNo === 5 || entryNo === 12;
    return buildMovement({
      id: 7000 + entryNo,
      itemId: item.id,
      itemNumber: item.itemNumber,
      sku: item.sku,
      description: item.description,
      customerId: customer.id,
      customerName: customer.name,
      locationName: location.name,
      storageSection: "TEMP",
      containerId: item.containerId,
      containerNo: item.containerNo,
      movementType: isOutbound ? "OUT" : "IN",
      quantityChange: isOutbound ? -1 : 1,
      pallets: 1,
      referenceCode: `HIST-${String(entryNo).padStart(2, "0")}`,
      createdAt: `2026-04-25T${String(Math.floor(entryNo / 60)).padStart(2, "0")}:${String(entryNo % 60).padStart(2, "0")}:00Z`
    });
  });

  await mockAppApi(page, {
    customers: [customer],
    locations: [location],
    items: [item],
    movements
  });

  await page.goto(`/container-contents/${item.containerNo}`);

  const historySection = page.locator("#section-history");
  await expect(historySection.getByText("Container Activity History")).toBeVisible();
  await expect(historySection.getByText("Page 1 / 2")).toBeVisible();
  await expect(historySection.getByText("HIST-16")).toBeVisible();
  await expect(historySection.getByText("HIST-01")).toHaveCount(0);

  await historySection.getByRole("button", { name: "Next Page" }).click();
  await expect(historySection.getByText("Page 2 / 2")).toBeVisible();
  await expect(historySection.getByText("HIST-01")).toBeVisible();
  await expect(historySection.getByText("HIST-16")).toHaveCount(0);

  await historySection.getByRole("button", { name: /Shipments/ }).click();
  await expect(historySection.getByText("Page 2 / 2")).toHaveCount(0);
  await expect(historySection.getByText("HIST-05")).toBeVisible();
  await expect(historySection.getByText("HIST-12")).toBeVisible();
  await expect(historySection.getByText("HIST-16")).toHaveCount(0);
});
