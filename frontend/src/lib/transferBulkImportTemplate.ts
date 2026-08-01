import { downloadExcelWorkbook, type ExcelExportColumn } from "./excelExport";
import type { Item, Location } from "./types";

export const TRANSFER_BULK_IMPORT_TEMPLATE_COLUMNS: ExcelExportColumn[] = [
  { key: "transferNo", label: "Transfer No" },
  { key: "transferMode", label: "Transfer Mode" },
  { key: "transferDate", label: "Transfer Date" },
  { key: "containerNo", label: "Container No" },
  { key: "fromWarehouse", label: "From Warehouse" },
  { key: "fromStorageSection", label: "From Storage Section" },
  { key: "toWarehouse", label: "To Warehouse" },
  { key: "toStorageSection", label: "To Storage Section" },
  { key: "sku", label: "UPC" },
  { key: "itemCode", label: "Item Code" },
  { key: "quantity", label: "Transfer Qty", numberFormat: "number" },
  { key: "sourcePallets", label: "Source Inventory Pallets Released", numberFormat: "number" },
  { key: "destinationPallets", label: "Destination Inventory Pallets Created", numberFormat: "number" }
];

export function downloadBulkTransferImportTemplate() {
  downloadExcelWorkbook({
    title: "Container Transfer Bulk Import Template",
    sheetName: "Container Transfers",
    fileName: "container-transfer-bulk-import-template",
    columns: TRANSFER_BULK_IMPORT_TEMPLATE_COLUMNS,
    rows: []
  });
}

export function downloadBulkTransferImportSample(items: Item[], locations: Location[], referenceDate = new Date()) {
  const container = items.find((item) => item.containerNo.trim() && item.availableQty > 0);
  const fromWarehouse = container?.locationName || locations[0]?.name || "Source Warehouse";
  const toWarehouse = locations.find((location) => location.name !== fromWarehouse)?.name || "Destination Warehouse";
  downloadExcelWorkbook({
    title: "Container Transfer Bulk Import Sample",
    sheetName: "Container Transfers",
    fileName: "container-transfer-bulk-import-sample",
    columns: TRANSFER_BULK_IMPORT_TEMPLATE_COLUMNS,
    rows: [{
      transferNo: "",
      transferMode: "PARTIAL",
      transferDate: formatLocalDate(referenceDate),
      containerNo: container?.containerNo || "REPLACE-WITH-CONTAINER-NO",
      fromWarehouse,
      fromStorageSection: container?.storageSection || "TEMP",
      toWarehouse,
      toStorageSection: "TEMP",
      sku: container?.sku || "REPLACE-WITH-UPC",
      itemCode: container?.itemNumber || "",
      quantity: container ? Math.max(1, Math.min(container.availableQty, 10)) : 10,
      sourcePallets: 0,
      destinationPallets: 0
    }]
  });
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
