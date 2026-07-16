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
      results: [{ documentKey: "PO-100", pickingOrderNo: "PO-100", success: true, document: { id: 99 }, transferLines: 1 }]
    });
    const onImported = vi.fn();
    const { container } = renderWithProviders(<OutboundBulkImportDialog open customers={[createCustomer()]} locations={[createLocation()]} items={[createItem()]} onClose={vi.fn()} onImported={onImported} />);

    const file = new File(["workbook"], "shipments.xlsx");
    fireEvent.change(container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Validate workbook" }));

    expect(await screen.findByText("PO-100")).toBeInTheDocument();
    expect(mockedApi.previewOutboundBulkImport).toHaveBeenCalledWith(file, 1);
    fireEvent.change(screen.getByDisplayValue("CONT-A"), { target: { value: "CONT-B" } });
    expect(screen.getByRole("button", { name: "Create 1 drafts" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Revalidate changes" }));
    await waitFor(() => expect(mockedApi.revalidateOutboundBulkImport).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole("button", { name: "Create 1 drafts" }));
    await screen.findByText("Draft shipment #99 created with 1 pending automatic transfer line(s)");
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

  it("renders a valid preview when the API returns a null issue list", async () => {
    const preview = createPreview();
    preview.documents[0].issues = null as unknown as OutboundBulkImportPreview["documents"][number]["issues"];
    mockedApi.previewOutboundBulkImport.mockResolvedValue(preview);
    const { container } = renderWithProviders(<OutboundBulkImportDialog open customers={[createCustomer()]} locations={[createLocation()]} items={[createItem()]} onClose={vi.fn()} onImported={vi.fn()} />);

    const fileInput = container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(["workbook"], "shipments.xlsx")] } });
    fireEvent.click(screen.getByRole("button", { name: "Validate workbook" }));

    expect(await screen.findByText("PO-100")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create 1 drafts" })).toBeEnabled();
  });

  it("normalizes Qty, Inventory Pallets, and Outbound Pallets independently before revalidation", async () => {
    mockedApi.previewOutboundBulkImport.mockResolvedValue(createPreview());
    mockedApi.revalidateOutboundBulkImport.mockImplementation(async (payload) => payloadToPreview(payload));
    const { container } = renderWithProviders(<OutboundBulkImportDialog open customers={[createCustomer()]} locations={[createLocation()]} items={[createItem()]} onClose={vi.fn()} onImported={vi.fn()} />);
    const fileInput = container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(["workbook"], "shipments.xlsx")] } });
    fireEvent.click(screen.getByRole("button", { name: "Validate workbook" }));

    const quantityInput = await screen.findByDisplayValue("5");
    const inventoryPalletsInput = screen.getByDisplayValue("2");
    const outboundPalletsInput = screen.getByDisplayValue("3");
    fireEvent.change(quantityInput, { target: { value: "1.9" } });
    fireEvent.change(inventoryPalletsInput, { target: { value: "4.7" } });
    fireEvent.change(outboundPalletsInput, { target: { value: "6.7" } });
    expect(quantityInput).toHaveValue(1);
    expect(inventoryPalletsInput).toHaveValue(4);
    expect(outboundPalletsInput).toHaveValue(6);
    fireEvent.click(screen.getByRole("button", { name: "Revalidate changes" }));

    await waitFor(() => expect(mockedApi.revalidateOutboundBulkImport).toHaveBeenCalledWith(expect.objectContaining({
      documents: [expect.objectContaining({ lines: [expect.objectContaining({ quantity: 1, inventoryPallets: 4, outboundPallets: 6 })] })]
    })));
  });

  it("renders the outbound import flow and validation issues in Chinese", async () => {
    window.localStorage.setItem("sim-language", "zh");
    const preview = createPreview();
    preview.validDocuments = 0;
    preview.invalidDocuments = 1;
    preview.documents[0].valid = false;
    preview.documents[0].issues = [{
      severity: "ERROR",
      code: "INSUFFICIENT_STOCK",
      message: "Available stock is insufficient.",
      rowNumber: 4,
      sku: "608333",
      warehouse: "NJ",
      sourceContainer: "CONT-A",
      storageSection: "TEMP",
      requestedQty: 5,
      availableQty: 2
    }];
    mockedApi.previewOutboundBulkImport.mockResolvedValue(preview);
    const { container } = renderWithProviders(<OutboundBulkImportDialog open customers={[createCustomer()]} locations={[createLocation()]} items={[createItem()]} onClose={vi.fn()} onImported={vi.fn()} />);

    expect(screen.getByText("批量导入出货单")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "空白模板" })).toBeInTheDocument();
    const fileInput = container.ownerDocument.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(["workbook"], "shipments.xlsx")] } });
    fireEvent.click(screen.getByRole("button", { name: "校验工作簿" }));

    expect(await screen.findByText(/SKU“608333”.*仅有 2 CTN 可用，但本行需要 5 CTN/)).toBeInTheDocument();
    expect(screen.getByText(/筛选范围：仓库“NJ”.*来源货柜“CONT-A”.*库区“TEMP”/)).toBeInTheDocument();
    expect(screen.getByText("Item Code（仅供参考）")).toBeInTheDocument();
  });
});

function createPreview(): OutboundBulkImportPreview {
  return {
    importId: "0123456789abcdef0123456789abcdef",
    sourceFileName: "shipments.xlsx",
    customerId: 1,
    customerName: "Imperial Bag & Paper",
    mainWarehouse: "308 Herrod Blvd",
    locationCount: 1,
    totalDocuments: 1,
    validDocuments: 1,
    invalidDocuments: 0,
    totalLines: 1,
    documents: [{
      documentKey: "PO-100",
      pickingOrderNo: "PO-100",
      expectedShipDate: "2026-07-15",
      actualShipDate: "",
      shipToName: "Buyer",
      shipToAddress: "100 Main St",
      shipToContact: "Dock",
      rowNumbers: [4],
      lines: [{ rowNumber: 4, warehouse: "NJ", sourceContainer: "CONT-A", storageSection: "TEMP", sku: "608333", itemNumber: "608333", quantity: 5, inventoryPallets: 2, outboundPallets: 3, lineNote: "", requiresTransfer: true, outboundWarehouse: "308 Herrod Blvd" }],
      input: {
        packingListNo: "PO-100",
        expectedShipDate: "2026-07-15",
        status: "DRAFT",
        trackingStatus: "SCHEDULED",
        lines: [{ customerId: 1, locationId: 1, skuMasterId: 1, quantity: 5, pallets: 3, pickAllocations: [{ locationId: 1, storageSection: "TEMP", containerNo: "CONT-A", allocatedQty: 5, pallets: 2 }] }]
      },
      issues: [],
      valid: true,
      totalLines: 1,
      totalQty: 5,
      totalInventoryPallets: 2,
      totalOutboundPallets: 3,
      transferLines: 1
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
