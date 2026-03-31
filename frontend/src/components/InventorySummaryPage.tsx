import CloseIcon from "@mui/icons-material/Close";
import CompareArrowsOutlinedIcon from "@mui/icons-material/CompareArrowsOutlined";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";
import WarehouseOutlinedIcon from "@mui/icons-material/WarehouseOutlined";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Box, Button, Drawer, IconButton } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";

import { setPendingAllActivityContext } from "../lib/allActivityContext";
import { buildItemContainerBalances, type ItemContainerBalance } from "../lib/containerBalances";
import { setPendingContainerContentsContext } from "../lib/containerContentsContext";
import { formatDateValue } from "../lib/dates";
import { downloadExcelWorkbook, type ExcelExportColumn } from "../lib/excelExport";
import { setPendingInventoryActionContext } from "../lib/inventoryActionContext";
import { buildInventoryActionSourceKey } from "../lib/inventoryActionSources";
import { useI18n } from "../lib/i18n";
import { setPendingInventoryByLocationContext } from "../lib/inventoryByLocationContext";
import type { PageKey } from "../lib/routes";
import { DEFAULT_STORAGE_SECTION, normalizeStorageSection, type Customer, type Item, type Location, type Movement, type UserRole } from "../lib/types";
import { ExportExcelDialog } from "./ExportExcelDialog";
import { buildWorkspaceGridSlots, WorkspacePanelHeader } from "./WorkspacePanelChrome";
import { useSharedColumnOrder } from "./useSharedColumnOrder";

type InventorySummaryPageProps = {
  items: Item[];
  movements: Movement[];
  customers: Customer[];
  locations: Location[];
  currentUserRole: UserRole;
  isLoading: boolean;
  onNavigate: (page: PageKey) => void;
};

type InventorySummaryRow = {
  id: string;
  itemNumber: string;
  sku: string;
  description: string;
  customerId: number;
  customerName: string;
  onHand: number;
  availableQty: number;
  allocatedQty: number;
  damagedQty: number;
  warehouseCount: number;
  containerCount: number;
  lastReceipt: string | null;
  containerBalances: ItemContainerBalance[];
  items: Item[];
};

type WarehouseBreakdownRow = {
  id: number;
  locationId: number;
  locationName: string;
  sections: string[];
  onHand: number;
  availableQty: number;
  allocatedQty: number;
  damagedQty: number;
  containerCount: number;
  lastReceipt: string | null;
};

type ContainerBreakdownRow = {
  id: string;
  containerNo: string;
  locationName: string;
  storageSections: string[];
  onHand: number;
  availableQty: number;
  lastReceipt: string | null;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
const summaryNumberFormatter = new Intl.NumberFormat("en-US");
const INVENTORY_SUMMARY_COLUMN_ORDER_PREFERENCE_KEY = "inventory-summary.column-order";
const INVENTORY_SUMMARY_EXPORT_TITLE = "Inventory Summary";
const INVENTORY_SUMMARY_EXPORT_COLUMNS = [
  { key: "itemNumber", label: "Item #"},
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

export function InventorySummaryPage({
  items,
  movements,
  customers,
  locations,
  currentUserRole,
  isLoading,
  onNavigate
}: InventorySummaryPageProps) {
  const { t } = useI18n();
  const canConfigureColumns = currentUserRole === "admin";
  const canManageInventory = currentUserRole === "admin" || currentUserRole === "operator";
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("all");
  const [selectedLocationId, setSelectedLocationId] = useState("all");
  const [selectedSummaryId, setSelectedSummaryId] = useState<string | null>(null);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const deferredSearchTerm = useDeferredValue(searchTerm);

  const normalizedSearch = deferredSearchTerm.trim().toLowerCase();
  const summaryRows = useMemo(() => buildInventorySummaryRows(items, movements, normalizedSearch, selectedCustomerId, selectedLocationId), [items, movements, normalizedSearch, selectedCustomerId, selectedLocationId]);
  const selectedSummary = useMemo(
    () => summaryRows.find((row) => row.id === selectedSummaryId) ?? null,
    [selectedSummaryId, summaryRows]
  );
  const hasActiveFilters = normalizedSearch.length > 0 || selectedCustomerId !== "all" || selectedLocationId !== "all";
  const mainGridSlots = buildWorkspaceGridSlots({
    emptyTitle: t("noResults"),
    emptyDescription: hasActiveFilters ? t("filteredStateHint") : t("emptyStateHint"),
    loadingTitle: t("loadingRecords"),
    loadingDescription: t("inventorySummaryDesc")
  });

  useEffect(() => {
    if (selectedSummaryId !== null && !selectedSummary) {
      setSelectedSummaryId(null);
    }
  }, [selectedSummary, selectedSummaryId]);

  const baseColumns = useMemo<GridColDef<InventorySummaryRow>[]>(() => [
    { field: "itemNumber", headerName: t("itemNumber"), minWidth: 130, flex: 0.8, renderCell: (params) => <span className="cell--mono">{params.row.itemNumber || "-"}</span> },
    { field: "sku", headerName: t("sku"), minWidth: 130, flex: 0.8, renderCell: (params) => <span className="cell--mono">{params.row.sku}</span> },
    { field: "description", headerName: t("description"), minWidth: 240, flex: 1.5 },
    { field: "customerName", headerName: t("customer"), minWidth: 180, flex: 1 },
    { field: "onHand", headerName: t("onHand"), minWidth: 110, type: "number" },
    { field: "availableQty", headerName: t("availableQty"), minWidth: 120, type: "number" },
    { field: "damagedQty", headerName: t("damagedQty"), minWidth: 120, type: "number" },
    { field: "warehouseCount", headerName: t("warehouseCount"), minWidth: 120, type: "number" },
    { field: "containerCount", headerName: t("containerCount"), minWidth: 120, type: "number" },
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
    preferenceKey: INVENTORY_SUMMARY_COLUMN_ORDER_PREFERENCE_KEY,
    baseColumns,
    canManage: canConfigureColumns
  });

  const warehouseBreakdown = useMemo(
    () => buildWarehouseBreakdown(selectedSummary?.containerBalances ?? []),
    [selectedSummary]
  );

  const containerBreakdown = useMemo(
    () => buildContainerBreakdown(selectedSummary?.containerBalances ?? []),
    [selectedSummary]
  );
  const overviewStats = useMemo(() => {
    const totalOnHand = summaryRows.reduce((sum, row) => sum + row.onHand, 0);
    const totalAvailable = summaryRows.reduce((sum, row) => sum + row.availableQty, 0);
    const lowStockRows = summaryRows.filter((row) => row.items.some((item) => item.reorderLevel > 0 && item.availableQty <= item.reorderLevel)).length;
    const totalWarehouses = new Set(summaryRows.flatMap((row) => row.items.map((item) => item.locationId))).size;
    return [
      { label: t("sku"), value: summaryNumberFormatter.format(summaryRows.length), meta: t("allRows") },
      { label: t("onHand"), value: summaryNumberFormatter.format(totalOnHand), meta: t("units") },
      { label: t("availableQty"), value: summaryNumberFormatter.format(totalAvailable), meta: t("units") },
      { label: t("lowStock"), value: summaryNumberFormatter.format(lowStockRows), meta: t("allRows") },
      { label: t("warehouseCount"), value: summaryNumberFormatter.format(totalWarehouses), meta: t("currentStorage") }
    ];
  }, [summaryRows, t]);

  function handleExport({ title, columns }: { title: string; columns: ExcelExportColumn[] }) {
    downloadExcelWorkbook({
      title,
      sheetName: INVENTORY_SUMMARY_EXPORT_TITLE,
      fileName: title,
      columns,
      rows: summaryRows.map((row) => ({
        itemNumber: row.itemNumber || "-",
        sku: row.sku,
        description: row.description,
        customerName: row.customerName,
        onHand: row.onHand,
        availableQty: row.availableQty,
        damagedQty: row.damagedQty,
        warehouseCount: row.warehouseCount,
        containerCount: row.containerCount,
        lastReceipt: formatDateValue(row.lastReceipt, dateFormatter)
      }))
    });
    setIsExportDialogOpen(false);
  }

  return (
    <main className="workspace-main">
      <section className="workbook-panel workbook-panel--full">
        <div className="tab-strip">
          <WorkspacePanelHeader
            title={t("inventorySummary")}
            actions={(
              <div className="sheet-actions">
                <Button
                  variant="outlined"
                  startIcon={<FileDownloadOutlinedIcon fontSize="small" />}
                  onClick={() => setIsExportDialogOpen(true)}
                  disabled={summaryRows.length === 0}
                >
                  {t("exportExcel")}
                </Button>
                {columnOrderAction}
              </div>
            )}
          />
          <div className="filter-bar">
            <label>{t("search")}<input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder={t("inventorySummarySearchPlaceholder")} /></label>
            <label>{t("customer")}<select value={selectedCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)}><option value="all">{t("allCustomers")}</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
            <label>{t("currentStorage")}<select value={selectedLocationId} onChange={(event) => setSelectedLocationId(event.target.value)}><option value="all">{t("allStorage")}</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
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
              rows={summaryRows}
              columns={columns}
              loading={isLoading}
              pagination
              pageSizeOptions={[10, 25, 50, 100]}
              disableRowSelectionOnClick
              initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
              getRowHeight={() => 64}
              onRowClick={(params) => setSelectedSummaryId(params.row.id)}
              getRowClassName={(params) => (params.row.id === selectedSummaryId ? "document-row--selected" : "")}
              slots={mainGridSlots}
              sx={{ border: 0 }}
            />
          </Box>
        </div>
      </section>
      {columnOrderDialog}
      <ExportExcelDialog
        open={isExportDialogOpen}
        defaultTitle={INVENTORY_SUMMARY_EXPORT_TITLE}
        defaultColumns={[...INVENTORY_SUMMARY_EXPORT_COLUMNS]}
        onClose={() => setIsExportDialogOpen(false)}
        onExport={handleExport}
      />

      <Drawer
        anchor="right"
        open={Boolean(selectedSummary)}
        onClose={() => setSelectedSummaryId(null)}
        PaperProps={{ className: "document-drawer" }}
      >
        {selectedSummary ? (
          <div className="document-drawer__content">
            <div className="document-drawer__header">
              <div>
                <div className="document-drawer__eyebrow">{t("inventorySummary")}</div>
                <h3>{selectedSummary.itemNumber ? `${selectedSummary.itemNumber} · ${selectedSummary.sku}` : selectedSummary.sku}</h3>
                <p>{selectedSummary.description} | {selectedSummary.customerName}</p>
              </div>
              <IconButton aria-label={t("close")} onClick={() => setSelectedSummaryId(null)}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </div>

            <div className="document-drawer__actions">
              {canManageInventory ? (
                <Button
                  variant="contained"
                  startIcon={<TuneOutlinedIcon fontSize="small" />}
                  onClick={() => {
                    setPendingInventoryActionContext("adjustments", {
                      sourceKey: buildInventoryActionSourceKey(selectedSummary.customerId, selectedSummary.sku),
                      sku: selectedSummary.sku,
                      customerId: selectedSummary.customerId
                    });
                    onNavigate("adjustments");
                  }}
                >
                  {t("addAdjustment")}
                </Button>
              ) : null}
              {canManageInventory ? (
                <Button
                  variant="outlined"
                  startIcon={<CompareArrowsOutlinedIcon fontSize="small" />}
                  onClick={() => {
                    setPendingInventoryActionContext("transfers", {
                      sourceKey: buildInventoryActionSourceKey(selectedSummary.customerId, selectedSummary.sku),
                      sku: selectedSummary.sku,
                      customerId: selectedSummary.customerId
                    });
                    onNavigate("transfers");
                  }}
                >
                  {t("addTransfer")}
                </Button>
              ) : null}
              <Button
                variant="contained"
                startIcon={<WarehouseOutlinedIcon fontSize="small" />}
                onClick={() => {
                  setPendingInventoryByLocationContext({
                    sku: selectedSummary.sku,
                    customerId: selectedSummary.customerId
                  });
                  onNavigate("stock-by-location");
                }}
              >
                {t("openInventoryByLocation")}
              </Button>
              <Button
                variant="outlined"
                startIcon={<WarehouseOutlinedIcon fontSize="small" />}
                onClick={() => {
                  setPendingContainerContentsContext({
                    sku: selectedSummary.sku,
                    customerId: selectedSummary.customerId
                  });
                  onNavigate("container-contents");
                }}
              >
                {t("openContainerContents")}
              </Button>
              <Button
                variant="outlined"
                startIcon={<HistoryOutlinedIcon fontSize="small" />}
                onClick={() => {
                  setPendingAllActivityContext({
                    customerId: selectedSummary.customerId,
                    searchTerm: selectedSummary.sku
                  });
                  onNavigate("all-activity");
                }}
              >
                {t("allActivity")}
              </Button>
            </div>

            <div className="document-drawer__status-bar">
              <div className="document-drawer__status-stat">
                <strong>{selectedSummary.onHand}</strong>
                <span>{t("onHand")}</span>
              </div>
              <div className="document-drawer__status-stat">
                <strong>{selectedSummary.availableQty}</strong>
                <span>{t("availableQty")}</span>
              </div>
              <div className="document-drawer__status-stat">
                <strong>{selectedSummary.warehouseCount}</strong>
                <span>{t("warehouseCount")}</span>
              </div>
              <div className="document-drawer__status-stat">
                <strong>{selectedSummary.containerCount}</strong>
                <span>{t("containerCount")}</span>
              </div>
            </div>

            <div className="document-drawer__meta">
              <div>
                <strong>{t("description")}</strong>
                <span>{selectedSummary.description}</span>
              </div>
              <div>
                <strong>{t("customer")}</strong>
                <span>{selectedSummary.customerName}</span>
              </div>
              <div>
                <strong>{t("lastReceipt")}</strong>
                <span>{formatDateValue(selectedSummary.lastReceipt, dateFormatter)}</span>
              </div>
              <div>
                <strong>{t("currentInventoryRows")}</strong>
                <span>{selectedSummary.items.length}</span>
              </div>
            </div>

            <div className="document-drawer__section-title">{t("warehouseBreakdown")}</div>
            <div className="document-drawer__list">
              {warehouseBreakdown.map((row) => (
                <div className="document-drawer__list-row" key={row.id}>
                  <div>
                    <strong>{row.locationName}</strong>
                    <span>{row.sections.join(", ") || "-"}</span>
                  </div>
                  <div>
                    <strong>{t("onHand")}</strong>
                    <span>{row.onHand}</span>
                  </div>
                  <div>
                    <strong>{t("availableQty")}</strong>
                    <span>{row.availableQty}</span>
                  </div>
                  <div>
                    <strong>{t("containerCount")}</strong>
                    <span>{row.containerCount}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="document-drawer__section-title">{t("containerBreakdown")}</div>
            <div className="document-drawer__list">
              {containerBreakdown.map((row) => (
                <div className="document-drawer__list-row" key={row.id}>
                  <div>
                    <strong>{row.containerNo || "-"}</strong>
                    <span>{row.locationName} / {row.storageSections.join(", ") || DEFAULT_STORAGE_SECTION}</span>
                  </div>
                  <div>
                    <strong>{t("onHand")}</strong>
                    <span>{row.onHand}</span>
                  </div>
                  <div>
                    <strong>{t("availableQty")}</strong>
                    <span>{row.availableQty}</span>
                  </div>
                  <div>
                    <strong>{t("lastReceipt")}</strong>
                    <span>{formatDateValue(row.lastReceipt, dateFormatter)}</span>
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

function buildInventorySummaryRows(
  items: Item[],
  movements: Movement[],
  normalizedSearch: string,
  selectedCustomerId: string,
  selectedLocationId: string
) {
  const filteredItems = items.filter((item) => {
    const matchesSearch = normalizedSearch.length === 0
      || item.sku.toLowerCase().includes(normalizedSearch)
      || item.itemNumber.toLowerCase().includes(normalizedSearch)
      || displayDescription(item).toLowerCase().includes(normalizedSearch)
      || item.customerName.toLowerCase().includes(normalizedSearch)
      || item.locationName.toLowerCase().includes(normalizedSearch)
      || item.containerNo.toLowerCase().includes(normalizedSearch);
    const matchesCustomer = selectedCustomerId === "all" || item.customerId === Number(selectedCustomerId);
    const matchesLocation = selectedLocationId === "all" || item.locationId === Number(selectedLocationId);
    return matchesSearch && matchesCustomer && matchesLocation;
  });

  const summaryMap = new Map<string, InventorySummaryRow>();

  for (const item of filteredItems) {
    const key = buildInventoryActionSourceKey(item.customerId, item.sku);
    const existing = summaryMap.get(key);
    const receiptDate = item.deliveryDate || item.lastRestockedAt || null;

    if (!existing) {
      const containerBalances = buildItemContainerBalances([item], movements);
      summaryMap.set(key, {
        id: key,
        itemNumber: item.itemNumber,
        sku: item.sku,
        description: displayDescription(item),
        customerId: item.customerId,
        customerName: item.customerName,
        onHand: item.quantity,
        availableQty: item.availableQty,
        allocatedQty: item.allocatedQty,
        damagedQty: item.damagedQty,
        warehouseCount: 1,
        containerCount: new Set(containerBalances.map((balance) => balance.containerNo || `${balance.locationName}/${normalizeStorageSection(balance.storageSection)}`)).size,
        lastReceipt: receiptDate,
        containerBalances,
        items: [item]
      });
      continue;
    }

    existing.onHand += item.quantity;
    existing.availableQty += item.availableQty;
    existing.allocatedQty += item.allocatedQty;
    existing.damagedQty += item.damagedQty;
    if (!existing.itemNumber && item.itemNumber) {
      existing.itemNumber = item.itemNumber;
    }
    existing.items.push(item);
    existing.lastReceipt = getLatestDate(existing.lastReceipt, receiptDate);
  }

  return [...summaryMap.values()]
    .map((row) => {
      const containerBalances = buildItemContainerBalances(row.items, movements);
      return {
        ...row,
        warehouseCount: new Set(containerBalances.map((balance) => balance.locationId)).size,
        containerCount: new Set(containerBalances.map((balance) => balance.containerNo || `${balance.locationName}/${normalizeStorageSection(balance.storageSection)}`)).size,
        containerBalances
      };
    })
    .sort((left, right) => {
      if (left.customerName !== right.customerName) return left.customerName.localeCompare(right.customerName);
      return left.sku.localeCompare(right.sku);
    });
}

function buildWarehouseBreakdown(containerBalances: ItemContainerBalance[]): WarehouseBreakdownRow[] {
  const rowMap = new Map<number, WarehouseBreakdownRow & { containerSet: Set<string> }>();

  for (const balance of containerBalances) {
    const existing = rowMap.get(balance.locationId);
    const receiptDate = Number.isFinite(balance.sortAt) && balance.sortAt > 0 ? new Date(balance.sortAt).toISOString() : null;

    if (!existing) {
      rowMap.set(balance.locationId, {
        id: balance.locationId,
        locationId: balance.locationId,
        locationName: balance.locationName,
        sections: balance.storageSection ? [balance.storageSection] : [],
        onHand: balance.onHandQty,
        availableQty: balance.availableQty,
        allocatedQty: 0,
        damagedQty: 0,
        containerCount: balance.containerNo.trim() ? 1 : 0,
        lastReceipt: receiptDate,
        containerSet: balance.containerNo.trim() ? new Set([balance.containerNo.trim()]) : new Set<string>()
      });
      continue;
    }

    existing.onHand += balance.onHandQty;
    existing.availableQty += balance.availableQty;
    if (balance.storageSection && !existing.sections.includes(balance.storageSection)) {
      existing.sections.push(balance.storageSection);
    }
    if (balance.containerNo.trim()) {
      existing.containerSet.add(balance.containerNo.trim());
      existing.containerCount = existing.containerSet.size;
    }
    existing.lastReceipt = getLatestDate(existing.lastReceipt, receiptDate);
  }

  return [...rowMap.values()]
    .map(({ containerSet: _containerSet, ...row }) => row)
    .sort((left, right) => left.locationName.localeCompare(right.locationName));
}

function buildContainerBreakdown(containerBalances: ItemContainerBalance[]): ContainerBreakdownRow[] {
  const rowMap = new Map<string, ContainerBreakdownRow>();

  for (const balance of containerBalances) {
    const containerNo = balance.containerNo.trim() || "-";
    const key = `${balance.locationId}:${normalizeStorageSection(balance.storageSection)}:${containerNo}`;
    const existing = rowMap.get(key);
    const receiptDate = Number.isFinite(balance.sortAt) && balance.sortAt > 0 ? new Date(balance.sortAt).toISOString() : null;

    if (!existing) {
      rowMap.set(key, {
        id: key,
        containerNo,
        locationName: balance.locationName,
        storageSections: balance.storageSection ? [balance.storageSection] : [],
        onHand: balance.onHandQty,
        availableQty: balance.availableQty,
        lastReceipt: receiptDate
      });
      continue;
    }

    existing.onHand += balance.onHandQty;
    existing.availableQty += balance.availableQty;
    if (balance.storageSection && !existing.storageSections.includes(balance.storageSection)) {
      existing.storageSections.push(balance.storageSection);
    }
    existing.lastReceipt = getLatestDate(existing.lastReceipt, receiptDate);
  }

  return [...rowMap.values()].sort((left, right) => {
    if (left.locationName !== right.locationName) return left.locationName.localeCompare(right.locationName);
    return left.containerNo.localeCompare(right.containerNo);
  });
}

function formatContainerSummary(items: Item[]) {
  const containerTotals = new Map<string, number>();

  for (const item of items) {
    const containerNo = item.containerNo.trim();
    if (!containerNo) continue;
    containerTotals.set(containerNo, (containerTotals.get(containerNo) ?? 0) + item.availableQty);
  }

  if (containerTotals.size === 0) {
    return "";
  }

  return [...containerTotals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([containerNo, quantity]) => `${containerNo}:${quantity}`)
    .join(" · ");
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
