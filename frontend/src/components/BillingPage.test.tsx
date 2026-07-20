import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BillingPage } from "./BillingPage";
import { ApiError } from "../lib/api";
import { renderWithProviders } from "../test/renderWithProviders";
import { createCustomer, createInboundDocument, createInboundDocumentLine, createLocation, createOutboundDocument, createOutboundDocumentLine } from "../test/fixtures";
import { DEFAULT_BILLING_INVOICE_HEADER } from "../lib/settings";

async function pickComboOption(labelText: string, optionText: string | RegExp) {
  const combobox = screen.getByRole("combobox", { name: labelText });
  combobox.focus();
  fireEvent.mouseDown(combobox);
  const listbox = await screen.findByRole("listbox");
  const option = within(listbox).getByText(optionText);
  fireEvent.click(option);
}

const {
  getContainerLifecycleEvents,
  getBillingInvoices,
  previewBilling,
  generateBillingInvoice,
  downloadExcelWorkbook,
  downloadBillingPreviewPdf
} = vi.hoisted(() => ({
  getContainerLifecycleEvents: vi.fn(),
  getBillingInvoices: vi.fn(),
  previewBilling: vi.fn(),
  generateBillingInvoice: vi.fn(),
  downloadExcelWorkbook: vi.fn(),
  downloadBillingPreviewPdf: vi.fn()
}));

vi.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  api: {
    getContainerLifecycleEvents,
    getBillingInvoices,
    previewBilling,
    generateBillingInvoice
  }
}));

vi.mock("../lib/excelExport", () => ({
  downloadExcelWorkbook
}));

vi.mock("../lib/billingPreviewPdf", () => ({
  downloadBillingPreviewPdf
}));

vi.mock("@mui/x-charts", () => ({
  BarChart: () => <div data-testid="billing-balance-chart" />
}));

function createAuthoritativePreview(overrides: Record<string, unknown> = {}) {
  const periodStart = String(overrides.periodStart ?? "2026-03-01");
  const periodEnd = String(overrides.periodEnd ?? "2026-03-31");
  const rates = overrides.rates ?? {
    inboundContainerFee: 450,
    transferInboundFeePerPallet: 10,
    wrappingFeePerPallet: 15,
    storageFeePerPalletPerWeek: 7,
    storageFeePerPalletPerWeekNormal: 7,
    storageFeePerPalletPerWeekWestCoastTransfer: 7,
    outboundFeePerPallet: 0
  };
  return {
    calculationVersion: "container-v1",
    sourceFingerprint: `fingerprint-${periodStart}-${periodEnd}`,
    customerId: 1,
    customerName: "Acme",
    warehouseLocationId: null,
    containerType: "",
    periodStart,
    periodEnd,
    normalPalletGracePeriodEnabled: true,
    rates,
    lines: [
      {
        id: "inbound-10",
        chargeType: "INBOUND",
        sourceType: "INBOUND_DOCUMENT",
        sourceId: 10,
        reference: "CONT-SERVER",
        containerNo: "CONT-SERVER",
        containerType: "NORMAL",
        warehouse: "NJ",
        occurredOn: "2026-03-05",
        quantity: 1,
        unitRate: 450,
        amount: 450,
        description: "Inbound container fee"
      },
      {
        id: "storage-CONT-SERVER",
        chargeType: "STORAGE",
        sourceType: "CONTAINER_LIFECYCLE",
        sourceId: 0,
        reference: "Storage | CONT-SERVER",
        containerNo: "CONT-SERVER",
        containerType: "NORMAL",
        warehouse: "NJ",
        occurredOn: "2026-03-31",
        quantity: 24,
        unitRate: 1,
        amount: 24,
        description: "Storage charges"
      }
    ],
    storageRows: [
      {
        customerId: 1,
        customerName: "Acme",
        containerNo: "CONT-SERVER",
        containerType: "NORMAL",
        locationId: 1,
        warehousesTouched: ["NJ"],
        palletsTracked: 1,
        palletDays: 31,
        freePalletDays: 7,
        billablePalletDays: 24,
        averageDailyPallets: 1,
        firstActivityOn: "2026-03-01",
        lastActivityOn: "2026-03-31",
        grossAmount: 31,
        discountAmount: 7,
        amount: 24,
        segments: [
          {
            startDate: "2026-03-01",
            endDate: "2026-03-07",
            dayEndPallets: 1,
            billedDays: 7,
            palletDays: 7,
            freePalletDays: 7,
            billablePalletDays: 0,
            grossAmount: 7,
            discountAmount: 7,
            amount: 0
          },
          {
            startDate: "2026-03-08",
            endDate: "2026-03-31",
            dayEndPallets: 1,
            billedDays: 24,
            palletDays: 24,
            freePalletDays: 0,
            billablePalletDays: 24,
            grossAmount: 24,
            discountAmount: 0,
            amount: 24
          }
        ]
      }
    ],
    dailyBalances: [{ date: "2026-03-31", palletCount: 1 }],
    summary: {
      receivedContainers: 1,
      receivedPallets: 0,
      shippedPallets: 0,
      palletDays: 31,
      inboundAmount: 450,
      wrappingAmount: 0,
      storageGrossAmount: 31,
      storageDiscountAmount: 7,
      storageAmount: 24,
      outboundAmount: 0,
      grandTotal: 474
    },
    warnings: [],
    ...overrides
  };
}

describe("BillingPage", () => {
  beforeEach(() => {
    getContainerLifecycleEvents.mockReset();
    getBillingInvoices.mockReset();
    previewBilling.mockReset();
    generateBillingInvoice.mockReset();
    downloadExcelWorkbook.mockReset();
    downloadBillingPreviewPdf.mockReset();
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem("sim-timezone", "UTC");
    getContainerLifecycleEvents.mockResolvedValue([]);
    getBillingInvoices.mockResolvedValue([]);
    previewBilling.mockImplementation(async (payload) => createAuthoritativePreview({
      customerId: payload.customerId,
      periodStart: payload.periodStart,
      periodEnd: payload.periodEnd,
      warehouseLocationId: payload.warehouseLocationId,
      containerType: payload.containerType ?? "",
      normalPalletGracePeriodEnabled: payload.normalPalletGracePeriodEnabled,
      rates: payload.rates
    }));
    generateBillingInvoice.mockResolvedValue({ id: 91 });
  });

  it("loads authoritative previews for every customer in the all-customers scope", async () => {
    previewBilling.mockImplementation(async (payload) => createAuthoritativePreview({
      customerId: payload.customerId,
      periodStart: payload.periodStart,
      periodEnd: payload.periodEnd,
      warnings: payload.customerId === 1 ? ["Customer 1 billing warning"] : []
    }));
    renderWithProviders(
      <BillingPage
        customers={[
          createCustomer({ id: 1, name: "Acme" }),
          createCustomer({ id: 2, name: "Bravo" })
        ]}
        locations={[createLocation()]}
        inboundDocuments={[]}
        outboundDocuments={[]}
        currentUserRole="admin"
        onOpenBillingContainerDetail={vi.fn()}
        onOpenBillingInvoice={vi.fn()}
      />
    );

    await waitFor(() => {
      const requestedCustomers = new Set(previewBilling.mock.calls.map(([payload]) => payload.customerId));
      expect(requestedCustomers).toEqual(new Set([1, 2]));
    });
    expect(await screen.findByText("Acme: Customer 1 billing warning")).toBeInTheDocument();
  });

  it("opens the billing container detail route with the selected date range and customer scope", async () => {
    const onOpenBillingContainerDetail = vi.fn();

    renderWithProviders(
      <BillingPage
        customers={[createCustomer()]}
        locations={[createLocation()]}
        inboundDocuments={[
          createInboundDocument({
            id: 12,
            status: "CONFIRMED",
            confirmedAt: "2026-03-05T12:00:00Z",
            expectedArrivalDate: "2026-03-05",
            containerNo: "GCXU5817233",
            lines: [createInboundDocumentLine({ id: 71, pallets: 2, receivedQty: 20, expectedQty: 20 })]
          })
        ]}
        outboundDocuments={[]}
        currentUserRole="admin"
        onOpenBillingContainerDetail={onOpenBillingContainerDetail}
        onOpenBillingInvoice={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-03-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-03-31" } });
    fireEvent.click(screen.getByRole("button", { name: "Show Details" }));

    const openButton = await screen.findByRole("button", { name: "Billing Detail" });
    expect(screen.getByRole("table", { name: "Container Billing Trace" })).toBeInTheDocument();

    fireEvent.click(openButton);

    expect(onOpenBillingContainerDetail).toHaveBeenCalledWith("2026-03-01", "2026-03-31", 1, "CONT-SERVER", "all");
    await waitFor(() => {
      expect(window.sessionStorage.getItem("sim-billing-workspace-context")).toContain('"startDate":"2026-03-01"');
      expect(window.sessionStorage.getItem("sim-billing-workspace-context")).toContain('"endDate":"2026-03-31"');
    });
  });

  it("exports the current billing preview to Excel summary", async () => {
    renderWithProviders(
      <BillingPage
        customers={[createCustomer()]}
        locations={[createLocation()]}
        inboundDocuments={[
          createInboundDocument({
            id: 12,
            status: "CONFIRMED",
            confirmedAt: "2026-03-05T12:00:00Z",
            expectedArrivalDate: "2026-03-05",
            containerNo: "GCXU5817233",
            lines: [createInboundDocumentLine({ id: 71, pallets: 2, receivedQty: 20, expectedQty: 20 })]
          })
        ]}
        outboundDocuments={[]}
        currentUserRole="admin"
        onOpenBillingContainerDetail={vi.fn()}
        onOpenBillingInvoice={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-03-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-03-31" } });
    fireEvent.click(await screen.findByRole("button", { name: "Export" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Export Excel/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Download Excel" }));

    await waitFor(() => {
      expect(downloadExcelWorkbook).toHaveBeenCalledTimes(1);
    });
    expect(downloadExcelWorkbook.mock.calls[0][0].rows.length).toBeGreaterThan(0);
    const columnLabels = downloadExcelWorkbook.mock.calls[0][0].columns.map((column: { label: string }) => column.label);
    expect(columnLabels).toContain("Charge Type");
    expect(columnLabels.indexOf("Container No.")).toBeLessThan(columnLabels.indexOf("Charge Type"));
    expect(downloadExcelWorkbook.mock.calls[0][0].rows.map((row: { rowType: string }) => row.rowType)).toContain("Invoice Line");
    expect(downloadExcelWorkbook.mock.calls[0][0].summaryRows.map((row: { label: string }) => row.label)).toContain("Grand Total");
  });

  it("exports the current billing preview to PDF", async () => {
    renderWithProviders(
      <BillingPage
        customers={[createCustomer()]}
        locations={[createLocation()]}
        inboundDocuments={[
          createInboundDocument({
            id: 12,
            status: "CONFIRMED",
            confirmedAt: "2026-03-05T12:00:00Z",
            expectedArrivalDate: "2026-03-05",
            containerNo: "GCXU5817233",
            lines: [createInboundDocumentLine({ id: 71, pallets: 2, receivedQty: 20, expectedQty: 20 })]
          })
        ]}
        outboundDocuments={[]}
        currentUserRole="admin"
        onOpenBillingContainerDetail={vi.fn()}
        onOpenBillingInvoice={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-03-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-03-31" } });
    fireEvent.click(await screen.findByRole("button", { name: "Export" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Download PDF/i }));

    await waitFor(() => {
      expect(downloadBillingPreviewPdf).toHaveBeenCalledTimes(1);
    });
    expect(downloadBillingPreviewPdf.mock.calls[0][0]).not.toHaveProperty("exportMode");
    expect(downloadBillingPreviewPdf.mock.calls[0][0].header).toEqual(DEFAULT_BILLING_INVOICE_HEADER);
  });

  it("creates a storage settlement invoice per customer and period", async () => {
    const onOpenBillingInvoice = vi.fn();
    const customer = createCustomer({ id: 1, name: "Acme" });
    getContainerLifecycleEvents.mockResolvedValue([
      {
        id: 1,
        customerId: 1,
        customerName: "Acme",
        locationId: 1,
        locationName: "NJ",
        storageSection: "A-01",
        containerNo: "CONT-001",
        eventType: "RECEIVED",
        quantityDelta: 100,
        palletDelta: 1,
        eventTime: "2026-03-01T09:00:00Z",
        createdAt: "2026-03-01T09:00:00Z"
      }
    ]);

    renderWithProviders(
      <BillingPage
        customers={[customer]}
        locations={[createLocation()]}
        inboundDocuments={[]}
        outboundDocuments={[]}
        currentUserRole="admin"
        onOpenBillingContainerDetail={vi.fn()}
        onOpenBillingInvoice={onOpenBillingInvoice}
      />
    );

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-03-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-03-31" } });
    await pickComboOption("Customer", "Acme");
    fireEvent.click(screen.getByRole("button", { name: "Storage Settlement" }));
    await pickComboOption("Container Type", "Normal");

    const createButton = await screen.findByRole("button", { name: "Create Storage Invoice" });
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(generateBillingInvoice).toHaveBeenCalledTimes(1);
    });
    expect(generateBillingInvoice.mock.calls[0][0]).toMatchObject({
      invoiceType: "STORAGE_SETTLEMENT",
      customerId: 1,
      containerType: "NORMAL",
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      sourceFingerprint: "fingerprint-2026-03-01-2026-03-31",
      header: DEFAULT_BILLING_INVOICE_HEADER
    });
    expect(generateBillingInvoice.mock.calls[0][0]).not.toHaveProperty("lines");
    expect(onOpenBillingInvoice).toHaveBeenCalledWith(91);
  });

  it("locks invoice creation while the create request is pending", async () => {
    const customer = createCustomer({ id: 1, name: "Acme" });

    generateBillingInvoice.mockImplementation(() => new Promise(() => {}));
    getContainerLifecycleEvents.mockResolvedValue([
      {
        id: 1,
        customerId: 1,
        customerName: "Acme",
        locationId: 1,
        locationName: "NJ",
        storageSection: "A-01",
        containerNo: "CONT-001",
        eventType: "RECEIVED",
        quantityDelta: 100,
        palletDelta: 1,
        eventTime: "2026-03-01T09:00:00Z",
        createdAt: "2026-03-01T09:00:00Z"
      }
    ]);

    renderWithProviders(
      <BillingPage
        customers={[customer]}
        locations={[createLocation()]}
        inboundDocuments={[]}
        outboundDocuments={[]}
        currentUserRole="admin"
        onOpenBillingContainerDetail={vi.fn()}
        onOpenBillingInvoice={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-03-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-03-31" } });
    await pickComboOption("Customer", "Acme");
    fireEvent.click(screen.getByRole("button", { name: "Storage Settlement" }));
    await pickComboOption("Container Type", "Normal");

    const createButton = await screen.findByRole("button", { name: "Create Storage Invoice" });
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(generateBillingInvoice).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(createButton).toBeDisabled();
      expect(createButton).toHaveAttribute("aria-busy", "true");
    });
  });

  it("renders the authoritative storage preview and leaves invoice lines to the backend", async () => {
    const customer = createCustomer({ id: 1, name: "Acme" });
    getContainerLifecycleEvents.mockResolvedValue([
      {
        id: 1,
        customerId: 1,
        customerName: "Acme",
        locationId: 1,
        locationName: "NJ",
        storageSection: "A-01",
        containerNo: "CONT-DETAIL",
        eventType: "RECEIVED",
        quantityDelta: 100,
        palletDelta: 1,
        eventTime: "2026-03-01T09:00:00Z",
        createdAt: "2026-03-01T09:00:00Z"
      }
    ]);

    renderWithProviders(
      <BillingPage
        customers={[customer]}
        locations={[createLocation()]}
        inboundDocuments={[]}
        outboundDocuments={[]}
        currentUserRole="admin"
        onOpenBillingContainerDetail={vi.fn()}
        onOpenBillingInvoice={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-03-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-03-31" } });
    await pickComboOption("Customer", "Acme");
    fireEvent.click(screen.getByRole("button", { name: "Storage Settlement" }));
    await pickComboOption("Container Type", "Normal");

    expect(await screen.findAllByText("-$7.00")).not.toHaveLength(0);

    fireEvent.click(await screen.findByRole("button", { name: "Create Storage Invoice" }));

    await waitFor(() => {
      expect(generateBillingInvoice).toHaveBeenCalledTimes(1);
    });

    expect(screen.getAllByText("CONT-SERVER").length).toBeGreaterThan(0);
    const payload = generateBillingInvoice.mock.calls[0][0];
    expect(payload).not.toHaveProperty("lines");
    expect(payload).not.toHaveProperty("amount");
  });

  it("creates storage settlement invoices without normal pallet grace days when the switch is off", async () => {
    const customer = createCustomer({ id: 1, name: "Acme" });
    getContainerLifecycleEvents.mockResolvedValue([
      {
        id: 1,
        customerId: 1,
        customerName: "Acme",
        locationId: 1,
        locationName: "NJ",
        storageSection: "A-01",
        containerNo: "CONT-NO-GRACE",
        eventType: "RECEIVED",
        quantityDelta: 100,
        palletDelta: 1,
        eventTime: "2026-03-01T09:00:00Z",
        createdAt: "2026-03-01T09:00:00Z"
      }
    ]);

    renderWithProviders(
      <BillingPage
        customers={[customer]}
        locations={[createLocation()]}
        inboundDocuments={[]}
        outboundDocuments={[]}
        currentUserRole="admin"
        onOpenBillingContainerDetail={vi.fn()}
        onOpenBillingInvoice={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-03-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-03-31" } });
    await pickComboOption("Customer", "Acme");
    fireEvent.click(screen.getByRole("button", { name: "Storage Settlement" }));
    await pickComboOption("Container Type", "Normal");

    const graceSwitch = screen.getByRole("switch", { name: "Normal 7-day free" });
    expect(graceSwitch).toBeChecked();
    fireEvent.click(graceSwitch);

    fireEvent.click(await screen.findByRole("button", { name: "Create Storage Invoice" }));

    await waitFor(() => {
      expect(generateBillingInvoice).toHaveBeenCalledTimes(1);
    });

    const payload = generateBillingInvoice.mock.calls[0][0];
    expect(payload.normalPalletGracePeriodEnabled).toBe(false);
    expect(previewBilling).toHaveBeenCalledWith(expect.objectContaining({
      normalPalletGracePeriodEnabled: false
    }));
    expect(payload).not.toHaveProperty("lines");
  });

  it("sends the underfilled-pallet rule and threshold to the authoritative preview", async () => {
    renderWithProviders(
      <BillingPage
        customers={[createCustomer({ id: 1, name: "Acme" })]}
        locations={[createLocation()]}
        inboundDocuments={[]}
        outboundDocuments={[]}
        currentUserRole="admin"
        onOpenBillingContainerDetail={vi.fn()}
        onOpenBillingInvoice={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Rate Card" }));
    const exclusionSwitch = await screen.findByRole("switch", { name: "Exclude underfilled pallets" });
    fireEvent.click(exclusionSwitch);
    expect(screen.getByLabelText("Minimum Qty per Billable Pallet")).toHaveValue(10);
    fireEvent.change(screen.getByLabelText("Minimum Qty per Billable Pallet"), { target: { value: "40" } });

    await waitFor(() => {
      expect(previewBilling).toHaveBeenCalledWith(expect.objectContaining({
        rates: expect.objectContaining({
          excludeUnderfilledPallets: true,
          minimumQtyPerPallet: 15
        })
      }));
    });
  });

  it("generates mixed invoices from the authoritative scope and fingerprint", async () => {
    const customer = createCustomer({ id: 1, name: "Acme" });
    getContainerLifecycleEvents.mockResolvedValue([
      {
        id: 1,
        customerId: 1,
        customerName: "Acme",
        locationId: 1,
        locationName: "NJ",
        storageSection: "A-01",
        containerNo: "CONT-MIXED",
        eventType: "RECEIVED",
        quantityDelta: 20,
        palletDelta: 1,
        eventTime: "2026-03-05T09:00:00Z",
        createdAt: "2026-03-05T09:00:00Z"
      }
    ]);

    renderWithProviders(
      <BillingPage
        customers={[customer]}
        locations={[createLocation()]}
        inboundDocuments={[
          createInboundDocument({
            id: 10,
            customerId: 1,
            customerName: "Acme",
            status: "CONFIRMED",
            actualArrivalDate: "2026-03-05",
            confirmedAt: "2026-03-05T09:00:00Z",
            containerNo: "CONT-MIXED",
            lines: [createInboundDocumentLine({ id: 100, pallets: 2, receivedQty: 20, expectedQty: 20 })]
          })
        ]}
        outboundDocuments={[
          createOutboundDocument({
            id: 20,
            customerId: 1,
            customerName: "Acme",
            status: "CONFIRMED",
            actualShipDate: "2026-03-20",
            confirmedAt: "2026-03-20T09:00:00Z",
            lines: [createOutboundDocumentLine({ id: 200, pallets: 1, quantity: 10 })]
          })
        ]}
        currentUserRole="admin"
        onOpenBillingContainerDetail={vi.fn()}
        onOpenBillingInvoice={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-03-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-03-31" } });
    await pickComboOption("Customer", "Acme");

    fireEvent.click(await screen.findByRole("button", { name: "Create Mixed Invoice" }));

    await waitFor(() => {
      expect(generateBillingInvoice).toHaveBeenCalledTimes(1);
    });

    const payload = generateBillingInvoice.mock.calls[0][0];
    expect(payload).toMatchObject({
      invoiceType: "MIXED",
      customerId: 1,
      periodStart: "2026-03-01",
      periodEnd: "2026-03-31",
      sourceFingerprint: "fingerprint-2026-03-01-2026-03-31"
    });
    expect(payload).not.toHaveProperty("lines");
    expect(payload).not.toHaveProperty("customerName");
    expect(payload).not.toHaveProperty("warehouseName");
  });

  it("passes the selected warehouse scope into storage settlement invoice creation", async () => {
    const customer = createCustomer({ id: 1, name: "Acme" });
    const nj = createLocation({ id: 1, name: "NJ" });
    const la = createLocation({ id: 2, name: "LA" });
    getContainerLifecycleEvents.mockResolvedValue([
      {
        id: 1,
        customerId: 1,
        customerName: "Acme",
        locationId: 1,
        locationName: "NJ",
        storageSection: "A-01",
        containerNo: "CONT-001",
        eventType: "RECEIVED",
        quantityDelta: 100,
        palletDelta: 1,
        eventTime: "2026-03-01T09:00:00Z",
        createdAt: "2026-03-01T09:00:00Z"
      },
      {
        id: 2,
        customerId: 1,
        customerName: "Acme",
        locationId: 1,
        locationName: "NJ",
        storageSection: "A-01",
        containerNo: "CONT-001",
        eventType: "TRANSFER_OUT",
        quantityDelta: 0,
        palletDelta: -1,
        eventTime: "2026-03-15T09:00:00Z",
        createdAt: "2026-03-15T09:00:00Z"
      },
      {
        id: 3,
        customerId: 1,
        customerName: "Acme",
        locationId: 2,
        locationName: "LA",
        storageSection: "B-01",
        containerNo: "CONT-001",
        eventType: "TRANSFER_IN",
        quantityDelta: 0,
        palletDelta: 1,
        eventTime: "2026-03-15T09:00:00Z",
        createdAt: "2026-03-15T09:00:00Z"
      }
    ]);

    renderWithProviders(
      <BillingPage
        customers={[customer]}
        locations={[nj, la]}
        inboundDocuments={[]}
        outboundDocuments={[]}
        currentUserRole="admin"
        onOpenBillingContainerDetail={vi.fn()}
        onOpenBillingInvoice={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-03-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-03-31" } });
    await pickComboOption("Customer", "Acme");
    fireEvent.click(screen.getByRole("button", { name: "Storage Settlement" }));
    await pickComboOption("Container Type", "Normal");
    await pickComboOption("Warehouse Scope", "LA");

    const createButton = await screen.findByRole("button", { name: "Create Storage Invoice" });
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(generateBillingInvoice).toHaveBeenCalledTimes(1);
    });
    expect(generateBillingInvoice.mock.calls[0][0]).toMatchObject({
      invoiceType: "STORAGE_SETTLEMENT",
      warehouseLocationId: 2
    });
    expect(generateBillingInvoice.mock.calls[0][0]).not.toHaveProperty("warehouseName");
  });

  it("keeps the container search as a display-only filter when generating an invoice", async () => {
    const customer = createCustomer({ id: 1, name: "Acme" });

    renderWithProviders(
      <BillingPage
        customers={[customer]}
        locations={[createLocation()]}
        inboundDocuments={[]}
        outboundDocuments={[]}
        currentUserRole="operator"
        onOpenBillingContainerDetail={vi.fn()}
        onOpenBillingInvoice={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-03-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-03-31" } });
    await pickComboOption("Customer", "Acme");
    await screen.findByRole("button", { name: "Create Mixed Invoice" });

    fireEvent.change(screen.getByPlaceholderText("Container no., reference, or warehouse"), {
      target: { value: "NO-MATCH" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Mixed Invoice" }));

    await waitFor(() => expect(generateBillingInvoice).toHaveBeenCalledTimes(1));
    expect(generateBillingInvoice.mock.calls[0][0]).not.toHaveProperty("containerNo");
    expect(generateBillingInvoice.mock.calls[0][0].sourceFingerprint).toBe("fingerprint-2026-03-01-2026-03-31");
  });

  it("keeps viewers on the authoritative preview without showing invoice generation", async () => {
    const customer = createCustomer({ id: 1, name: "Acme" });

    renderWithProviders(
      <BillingPage
        customers={[customer]}
        locations={[createLocation()]}
        inboundDocuments={[]}
        outboundDocuments={[]}
        currentUserRole="viewer"
        onOpenBillingContainerDetail={vi.fn()}
        onOpenBillingInvoice={vi.fn()}
      />
    );

    await pickComboOption("Customer", "Acme");
    await waitFor(() => {
      expect(previewBilling).toHaveBeenCalledWith(expect.objectContaining({ customerId: 1 }));
      expect(screen.getAllByText("CONT-SERVER").length).toBeGreaterThan(0);
    });
    expect(screen.queryByRole("button", { name: "Create Mixed Invoice" })).not.toBeInTheDocument();
    expect(generateBillingInvoice).not.toHaveBeenCalled();
  });

  it("refreshes a stale authoritative preview after a 409 response", async () => {
    const customer = createCustomer({ id: 1, name: "Acme" });
    generateBillingInvoice.mockRejectedValueOnce(new ApiError(409, "stale preview"));

    renderWithProviders(
      <BillingPage
        customers={[customer]}
        locations={[createLocation()]}
        inboundDocuments={[]}
        outboundDocuments={[]}
        currentUserRole="admin"
        onOpenBillingContainerDetail={vi.fn()}
        onOpenBillingInvoice={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-03-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-03-31" } });
    await pickComboOption("Customer", "Acme");
    const createButton = await screen.findByRole("button", { name: "Create Mixed Invoice" });
    const previewCallsBeforeGenerate = previewBilling.mock.calls.length;
    fireEvent.click(createButton);

    expect(await screen.findByText(/Billing activity changed after this preview was calculated/)).toBeInTheDocument();
    await waitFor(() => {
      expect(previewBilling.mock.calls.length).toBeGreaterThan(previewCallsBeforeGenerate);
    });
  });
});
