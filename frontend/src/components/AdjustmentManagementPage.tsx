import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import CloseIcon from "@mui/icons-material/Close";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Box, Button, Chip, Dialog, DialogContent, DialogTitle, Drawer, IconButton } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";

import { api } from "../lib/api";
import { setPendingAllActivityContext } from "../lib/allActivityContext";
import { formatDateTimeValue } from "../lib/dates";
import { consumePendingInventoryActionContext } from "../lib/inventoryActionContext";
import { buildInventoryActionSourceOptions } from "../lib/inventoryActionSources";
import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import type { PageKey } from "../lib/routes";
import { normalizeStorageSection, type InventoryAdjustment, type Item, type UserRole } from "../lib/types";
import { InlineAlert, useFeedbackToast } from "./Feedback";
import { RowActionsMenu } from "./RowActionsMenu";
import { buildWorkspaceGridSlots, WorkspacePanelHeader } from "./WorkspacePanelChrome";
import { useSharedColumnOrder } from "./useSharedColumnOrder";

type AdjustmentManagementPageProps = {
  adjustments: InventoryAdjustment[];
  items: Item[];
  currentUserRole: UserRole;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
  onNavigate: (page: PageKey) => void;
};

type AdjustmentFormState = {
  adjustmentNo: string;
  reasonCode: string;
  notes: string;
};

type AdjustmentLineFormState = {
  id: string;
  itemId: string;
  adjustQty: number;
  lineNote: string;
};

const emptyAdjustmentForm: AdjustmentFormState = {
  adjustmentNo: "",
  reasonCode: "",
  notes: ""
};
const ADJUSTMENT_COLUMN_ORDER_PREFERENCE_KEY = "adjustments.column-order";

function createAdjustmentLine(): AdjustmentLineFormState {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    itemId: "",
    adjustQty: 0,
    lineNote: ""
  };
}

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
  const { showSuccess, showError, feedbackToast } = useFeedbackToast();
  const canManage = currentUserRole === "admin" || currentUserRole === "operator";
  const canConfigureColumns = currentUserRole === "admin";
  const pageDescription = t("adjustmentsDesc");
  const permissionNotice = canManage ? "" : t("readOnlyModeNotice");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedAdjustmentId, setSelectedAdjustmentId] = useState<number | null>(null);
  const [form, setForm] = useState<AdjustmentFormState>(emptyAdjustmentForm);
  const [lines, setLines] = useState<AdjustmentLineFormState[]>([createAdjustmentLine()]);
  const [selectedSourceKey, setSelectedSourceKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [hasProcessedLaunchContext, setHasProcessedLaunchContext] = useState(false);
  const selectedAdjustment = useMemo(
    () => adjustments.find((adjustment) => adjustment.id === selectedAdjustmentId) ?? null,
    [adjustments, selectedAdjustmentId]
  );
  const adjustmentSourceOptions = useMemo(
    () => buildInventoryActionSourceOptions(items),
    [items]
  );
  const selectedSourceOption = useMemo(
    () => adjustmentSourceOptions.find((option) => option.key === selectedSourceKey) ?? null,
    [adjustmentSourceOptions, selectedSourceKey]
  );
  const selectableAdjustmentItems = selectedSourceOption?.items ?? [];

  useEffect(() => {
    if (selectedAdjustmentId !== null && !selectedAdjustment) {
      setSelectedAdjustmentId(null);
    }
  }, [selectedAdjustment, selectedAdjustmentId]);

  useEffect(() => {
    setLines((current) => current.map((line) => (
      selectableAdjustmentItems.some((item) => item.id === Number(line.itemId))
        ? line
        : { ...line, itemId: "" }
    )));
  }, [selectableAdjustmentItems]);

  useEffect(() => {
    if (hasProcessedLaunchContext || !canManage || adjustmentSourceOptions.length === 0) {
      return;
    }

    setHasProcessedLaunchContext(true);
    const pendingContext = consumePendingInventoryActionContext("adjustments");
    if (!pendingContext) {
      return;
    }

    openCreateModal(pendingContext.sourceKey ?? "");
  }, [adjustmentSourceOptions, canManage, hasProcessedLaunchContext]);

  const baseColumns = useMemo<GridColDef<InventoryAdjustment>[]>(() => [
    { field: "adjustmentNo", headerName: t("adjustmentNo"), minWidth: 180, flex: 1, renderCell: (params) => <span className="cell--mono">{params.row.adjustmentNo}</span> },
    { field: "reasonCode", headerName: t("reasonCode"), minWidth: 150, flex: 0.9 },
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
    { field: "beforeQty", headerName: t("beforeQty"), minWidth: 120, type: "number" },
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
    { field: "afterQty", headerName: t("afterQty"), minWidth: 120, type: "number" },
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

  function showActionError(error: unknown, fallbackMessage: string) {
    const message = error instanceof Error ? error.message : fallbackMessage;
    setErrorMessage(message);
    showError(message);
  }

  function openCreateModal(initialSourceKey = "") {
    if (!canManage) {
      return;
    }
    setForm(emptyAdjustmentForm);
    setLines([createAdjustmentLine()]);
    setSelectedSourceKey(initialSourceKey);
    setErrorMessage("");
    setIsModalOpen(true);
  }

  function closeCreateModal() {
    setIsModalOpen(false);
    setSubmitting(false);
    setErrorMessage("");
    setSelectedSourceKey("");
    setForm(emptyAdjustmentForm);
    setLines([createAdjustmentLine()]);
  }

  function addLine() {
    setLines((current) => [...current, createAdjustmentLine()]);
  }

  function removeLine(lineId: string) {
    setLines((current) => current.length === 1 ? current : current.filter((line) => line.id !== lineId));
  }

  function updateLine(lineId: string, patch: Partial<AdjustmentLineFormState>) {
    setLines((current) => current.map((line) => line.id === lineId ? { ...line, ...patch } : line));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage("");

    try {
      await api.createInventoryAdjustment({
        adjustmentNo: form.adjustmentNo || undefined,
        reasonCode: form.reasonCode,
        notes: form.notes || undefined,
        lines: lines
          .filter((line) => Number(line.itemId) > 0 && line.adjustQty !== 0)
          .map((line) => ({
            itemId: Number(line.itemId),
            adjustQty: line.adjustQty,
            lineNote: line.lineNote || undefined
          }))
      });
      closeCreateModal();
      await onRefresh();
      showSuccess(t("adjustmentSavedSuccess"));
    } catch (error) {
      showActionError(error, t("couldNotSaveAdjustment"));
    } finally {
      setSubmitting(false);
    }
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
      {feedbackToast}

      <Drawer
        anchor="right"
        open={Boolean(selectedAdjustment)}
        onClose={() => setSelectedAdjustmentId(null)}
        PaperProps={{ className: "document-drawer" }}
      >
        {selectedAdjustment ? (
          <div className="document-drawer__content">
            <div className="document-drawer__header">
              <div>
                <div className="document-drawer__eyebrow">{t("adjustments")}</div>
                <h3>{selectedAdjustment.adjustmentNo}</h3>
                <p>{selectedAdjustment.reasonCode} | {formatDateTimeValue(selectedAdjustment.createdAt, resolvedTimeZone)}</p>
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
                <strong>{t("created")}</strong><br />
                {formatDateTimeValue(selectedAdjustment.createdAt, resolvedTimeZone)}
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
        ) : null}
      </Drawer>

      <Dialog
        open={isModalOpen}
        onClose={(_, reason) => {
          if (reason === "backdropClick") return;
          closeCreateModal();
        }}
        fullWidth
        maxWidth="lg"
      >
        <DialogTitle sx={{ pb: 1 }}>
          {t("addAdjustment")}
          <IconButton aria-label={t("close")} onClick={closeCreateModal} sx={{ position: "absolute", right: 16, top: 16 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {errorMessage ? <InlineAlert>{errorMessage}</InlineAlert> : null}
          <form className="sheet-form" onSubmit={handleSubmit}>
            <label>{t("adjustmentNo")}<input value={form.adjustmentNo} onChange={(event) => setForm((current) => ({ ...current, adjustmentNo: event.target.value }))} placeholder={t("autoGeneratedOptional")} /></label>
            <label>{t("reasonCode")}<input value={form.reasonCode} onChange={(event) => setForm((current) => ({ ...current, reasonCode: event.target.value }))} placeholder="COUNT_GAIN / DAMAGE / CORRECTION" required /></label>
            <label className="sheet-form__wide">{t("notes")}<input value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder={t("adjustmentNotesPlaceholder")} /></label>
            <label className="sheet-form__wide">
              {t("sku")}
              <select value={selectedSourceKey} onChange={(event) => setSelectedSourceKey(event.target.value)}>
                <option value="">{t("selectSkuForInventoryAction")}</option>
                {adjustmentSourceOptions.map((source) => (
                  <option key={source.key} value={source.key}>
                    {`${source.customerName} | ${t("itemNumber")}: ${source.itemNumber || "-"} | ${source.sku} - ${source.description} (${t("onHand")}: ${source.totalOnHand})`}
                  </option>
                ))}
              </select>
            </label>
            {selectedSourceOption ? (
              <div className="sheet-note sheet-note--readonly sheet-form__wide">
                {`${selectedSourceOption.customerName} | ${t("itemNumber")}: ${selectedSourceOption.itemNumber || "-"} | ${selectedSourceOption.sku} | ${selectedSourceOption.description} | ${t("onHand")}: ${selectedSourceOption.totalOnHand} | ${t("availableQty")}: ${selectedSourceOption.totalAvailable} | ${t("warehouseCount")}: ${selectedSourceOption.warehouseCount} | ${t("containerCount")}: ${selectedSourceOption.containerCount}`}
              </div>
            ) : (
              <InlineAlert severity="info" className="sheet-form__wide">
                {t("selectSkuBeforeInventoryAction")}
              </InlineAlert>
            )}

            <div className="sheet-form__wide">
              <div className="batch-lines__toolbar">
                <strong>{t("adjustmentLines")}</strong>
                <Button size="small" variant="outlined" type="button" onClick={addLine} disabled={!selectedSourceOption}>{t("addLine")}</Button>
              </div>
              <div className="batch-lines">
                {lines.map((line, index) => {
                  const selectedItem = selectableAdjustmentItems.find((item) => item.id === Number(line.itemId));
                  const afterQty = (selectedItem?.quantity ?? 0) + line.adjustQty;

                  return (
                    <div className="batch-line-card" key={line.id}>
                      <div className="batch-line-card__header">
                        <div className="batch-line-card__title">
                          <strong>{t("adjustmentLine")} #{index + 1}</strong>
                        </div>
                        <button className="button button--danger button--small" type="button" onClick={() => removeLine(line.id)} disabled={lines.length === 1}>{t("removeLine")}</button>
                      </div>
                      <div className="batch-line-grid">
                        <label className="batch-line-grid__description">
                          {t("stockRow")}
                          <select value={line.itemId} onChange={(event) => updateLine(line.id, { itemId: event.target.value })}>
                            <option value="">{selectedSourceOption ? t("selectStockRow") : t("selectSkuForInventoryAction")}</option>
                            {selectableAdjustmentItems.map((item) => (
                              <option key={item.id} value={item.id}>
                                {`${item.locationName} / ${normalizeStorageSection(item.storageSection)} | ${t("containerNo")}: ${item.containerNo || "-"} | ${item.sku} - ${displayDescription(item)} (${t("onHand")}: ${item.quantity})`}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>{t("onHand")}<input value={selectedItem ? String(selectedItem.quantity) : ""} readOnly /></label>
                        <label>{t("adjustQty")}<input type="number" value={numberInputValue(line.adjustQty)} onChange={(event) => updateLine(line.id, { adjustQty: Number(event.target.value || 0) })} /></label>
                        <label>{t("afterQty")}<input value={selectedItem ? String(afterQty) : ""} readOnly /></label>
                        <label className="batch-line-grid__detail">{t("internalNotes")}<input value={line.lineNote} onChange={(event) => updateLine(line.id, { lineNote: event.target.value })} placeholder={t("adjustmentLineNotePlaceholder")} /></label>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="sheet-form__actions sheet-form__wide">
              <button className="button button--primary" type="submit" disabled={submitting}>{submitting ? t("saving") : t("saveAdjustment")}</button>
              <button className="button button--ghost" type="button" onClick={closeCreateModal}>{t("cancel")}</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

    </main>
  );
}

function displayDescription(item: Pick<Item, "description" | "name">) {
  return item.description || item.name;
}

function numberInputValue(value: number) {
  return value === 0 ? "" : String(value);
}

function formatSignedNumber(value: number) {
  return `${value >= 0 ? "+" : ""}${new Intl.NumberFormat("en-US").format(value)}`;
}
