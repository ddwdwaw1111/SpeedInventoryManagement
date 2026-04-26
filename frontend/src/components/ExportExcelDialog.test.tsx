import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "../test/renderWithProviders";
import { ExportExcelDialog } from "./ExportExcelDialog";

describe("ExportExcelDialog", () => {
  it("locks the download action while an export is running", async () => {
    const onExport = vi.fn(() => new Promise<void>(() => {}));

    renderWithProviders(
      <ExportExcelDialog
        open
        defaultTitle="Billing Preview"
        defaultColumns={[{ key: "sku", label: "SKU" }]}
        onClose={vi.fn()}
        onExport={onExport}
      />
    );

    const downloadButton = screen.getByRole("button", { name: "Download Excel" });

    fireEvent.click(downloadButton);

    await waitFor(() => {
      expect(onExport).toHaveBeenCalledWith({
        title: "Billing Preview",
        columns: [{ key: "sku", label: "SKU" }]
      });
    });

    expect(downloadButton).toBeDisabled();
    expect(downloadButton).toHaveAttribute("aria-busy", "true");
    expect(screen.getByLabelText(/export title/i)).toBeDisabled();
  });
});
