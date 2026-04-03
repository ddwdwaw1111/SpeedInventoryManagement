import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import MoveToInboxOutlinedIcon from "@mui/icons-material/MoveToInboxOutlined";
import OutboxOutlinedIcon from "@mui/icons-material/OutboxOutlined";
import WarehouseOutlinedIcon from "@mui/icons-material/WarehouseOutlined";
import { Button } from "@mui/material";
import { useMemo, useState, type ReactNode } from "react";

import { formatDateValue } from "../lib/dates";
import { downloadExcelWorkbook, type ExcelExportCell, type ExcelExportColumn } from "../lib/excelExport";
import { useI18n } from "../lib/i18n";
import type { PageKey } from "../lib/routes";
import { DEFAULT_STORAGE_SECTION, normalizeStorageSection, type InboundDocument, type Item, type OutboundDocument } from "../lib/types";
import { ExportExcelDialog } from "./ExportExcelDialog";
import { WorkspacePanelHeader } from "./WorkspacePanelChrome";

type ExportCenterPageProps = {
  items: Item[];
  inboundDocuments: InboundDocument[];
  outboundDocuments: OutboundDocument[];
  onNavigate: (page: PageKey) => void;
};

type ExportDataset = {
  key: string;
  title: string;
  description: string;
  rowCount: number;
  icon: ReactNode;
  sheetName: string;
  columns: ExcelExportColumn[];
  rows: Array<Record<string, ExcelExportCell>>;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

const INVENTORY_SUMMARY_EXPORT_COLUMNS = [
  { key: "itemNumber", label: "Item #" },
  { key: "sku", label: "SKU" },
  { key: "description", label: "Description" },
  { key: "customerName", label: "Customer" },
  { key: "onHand", label: "On Hand" },
  { key: "availableQty", label: "Available Qty" },
  { key: "damagedQty", label: "Damaged Qty" },
  { key: "warehouseCount", label: "Warehouse Count" },
  { key: "containerCount", label: "Container Count" },
  { key: "lastReceipt", label: "Last Receipt" }
] as const;

const INVENTORY_DETAIL_EXPORT_COLUMNS = [
  { key: "itemNumber", label: "Item #" },
  { key: "sku", label: "SKU" },
  { key: "description", label: "Description" },
  { key: "customerName", label: "Customer" },
  { key: "locationName", label: "Warehouse" },
  { key: "storageSection", label: "Pick Location" },
  { key: "quantity", label: "On Hand" },
  { key: "availableQty", label: "Available Qty" },
  { key: "damagedQty", label: "Damaged Qty" },
  { key: "reorderLevel", label: "Reorder Level" },
  { key: "deliveryDate", label: "Receipt Date" },
  { key: "containerNo", label: "Container No." }
] as const;

const CONTAINER_CONTENTS_EXPORT_COLUMNS = [
  { key: "containerNo", label: "Container No." },
  { key: "itemNumber", label: "Item #" },
  { key: "sku", label: "SKU" },
  { key: "description", label: "Description" },
  { key: "customerName", label: "Customer" },
  { key: "locationName", label: "Warehouse" },
  { key: "storageSection", label: "Pick Location" },
  { key: "onHand", label: "On Hand" },
  { key: "availableQty", label: "Available Qty" },
  { key: "damagedQty", label: "Damaged Qty" },
  { key: "holdQty", label: "On Hold Qty" },
  { key: "reorderLevel", label: "Reorder Level" },
  { key: "lastReceipt", label: "Last Receipt" }
] as const;

const RECEIPTS_EXPORT_COLUMNS = [
  { key: "deliveryDate", label: "Receipt Date" },
  { key: "containerNo", label: "Container No." },
  { key: "customerName", label: "Customer" },
  { key: "locationName", label: "Warehouse" },
  { key: "totalLines", label: "Total Lines" },
  { key: "totalExpectedQty", label: "Expected Qty" },
  { key: "totalReceivedQty", label: "Received Qty" },
  { key: "status", label: "Status" }
] as const;

const SHIPMENTS_EXPORT_COLUMNS = [
  { key: "packingListNo", label: "Packing List No." },
  { key: "orderRef", label: "Order Ref." },
  { key: "customerName", label: "Customer" },
  { key: "storages", label: "Warehouse" },
  { key: "outDate", label: "Ship Date" },
  { key: "shipToName", label: "Ship-to Name" },
  { key: "carrierName", label: "Carrier" },
  { key: "totalLines", label: "Total Lines" },
  { key: "totalQty", label: "Total Qty" },
  { key: "totalGrossWeightKgs", label: "Gross Weight (kg)" },
  { key: "status", label: "Status" }
] as const;

export function ExportCenterPage({
  items,
  inboundDocuments,
  outboundDocuments,
  onNavigate
}: ExportCenterPageProps) {
  const { t } = useI18n();
  const [selectedDatasetKey, setSelectedDatasetKey] = useState<string | null>(null);

  const datasets = useMemo<ExportDataset[]>(() => {
    const inventorySummaryRows = buildInventorySummaryExportRows(items);
    const inventoryDetailRows = buildInventoryDetailExportRows(items);
    const containerContentsRows = buildContainerContentsExportRows(items);
    const receiptRows = buildReceiptExportRows(inboundDocuments);
    const shipmentRows = buildShipmentExportRows(outboundDocuments);

    return [
      {
        key: "inventory-summary",
        title: "Inventory Summary",
        description: t("inventorySummaryDesc"),
        rowCount: inventorySummaryRows.length,
        icon: <WarehouseOutlinedIcon fontSize="small" />,
        sheetName: "Inventory Summary",
        columns: [...INVENTORY_SUMMARY_EXPORT_COLUMNS],
        rows: inventorySummaryRows
      },
      {
        key: "inventory-detail",
        title: "Inventory Detail",
        description: t("stockByLocationDesc"),
        rowCount: inventoryDetailRows.length,
        icon: <WarehouseOutlinedIcon fontSize="small" />,
        sheetName: "Inventory Detail",
        columns: [...INVENTORY_DETAIL_EXPORT_COLUMNS],
        rows: inventoryDetailRows
      },
      {
        key: "container-contents",
        title: "Container Contents",
        description: t("containerContentsDesc"),
        rowCount: containerContentsRows.length,
        icon: <WarehouseOutlinedIcon fontSize="small" />,
        sheetName: "Container Contents",
        columns: [...CONTAINER_CONTENTS_EXPORT_COLUMNS],
        rows: containerContentsRows
      },
      {
        key: "receipts",
        title: "Receipts",
        description: t("inboundDesc"),
        rowCount: receiptRows.length,
        icon: <MoveToInboxOutlinedIcon fontSize="small" />,
        sheetName: "Receipts",
        columns: [...RECEIPTS_EXPORT_COLUMNS],
        rows: receiptRows
      },
      {
        key: "shipments",
        title: "Shipments",
        description: t("outboundDesc"),
        rowCount: shipmentRows.length,
        icon: <OutboxOutlinedIcon fontSize="small" />,
        sheetName: "Shipments",
        columns: [...SHIPMENTS_EXPORT_COLUMNS],
        rows: shipmentRows
      }
    ];
  }, [inboundDocuments, items, outboundDocuments, t]);

  const selectedDataset = useMemo(
    () => datasets.find((dataset) => dataset.key === selectedDatasetKey) ?? null,
    [datasets, selectedDatasetKey]
  );

  function handleExport({ title, columns }: { title: string; columns: import("../lib/excelExport").ExcelExportColumn[] }) {
    if (!selectedDataset) {
      return;
    }

    downloadExcelWorkbook({
      title,
      sheetName: selectedDataset.sheetName,
      fileName: title,
      columns,
      rows: selectedDataset.rows
    });
    setSelectedDatasetKey(null);
  }

  return (
    <main className="workspace-main">
      <section className="workbook-panel workbook-panel--full export-center">
        <div className="tab-strip">
          <WorkspacePanelHeader
            title={t("exportCenter")}
            actions={(
              <div className="sheet-actions">
                <Button variant="outlined" onClick={() => onNavigate("reports")}>
                  {t("report")}
                </Button>
              </div>
            )}
          />
        </div>

        <div className="export-center__grid">
          {datasets.map((dataset) => (
            <article className="export-center__card" key={dataset.key}>
              <div className="export-center__card-copy">
                <div className="export-center__card-icon" aria-hidden="true">{dataset.icon}</div>
                <div>
                  <h3>{dataset.title}</h3>
                  <p>{dataset.description}</p>
                </div>
              </div>
              <div className="export-center__card-meta">
                <strong>{formatNumber(dataset.rowCount)}</strong>
                <span>{t("recordCount")}</span>
              </div>
              <div className="export-center__card-actions">
                <Button
                  variant="contained"
                  startIcon={<FileDownloadOutlinedIcon fontSize="small" />}
                  onClick={() => setSelectedDatasetKey(dataset.key)}
                  disabled={dataset.rowCount === 0}
                >
                  {t("exportExcel")}
                </Button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <ExportExcelDialog
        open={Boolean(selectedDataset)}
        defaultTitle={selectedDataset?.title ?? "Export"}
        defaultColumns={selectedDataset?.columns ?? []}
        onClose={() => setSelectedDatasetKey(null)}
        onExport={handleExport}
      />
    </main>
  );
}

function buildInventorySummaryExportRows(items: Item[]) {
  const rowMap = new Map<string, {
    itemNumber: string;
    sku: string;
    description: string;
    customerName: string;
    onHand: number;
    availableQty: number;
    damagedQty: number;
    warehouseIds: Set<number>;
    containers: Set<string>;
    lastReceipt: string | null;
  }>();

  for (const item of items) {
    const key = `${item.customerId}|${item.sku}`;
    const existing = rowMap.get(key);
    const containerKey = item.containerNo.trim() || `${item.locationName}/${normalizeStorageSection(item.storageSection)}`;
    const receiptDate = item.deliveryDate || item.lastRestockedAt || null;

    if (!existing) {
      rowMap.set(key, {
        itemNumber: item.itemNumber || "-",
        sku: item.sku,
        description: displayDescription(item),
        customerName: item.customerName,
        onHand: item.quantity,
        availableQty: item.availableQty,
        damagedQty: item.damagedQty,
        warehouseIds: new Set([item.locationId]),
        containers: new Set([containerKey]),
        lastReceipt: receiptDate
      });
      continue;
    }

    existing.onHand += item.quantity;
    existing.availableQty += item.availableQty;
    existing.damagedQty += item.damagedQty;
    existing.warehouseIds.add(item.locationId);
    existing.containers.add(containerKey);
    existing.lastReceipt = getLatestDate(existing.lastReceipt, receiptDate);
    if (existing.itemNumber === "-" && item.itemNumber) {
      existing.itemNumber = item.itemNumber;
    }
  }

  return [...rowMap.values()]
    .map((row) => ({
      itemNumber: row.itemNumber,
      sku: row.sku,
      description: row.description,
      customerName: row.customerName,
      onHand: row.onHand,
      availableQty: row.availableQty,
      damagedQty: row.damagedQty,
      warehouseCount: row.warehouseIds.size,
      containerCount: row.containers.size,
      lastReceipt: formatDateValue(row.lastReceipt, dateFormatter)
    }))
    .sort((left, right) => {
      if (left.customerName !== right.customerName) return left.customerName.localeCompare(right.customerName);
      return left.sku.localeCompare(right.sku);
    });
}

function buildInventoryDetailExportRows(items: Item[]) {
  return [...items]
    .map((item) => ({
      itemNumber: item.itemNumber || "-",
      sku: item.sku,
      description: displayDescription(item),
      customerName: item.customerName,
      locationName: item.locationName,
      storageSection: normalizeStorageSection(item.storageSection),
      quantity: item.quantity,
      availableQty: item.availableQty,
      damagedQty: item.damagedQty,
      reorderLevel: item.reorderLevel,
      deliveryDate: formatDateValue(item.deliveryDate, dateFormatter),
      containerNo: item.containerNo || "-",
    }))
    .sort((left, right) => {
      if (left.locationName !== right.locationName) return left.locationName.localeCompare(right.locationName);
      if (left.containerNo !== right.containerNo) return left.containerNo.localeCompare(right.containerNo);
      return left.sku.localeCompare(right.sku);
    });
}

function buildContainerContentsExportRows(items: Item[]) {
  return [...items]
    .filter((item) => item.containerNo.trim())
    .map((item) => ({
      containerNo: item.containerNo,
      itemNumber: item.itemNumber || "-",
      sku: item.sku,
      description: displayDescription(item),
      customerName: item.customerName,
      locationName: item.locationName,
      storageSection: normalizeStorageSection(item.storageSection),
      onHand: item.quantity,
      availableQty: item.availableQty,
      damagedQty: item.damagedQty,
      holdQty: item.holdQty,
      reorderLevel: item.reorderLevel,
      lastReceipt: formatDateValue(item.deliveryDate || item.lastRestockedAt || null, dateFormatter)
    }))
    .sort((left, right) => {
      if (left.containerNo !== right.containerNo) return left.containerNo.localeCompare(right.containerNo);
      if (left.customerName !== right.customerName) return left.customerName.localeCompare(right.customerName);
      return left.sku.localeCompare(right.sku);
    });
}

function buildReceiptExportRows(inboundDocuments: InboundDocument[]) {
  return inboundDocuments.map((document) => ({
    deliveryDate: formatDateValue(document.deliveryDate, dateFormatter),
    containerNo: document.containerNo || "-",
    customerName: document.customerName || "-",
    locationName: `${document.locationName} / ${summarizeInboundDocumentSections(document)}`,
    totalLines: document.totalLines,
    totalExpectedQty: document.totalExpectedQty,
    totalReceivedQty: document.totalReceivedQty,
    status: document.status
  }));
}

function buildShipmentExportRows(outboundDocuments: OutboundDocument[]) {
  return outboundDocuments.map((document) => ({
    packingListNo: document.packingListNo || "-",
    orderRef: document.orderRef || "-",
    customerName: document.customerName || "-",
    storages: document.storages || "-",
    outDate: formatDateValue(document.outDate, dateFormatter),
    shipToName: document.shipToName || "-",
    carrierName: document.carrierName || "-",
    totalLines: document.totalLines,
    totalQty: document.totalQty,
    totalGrossWeightKgs: document.totalGrossWeightKgs ? document.totalGrossWeightKgs.toFixed(2) : "-",
    status: document.status
  }));
}

function summarizeInboundDocumentSections(document: InboundDocument) {
  const sections = [...new Set(document.lines.map((line) => normalizeStorageSection(line.storageSection)).filter(Boolean))];
  return sections.join(", ") || DEFAULT_STORAGE_SECTION;
}

function displayDescription(item: Pick<Item, "description" | "name">) {
  return item.description?.trim() || item.name?.trim() || "-";
}

function getLatestDate(left: string | null, right: string | null) {
  if (!left) return right;
  if (!right) return left;

  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  if (Number.isNaN(leftTime)) return right;
  if (Number.isNaN(rightTime)) return left;
  return rightTime > leftTime ? right : left;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}
