import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  api: {
    previewInboundBulkImport: vi.fn(),
    revalidateInboundBulkImport: vi.fn(),
    commitInboundBulkImport: vi.fn()
  }
}));

vi.mock("../lib/inboundBulkImportTemplate", () => ({
  downloadInboundBulkImportTemplate: vi.fn(),
  downloadInboundBulkImportSample: vi.fn()
}));

import { api } from "../lib/api";
import { downloadInboundBulkImportSample, downloadInboundBulkImportTemplate } from "../lib/inboundBulkImportTemplate";
import type { InboundBulkImportPreview } from "../lib/types";
import { createCustomer, createLocation } from "../test/fixtures";
import { renderWithProviders } from "../test/renderWithProviders";
import { InboundBulkImportDialog } from "./InboundBulkImportDialog";

const mockedApi = api as unknown as {
  previewInboundBulkImport: ReturnType<typeof vi.fn>;
  revalidateInboundBulkImport: ReturnType<typeof vi.fn>;
  commitInboundBulkImport: ReturnType<typeof vi.fn>;
};

describe("InboundBulkImportDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("validates a workbook and submits only valid receipts as drafts", async () => {
    const onImported = vi.fn();
    const preview = createPreview();
    mockedApi.previewInboundBulkImport.mockResolvedValue(preview);
    mockedApi.commitInboundBulkImport.mockResolvedValue({
      sourceFileName: "receipts.xlsx",
      totalDocuments: 1,
      createdDocuments: 1,
      failedDocuments: 0,
      results: [{ documentKey: "CONT-A", containerNo: "CONT-A", success: true, document: { id: 42 } }]
    });

    const { container } = renderWithProviders(
      <InboundBulkImportDialog
        open
        customers={[createCustomer()]}
        locations={[createLocation()]}
        onClose={vi.fn()}
        onImported={onImported}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Blank template" }));
    fireEvent.click(screen.getByRole("button", { name: "Sample workbook" }));
    expect(screen.getByText("Historical receipts supported")).toBeInTheDocument();
    expect(downloadInboundBulkImportTemplate).toHaveBeenCalledTimes(1);
    expect(downloadInboundBulkImportSample).toHaveBeenCalledWith([expect.objectContaining({ name: "NJ" })]);

    const input = container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["workbook"], "receipts.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Validate workbook" }));

    await screen.findByText("CONT-A");
    expect(mockedApi.previewInboundBulkImport).toHaveBeenCalledWith(file, 1);
    expect(screen.getByText(/NJ Warehouse/)).toBeInTheDocument();
    expect(screen.getByText(/Actual Arrival Date: 2025-12-15/)).toBeInTheDocument();
    expect(screen.queryByText(/Document Key/)).not.toBeInTheDocument();
    expect(screen.getByText("1", { selector: ".bulk-inbound-metric--success strong" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create 1 drafts" }));
    await screen.findByText("Batch import complete");

    expect(mockedApi.commitInboundBulkImport).toHaveBeenCalledWith(expect.objectContaining({
      importId: "0123456789abcdef0123456789abcdef",
      customerId: 1,
      documents: [{ documentKey: "CONT-A", input: preview.documents[0].input }]
    }));
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Draft receipt #42 created")).toBeInTheDocument();
  });

  it("blocks submission when every receipt has validation errors", async () => {
    const invalidPreview = createPreview();
    invalidPreview.validDocuments = 0;
    invalidPreview.invalidDocuments = 1;
    invalidPreview.documents[0].valid = false;
    invalidPreview.documents[0].issues = [{ severity: "ERROR", code: "MISSING_SKU", message: "UPC is required.", rowNumber: 4 }];
    mockedApi.previewInboundBulkImport.mockResolvedValue(invalidPreview);

    const { container } = renderWithProviders(
      <InboundBulkImportDialog
        open
        customers={[createCustomer()]}
        locations={[createLocation()]}
        onClose={vi.fn()}
        onImported={vi.fn()}
      />
    );
    const input = container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["workbook"], "receipts.xlsx")] } });
    fireEvent.click(screen.getByRole("button", { name: "Validate workbook" }));

    await screen.findByText(/UPC is required\./);
    const commitButton = screen.getByRole("button", { name: "Create 0 drafts" });
    expect(commitButton).toBeDisabled();
    fireEvent.click(commitButton);
    await waitFor(() => expect(mockedApi.commitInboundBulkImport).not.toHaveBeenCalled());
  });

  it("shows the exact SKU and Item Code values involved in catalog conflicts", async () => {
    const invalidPreview = createPreview();
    invalidPreview.validDocuments = 0;
    invalidPreview.invalidDocuments = 1;
    invalidPreview.documents[0].valid = false;
    invalidPreview.documents[0].input.lines[0].sku = "SKU-2";
    invalidPreview.documents[0].input.lines[0].itemNumber = "ITEM-1";
    invalidPreview.documents[0].issues = [
      {
        severity: "ERROR",
        code: "ITEM_CODE_SKU_CONFLICT",
        message: "Item Code ITEM-1 is already linked to SKU SKU-1.",
        rowNumber: 4,
        currentSku: "SKU-2",
        currentItemCode: "ITEM-1",
        existingSku: "SKU-1"
      },
      {
        severity: "ERROR",
        code: "SKU_ITEM_CODE_MISMATCH",
        message: "SKU SKU-2 already uses Item Code ITEM-2.",
        rowNumber: 4,
        currentSku: "SKU-2",
        currentItemCode: "ITEM-1",
        existingItemCode: "ITEM-2"
      }
    ];
    mockedApi.previewInboundBulkImport.mockResolvedValue(invalidPreview);

    const { container } = renderWithProviders(
      <InboundBulkImportDialog
        open
        customers={[createCustomer()]}
        locations={[createLocation()]}
        onClose={vi.fn()}
        onImported={vi.fn()}
      />
    );
    const input = container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["workbook"], "receipts.xlsx")] } });
    fireEvent.click(screen.getByRole("button", { name: "Validate workbook" }));

    expect(await screen.findByText(/Item Code ITEM-1 is assigned to UPC SKU-1, not the UPC SKU-2 entered on this row/)).toBeInTheDocument();
    expect(screen.getByText(/UPC SKU-2 is assigned Item Code ITEM-2, but this row contains ITEM-1/)).toBeInTheDocument();
  });

  it("allows preview edits and requires backend revalidation before import", async () => {
    const initialPreview = createPreview();
    initialPreview.validDocuments = 0;
    initialPreview.invalidDocuments = 1;
    initialPreview.documents[0].valid = false;
    initialPreview.documents[0].input.lines[0].sku = "";
    initialPreview.documents[0].issues = [{ severity: "ERROR", code: "MISSING_SKU", message: "UPC is required.", rowNumber: 4 }];
    const revalidatedPreview = createPreview();
    revalidatedPreview.documents[0].input.lines[0].sku = "SKU-FIXED";
    revalidatedPreview.documents[0].issues = [];
    mockedApi.previewInboundBulkImport.mockResolvedValue(initialPreview);
    mockedApi.revalidateInboundBulkImport.mockResolvedValue(revalidatedPreview);

    const { container } = renderWithProviders(
      <InboundBulkImportDialog
        open
        customers={[createCustomer()]}
        locations={[createLocation()]}
        onClose={vi.fn()}
        onImported={vi.fn()}
      />
    );
    const fileInput = container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(["workbook"], "receipts.xlsx")] } });
    fireEvent.click(screen.getByRole("button", { name: "Validate workbook" }));

    const skuInput = await screen.findByRole("textbox", { name: "UPC 1" });
    fireEvent.change(skuInput, { target: { value: "SKU-FIXED" } });
    expect(screen.getByText("Preview data was changed. Revalidate the changes before creating drafts.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create 0 drafts" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Revalidate changes" }));
    await waitFor(() => expect(mockedApi.revalidateInboundBulkImport).toHaveBeenCalledWith(expect.objectContaining({
      importId: initialPreview.importId,
      documents: [expect.objectContaining({
        documentKey: "CONT-A",
        input: expect.objectContaining({ lines: [expect.objectContaining({ sku: "SKU-FIXED" })] })
      })]
    })));
    expect(await screen.findByRole("button", { name: "Create 1 drafts" })).toBeEnabled();
  });
});

function createPreview(): InboundBulkImportPreview {
  return {
    importId: "0123456789abcdef0123456789abcdef",
    sourceFileName: "receipts.xlsx",
    customerId: 1,
    customerName: "Imperial Bag & Paper",
    locationCount: 1,
    totalDocuments: 1,
    validDocuments: 1,
    invalidDocuments: 0,
    totalLines: 1,
    documents: [{
      documentKey: "CONT-A",
      locationName: "NJ Warehouse",
      rowNumbers: [4],
      input: {
        customerId: 1,
        locationId: 1,
        containerNo: "CONT-A",
        actualArrivalDate: "2025-12-15",
        status: "DRAFT",
        trackingStatus: "SCHEDULED",
        handlingMode: "PALLETIZED",
        containerType: "NORMAL",
        storageSection: "A",
        lines: [{
          sku: "SKU-1",
          itemNumber: "ITEM-1",
          description: "Item one",
          expectedQty: 930,
          receivedQty: 900,
          pallets: 20,
          unitsPerPallet: 48,
          storageSection: "A"
        }]
      },
      issues: [{ severity: "WARNING", code: "EXISTING_CONTAINER", message: "Existing container" }],
      valid: true,
      totalLines: 1,
      totalExpectedQty: 930,
      totalReceivedQty: 900,
      totalPallets: 20
    }]
  };
}
