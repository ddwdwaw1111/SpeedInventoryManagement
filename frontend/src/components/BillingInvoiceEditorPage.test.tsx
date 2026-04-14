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
    downloadExcelWorkbook.mockReset();
    downloadBillingInvoicePdf.mockReset();
    getBillingInvoice.mockResolvedValue(invoiceFixture);
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

  it("exports the current invoice to Excel summary", async () => {
    renderWithProviders(
      <BillingInvoiceEditorPage
        invoiceId={42}
        currentUserRole="admin"
        onBackToBilling={vi.fn()}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Export" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Export Excel Summary/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Download Excel" }));

    await waitFor(() => {
      expect(downloadExcelWorkbook).toHaveBeenCalledTimes(1);
    });
  });

  it("exports the current invoice to PDF detailed", async () => {
    renderWithProviders(
      <BillingInvoiceEditorPage
        invoiceId={42}
        currentUserRole="admin"
        onBackToBilling={vi.fn()}
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Export" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Download PDF Detailed/i }));

    await waitFor(() => {
      expect(downloadBillingInvoicePdf).toHaveBeenCalledTimes(1);
    });
    expect(downloadBillingInvoicePdf.mock.calls[0][0].exportMode).toBe("DETAILED");
  });
});
