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
import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import type { PageKey } from "../lib/routes";
import type { CycleCount, Item, UserRole } from "../lib/types";
import { InlineAlert } from "./Feedback";
import { RowActionsMenu } from "./RowActionsMenu";
import { buildWorkspaceGridSlots, WorkspacePanelHeader } from "./WorkspacePanelChrome";
import { useSharedColumnOrder } from "./useSharedColumnOrder";

type CycleCountManagementPageProps = {
  cycleCounts: CycleCount[];
  items: Item[];
  currentUserRole: UserRole;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
  onNavigate: (page: PageKey) => void;
};

type CycleCountFormState = {
  countNo: string;
  notes: string;
};

type CycleCountLineFormState = {
  id: string;
  itemId: string;
  countedQty: number;
  lineNote: string;
};

const emptyCycleCountForm: CycleCountFormState = {
  countNo: "",
  notes: ""
};
const CYCLE_COUNT_COLUMN_ORDER_PREFERENCE_KEY = "cycle-counts.column-order";

function createCycleCountLine(): CycleCountLineFormState {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    itemId: "",
    countedQty: 0,
    lineNote: ""
  };
}

export function CycleCountManagementPage({
  cycleCounts,
  items,
  currentUserRole,
  isLoading,
  onRefresh,
  onNavigate
}: CycleCountManagementPageProps) {
  const { t } = useI18n();
  const { resolvedTimeZone } = useSettings();
  const canManage = currentUserRole === "admin" || currentUserRole === "operator";
  const canConfigureColumns = currentUserRole === "admin";
  const pageDescription = t("cycleCountsDesc");
  const permissionNotice = canManage ? "" : t("readOnlyModeNotice");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedCycleCountId, setSelectedCycleCountId] = useState<number | null>(null);
  const [form, setForm] = useState<CycleCountFormState>(emptyCycleCountForm);
  const [lines, setLines] = useState<CycleCountLineFormState[]>([createCycleCountLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const selectedCycleCount = useMemo(
    () => cycleCounts.find((cycleCount) => cycleCount.id === selectedCycleCountId) ?? null,
    [cycleCounts, selectedCycleCountId]
  );

  useEffect(() => {
    if (selectedCycleCountId !== null && !selectedCycleCount) {
      setSelectedCycleCountId(null);
    }
  }, [selectedCycleCount, selectedCycleCountId]);

  const baseColumns = useMemo<GridColDef<CycleCount>[]>(() => [
    { field: "countNo", headerName: t("countNo"), minWidth: 180, flex: 1, renderCell: (params) => <span className="cell--mono">{params.row.countNo}</span> },
    { field: "totalLines", headerName: t("totalLines"), minWidth: 120, type: "number" },
    {
      field: "totalVariance",
      headerName: t("varianceQty"),
      minWidth: 140,
      type: "number",
      renderCell: (params) => (
        <span style={{ color: params.row.totalVariance >= 0 ? "#3c6e71" : "#b76857", fontWeight: 700 }}>
          {formatSignedNumber(params.row.totalVariance)}
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
              onClick: () => setSelectedCycleCountId(params.row.id)
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
    preferenceKey: CYCLE_COUNT_COLUMN_ORDER_PREFERENCE_KEY,
    baseColumns,
    canManage: canConfigureColumns,
    onError: setErrorMessage
  });

  const detailColumns = useMemo<GridColDef<CycleCount["lines"][number]>[]>(() => [
    { field: "sku", headerName: t("sku"), minWidth: 120, renderCell: (params) => <span className="cell--mono">{params.row.sku}</span> },
    { field: "description", headerName: t("description"), minWidth: 220, flex: 1.4 },
    { field: "customerName", headerName: t("customer"), minWidth: 170, flex: 1 },
    { field: "locationName", headerName: t("currentStorage"), minWidth: 170, flex: 1 },
    { field: "storageSection", headerName: t("storageSection"), minWidth: 110 },
    { field: "systemQty", headerName: t("systemQty"), minWidth: 120, type: "number" },
    { field: "countedQty", headerName: t("countedQty"), minWidth: 120, type: "number" },
    {
      field: "varianceQty",
      headerName: t("varianceQty"),
      minWidth: 120,
      type: "number",
      renderCell: (params) => (
        <span style={{ color: params.row.varianceQty >= 0 ? "#3c6e71" : "#b76857", fontWeight: 700 }}>
          {formatSignedNumber(params.row.varianceQty)}
        </span>
      )
    },
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

  function openCreateModal() {
    if (!canManage) return;
    setForm(emptyCycleCountForm);
    setLines([createCycleCountLine()]);
    setErrorMessage("");
    setIsModalOpen(true);
  }

  function closeCreateModal() {
    setIsModalOpen(false);
    setSubmitting(false);
    setErrorMessage("");
    setForm(emptyCycleCountForm);
    setLines([createCycleCountLine()]);
  }

  function addLine() {
    setLines((current) => [...current, createCycleCountLine()]);
  }

  function removeLine(lineId: string) {
    setLines((current) => current.length === 1 ? current : current.filter((line) => line.id !== lineId));
  }

  function updateLine(lineId: string, patch: Partial<CycleCountLineFormState>) {
    setLines((current) => current.map((line) => line.id === lineId ? { ...line, ...patch } : line));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage("");

    try {
      await api.createCycleCount({
        countNo: form.countNo || undefined,
        notes: form.notes || undefined,
        lines: lines
          .filter((line) => Number(line.itemId) > 0)
          .map((line) => ({
            itemId: Number(line.itemId),
            countedQty: Math.max(0, line.countedQty),
            lineNote: line.lineNote || undefined
          }))
      });
      closeCreateModal();
      await onRefresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("couldNotSaveCycleCount"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="workspace-main">
      <section className="workbook-panel workbook-panel--full">
        <div className="tab-strip">
          <WorkspacePanelHeader
            title={t("cycleCounts")}
            actions={canManage || canConfigureColumns ? (
              <div className="sheet-actions">
                {columnOrderAction}
                {canManage ? (
                  <Button variant="contained" startIcon={<AddCircleOutlineOutlinedIcon />} onClick={openCreateModal}>
                    {t("addCycleCount")}
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
              rows={cycleCounts}
              columns={columns}
              loading={isLoading}
              pagination
              pageSizeOptions={[10, 25, 50]}
              disableRowSelectionOnClick
              initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
              getRowHeight={() => 64}
              onRowClick={(params) => setSelectedCycleCountId(params.row.id)}
              getRowClassName={(params) => (params.row.id === selectedCycleCountId ? "document-row--selected" : "")}
              slots={mainGridSlots}
              sx={{ border: 0 }}
            />
          </Box>
        </div>
      </section>
      {columnOrderDialog}

      <Drawer
        anchor="right"
        open={Boolean(selectedCycleCount)}
        onClose={() => setSelectedCycleCountId(null)}
        PaperProps={{ className: "document-drawer" }}
      >
        {selectedCycleCount ? (
          <div className="document-drawer__content">
            <div className="document-drawer__header">
              <div>
                <div className="document-drawer__eyebrow">{t("cycleCounts")}</div>
                <h3>{selectedCycleCount.countNo}</h3>
                <p>{formatDateTimeValue(selectedCycleCount.createdAt, resolvedTimeZone)}</p>
              </div>
              <IconButton aria-label={t("close")} onClick={() => setSelectedCycleCountId(null)}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </div>

            <div className="document-drawer__actions">
              <Button
                variant="outlined"
                startIcon={<HistoryOutlinedIcon fontSize="small" />}
                onClick={() => {
                  setPendingAllActivityContext({ movementType: "COUNT" });
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
                <strong>{selectedCycleCount.totalLines}</strong>
                <span>{t("totalLines")}</span>
              </div>
              <div className="document-drawer__status-stat">
                <strong>{formatSignedNumber(selectedCycleCount.totalVariance)}</strong>
                <span>{t("varianceQty")}</span>
              </div>
              <div className="document-drawer__status-stat">
                <strong>{selectedCycleCount.status}</strong>
                <span>{t("status")}</span>
              </div>
            </div>

            <div className="document-drawer__audit-strip">
              <div className="document-drawer__audit-item">
                <strong>{t("created")}</strong>
                <span>{formatDateTimeValue(selectedCycleCount.createdAt, resolvedTimeZone)}</span>
              </div>
              <div className="document-drawer__audit-item">
                <strong>{t("updated")}</strong>
                <span>{formatDateTimeValue(selectedCycleCount.updatedAt, resolvedTimeZone)}</span>
              </div>
              <div className="document-drawer__audit-item">
                <strong>{t("status")}</strong>
                <span>{selectedCycleCount.status}</span>
              </div>
            </div>

            <div className="document-drawer__meta">
              <div className="sheet-note">
                <strong>{t("countNo")}</strong><br />
                {selectedCycleCount.countNo}
              </div>
              <div className="sheet-note">
                <strong>{t("created")}</strong><br />
                {formatDateTimeValue(selectedCycleCount.createdAt, resolvedTimeZone)}
              </div>
              <div className="sheet-note document-drawer__meta-note">
                <strong>{t("notes")}</strong><br />
                {selectedCycleCount.notes || "-"}
              </div>
            </div>

            <div className="document-drawer__section-title">{t("cycleCountLines")}</div>
            <Box sx={{ minWidth: 0 }}>
              <DataGrid
                rows={selectedCycleCount.lines}
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
          {t("addCycleCount")}
          <IconButton aria-label={t("close")} onClick={closeCreateModal} sx={{ position: "absolute", right: 16, top: 16 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {errorMessage ? <InlineAlert>{errorMessage}</InlineAlert> : null}
          <form className="sheet-form" onSubmit={handleSubmit}>
            <label>{t("countNo")}<input value={form.countNo} onChange={(event) => setForm((current) => ({ ...current, countNo: event.target.value }))} placeholder={t("autoGeneratedOptional")} /></label>
            <label className="sheet-form__wide">{t("notes")}<input value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder={t("cycleCountNotesPlaceholder")} /></label>

            <div className="sheet-form__wide">
              <div className="batch-lines__toolbar">
                <strong>{t("cycleCountLines")}</strong>
                <Button size="small" variant="outlined" type="button" onClick={addLine}>{t("addLine")}</Button>
              </div>
              <div className="batch-lines">
                {lines.map((line, index) => {
                  const selectedItem = items.find((item) => item.id === Number(line.itemId));
                  const systemQty = selectedItem?.quantity ?? 0;
                  const varianceQty = line.itemId ? line.countedQty - systemQty : 0;

                  return (
                    <div className="batch-line-card" key={line.id}>
                      <div className="batch-line-card__header">
                        <div className="batch-line-card__title">
                          <strong>{t("cycleCountLine")} #{index + 1}</strong>
                        </div>
                        <button className="button button--danger button--small" type="button" onClick={() => removeLine(line.id)} disabled={lines.length === 1}>{t("removeLine")}</button>
                      </div>
                      <div className="batch-line-grid">
                        <label className="batch-line-grid__description">
                          {t("stockRow")}
                          <select
                            value={line.itemId}
                            onChange={(event) => {
                              const nextItem = items.find((item) => item.id === Number(event.target.value));
                              updateLine(line.id, {
                                itemId: event.target.value,
                                countedQty: nextItem?.quantity ?? 0
                              });
                            }}
                          >
                            <option value="">{t("selectStockRow")}</option>
                            {items.map((item) => (
                              <option key={item.id} value={item.id}>
                                {`${item.customerName} | ${item.locationName} / ${item.storageSection || "A"} | ${item.sku} - ${displayDescription(item)} (${t("onHand")}: ${item.quantity})`}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>{t("systemQty")}<input value={selectedItem ? String(systemQty) : ""} readOnly /></label>
                        <label>{t("countedQty")}<input type="number" min="0" value={numberInputValue(line.countedQty)} onChange={(event) => updateLine(line.id, { countedQty: Math.max(0, Number(event.target.value || 0)) })} /></label>
                        <label>{t("varianceQty")}<input value={selectedItem ? formatSignedNumber(varianceQty) : ""} readOnly /></label>
                        <label className="batch-line-grid__detail">{t("internalNotes")}<input value={line.lineNote} onChange={(event) => updateLine(line.id, { lineNote: event.target.value })} placeholder={t("cycleCountLineNotePlaceholder")} /></label>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="sheet-form__actions sheet-form__wide">
              <button className="button button--primary" type="submit" disabled={submitting}>{submitting ? t("saving") : t("saveCycleCount")}</button>
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
  return value > 0 ? `+${value}` : String(value);
}
