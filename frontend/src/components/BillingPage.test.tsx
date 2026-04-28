import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BillingPage } from "./BillingPage";
import { renderWithProviders } from "../test/renderWithProviders";
import { createCustomer, createInboundDocument, createInboundDocumentLine, createLocation, createOutboundDocument, createOutboundDocumentLine } from "../test/fixtures";

async function pickComboOption(labelText: string, optionText: string | RegExp) {
  const combobox = screen.getByRole("combobox", { name: labelText });
  combobox.focus();
  fireEvent.mouseDown(combobox);
  const listbox = await screen.findByRole("listbox");
  const option = within(listbox).getByText(optionText);
  fireEvent.click(option);
}

const {
  getPallets,
  getPalletLocationEvents,
  getBillingInvoices,
  createBillingInvoice,
  downloadExcelWorkbook,
  downloadBillingPreviewPdf
} = vi.hoisted(() => ({
  getPallets: vi.fn(),
  getPalletLocationEvents: vi.fn(),
  getBillingInvoices: vi.fn(),
  createBillingInvoice: vi.fn(),
  downloadExcelWorkbook: vi.fn(),
  downloadBillingPreviewPdf: vi.fn()
}));

vi.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: {
    getPallets,
    getPalletLocationEvents,
    getBillingInvoices,
    createBillingInvoice
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

describe("BillingPage", () => {
  beforeEach(() => {
    getPallets.mockReset();
    getPalletLocationEvents.mockReset();
    getBillingInvoices.mockReset();
    createBillingInvoice.mockReset();
    downloadExcelWorkbook.mockReset();
    downloadBillingPreviewPdf.mockReset();
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem("sim-timezone", "UTC");
    getPallets.mockResolvedValue([]);
    getPalletLocationEvents.mockResolvedValue([]);
    getBillingInvoices.mockResolvedValue([]);
    createBillingInvoice.mockResolvedValue({ id: 91 });
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

    expect(onOpenBillingContainerDetail).toHaveBeenCalledWith("2026-03-01", "2026-03-31", "all", "GCXU5817233", "all");
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
    expect(downloadExcelWorkbook.mock.calls[0][0].rows).toHaveLength(2);
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
  });

  it("creates a storage settlement invoice per customer and period", async () => {
    const onOpenBillingInvoice = vi.fn();
    const customer = createCustomer({ id: 1, name: "Acme" });

    getPallets.mockResolvedValue([
      {
        id: 1,
        parentPalletId: 0,
        palletCode: "PLT-001",
        containerVisitId: 1,
        sourceInboundDocumentId: 10,
        sourceInboundLineId: 100,
        actualArrivalDate: "2026-03-01",
        customerId: 1,
        customerName: "Acme",
        skuMasterId: 11,
        sku: "SKU-1",
        description: "Widget",
        currentLocationId: 1,
        currentLocationName: "NJ",
        currentStorageSection: "A-01",
        currentContainerNo: "CONT-001",
        containerType: "NORMAL",
        status: "STORED",
        createdAt: "2026-03-01T09:00:00Z",
        updatedAt: "2026-03-31T09:00:00Z",
        contents: []
      }
    ]);
    getPalletLocationEvents.mockResolvedValue([
      {
        id: 1,
        palletId: 1,
        palletCode: "PLT-001",
        containerVisitId: 1,
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
      expect(createBillingInvoice).toHaveBeenCalledTimes(1);
    });
    expect(createBillingInvoice.mock.calls[0][0].invoiceType).toBe("STORAGE_SETTLEMENT");
    expect(createBillingInvoice.mock.calls[0][0].lines).toHaveLength(1);
    expect(onOpenBillingInvoice).toHaveBeenCalledWith(91);
  });

  it("locks invoice creation while the create request is pending", async () => {
    const customer = createCustomer({ id: 1, name: "Acme" });

    createBillingInvoice.mockImplementation(() => new Promise(() => {}));
    getPallets.mockResolvedValue([
      {
        id: 1,
        parentPalletId: 0,
        palletCode: "PLT-001",
        containerVisitId: 1,
        sourceInboundDocumentId: 10,
        sourceInboundLineId: 100,
        actualArrivalDate: "2026-03-01",
        customerId: 1,
        customerName: "Acme",
        skuMasterId: 11,
        sku: "SKU-1",
        description: "Widget",
        currentLocationId: 1,
        currentLocationName: "NJ",
        currentStorageSection: "A-01",
        currentContainerNo: "CONT-001",
        containerType: "NORMAL",
        status: "STORED",
        createdAt: "2026-03-01T09:00:00Z",
        updatedAt: "2026-03-31T09:00:00Z",
        contents: []
      }
    ]);
    getPalletLocationEvents.mockResolvedValue([
      {
        id: 1,
        palletId: 1,
        palletCode: "PLT-001",
        containerVisitId: 1,
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
      expect(createBillingInvoice).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(createButton).toBeDisabled();
      expect(createButton).toHaveAttribute("aria-busy", "true");
    });
  });

  it("includes storage detail snapshots in storage settlement invoice payloads", async () => {
    const customer = createCustomer({ id: 1, name: "Acme" });

    getPallets.mockResolvedValue([
      {
        id: 1,
        parentPalletId: 0,
        palletCode: "PLT-001",
        containerVisitId: 1,
        sourceInboundDocumentId: 10,
        sourceInboundLineId: 100,
        actualArrivalDate: "2026-03-01",
        customerId: 1,
        customerName: "Acme",
        skuMasterId: 11,
        sku: "SKU-1",
        description: "Widget",
        currentLocationId: 1,
        currentLocationName: "NJ",
        currentStorageSection: "A-01",
        currentContainerNo: "CONT-DETAIL",
        containerType: "NORMAL",
        status: "STORED",
        createdAt: "2026-03-01T09:00:00Z",
        updatedAt: "2026-03-31T09:00:00Z",
        contents: []
      }
    ]);
    getPalletLocationEvents.mockResolvedValue([
      {
        id: 1,
        palletId: 1,
        palletCode: "PLT-001",
        containerVisitId: 1,
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
      expect(createBillingInvoice).toHaveBeenCalledTimes(1);
    });

    const payload = createBillingInvoice.mock.calls[0][0];
    expect(payload.lines).toHaveLength(1);
    expect(payload.lines[0]).toMatchObject({
      chargeType: "STORAGE",
      containerNo: "CONT-DETAIL",
      quantity: 24,
      unitRate: 1,
      amount: 24,
      details: {
        kind: "STORAGE_CONTAINER_SUMMARY",
        warehousesTouched: ["NJ"],
        palletsTracked: 1,
        palletDays: 31,
        freePalletDays: 7,
        billablePalletDays: 24,
        grossAmount: 31,
        discountAmount: 7
      }
    });
    expect(payload.lines[0].details?.segments).toHaveLength(2);
  });

  it("creates mixed invoices from the exact preview line set", async () => {
    const customer = createCustomer({ id: 1, name: "Acme" });

    getPallets.mockResolvedValue([
      {
        id: 1,
        parentPalletId: 0,
        palletCode: "PLT-MIXED",
        containerVisitId: 1,
        sourceInboundDocumentId: 10,
        sourceInboundLineId: 100,
        actualArrivalDate: "2026-03-05",
        customerId: 1,
        customerName: "Acme",
        skuMasterId: 11,
        sku: "SKU-1",
        description: "Widget",
        currentLocationId: 1,
        currentLocationName: "NJ",
        currentStorageSection: "A-01",
        currentContainerNo: "CONT-MIXED",
        containerType: "NORMAL",
        status: "STORED",
        createdAt: "2026-03-05T09:00:00Z",
        updatedAt: "2026-03-31T09:00:00Z",
        contents: []
      }
    ]);
    getPalletLocationEvents.mockResolvedValue([
      {
        id: 1,
        palletId: 1,
        palletCode: "PLT-MIXED",
        containerVisitId: 1,
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
      expect(createBillingInvoice).toHaveBeenCalledTimes(1);
    });

    const payload = createBillingInvoice.mock.calls[0][0];
    expect(payload.invoiceType).toBe("MIXED");
    expect(payload.lines.map((line: { chargeType: string }) => line.chargeType)).toEqual(["INBOUND", "WRAPPING", "OUTBOUND", "STORAGE"]);
    expect(payload.lines).toMatchObject([
      { chargeType: "INBOUND", quantity: 1, amount: 450, sourceType: "AUTO" },
      { chargeType: "WRAPPING", quantity: 2, amount: 30, sourceType: "AUTO" },
      { chargeType: "OUTBOUND", quantity: 1, amount: 0, sourceType: "AUTO" },
      { chargeType: "STORAGE", quantity: 20, amount: 20, sourceType: "AUTO" }
    ]);
  });

  it("passes the selected warehouse scope into storage settlement invoice creation", async () => {
    const customer = createCustomer({ id: 1, name: "Acme" });
    const nj = createLocation({ id: 1, name: "NJ" });
    const la = createLocation({ id: 2, name: "LA" });

    getPallets.mockResolvedValue([
      {
        id: 1,
        parentPalletId: 0,
        palletCode: "PLT-NJ",
        containerVisitId: 1,
        sourceInboundDocumentId: 10,
        sourceInboundLineId: 100,
        actualArrivalDate: "2026-03-01",
        customerId: 1,
        customerName: "Acme",
        skuMasterId: 11,
        sku: "SKU-1",
        description: "Widget",
        currentLocationId: 2,
        currentLocationName: "LA",
        currentStorageSection: "A-01",
        currentContainerNo: "CONT-001",
        containerType: "NORMAL",
        status: "STORED",
        createdAt: "2026-03-01T09:00:00Z",
        updatedAt: "2026-03-31T09:00:00Z",
        contents: []
      }
    ]);
    getPalletLocationEvents.mockResolvedValue([
      {
        id: 1,
        palletId: 1,
        palletCode: "PLT-NJ",
        containerVisitId: 1,
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
        palletId: 1,
        palletCode: "PLT-NJ",
        containerVisitId: 1,
        customerId: 1,
        customerName: "Acme",
        locationId: 1,
        locationName: "NJ",
        storageSection: "A-01",
        containerNo: "CONT-001",
        eventType: "TRANSFER_OUT",
        quantityDelta: 0,
        palletDelta: 0,
        eventTime: "2026-03-15T09:00:00Z",
        createdAt: "2026-03-15T09:00:00Z"
      },
      {
        id: 3,
        palletId: 1,
        palletCode: "PLT-NJ",
        containerVisitId: 1,
        customerId: 1,
        customerName: "Acme",
        locationId: 2,
        locationName: "LA",
        storageSection: "B-01",
        containerNo: "CONT-001",
        eventType: "TRANSFER_IN",
        quantityDelta: 0,
        palletDelta: 0,
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
      expect(createBillingInvoice).toHaveBeenCalledTimes(1);
    });
    expect(createBillingInvoice.mock.calls[0][0]).toMatchObject({
      invoiceType: "STORAGE_SETTLEMENT",
      warehouseLocationId: 2,
      warehouseName: "LA"
    });
  });
});
