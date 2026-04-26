import { expect, test } from "@playwright/test";

import { buildCustomer, buildLocation, mockAppApi } from "./support/mockApi";

test("receipt editor confirms a new receipt and opens the detail page", async ({ page }) => {
  const customer = buildCustomer({ id: 1, name: "Acme Foods" });
  const location = buildLocation({ id: 1, name: "NJ Warehouse" });
  const apiState = await mockAppApi(page, {
    customers: [customer],
    locations: [location]
  });

  await page.goto("/inbound-management/new");

  await expect(page.getByRole("heading", { name: "Create New Receipt" })).toBeVisible();
  await page.getByLabel("Expected Arrival Date").fill("2026-04-24");
  await page.getByLabel(/Container No/).fill("MSCU1234567");
  await page.getByRole("button", { name: "Next" }).click();

  const inboundLine = page.locator(".batch-line-grid--inbound").first();
  await inboundLine.getByLabel("SKU").fill("ABC123");
  await inboundLine.getByLabel("Description").fill("Frozen mango");
  await inboundLine.getByLabel("Expected Qty").fill("8");
  await inboundLine.getByLabel("Received").fill("8");

  await page.getByRole("button", { name: "3 Review" }).click();
  await expect(page.getByRole("button", { name: "Confirm Receipt" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm Receipt" }).click();

  await expect.poll(() => apiState.postedInboundDocuments.length).toBe(1);
  expect(apiState.postedInboundDocuments[0]).toMatchObject({
    customerId: customer.id,
    locationId: location.id,
    expectedArrivalDate: "2026-04-24",
    containerNo: "MSCU1234567",
    status: "CONFIRMED",
    trackingStatus: "RECEIVED",
    lines: [
      {
        sku: "ABC123",
        description: "Frozen mango",
        expectedQty: 8,
        receivedQty: 8
      }
    ]
  });

  await expect(page).toHaveURL(/\/inbound-management\/1$/);
  await expect(page.getByText("Inbound Receipt")).toBeVisible();
  await expect(page.getByRole("heading", { name: "MSCU1234567" })).toBeVisible();
});
