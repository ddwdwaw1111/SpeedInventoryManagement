import CloseIcon from "@mui/icons-material/Close";
import CompareArrowsOutlinedIcon from "@mui/icons-material/CompareArrowsOutlined";
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Box, Button, Chip, Drawer, IconButton } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";

import { api } from "../lib/api";
import { setPendingAllActivityContext } from "../lib/allActivityContext";
import { downloadExcelWorkbook, type ExcelExportColumn } from "../lib/excelExport";
import { setPendingInventoryActionContext } from "../lib/inventoryActionContext";
import { buildInventoryActionSourceKey } from "../lib/inventoryActionSources";
import { consumePendingInventoryByLocationContext } from "../lib/inventoryByLocationContext";
import { formatDateValue } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import type { PageKey } from "../lib/routes";
import { normalizeStorageSection, type Customer, type Item, type Location, type UserRole } from "../lib/types";
import { ExportExcelDialog } from "./ExportExcelDialog";
import { buildWorkspaceGridSlots, WorkspacePanelHeader } from "./WorkspacePanelChrome";
import { useSharedColumnOrder } from "./useSharedColumnOrder";

type MasterInventoryPageProps = {
  items: Item[];
  locations: Location[];
  customers: Customer[];
  currentUserRole: UserRole;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
  onNavigate: (page: PageKey) => void;
};

type InventoryHealthFilter = "ALL" | "IN_STOCK" | "LOW_STOCK";

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
const summaryNumberFormatter = new Intl.NumberFormat("en-US");
const INVENTORY_BY_LOCATION_COLUMN_ORDER_PREFERENCE_KEY = "inventory-by-location.column-order";
const INVENTORY_DETAIL_EXPORT_TITLE = "Inventory Detail";
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

export function MasterInventoryPage({ items, locations, customers, currentUserRole, isLoading, onRefresh, onNavigate }: MasterInventoryPageProps) {
  const { t } = useI18n();
  const canManage = currentUserRole === "admin" || currentUserRole === "operator";
  const canConfigureColumns = currentUserRole === "admin";
  const pageDescription = t("stockByLocationDesc");
  const permissionNote = currentUserRole === "viewer"
    ? t("readOnlyModeNotice")
    : currentUserRole === "operator"
      ? t("operatorCanEditStockNotice")
      : "";
  const [searchTerm, setSearchTerm] = useState("");
  const [focusedSku, setFocusedSku] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState("all");
  const [selectedCustomerId, setSelectedCustomerId] = useState("all");
  const [healthFilter, setHealthFilter] = useState<InventoryHealthFilter>("ALL");
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const deferredSearchTerm = useDeferredValue(searchTerm);

  useEffect(() => {
    const context = consumePendingInventoryByLocationContext();
    if (!context) {
      return;
    }

    const nextSku = context.sku?.trim() ?? "";
    const nextContainerNo = context.containerNo?.trim() ?? "";
    const nextSearchTerm = nextSku || nextContainerNo;
    setFocusedSku(nextSku || null);
    setSearchTerm(nextSearchTerm);
    setSelectedCustomerId(context.customerId ? String(context.customerId) : "all");
    setSelectedLocationId(context.locationId ? String(context.locationId) : "all");
    setHealthFilter(context.healthFilter ?? "ALL");
    setSelectedItemId(null);
  }, []);

  const normalizedSearch = deferredSearchTerm.trim().toLowerCase();
  const filteredItems = items.filter((item) => {
    const matchesFocusedSku = !focusedSku || item.sku.toLowerCase() === focusedSku.toLowerCase();
    const matchesSearch = normalizedSearch.length === 0
      || item.sku.toLowerCase().includes(normalizedSearch)
      || item.itemNumber.toLowerCase().includes(normalizedSearch)
      || item.customerName.toLowerCase().includes(normalizedSearch)
      || displayDescription(item).toLowerCase().includes(normalizedSearch)
      || item.containerNo.toLowerCase().includes(normalizedSearch);
    const matchesLocation = selectedLocationId === "all" || item.locationId === Number(selectedLocationId);
    const matchesCustomer = selectedCustomerId === "all" || item.customerId === Number(selectedCustomerId);
    const matchesHealth = healthFilter === "ALL"
      || (healthFilter === "IN_STOCK" && item.availableQty > item.reorderLevel)
      || (healthFilter === "LOW_STOCK" && item.availableQty <= item.reorderLevel);
    return matchesFocusedSku && matchesSearch && matchesLocation && matchesCustomer && matchesHealth;
  });
  const selectedItem = useMemo(
    () => filteredItems.find((item) => item.id === selectedItemId) ?? null,
    [filteredItems, selectedItemId]
  );
  const hasActiveFilters = normalizedSearch.length > 0 || selectedLocationId !== "all" || selectedCustomerId !== "all" || healthFilter !== "ALL" || focusedSku !== null;
  const overviewStats = useMemo(() => {
    const totalOnHand = filteredItems.reduce((sum, item) => sum + item.quantity, 0);
    const totalAvailable = filteredItems.reduce((sum, item) => sum + item.availableQty, 0);
    const lowStockCount = filteredItems.filter((item) => item.reorderLevel > 0 && item.availableQty <= item.reorderLevel).length;
    const containers = new Set(filteredItems.map((item) => item.containerNo).filter(Boolean)).size;
    return [
      { label: t("allRows"), value: summaryNumberFormatter.format(filteredItems.length), meta: t("stockByLocation") },
      { label: t("onHand"), value: summaryNumberFormatter.format(totalOnHand), meta: t("units") },
      { label: t("availableQty"), value: summaryNumberFormatter.format(totalAvailable), meta: t("units") },
      { label: t("lowStock"), value: summaryNumberFormatter.format(lowStockCount), meta: t("allRows") },
      { label: t("containerCount"), value: summaryNumberFormatter.format(containers), meta: t("containerNo") }
    ];
  }, [filteredItems, t]);
  const mainGridSlots = buildWorkspaceGridSlots({
    emptyTitle: t("noResults"),
    emptyDescription: hasActiveFilters ? t("filteredStateHint") : t("emptyStateHint"),
    loadingTitle: t("loadingRecords"),
    loadingDescription: pageDescription
  });

  useEffect(() => {
    if (selectedItemId !== null && !selectedItem) {
      setSelectedItemId(null);
    }
  }, [selectedItem, selectedItemId]);

  const baseColumns = useMemo<GridColDef<Item>[]>(() => [
    { field: "itemNumber", headerName: t("itemNumber"), minWidth: 130, flex: 0.8, renderCell: (params) => <span className="cell--mono">{params.value || "-"}</span> },
    { field: "sku", headerName: t("sku"), minWidth: 120, flex: 0.8, renderCell: (params) => <span className="cell--mono">{params.value}</span> },
    { field: "description", headerName: t("description"), minWidth: 240, flex: 1.5, valueGetter: (_, row) => displayDescription(row) },
    { field: "customerName", headerName: t("customer"), minWidth: 180, flex: 1 },
    { field: "locationName", headerName: t("currentStorage"), minWidth: 170, flex: 1 },
    { field: "storageSection", headerName: t("storageSection"), minWidth: 110, renderCell: (params) => normalizeStorageSection(params.row.storageSection) },
    { field: "quantity", headerName: t("onHand"), minWidth: 110, type: "number" },
    { field: "availableQty", headerName: t("availableQty"), minWidth: 120, type: "number" },
    { field: "damagedQty", headerName: t("damagedQty"), minWidth: 110, type: "number" },
    { field: "reorderLevel", headerName: t("reorderLevel"), minWidth: 130, type: "number" },
    { field: "deliveryDate", headerName: t("deliveryDate"), minWidth: 140, valueFormatter: (_, row) => formatDate(row.deliveryDate) },
    { field: "containerNo", headerName: t("containerNo"), minWidth: 170, flex: 1, renderCell: (params) => <span className="cell--mono">{params.value || "-"}</span> },
    {
      field: "status",
      headerName: t("status"),
      minWidth: 170,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <div className="status-stack">
          {params.row.availableQty <= params.row.reorderLevel ? <Chip label={t("lowStock")} color="warning" size="small" /> : <Chip label={t("healthy")} color="success" size="small" />}
        </div>
      )
    }
  ], [t]);
  const {
    columns,
    columnOrderAction,
    columnOrderDialog
  } = useSharedColumnOrder({
    preferenceKey: INVENTORY_BY_LOCATION_COLUMN_ORDER_PREFERENCE_KEY,
    baseColumns,
    canManage: canConfigureColumns,
    onError: setErrorMessage
  });

  function openWorkspace(page: PageKey) {
    if (!selectedItem) return;
    if (page === "adjustments" || page === "transfers") {
      setPendingInventoryActionContext(page, {
        sourceKey: buildInventoryActionSourceKey(selectedItem.customerId, selectedItem.sku),
        sku: selectedItem.sku,
        customerId: selectedItem.customerId
      });
    }
    if (page === "all-activity") {
      setPendingAllActivityContext({
        searchTerm: selectedItem.sku,
        customerId: selectedItem.customerId,
        locationId: selectedItem.locationId
      });
    }
    onNavigate(page);
  }

  function handleExport({ title, columns }: { title: string; columns: ExcelExportColumn[] }) {
    downloadExcelWorkbook({
      title,
      sheetName: INVENTORY_DETAIL_EXPORT_TITLE,
      fileName: title,
      columns,
      rows: filteredItems.map((item) => ({
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
        deliveryDate: formatDate(item.deliveryDate),
        containerNo: item.containerNo || "-",
      }))
    });
    setIsExportDialogOpen(false);
  }

  return (
    <main className="workspace-main">
      <section className="workbook-panel workbook-panel--full">
        <div className="tab-strip">
          <WorkspacePanelHeader
            title={t("stockByLocation")}
            actions={(
              <div className="sheet-actions">
                <Button
                  variant="outlined"
                  startIcon={<FileDownloadOutlinedIcon fontSize="small" />}
                  onClick={() => setIsExportDialogOpen(true)}
                  disabled={filteredItems.length === 0}
                >
                  {t("exportExcel")}
                </Button>
                {columnOrderAction}
              </div>
            )}
            notices={[permissionNote]}
            errorMessage={errorMessage}
          />
          <div className="filter-bar">
            <label>{t("search")}<input value={searchTerm} onChange={(event) => {
              const nextValue = event.target.value;
              setSearchTerm(nextValue);
              if (focusedSku && nextValue.trim().toLowerCase() !== focusedSku.toLowerCase()) {
                setFocusedSku(null);
              }
            }} placeholder={t("stockByLocationSearchPlaceholder")} /></label>
            <label>{t("customer")}<select value={selectedCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)}><option value="all">{t("allCustomers")}</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
            <label>{t("currentStorage")}<select value={selectedLocationId} onChange={(event) => setSelectedLocationId(event.target.value)}><option value="all">{t("allStorage")}</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
            <label>{t("stockHealth")}<select value={healthFilter} onChange={(event) => setHealthFilter(event.target.value as InventoryHealthFilter)}><option value="ALL">{t("allRows")}</option><option value="IN_STOCK">{t("healthyStock")}</option><option value="LOW_STOCK">{t("lowStock")}</option></select></label>
          </div>
        </div>

        <div className="workspace-summary-strip">
          {overviewStats.map((stat) => (
            <article className="workspace-summary-card" key={stat.label}>
              <span className="workspace-summary-card__label">{stat.label}</span>
              <strong className="workspace-summary-card__value">{stat.value}</strong>
              <span className="workspace-summary-card__meta">{stat.meta}</span>
            </article>
          ))}
        </div>

        <div className="sheet-table-wrap">
          <Box sx={{ minWidth: 0 }}>
            <DataGrid
              rows={filteredItems}
              columns={columns}
              loading={isLoading}
              pagination
              pageSizeOptions={[10, 20, 50]}
              disableRowSelectionOnClick
              initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
              getRowHeight={() => 72}
              onRowClick={(params) => setSelectedItemId(params.row.id)}
              getRowClassName={(params) => (params.row.id === selectedItemId ? "document-row--selected" : "")}
              slots={mainGridSlots}
              sx={{ border: 0 }}
            />
          </Box>
        </div>
      </section>
      {columnOrderDialog}
      <ExportExcelDialog
        open={isExportDialogOpen}
        defaultTitle={INVENTORY_DETAIL_EXPORT_TITLE}
        defaultColumns={[...INVENTORY_DETAIL_EXPORT_COLUMNS]}
        onClose={() => setIsExportDialogOpen(false)}
        onExport={handleExport}
      />

      <Drawer
        anchor="right"
        open={Boolean(selectedItem)}
        onClose={() => setSelectedItemId(null)}
        PaperProps={{ className: "document-drawer" }}
      >
        {selectedItem ? (
          <div className="document-drawer__content">
            <div className="document-drawer__header">
              <div>
                <div className="document-drawer__eyebrow">{t("stockByLocation")}</div>
                <h3>{selectedItem.sku}</h3>
                <p>
                  {displayDescription(selectedItem)} | {selectedItem.customerName} | {selectedItem.locationName} / {normalizeStorageSection(selectedItem.storageSection)}
                  {" "} | {t("containerNo")}: {selectedItem.containerNo || "-"}
                </p>
              </div>
              <IconButton aria-label={t("close")} onClick={() => setSelectedItemId(null)}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </div>

            <div className="document-drawer__actions">
              {canManage ? (
                <Button variant="outlined" startIcon={<TuneOutlinedIcon fontSize="small" />} onClick={() => openWorkspace("adjustments")}>
                  {t("adjustments")}
                </Button>
              ) : null}
              {canManage ? (
                <Button variant="outlined" startIcon={<CompareArrowsOutlinedIcon fontSize="small" />} onClick={() => openWorkspace("transfers")}>
                  {t("transfers")}
                </Button>
              ) : null}
              {canManage ? (
                <Button variant="outlined" startIcon={<FactCheckOutlinedIcon fontSize="small" />} onClick={() => openWorkspace("cycle-counts")}>
                  {t("cycleCounts")}
                </Button>
              ) : null}
              <Button variant="outlined" startIcon={<HistoryOutlinedIcon fontSize="small" />} onClick={() => openWorkspace("all-activity")}>
                {t("allActivity")}
              </Button>
            </div>

            <div className="document-drawer__status-bar">
              <div className="document-drawer__status-main">
                <div className="status-stack">
                  {selectedItem.availableQty <= selectedItem.reorderLevel ? <Chip label={t("lowStock")} color="warning" size="small" /> : <Chip label={t("healthy")} color="success" size="small" />}
                </div>
              </div>
              <div className="document-drawer__status-stat">
                <strong>{selectedItem.quantity}</strong>
                <span>{t("onHand")}</span>
              </div>
              <div className="document-drawer__status-stat">
                <strong>{selectedItem.availableQty}</strong>
                <span>{t("availableQty")}</span>
              </div>
              <div className="document-drawer__status-stat">
                <strong>{selectedItem.damagedQty}</strong>
                <span>{t("damagedQty")}</span>
              </div>
            </div>

            <div className="document-drawer__meta">
              <div className="sheet-note">
                <strong>{t("customer")}</strong><br />
                {selectedItem.customerName}
              </div>
              <div className="sheet-note">
                <strong>{t("currentStorage")}</strong><br />
                {selectedItem.locationName} / {normalizeStorageSection(selectedItem.storageSection)}
              </div>
              <div className="sheet-note">
                <strong>{t("itemNumber")}</strong><br />
                <span className="cell--mono">{selectedItem.itemNumber || "-"}</span>
              </div>
              <div className="sheet-note">
                <strong>{t("receiptSource")}</strong><br />
                <span className="cell--mono">{selectedItem.containerNo || "-"}</span><br />
                <span>{t("deliveryDate")}: {formatDate(selectedItem.deliveryDate)}</span>
              </div>
              <div className="sheet-note">
                <strong>{t("reorderLevel")}</strong><br />
                {selectedItem.reorderLevel}
              </div>
              {permissionNote ? <div className="sheet-note document-drawer__meta-note">{permissionNote}</div> : null}
            </div>
          </div>
        ) : null}
      </Drawer>
    </main>
  );
}

function displayDescription(item: Pick<Item, "description" | "name">) { return item.description || item.name; }
function formatDate(value: string | null) { return formatDateValue(value, dateFormatter); }
