import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Box, Button } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";

import { consumePendingContainerContentsContext } from "../lib/containerContentsContext";
import {
  buildContainerContentsRows,
  formatContainerTimelineValue,
  displayContainerItemDescription,
  type ContainerContentsRow
} from "../lib/containerInventory";
import { downloadExcelWorkbook, type ExcelExportCell, type ExcelExportColumn } from "../lib/excelExport";
import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import { normalizeStorageSection, type Customer, type Item, type Location, type Movement, type UserRole } from "../lib/types";
import { ExportExcelDialog } from "./ExportExcelDialog";
import { buildWorkspaceGridSlots, WorkspacePanelHeader } from "./WorkspacePanelChrome";
import { useSharedColumnOrder } from "./useSharedColumnOrder";

type ContainerContentsPageProps = {
  items: Item[];
  movements: Movement[];
  customers: Customer[];
  locations: Location[];
  currentUserRole: UserRole;
  isLoading: boolean;
  onOpenContainerDetail: (containerNo: string) => void;
};
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
  { key: "receivedAt", label: "Received At" },
  { key: "shippedAt", label: "Shipped At" },
  { key: "onHand", label: "On Hand" },
  { key: "availableQty", label: "Available Qty" },
  { key: "damagedQty", label: "Damaged Qty" },
  { key: "holdQty", label: "On Hold Qty" },
  { key: "reorderLevel", label: "Reorder Level" }
] as const;

export function ContainerContentsPage({
  items,
  movements,
  customers,
  locations,
  currentUserRole,
  isLoading,
  onOpenContainerDetail
}: ContainerContentsPageProps) {
  const { t } = useI18n();
  const { resolvedTimeZone } = useSettings();
  const canConfigureColumns = currentUserRole === "admin";
  const pageDescription = t("containerContentsDesc");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("all");
  const [selectedLocationId, setSelectedLocationId] = useState("all");
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
  }, []);

  const normalizedSearch = deferredSearchTerm.trim().toLowerCase();
  const rows = useMemo(
    () => buildContainerContentsRows(items, movements, locations, normalizedSearch, selectedCustomerId, selectedLocationId),
    [items, locations, movements, normalizedSearch, selectedCustomerId, selectedLocationId]
  );
  const hasActiveFilters = normalizedSearch.length > 0 || selectedCustomerId !== "all" || selectedLocationId !== "all";
  const mainGridSlots = buildWorkspaceGridSlots({
    emptyTitle: t("noResults"),
    emptyDescription: hasActiveFilters ? t("filteredStateHint") : t("emptyStateHint"),
    loadingTitle: t("loadingRecords"),
    loadingDescription: pageDescription
  });

  const baseColumns = useMemo<GridColDef<ContainerContentsRow>[]>(() => [
    { field: "containerNo", headerName: t("containerNo"), minWidth: 180, flex: 0.9, renderCell: (params) => <span className="cell--mono">{params.row.containerNo}</span> },
    { field: "warehouseSummary", headerName: t("currentStorage"), minWidth: 200, flex: 1.1 },
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
    { field: "damagedQty", headerName: t("damagedQty"), minWidth: 110, type: "number" },
    {
      field: "actions",
      headerName: t("actions"),
      minWidth: 160,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <Button
          size="small"
          variant="text"
          startIcon={<OpenInNewRoundedIcon fontSize="small" />}
          onClick={() => onOpenContainerDetail(params.row.containerNo)}
          aria-label={`${t("viewContainerDetail")} ${params.row.containerNo}`}
        >
          {t("viewContainerDetail")}
        </Button>
      )
    }
  ], [onOpenContainerDetail, resolvedTimeZone, t]);
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
              damagedQty: item.damagedQty,
              holdQty: item.holdQty,
              reorderLevel: item.reorderLevel
            }))
        : [{
            containerNo: row.containerNo,
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
            damagedQty: 0,
            holdQty: 0,
            reorderLevel: undefined
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
    </main>
  );
}
