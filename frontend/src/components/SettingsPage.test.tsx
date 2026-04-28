import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { SettingsPage } from "./SettingsPage";
import { renderWithProviders } from "../test/renderWithProviders";

const HEADER_STORAGE_KEY = "sim-billing-invoice-header-defaults";

describe("SettingsPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("sim-timezone", "UTC");
  });

  it("saves blank invoice header defaults and common term selections", () => {
    renderWithProviders(<SettingsPage />);

    fireEvent.change(screen.getByLabelText("Seller Name"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Subtitle"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Remit To"), { target: { value: "SIM ACH Lockbox" } });
    fireEvent.change(screen.getByLabelText("Terms"), { target: { value: "Net 15" } });
    expect(screen.getByLabelText("Payment Due Days")).toHaveValue(15);

    fireEvent.change(screen.getByLabelText("Terms"), { target: { value: "" } });
    expect(screen.getByLabelText("Payment Due Days")).toHaveValue(0);
    fireEvent.change(screen.getByLabelText("Payment Instructions"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(JSON.parse(window.localStorage.getItem(HEADER_STORAGE_KEY) || "{}")).toEqual({
      sellerName: "",
      subtitle: "",
      remitTo: "SIM ACH Lockbox",
      terms: "",
      paymentDueDays: 0,
      paymentInstructions: ""
    });
  });
});
