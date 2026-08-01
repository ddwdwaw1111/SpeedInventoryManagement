import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import CloseIcon from "@mui/icons-material/Close";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { useEffect, useMemo, useState } from "react";
import { Box, Button, Chip, Drawer, IconButton } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";

import { setPendingAllActivityContext } from "../lib/allActivityContext";
import { formatDateTimeValue } from "../lib/dates";
import { consumePendingInventoryActionContext } from "../lib/inventoryActionContext";
import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import type { PageKey } from "../lib/routes";
import {
  type InventoryTransfer,
  type Item,
  type Location,
  type Customer,
  type UserRole
} from "../lib/types";
import { ContainerTransferDialog } from "./ContainerTransferDialog";
import { BulkTransferImportDialog } from "./BulkTransferImportDialog";
import { RowActionsMenu } from "./RowActionsMenu";
import { buildWorkspaceGridSlots, WorkspaceDrawerLoadingState, WorkspacePanelHeader } from "./WorkspacePanelChrome";
import { useSharedColumnOrder } from "./useSharedColumnOrder";

type TransferManagementPageProps = {
  transfers: InventoryTransfer[];
  items: Item[];
  locations: Location[];
  customers: Customer[];
  currentUserRole: UserRole;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
  onNavigate: (page: PageKey) => void;
};

const summaryNumberFormatter = new Intl.NumberFormat("en-US");
const TRANSFER_COLUMN_ORDER_PREFERENCE_KEY = "transfers.column-order";

export function TransferManagementPage({
  transfers,
  items,
  locations,
  customers,
  currentUserRole,
  isLoading,
  onRefresh,
  onNavigate
}: TransferManagementPageProps) {
  const { t } = useI18n();
  const { resolvedTimeZone } = useSettings();
  const canManage = currentUserRole === "admin" || currentUserRole === "operator";
  const canConfigureColumns = currentUserRole === "admin";
  const pageDescription = t("transfersDesc");
  const permissionNotice = canManage ? "" : t("readOnlyModeNotice");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);
  const [selectedTransferId, setSelectedTransferId] = useState<number | null>(null);
  const [dialogInitialSourceKey, setDialogInitialSourceKey] = useState("");
  const [dialogPreferredContainerNo, setDialogPreferredContainerNo] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [hasProcessedLaunchContext, setHasProcessedLaunchContext] = useState(false);
  const selectedTransfer = useMemo(
    () => transfers.find((transfer) => transfer.id === selectedTransferId) ?? null,
    [transfers, selectedTransferId]
  );
  useEffect(() => {
    if (selectedTransferId !== null && !selectedTransfer) {
      setSelectedTransferId(null);
    }
  }, [selectedTransfer, selectedTransferId]);

  useEffect(() => {
    if (hasProcessedLaunchContext || !canManage || !items.some((item) => item.availableQty > 0)) {
      return;
    }

    setHasProcessedLaunchContext(true);
    const pendingContext = consumePendingInventoryActionContext("transfers");
    if (!pendingContext) {
      return;
    }

    openCreateModal(pendingContext.sourceKey ?? "", pendingContext.containerNo ?? "");
  }, [canManage, hasProcessedLaunchContext, items]);

  const baseColumns = useMemo<GridColDef<InventoryTransfer>[]>(() => [
    { field: "transferNo", headerName: t("transferNo"), minWidth: 180, flex: 1, renderCell: (params) => <span className="cell--mono">{params.row.transferNo}</span> },
    {
      field: "actualTransferredAt",
      headerName: t("actualTransferredAt"),
      minWidth: 220,
      flex: 1,
      valueFormatter: (value) => value ? formatDateTimeValue(String(value), resolvedTimeZone) : "-"
    },
    { field: "totalLines", headerName: t("totalLines"), minWidth: 120, type: "number" },
    { field: "totalQty", headerName: t("totalQty"), minWidth: 120, type: "number" },
    { field: "totalSourcePallets", headerName: t("bulkTransferSourcePallets"), minWidth: 190, type: "number" },
    { field: "totalDestinationPallets", headerName: t("bulkTransferDestinationPallets"), minWidth: 205, type: "number" },
    { field: "routes", headerName: t("routes"), minWidth: 280, flex: 1.6, renderCell: (params) => params.row.routes || "-" },
    {
      field: "status",
      headerName: t("status"),
      minWidth: 120,
      renderCell: () => <Chip label={t("posted")} color="success" size="small" />
    },
    { field: "notes", headerName: t("notes"), minWidth: 240, flex: 1.2, renderCell: (params) => params.row.notes || "-" },
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
              onClick: () => setSelectedTransferId(params.row.id)
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
    preferenceKey: TRANSFER_COLUMN_ORDER_PREFERENCE_KEY,
    baseColumns,
    canManage: canConfigureColumns,
    onError: setErrorMessage
  });

  const detailColumns = useMemo<GridColDef<InventoryTransfer["lines"][number]>[]>(() => [
    { field: "sku", headerName: t("sku"), minWidth: 120, renderCell: (params) => <span className="cell--mono">{params.row.sku}</span> },
    { field: "description", headerName: t("description"), minWidth: 220, flex: 1.4 },
    { field: "customerName", headerName: t("customer"), minWidth: 170, flex: 1 },
    { field: "fromLocationName", headerName: t("sourceStorage"), minWidth: 170, flex: 1 },
    { field: "fromStorageSection", headerName: t("fromSection"), minWidth: 110 },
    { field: "containerNo", headerName: t("containerNo"), minWidth: 150 },
    { field: "toLocationName", headerName: t("destinationStorage"), minWidth: 170, flex: 1 },
    { field: "toStorageSection", headerName: t("toSection"), minWidth: 110 },
    { field: "quantity", headerName: t("transferQty"), minWidth: 120, type: "number" },
    { field: "sourcePallets", headerName: t("bulkTransferSourcePallets"), minWidth: 190, type: "number" },
    { field: "destinationPallets", headerName: t("bulkTransferDestinationPallets"), minWidth: 205, type: "number" },
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
    const routeCount = new Set(transfers.map((transfer) => transfer.routes).filter(Boolean)).size;
    return [
      { label: t("allRows"), value: summaryNumberFormatter.format(transfers.length), meta: t("transfers") },
      { label: t("totalLines"), value: summaryNumberFormatter.format(transfers.reduce((sum, transfer) => sum + transfer.totalLines, 0)), meta: t("transferLines") },
      { label: t("totalQty"), value: summaryNumberFormatter.format(transfers.reduce((sum, transfer) => sum + transfer.totalQty, 0)), meta: t("units") },
      { label: t("bulkTransferSourcePallets"), value: summaryNumberFormatter.format(transfers.reduce((sum, transfer) => sum + transfer.totalSourcePallets, 0)), meta: t("transfers") },
      { label: t("bulkTransferDestinationPallets"), value: summaryNumberFormatter.format(transfers.reduce((sum, transfer) => sum + transfer.totalDestinationPallets, 0)), meta: t("transfers") },
      { label: t("routes"), value: summaryNumberFormatter.format(routeCount), meta: t("destinationStorage") }
    ];
  }, [transfers, t]);

  function openCreateModal(initialSourceKey = "", preferredContainerNo = "") {
    if (!canManage) {
      return;
    }
    setDialogInitialSourceKey(initialSourceKey);
    setDialogPreferredContainerNo(preferredContainerNo);
    setIsModalOpen(true);
  }

  function closeCreateModal() {
    setIsModalOpen(false);
    setDialogInitialSourceKey("");
    setDialogPreferredContainerNo("");
  }

  return (
    <main className="workspace-main">
      <section className="workbook-panel workbook-panel--full">
        <div className="tab-strip">
          <WorkspacePanelHeader
            title={t("transfers")}
            actions={canManage || canConfigureColumns ? (
              <div className="sheet-actions">
                {columnOrderAction}
                {canManage ? (
                  <>
                    <Button variant="outlined" startIcon={<UploadFileOutlinedIcon />} onClick={() => setIsBulkImportOpen(true)}>
                      {t("bulkTransferExcel")}
                    </Button>
                    <Button variant="contained" startIcon={<AddCircleOutlineOutlinedIcon />} onClick={() => openCreateModal()}>
                      {t("addTransfer")}
                    </Button>
                  </>
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
              rows={transfers}
              columns={columns}
              loading={isLoading}
              pagination
              pageSizeOptions={[10, 25, 50]}
              disableRowSelectionOnClick
              initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
              getRowHeight={() => 64}
              onRowClick={(params) => setSelectedTransferId(params.row.id)}
              getRowClassName={(params) => (params.row.id === selectedTransferId ? "document-row--selected" : "")}
              slots={mainGridSlots}
              sx={{ border: 0 }}
            />
          </Box>
        </div>
      </section>
      {columnOrderDialog}

      <Drawer
        anchor="right"
        open={selectedTransferId !== null}
        onClose={() => setSelectedTransferId(null)}
        PaperProps={{ className: "document-drawer" }}
      >
        {selectedTransfer ? (
          <div className="document-drawer__content">
            <div className="document-drawer__header">
              <div>
                <div className="document-drawer__eyebrow">{t("transfers")}</div>
                <h3>{selectedTransfer.transferNo}</h3>
                <p>{selectedTransfer.routes || "-"} | {formatDateTimeValue(selectedTransfer.actualTransferredAt || selectedTransfer.createdAt, resolvedTimeZone)}</p>
              </div>
              <IconButton aria-label={t("close")} onClick={() => setSelectedTransferId(null)}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </div>

            <div className="document-drawer__actions">
              <Button
                variant="outlined"
                startIcon={<HistoryOutlinedIcon fontSize="small" />}
                onClick={() => {
                  setPendingAllActivityContext({ movementType: "TRANSFER_OUT" });
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
                <strong>{selectedTransfer.totalLines}</strong>
                <span>{t("totalLines")}</span>
              </div>
              <div className="document-drawer__status-stat">
                <strong>{selectedTransfer.totalQty}</strong>
                <span>{t("totalQty")}</span>
              </div>
              <div className="document-drawer__status-stat">
                <strong>{selectedTransfer.routes || "-"}</strong>
                <span>{t("routes")}</span>
              </div>
            </div>

            <div className="document-drawer__audit-strip">
              <div className="document-drawer__audit-item">
                <strong>{t("actualTransferredAt")}</strong>
                <span>{selectedTransfer.actualTransferredAt ? formatDateTimeValue(selectedTransfer.actualTransferredAt, resolvedTimeZone) : "-"}</span>
              </div>
              <div className="document-drawer__audit-item">
                <strong>{t("created")}</strong>
                <span>{formatDateTimeValue(selectedTransfer.createdAt, resolvedTimeZone)}</span>
              </div>
              <div className="document-drawer__audit-item">
                <strong>{t("updated")}</strong>
                <span>{formatDateTimeValue(selectedTransfer.updatedAt, resolvedTimeZone)}</span>
              </div>
              <div className="document-drawer__audit-item">
                <strong>{t("status")}</strong>
                <span>{selectedTransfer.status}</span>
              </div>
            </div>

            <div className="document-drawer__meta">
              <div className="sheet-note">
                <strong>{t("routes")}</strong><br />
                {selectedTransfer.routes || "-"}
              </div>
              <div className="sheet-note">
                <strong>{t("actualTransferredAt")}</strong><br />
                {selectedTransfer.actualTransferredAt ? formatDateTimeValue(selectedTransfer.actualTransferredAt, resolvedTimeZone) : "-"}
              </div>
              <div className="sheet-note document-drawer__meta-note">
                <strong>{t("notes")}</strong><br />
                {selectedTransfer.notes || "-"}
              </div>
            </div>

            <div className="document-drawer__section-title">{t("transferLines")}</div>
            <Box sx={{ minWidth: 0 }}>
              <DataGrid
                rows={selectedTransfer.lines}
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

      <ContainerTransferDialog
        open={isModalOpen}
        items={items}
        locations={locations}
        initialSourceKey={dialogInitialSourceKey}
        preferredContainerNo={dialogPreferredContainerNo}
        onClose={closeCreateModal}
        onSaved={onRefresh}
      />
      <BulkTransferImportDialog
        open={isBulkImportOpen}
        customers={customers}
        locations={locations}
        items={items}
        onClose={() => setIsBulkImportOpen(false)}
        onImported={onRefresh}
      />

    </main>
  );
}
