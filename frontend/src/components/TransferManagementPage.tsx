import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import CloseIcon from "@mui/icons-material/Close";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Box, Button, Chip, Dialog, DialogContent, DialogTitle, Drawer, IconButton } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";

import { api } from "../lib/api";
import { setPendingAllActivityContext } from "../lib/allActivityContext";
import { formatDateTimeValue, toIsoDateTimeString } from "../lib/dates";
import { consumePendingInventoryActionContext } from "../lib/inventoryActionContext";
import { buildInventoryActionSourceOptions } from "../lib/inventoryActionSources";
import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import type { PageKey } from "../lib/routes";
import {
  DEFAULT_STORAGE_SECTION,
  buildInventoryProjectionKey,
  getLocationSectionOptions,
  normalizeStorageSection,
  toInventoryProjectionRef,
  type InventoryTransfer,
  type Item,
  type Location,
  type UserRole
} from "../lib/types";
import { InlineAlert, useFeedbackToast } from "./Feedback";
import { RowActionsMenu } from "./RowActionsMenu";
import { buildWorkspaceGridSlots, WorkspaceDrawerLoadingState, WorkspacePanelHeader } from "./WorkspacePanelChrome";
import { useSharedColumnOrder } from "./useSharedColumnOrder";

type TransferManagementPageProps = {
  transfers: InventoryTransfer[];
  items: Item[];
  locations: Location[];
  currentUserRole: UserRole;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
  onNavigate: (page: PageKey) => void;
};

type TransferFormState = {
  transferNo: string;
  actualTransferredAt: string;
  notes: string;
};

type TransferLineFormState = {
  id: string;
  sourceBucketKey: string;
  quantity: number;
  toLocationId: string;
  toStorageSection: string;
  lineNote: string;
};

const emptyTransferForm: TransferFormState = {
  transferNo: "",
  actualTransferredAt: "",
  notes: ""
};
const summaryNumberFormatter = new Intl.NumberFormat("en-US");
const TRANSFER_COLUMN_ORDER_PREFERENCE_KEY = "transfers.column-order";

function createTransferLine(): TransferLineFormState {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sourceBucketKey: "",
    quantity: 0,
    toLocationId: "",
    toStorageSection: DEFAULT_STORAGE_SECTION,
    lineNote: ""
  };
}

export function TransferManagementPage({
  transfers,
  items,
  locations,
  currentUserRole,
  isLoading,
  onRefresh,
  onNavigate
}: TransferManagementPageProps) {
  const { t } = useI18n();
  const { resolvedTimeZone } = useSettings();
  const { showSuccess, showError, feedbackToast } = useFeedbackToast();
  const canManage = currentUserRole === "admin" || currentUserRole === "operator";
  const canConfigureColumns = currentUserRole === "admin";
  const pageDescription = t("transfersDesc");
  const permissionNotice = canManage ? "" : t("readOnlyModeNotice");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedTransferId, setSelectedTransferId] = useState<number | null>(null);
  const [form, setForm] = useState<TransferFormState>(emptyTransferForm);
  const [lines, setLines] = useState<TransferLineFormState[]>([createTransferLine()]);
  const [selectedSourceKey, setSelectedSourceKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [hasProcessedLaunchContext, setHasProcessedLaunchContext] = useState(false);
  const selectedTransfer = useMemo(
    () => transfers.find((transfer) => transfer.id === selectedTransferId) ?? null,
    [transfers, selectedTransferId]
  );
  const availableSourceItems = useMemo(() => items.filter((item) => item.availableQty > 0), [items]);
  const transferSourceOptions = useMemo(
    () => buildInventoryActionSourceOptions(availableSourceItems),
    [availableSourceItems]
  );
  const selectedSourceOption = useMemo(
    () => transferSourceOptions.find((option) => option.key === selectedSourceKey) ?? null,
    [transferSourceOptions, selectedSourceKey]
  );
  const selectableSourceItems = selectedSourceOption?.items ?? [];

  useEffect(() => {
    if (selectedTransferId !== null && !selectedTransfer) {
      setSelectedTransferId(null);
    }
  }, [selectedTransfer, selectedTransferId]);

  useEffect(() => {
    const onlyBucketKey = selectableSourceItems.length === 1
      ? buildInventoryProjectionKey(toInventoryProjectionRef(selectableSourceItems[0]!))
      : null;
    setLines((current) => current.map((line) => {
      if (selectableSourceItems.some((item) => buildInventoryProjectionKey(toInventoryProjectionRef(item)) === line.sourceBucketKey)) {
        return line;
      }
      return { ...line, sourceBucketKey: onlyBucketKey ?? "" };
    }));
  }, [selectableSourceItems]);

  useEffect(() => {
    if (hasProcessedLaunchContext || !canManage || transferSourceOptions.length === 0) {
      return;
    }

    setHasProcessedLaunchContext(true);
    const pendingContext = consumePendingInventoryActionContext("transfers");
    if (!pendingContext) {
      return;
    }

    openCreateModal(pendingContext.sourceKey ?? "");
  }, [canManage, hasProcessedLaunchContext, transferSourceOptions]);

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
    { field: "toLocationName", headerName: t("destinationStorage"), minWidth: 170, flex: 1 },
    { field: "toStorageSection", headerName: t("toSection"), minWidth: 110 },
    { field: "quantity", headerName: t("transferQty"), minWidth: 120, type: "number" },
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
      { label: t("routes"), value: summaryNumberFormatter.format(routeCount), meta: t("destinationStorage") }
    ];
  }, [transfers, t]);

  function openCreateModal(initialSourceKey = "") {
    if (!canManage) {
      return;
    }
    setForm(emptyTransferForm);
    setLines([createTransferLine()]);
    setSelectedSourceKey(initialSourceKey);
    setErrorMessage("");
    setIsModalOpen(true);
  }

  function closeCreateModal() {
    setIsModalOpen(false);
    setSubmitting(false);
    setErrorMessage("");
    setSelectedSourceKey("");
    setForm(emptyTransferForm);
    setLines([createTransferLine()]);
  }

  function addLine() {
    setLines((current) => [...current, createTransferLine()]);
  }

  function removeLine(lineId: string) {
    setLines((current) => current.length === 1 ? current : current.filter((line) => line.id !== lineId));
  }

  function updateLine(lineId: string, patch: Partial<TransferLineFormState>) {
    setLines((current) => current.map((line) => line.id === lineId ? { ...line, ...patch } : line));
  }

  function showActionError(error: unknown, fallbackMessage: string) {
    const message = error instanceof Error ? error.message : fallbackMessage;
    setErrorMessage(message);
    showError(message);
  }

  const hasQtyOverflow = lines.some((line) => {
    const item = selectableSourceItems.find(
      (i) => buildInventoryProjectionKey(toInventoryProjectionRef(i)) === line.sourceBucketKey
    );
    return item !== undefined && line.quantity > item.availableQty;
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (hasQtyOverflow) return;
    setSubmitting(true);
    setErrorMessage("");

    try {
      await api.createInventoryTransfer({
        transferNo: form.transferNo || undefined,
        actualTransferredAt: toIsoDateTimeString(form.actualTransferredAt),
        notes: form.notes || undefined,
        lines: lines
          .map((line) => {
            const selectedItem = selectableSourceItems.find(
              (item) => buildInventoryProjectionKey(toInventoryProjectionRef(item)) === line.sourceBucketKey
            );
            if (!selectedItem || Number(line.toLocationId) <= 0 || line.quantity <= 0) {
              return null;
            }

            return {
              ...toInventoryProjectionRef(selectedItem),
              quantity: line.quantity,
              toLocationId: Number(line.toLocationId),
              toStorageSection: line.toStorageSection || undefined,
              lineNote: line.lineNote || undefined
            };
          })
          .filter((line): line is NonNullable<typeof line> => line !== null)
      });
      closeCreateModal();
      await onRefresh();
      showSuccess(t("transferSavedSuccess"));
    } catch (error) {
      showActionError(error, t("couldNotSaveTransfer"));
    } finally {
      setSubmitting(false);
    }
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
                  <Button variant="contained" startIcon={<AddCircleOutlineOutlinedIcon />} onClick={() => openCreateModal()}>
                    {t("addTransfer")}
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
      {feedbackToast}

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
          {t("addTransfer")}
          <IconButton aria-label={t("close")} onClick={closeCreateModal} sx={{ position: "absolute", right: 16, top: 16 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {errorMessage ? <InlineAlert>{errorMessage}</InlineAlert> : null}
          <form className="sheet-form" onSubmit={handleSubmit}>
            <label>{t("transferNo")}<input value={form.transferNo} onChange={(event) => setForm((current) => ({ ...current, transferNo: event.target.value }))} placeholder={t("autoGeneratedOptional")} /></label>
            <label>{t("actualTransferredAt")}<input type="datetime-local" value={form.actualTransferredAt} onChange={(event) => setForm((current) => ({ ...current, actualTransferredAt: event.target.value }))} /></label>
            <label className="sheet-form__wide">{t("notes")}<input value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder={t("transferNotesPlaceholder")} /></label>
            <label className="sheet-form__wide">
              {t("sku")}
              <select value={selectedSourceKey} onChange={(event) => setSelectedSourceKey(event.target.value)}>
                <option value="">{t("selectSkuForInventoryAction")}</option>
                {transferSourceOptions.map((source) => (
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
                <strong>{t("transferLines")}</strong>
                <Button size="small" variant="outlined" type="button" onClick={addLine} disabled={!selectedSourceOption}>{t("addLine")}</Button>
              </div>
              <div className="batch-lines">
                {lines.map((line, index) => {
                  const selectedItem = selectableSourceItems.find(
                    (item) => buildInventoryProjectionKey(toInventoryProjectionRef(item)) === line.sourceBucketKey
                  );
                  const destinationLocation = locations.find((location) => location.id === Number(line.toLocationId));
                  const sectionOptions = getLocationSectionOptions(destinationLocation);

                  return (
                    <div className="batch-line-card" key={line.id}>
                      <div className="batch-line-card__header">
                        <div className="batch-line-card__title">
                          <strong>{t("transferLine")} #{index + 1}</strong>
                        </div>
                        <button className="button button--danger button--small" type="button" onClick={() => removeLine(line.id)} disabled={lines.length === 1}>{t("removeLine")}</button>
                      </div>
                      <div className="batch-line-grid">
                        <label className="batch-line-grid__description">
                          {t("sourceStockRow")}
                          <select value={line.sourceBucketKey} onChange={(event) => updateLine(line.id, { sourceBucketKey: event.target.value })}>
                            <option value="">{selectedSourceOption ? t("selectStockRow") : t("selectSkuForInventoryAction")}</option>
                            {selectableSourceItems.map((item) => (
                              <option key={buildInventoryProjectionKey(toInventoryProjectionRef(item))} value={buildInventoryProjectionKey(toInventoryProjectionRef(item))}>
                                {`${item.locationName} / ${normalizeStorageSection(item.storageSection)} | ${t("containerNo")}: ${item.containerNo || "-"} | ${item.sku} - ${displayDescription(item)} (${t("availableQty")}: ${item.availableQty})`}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>{t("availableQty")}<input value={selectedItem ? String(selectedItem.availableQty) : ""} readOnly /></label>
                        <label>
                          {t("transferQty")}
                          <input type="number" min="0" value={numberInputValue(line.quantity)} onChange={(event) => updateLine(line.id, { quantity: Math.max(0, Number(event.target.value || 0)) })} />
                          {selectedItem && line.quantity > selectedItem.availableQty && (
                            <small style={{ color: "#b76857", display: "block", marginTop: 2, fontWeight: 600 }}>
                              {t("transferQtyExceedsAvailable", { available: String(selectedItem.availableQty) })}
                            </small>
                          )}
                          {selectedItem && line.quantity > 0 && line.quantity <= selectedItem.availableQty && (
                            <small style={{ color: "#6c757d", display: "block", marginTop: 2 }}>
                              {t("remainingAfterTransfer")}: {selectedItem.availableQty - line.quantity}
                            </small>
                          )}
                        </label>
                        <label>{t("destinationStorage")}<select value={line.toLocationId} onChange={(event) => updateLine(line.id, { toLocationId: event.target.value, toStorageSection: getLocationSectionOptions(locations.find((location) => location.id === Number(event.target.value)))[0] || DEFAULT_STORAGE_SECTION })}><option value="">{t("selectStorage")}</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
                        <label>{t("toSection")}<select value={line.toStorageSection} onChange={(event) => updateLine(line.id, { toStorageSection: event.target.value })}>{sectionOptions.map((section) => <option key={section} value={section}>{section}</option>)}</select></label>
                        <label className="batch-line-grid__detail">{t("internalNotes")}<input value={line.lineNote} onChange={(event) => updateLine(line.id, { lineNote: event.target.value })} placeholder={t("transferLineNotePlaceholder")} /></label>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="sheet-form__actions sheet-form__wide">
              <button className="button button--primary" type="submit" disabled={submitting || hasQtyOverflow}>{submitting ? t("saving") : t("saveTransfer")}</button>
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
