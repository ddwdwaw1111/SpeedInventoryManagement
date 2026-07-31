import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BillingInvoiceEditorPage } from "./BillingInvoiceEditorPage";
import { renderWithProviders } from "../test/renderWithProviders";

const {
  getBillingInvoice,
  updateBillingInvoice,
  finalizeBillingInvoice,
  downloadExcelWorkbook,
  downloadBillingInvoicePdf,
  downloadBillingContainerZip
} = vi.hoisted(() => ({
  getBillingInvoice: vi.fn(),
  updateBillingInvoice: vi.fn(),
  finalizeBillingInvoice: vi.fn(),
  downloadExcelWorkbook: vi.fn(),
  downloadBillingInvoicePdf: vi.fn(),
  downloadBillingContainerZip: vi.fn()
}));

vi.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    getBillingInvoice,
    updateBillingInvoice,
    addBillingInvoiceLine: vi.fn(),
    updateBillingInvoiceLine: vi.fn(),
    deleteBillingInvoiceLine: vi.fn(),
    finalizeBillingInvoice,
    markBillingInvoicePaid: vi.fn(),
    voidBillingInvoice: vi.fn(),
    deleteBillingInvoice: vi.fn()
  }
}));

vi.mock("../lib/excelExport", () => ({
  downloadExcelWorkbook
}));

vi.mock("../lib/billingInvoicePdf", () => ({
  downloadBillingInvoicePdf
}));

vi.mock("../lib/billingContainerZip", () => ({
  downloadBillingContainerZip
}));

const invoiceFixture = {
  id: 42,
  invoiceNo: "INV-2026-0001",
  invoiceType: "STORAGE_SETTLEMENT" as const,
  customerId: 1,
  customerNameSnapshot: "Imperial Bag & Paper",
  warehouseLocationId: 1,
  warehouseNameSnapshot: "NJ",
  containerType: "NORMAL",
  periodStart: "2026-03-01",
  periodEnd: "2026-03-31",
  currencyCode: "USD",
  rates: {
    inboundContainerFee: 450,
    transferInboundFeePerPallet: 10,
    wrappingFeePerPallet: 15,
    storageFeePerPalletPerWeek: 7,
    storageFeePerPalletPerWeekNormal: 7,
    storageFeePerPalletPerWeekWestCoastTransfer: 7,
    outboundFeePerPallet: 0
  },
  header: {
    sellerName: "Speed Inventory Management",
    subtitle: "Business services invoice",
    remitTo: "Speed Inventory Management",
    terms: "Net 30",
    paymentDueDays: 30,
    paymentInstructions: "Payment due within 30 days of invoice date. Please reference the invoice number with payment. Amounts are in USD."
  },
  subtotal: 620,
  discountTotal: 0,
  grandTotal: 620,
  status: "DRAFT" as const,
  notes: "March billing",
  finalizedAt: null,
  finalizedByUserId: null,
  paidAt: null,
  voidedAt: null,
  createdByUserId: 1,
  createdAt: "2026-04-01T12:00:00Z",
  updatedAt: "2026-04-01T12:00:00Z",
  lineCount: 2,
  lines: [
    {
      id: 1001,
      invoiceId: 42,
      chargeType: "STORAGE",
      description: "Storage settlement for GCXU5817233",
      reference: "Storage | GCXU5817233",
      containerNo: "GCXU5817233",
      warehouse: "NJ",
      occurredOn: "2026-03-31",
      quantity: 140,
      unitRate: 1,
      amount: 140,
      notes: "Storage settlement",
      sourceType: "AUTO" as const,
      sortOrder: 1,
      createdAt: "2026-04-01T12:00:00Z",
      details: {
        kind: "STORAGE_CONTAINER_SUMMARY" as const,
        warehousesTouched: ["NJ"],
        palletsTracked: 10,
        palletDays: 140,
        segments: [
          {
            startDate: "2026-03-01",
            endDate: "2026-03-14",
            dayEndPallets: 10,
            billedDays: 14,
            palletDays: 140,
            amount: 140
          }
        ]
      }
    },
    {
      id: 1002,
      invoiceId: 42,
      chargeType: "DISCOUNT",
      description: "Courtesy discount",
      reference: "",
      containerNo: "",
      warehouse: "",
      occurredOn: "",
      quantity: 1,
      unitRate: -20,
      amount: -20,
      notes: "",
      sourceType: "MANUAL" as const,
      sortOrder: 2,
      createdAt: "2026-04-01T12:00:00Z",
      details: null
    }
  ]
};

describe("BillingInvoiceEditorPage", () => {
  beforeEach(() => {
    getBillingInvoice.mockReset();
    updateBillingInvoice.mockReset();
    finalizeBillingInvoice.mockReset();
    downloadExcelWorkbook.mockReset();
    downloadBillingInvoicePdf.mockReset();
    downloadBillingContainerZip.mockReset();
    getBillingInvoice.mockResolvedValue(invoiceFixture);
    updateBillingInvoice.mockResolvedValue(invoiceFixture);
    finalizeBillingInvoice.mockResolvedValue({
      ...invoiceFixture,
      status: "FINALIZED"
    });
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem("sim-timezone", "UTC");
  });

  it("shows invoice type metadata", async () => {
    renderWithProviders(
      <BillingInvoiceEditorPage
        invoiceId={42}
        currentUserRole="admin"
        onBackToBilling={vi.fn()}
      />
    );

    expect(await screen.findByText("Storage Settlement")).toBeInTheDocument();
    const ledger = screen.getByRole("table", { name: "Container Billing Ledger" });
    expect(ledger).toHaveClass("billing-container-ledger-table");
    expect(within(ledger).getByText("GCXU5817233")).toBeInTheDocument();
    expect(within(ledger).getByText("Invoice-level")).toBeInTheDocument();
    expect(within(ledger).getByText("Inbound Charges")).toBeInTheDocument();
    expect(within(ledger).getByText("Wrapping Charges")).toBeInTheDocument();
    expect(within(ledger).getByText("Outbound Charges")).toBeInTheDocument();
    expect(within(ledger).getByText("Received Pallets During Period")).toBeInTheDocument();
    expect(within(ledger).getByText("Gross Storage")).toBeInTheDocument();
    expect(within(ledger).getByText("Storage Discount")).toBeInTheDocument();
    expect(within(ledger).getByText("Net Storage")).toBeInTheDocument();
    expect(within(ledger).queryByText("Reference")).not.toBeInTheDocument();
  });

  it("shows storage grace discounts in the discount column and totals", async () => {
    getBillingInvoice.mockResolvedValue({
      ...invoiceFixture,
      subtotal: 133,
      discountTotal: 0,
      grandTotal: 133,
      lineCount: 1,
      lines: [
        {
          ...invoiceFixture.lines[0],
          quantity: 133,
          amount: 133,
          details: {
            kind: "STORAGE_CONTAINER_SUMMARY" as const,
            warehousesTouched: ["NJ"],
            palletsTracked: 10,
            palletDays: 140,
            freePalletDays: 7,
            billablePalletDays: 133,
            grossAmount: 140,
            discountAmount: 7,
            segments: [
              {
                startDate: "2026-03-01",
                endDate: "2026-03-14",
                dayEndPallets: 10,
                billedDays: 14,
                palletDays: 140,
                freePalletDays: 7,
                billablePalletDays: 133,
                grossAmount: 140,
                discountAmount: 7,
                amount: 133
              }
            ]
          }
        }
      ]
    });

    renderWithProviders(
      <BillingInvoiceEditorPage
        invoiceId={42}
        currentUserRole="admin"
        onBackToBilling={vi.fn()}
      />
    );

    expect(await screen.findAllByText("-$7.00")).not.toHaveLength(0);
    expect(await screen.findAllByText("$140.00")).not.toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Export Excel/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Download Excel" }));

    await waitFor(() => {
      expect(downloadExcelWorkbook).toHaveBeenCalledTimes(1);
    });
    const exportPayload = downloadExcelWorkbook.mock.calls[0][0];
    const containerSheet = exportPayload;
    expect(containerSheet.columns.map((column: { label: string }) => column.label)).toEqual(expect.arrayContaining([
      "Inbound Fee",
      "Wrapping Fee",
      "Outbound Fee",
      "Gross Storage Fee",
      "Storage Discount",
      "Net Storage Fee",
      "Adjustments",
      "Container Total"
    ]));
    expect(containerSheet.rows[0]).toMatchObject({
      storageGrossAmount: 140,
      storageDiscount: -7,
      storageAmount: 133
    });
    const storageSheet = exportPayload.additionalSheets[1];
    expect(storageSheet.columns.map((column: { label: string }) => column.label)).toEqual(expect.arrayContaining([
      "Pallet-Days",
      "Free Pallet-Days",
      "Gross Storage Fee",
      "Storage Discount",
      "Storage Fee"
    ]));
    expect(storageSheet.rows[0]).toMatchObject({
      palletDays: 140,
      freePalletDays: 7,
      storageGrossAmount: 140,
      storageDiscount: -7,
      storageFee: 133
    });
  });

  it("shows storage segment details and hides zero discount columns", async () => {
    getBillingInvoice.mockResolvedValue({
      ...invoiceFixture,
      subtotal: 140,
      discountTotal: 0,
      grandTotal: 140,
      lineCount: 1,
      lines: [
        {
          ...invoiceFixture.lines[0],
          quantity: 140,
          amount: 140,
          details: {
            kind: "STORAGE_CONTAINER_SUMMARY" as const,
            warehousesTouched: ["NJ"],
            palletsTracked: 10,
            palletDays: 140,
            freePalletDays: 0,
            billablePalletDays: 140,
            grossAmount: 140,
            discountAmount: 0,
            segments: [
              {
                startDate: "2026-03-01",
                endDate: "2026-03-14",
                dayEndPallets: 10,
                billedDays: 14,
                palletDays: 140,
                freePalletDays: 0,
                billablePalletDays: 140,
                grossAmount: 140,
                discountAmount: 0,
                amount: 140
              }
            ]
          }
        }
      ]
    });

    renderWithProviders(
      <BillingInvoiceEditorPage
        invoiceId={42}
        currentUserRole="admin"
        onBackToBilling={vi.fn()}
      />
    );

    const segmentTable = await screen.findByRole("table", { name: "Storage Segment Breakdown" });
    expect(within(segmentTable).queryByText("Free Pallet-Days")).not.toBeInTheDocument();
    expect(within(segmentTable).queryByText("Discount")).not.toBeInTheDocument();
    expect(within(segmentTable).getByText("2026-03-01")).toBeInTheDocument();
    expect(within(segmentTable).getByText("2026-03-14")).toBeInTheDocument();
    expect(within(segmentTable).getByText("140")).toBeInTheDocument();
    expect(within(segmentTable).getByText("$140.00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Export Excel/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Download Excel" }));

    await waitFor(() => {
      expect(downloadExcelWorkbook).toHaveBeenCalledTimes(1);
    });
    const exportPayload = downloadExcelWorkbook.mock.calls[0][0];
    expect(exportPayload.columns.map((column: { label: string }) => column.label)).toContain("Storage Discount");
    expect(exportPayload.additionalSheets[0].columns.map((column: { label: string }) => column.label)).not.toContain("Discount");
    expect(exportPayload.additionalSheets).toHaveLength(2);
    const containerSheet = exportPayload;
    expect(containerSheet.sheetName).toBe("Container Reconciliation");
    expect(containerSheet.columns.map((column: { label: string }) => column.label)).not.toContain("Source References");
    expect(containerSheet.rows[0]).toMatchObject({
      containerNo: "GCXU5817233",
      openingPallets: 10,
      releasedPallets: 10,
      closingPallets: 0,
      releaseDates: "2026-03-15 (-10)",
      storageAmount: 140,
      totalAmount: 140
    });
    const storageSheet = exportPayload.additionalSheets[1];
    expect(storageSheet.sheetName).toBe("Storage Fee");
    expect(storageSheet.summaryRows[0]).toMatchObject({ label: "Total", value: 140 });
    expect(storageSheet.rows).toHaveLength(2);
    expect(storageSheet.columns.map((column: { label: string }) => column.label)).toContain("Opening Pallets");
    expect(storageSheet.columns.map((column: { label: string }) => column.label)).toContain("Closing Pallets");
    expect(storageSheet.rows[0]).toMatchObject({
      containerNo: "GCXU5817233",
      openingPallets: 10,
      segmentStartDate: "2026-03-01",
      segmentEndDate: "2026-03-14",
      palletDays: 140,
      storageFee: 140
    });
    expect(storageSheet.rows[1]).toMatchObject({
      releasedPallets: 10,
      closingPallets: 0,
      releaseDate: "2026-03-15"
    });
  });

  it("hides zero-amount manual discount lines from display and export", async () => {
    getBillingInvoice.mockResolvedValue({
      ...invoiceFixture,
      subtotal: 140,
      discountTotal: 0,
      grandTotal: 140,
      lineCount: 2,
      lines: [
        invoiceFixture.lines[0],
        {
          ...invoiceFixture.lines[1],
          description: "Zero discount",
          unitRate: 0,
          amount: 0
        }
      ]
    });

    renderWithProviders(
      <BillingInvoiceEditorPage
        invoiceId={42}
        currentUserRole="admin"
        onBackToBilling={vi.fn()}
      />
    );

    expect(await screen.findByText("Storage settlement for GCXU5817233")).toBeInTheDocument();
    expect(screen.queryByText("Zero discount")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Export Excel/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Download Excel" }));

    await waitFor(() => {
      expect(downloadExcelWorkbook).toHaveBeenCalledTimes(1);
    });
    const exportPayload = downloadExcelWorkbook.mock.calls[0][0];
    const chargeRows = exportPayload.additionalSheets[0].rows;
    expect(chargeRows.map((row: { description: string }) => row.description)).not.toContain("Zero discount");
    expect(chargeRows.map((row: { chargeType: string }) => row.chargeType)).not.toContain("Discount");
  });

  it("exports the current invoice to Excel", async () => {
    renderWithProviders(
      <BillingInvoiceEditorPage
        invoiceId={42}
        currentUserRole="admin"
        onBackToBilling={vi.fn()}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Export" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Export Excel/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Download Excel" }));

    await waitFor(() => {
      expect(downloadExcelWorkbook).toHaveBeenCalledTimes(1);
    });
    const exportPayload = downloadExcelWorkbook.mock.calls[0][0];
    expect(exportPayload.sheetName).toBe("Container Reconciliation");
    expect(exportPayload.columns.map((column: { label: string }) => column.label).slice(0, 2)).toEqual([
      "Received On",
      "Container No."
    ]);
    expect(exportPayload.rows[0]).toMatchObject({
      containerNo: "GCXU5817233",
      receivedPallets: 0,
      storageAmount: 140,
      totalAmount: 140
    });
    expect(exportPayload.summaryRows.map((row: { label: string }) => row.label)).toContain("Invoice Total");
    expect(exportPayload.additionalSheets[0].sheetName).toBe("Charge Lines");
    expect(exportPayload.additionalSheets[0].rows[0]).toMatchObject({
      containerNo: "GCXU5817233",
      chargeType: "Storage Fee",
      description: "Storage settlement for GCXU5817233"
    });
    expect(exportPayload.additionalSheets[1].sheetName).toBe("Storage Fee");
  });

  it("groups Excel charge details by container before charge type", async () => {
    getBillingInvoice.mockResolvedValue({
      ...invoiceFixture,
      lines: [
        {
          ...invoiceFixture.lines[0],
          id: 2001,
          sortOrder: 1,
          chargeType: "INBOUND",
          containerNo: "ZZZU9999999",
          description: "Inbound Z"
        },
        {
          ...invoiceFixture.lines[0],
          id: 2002,
          sortOrder: 2,
          chargeType: "STORAGE",
          containerNo: "AAAU1111111",
          description: "Storage A"
        },
        {
          ...invoiceFixture.lines[0],
          id: 2003,
          sortOrder: 3,
          chargeType: "OUTBOUND",
          containerNo: "AAAU1111111",
          description: "Outbound A"
        }
      ]
    });

    renderWithProviders(
      <BillingInvoiceEditorPage
        invoiceId={42}
        currentUserRole="admin"
        onBackToBilling={vi.fn()}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Export" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Export Excel/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Download Excel" }));

    await waitFor(() => expect(downloadExcelWorkbook).toHaveBeenCalledTimes(1));
    const rows = downloadExcelWorkbook.mock.calls[0][0].additionalSheets[0].rows;
    expect(rows.map((row: { containerNo: string }) => row.containerNo)).toEqual([
      "AAAU1111111",
      "AAAU1111111",
      "ZZZU9999999"
    ]);
    expect(rows.map((row: { chargeType: string }) => row.chargeType)).toEqual([
      "Storage Fee",
      "Outbound Fee",
      "Inbound Fee"
    ]);
  });

  it("exports the current invoice to PDF", async () => {
    renderWithProviders(
      <BillingInvoiceEditorPage
        invoiceId={42}
        currentUserRole="admin"
        onBackToBilling={vi.fn()}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Export" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Download PDF/i }));

    await waitFor(() => {
      expect(downloadBillingInvoicePdf).toHaveBeenCalledTimes(1);
    });
    expect(downloadBillingInvoicePdf.mock.calls[0][0]).not.toHaveProperty("exportMode");
  });

  it("shows PDF export failures and releases the export action", async () => {
    downloadBillingInvoicePdf.mockRejectedValueOnce(new Error("Invoice PDF font unavailable"));
    renderWithProviders(
      <BillingInvoiceEditorPage
        invoiceId={42}
        currentUserRole="admin"
        onBackToBilling={vi.fn()}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Export" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Download PDF/i }));

    expect(await screen.findByText("Invoice PDF font unavailable")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Export" })).toBeEnabled();
    });
  });

  it("exports one PDF and Excel invoice per container as a ZIP", async () => {
    renderWithProviders(
      <BillingInvoiceEditorPage
        invoiceId={42}
        currentUserRole="admin"
        onBackToBilling={vi.fn()}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Export" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Download Container Invoice ZIP/i }));

    await waitFor(() => {
      expect(downloadBillingContainerZip).toHaveBeenCalledWith({
        invoice: invoiceFixture,
        timeZone: "UTC"
      });
    });
  });

  it("blocks customer PDF exports when pallet movement implies negative received pallets", async () => {
    const storageLine = invoiceFixture.lines[0];
    if (!storageLine.details) throw new Error("storage detail fixture is required");
    getBillingInvoice.mockResolvedValue({
      ...invoiceFixture,
      lines: [{
        ...storageLine,
        details: {
          ...storageLine.details,
          openingPallets: 10,
          closingPallets: 2,
          palletReleaseEvents: [{ date: "2026-03-15", pallets: 3 }]
        }
      }, invoiceFixture.lines[1]]
    });
    renderWithProviders(
      <BillingInvoiceEditorPage
        invoiceId={42}
        currentUserRole="admin"
        onBackToBilling={vi.fn()}
      />
    );

    expect(await screen.findByText(/Pallet movement does not reconcile for GCXU5817233/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    expect(await screen.findByRole("menuitem", { name: /Download PDF/i })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("menuitem", { name: /Download Container Invoice ZIP/i })).toHaveAttribute("aria-disabled", "true");
    expect(downloadBillingInvoicePdf).not.toHaveBeenCalled();
    expect(downloadBillingContainerZip).not.toHaveBeenCalled();
  });

  it("edits the draft invoice header before finalization", async () => {
    updateBillingInvoice.mockResolvedValue({
      ...invoiceFixture,
      customerNameSnapshot: "Imperial Bag & Paper - Billing",
      header: {
        ...invoiceFixture.header,
        terms: "Net 15",
        paymentDueDays: 15
      }
    });

    renderWithProviders(
      <BillingInvoiceEditorPage
        invoiceId={42}
        currentUserRole="admin"
        onBackToBilling={vi.fn()}
      />
    );

    const headerPanel = (await screen.findByText("Invoice Header")).closest("section");
    expect(headerPanel).not.toBeNull();
    const headerScope = within(headerPanel as HTMLElement);

    fireEvent.click(headerScope.getByRole("button", { name: "Edit" }));
    fireEvent.change(headerScope.getByLabelText("Customer"), { target: { value: "Imperial Bag & Paper - Billing" } });
    fireEvent.change(headerScope.getByLabelText("Terms"), { target: { value: "Net 15" } });
    fireEvent.change(headerScope.getByLabelText("Payment Due Days"), { target: { value: "15" } });
    fireEvent.click(headerScope.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(updateBillingInvoice).toHaveBeenCalledWith(42, {
        customerName: "Imperial Bag & Paper - Billing",
        header: expect.objectContaining({
          terms: "Net 15",
          paymentDueDays: 15
        })
      });
    });
  });

  it("locks the confirm action while finalizing an invoice", async () => {
    finalizeBillingInvoice.mockImplementation(() => new Promise(() => {}));

    renderWithProviders(
      <BillingInvoiceEditorPage
        invoiceId={42}
        currentUserRole="admin"
        onBackToBilling={vi.fn()}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Finalize Invoice" }));

    const confirmButton = await screen.findByRole("button", { name: /^confirm$/i });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(finalizeBillingInvoice).toHaveBeenCalledWith(42);
    });
    await waitFor(() => {
      expect(confirmButton).toBeDisabled();
      expect(confirmButton).toHaveAttribute("aria-busy", "true");
    });
  });

  it("does not allow an invoice with unreconciled pallet movement to be finalized", async () => {
    const storageLine = invoiceFixture.lines[0];
    getBillingInvoice.mockResolvedValue({
      ...invoiceFixture,
      lines: [{
        ...storageLine,
        details: {
          ...storageLine.details,
          openingPallets: 10,
          closingPallets: 2,
          palletReleaseEvents: [{ date: "2026-03-15", pallets: 3 }]
        }
      }]
    });

    renderWithProviders(
      <BillingInvoiceEditorPage
        invoiceId={42}
        currentUserRole="admin"
        onBackToBilling={vi.fn()}
      />
    );

    expect(await screen.findByRole("button", { name: "Finalize Invoice" })).toBeDisabled();
    expect(finalizeBillingInvoice).not.toHaveBeenCalled();
  });
});
