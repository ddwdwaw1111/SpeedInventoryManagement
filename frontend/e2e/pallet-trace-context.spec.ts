import { expect, test } from "@playwright/test";

import {
  buildCustomer,
  buildInboundDocument,
  buildItem,
  buildLocation,
  buildPalletTrace,
  mockAppApi
} from "./support/mockApi";

test("inbound detail opens pallet trace with receipt scope and carries pallet context into adjustments", async ({ page }) => {
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
    containerNo: "MSCU1234567"
  });
  const inboundDocument = buildInboundDocument({
    customerId: customer.id,
    locationId: location.id,
    expectedArrivalDate: "2026-04-22",
    actualArrivalDate: "2026-04-22",
    containerNo: item.containerNo,
    status: "CONFIRMED",
    trackingStatus: "RECEIVED",
    lines: [
      {
        sku: item.sku,
        description: item.description,
        storageSection: "TEMP",
        reorderLevel: 5,
        expectedQty: 25,
        receivedQty: 25,
        pallets: 1,
        unitsPerPallet: 25,
        palletsDetailCtns: "1*25"
      }
    ]
  }, 91, [customer], [location]);
  const scopedPallet = buildPalletTrace({
    id: 9001,
    palletCode: "PLT-9001",
    sourceInboundDocumentId: inboundDocument.id,
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
  const otherPallet = buildPalletTrace({
    id: 9002,
    palletCode: "PLT-OTHER",
    sourceInboundDocumentId: 92,
    customerId: customer.id,
    customerName: customer.name,
    skuMasterId: item.skuMasterId,
    sku: item.sku,
    description: item.description,
    currentLocationId: location.id,
    currentLocationName: location.name,
    currentContainerNo: "CONT-OTHER"
  });

  await mockAppApi(page, {
    customers: [customer],
    locations: [location],
    items: [item],
    inboundDocuments: [inboundDocument],
    pallets: [scopedPallet, otherPallet]
  });

  await page.goto(`/inbound-management/${inboundDocument.id}`);

  await expect(page.getByRole("heading", { name: item.containerNo ?? "" })).toBeVisible();
  await page.getByRole("button", { name: "Open Pallet Workspace" }).click();

  await expect(page).toHaveURL(/\/pallets$/);
  await expect(page.getByRole("heading", { name: "Pallet Trace" })).toBeVisible();
  await expect(page.getByText(`Showing pallets created from receipt ${inboundDocument.id}.`)).toBeVisible();
  await expect(page.getByText(scopedPallet.palletCode, { exact: true })).toBeVisible();
  await expect(page.getByText(otherPallet.palletCode, { exact: true })).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.sessionStorage.getItem("sim-pallet-trace-launch")))
    .toBeNull();

  await page.locator(".MuiDataGrid-virtualScroller").evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  await page.getByRole("button", { name: "View Trace" }).click();

  const traceDialog = page.getByRole("dialog");
  await expect(traceDialog).toBeVisible();
  await traceDialog.getByRole("button", { name: "Adjust Pallet" }).click();

  await expect(page).toHaveURL(/\/adjustments$/);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Acme Foods \| Item #:\s*ITEM-101 \| SKU-PLAY \| Frozen mango \| On Hand: 25/)).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Pallet" })).toHaveValue(String(scopedPallet.id));
  await expect
    .poll(() => page.evaluate(() => window.sessionStorage.getItem("sim-adjustments-context")))
    .toBeNull();
});
