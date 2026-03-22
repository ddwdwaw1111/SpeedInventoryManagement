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
import type { InventoryTransfer, Item, Location, UserRole } from "../lib/types";
import { RowActionsMenu } from "./RowActionsMenu";

type TransferManagementPageProps = {
  transfers: InventoryTransfer[];
  items: Item[];
  locations: Location[];
  currentUserRole: UserRole;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
};

type TransferFormState = {
  transferNo: string;
  notes: string;
};

type TransferLineFormState = {
  id: string;
  sourceItemId: string;
  quantity: number;
  toLocationId: string;
  toStorageSection: string;
  lineNote: string;
};

const emptyTransferForm: TransferFormState = {
  transferNo: "",
  notes: ""
};

function createTransferLine(): TransferLineFormState {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sourceItemId: "",
    quantity: 0,
    toLocationId: "",
    toStorageSection: "A",
    lineNote: ""
  };
}

export function TransferManagementPage({
  transfers,
  items,
  locations,
  currentUserRole,
  isLoading,
  onRefresh
}: TransferManagementPageProps) {
  const { t } = useI18n();
  const { resolvedTimeZone } = useSettings();
  const canManage = currentUserRole === "admin" || currentUserRole === "operator";
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedTransfer, setSelectedTransfer] = useState<InventoryTransfer | null>(null);
  const [form, setForm] = useState<TransferFormState>(emptyTransferForm);
  const [lines, setLines] = useState<TransferLineFormState[]>([createTransferLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const availableSourceItems = useMemo(() => items.filter((item) => item.quantity > 0), [items]);

  const columns = useMemo<GridColDef<InventoryTransfer>[]>(() => [
    { field: "transferNo", headerName: t("transferNo"), minWidth: 180, flex: 1, renderCell: (params) => <span className="cell--mono">{params.row.transferNo}</span> },
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
              onClick: () => {
                setSelectedTransfer(params.row);
                setIsDetailOpen(true);
              }
            }
          ]}
        />
      )
    }
  ], [resolvedTimeZone, t]);

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

  function openCreateModal() {
    if (!canManage) {
      return;
    }
    setForm(emptyTransferForm);
    setLines([createTransferLine()]);
    setErrorMessage("");
    setIsModalOpen(true);
  }

  function closeCreateModal() {
    setIsModalOpen(false);
    setSubmitting(false);
    setErrorMessage("");
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage("");

    try {
      await api.createInventoryTransfer({
        transferNo: form.transferNo || undefined,
        notes: form.notes || undefined,
        lines: lines
          .filter((line) => Number(line.sourceItemId) > 0 && Number(line.toLocationId) > 0 && line.quantity > 0)
          .map((line) => ({
            sourceItemId: Number(line.sourceItemId),
            quantity: line.quantity,
            toLocationId: Number(line.toLocationId),
            toStorageSection: line.toStorageSection || undefined,
            lineNote: line.lineNote || undefined
          }))
      });
      closeCreateModal();
      await onRefresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("couldNotSaveTransfer"));
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
                  {t("addTransfer")}
                </Button>
              ) : null}
            </div>
          </div>
          {!canManage ? <div className="sheet-note sheet-note--readonly">{t("readOnlyModeNotice")}</div> : null}
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
          {t("addTransfer")}
          <IconButton aria-label={t("close")} onClick={closeCreateModal} sx={{ position: "absolute", right: 16, top: 16 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {errorMessage ? <div className="alert-banner">{errorMessage}</div> : null}
          <form className="sheet-form" onSubmit={handleSubmit}>
            <label>{t("transferNo")}<input value={form.transferNo} onChange={(event) => setForm((current) => ({ ...current, transferNo: event.target.value }))} placeholder={t("autoGeneratedOptional")} /></label>
            <label className="sheet-form__wide">{t("notes")}<input value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder={t("transferNotesPlaceholder")} /></label>

            <div className="sheet-form__wide">
              <div className="batch-lines__toolbar">
                <strong>{t("transferLines")}</strong>
                <Button size="small" variant="outlined" type="button" onClick={addLine}>{t("addLine")}</Button>
              </div>
              <div className="batch-lines">
                {lines.map((line, index) => {
                  const selectedItem = availableSourceItems.find((item) => item.id === Number(line.sourceItemId));
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
                          <select value={line.sourceItemId} onChange={(event) => updateLine(line.id, { sourceItemId: event.target.value })}>
                            <option value="">{t("selectStockRow")}</option>
                            {availableSourceItems.map((item) => (
                              <option key={item.id} value={item.id}>
                                {`${item.customerName} | ${item.locationName} / ${item.storageSection || "A"} | ${item.sku} - ${displayDescription(item)} (${t("availableQty")}: ${item.quantity})`}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>{t("availableQty")}<input value={selectedItem ? String(selectedItem.quantity) : ""} readOnly /></label>
                        <label>{t("transferQty")}<input type="number" min="0" value={numberInputValue(line.quantity)} onChange={(event) => updateLine(line.id, { quantity: Math.max(0, Number(event.target.value || 0)) })} /></label>
                        <label>{t("destinationStorage")}<select value={line.toLocationId} onChange={(event) => updateLine(line.id, { toLocationId: event.target.value, toStorageSection: getLocationSectionOptions(locations.find((location) => location.id === Number(event.target.value)))[0] || "A" })}><option value="">{t("selectStorage")}</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
                        <label>{t("toSection")}<select value={line.toStorageSection} onChange={(event) => updateLine(line.id, { toStorageSection: event.target.value })}>{sectionOptions.map((section) => <option key={section} value={section}>{section}</option>)}</select></label>
                        <label className="batch-line-grid__detail">{t("internalNotes")}<input value={line.lineNote} onChange={(event) => updateLine(line.id, { lineNote: event.target.value })} placeholder={t("transferLineNotePlaceholder")} /></label>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="sheet-form__actions sheet-form__wide">
              <button className="button button--primary" type="submit" disabled={submitting}>{submitting ? t("saving") : t("saveTransfer")}</button>
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
          setSelectedTransfer(null);
        }}
        fullWidth
        maxWidth="lg"
      >
        <DialogTitle sx={{ pb: 1 }}>
          {selectedTransfer?.transferNo ?? t("details")}
          <IconButton aria-label={t("close")} onClick={() => { setIsDetailOpen(false); setSelectedTransfer(null); }} sx={{ position: "absolute", right: 16, top: 16 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {selectedTransfer ? (
            <>
              <div className="sheet-note" style={{ marginBottom: "1rem" }}>
                <strong>{t("status")}:</strong> {selectedTransfer.status}{" "}
                <strong style={{ marginLeft: "1rem" }}>{t("routes")}:</strong> {selectedTransfer.routes || "-"}{" "}
                <strong style={{ marginLeft: "1rem" }}>{t("notes")}:</strong> {selectedTransfer.notes || "-"}
              </div>
              <Box sx={{ minWidth: 0 }}>
                <DataGrid
                  rows={selectedTransfer.lines}
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

function getLocationSectionOptions(location: Location | undefined) {
  const sectionNames = location?.sectionNames?.map((sectionName) => sectionName.trim()).filter(Boolean) ?? [];
  return sectionNames.length > 0 ? sectionNames : ["A"];
}
