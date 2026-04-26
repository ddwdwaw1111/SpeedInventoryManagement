import { expect, test } from "@playwright/test";

import { buildCustomer, buildLocation, buildOperationsReport, mockAppApi } from "./support/mockApi";

test("reports page sends backend filters and renders the returned operations summary", async ({ page }) => {
  const customer = buildCustomer({ id: 7, name: "Acme Foods" });
  const location = buildLocation({ id: 3, name: "NJ Cold Storage" });

  const defaultReport = buildOperationsReport();
  const filteredReport = buildOperationsReport({
    summary: {
      onHandUnits: 88,
      activeContainers: 2,
      palletsIn: 11,
      palletsOut: 9,
      netPalletFlow: 2,
      activeSkuCount: 1,
      activeWarehouseCount: 1,
      lowStockCount: 0,
      endingBalance: 14,
      peakBalance: 18,
      averageBalance: 12.5
    },
    locationInventoryRows: [
      { label: location.name, value: 88, skuCount: 1 }
    ],
    topSkuRows: [
      { label: "SKU-PLAY", value: 88, description: "Frozen mango" }
    ],
    lowStockRows: [],
    palletFlowRows: [
      { dateKey: "2026-04-03", inbound: 11, outbound: 9, adjustmentDelta: 0, endOfDay: 14 }
    ],
    movementTrendRows: [
      { key: "2026-04-03", inbound: 140, outbound: 52 }
    ]
  });

  const apiState = await mockAppApi(page, {
    customers: [customer],
    locations: [location],
    operationsReport: (url) => url.searchParams.get("search") === "SKU-PLAY" ? filteredReport : defaultReport
  });
  const onHandCard = page.locator("article").filter({ hasText: "On-Hand Units" }).first();
  const advancedFilters = page.locator(".reports-exec__filters-advanced");
  const endOfDayPalletCard = page.locator("section").filter({ hasText: "End-of-Day Pallets" }).first();

  await page.goto("/reports");

  await expect(page.getByRole("heading", { name: "Operations Dashboard" })).toBeVisible();
  await expect(onHandCard.getByText("125 units")).toBeVisible();

  await page.getByRole("button", { name: "Show Advanced Filters" }).click();
  await expect(advancedFilters).toBeVisible();
  await page.getByLabel("Customer").selectOption(String(customer.id));
  await page.getByLabel("Warehouse").selectOption(String(location.id));
  const searchInput = advancedFilters.getByPlaceholder("SKU, description, container");
  await searchInput.fill("SKU-PLAY");

  await expect.poll(() => {
    const lastRequest = apiState.operationsRequests.at(-1);
    if (!lastRequest) {
      return "";
    }

    return JSON.stringify({
      customerId: lastRequest.searchParams.get("customerId"),
      locationId: lastRequest.searchParams.get("locationId"),
      search: lastRequest.searchParams.get("search")
    });
  }).toBe(JSON.stringify({
    customerId: String(customer.id),
    locationId: String(location.id),
    search: "SKU-PLAY"
  }));

  await expect(onHandCard.getByText("88 units")).toBeVisible();
  await expect(page.getByText("SKU-PLAY")).toBeVisible();
  await expect(endOfDayPalletCard.getByText("14 PALLETS").first()).toBeVisible();
});
