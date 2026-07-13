import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  api: {
    previewOutboundBulkImport: vi.fn(),
    revalidateOutboundBulkImport: vi.fn(),
    commitOutboundBulkImport: vi.fn()
  }
}));

vi.mock("../lib/outboundBulkImportTemplate", () => ({
  downloadOutboundBulkImportTemplate: vi.fn(),
  downloadOutboundBulkImportSample: vi.fn()
}));

import { api } from "../lib/api";
import type { OutboundBulkImportPreview } from "../lib/types";
import { createCustomer, createItem, createLocation } from "../test/fixtures";
import { renderWithProviders } from "../test/renderWithProviders";
import { OutboundBulkImportDialog } from "./OutboundBulkImportDialog";

const mockedApi = api as unknown as {
  previewOutboundBulkImport: ReturnType<typeof vi.fn>;
  revalidateOutboundBulkImport: ReturnType<typeof vi.fn>;
  commitOutboundBulkImport: ReturnType<typeof vi.fn>;
};

describe("OutboundBulkImportDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("validates, edits, revalidates, and creates outbound drafts", async () => {
    const preview = createPreview();
    mockedApi.previewOutboundBulkImport.mockResolvedValue(preview);
    mockedApi.revalidateOutboundBulkImport.mockImplementation(async (payload) => payloadToPreview(payload));
    mockedApi.commitOutboundBulkImport.mockResolvedValue({
      sourceFileName: "shipments.xlsx",
      totalDocuments: 1,
      createdDocuments: 1,
      failedDocuments: 0,
      results: [{ documentKey: "PL-100", packingListNo: "PL-100", success: true, document: { id: 99 } }]
    });
    const onImported = vi.fn();
    const { container } = renderWithProviders(<OutboundBulkImportDialog open customers={[createCustomer()]} locations={[createLocation()]} items={[createItem()]} onClose={vi.fn()} onImported={onImported} />);

    const file = new File(["workbook"], "shipments.xlsx");
    fireEvent.change(container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Validate workbook" }));

    expect(await screen.findByText("PL-100")).toBeInTheDocument();
    expect(mockedApi.previewOutboundBulkImport).toHaveBeenCalledWith(file, 1);
    fireEvent.change(screen.getByDisplayValue("CONT-A"), { target: { value: "CONT-B" } });
    expect(screen.getByRole("button", { name: "Create 1 drafts" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Revalidate changes" }));
    await waitFor(() => expect(mockedApi.revalidateOutboundBulkImport).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole("button", { name: "Create 1 drafts" }));
    await screen.findByText("Draft shipment #99 created");
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it("clears a previously selected workbook when its replacement is invalid", () => {
    const { container } = renderWithProviders(<OutboundBulkImportDialog open customers={[createCustomer()]} locations={[createLocation()]} items={[createItem()]} onClose={vi.fn()} onImported={vi.fn()} />);
    const fileInput = container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(fileInput, { target: { files: [new File(["valid"], "shipments.xlsx")] } });
    expect(screen.getByRole("button", { name: "Validate workbook" })).toBeEnabled();

    fireEvent.change(fileInput, { target: { files: [new File(["invalid"], "shipments.csv")] } });
    expect(screen.getByText("Please select an .xlsx workbook.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Validate workbook" })).toBeDisabled();
  });

  it("normalizes edited Qty and Pallets to whole numbers before revalidation", async () => {
    mockedApi.previewOutboundBulkImport.mockResolvedValue(createPreview());
    mockedApi.revalidateOutboundBulkImport.mockImplementation(async (payload) => payloadToPreview(payload));
    const { container } = renderWithProviders(<OutboundBulkImportDialog open customers={[createCustomer()]} locations={[createLocation()]} items={[createItem()]} onClose={vi.fn()} onImported={vi.fn()} />);
    const fileInput = container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(["workbook"], "shipments.xlsx")] } });
    fireEvent.click(screen.getByRole("button", { name: "Validate workbook" }));

    const quantityInput = await screen.findByDisplayValue("5");
    const palletsInput = screen.getByDisplayValue("2");
    fireEvent.change(quantityInput, { target: { value: "1.9" } });
    fireEvent.change(palletsInput, { target: { value: "3.7" } });
    expect(quantityInput).toHaveValue(1);
    expect(palletsInput).toHaveValue(3);
    fireEvent.click(screen.getByRole("button", { name: "Revalidate changes" }));

    await waitFor(() => expect(mockedApi.revalidateOutboundBulkImport).toHaveBeenCalledWith(expect.objectContaining({
      documents: [expect.objectContaining({ lines: [expect.objectContaining({ quantity: 1, pallets: 3 })] })]
    })));
  });

  it("renders the outbound import flow and validation issues in Chinese", async () => {
    window.localStorage.setItem("sim-language", "zh");
    const preview = createPreview();
    preview.validDocuments = 0;
    preview.invalidDocuments = 1;
    preview.documents[0].valid = false;
    preview.documents[0].issues = [{ severity: "ERROR", code: "INSUFFICIENT_STOCK", message: "Available stock is insufficient.", rowNumber: 4 }];
    mockedApi.previewOutboundBulkImport.mockResolvedValue(preview);
    const { container } = renderWithProviders(<OutboundBulkImportDialog open customers={[createCustomer()]} locations={[createLocation()]} items={[createItem()]} onClose={vi.fn()} onImported={vi.fn()} />);

    expect(screen.getByText("批量导入出货单")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "空白模板" })).toBeInTheDocument();
    const fileInput = container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(["workbook"], "shipments.xlsx")] } });
    fireEvent.click(screen.getByRole("button", { name: "校验工作簿" }));

    expect(await screen.findByText(/当前行和工作簿前序行使用的可用库存不足/)).toBeInTheDocument();
    expect(screen.getByText("Item Code（仅供参考）")).toBeInTheDocument();
  });
});

function createPreview(): OutboundBulkImportPreview {
  return {
    importId: "0123456789abcdef0123456789abcdef",
    sourceFileName: "shipments.xlsx",
    customerId: 1,
    customerName: "Imperial Bag & Paper",
    locationCount: 1,
    totalDocuments: 1,
    validDocuments: 1,
    invalidDocuments: 0,
    totalLines: 1,
    documents: [{
      documentKey: "PL-100",
      packingListNo: "PL-100",
      orderRef: "ORDER-1",
      expectedShipDate: "2026-07-15",
      actualShipDate: "",
      shipToName: "Buyer",
      shipToAddress: "100 Main St",
      shipToContact: "Dock",
      carrierName: "Carrier",
      rowNumbers: [4],
      lines: [{ rowNumber: 4, warehouse: "NJ", sourceContainer: "CONT-A", storageSection: "TEMP", sku: "608333", itemNumber: "608333", quantity: 5, pallets: 2, lineNote: "" }],
      input: {
        packingListNo: "PL-100",
        orderRef: "ORDER-1",
        expectedShipDate: "2026-07-15",
        status: "DRAFT",
        trackingStatus: "SCHEDULED",
        lines: [{ customerId: 1, locationId: 1, skuMasterId: 1, quantity: 5, pallets: 2, pickAllocations: [{ locationId: 1, storageSection: "TEMP", containerNo: "CONT-A", allocatedQty: 5, pallets: 2 }] }]
      },
      issues: [],
      valid: true,
      totalLines: 1,
      totalQty: 5,
      totalPallets: 2
    }]
  };
}

function payloadToPreview(payload: { documents: OutboundBulkImportPreview["documents"] }) {
  const preview = createPreview();
  preview.documents = payload.documents;
  preview.documents[0].valid = true;
  preview.documents[0].issues = [];
  return preview;
}
