import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BillingInvoiceEditorPage } from "./BillingInvoiceEditorPage";
import { renderWithProviders } from "../test/renderWithProviders";

const {
  getBillingInvoice,
  updateBillingInvoice,
  finalizeBillingInvoice,
  downloadExcelWorkbook,
  downloadBillingInvoicePdf
} = vi.hoisted(() => ({
  getBillingInvoice: vi.fn(),
  updateBillingInvoice: vi.fn(),
  finalizeBillingInvoice: vi.fn(),
  downloadExcelWorkbook: vi.fn(),
  downloadBillingInvoicePdf: vi.fn()
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
    expect(exportPayload.columns.map((column: { label: string }) => column.label)).toContain("Charge Type");
    expect(exportPayload.rows.map((row: { rowType: string }) => row.rowType)).toContain("Invoice Line");
    expect(exportPayload.summaryRows.map((row: { label: string }) => row.label)).toContain("Grand Total");
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

  it("edits the draft invoice header before finalization", async () => {
    updateBillingInvoice.mockResolvedValue({
      ...invoiceFixture,
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
    fireEvent.change(headerScope.getByLabelText("Terms"), { target: { value: "Net 15" } });
    fireEvent.change(headerScope.getByLabelText("Payment Due Days"), { target: { value: "15" } });
    fireEvent.click(headerScope.getByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(updateBillingInvoice).toHaveBeenCalledWith(42, {
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
});
