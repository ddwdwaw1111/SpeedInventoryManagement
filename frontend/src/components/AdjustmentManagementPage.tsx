import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import CloseIcon from "@mui/icons-material/Close";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { useEffect, useMemo, useState } from "react";
import { Box, Button, Chip, Drawer, IconButton } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";

import { setPendingAllActivityContext } from "../lib/allActivityContext";
import { formatDateTimeValue } from "../lib/dates";
import { consumePendingInventoryActionContext, type InventoryActionContext } from "../lib/inventoryActionContext";
import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import type { PageKey } from "../lib/routes";
import {
  type InventoryAdjustment,
  type Item,
  type UserRole
} from "../lib/types";
import { ContainerAdjustmentDialog } from "./ContainerAdjustmentDialog";
import { RowActionsMenu } from "./RowActionsMenu";
import { buildWorkspaceGridSlots, WorkspaceDrawerLoadingState, WorkspacePanelHeader } from "./WorkspacePanelChrome";
import { useSharedColumnOrder } from "./useSharedColumnOrder";

type AdjustmentManagementPageProps = {
  adjustments: InventoryAdjustment[];
  items: Item[];
  currentUserRole: UserRole;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
  onNavigate: (page: PageKey) => void;
};

const summaryNumberFormatter = new Intl.NumberFormat("en-US");
const ADJUSTMENT_COLUMN_ORDER_PREFERENCE_KEY = "adjustments.column-order";

export function AdjustmentManagementPage({
  adjustments,
  items,
  currentUserRole,
  isLoading,
  onRefresh,
  onNavigate
}: AdjustmentManagementPageProps) {
  const { t } = useI18n();
  const { resolvedTimeZone } = useSettings();
  const canManage = currentUserRole === "admin" || currentUserRole === "operator";
  const canConfigureColumns = currentUserRole === "admin";
  const pageDescription = t("adjustmentsDesc");
  const permissionNotice = canManage ? "" : t("readOnlyModeNotice");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedAdjustmentId, setSelectedAdjustmentId] = useState<number | null>(null);
  const [dialogInitialSourceKey, setDialogInitialSourceKey] = useState("");
  const [dialogPreferredContainerNo, setDialogPreferredContainerNo] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [hasProcessedLaunchContext, setHasProcessedLaunchContext] = useState(false);
  const selectedAdjustment = useMemo(
    () => adjustments.find((adjustment) => adjustment.id === selectedAdjustmentId) ?? null,
    [adjustments, selectedAdjustmentId]
  );

  useEffect(() => {
    if (selectedAdjustmentId !== null && !selectedAdjustment) {
      setSelectedAdjustmentId(null);
    }
  }, [selectedAdjustment, selectedAdjustmentId]);

  useEffect(() => {
    if (hasProcessedLaunchContext || !canManage || items.length === 0) {
      return;
    }

    setHasProcessedLaunchContext(true);
    const pendingContext = consumePendingInventoryActionContext("adjustments");
    if (!pendingContext) {
      return;
    }

    openCreateModal(pendingContext);
  }, [canManage, hasProcessedLaunchContext, items]);

  const baseColumns = useMemo<GridColDef<InventoryAdjustment>[]>(() => [
    { field: "adjustmentNo", headerName: t("adjustmentNo"), minWidth: 180, flex: 1, renderCell: (params) => <span className="cell--mono">{params.row.adjustmentNo}</span> },
    { field: "reasonCode", headerName: t("reasonCode"), minWidth: 150, flex: 0.9 },
    {
      field: "actualAdjustedAt",
      headerName: t("actualAdjustedAt"),
      minWidth: 220,
      flex: 1,
      valueFormatter: (value) => value ? formatDateTimeValue(String(value), resolvedTimeZone) : "-"
    },
    { field: "totalLines", headerName: t("totalLines"), minWidth: 120, type: "number" },
    {
      field: "totalAdjustQty",
      headerName: t("totalAdjustQty"),
      minWidth: 140,
      type: "number",
      renderCell: (params) => (
        <span style={{ color: params.row.totalAdjustQty >= 0 ? "#3c6e71" : "#b76857", fontWeight: 700 }}>
          {formatSignedNumber(params.row.totalAdjustQty)}
        </span>
      )
    },
    {
      field: "status",
      headerName: t("status"),
      minWidth: 120,
      renderCell: () => <Chip label={t("posted")} color="success" size="small" />
    },
    { field: "notes", headerName: t("notes"), minWidth: 260, flex: 1.4, renderCell: (params) => params.row.notes || "-" },
    { field: "createdAt", headerName: t("created"), minWidth: 220, flex: 1, valueFormatter: (value) => formatDateTimeValue(String(value), resolvedTimeZone) },
    {
      field: "actions",
      headerName: t("actions"),
      minWidth: 90,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <RowActionsMenu
          ariaLabel={t("actions")}
          actions={[
            {
              key: "details",
              label: t("details"),
              icon: <VisibilityOutlinedIcon fontSize="small" />,
              onClick: () => setSelectedAdjustmentId(params.row.id)
            }
          ]}
        />
      )
    }
  ], [resolvedTimeZone, t]);
  const {
    columns,
    columnOrderAction,
    columnOrderDialog
  } = useSharedColumnOrder({
    preferenceKey: ADJUSTMENT_COLUMN_ORDER_PREFERENCE_KEY,
    baseColumns,
    canManage: canConfigureColumns,
    onError: setErrorMessage
  });

  const detailColumns = useMemo<GridColDef<InventoryAdjustment["lines"][number]>[]>(() => [
    { field: "sku", headerName: t("sku"), minWidth: 120, renderCell: (params) => <span className="cell--mono">{params.row.sku}</span> },
    { field: "description", headerName: t("description"), minWidth: 220, flex: 1.4 },
    { field: "customerName", headerName: t("customer"), minWidth: 170, flex: 1 },
    { field: "locationName", headerName: t("currentStorage"), minWidth: 170, flex: 1 },
    { field: "storageSection", headerName: t("storageSection"), minWidth: 110 },
    { field: "containerNo", headerName: t("containerNo"), minWidth: 150, renderCell: (params) => params.row.containerNo || "-" },
    { field: "beforeQty", headerName: t("beforeQty"), minWidth: 120, type: "number" },
    { field: "beforePallets", headerName: `${t("beforeQty")} (${t("pallets")})`, minWidth: 150, type: "number" },
    {
      field: "adjustQty",
      headerName: t("adjustQty"),
      minWidth: 120,
      type: "number",
      renderCell: (params) => (
        <span style={{ color: params.row.adjustQty >= 0 ? "#3c6e71" : "#b76857", fontWeight: 700 }}>
          {formatSignedNumber(params.row.adjustQty)}
        </span>
      )
    },
    { field: "adjustPallets", headerName: `${t("adjustment")} (${t("pallets")})`, minWidth: 150, type: "number", renderCell: (params) => formatSignedNumber(params.row.adjustPallets) },
    { field: "afterQty", headerName: t("afterQty"), minWidth: 120, type: "number" },
    { field: "afterPallets", headerName: `${t("afterQty")} (${t("pallets")})`, minWidth: 150, type: "number" },
    { field: "lineNote", headerName: t("internalNotes"), minWidth: 240, flex: 1.3, renderCell: (params) => params.row.lineNote || "-" }
  ], [t]);
  const mainGridSlots = buildWorkspaceGridSlots({
    emptyTitle: t("noResults"),
    emptyDescription: t("emptyStateHint"),
    loadingTitle: t("loadingRecords"),
    loadingDescription: pageDescription
  });
  const detailGridSlots = buildWorkspaceGridSlots({
    emptyTitle: t("noResults"),
    emptyDescription: t("emptyStateHint"),
    loadingTitle: t("loadingRecords")
  });
  const overviewStats = useMemo(() => {
    const positiveAdjustments = adjustments.filter((adjustment) => adjustment.totalAdjustQty > 0).length;
    const negativeAdjustments = adjustments.filter((adjustment) => adjustment.totalAdjustQty < 0).length;
    const totalAdjustedQty = adjustments.reduce((sum, adjustment) => sum + adjustment.totalAdjustQty, 0);
    return [
      { label: t("allRows"), value: summaryNumberFormatter.format(adjustments.length), meta: t("adjustments") },
      { label: t("totalLines"), value: summaryNumberFormatter.format(adjustments.reduce((sum, adjustment) => sum + adjustment.totalLines, 0)), meta: t("adjustmentLines") },
      { label: t("qtyChange"), value: formatSignedNumber(totalAdjustedQty), meta: t("totalAdjustQty") },
      { label: t("transferIn"), value: summaryNumberFormatter.format(positiveAdjustments), meta: t("adjustment") },
      { label: t("transferOut"), value: summaryNumberFormatter.format(negativeAdjustments), meta: t("adjustment") }
    ];
  }, [adjustments, t]);

  function openCreateModal(initialContext: InventoryActionContext | null = null) {
    if (!canManage) {
      return;
    }
    setDialogInitialSourceKey(initialContext?.sourceKey ?? "");
    setDialogPreferredContainerNo(initialContext?.containerNo ?? "");
    setErrorMessage("");
    setIsModalOpen(true);
  }

  function closeCreateModal() {
    setIsModalOpen(false);
    setErrorMessage("");
    setDialogInitialSourceKey("");
    setDialogPreferredContainerNo("");
  }

  return (
    <main className="workspace-main">
      <section className="workbook-panel workbook-panel--full">
        <div className="tab-strip">
          <WorkspacePanelHeader
            title={t("adjustments")}
            actions={canManage || canConfigureColumns ? (
              <div className="sheet-actions">
                {columnOrderAction}
                {canManage ? (
                  <Button variant="contained" startIcon={<AddCircleOutlineOutlinedIcon />} onClick={() => openCreateModal()}>
                    {t("addAdjustment")}
                  </Button>
                ) : null}
              </div>
            ) : undefined}
            notices={[permissionNotice]}
            errorMessage={errorMessage && !isModalOpen ? errorMessage : ""}
          />
        </div>
        <div className="workspace-summary-strip">
          {overviewStats.map((stat) => (
            <article className="workspace-summary-card" key={`${stat.label}-${stat.meta}`}>
              <span className="workspace-summary-card__label">{stat.label}</span>
              <strong className="workspace-summary-card__value">{stat.value}</strong>
              <span className="workspace-summary-card__meta">{stat.meta}</span>
            </article>
          ))}
        </div>
        <div className="sheet-table-wrap">
          <Box sx={{ minWidth: 0 }}>
            <DataGrid
              rows={adjustments}
              columns={columns}
              loading={isLoading}
              pagination
              pageSizeOptions={[10, 25, 50]}
              disableRowSelectionOnClick
              initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
              getRowHeight={() => 64}
              onRowClick={(params) => setSelectedAdjustmentId(params.row.id)}
              getRowClassName={(params) => (params.row.id === selectedAdjustmentId ? "document-row--selected" : "")}
              slots={mainGridSlots}
              sx={{ border: 0 }}
            />
          </Box>
        </div>
      </section>
      {columnOrderDialog}

      <Drawer
        anchor="right"
        open={selectedAdjustmentId !== null}
        onClose={() => setSelectedAdjustmentId(null)}
        PaperProps={{ className: "document-drawer" }}
      >
        {selectedAdjustment ? (
          <div className="document-drawer__content">
            <div className="document-drawer__header">
              <div>
                <div className="document-drawer__eyebrow">{t("adjustments")}</div>
                <h3>{selectedAdjustment.adjustmentNo}</h3>
                <p>{selectedAdjustment.reasonCode} | {formatDateTimeValue(selectedAdjustment.actualAdjustedAt || selectedAdjustment.createdAt, resolvedTimeZone)}</p>
              </div>
              <IconButton aria-label={t("close")} onClick={() => setSelectedAdjustmentId(null)}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </div>

            <div className="document-drawer__actions">
              <Button
                variant="outlined"
                startIcon={<HistoryOutlinedIcon fontSize="small" />}
                onClick={() => {
                  setPendingAllActivityContext({ movementType: "ADJUST" });
                  onNavigate("all-activity");
                }}
              >
                {t("allActivity")}
              </Button>
            </div>

            <div className="document-drawer__status-bar">
              <div className="document-drawer__status-main">
                <Chip label={t("posted")} color="success" size="small" />
              </div>
              <div className="document-drawer__status-stat">
                <strong>{selectedAdjustment.totalLines}</strong>
                <span>{t("totalLines")}</span>
              </div>
              <div className="document-drawer__status-stat">
                <strong>{formatSignedNumber(selectedAdjustment.totalAdjustQty)}</strong>
                <span>{t("totalAdjustQty")}</span>
              </div>
              <div className="document-drawer__status-stat">
                <strong>{selectedAdjustment.reasonCode}</strong>
                <span>{t("reasonCode")}</span>
              </div>
            </div>

            <div className="document-drawer__audit-strip">
              <div className="document-drawer__audit-item">
                <strong>{t("actualAdjustedAt")}</strong>
                <span>{selectedAdjustment.actualAdjustedAt ? formatDateTimeValue(selectedAdjustment.actualAdjustedAt, resolvedTimeZone) : "-"}</span>
              </div>
              <div className="document-drawer__audit-item">
                <strong>{t("created")}</strong>
                <span>{formatDateTimeValue(selectedAdjustment.createdAt, resolvedTimeZone)}</span>
              </div>
              <div className="document-drawer__audit-item">
                <strong>{t("updated")}</strong>
                <span>{formatDateTimeValue(selectedAdjustment.updatedAt, resolvedTimeZone)}</span>
              </div>
              <div className="document-drawer__audit-item">
                <strong>{t("status")}</strong>
                <span>{selectedAdjustment.status}</span>
              </div>
            </div>

            <div className="document-drawer__meta">
              <div className="sheet-note">
                <strong>{t("reasonCode")}</strong><br />
                {selectedAdjustment.reasonCode}
              </div>
              <div className="sheet-note">
                <strong>{t("actualAdjustedAt")}</strong><br />
                {selectedAdjustment.actualAdjustedAt ? formatDateTimeValue(selectedAdjustment.actualAdjustedAt, resolvedTimeZone) : "-"}
              </div>
              <div className="sheet-note document-drawer__meta-note">
                <strong>{t("notes")}</strong><br />
                {selectedAdjustment.notes || "-"}
              </div>
            </div>

            <div className="document-drawer__section-title">{t("adjustmentLines")}</div>
            <Box sx={{ minWidth: 0 }}>
              <DataGrid
                rows={selectedAdjustment.lines}
                columns={detailColumns}
                pagination
                pageSizeOptions={[10, 25, 50]}
                disableRowSelectionOnClick
                initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
                getRowHeight={() => 64}
                slots={detailGridSlots}
                sx={{ border: 0 }}
              />
            </Box>
          </div>
        ) : isLoading ? <WorkspaceDrawerLoadingState /> : null}
      </Drawer>

      <ContainerAdjustmentDialog
        open={isModalOpen}
        items={items}
        initialSourceKey={dialogInitialSourceKey}
        preferredContainerNo={dialogPreferredContainerNo}
        onClose={closeCreateModal}
        onSaved={onRefresh}
      />

    </main>
  );
}

function formatSignedNumber(value: number) {
  return `${value >= 0 ? "+" : ""}${new Intl.NumberFormat("en-US").format(value)}`;
}
