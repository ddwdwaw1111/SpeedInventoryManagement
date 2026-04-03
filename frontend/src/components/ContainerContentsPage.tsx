import CloseIcon from "@mui/icons-material/Close";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import WarehouseOutlinedIcon from "@mui/icons-material/WarehouseOutlined";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Box, Button, Drawer, IconButton } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";

import { setPendingAllActivityContext } from "../lib/allActivityContext";
import { consumePendingContainerContentsContext } from "../lib/containerContentsContext";
import { formatDateValue } from "../lib/dates";
import { downloadExcelWorkbook, type ExcelExportColumn } from "../lib/excelExport";
import { useI18n } from "../lib/i18n";
import { setPendingInventoryByLocationContext } from "../lib/inventoryByLocationContext";
import type { PageKey } from "../lib/routes";
import { normalizeStorageSection, type Customer, type Item, type Location, type UserRole } from "../lib/types";
import { ExportExcelDialog } from "./ExportExcelDialog";
import { buildWorkspaceGridSlots, WorkspacePanelHeader } from "./WorkspacePanelChrome";
import { useSharedColumnOrder } from "./useSharedColumnOrder";

type ContainerContentsPageProps = {
  items: Item[];
  customers: Customer[];
  locations: Location[];
  currentUserRole: UserRole;
  isLoading: boolean;
  onNavigate: (page: PageKey) => void;
};

type ContainerContentsRow = {
  id: string;
  containerNo: string;
  warehouseSummary: string;
  pickLocationSummary: string;
  customerSummary: string;
  customerIds: number[];
  locationIds: number[];
  skuCount: number;
  rowCount: number;
  contentsPreview: string;
  onHand: number;
  availableQty: number;
  damagedQty: number;
  lastReceipt: string | null;
  items: Item[];
};

type ContainerContentsDraftRow = ContainerContentsRow & {
  warehouseNames: string[];
  pickLocations: string[];
  customerNames: string[];
  skuSet: Set<string>;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
const CONTAINER_CONTENTS_COLUMN_ORDER_PREFERENCE_KEY = "container-contents.column-order";
const CONTAINER_CONTENTS_EXPORT_TITLE = "Container Contents";
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

export function ContainerContentsPage({
  items,
  customers,
  locations,
  currentUserRole,
  isLoading,
  onNavigate
}: ContainerContentsPageProps) {
  const { t } = useI18n();
  const canConfigureColumns = currentUserRole === "admin";
  const pageDescription = t("containerContentsDesc");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("all");
  const [selectedLocationId, setSelectedLocationId] = useState("all");
  const [selectedContainerId, setSelectedContainerId] = useState<string | null>(null);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const deferredSearchTerm = useDeferredValue(searchTerm);

  useEffect(() => {
    const context = consumePendingContainerContentsContext();
    if (!context) {
      return;
    }

    const nextSearchTerm = context.containerNo?.trim() || context.sku?.trim() || "";
    setSearchTerm(nextSearchTerm);
    setSelectedCustomerId(context.customerId ? String(context.customerId) : "all");
    setSelectedLocationId(context.locationId ? String(context.locationId) : "all");
    setSelectedContainerId(context.containerNo?.trim() || null);
  }, []);

  const normalizedSearch = deferredSearchTerm.trim().toLowerCase();
  const rows = useMemo(
    () => buildContainerContentsRows(items, normalizedSearch, selectedCustomerId, selectedLocationId),
    [items, normalizedSearch, selectedCustomerId, selectedLocationId]
  );
  const selectedContainer = useMemo(
    () => rows.find((row) => row.id === selectedContainerId) ?? null,
    [rows, selectedContainerId]
  );
  const hasActiveFilters = normalizedSearch.length > 0 || selectedCustomerId !== "all" || selectedLocationId !== "all";
  const mainGridSlots = buildWorkspaceGridSlots({
    emptyTitle: t("noResults"),
    emptyDescription: hasActiveFilters ? t("filteredStateHint") : t("emptyStateHint"),
    loadingTitle: t("loadingRecords"),
    loadingDescription: pageDescription
  });

  useEffect(() => {
    if (selectedContainerId !== null && !selectedContainer) {
      setSelectedContainerId(null);
    }
  }, [selectedContainer, selectedContainerId]);

  const baseColumns = useMemo<GridColDef<ContainerContentsRow>[]>(() => [
    { field: "containerNo", headerName: t("containerNo"), minWidth: 180, flex: 0.9, renderCell: (params) => <span className="cell--mono">{params.row.containerNo}</span> },
    { field: "warehouseSummary", headerName: t("currentStorage"), minWidth: 200, flex: 1.1 },
    { field: "pickLocationSummary", headerName: t("pickLocations"), minWidth: 210, flex: 1.2 },
    { field: "customerSummary", headerName: t("customer"), minWidth: 190, flex: 1.1 },
    { field: "skuCount", headerName: t("skuCount"), minWidth: 110, type: "number" },
    { field: "contentsPreview", headerName: t("contentsPreview"), minWidth: 260, flex: 1.5 },
    { field: "onHand", headerName: t("onHand"), minWidth: 110, type: "number" },
    { field: "availableQty", headerName: t("availableQty"), minWidth: 120, type: "number" },
    { field: "damagedQty", headerName: t("damagedQty"), minWidth: 110, type: "number" },
    {
      field: "lastReceipt",
      headerName: t("lastReceipt"),
      minWidth: 150,
      flex: 0.9,
      valueFormatter: (value) => formatDateValue(value, dateFormatter)
    }
  ], [t]);
  const {
    columns,
    columnOrderAction,
    columnOrderDialog
  } = useSharedColumnOrder({
    preferenceKey: CONTAINER_CONTENTS_COLUMN_ORDER_PREFERENCE_KEY,
    baseColumns,
    canManage: canConfigureColumns
  });

  function handleExport({ title, columns }: { title: string; columns: ExcelExportColumn[] }) {
    const detailRows = rows.flatMap((row) =>
      [...row.items]
        .sort((left, right) => {
          if (left.customerName !== right.customerName) return left.customerName.localeCompare(right.customerName);
          if (left.sku !== right.sku) return left.sku.localeCompare(right.sku);
          if (left.locationName !== right.locationName) return left.locationName.localeCompare(right.locationName);
          return normalizeStorageSection(left.storageSection).localeCompare(normalizeStorageSection(right.storageSection));
        })
        .map((item) => ({
          containerNo: row.containerNo,
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
    );

    downloadExcelWorkbook({
      title,
      sheetName: CONTAINER_CONTENTS_EXPORT_TITLE,
      fileName: title,
      columns,
      rows: detailRows
    });
    setIsExportDialogOpen(false);
  }

  const sortedContainerItems = useMemo(() => {
    if (!selectedContainer) {
      return [];
    }

    return [...selectedContainer.items].sort((left, right) => {
      if (left.customerName !== right.customerName) return left.customerName.localeCompare(right.customerName);
      if (left.sku !== right.sku) return left.sku.localeCompare(right.sku);
      if (left.locationName !== right.locationName) return left.locationName.localeCompare(right.locationName);
      return normalizeStorageSection(left.storageSection).localeCompare(normalizeStorageSection(right.storageSection));
    });
  }, [selectedContainer]);

  return (
    <main className="workspace-main">
      <section className="workbook-panel workbook-panel--full">
        <div className="tab-strip">
          <WorkspacePanelHeader
            title={t("containerContents")}
            actions={(
              <div className="sheet-actions">
                <Button
                  variant="outlined"
                  startIcon={<FileDownloadOutlinedIcon fontSize="small" />}
                  onClick={() => setIsExportDialogOpen(true)}
                  disabled={rows.length === 0}
                >
                  {t("exportExcel")}
                </Button>
                {columnOrderAction}
              </div>
            )}
          />
          <div className="filter-bar">
            <label>{t("search")}<input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder={t("containerContentsSearchPlaceholder")} /></label>
            <label>{t("customer")}<select value={selectedCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)}><option value="all">{t("allCustomers")}</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
            <label>{t("currentStorage")}<select value={selectedLocationId} onChange={(event) => setSelectedLocationId(event.target.value)}><option value="all">{t("allStorage")}</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
          </div>
        </div>

        <div className="sheet-table-wrap">
          <Box sx={{ minWidth: 0 }}>
            <DataGrid
              rows={rows}
              columns={columns}
              loading={isLoading}
              pagination
              pageSizeOptions={[10, 25, 50, 100]}
              disableRowSelectionOnClick
              initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
              getRowHeight={() => 68}
              onRowClick={(params) => setSelectedContainerId(params.row.id)}
              getRowClassName={(params) => (params.row.id === selectedContainerId ? "document-row--selected" : "")}
              slots={mainGridSlots}
              sx={{ border: 0 }}
            />
          </Box>
        </div>
      </section>
      {columnOrderDialog}
      <ExportExcelDialog
        open={isExportDialogOpen}
        defaultTitle={CONTAINER_CONTENTS_EXPORT_TITLE}
        defaultColumns={[...CONTAINER_CONTENTS_EXPORT_COLUMNS]}
        onClose={() => setIsExportDialogOpen(false)}
        onExport={handleExport}
      />

      <Drawer
        anchor="right"
        open={Boolean(selectedContainer)}
        onClose={() => setSelectedContainerId(null)}
        PaperProps={{ className: "document-drawer" }}
      >
        {selectedContainer ? (
          <div className="document-drawer__content">
            <div className="document-drawer__header">
              <div>
                <div className="document-drawer__eyebrow">{t("containerContents")}</div>
                <h3>{selectedContainer.containerNo}</h3>
                <p>{selectedContainer.contentsPreview} | {selectedContainer.customerSummary}</p>
              </div>
              <IconButton aria-label={t("close")} onClick={() => setSelectedContainerId(null)}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </div>

            <div className="document-drawer__actions">
              <Button
                variant="contained"
                startIcon={<WarehouseOutlinedIcon fontSize="small" />}
                onClick={() => {
                  setPendingInventoryByLocationContext({
                    containerNo: selectedContainer.containerNo,
                    customerId: selectedContainer.customerIds.length === 1 ? selectedContainer.customerIds[0] : undefined,
                    locationId: selectedContainer.locationIds.length === 1 ? selectedContainer.locationIds[0] : undefined
                  });
                  onNavigate("stock-by-location");
                }}
              >
                {t("openInventoryByLocation")}
              </Button>
              <Button
                variant="outlined"
                startIcon={<HistoryOutlinedIcon fontSize="small" />}
                onClick={() => {
                  setPendingAllActivityContext({
                    searchTerm: selectedContainer.containerNo,
                    customerId: selectedContainer.customerIds.length === 1 ? selectedContainer.customerIds[0] : undefined,
                    locationId: selectedContainer.locationIds.length === 1 ? selectedContainer.locationIds[0] : undefined
                  });
                  onNavigate("all-activity");
                }}
              >
                {t("allActivity")}
              </Button>
            </div>

            <div className="document-drawer__status-bar">
              <div className="document-drawer__status-stat">
                <strong>{selectedContainer.onHand}</strong>
                <span>{t("onHand")}</span>
              </div>
              <div className="document-drawer__status-stat">
                <strong>{selectedContainer.availableQty}</strong>
                <span>{t("availableQty")}</span>
              </div>
              <div className="document-drawer__status-stat">
                <strong>{selectedContainer.skuCount}</strong>
                <span>{t("skuCount")}</span>
              </div>
              <div className="document-drawer__status-stat">
                <strong>{selectedContainer.rowCount}</strong>
                <span>{t("currentInventoryRows")}</span>
              </div>
            </div>

            <div className="document-drawer__meta">
              <div>
                <strong>{t("currentStorage")}</strong>
                <span>{selectedContainer.warehouseSummary}</span>
              </div>
              <div>
                <strong>{t("pickLocations")}</strong>
                <span>{selectedContainer.pickLocationSummary}</span>
              </div>
              <div>
                <strong>{t("customer")}</strong>
                <span>{selectedContainer.customerSummary}</span>
              </div>
              <div>
                <strong>{t("lastReceipt")}</strong>
                <span>{formatDateValue(selectedContainer.lastReceipt, dateFormatter)}</span>
              </div>
            </div>

            <div className="document-drawer__section-title">{t("containerItems")}</div>
            <div className="document-drawer__list">
              {sortedContainerItems.map((item) => (
                <div className="document-drawer__list-row" key={item.id}>
                  <div>
                    <strong>{item.itemNumber ? `${item.itemNumber} · ${item.sku}` : item.sku}</strong>
                    <span>{displayDescription(item)} | {item.customerName} | {item.locationName} / {normalizeStorageSection(item.storageSection)}</span>
                  </div>
                  <div>
                    <strong>{t("onHand")}</strong>
                    <span>{item.quantity}</span>
                  </div>
                  <div>
                    <strong>{t("availableQty")}</strong>
                    <span>{item.availableQty}</span>
                  </div>
                  <div>
                    <strong>{t("damagedQty")}</strong>
                    <span>{item.damagedQty}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </Drawer>
    </main>
  );
}

function buildContainerContentsRows(
  items: Item[],
  normalizedSearch: string,
  selectedCustomerId: string,
  selectedLocationId: string
) {
  const filteredItems = items.filter((item) => {
    const normalizedContainerNo = item.containerNo.trim();
    if (!normalizedContainerNo) {
      return false;
    }

    const matchesSearch = normalizedSearch.length === 0
      || normalizedContainerNo.toLowerCase().includes(normalizedSearch)
      || item.sku.toLowerCase().includes(normalizedSearch)
      || item.itemNumber.toLowerCase().includes(normalizedSearch)
      || displayDescription(item).toLowerCase().includes(normalizedSearch)
      || item.customerName.toLowerCase().includes(normalizedSearch)
      || item.locationName.toLowerCase().includes(normalizedSearch)
      || normalizeStorageSection(item.storageSection).toLowerCase().includes(normalizedSearch);
    const matchesCustomer = selectedCustomerId === "all" || item.customerId === Number(selectedCustomerId);
    const matchesLocation = selectedLocationId === "all" || item.locationId === Number(selectedLocationId);
    return matchesSearch && matchesCustomer && matchesLocation;
  });

  const rowMap = new Map<string, ContainerContentsDraftRow>();

  for (const item of filteredItems) {
    const containerNo = item.containerNo.trim();
    const existing = rowMap.get(containerNo);
    const receiptDate = item.deliveryDate || item.lastRestockedAt || null;
    const pickLocation = `${item.locationName} / ${normalizeStorageSection(item.storageSection)}`;

    if (!existing) {
      rowMap.set(containerNo, {
        id: containerNo,
        containerNo,
        warehouseSummary: item.locationName,
        pickLocationSummary: pickLocation,
        customerSummary: item.customerName,
        customerIds: [item.customerId],
        locationIds: [item.locationId],
        skuCount: 1,
        rowCount: 1,
        contentsPreview: item.sku,
        onHand: item.quantity,
        availableQty: item.availableQty,
        damagedQty: item.damagedQty,
        lastReceipt: receiptDate,
        items: [item],
        warehouseNames: [item.locationName],
        pickLocations: [pickLocation],
        customerNames: [item.customerName],
        skuSet: new Set([item.sku])
      });
      continue;
    }

    existing.onHand += item.quantity;
    existing.availableQty += item.availableQty;
    existing.damagedQty += item.damagedQty;
    existing.rowCount += 1;
    existing.items.push(item);
    existing.lastReceipt = getLatestDate(existing.lastReceipt, receiptDate);
    if (!existing.customerIds.includes(item.customerId)) {
      existing.customerIds.push(item.customerId);
    }
    if (!existing.locationIds.includes(item.locationId)) {
      existing.locationIds.push(item.locationId);
    }
    if (!existing.warehouseNames.includes(item.locationName)) {
      existing.warehouseNames.push(item.locationName);
    }
    if (!existing.pickLocations.includes(pickLocation)) {
      existing.pickLocations.push(pickLocation);
    }
    if (!existing.customerNames.includes(item.customerName)) {
      existing.customerNames.push(item.customerName);
    }
    existing.skuSet.add(item.sku);
  }

  return [...rowMap.values()]
    .map((row) => ({
      ...row,
      warehouseSummary: summarizeLabels(row.warehouseNames),
      pickLocationSummary: summarizeLabels(row.pickLocations, 3),
      customerSummary: summarizeLabels(row.customerNames),
      skuCount: row.skuSet.size,
      contentsPreview: summarizeLabels([...row.skuSet], 3)
    }))
    .sort((left, right) => left.containerNo.localeCompare(right.containerNo));
}

function summarizeLabels(values: string[], maxVisible = 2) {
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  if (normalized.length === 0) {
    return "-";
  }

  const uniqueValues = [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
  if (uniqueValues.length <= maxVisible) {
    return uniqueValues.join(", ");
  }

  return `${uniqueValues.slice(0, maxVisible).join(", ")} +${uniqueValues.length - maxVisible}`;
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
