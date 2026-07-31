// @vitest-environment node

import { strFromU8, strToU8, unzipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildBillingContainerZip, downloadBillingContainerZip } from "./billingContainerZip";
import type { BillingContainerReconciliationPdfInput } from "./billingInvoicePdf";
import type { BillingInvoice } from "./types";

const { buildExcelWorkbookBytes, downloadByteParts, renderBillingPdfDefinitionBuffer } = vi.hoisted(() => ({
  buildExcelWorkbookBytes: vi.fn(),
  downloadByteParts: vi.fn(),
  renderBillingPdfDefinitionBuffer: vi.fn()
}));

vi.mock("./excelExport", () => ({ buildExcelWorkbookBytes, downloadByteParts }));

vi.mock("./billingInvoicePdf", () => ({
  buildBillingInvoicePdfDefinition: ({ invoice }: { invoice: BillingInvoice }) => ({ kind: "invoice", id: invoice.id }),
  buildBillingContainerReconciliationPdfDefinition: ({
    containerNo,
    statement,
    sourceLines
  }: BillingContainerReconciliationPdfInput) => ({
    kind: "container",
    containerNo,
    statementContainerNo: statement?.containerNo,
    sourceLineIds: sourceLines?.map((line) => line.id)
  }),
  renderBillingPdfDefinitionBuffer
}));

function createInvoiceFixture(): BillingInvoice {
  return {
    id: 71,
    invoiceNo: "INV/2026:0042",
    invoiceType: "MIXED",
    customerId: 9,
    customerNameSnapshot: "Container Customer",
    warehouseLocationId: 1,
    warehouseNameSnapshot: "308",
    containerType: "NORMAL",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-15",
    currencyCode: "USD",
    rates: {
      inboundContainerFee: 450,
      transferInboundFeePerPallet: 10,
      wrappingFeePerPallet: 15,
      storageFeePerPalletPerWeek: 7,
      storageFeePerPalletPerWeekNormal: 7,
      storageFeePerPalletPerWeekWestCoastTransfer: 7,
      outboundFeePerPallet: 5
    },
    header: {
      sellerName: "Speed Inventory Management",
      subtitle: "Business services invoice",
      remitTo: "Speed Inventory Management",
      terms: "Net 30",
      paymentDueDays: 30,
      paymentInstructions: ""
    },
    subtotal: 910,
    discountTotal: -10,
    grandTotal: 900,
    status: "DRAFT",
    notes: "",
    finalizedAt: null,
    finalizedByUserId: null,
    paidAt: null,
    voidedAt: null,
    createdByUserId: 1,
    createdAt: "2026-07-16T12:00:00Z",
    updatedAt: "2026-07-16T12:00:00Z",
    lineCount: 3,
    lines: [
      {
        id: 1,
        invoiceId: 71,
        chargeType: "INBOUND",
        description: "Container A inbound",
        reference: "",
        containerNo: "CONT-A",
        warehouse: "308",
        occurredOn: "2026-07-02",
        quantity: 1,
        unitRate: 450,
        amount: 450,
        notes: "",
        sourceType: "AUTO",
        sortOrder: 1,
        createdAt: "2026-07-16T12:00:00Z",
        details: null
      },
      {
        id: 2,
        invoiceId: 71,
        chargeType: "INBOUND",
        description: "Container B inbound",
        reference: "",
        containerNo: "CONT-B",
        warehouse: "308",
        occurredOn: "2026-07-03",
        quantity: 1,
        unitRate: 450,
        amount: 450,
        notes: "",
        sourceType: "AUTO",
        sortOrder: 2,
        createdAt: "2026-07-16T12:00:00Z",
        details: null
      },
      {
        id: 3,
        invoiceId: 71,
        chargeType: "DISCOUNT",
        description: "Invoice discount",
        reference: "",
        containerNo: "",
        warehouse: "",
        occurredOn: "",
        quantity: 1,
        unitRate: -10,
        amount: -10,
        notes: "",
        sourceType: "MANUAL",
        sortOrder: 3,
        createdAt: "2026-07-16T12:00:00Z",
        details: null
      }
    ]
  };
}

describe("billing container ZIP", () => {
  beforeEach(() => {
    downloadByteParts.mockReset();
    buildExcelWorkbookBytes.mockReset();
    buildExcelWorkbookBytes.mockReturnValue(strToU8("container-excel"));
    renderBillingPdfDefinitionBuffer.mockReset();
    renderBillingPdfDefinitionBuffer.mockImplementation(async (definition: { kind: string; containerNo?: string }) =>
      strToU8(`${definition.kind}:${definition.containerNo ?? "full"}`)
    );
  });

  it("packages the full invoice, one PDF and Excel file per container, adjustments, and a reconciliation index", async () => {
    const result = await buildBillingContainerZip({ invoice: createInvoiceFixture(), timeZone: "UTC" });
    const files = unzipSync(result.bytes);
    const fileNames = Object.keys(files).sort();

    expect(result.fileName).toBe("INV-2026-0042-Container-Reconciliation.zip");
    expect(result.containerFileCount).toBe(2);
    expect(fileNames).toEqual([
      "00-Full-Invoice-INV-2026-0042.pdf",
      "01-Container-Reconciliation-Index.csv",
      "Containers/001-CONT-A.pdf",
      "Containers/001-CONT-A.xlsx",
      "Containers/002-CONT-B.pdf",
      "Containers/002-CONT-B.xlsx",
      "Containers/003-INVOICE-LEVEL-ADJUSTMENTS.pdf",
      "Containers/003-INVOICE-LEVEL-ADJUSTMENTS.xlsx"
    ]);
    expect(strFromU8(files["Containers/001-CONT-A.pdf"])).toBe("container:CONT-A");
    expect(strFromU8(files["Containers/001-CONT-A.xlsx"])).toBe("container-excel");
    expect(strFromU8(files["Containers/003-INVOICE-LEVEL-ADJUSTMENTS.pdf"])).toBe("container:");
    expect(buildExcelWorkbookBytes).toHaveBeenCalledTimes(3);
    expect(buildExcelWorkbookBytes.mock.calls.map(([options]) => options.invoiceHeader.containerNo)).toEqual([
      "CONT-A",
      "CONT-B",
      "Invoice-level Adjustments"
    ]);

    const containerPdfCalls = renderBillingPdfDefinitionBuffer.mock.calls
      .map(([definition]) => definition)
      .filter((definition) => definition.kind === "container");
    expect(containerPdfCalls.map((definition) => definition.containerNo)).toEqual(["CONT-A", "CONT-B", ""]);
    expect(containerPdfCalls.map((definition) => definition.statementContainerNo)).toEqual(["CONT-A", "CONT-B", ""]);
    expect(containerPdfCalls.map((definition) => definition.sourceLineIds)).toEqual([[1], [2], [3]]);

    const index = strFromU8(files["01-Container-Reconciliation-Index.csv"]);
    expect(index).toContain("Container Total");
    expect(index).toContain("Received Pallets During Period");
    expect(index).toContain("PDF File,Excel File,Container");
    expect(index).toContain("Containers/001-CONT-A.pdf,Containers/001-CONT-A.xlsx,CONT-A,308");
    expect(index).toContain("Containers/002-CONT-B.pdf,Containers/002-CONT-B.xlsx,CONT-B,308");
    expect(index).toContain("Invoice-level Adjustments");
    expect(index).toContain("-10.00,-10.00");
  });

  it("downloads the generated archive with the ZIP media type", async () => {
    const result = await downloadBillingContainerZip({ invoice: createInvoiceFixture(), timeZone: "UTC" });

    expect(downloadByteParts).toHaveBeenCalledWith(
      expect.any(Array),
      "INV-2026-0042-Container-Reconciliation.zip",
      "application/zip"
    );
    expect(result).toEqual({
      fileName: "INV-2026-0042-Container-Reconciliation.zip",
      containerFileCount: 2
    });
  });
});
