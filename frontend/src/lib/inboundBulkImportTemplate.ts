import { downloadExcelWorkbook, type ExcelExportColumn } from "./excelExport";
import type { Location } from "./types";

export const INBOUND_BULK_IMPORT_TEMPLATE_COLUMNS: ExcelExportColumn[] = [
  { key: "containerNo", label: "Container No" },
  { key: "warehouse", label: "Warehouse" },
  { key: "actualArrivalDate", label: "Actual Arrival Date" },
  { key: "containerType", label: "Container Type" },
  { key: "handlingMode", label: "Handling Mode" },
  { key: "sku", label: "UPC" },
  { key: "itemNumber", label: "Item Code" },
  { key: "description", label: "Description" },
  { key: "expectedQty", label: "Expected Qty", numberFormat: "number" },
  { key: "receivedQty", label: "Received Qty", numberFormat: "number" },
  { key: "pallets", label: "Pallets", numberFormat: "number" },
  { key: "inboundCtnsPerPallet", label: "CTN per Pallet", numberFormat: "number" },
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

export function buildInboundBulkImportSampleRows(locations: Location[], referenceDate = new Date()) {
  const firstLocation = locations[0];
  const secondLocation = locations[1] ?? firstLocation;
  if (!firstLocation || !secondLocation) return [];

  const firstReceiptDate = formatLocalDate(addLocalDays(referenceDate, -30));
  const secondReceiptDate = formatLocalDate(addLocalDays(referenceDate, -7));
  const token = Date.now().toString(36).toUpperCase();
  const firstSection = firstLocation.sectionNames.find((section) => section.trim()) || "TEMP";
  const secondSection = secondLocation.sectionNames.find((section) => section.trim()) || "TEMP";

  return [
    {
      containerNo: `SAMPLE-CONT-A-${token}`,
      warehouse: firstLocation.name,
      actualArrivalDate: firstReceiptDate,
      containerType: "NORMAL",
      handlingMode: "PALLETIZED",
      sku: `SAMPLE-UPC-A1-${token}`,
      itemNumber: "",
      description: "Sample cartons A1",
      expectedQty: 100,
      receivedQty: 96,
      pallets: 4,
      inboundCtnsPerPallet: 24,
      storageSection: firstSection,
      lineNote: "First UPC line in receipt A"
    },
    {
      containerNo: `SAMPLE-CONT-A-${token}`,
      warehouse: firstLocation.name,
      actualArrivalDate: firstReceiptDate,
      containerType: "NORMAL",
      handlingMode: "PALLETIZED",
      sku: `SAMPLE-UPC-A2-${token}`,
      itemNumber: "",
      description: "Sample cartons A2",
      expectedQty: 60,
      receivedQty: 60,
      pallets: 2,
      inboundCtnsPerPallet: 30,
      storageSection: firstSection,
      lineNote: "Second UPC line grouped into receipt A"
    },
    {
      containerNo: `SAMPLE-CONT-B-${token}`,
      warehouse: secondLocation.name,
      actualArrivalDate: secondReceiptDate,
      containerType: "NORMAL",
      handlingMode: "PALLETIZED",
      sku: `SAMPLE-UPC-B1-${token}`,
      itemNumber: "",
      description: "Sample cartons B1",
      expectedQty: 48,
      receivedQty: 48,
      pallets: 3,
      inboundCtnsPerPallet: 16,
      storageSection: secondSection,
      lineNote: "Receipt B demonstrates another warehouse"
    }
  ];
}

function addLocalDays(date: Date, days: number) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() + days);
  return result;
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
