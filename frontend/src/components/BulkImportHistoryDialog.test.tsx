import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", () => ({
  api: {
    getBulkImportBatches: vi.fn(),
    downloadBulkImportBatchFile: vi.fn()
  }
}));

import { api } from "../lib/api";
import { renderWithProviders } from "../test/renderWithProviders";
import { BulkImportHistoryDialog } from "./BulkImportHistoryDialog";

const mockedApi = api as unknown as {
  getBulkImportBatches: ReturnType<typeof vi.fn>;
  downloadBulkImportBatchFile: ReturnType<typeof vi.fn>;
};

function retainedBatch(id: number, sourceFileName = "receipts.xlsx") {
  return {
    id,
    importId: String(id).padStart(32, "0"),
    importType: "INBOUND",
    customerId: 1,
    customerName: "Able Pack",
    sourceFileName,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    fileSizeBytes: 2048,
    fileSha256: "hash",
    status: "COMPLETED",
    totalDocuments: 1,
    validDocuments: 1,
    invalidDocuments: 0,
    totalLines: 2,
    createdDocuments: 1,
    failedDocuments: 0,
    errorMessage: "",
    createdByUserId: 7,
    createdByName: "Warehouse User",
    createdByEmail: "warehouse@example.com",
    committedAt: "2026-07-27T15:00:00Z",
    createdAt: "2026-07-27T14:59:00Z",
    updatedAt: "2026-07-27T15:00:00Z",
    documents: []
  };
}

describe("BulkImportHistoryDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.getBulkImportBatches.mockResolvedValue([retainedBatch(41)]);
    mockedApi.downloadBulkImportBatchFile.mockResolvedValue({
      blob: new Blob(["xlsx"]),
      fileName: "receipts.xlsx"
    });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:retained-import") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  });

  it("shows retained provenance and downloads the original workbook", async () => {
    renderWithProviders(<BulkImportHistoryDialog open importType="INBOUND" onClose={vi.fn()} />);

    expect(await screen.findByText("receipts.xlsx")).toBeInTheDocument();
    expect(screen.getByText("Able Pack")).toBeInTheDocument();
    expect(screen.getByText(/Uploaded by: Warehouse User/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download original" }));

    await waitFor(() => expect(mockedApi.downloadBulkImportBatchFile).toHaveBeenCalledWith(41));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("loads older retained imports with an id cursor", async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => retainedBatch(100 - index, `receipts-${index + 1}.xlsx`));
    mockedApi.getBulkImportBatches
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([retainedBatch(50, "older-receipts.xlsx")]);

    renderWithProviders(<BulkImportHistoryDialog open importType="INBOUND" onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));

    await waitFor(() => expect(mockedApi.getBulkImportBatches).toHaveBeenLastCalledWith("INBOUND", 50, undefined, 51));
    expect(await screen.findByText("older-receipts.xlsx")).toBeInTheDocument();
  });
});
