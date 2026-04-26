import { expect, test } from "@playwright/test";

import { mockAppApi } from "./support/mockApi";

test("daily operations launches receipt editor with the selected day prefilled", async ({ page }) => {
  await mockAppApi(page);

  await page.goto("/daily-operations/2026-04-22");

  await expect(page.getByRole("heading", { name: "Daily Operations" })).toBeVisible();
  await page.getByRole("button", { name: "New Receipt for This Day" }).click();

  await expect(page).toHaveURL(/\/inbound-management\/new$/);
  await expect(page.getByRole("heading", { name: "Create New Receipt" })).toBeVisible();
  await expect(page.getByLabel("Expected Arrival Date")).toHaveValue("2026-04-22");
  await expect
    .poll(() => page.evaluate(() => window.sessionStorage.getItem("sim-inbound-receipt-editor-launch")))
    .toBeNull();
});

test("daily operations launches shipment editor with the selected day prefilled", async ({ page }) => {
  await mockAppApi(page);

  await page.goto("/daily-operations/2026-04-23");

  await expect(page.getByRole("heading", { name: "Daily Operations" })).toBeVisible();
  await page.getByRole("button", { name: "New Shipment for This Day" }).click();

  await expect(page).toHaveURL(/\/outbound-management\/new$/);
  await expect(page.getByRole("heading", { name: "Create New Shipment" })).toBeVisible();
  await expect(page.getByLabel("Expected Ship Date")).toHaveValue("2026-04-23");
  await expect
    .poll(() => page.evaluate(() => window.sessionStorage.getItem("sim-outbound-shipment-editor-launch")))
    .toBeNull();
});
