import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import CloseIcon from "@mui/icons-material/Close";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { type FormEvent, useMemo, useState } from "react";
import { Box, Button, Chip, Dialog, DialogContent, DialogTitle, IconButton } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";

import { api } from "../lib/api";
import { formatDateTimeValue } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import type { InventoryAdjustment, Item, UserRole } from "../lib/types";
import { RowActionsMenu } from "./RowActionsMenu";

type AdjustmentManagementPageProps = {
  adjustments: InventoryAdjustment[];
  items: Item[];
  currentUserRole: UserRole;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
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
  onRefresh
}: AdjustmentManagementPageProps) {
  const { t } = useI18n();
  const { resolvedTimeZone } = useSettings();
  const canManage = currentUserRole === "admin" || currentUserRole === "operator";
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedAdjustment, setSelectedAdjustment] = useState<InventoryAdjustment | null>(null);
  const [form, setForm] = useState<AdjustmentFormState>(emptyAdjustmentForm);
  const [lines, setLines] = useState<AdjustmentLineFormState[]>([createAdjustmentLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const columns = useMemo<GridColDef<InventoryAdjustment>[]>(() => [
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
              onClick: () => {
                setSelectedAdjustment(params.row);
                setIsDetailOpen(true);
              }
            }
          ]}
        />
      )
    }
  ], [resolvedTimeZone, t]);

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

  function openCreateModal() {
    if (!canManage) {
      return;
    }
    setForm(emptyAdjustmentForm);
    setLines([createAdjustmentLine()]);
    setErrorMessage("");
    setIsModalOpen(true);
  }

  function closeCreateModal() {
    setIsModalOpen(false);
    setSubmitting(false);
    setErrorMessage("");
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
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("couldNotSaveAdjustment"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="workspace-main">
      {errorMessage && !isModalOpen ? <div className="alert-banner">{errorMessage}</div> : null}

      <section className="workbook-panel workbook-panel--full">
        <div className="tab-strip">
          <div className="tab-strip__toolbar">
            <div className="tab-strip__actions">
              {canManage ? (
                <Button variant="contained" startIcon={<AddCircleOutlineOutlinedIcon />} onClick={openCreateModal}>
                  {t("addAdjustment")}
                </Button>
              ) : null}
            </div>
          </div>
          {!canManage ? <div className="sheet-note sheet-note--readonly">{t("readOnlyModeNotice")}</div> : null}
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
              sx={{ border: 0 }}
            />
          </Box>
        </div>
      </section>

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
          {errorMessage ? <div className="alert-banner">{errorMessage}</div> : null}
          <form className="sheet-form" onSubmit={handleSubmit}>
            <label>{t("adjustmentNo")}<input value={form.adjustmentNo} onChange={(event) => setForm((current) => ({ ...current, adjustmentNo: event.target.value }))} placeholder={t("autoGeneratedOptional")} /></label>
            <label>{t("reasonCode")}<input value={form.reasonCode} onChange={(event) => setForm((current) => ({ ...current, reasonCode: event.target.value }))} placeholder="COUNT_GAIN / DAMAGE / CORRECTION" required /></label>
            <label className="sheet-form__wide">{t("notes")}<input value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder={t("adjustmentNotesPlaceholder")} /></label>

            <div className="sheet-form__wide">
              <div className="batch-lines__toolbar">
                <strong>{t("adjustmentLines")}</strong>
                <Button size="small" variant="outlined" type="button" onClick={addLine}>{t("addLine")}</Button>
              </div>
              <div className="batch-lines">
                {lines.map((line, index) => {
                  const selectedItem = items.find((item) => item.id === Number(line.itemId));
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
                            <option value="">{t("selectStockRow")}</option>
                            {items.map((item) => (
                              <option key={item.id} value={item.id}>
                                {`${item.customerName} | ${item.locationName} / ${item.storageSection || "A"} | ${item.sku} - ${displayDescription(item)} (${t("onHand")}: ${item.quantity})`}
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

      <Dialog
        open={isDetailOpen}
        onClose={(_, reason) => {
          if (reason === "backdropClick") return;
          setIsDetailOpen(false);
          setSelectedAdjustment(null);
        }}
        fullWidth
        maxWidth="lg"
      >
        <DialogTitle sx={{ pb: 1 }}>
          {selectedAdjustment?.adjustmentNo ?? t("details")}
          <IconButton aria-label={t("close")} onClick={() => { setIsDetailOpen(false); setSelectedAdjustment(null); }} sx={{ position: "absolute", right: 16, top: 16 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {selectedAdjustment ? (
            <>
              <div className="sheet-note" style={{ marginBottom: "1rem" }}>
                <strong>{t("reasonCode")}:</strong> {selectedAdjustment.reasonCode}{" "}
                <strong style={{ marginLeft: "1rem" }}>{t("status")}:</strong> {selectedAdjustment.status}{" "}
                <strong style={{ marginLeft: "1rem" }}>{t("notes")}:</strong> {selectedAdjustment.notes || "-"}
              </div>
              <Box sx={{ minWidth: 0 }}>
                <DataGrid
                  rows={selectedAdjustment.lines}
                  columns={detailColumns}
                  pagination
                  pageSizeOptions={[10, 25, 50]}
                  disableRowSelectionOnClick
                  initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
                  getRowHeight={() => 64}
                  sx={{ border: 0 }}
                />
              </Box>
            </>
          ) : null}
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
