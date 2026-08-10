import { expect, test } from "@playwright/test";

import { buildCustomer, buildLocation, buildSKUMaster, mockAppApi } from "./support/mockApi";

test("receipt editor confirms a new receipt and opens the detail page", async ({ page }) => {
  const customer = buildCustomer({ id: 1, name: "Acme Foods" });
  const location = buildLocation({ id: 1, name: "NJ Warehouse" });
  const skuMaster = buildSKUMaster({
    id: 101,
    itemNumber: "ITEM-101",
    sku: "ABC123",
    description: "Frozen mango",
    defaultUnitsPerPallet: 8
  });
  const apiState = await mockAppApi(page, {
    customers: [customer],
    locations: [location],
    skuMasters: [skuMaster]
  });

  await page.goto("/inbound-management/new");

  await page.getByLabel("Warehouse").selectOption(String(location.id));
  await page.getByLabel("Customer").selectOption(String(customer.id));
  await page.getByLabel("Actual Arrival Date").fill("2026-04-24");
  await page.getByLabel("Container No").fill("MSCU1234567");
  await page.getByLabel("UPC #1").fill(skuMaster.sku);
  await page.getByLabel("Expected QTY #1").fill("8");
  await page.getByLabel("Received #1").fill("8");
  await page.getByLabel("PALLETS #1").fill("1");
  await page.getByLabel("CTN / Pallet #1").fill("8");

  await page.getByRole("button", { name: "Confirm Receipt" }).click();

  await expect.poll(() => apiState.postedInboundDocuments.length).toBe(1);
  expect(apiState.postedInboundDocuments[0]).toMatchObject({
    customerId: customer.id,
    locationId: location.id,
    actualArrivalDate: "2026-04-24",
    containerNo: "MSCU1234567",
    status: "CONFIRMED",
    trackingStatus: "RECEIVED",
    lines: [
      {
        itemNumber: "ITEM-101",
        sku: "ABC123",
        description: "Frozen mango",
        expectedQty: 8,
        receivedQty: 8,
        pallets: 1,
        unitsPerPallet: 8
      }
    ]
  });

  await expect(page).toHaveURL(/\/inbound-management\/1$/);
  await expect(page.getByText("Inbound Receipt")).toBeVisible();
  await expect(page.getByRole("heading", { name: "MSCU1234567" })).toBeVisible();
});
