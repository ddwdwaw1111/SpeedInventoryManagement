import { expect, test } from "@playwright/test";

import { buildCustomer, buildItem, buildLocation, buildPalletLocationEvent, mockAppApi } from "./support/mockApi";

test("container detail paginates history and filters pallet events by type", async ({ page }) => {
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
  const palletLocationEvents = Array.from({ length: 16 }, (_, index) => {
    const entryNo = index + 1;
    return buildPalletLocationEvent({
      id: 7000 + entryNo,
      palletId: 8000 + entryNo,
      palletCode: `PLT-HIST-${String(entryNo).padStart(2, "0")}`,
      customerId: customer.id,
      customerName: customer.name,
      locationId: location.id,
      locationName: location.name,
      storageSection: "TEMP",
      containerNo: item.containerNo,
      eventType: entryNo === 5 || entryNo === 12 ? "CANCELLED" : "RECEIVED",
      quantityDelta: entryNo === 5 || entryNo === 12 ? -1 : 1,
      palletDelta: entryNo === 5 || entryNo === 12 ? -1 : 1,
      eventTime: `2026-04-25T${String(Math.floor(entryNo / 60)).padStart(2, "0")}:${String(entryNo % 60).padStart(2, "0")}:00Z`,
      createdAt: `2026-04-25T${String(Math.floor(entryNo / 60)).padStart(2, "0")}:${String(entryNo % 60).padStart(2, "0")}:00Z`
    });
  });

  await mockAppApi(page, {
    customers: [customer],
    locations: [location],
    items: [item],
    palletLocationEvents
  });

  await page.goto(`/container-contents/${item.containerNo}`);

  const historySection = page.locator("#section-history");
  await expect(historySection.getByText("Container Activity History")).toBeVisible();
  await expect(historySection.getByText("Page 1 of 2")).toBeVisible();
  await expect(historySection.getByText("PLT-HIST-16")).toBeVisible();
  await expect(historySection.getByText("PLT-HIST-01")).toHaveCount(0);

  await historySection.getByRole("button", { name: "Next Page" }).click();
  await expect(historySection.getByText("Page 2 of 2")).toBeVisible();
  await expect(historySection.getByText("PLT-HIST-01")).toBeVisible();
  await expect(historySection.getByText("PLT-HIST-16")).toHaveCount(0);

  await historySection.getByRole("button", { name: /Pallet Cancelled/ }).click();
  await expect(historySection.getByText("Page 2 of 2")).toHaveCount(0);
  await expect(historySection.getByText("PLT-HIST-05")).toBeVisible();
  await expect(historySection.getByText("PLT-HIST-12")).toBeVisible();
  await expect(historySection.getByText("PLT-HIST-16")).toHaveCount(0);
});
