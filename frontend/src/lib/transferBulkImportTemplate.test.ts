import { describe, expect, it } from "vitest";

import { TRANSFER_BULK_IMPORT_TEMPLATE_COLUMNS } from "./transferBulkImportTemplate";

describe("transfer bulk import template", () => {
  it("includes both modes and the independent pallet-side fields", () => {
    expect(TRANSFER_BULK_IMPORT_TEMPLATE_COLUMNS.map((column) => column.key)).toEqual([
      "transferNo",
      "transferMode",
      "transferDate",
      "containerNo",
      "fromWarehouse",
      "fromStorageSection",
      "toWarehouse",
      "toStorageSection",
      "sku",
      "itemCode",
      "quantity",
      "sourcePallets",
      "destinationPallets"
    ]);
  });
});
