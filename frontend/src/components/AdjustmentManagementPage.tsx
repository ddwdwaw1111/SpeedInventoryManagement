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
import { consumePendingInventoryActionContext, type InventoryActionContext } from "../lib/inventoryActionContext";
import { buildInventoryActionSourceOptions } from "../lib/inventoryActionSources";
import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import type { PageKey } from "../lib/routes";
import {
  buildInventoryProjectionKey,
  normalizeStorageSection,
  toInventoryProjectionRef,
  type InventoryAdjustment,
  type Item,
  type PalletTrace,
  type UserRole
} from "../lib/types";
import { InlineAlert, useFeedbackToast } from "./Feedback";
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

type AdjustmentFormState = {
  adjustmentNo: string;
  reasonCode: string;
  actualAdjustedAt: string;
  notes: string;
};

type AdjustmentLineFormState = {
  id: string;
  bucketKey: string;
  palletId: number;
  adjustQty: number;
  lineNote: string;
};

const emptyAdjustmentForm: AdjustmentFormState = {
  adjustmentNo: "",
  reasonCode: "",
  actualAdjustedAt: "",
  notes: ""
};
const summaryNumberFormatter = new Intl.NumberFormat("en-US");
const ADJUSTMENT_COLUMN_ORDER_PREFERENCE_KEY = "adjustments.column-order";

function createAdjustmentLine(
  patch: Partial<Omit<AdjustmentLineFormState, "id">> = {}
): AdjustmentLineFormState {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    bucketKey: "",
    palletId: 0,
    adjustQty: 0,
    lineNote: "",
    ...patch
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
  const [pallets, setPallets] = useState<PalletTrace[]>([]);
  const [isLoadingPallets, setIsLoadingPallets] = useState(false);
  const [palletLoadError, setPalletLoadError] = useState("");
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
  const selectablePalletsByBucketKey = useMemo(() => {
    const nextMap = new Map<string, PalletTrace[]>();

    selectableAdjustmentItems.forEach((item) => {
      nextMap.set(
        buildInventoryProjectionKey(toInventoryProjectionRef(item)),
        pallets.filter((pallet) => matchesAdjustmentPalletToItem(pallet, item))
      );
    });

    return nextMap;
  }, [pallets, selectableAdjustmentItems]);

  useEffect(() => {
    if (selectedAdjustmentId !== null && !selectedAdjustment) {
      setSelectedAdjustmentId(null);
    }
  }, [selectedAdjustment, selectedAdjustmentId]);

  useEffect(() => {
    const onlyBucketKey = selectableAdjustmentItems.length === 1
      ? buildInventoryProjectionKey(toInventoryProjectionRef(selectableAdjustmentItems[0]!))
      : null;
    setLines((current) => current.map((line) => {
      const nextBucketKey = selectableAdjustmentItems.some((item) => buildInventoryProjectionKey(toInventoryProjectionRef(item)) === line.bucketKey)
        ? line.bucketKey
        : onlyBucketKey ?? "";
      const nextPalletOptions = selectablePalletsByBucketKey.get(nextBucketKey) ?? [];
      const nextPalletId = line.palletId > 0 && nextPalletOptions.some((pallet) => pallet.id === line.palletId)
        ? line.palletId
        : line.palletId > 0 && isLoadingPallets && nextPalletOptions.length === 0
          ? line.palletId
        : 0;

      return {
        ...line,
        bucketKey: nextBucketKey,
        palletId: nextPalletId
      };
    }));
  }, [isLoadingPallets, selectableAdjustmentItems, selectablePalletsByBucketKey]);

  useEffect(() => {
    if (!canManage || !isModalOpen) {
      return;
    }

    let active = true;

    async function loadPallets() {
      setIsLoadingPallets(true);
      setPalletLoadError("");
      try {
        const nextPallets = await api.getPallets(50000);
        if (!active) {
          return;
        }
        setPallets(nextPallets);
      } catch (error) {
        if (!active) {
          return;
        }
        const message = error instanceof Error ? error.message : t("couldNotLoadReport");
        setPalletLoadError(message);
      } finally {
        if (active) {
          setIsLoadingPallets(false);
        }
      }
    }

    void loadPallets();
    return () => {
      active = false;
    };
  }, [canManage, isModalOpen, t]);

  useEffect(() => {
    if (hasProcessedLaunchContext || !canManage || adjustmentSourceOptions.length === 0) {
      return;
    }

    setHasProcessedLaunchContext(true);
    const pendingContext = consumePendingInventoryActionContext("adjustments");
    if (!pendingContext) {
      return;
    }

    openCreateModal(pendingContext);
  }, [adjustmentSourceOptions, canManage, hasProcessedLaunchContext]);

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

  function showActionError(error: unknown, fallbackMessage: string) {
    const message = error instanceof Error ? error.message : fallbackMessage;
    setErrorMessage(message);
    showError(message);
  }

  function openCreateModal(initialContext: InventoryActionContext | null = null) {
    if (!canManage) {
      return;
    }
    const initialSourceKey = initialContext?.sourceKey ?? "";
    const initialSourceOption = initialSourceKey
      ? adjustmentSourceOptions.find((option) => option.key === initialSourceKey) ?? null
      : null;
    const initialBucketKey = initialSourceOption
      ? resolveAdjustmentLaunchBucketKey(initialSourceOption.items, initialContext)
      : "";

    setForm(emptyAdjustmentForm);
    setLines([createAdjustmentLine({
      bucketKey: initialBucketKey,
      palletId: initialBucketKey && initialContext?.palletId ? initialContext.palletId : 0
    })]);
    setSelectedSourceKey(initialSourceKey);
    setErrorMessage("");
    setPalletLoadError("");
    setIsModalOpen(true);
  }

  function closeCreateModal() {
    setIsModalOpen(false);
    setSubmitting(false);
    setErrorMessage("");
    setSelectedSourceKey("");
    setForm(emptyAdjustmentForm);
    setLines([createAdjustmentLine()]);
    setPalletLoadError("");
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
    if (lines.some((line) => line.palletId > 0 && line.adjustQty > 0)) {
      setErrorMessage(t("palletAdjustmentNegativeOnlyNotice"));
      return;
    }
    setSubmitting(true);
    setErrorMessage("");

    try {
      await api.createInventoryAdjustment({
        adjustmentNo: form.adjustmentNo || undefined,
        reasonCode: form.reasonCode,
        actualAdjustedAt: toIsoDateTimeString(form.actualAdjustedAt),
        notes: form.notes || undefined,
        lines: lines
          .map((line) => {
            const selectedItem = selectableAdjustmentItems.find(
              (item) => buildInventoryProjectionKey(toInventoryProjectionRef(item)) === line.bucketKey
            );
            if (!selectedItem || line.adjustQty === 0) {
              return null;
            }
            if (line.palletId > 0 && line.adjustQty > 0) {
              return null;
            }

            return {
              ...toInventoryProjectionRef(selectedItem),
              palletId: line.palletId > 0 ? line.palletId : undefined,
              adjustQty: line.adjustQty,
              lineNote: line.lineNote || undefined
            };
          })
          .filter((line): line is NonNullable<typeof line> => line !== null)
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
      {feedbackToast}

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
          {palletLoadError ? <InlineAlert>{palletLoadError}</InlineAlert> : null}
          <form className="sheet-form" onSubmit={handleSubmit}>
            <label>{t("adjustmentNo")}<input value={form.adjustmentNo} onChange={(event) => setForm((current) => ({ ...current, adjustmentNo: event.target.value }))} placeholder={t("autoGeneratedOptional")} /></label>
            <label>
              {t("reasonCode")}
              <input
                value={form.reasonCode}
                onChange={(event) => setForm((current) => ({ ...current, reasonCode: event.target.value }))}
                list="reason-code-presets"
                placeholder="COUNT_GAIN / COUNT_LOSS / DAMAGE / CORRECTION"
                required
              />
              <datalist id="reason-code-presets">
                <option value="COUNT_GAIN" />
                <option value="COUNT_LOSS" />
                <option value="DAMAGE" />
                <option value="CORRECTION" />
                <option value="WRITE_OFF" />
                <option value="RETURN" />
              </datalist>
            </label>
            <label>{t("actualAdjustedAt")}<input type="datetime-local" value={form.actualAdjustedAt} onChange={(event) => setForm((current) => ({ ...current, actualAdjustedAt: event.target.value }))} /></label>
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
            {selectedSourceOption && isLoadingPallets ? (
              <InlineAlert severity="info" className="sheet-form__wide">
                {t("loadingRecords")}
              </InlineAlert>
            ) : null}

            <div className="sheet-form__wide">
              <div className="batch-lines__toolbar">
                <strong>{t("adjustmentLines")}</strong>
                <Button size="small" variant="outlined" type="button" onClick={addLine} disabled={!selectedSourceOption}>{t("addLine")}</Button>
              </div>
              <div className="batch-lines">
                {lines.map((line, index) => {
                  const selectedItem = selectableAdjustmentItems.find(
                    (item) => buildInventoryProjectionKey(toInventoryProjectionRef(item)) === line.bucketKey
                  );
                  const linePalletOptions = selectedItem
                    ? selectablePalletsByBucketKey.get(line.bucketKey) ?? []
                    : [];
                  const selectedPallet = line.palletId > 0
                    ? linePalletOptions.find((pallet) => pallet.id === line.palletId) ?? null
                    : null;
                  const selectedPalletAvailableQty = selectedItem && selectedPallet
                    ? getAdjustablePalletAvailableQty(selectedPallet, selectedItem.skuMasterId)
                    : 0;
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
                          <select
                            value={line.bucketKey}
                            onChange={(event) => updateLine(line.id, {
                              bucketKey: event.target.value,
                              palletId: 0
                            })}
                          >
                            <option value="">{selectedSourceOption ? t("selectStockRow") : t("selectSkuForInventoryAction")}</option>
                            {selectableAdjustmentItems.map((item) => (
                              <option key={buildInventoryProjectionKey(toInventoryProjectionRef(item))} value={buildInventoryProjectionKey(toInventoryProjectionRef(item))}>
                                {`${item.locationName} / ${normalizeStorageSection(item.storageSection)} | ${t("containerNo")}: ${item.containerNo || "-"} | ${item.sku} - ${displayDescription(item)} (${t("onHand")}: ${item.quantity})`}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          {t("pallet")}
                          <select
                            value={line.palletId > 0 ? String(line.palletId) : ""}
                            onChange={(event) => {
                              const nextPalletId = Number(event.target.value || 0);
                              const nextPallet = linePalletOptions.find((pallet) => pallet.id === nextPalletId);
                              const nextAvailableQty = selectedItem && nextPallet
                                ? getAdjustablePalletAvailableQty(nextPallet, selectedItem.skuMasterId)
                                : 0;

                              updateLine(line.id, {
                                palletId: nextPalletId,
                                adjustQty: nextPalletId > 0
                                  ? clampPalletAdjustmentQty(line.adjustQty, nextAvailableQty)
                                  : line.adjustQty
                              });
                            }}
                            disabled={!selectedItem || isLoadingPallets}
                          >
                            <option value="">{selectedItem ? t("allMatchingPallets") : t("selectStockRow")}</option>
                            {linePalletOptions.map((pallet) => {
                              const palletAvailableQty = selectedItem
                                ? getAdjustablePalletAvailableQty(pallet, selectedItem.skuMasterId)
                                : 0;
                              return (
                                <option key={pallet.id} value={pallet.id}>
                                  {`${pallet.palletCode} (${t("availableQty")}: ${palletAvailableQty})`}
                                </option>
                              );
                            })}
                          </select>
                        </label>
                        <label>{t("onHand")}<input value={selectedItem ? String(selectedItem.quantity) : ""} readOnly /></label>
                        <label>
                          {t("adjustQty")}
                          <input
                            type="number"
                            value={numberInputValue(line.adjustQty)}
                            onChange={(event) => {
                              const nextAdjustQty = Number(event.target.value || 0);
                              updateLine(line.id, {
                                adjustQty: selectedPallet
                                  ? clampPalletAdjustmentQty(nextAdjustQty, selectedPalletAvailableQty)
                                  : nextAdjustQty
                              });
                            }}
                          />
                          {selectedPallet ? (
                            <small style={{ color: "#617791", display: "block", marginTop: 2 }}>
                              {t("adjustmentSelectedPalletHint", {
                                palletCode: selectedPallet.palletCode,
                                availableQty: selectedPalletAvailableQty
                              })}
                            </small>
                          ) : selectedItem && line.adjustQty === 0 ? (
                            <small style={{ color: "#999", display: "block", marginTop: 2 }}>{t("zeroAdjustQtyHint")}</small>
                          ) : null}
                        </label>
                        <label>
                          {t("afterQty")}
                          <input
                            value={selectedItem ? String(afterQty) : ""}
                            readOnly
                            style={{ color: selectedItem && afterQty < 0 ? "#b76857" : undefined, fontWeight: selectedItem && afterQty < 0 ? 700 : undefined }}
                          />
                          {selectedItem && afterQty < 0 && (
                            <small style={{ color: "#b76857", display: "block", marginTop: 2 }}>{t("afterQtyNegativeWarning")}</small>
                          )}
                        </label>
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

function resolveAdjustmentLaunchBucketKey(items: Item[], context: InventoryActionContext | null) {
  if (items.length === 1) {
    return buildInventoryProjectionKey(toInventoryProjectionRef(items[0]!));
  }

  if (!context?.containerNo) {
    return "";
  }

  const matchedItem = items.find((item) => normalizeContainerNumber(item.containerNo) === context.containerNo);
  return matchedItem ? buildInventoryProjectionKey(toInventoryProjectionRef(matchedItem)) : "";
}

function matchesAdjustmentPalletToItem(pallet: PalletTrace, item: Item) {
  return (pallet.status === "OPEN" || pallet.status === "PARTIAL")
    && pallet.customerId === item.customerId
    && pallet.currentLocationId === item.locationId
    && normalizeStorageSection(pallet.currentStorageSection) === normalizeStorageSection(item.storageSection)
    && normalizeContainerNumber(pallet.currentContainerNo) === normalizeContainerNumber(item.containerNo)
    && getAdjustablePalletAvailableQty(pallet, item.skuMasterId) > 0;
}

function getAdjustablePalletAvailableQty(pallet: PalletTrace, skuMasterId: number) {
  return pallet.contents
    .filter((content) => content.skuMasterId === skuMasterId)
    .reduce((sum, content) => sum + Math.max(0, content.quantity - (content.allocatedQty ?? 0) - (content.damagedQty ?? 0) - (content.holdQty ?? 0)), 0);
}

function clampPalletAdjustmentQty(value: number, maxRemovableQty: number) {
  return Math.max(-maxRemovableQty, Math.min(0, value));
}

function normalizeContainerNumber(value: string) {
  return value.trim().toUpperCase();
}

function numberInputValue(value: number) {
  return value === 0 ? "" : String(value);
}

function formatSignedNumber(value: number) {
  return `${value >= 0 ? "+" : ""}${new Intl.NumberFormat("en-US").format(value)}`;
}
