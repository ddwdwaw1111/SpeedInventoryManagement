import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsPage } from "./SettingsPage";
import { renderWithProviders } from "../test/renderWithProviders";

const { getBillingInvoiceSettings, updateBillingInvoiceSettings } = vi.hoisted(() => ({
  getBillingInvoiceSettings: vi.fn(),
  updateBillingInvoiceSettings: vi.fn()
}));

vi.mock("../lib/api", () => ({
  api: {
    getBillingInvoiceSettings,
    updateBillingInvoiceSettings
  }
}));

describe("SettingsPage", () => {
  beforeEach(() => {
    getBillingInvoiceSettings.mockReset();
    updateBillingInvoiceSettings.mockReset();
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
});
