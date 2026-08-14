import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsPage } from "./SettingsPage";
import { renderWithProviders } from "../test/renderWithProviders";

const { clearOperationalData, getBillingInvoiceSettings, updateBillingInvoiceSettings } = vi.hoisted(() => ({
  clearOperationalData: vi.fn(),
  getBillingInvoiceSettings: vi.fn(),
  updateBillingInvoiceSettings: vi.fn()
}));

vi.mock("../lib/api", () => ({
  api: {
    clearOperationalData,
    getBillingInvoiceSettings,
    updateBillingInvoiceSettings
  }
}));

describe("SettingsPage", () => {
  beforeEach(() => {
    getBillingInvoiceSettings.mockReset();
    updateBillingInvoiceSettings.mockReset();
    clearOperationalData.mockReset();
    window.localStorage.clear();
    window.localStorage.setItem("sim-timezone", "UTC");
    getBillingInvoiceSettings.mockResolvedValue({
      header: {
        sellerName: "Speed Inventory Management",
        subtitle: "Business services invoice",
        remitTo: "Speed Inventory Management",
        terms: "Net 30",
        paymentDueDays: 30,
        paymentInstructions: "Payment due within 30 days of invoice date. Please reference the invoice number with payment. Amounts are in USD."
      }
    });
    updateBillingInvoiceSettings.mockImplementation(async (payload) => ({ header: payload.header }));
    clearOperationalData.mockResolvedValue({
      inboundDocuments: 7,
      outboundDocuments: 5,
      transfers: 2,
      inventoryItems: 8,
      containers: 4,
      ledgerEntries: 20,
      adjustments: 0,
      cycleCounts: 0,
      billingInvoices: 1,
      bulkImportBatches: 2,
      documentAttachments: 0,
      clearedAt: "2026-08-13T12:00:00Z"
    });
  });

  it("saves blank invoice header defaults and common term selections", async () => {
    renderWithProviders(<SettingsPage currentUserRole="admin" />);

    await waitFor(() => {
      expect(screen.getByLabelText("Seller Name")).not.toBeDisabled();
    });

    fireEvent.change(screen.getByLabelText("Seller Name"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Subtitle"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Remit To"), { target: { value: "SIM ACH Lockbox" } });
    fireEvent.change(screen.getByLabelText("Terms"), { target: { value: "Net 15" } });
    expect(screen.getByLabelText("Payment Due Days")).toHaveValue(15);

    fireEvent.change(screen.getByLabelText("Terms"), { target: { value: "" } });
    expect(screen.getByLabelText("Payment Due Days")).toHaveValue(0);
    fireEvent.change(screen.getByLabelText("Payment Instructions"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(updateBillingInvoiceSettings).toHaveBeenCalledWith({
        header: {
          sellerName: "",
          subtitle: "",
          remitTo: "SIM ACH Lockbox",
          terms: "",
          paymentDueDays: 0,
          paymentInstructions: ""
        }
      });
    });
    expect(await screen.findByText("Settings saved successfully.")).toBeInTheDocument();
  });

  it("requires exact confirm text before clearing operational data", async () => {
    const onOperationalDataCleared = vi.fn();
    renderWithProviders(<SettingsPage currentUserRole="admin" onOperationalDataCleared={onOperationalDataCleared} />);

    fireEvent.click(screen.getByRole("button", { name: "Clear all operational data" }));
    const dialog = await screen.findByRole("dialog", { name: "Permanently clear operational data?" });
    const confirmationInput = screen.getByLabelText("Confirmation phrase");
    const clearButton = screen.getByRole("button", { name: "Clear operational data" });
    expect(clearButton).toBeDisabled();

    fireEvent.change(confirmationInput, { target: { value: "CONFIRM" } });
    expect(clearButton).toBeDisabled();
    fireEvent.change(confirmationInput, { target: { value: "confirm" } });
    expect(clearButton).toBeEnabled();
    fireEvent.click(clearButton);

    await waitFor(() => expect(clearOperationalData).toHaveBeenCalledWith("confirm"));
    await waitFor(() => expect(onOperationalDataCleared).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Cleared 7 inbound receipts, 5 outbound shipments, and 2 transfers.")).toBeInTheDocument();
    expect(dialog).not.toBeInTheDocument();
  });

  it("does not expose operational reset controls to non-admin users", () => {
    renderWithProviders(<SettingsPage currentUserRole="operator" />);
    expect(screen.queryByRole("button", { name: "Clear all operational data" })).not.toBeInTheDocument();
  });
});
