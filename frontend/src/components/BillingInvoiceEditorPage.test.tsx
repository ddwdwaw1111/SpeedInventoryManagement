import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BillingInvoiceEditorPage } from "./BillingInvoiceEditorPage";
import { renderWithProviders } from "../test/renderWithProviders";

const {
  getBillingInvoice,
  downloadExcelWorkbook,
  downloadBillingInvoicePdf
} = vi.hoisted(() => ({
  getBillingInvoice: vi.fn(),
  downloadExcelWorkbook: vi.fn(),
  downloadBillingInvoicePdf: vi.fn()
}));

vi.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    getBillingInvoice,
    updateBillingInvoice: vi.fn(),
    addBillingInvoiceLine: vi.fn(),
    updateBillingInvoiceLine: vi.fn(),
    deleteBillingInvoiceLine: vi.fn(),
    finalizeBillingInvoice: vi.fn(),
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
  customerId: 1,
  customerNameSnapshot: "Imperial Bag & Paper",
  periodStart: "2026-03-01",
  periodEnd: "2026-03-31",
  currencyCode: "USD",
  rates: {
    inboundContainerFee: 450,
    wrappingFeePerPallet: 10,
    storageFeePerPalletPerWeek: 7,
    outboundFeePerPallet: 10
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
  lines: [
    {
      id: 1001,
      invoiceId: 42,
      chargeType: "INBOUND",
      description: "Inbound container fee",
      reference: "Receipt 12 | GCXU5817233",
      containerNo: "GCXU5817233",
      warehouse: "NJ",
      occurredOn: "2026-03-05",
      quantity: 1,
      unitRate: 450,
      amount: 450,
      notes: "",
      sourceType: "AUTO" as const,
      sortOrder: 1,
      createdAt: "2026-04-01T12:00:00Z"
    },
    {
      id: 1002,
      invoiceId: 42,
      chargeType: "STORAGE",
      description: "Storage charges",
      reference: "Storage | GCXU5817233",
      containerNo: "GCXU5817233",
      warehouse: "NJ",
      occurredOn: "2026-03-31",
      quantity: 170,
      unitRate: 1,
      amount: 170,
      notes: "5 pallets tracked",
      sourceType: "AUTO" as const,
      sortOrder: 2,
      createdAt: "2026-04-01T12:00:00Z"
    }
  ]
};

describe("BillingInvoiceEditorPage", () => {
  beforeEach(() => {
    getBillingInvoice.mockReset();
    downloadExcelWorkbook.mockReset();
    downloadBillingInvoicePdf.mockReset();
    getBillingInvoice.mockResolvedValue(invoiceFixture);
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem("sim-timezone", "UTC");
  });

  it("exports the current invoice to Excel", async () => {
    renderWithProviders(
      <BillingInvoiceEditorPage
        invoiceId={42}
        currentUserRole="admin"
        onBackToBilling={vi.fn()}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Export Excel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Download Excel" }));

    await waitFor(() => {
      expect(downloadExcelWorkbook).toHaveBeenCalledTimes(1);
    });
  });

  it("exports the current invoice to PDF", async () => {
    renderWithProviders(
      <BillingInvoiceEditorPage
        invoiceId={42}
        currentUserRole="admin"
        onBackToBilling={vi.fn()}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Download PDF" }));

    await waitFor(() => {
      expect(downloadBillingInvoicePdf).toHaveBeenCalledTimes(1);
    });
  });
});
