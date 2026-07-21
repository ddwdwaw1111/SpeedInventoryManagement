import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./excelExport", () => ({
  downloadExcelWorkbook: vi.fn()
}));

import { downloadExcelWorkbook } from "./excelExport";
import { downloadOutboundBulkImportSample } from "./outboundBulkImportTemplate";
import { createItem, createLocation } from "../test/fixtures";

describe("outboundBulkImportTemplate", () => {
  beforeEach(() => {
    vi.mocked(downloadExcelWorkbook).mockReset();
  });

  it("uses unreserved pallet availability in the sample workbook", () => {
    downloadOutboundBulkImportSample([
      createItem({
        availableQty: 5,
        pallets: 3,
        allocatedPallets: 3,
        availablePallets: 0
      })
    ], [createLocation()], new Date(2026, 6, 13));

    const options = vi.mocked(downloadExcelWorkbook).mock.calls[0]?.[0];
    expect(options?.rows[0]).toMatchObject({
      quantity: 5,
      inventoryPallets: 1,
      outboundPallets: 1
    });
  });
});
