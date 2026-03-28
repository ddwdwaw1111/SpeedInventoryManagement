import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import { Box, Button, Chip } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { useMemo, useState } from "react";

import { api } from "../lib/api";
import { formatDateTimeValue } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import type { Item, Location, UserRole } from "../lib/types";
import { useConfirmDialog } from "./Feedback";
import { RowActionsMenu } from "./RowActionsMenu";
import { buildWorkspaceGridSlots, WorkspacePanelHeader } from "./WorkspacePanelChrome";
import { useSharedColumnOrder } from "./useSharedColumnOrder";

type StorageManagementPageProps = {
  locations: Location[];
  items: Item[];
  currentUserRole: UserRole;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
  onCreateLocation: () => void;
  onEditLocation: (locationId: number) => void;
};

const STORAGE_MANAGEMENT_COLUMN_ORDER_PREFERENCE_KEY = "storage-management.column-order";

export function StorageManagementPage({
  locations,
  items,
  currentUserRole,
  isLoading,
  onRefresh,
  onCreateLocation,
  onEditLocation
}: StorageManagementPageProps) {
  const { t } = useI18n();
  const { resolvedTimeZone } = useSettings();
  const { confirm, confirmationDialog } = useConfirmDialog();
  const canManage = currentUserRole === "admin";
  const pageDescription = t("storageManagementDesc");
  const permissionNotice = canManage ? "" : t("adminOnlyManageNotice");
  const [errorMessage, setErrorMessage] = useState("");

  const locationUsage = useMemo(() => {
    const usageMap = new Map<number, number>();
    items.forEach((item) => {
      usageMap.set(item.locationId, (usageMap.get(item.locationId) ?? 0) + 1);
    });
    return usageMap;
  }, [items]);

  const mainGridSlots = buildWorkspaceGridSlots({
    emptyTitle: t("noResults"),
    emptyDescription: t("emptyStateHint"),
    loadingTitle: t("loadingRecords"),
    loadingDescription: pageDescription
  });

  async function handleDelete(location: Location) {
    if (!canManage) return;
    if (!(await confirm({
      title: t("delete"),
      message: t("deleteStorageConfirm", { name: location.name }),
      confirmLabel: t("delete"),
      cancelLabel: t("cancel"),
      confirmColor: "error",
      severity: "warning"
    }))) return;

    setErrorMessage("");
    try {
      await api.deleteLocation(location.id);
      await onRefresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("couldNotDeleteLocation"));
    }
  }

  const baseColumns = useMemo<GridColDef<Location>[]>(() => [
    { field: "name", headerName: t("storageName"), minWidth: 180, flex: 1 },
    { field: "address", headerName: t("address"), minWidth: 260, flex: 1.4, renderCell: (params) => params.value || "-" },
    { field: "zone", headerName: t("zone"), minWidth: 140, flex: 0.9 },
    { field: "capacity", headerName: t("capacity"), minWidth: 110, type: "number" },
    {
      field: "sectionNames",
      headerName: t("storageSections"),
      minWidth: 220,
      flex: 1.15,
      valueGetter: (_, row) => row.sectionNames.join(", ")
    },
    {
      field: "layoutBlocks",
      headerName: t("warehouseAreas"),
      minWidth: 130,
      type: "number",
      valueGetter: (_, row) => row.layoutBlocks.length
    },
    {
      field: "assignedSkuRows",
      headerName: t("assignedSkuRows"),
      minWidth: 150,
      type: "number",
      valueGetter: (_, row) => locationUsage.get(row.id) ?? 0
    },
    { field: "description", headerName: t("notes"), minWidth: 240, flex: 1.2, renderCell: (params) => params.value || "-" },
    { field: "createdAt", headerName: t("created"), minWidth: 220, valueFormatter: (value) => formatDateTimeValue(String(value), resolvedTimeZone) },
    {
      field: "status",
      headerName: t("status"),
      minWidth: 120,
      sortable: false,
      filterable: false,
      renderCell: (params) => (locationUsage.get(params.row.id) ?? 0) > 0
        ? <Chip label={t("active")} color="info" size="small" />
        : <Chip label={t("empty")} size="small" />
    },
    {
      field: "actions",
      headerName: t("actions"),
      minWidth: 90,
      sortable: false,
      filterable: false,
      renderCell: (params) => canManage ? (
        <RowActionsMenu
          ariaLabel={t("actions")}
          actions={[
            { key: "edit", label: t("edit"), icon: <EditOutlinedIcon fontSize="small" />, onClick: () => onEditLocation(params.row.id) },
            { key: "delete", label: t("delete"), icon: <DeleteOutlineOutlinedIcon fontSize="small" />, danger: true, onClick: () => handleDelete(params.row) }
          ]}
        />
      ) : null
    }
  ], [canManage, locationUsage, onEditLocation, resolvedTimeZone, t]);

  const {
    columns,
    columnOrderAction,
    columnOrderDialog
  } = useSharedColumnOrder({
    preferenceKey: STORAGE_MANAGEMENT_COLUMN_ORDER_PREFERENCE_KEY,
    baseColumns,
    canManage,
    onError: setErrorMessage
  });

  return (
    <main className="workspace-main">
      <section className="workbook-panel workbook-panel--full">
        <div className="tab-strip">
          <WorkspacePanelHeader
            title={t("storageManagement")}
            actions={canManage ? (
              <div className="sheet-actions">
                {columnOrderAction}
                <Button variant="contained" startIcon={<AddCircleOutlineOutlinedIcon />} onClick={onCreateLocation}>
                  {t("addLocation")}
                </Button>
              </div>
            ) : undefined}
            notices={[permissionNotice]}
            errorMessage={errorMessage}
          />
        </div>
        <div className="sheet-table-wrap">
          <Box sx={{ minWidth: 0 }}>
            <DataGrid
              rows={locations}
              columns={columns}
              loading={isLoading}
              pagination
              pageSizeOptions={[8, 16, 32]}
              disableRowSelectionOnClick
              initialState={{ pagination: { paginationModel: { pageSize: 8, page: 0 } } }}
              getRowHeight={() => 64}
              slots={mainGridSlots}
              sx={{ border: 0 }}
            />
          </Box>
        </div>
      </section>
      {columnOrderDialog}
      {confirmationDialog}
    </main>
  );
}
