import { downloadExcelWorkbook, type ExcelExportColumn } from "./excelExport";
import type { Item, Location } from "./types";

export const OUTBOUND_BULK_IMPORT_TEMPLATE_COLUMNS: ExcelExportColumn[] = [
  { key: "packingListNo", label: "Packing List No" },
  { key: "orderRef", label: "Order Ref" },
  { key: "expectedShipDate", label: "Expected Ship Date" },
  { key: "actualShipDate", label: "Actual Ship Date" },
  { key: "shipToName", label: "Ship To Name" },
  { key: "shipToAddress", label: "Ship To Address" },
  { key: "shipToContact", label: "Ship To Contact" },
  { key: "carrierName", label: "Carrier Name" },
  { key: "warehouse", label: "Warehouse" },
  { key: "sourceContainer", label: "Source Container" },
  { key: "storageSection", label: "Storage Section" },
  { key: "sku", label: "SKU" },
  { key: "itemNumber", label: "Item Code (Reference)" },
  { key: "quantity", label: "Qty", numberFormat: "number" },
  { key: "pallets", label: "Pallets", numberFormat: "number" },
  { key: "lineNote", label: "Line Note" }
];

export function downloadOutboundBulkImportTemplate() {
  downloadExcelWorkbook({
    title: "Outbound Shipment Bulk Import Template",
    sheetName: "Outbound Shipments",
    fileName: "outbound-shipment-bulk-import-template",
    columns: OUTBOUND_BULK_IMPORT_TEMPLATE_COLUMNS,
    rows: []
  });
}

export function downloadOutboundBulkImportSample(items: Item[], locations: Location[], referenceDate = new Date()) {
  const eligible = items.filter((item) => item.availableQty > 0).slice(0, 3);
  const fallbackLocation = locations[0];
  const token = Date.now().toString(36).toUpperCase();
  const shipDate = formatLocalDate(referenceDate);
  const rows = eligible.length > 0 ? eligible.map((item, index) => ({
    packingListNo: `SAMPLE-PL-${token}`,
    orderRef: `SAMPLE-ORDER-${token}`,
    expectedShipDate: shipDate,
    actualShipDate: "",
    shipToName: "Sample B2B Customer",
    shipToAddress: "100 Sample Street",
    shipToContact: "Receiving Dock",
    carrierName: "Sample Carrier",
    warehouse: item.locationName,
    sourceContainer: item.containerNo,
    storageSection: item.storageSection,
    sku: item.sku,
    itemNumber: item.itemNumber,
    quantity: Math.max(1, Math.min(item.availableQty, index === 0 ? 10 : 5)),
    pallets: item.pallets > 0 ? 1 : 0,
    lineNote: "Sample outbound line"
  })) : fallbackLocation ? [{
    packingListNo: `SAMPLE-PL-${token}`,
    orderRef: `SAMPLE-ORDER-${token}`,
    expectedShipDate: shipDate,
    actualShipDate: "",
    shipToName: "Sample B2B Customer",
    shipToAddress: "100 Sample Street",
    shipToContact: "Receiving Dock",
    carrierName: "Sample Carrier",
    warehouse: fallbackLocation.name,
    sourceContainer: "",
    storageSection: fallbackLocation.sectionNames[0] || "TEMP",
    sku: "REPLACE-WITH-EXISTING-SKU",
    itemNumber: "",
    quantity: 10,
    pallets: 1,
    lineNote: "Replace SKU before testing"
  }] : [];
  downloadExcelWorkbook({
    title: "Outbound Shipment Bulk Import Sample",
    sheetName: "Outbound Shipments",
    fileName: "outbound-shipment-bulk-import-sample",
    columns: OUTBOUND_BULK_IMPORT_TEMPLATE_COLUMNS,
    rows
  });
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
