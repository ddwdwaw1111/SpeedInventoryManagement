import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import WarehouseOutlinedIcon from "@mui/icons-material/WarehouseOutlined";
import { useEffect, useMemo, useState } from "react";
import { Box, Button, Checkbox } from "@mui/material";
import {
  DataGrid,
  GRID_CHECKBOX_SELECTION_COL_DEF,
  gridPaginatedVisibleSortedGridRowIdsSelector,
  type GridColDef,
  type GridRowId,
  type GridRowSelectionModel,
  useGridApiContext,
  useGridSelector
} from "@mui/x-data-grid";

import { api } from "../lib/api";
import { consumePendingContainerContentsContext } from "../lib/containerContentsContext";
import {
  buildContainerContentsRows,
  formatContainerTimelineValue,
  displayContainerItemDescription,
  type ContainerContentsRow
} from "../lib/containerInventory";
import { getErrorMessage } from "../lib/errors";
import { downloadExcelWorkbook, type ExcelExportCell, type ExcelExportColumn } from "../lib/excelExport";
import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import { normalizeStorageSection, type Customer, type Item, type Location, type Movement, type UserRole } from "../lib/types";
import { ExportExcelDialog } from "./ExportExcelDialog";
import { BulkContainerTransferDialog } from "./BulkContainerTransferDialog";
import { SearchSubmitField } from "./SearchSubmitField";
import { buildWorkspaceGridSlots, InventoryViewSwitcher, WorkspacePanelHeader } from "./WorkspacePanelChrome";
import { useSharedColumnOrder } from "./useSharedColumnOrder";

type ContainerContentsPageProps = {
  items: Item[];
  movements: Movement[];
  customers: Customer[];
  locations: Location[];
  currentUserRole: UserRole;
  isLoading: boolean;
  onOpenContainerDetail: (containerNo: string, customerId: number) => void;
  onOpenContainerLifecycle?: (customerId: number | null, containerNo: string) => void;
  onNavigate: (page: import("../lib/routes").PageKey) => void;
  onRefresh?: () => Promise<void> | void;
};
const CONTAINER_CONTENTS_COLUMN_ORDER_PREFERENCE_KEY = "container-contents.column-order";
const CONTAINER_CONTENTS_MOVEMENT_LOAD_LIMIT = 20000;
const CONTAINER_CONTENTS_EXPORT_TITLE = "Container Contents";
const MAX_BULK_CONTAINER_TRANSFERS = 100;
const CONTAINER_CONTENTS_EXPORT_COLUMNS = [
  { key: "containerNo", label: "Container No." },
  { key: "originalInboundWarehouse", label: "Original Inbound Warehouse" },
  { key: "currentWarehouse", label: "Current Warehouse" },
  { key: "itemNumber", label: "Item #" },
  { key: "sku", label: "UPC" },
  { key: "description", label: "Description" },
  { key: "customerName", label: "Customer" },
  { key: "locationName", label: "Warehouse" },
  { key: "storageSection", label: "Pick Location" },
  { key: "receivedAt", label: "Received At" },
  { key: "shippedAt", label: "Shipped At" },
  { key: "onHand", label: "On Hand" },
  { key: "availableQty", label: "Available Qty" },
  { key: "palletCount", label: "Pallets" },
  { key: "damagedQty", label: "Damaged Qty" },
  { key: "holdQty", label: "On Hold Qty" }
] as const;

export function ContainerContentsPage({
  items,
  movements,
  customers,
  locations,
  currentUserRole,
  isLoading,
  onOpenContainerDetail,
  onOpenContainerLifecycle,
  onNavigate,
  onRefresh = () => undefined
}: ContainerContentsPageProps) {
  const { t } = useI18n();
  const { resolvedTimeZone } = useSettings();
  const canConfigureColumns = currentUserRole === "admin";
  const canManage = currentUserRole === "admin" || currentUserRole === "operator";
  const pageDescription = t("containerContentsDesc");
  const [historyMovements, setHistoryMovements] = useState<Movement[]>(movements);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [submittedSearchTerm, setSubmittedSearchTerm] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("all");
  const [selectedLocationId, setSelectedLocationId] = useState("all");
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [isBulkTransferOpen, setIsBulkTransferOpen] = useState(false);
  const [bulkTransferRows, setBulkTransferRows] = useState<ContainerContentsRow[]>([]);
  const [rowSelectionModel, setRowSelectionModel] = useState<GridRowSelectionModel>({ type: "include", ids: new Set() });

  useEffect(() => {
    const context = consumePendingContainerContentsContext();
    if (!context) {
      return;
    }

    const nextSearchTerm = context.containerNo?.trim() || context.sku?.trim() || "";
    setSearchTerm(nextSearchTerm);
    setSubmittedSearchTerm(nextSearchTerm);
    setSelectedCustomerId(context.customerId ? String(context.customerId) : "all");
    setSelectedLocationId(context.locationId ? String(context.locationId) : "all");
  }, []);

  const normalizedSearch = submittedSearchTerm.trim().toLowerCase();
  const hasActiveFilters = normalizedSearch.length > 0 || selectedCustomerId !== "all" || selectedLocationId !== "all";
  const movementQuery = useMemo(() => ({
    search: normalizedSearch,
    customerId: selectedCustomerId === "all" ? undefined : Number(selectedCustomerId),
    locationId: selectedLocationId === "all" ? undefined : Number(selectedLocationId)
  }), [normalizedSearch, selectedCustomerId, selectedLocationId]);

  useEffect(() => {
    if (!hasActiveFilters) {
      setHistoryMovements(movements);
    }
  }, [hasActiveFilters, movements]);

  useEffect(() => {
    if (!hasActiveFilters) {
      setErrorMessage("");
      setIsHistoryLoading(false);
      return;
    }

    let active = true;

    async function loadFilteredMovementHistory() {
      setIsHistoryLoading(true);
      setErrorMessage("");
      try {
        const nextMovements = await api.getMovements(CONTAINER_CONTENTS_MOVEMENT_LOAD_LIMIT, movementQuery);
        if (!active) return;
        setHistoryMovements(nextMovements);
      } catch (error) {
        if (!active) return;
        setErrorMessage(getErrorMessage(error, t("couldNotLoadReport")));
      } finally {
        if (active) {
          setIsHistoryLoading(false);
        }
      }
    }

    void loadFilteredMovementHistory();
    return () => {
      active = false;
    };
  }, [hasActiveFilters, movementQuery, t]);

  const rows = useMemo(
    () => buildContainerContentsRows(items, historyMovements, locations, normalizedSearch, selectedCustomerId, selectedLocationId),
    [historyMovements, items, locations, normalizedSearch, selectedCustomerId, selectedLocationId]
  );
  const selectedRows = useMemo(() => {
    const selectedIDs = rowSelectionModel.type === "include" ? rowSelectionModel.ids : new Set<GridRowId>();
    return rows.filter((row) => selectedIDs.has(row.id));
  }, [rowSelectionModel, rows]);

  useEffect(() => {
    setRowSelectionModel({ type: "include", ids: new Set() });
  }, [normalizedSearch, selectedCustomerId, selectedLocationId]);

  function openBulkTransfer() {
    // Freeze the visible source scope when the operator opens the dialog. A
    // later data refresh cannot silently rebind a selected container ID to a
    // different warehouse or a different set of inventory lines.
    setBulkTransferRows(selectedRows.map((row) => ({ ...row, items: [...row.items] })));
    setIsBulkTransferOpen(true);
  }

  function closeBulkTransfer() {
    setIsBulkTransferOpen(false);
    setBulkTransferRows([]);
  }
  const mainGridSlots = buildWorkspaceGridSlots({
    emptyTitle: t("noResults"),
    emptyDescription: hasActiveFilters ? t("filteredStateHint") : t("emptyStateHint"),
    loadingTitle: t("loadingRecords"),
    loadingDescription: pageDescription
  });

  const baseColumns = useMemo<GridColDef<ContainerContentsRow>[]>(() => [
    { field: "containerNo", headerName: t("containerNo"), minWidth: 180, flex: 0.9, renderCell: (params) => <span className="cell--mono">{params.row.containerNo}</span> },
    { field: "originalInboundWarehouse", headerName: t("originalInboundWarehouse"), minWidth: 210, flex: 1.1 },
    { field: "warehouseSummary", headerName: t("currentWarehouse"), minWidth: 200, flex: 1.1 },
    { field: "pickLocationSummary", headerName: t("pickLocations"), minWidth: 210, flex: 1.2 },
    { field: "customerSummary", headerName: t("customer"), minWidth: 190, flex: 1.1 },
    {
      field: "receivedAt",
      headerName: t("containerReceivedAt"),
      minWidth: 190,
      flex: 1,
      renderCell: (params) => formatContainerTimelineValue(params.row.receivedAt, resolvedTimeZone)
    },
    {
      field: "shippedAt",
      headerName: t("containerShippedAt"),
      minWidth: 170,
      flex: 0.95,
      renderCell: (params) => formatContainerTimelineValue(params.row.shippedAt, resolvedTimeZone, t("containerNotShipped"))
    },
    { field: "skuCount", headerName: t("skuCount"), minWidth: 110, type: "number" },
    { field: "contentsPreview", headerName: t("contentsPreview"), minWidth: 260, flex: 1.5 },
    { field: "onHand", headerName: t("onHand"), minWidth: 110, type: "number" },
    { field: "availableQty", headerName: t("availableQty"), minWidth: 120, type: "number" },
    { field: "palletCount", headerName: t("pallets"), minWidth: 105, type: "number" },
    { field: "damagedQty", headerName: t("damagedQty"), minWidth: 110, type: "number" },
    {
      field: "actions",
      headerName: t("actions"),
      minWidth: 260,
      sortable: false,
      filterable: false,
      renderCell: (params) => {
        const lifecycleCustomerId = params.row.customerId;
        return (
          <div className="flex flex-wrap gap-1">
            <Button
              size="small"
              variant="text"
              startIcon={<OpenInNewRoundedIcon fontSize="small" />}
              onClick={() => onOpenContainerDetail(params.row.containerNo, params.row.customerId)}
              aria-label={`${t("viewContainerDetail")} ${params.row.containerNo}`}
            >
              {t("viewContainerDetail")}
            </Button>
            <Button
              size="small"
              variant="text"
              startIcon={<OpenInNewRoundedIcon fontSize="small" />}
              onClick={() => onOpenContainerLifecycle?.(lifecycleCustomerId, params.row.containerNo)}
              disabled={!onOpenContainerLifecycle}
              aria-label={`${t("openContainerLifecycle")} ${params.row.containerNo}`}
            >
              {t("openContainerLifecycle")}
            </Button>
          </div>
        );
      }
    }
  ], [onOpenContainerDetail, onOpenContainerLifecycle, resolvedTimeZone, t]);
  const selectionColumn = useMemo<GridColDef<ContainerContentsRow>>(() => ({
    ...GRID_CHECKBOX_SELECTION_COL_DEF,
    renderHeader: () => (
      <CurrentPageContainerSelectionHeader
        selection={rowSelectionModel}
        maximum={MAX_BULK_CONTAINER_TRANSFERS}
        ariaLabel={t("selectCurrentPage")}
        onChange={setRowSelectionModel}
        onLimitExceeded={() => setErrorMessage(t("bulkContainerSelectionLimit", { count: MAX_BULK_CONTAINER_TRANSFERS }))}
      />
    )
  }), [rowSelectionModel, t]);
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
    const detailRows: Array<Record<string, ExcelExportCell>> = rows.flatMap((row): Array<Record<string, ExcelExportCell>> =>
      row.items.length > 0
        ? [...row.items]
            .sort((left, right) => {
              if (left.customerName !== right.customerName) return left.customerName.localeCompare(right.customerName);
              if (left.sku !== right.sku) return left.sku.localeCompare(right.sku);
              if (left.locationName !== right.locationName) return left.locationName.localeCompare(right.locationName);
              return normalizeStorageSection(left.storageSection).localeCompare(normalizeStorageSection(right.storageSection));
            })
            .map((item) => ({
              containerNo: row.containerNo,
              originalInboundWarehouse: row.originalInboundWarehouse,
              currentWarehouse: row.warehouseSummary,
              itemNumber: item.itemNumber || "-",
              sku: item.sku,
              description: displayContainerItemDescription(item),
              customerName: item.customerName,
              locationName: item.locationName,
              storageSection: normalizeStorageSection(item.storageSection),
              receivedAt: formatContainerTimelineValue(row.receivedAt, resolvedTimeZone),
              shippedAt: formatContainerTimelineValue(row.shippedAt, resolvedTimeZone, t("containerNotShipped")),
              onHand: item.quantity,
              availableQty: item.availableQty,
              palletCount: item.pallets,
              damagedQty: item.damagedQty,
              holdQty: item.holdQty
            }))
        : [{
            containerNo: row.containerNo,
            originalInboundWarehouse: row.originalInboundWarehouse,
            currentWarehouse: row.warehouseSummary,
            itemNumber: "-",
            sku: row.contentsPreview,
            description: t("containerHistoryRecord"),
            customerName: row.customerSummary,
            locationName: row.warehouseSummary,
            storageSection: row.pickLocationSummary,
            receivedAt: formatContainerTimelineValue(row.receivedAt, resolvedTimeZone),
            shippedAt: formatContainerTimelineValue(row.shippedAt, resolvedTimeZone, t("containerNotShipped")),
            onHand: 0,
            availableQty: 0,
            palletCount: 0,
            damagedQty: 0,
            holdQty: 0
          }]
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

  function submitSearchTerm() {
    const nextSearchTerm = searchTerm.trim();
    setRowSelectionModel({ type: "include", ids: new Set() });
    setSearchTerm(nextSearchTerm);
    setSubmittedSearchTerm(nextSearchTerm);
  }

  function changeCustomerFilter(customerId: string) {
    setRowSelectionModel({ type: "include", ids: new Set() });
    setSelectedCustomerId(customerId);
  }

  function changeLocationFilter(locationId: string) {
    setRowSelectionModel({ type: "include", ids: new Set() });
    setSelectedLocationId(locationId);
  }

  return (
    <main className="workspace-main">
      <section className="workbook-panel workbook-panel--full">
        <div className="tab-strip">
          <WorkspacePanelHeader
            title={t("containerContents")}
            errorMessage={errorMessage}
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
                {canManage ? (
                  <Button
                    variant="contained"
                    startIcon={<WarehouseOutlinedIcon fontSize="small" />}
                    onClick={openBulkTransfer}
                    disabled={selectedRows.length === 0}
                  >
                    {t("bulkContainerTransferSelected", { count: selectedRows.length })}
                  </Button>
                ) : null}
                {columnOrderAction}
              </div>
            )}
          />
          <div className="filter-bar">
            <SearchSubmitField
              label={t("search")}
              value={searchTerm}
              onChange={setSearchTerm}
              onSubmit={submitSearchTerm}
              placeholder={t("containerContentsSearchPlaceholder")}
              submitTitle={`${t("search")} (Enter)`}
            />
            <label>{t("customer")}<select value={selectedCustomerId} onChange={(event) => changeCustomerFilter(event.target.value)}><option value="all">{t("allCustomers")}</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
            <label>{t("currentStorage")}<select value={selectedLocationId} onChange={(event) => changeLocationFilter(event.target.value)}><option value="all">{t("allStorage")}</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
          </div>
        </div>
        <InventoryViewSwitcher activeView="container-contents" onNavigate={onNavigate} />

        <div className="sheet-table-wrap">
          <Box sx={{ minWidth: 0 }}>
            <DataGrid
              rows={rows}
              columns={canManage ? [selectionColumn, ...columns] : columns}
              loading={isLoading || isHistoryLoading}
              pagination
              checkboxSelection={canManage}
              disableRowSelectionExcludeModel
              rowSelectionModel={rowSelectionModel}
              onRowSelectionModelChange={(nextSelection) => {
                if (nextSelection.type !== "include" || nextSelection.ids.size > MAX_BULK_CONTAINER_TRANSFERS) {
                  setErrorMessage(t("bulkContainerSelectionLimit", { count: MAX_BULK_CONTAINER_TRANSFERS }));
                  return;
                }
                setRowSelectionModel(nextSelection);
              }}
              isRowSelectable={(params) => params.row.items.some((item) => item.quantity > 0 || item.pallets > 0)}
              pageSizeOptions={[10, 25, 50, 100]}
              disableRowSelectionOnClick
              initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
              getRowHeight={() => 68}
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
      <BulkContainerTransferDialog
        open={isBulkTransferOpen}
        rows={bulkTransferRows}
        locations={locations}
        onClose={closeBulkTransfer}
        onSaved={async () => {
          await onRefresh();
          setRowSelectionModel({ type: "include", ids: new Set() });
        }}
      />
    </main>
  );
}

function CurrentPageContainerSelectionHeader({
  selection,
  maximum,
  ariaLabel,
  onChange,
  onLimitExceeded
}: {
  selection: GridRowSelectionModel;
  maximum: number;
  ariaLabel: string;
  onChange: (selection: GridRowSelectionModel) => void;
  onLimitExceeded: () => void;
}) {
  const apiRef = useGridApiContext();
  const paginatedIDs = useGridSelector(apiRef, gridPaginatedVisibleSortedGridRowIdsSelector);
  const currentPageIDs = paginatedIDs.filter((id) => apiRef.current.isRowSelectable(id));
  const selectedCount = currentPageIDs.filter((id) => selection.ids.has(id)).length;

  return (
    <Checkbox
      size="small"
      checked={currentPageIDs.length > 0 && selectedCount === currentPageIDs.length}
      indeterminate={selectedCount > 0 && selectedCount < currentPageIDs.length}
      inputProps={{ "aria-label": ariaLabel }}
      onChange={() => {
        const nextIDs = new Set(selection.type === "include" ? selection.ids : []);
        const allCurrentPageSelected = currentPageIDs.length > 0 && currentPageIDs.every((id) => nextIDs.has(id));
        currentPageIDs.forEach((id) => allCurrentPageSelected ? nextIDs.delete(id) : nextIDs.add(id));
        if (nextIDs.size > maximum) {
          onLimitExceeded();
          return;
        }
        onChange({ type: "include", ids: nextIDs });
      }}
    />
  );
}
