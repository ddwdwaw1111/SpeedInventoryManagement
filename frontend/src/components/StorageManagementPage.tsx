import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import DriveFileRenameOutlineOutlinedIcon from "@mui/icons-material/DriveFileRenameOutlineOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { useEffect, useMemo, useState } from "react";

import { api } from "../lib/api";
import { formatDateTimeValue } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import { consumePageFeedback } from "../lib/pageFeedback";
import { useSettings } from "../lib/settings";
import {
  DEFAULT_STORAGE_SECTION,
  normalizeStorageSection,
  type Item,
  type Location,
  type StorageLayoutBlock,
  type UserRole
} from "../lib/types";
import { useConfirmDialog, useFeedbackToast } from "./Feedback";
import { RowActionsMenu } from "./RowActionsMenu";
import { buildWorkspaceGridSlots } from "./WorkspacePanelChrome";
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
  const { showSuccess, showError, feedbackToast } = useFeedbackToast();
  const canManage = currentUserRole === "admin";
  const pageDescription = t("storageManagementDesc");
  const permissionNotice = canManage ? "" : t("adminOnlyManageNotice");
  const [errorMessage, setErrorMessage] = useState("");
  const [renameTarget, setRenameTarget] = useState<Location | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState("");
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  const [sectionRenameTarget, setSectionRenameTarget] = useState<Location | null>(null);
  const [sectionRenameBlocks, setSectionRenameBlocks] = useState<StorageLayoutBlock[]>([]);
  const [sectionRenameError, setSectionRenameError] = useState("");
  const [sectionRenameSubmitting, setSectionRenameSubmitting] = useState(false);

  useEffect(() => {
    const pendingNotice = consumePageFeedback();
    if (!pendingNotice) {
      return;
    }

    if (pendingNotice.severity === "success") {
      showSuccess(pendingNotice.message);
      return;
    }

    showError(pendingNotice.message);
  }, [showError, showSuccess]);

  const locationUsage = useMemo(() => {
    const usageMap = new Map<number, number>();
    items.forEach((item) => {
      usageMap.set(item.locationId, (usageMap.get(item.locationId) ?? 0) + 1);
    });
    return usageMap;
  }, [items]);

  const locationSummary = useMemo(() => {
    const temporaryAreas = locations.reduce(
      (sum, location) => sum + location.layoutBlocks.filter((block) => block.type === "temporary").length,
      0
    );
    const formalSections = locations.reduce(
      (sum, location) => sum + location.layoutBlocks.filter((block) => block.type === "section").length,
      0
    );
    const assignedRows = Array.from(locationUsage.values()).reduce((sum, value) => sum + value, 0);
    return [
      { label: t("storageManagement"), value: locations.length },
      { label: t("temporaryArea"), value: temporaryAreas },
      { label: t("formalSection"), value: formalSections },
      { label: t("assignedSkuRows"), value: assignedRows }
    ];
  }, [locationUsage, locations, t]);

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
      showSuccess(t("locationDeletedSuccess"));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("couldNotDeleteLocation");
      setErrorMessage(message);
      showError(message);
    }
  }

  function openRenameDialog(location: Location) {
    if (!canManage) return;
    setRenameTarget(location);
    setRenameValue(location.name);
    setRenameError("");
  }

  function openSectionRenameDialog(location: Location) {
    if (!canManage) return;
    setSectionRenameTarget(location);
    setSectionRenameBlocks(location.layoutBlocks.map((block) => ({ ...block })));
    setSectionRenameError("");
  }

  function closeSectionRenameDialog(force = false) {
    if (sectionRenameSubmitting && !force) {
      return;
    }

    setSectionRenameTarget(null);
    setSectionRenameBlocks([]);
    setSectionRenameError("");
  }

  function closeRenameDialog(force = false) {
    if (renameSubmitting && !force) {
      return;
    }

    setRenameTarget(null);
    setRenameValue("");
    setRenameError("");
  }

  async function handleRenameSubmit() {
    if (!canManage || !renameTarget) {
      return;
    }

    const nextName = renameValue.trim();
    if (!nextName) {
      setRenameError(t("warehouseNameRequired"));
      return;
    }

    setRenameSubmitting(true);
    setRenameError("");

    try {
      await api.updateLocation(renameTarget.id, {
        name: nextName,
        address: renameTarget.address,
        description: renameTarget.description,
        capacity: renameTarget.capacity,
        sectionNames: renameTarget.sectionNames,
        layoutBlocks: renameTarget.layoutBlocks
      });
      await onRefresh();
      showSuccess(t("locationRenamedSuccess", { name: nextName }));
      closeRenameDialog(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("couldNotSaveLocation");
      setRenameError(message);
      showError(message);
    } finally {
      setRenameSubmitting(false);
    }
  }

  async function handleSectionRenameSubmit() {
    if (!canManage || !sectionRenameTarget) {
      return;
    }

    if (sectionRenameBlocks.some((block) => block.type === "section" && block.name.trim().length === 0)) {
      setSectionRenameError(t("sectionRenameRequired"));
      return;
    }

    const sanitizedBlocks = sectionRenameBlocks.map((block) => (
      block.type === "section"
        ? { ...block, name: normalizeStorageSection(block.name) }
        : block
    ));
    const sectionNames = deriveEditableSectionNames(sanitizedBlocks);

    if (new Set(sectionNames).size !== sectionNames.length) {
      setSectionRenameError(t("sectionRenameDuplicate"));
      return;
    }

    setSectionRenameSubmitting(true);
    setSectionRenameError("");

    try {
      await api.updateLocation(sectionRenameTarget.id, {
        name: sectionRenameTarget.name,
        address: sectionRenameTarget.address,
        description: sectionRenameTarget.description,
        capacity: sectionRenameTarget.capacity,
        sectionNames,
        layoutBlocks: sanitizedBlocks
      });
      await onRefresh();
      showSuccess(t("sectionRenameSavedSuccess"));
      closeSectionRenameDialog(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("couldNotSaveLocation");
      setSectionRenameError(message);
      showError(message);
    } finally {
      setSectionRenameSubmitting(false);
    }
  }

  const baseColumns = useMemo<GridColDef<Location>[]>(() => [
    { field: "name", headerName: t("storageName"), minWidth: 180, flex: 1 },
    { field: "address", headerName: t("address"), minWidth: 260, flex: 1.4, renderCell: (params) => params.value || "-" },
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
        ? <Chip label={t("active")} size="small" sx={{ borderRadius: "999px", bgcolor: "#d1e3fb", color: "#1b365d", fontWeight: 700 }} />
        : <Chip label={t("empty")} size="small" sx={{ borderRadius: "999px", bgcolor: "#e9eef3", color: "#54647a", fontWeight: 700 }} />
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
            { key: "rename", label: t("renameWarehouse"), icon: <DriveFileRenameOutlineOutlinedIcon fontSize="small" />, onClick: () => openRenameDialog(params.row) },
            { key: "rename-sections", label: t("renameSections"), icon: <EditOutlinedIcon fontSize="small" />, onClick: () => openSectionRenameDialog(params.row) },
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
      <section className="mx-auto flex w-full max-w-[1680px] flex-col gap-6">
        <header className="tw-panel flex flex-col gap-5 px-6 py-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <p className="tw-kicker m-0">{t("storageManagement")}</p>
              <div className="space-y-1">
                <h1 className="tw-heading-xl m-0">{t("storageManagement")}</h1>
                <p className="tw-body-muted m-0 max-w-3xl">{pageDescription}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {canManage ? columnOrderAction : null}
              {canManage ? (
                <button className="tw-btn-primary" type="button" onClick={onCreateLocation}>
                  <AddCircleOutlineOutlinedIcon fontSize="small" />
                  {t("addLocation")}
                </button>
              ) : null}
            </div>
          </div>

          {permissionNotice ? <div className="tw-notice-amber">{permissionNotice}</div> : null}
          {errorMessage ? <div className="tw-notice-rose">{errorMessage}</div> : null}
        </header>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {locationSummary.map((metric) => (
            <article key={metric.label} className="tw-stat-card">
              <p className="tw-kicker m-0">{metric.label}</p>
              <strong className="mt-2 block text-[2rem] font-semibold tracking-tight text-slate-950">{metric.value}</strong>
            </article>
          ))}
        </section>

        <section className="tw-panel flex flex-col gap-4 px-6 py-6">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200/80 pb-4">
            <div className="space-y-1">
              <p className="tw-kicker m-0">{t("directory")}</p>
              <h2 className="tw-heading-lg m-0">{t("warehouseDirectory")}</h2>
              <p className="tw-body-muted m-0">{t("warehouseDirectoryDesc")}</p>
            </div>
            <div className="rounded-xl bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-600 ring-1 ring-slate-200">
              {t("recordCount")}: {locations.length}
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white">
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
                sx={{
                  border: 0,
                  bgcolor: "#ffffff",
                  "& .MuiDataGrid-columnHeaders": {
                    bgcolor: "#e4e9ed",
                    borderBottom: "1px solid rgba(196,198,207,0.45)"
                  },
                  "& .MuiDataGrid-columnHeaderTitle": {
                    fontWeight: 800,
                    fontSize: "0.7rem",
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: "#54647a"
                  },
                  "& .MuiDataGrid-row": {
                    bgcolor: "#ffffff",
                    transition: "background-color 160ms ease"
                  },
                  "& .MuiDataGrid-row:hover": {
                    bgcolor: "#f6fafe"
                  },
                  "& .MuiDataGrid-cell": {
                    borderColor: "rgba(223,227,231,0.8)"
                  },
                  "& .MuiDataGrid-footerContainer": {
                    borderTop: "1px solid rgba(223,227,231,0.9)",
                    bgcolor: "#f0f4f8"
                  }
                }}
              />
            </Box>
          </div>
        </section>
      </section>
      {feedbackToast}
      {columnOrderDialog}
      {confirmationDialog}
      <Dialog open={renameTarget !== null} onClose={() => closeRenameDialog()} fullWidth maxWidth="sm">
        <DialogTitle>{t("renameWarehouse")}</DialogTitle>
        <DialogContent dividers>
          <div className="flex flex-col gap-4 pt-1">
            <p className="m-0 text-sm leading-6 text-slate-600">
              {t("renameWarehouseDesc", { name: renameTarget?.name ?? "" })}
            </p>
            <TextField
              autoFocus
              label={t("storageName")}
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleRenameSubmit();
                }
              }}
              error={Boolean(renameError)}
              helperText={renameError || " "}
              fullWidth
            />
          </div>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => closeRenameDialog()} disabled={renameSubmitting}>{t("cancel")}</Button>
          <Button variant="contained" onClick={() => void handleRenameSubmit()} disabled={renameSubmitting}>
            {renameSubmitting ? t("saving") : t("saveChanges")}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={sectionRenameTarget !== null} onClose={() => closeSectionRenameDialog()} fullWidth maxWidth="sm">
        <DialogTitle>{t("renameSections")}</DialogTitle>
        <DialogContent dividers>
          <div className="flex flex-col gap-4 pt-1">
            <p className="m-0 text-sm leading-6 text-slate-600">
              {t("renameSectionsDesc", { name: sectionRenameTarget?.name ?? "" })}
            </p>
            {sectionRenameBlocks.filter((block) => block.type === "section").map((block) => (
              <TextField
                key={block.id}
                label={t("sectionName")}
                value={block.name}
                onChange={(event) => {
                  const nextName = event.target.value;
                  setSectionRenameBlocks((current) => current.map((entry) => (
                    entry.id === block.id ? { ...entry, name: nextName } : entry
                  )));
                }}
                fullWidth
              />
            ))}
            {sectionRenameBlocks.every((block) => block.type !== "section") ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                {t("renameSectionsEmpty")}
              </div>
            ) : null}
            {sectionRenameError ? <div className="tw-notice-rose">{sectionRenameError}</div> : null}
          </div>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => closeSectionRenameDialog()} disabled={sectionRenameSubmitting}>{t("cancel")}</Button>
          <Button
            variant="contained"
            onClick={() => void handleSectionRenameSubmit()}
            disabled={sectionRenameSubmitting || sectionRenameBlocks.every((block) => block.type !== "section")}
          >
            {sectionRenameSubmitting ? t("saving") : t("saveChanges")}
          </Button>
        </DialogActions>
      </Dialog>
    </main>
  );
}

function deriveEditableSectionNames(layoutBlocks: StorageLayoutBlock[]) {
  const sectionNames = layoutBlocks
    .filter((block) => block.type === "section")
    .map((block) => normalizeStorageSection(block.name))
    .filter((sectionName) => sectionName.length > 0);

  return [DEFAULT_STORAGE_SECTION, ...sectionNames];
}
