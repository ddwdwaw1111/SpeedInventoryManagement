import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import CloseIcon from "@mui/icons-material/Close";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Box, Button, Chip, Dialog, DialogContent, DialogTitle, Drawer, IconButton } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";

import { api } from "../lib/api";
import { buildInventoryActionSourceOptions } from "../lib/inventoryActionSources";
import { consumePendingInventoryActionContext } from "../lib/inventoryActionContext";
import { formatDateTimeValue } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import type { PageKey } from "../lib/routes";
import {
  buildInventoryProjectionKey,
  normalizeStorageSection,
  toInventoryProjectionRef,
  type CycleCount,
  type Item,
  type UserRole
} from "../lib/types";
import { InlineAlert, useFeedbackToast } from "./Feedback";
import { RowActionsMenu } from "./RowActionsMenu";
import { buildWorkspaceGridSlots, WorkspaceDrawerLoadingState, WorkspacePanelHeader } from "./WorkspacePanelChrome";

type CycleCountManagementPageProps = {
  cycleCounts: CycleCount[];
  items: Item[];
  currentUserRole: UserRole;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
  onNavigate?: (page: PageKey) => void;
};

type CountLineState = {
  id: string;
  bucketKey: string;
  countedQty: number;
  countedPallets: number;
  lineNote: string;
};

const EMPTY_ITEMS: Item[] = [];

function createLine(bucketKey = ""): CountLineState {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    bucketKey,
    countedQty: 0,
    countedPallets: 0,
    lineNote: ""
  };
}

export function CycleCountManagementPage({
  cycleCounts,
  items,
  currentUserRole,
  isLoading,
  onRefresh
}: CycleCountManagementPageProps) {
  const { t } = useI18n();
  const { resolvedTimeZone } = useSettings();
  const { showSuccess, showError, feedbackToast } = useFeedbackToast();
  const canManage = currentUserRole === "admin" || currentUserRole === "operator";
  const [isOpen, setIsOpen] = useState(false);
  const [selectedID, setSelectedID] = useState<number | null>(null);
  const [countNo, setCountNo] = useState("");
  const [notes, setNotes] = useState("");
  const [sourceKey, setSourceKey] = useState("");
  const [lines, setLines] = useState<CountLineState[]>([createLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [launchContextHandled, setLaunchContextHandled] = useState(false);

  const selectedCount = useMemo(
    () => cycleCounts.find((count) => count.id === selectedID) ?? null,
    [cycleCounts, selectedID]
  );
  const sourceOptions = useMemo(() => buildInventoryActionSourceOptions(items), [items]);
  const selectedSource = useMemo(
    () => sourceOptions.find((option) => option.key === sourceKey) ?? null,
    [sourceKey, sourceOptions]
  );
  const selectableItems = selectedSource?.items ?? EMPTY_ITEMS;

  useEffect(() => {
    if (selectedID !== null && !selectedCount) setSelectedID(null);
  }, [selectedCount, selectedID]);

  useEffect(() => {
    const onlyKey = selectableItems.length === 1
      ? buildInventoryProjectionKey(toInventoryProjectionRef(selectableItems[0]!))
      : "";
    setLines((current) => current.map((line) => {
      const item = selectableItems.find(
        (candidate) => buildInventoryProjectionKey(toInventoryProjectionRef(candidate)) === line.bucketKey
      );
      if (item) return line;
      const onlyItem = selectableItems.length === 1 ? selectableItems[0]! : null;
      return {
        ...line,
        bucketKey: onlyKey,
        countedQty: onlyItem?.quantity ?? 0,
        countedPallets: onlyItem?.pallets ?? 0
      };
    }));
  }, [selectableItems]);

  useEffect(() => {
    if (launchContextHandled || !canManage || sourceOptions.length === 0) return;
    setLaunchContextHandled(true);
    const context = consumePendingInventoryActionContext("cycle-counts");
    if (!context) return;
    openCreate(context.sourceKey ?? "", context.containerNo ?? "");
  }, [canManage, launchContextHandled, sourceOptions]);

  const columns = useMemo<GridColDef<CycleCount>[]>(() => [
    { field: "countNo", headerName: t("countNo"), minWidth: 180, flex: 1, renderCell: (params) => <span className="cell--mono">{params.row.countNo}</span> },
    { field: "totalLines", headerName: t("totalLines"), minWidth: 120, type: "number" },
    { field: "totalVariance", headerName: t("varianceQty"), minWidth: 130, type: "number", renderCell: (params) => signed(params.row.totalVariance) },
    { field: "totalPalletVariance", headerName: `${t("varianceQty")} (${t("pallets")})`, minWidth: 170, type: "number", renderCell: (params) => signed(params.row.totalPalletVariance) },
    { field: "status", headerName: t("status"), minWidth: 110, renderCell: () => <Chip label={t("posted")} color="success" size="small" /> },
    { field: "notes", headerName: t("notes"), minWidth: 240, flex: 1.4, renderCell: (params) => params.row.notes || "-" },
    { field: "createdAt", headerName: t("created"), minWidth: 210, valueFormatter: (value) => formatDateTimeValue(String(value), resolvedTimeZone) },
    {
      field: "actions",
      headerName: t("actions"),
      minWidth: 90,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <RowActionsMenu
          ariaLabel={t("actions")}
          actions={[{ key: "details", label: t("details"), icon: <VisibilityOutlinedIcon fontSize="small" />, onClick: () => setSelectedID(params.row.id) }]}
        />
      )
    }
  ], [resolvedTimeZone, t]);

  const detailColumns = useMemo<GridColDef<CycleCount["lines"][number]>[]>(() => [
    { field: "containerNo", headerName: t("containerNo"), minWidth: 150 },
    { field: "sku", headerName: t("sku"), minWidth: 130, renderCell: (params) => <span className="cell--mono">{params.row.sku}</span> },
    { field: "description", headerName: t("description"), minWidth: 220, flex: 1.3 },
    { field: "locationName", headerName: t("currentStorage"), minWidth: 160 },
    { field: "storageSection", headerName: t("storageSection"), minWidth: 110 },
    { field: "systemQty", headerName: t("systemQty"), minWidth: 110, type: "number" },
    { field: "countedQty", headerName: t("countedQty"), minWidth: 110, type: "number" },
    { field: "varianceQty", headerName: t("varianceQty"), minWidth: 110, type: "number", renderCell: (params) => signed(params.row.varianceQty) },
    { field: "systemPallets", headerName: `${t("systemQty")} (${t("pallets")})`, minWidth: 150, type: "number" },
    { field: "countedPallets", headerName: `${t("countedQty")} (${t("pallets")})`, minWidth: 150, type: "number" },
    { field: "variancePallets", headerName: `${t("varianceQty")} (${t("pallets")})`, minWidth: 150, type: "number", renderCell: (params) => signed(params.row.variancePallets) },
    { field: "lineNote", headerName: t("internalNotes"), minWidth: 220, flex: 1.2, renderCell: (params) => params.row.lineNote || "-" }
  ], [t]);

  function openCreate(initialSourceKey = "", containerNo = "") {
    if (!canManage) return;
    const source = sourceOptions.find((option) => option.key === initialSourceKey);
    const item = source?.items.find((candidate) => candidate.containerNo.trim().toUpperCase() === containerNo.trim().toUpperCase())
      ?? (source?.items.length === 1 ? source.items[0] : null);
    setCountNo("");
    setNotes("");
    setSourceKey(initialSourceKey);
    setLines([createLine(item ? buildInventoryProjectionKey(toInventoryProjectionRef(item)) : "")]);
    if (item) {
      setLines([{ ...createLine(buildInventoryProjectionKey(toInventoryProjectionRef(item))), countedQty: item.quantity, countedPallets: item.pallets }]);
    }
    setErrorMessage("");
    setIsOpen(true);
  }

  function closeCreate() {
    setIsOpen(false);
    setSubmitting(false);
    setCountNo("");
    setNotes("");
    setSourceKey("");
    setLines([createLine()]);
    setErrorMessage("");
  }

  function updateLine(id: string, patch: Partial<CountLineState>) {
    setLines((current) => current.map((line) => line.id === id ? { ...line, ...patch } : line));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage("");
    try {
      const prepared = lines.map((line) => {
        const item = selectableItems.find(
          (candidate) => buildInventoryProjectionKey(toInventoryProjectionRef(candidate)) === line.bucketKey
        );
        if (!item) return null;
        return {
          ...toInventoryProjectionRef(item),
          countedQty: line.countedQty,
          countedPallets: line.countedPallets,
          lineNote: line.lineNote || undefined
        };
      }).filter((line): line is NonNullable<typeof line> => line !== null);
      if (prepared.length === 0) throw new Error(t("cycleCountRequireLine"));
      await api.createCycleCount({ countNo: countNo || undefined, notes: notes || undefined, lines: prepared });
      closeCreate();
      await onRefresh();
      showSuccess(t("cycleCountSavedSuccess"));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("couldNotSaveCycleCount");
      setErrorMessage(message);
      showError(message);
    } finally {
      setSubmitting(false);
    }
  }

  const slots = buildWorkspaceGridSlots({ emptyTitle: t("noResults"), emptyDescription: t("emptyStateHint"), loadingTitle: t("loadingRecords") });

  return (
    <main className="workspace-main">
      <section className="workbook-panel workbook-panel--full">
        <div className="tab-strip">
          <WorkspacePanelHeader
            title={t("cycleCounts")}
            actions={canManage ? <Button variant="contained" startIcon={<AddCircleOutlineOutlinedIcon />} onClick={() => openCreate()}>{t("addCycleCount")}</Button> : undefined}
            notices={[canManage ? "" : t("readOnlyModeNotice")]}
            errorMessage={errorMessage && !isOpen ? errorMessage : ""}
          />
        </div>
        <div className="workspace-summary-strip">
          <article className="workspace-summary-card"><span className="workspace-summary-card__label">{t("allRows")}</span><strong className="workspace-summary-card__value">{cycleCounts.length}</strong><span className="workspace-summary-card__meta">{t("cycleCounts")}</span></article>
          <article className="workspace-summary-card"><span className="workspace-summary-card__label">{t("varianceQty")}</span><strong className="workspace-summary-card__value">{signed(cycleCounts.reduce((sum, count) => sum + count.totalVariance, 0))}</strong><span className="workspace-summary-card__meta">{t("units")}</span></article>
          <article className="workspace-summary-card"><span className="workspace-summary-card__label">{t("pallets")}</span><strong className="workspace-summary-card__value">{signed(cycleCounts.reduce((sum, count) => sum + count.totalPalletVariance, 0))}</strong><span className="workspace-summary-card__meta">{t("varianceQty")}</span></article>
        </div>
        <div className="sheet-table-wrap"><Box sx={{ minWidth: 0 }}><DataGrid rows={cycleCounts} columns={columns} loading={isLoading} pagination pageSizeOptions={[10, 25, 50]} disableRowSelectionOnClick initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }} getRowHeight={() => 64} onRowClick={(params) => setSelectedID(params.row.id)} slots={slots} sx={{ border: 0 }} /></Box></div>
      </section>
      {feedbackToast}

      <Drawer anchor="right" open={selectedID !== null} onClose={() => setSelectedID(null)} PaperProps={{ className: "document-drawer" }}>
        {selectedCount ? (
          <div className="document-drawer__content">
            <div className="document-drawer__header"><div><div className="document-drawer__eyebrow">{t("cycleCounts")}</div><h3>{selectedCount.countNo}</h3><p>{formatDateTimeValue(selectedCount.createdAt, resolvedTimeZone)}</p></div><IconButton aria-label={t("close")} onClick={() => setSelectedID(null)}><CloseIcon fontSize="small" /></IconButton></div>
            <div className="document-drawer__status-bar"><div className="document-drawer__status-main"><Chip label={t("posted")} color="success" size="small" /></div><div className="document-drawer__status-stat"><strong>{selectedCount.totalLines}</strong><span>{t("totalLines")}</span></div><div className="document-drawer__status-stat"><strong>{signed(selectedCount.totalVariance)}</strong><span>{t("varianceQty")}</span></div><div className="document-drawer__status-stat"><strong>{signed(selectedCount.totalPalletVariance)}</strong><span>{t("pallets")}</span></div></div>
            <div className="document-drawer__section-title">{t("cycleCountLines")}</div>
            <Box sx={{ minWidth: 0 }}><DataGrid rows={selectedCount.lines} columns={detailColumns} pagination pageSizeOptions={[10, 25]} disableRowSelectionOnClick getRowHeight={() => 64} slots={slots} sx={{ border: 0 }} /></Box>
          </div>
        ) : isLoading ? <WorkspaceDrawerLoadingState /> : null}
      </Drawer>

      <Dialog open={isOpen} onClose={(_, reason) => { if (reason !== "backdropClick") closeCreate(); }} fullWidth maxWidth="lg">
        <DialogTitle sx={{ pb: 1 }}>{t("addCycleCount")}<IconButton aria-label={t("close")} onClick={closeCreate} sx={{ position: "absolute", right: 16, top: 16 }}><CloseIcon fontSize="small" /></IconButton></DialogTitle>
        <DialogContent dividers>
          {errorMessage ? <InlineAlert>{errorMessage}</InlineAlert> : null}
          <form className="sheet-form" onSubmit={submit}>
            <label>{t("countNo")}<input value={countNo} onChange={(event) => setCountNo(event.target.value)} placeholder={t("autoGeneratedOptional")} /></label>
            <label className="sheet-form__wide">{t("notes")}<input value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
            <label className="sheet-form__wide">{t("sku")}<select value={sourceKey} onChange={(event) => setSourceKey(event.target.value)}><option value="">{t("selectSkuForInventoryAction")}</option>{sourceOptions.map((source) => <option key={source.key} value={source.key}>{`${source.customerName} | ${source.itemNumber || source.sku} | ${source.description}`}</option>)}</select></label>
            <div className="sheet-form__wide">
              <div className="batch-lines__toolbar"><strong>{t("cycleCountLines")}</strong><Button size="small" variant="outlined" type="button" disabled={!selectedSource} onClick={() => setLines((current) => [...current, createLine()])}>{t("addLine")}</Button></div>
              <div className="batch-lines">
                {lines.map((line, index) => {
                  const item = selectableItems.find((candidate) => buildInventoryProjectionKey(toInventoryProjectionRef(candidate)) === line.bucketKey);
                  return (
                    <div className="batch-line-card" key={line.id}>
                      <div className="batch-line-card__header"><strong>{t("cycleCountLine")} #{index + 1}</strong><button className="button button--danger button--small" type="button" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((candidate) => candidate.id !== line.id))}>{t("removeLine")}</button></div>
                      <div className="batch-line-grid">
                        <label className="batch-line-grid__description">{t("stockRow")}<select value={line.bucketKey} onChange={(event) => { const next = selectableItems.find((candidate) => buildInventoryProjectionKey(toInventoryProjectionRef(candidate)) === event.target.value); updateLine(line.id, { bucketKey: event.target.value, countedQty: next?.quantity ?? 0, countedPallets: next?.pallets ?? 0 }); }}><option value="">{t("selectStockRow")}</option>{selectableItems.map((candidate) => { const key = buildInventoryProjectionKey(toInventoryProjectionRef(candidate)); return <option key={key} value={key}>{`${candidate.locationName} / ${normalizeStorageSection(candidate.storageSection)} | ${candidate.containerNo || "-"} | Qty ${candidate.quantity} | Pallets ${candidate.pallets}`}</option>; })}</select></label>
                        <label>{t("systemQty")}<input readOnly value={item ? item.quantity : ""} /></label>
                        <label>{t("countedQty")}<input type="number" min="0" disabled={!item} value={numberInput(line.countedQty)} onChange={(event) => updateLine(line.id, { countedQty: Math.max(0, Number(event.target.value || 0)) })} /></label>
                        <label>{`${t("systemQty")} (${t("pallets")})`}<input readOnly value={item ? item.pallets : ""} /></label>
                        <label>{`${t("countedQty")} (${t("pallets")})`}<input type="number" min="0" disabled={!item} value={numberInput(line.countedPallets)} onChange={(event) => updateLine(line.id, { countedPallets: Math.max(0, Number(event.target.value || 0)) })} /></label>
                        <label>{t("varianceQty")}<input readOnly value={item ? signed(line.countedQty - item.quantity) : ""} /></label>
                        <label>{`${t("varianceQty")} (${t("pallets")})`}<input readOnly value={item ? signed(line.countedPallets - item.pallets) : ""} /></label>
                        <label className="batch-line-grid__detail">{t("internalNotes")}<input value={line.lineNote} onChange={(event) => updateLine(line.id, { lineNote: event.target.value })} /></label>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="sheet-form__actions sheet-form__wide"><button className="button button--primary" type="submit" disabled={submitting}>{submitting ? t("saving") : t("saveCycleCount")}</button><button className="button button--ghost" type="button" onClick={closeCreate}>{t("cancel")}</button></div>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${new Intl.NumberFormat("en-US").format(value)}`;
}

function numberInput(value: number) {
  return value === 0 ? "" : String(value);
}
