import { downloadExcelWorkbook, type ExcelExportColumn } from "./excelExport";
import type { Location } from "./types";

export const INBOUND_BULK_IMPORT_TEMPLATE_COLUMNS: ExcelExportColumn[] = [
  { key: "documentKey", label: "Document Key" },
  { key: "containerNo", label: "Container No" },
  { key: "warehouse", label: "Warehouse" },
  { key: "actualArrivalDate", label: "Actual Arrival Date" },
  { key: "containerType", label: "Container Type" },
  { key: "handlingMode", label: "Handling Mode" },
  { key: "sku", label: "SKU" },
  { key: "itemNumber", label: "Item Code" },
  { key: "description", label: "Description" },
  { key: "expectedQty", label: "Expected Qty", numberFormat: "number" },
  { key: "receivedQty", label: "Received Qty", numberFormat: "number" },
  { key: "pallets", label: "Pallets", numberFormat: "number" },
  { key: "unitsPerPallet", label: "CTN per Pallet", numberFormat: "number" },
  { key: "storageSection", label: "Storage Section" },
  { key: "lineNote", label: "Line Note" }
];

export function downloadInboundBulkImportTemplate() {
  downloadExcelWorkbook({
    title: "Inbound Receipt Bulk Import Template",
    sheetName: "Inbound Receipts",
    fileName: "inbound-receipt-bulk-import-template",
    columns: INBOUND_BULK_IMPORT_TEMPLATE_COLUMNS,
    rows: []
  });
}

export function downloadInboundBulkImportSample(locations: Location[]) {
  downloadExcelWorkbook({
    title: "Inbound Receipt Bulk Import Sample",
    sheetName: "Inbound Receipts",
    fileName: "inbound-receipt-bulk-import-sample",
    columns: INBOUND_BULK_IMPORT_TEMPLATE_COLUMNS,
    rows: buildInboundBulkImportSampleRows(locations)
  });
}

export function buildInboundBulkImportSampleRows(locations: Location[]) {
  const firstLocation = locations[0];
  const secondLocation = locations[1] ?? firstLocation;
  if (!firstLocation || !secondLocation) return [];

  const date = formatLocalDate(new Date());
  const token = Date.now().toString(36).toUpperCase();
  const firstSection = firstLocation.sectionNames.find((section) => section.trim()) || "TEMP";
  const secondSection = secondLocation.sectionNames.find((section) => section.trim()) || "TEMP";

  return [
    {
      documentKey: `SAMPLE-RECEIPT-A-${token}`,
      containerNo: `SAMPLE-CONT-A-${token}`,
      warehouse: firstLocation.name,
      actualArrivalDate: date,
      containerType: "NORMAL",
      handlingMode: "PALLETIZED",
      sku: `SAMPLE-SKU-A1-${token}`,
      itemNumber: "",
      description: "Sample cartons A1",
      expectedQty: 100,
      receivedQty: 96,
      pallets: 4,
      unitsPerPallet: 24,
      storageSection: firstSection,
      lineNote: "First SKU line in receipt A"
    },
    {
      documentKey: `SAMPLE-RECEIPT-A-${token}`,
      containerNo: `SAMPLE-CONT-A-${token}`,
      warehouse: firstLocation.name,
      actualArrivalDate: date,
      containerType: "NORMAL",
      handlingMode: "PALLETIZED",
      sku: `SAMPLE-SKU-A2-${token}`,
      itemNumber: "",
      description: "Sample cartons A2",
      expectedQty: 60,
      receivedQty: 60,
      pallets: 2,
      unitsPerPallet: 30,
      storageSection: firstSection,
      lineNote: "Second SKU line grouped into receipt A"
    },
    {
      documentKey: `SAMPLE-RECEIPT-B-${token}`,
      containerNo: `SAMPLE-CONT-B-${token}`,
      warehouse: secondLocation.name,
      actualArrivalDate: date,
      containerType: "NORMAL",
      handlingMode: "PALLETIZED",
      sku: `SAMPLE-SKU-B1-${token}`,
      itemNumber: "",
      description: "Sample cartons B1",
      expectedQty: 48,
      receivedQty: 48,
      pallets: 3,
      unitsPerPallet: 16,
      storageSection: secondSection,
      lineNote: "Receipt B demonstrates another warehouse"
    }
  ];
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
