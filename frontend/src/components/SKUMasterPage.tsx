import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import DragIndicatorOutlinedIcon from "@mui/icons-material/DragIndicatorOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";
import { type FormEvent, useDeferredValue, useEffect, useMemo, useState } from "react";
import { Box, Button, Dialog, DialogContent, DialogTitle, IconButton } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";

import { api } from "../lib/api";
import { RowActionsMenu } from "./RowActionsMenu";
import { formatDateValue } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import type { SKUMaster, SKUMasterPayload, UserRole } from "../lib/types";
import { InlineAlert, useConfirmDialog, useFeedbackToast } from "./Feedback";
import { buildWorkspaceGridSlots, WorkspacePanelHeader } from "./WorkspacePanelChrome";

type SKUMasterPageProps = {
  skuMasters: SKUMaster[];
  currentUserRole: UserRole;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
};

type SKUMasterFormState = {
  itemNumber: string;
  sku: string;
  description: string;
  category: string;
  unit: string;
  reorderLevel: number;
  defaultUnitsPerPallet: number;
};
const SKU_MASTER_COLUMN_ORDER_PREFERENCE_KEY = "sku-master.column-order";

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

function createEmptyForm(): SKUMasterFormState {
  return {
    itemNumber: "",
    sku: "",
    description: "",
    category: "General",
    unit: "pcs",
    reorderLevel: 0,
    defaultUnitsPerPallet: 0
  };
}

export function SKUMasterPage({ skuMasters, currentUserRole, isLoading, onRefresh }: SKUMasterPageProps) {
  const { t } = useI18n();
  const { confirm, confirmationDialog } = useConfirmDialog();
  const { showSuccess, showError, feedbackToast } = useFeedbackToast();
  const canManage = currentUserRole === "admin";
  const pageDescription = t("skuMasterDesc");
  const permissionNotice = canManage ? "" : t("adminOnlyManageNotice");
  const [searchTerm, setSearchTerm] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<SKUMasterFormState>(() => createEmptyForm());
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isColumnOrderModalOpen, setIsColumnOrderModalOpen] = useState(false);
  const [isSavingColumnOrder, setIsSavingColumnOrder] = useState(false);
  const [editableRows, setEditableRows] = useState<SKUMaster[]>(skuMasters);
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [draftColumnOrder, setDraftColumnOrder] = useState<string[]>([]);
  const [draggingColumnField, setDraggingColumnField] = useState<string | null>(null);
  const deferredSearchTerm = useDeferredValue(searchTerm);

  useEffect(() => {
    setEditableRows(skuMasters);
  }, [skuMasters]);

  useEffect(() => {
    let isActive = true;

    async function loadColumnOrder() {
      try {
        const preference = await api.getUIPreference<string[]>(SKU_MASTER_COLUMN_ORDER_PREFERENCE_KEY);
        if (!isActive) return;
        setColumnOrder(Array.isArray(preference.value) ? preference.value.filter((value): value is string => typeof value === "string" && value !== "actions") : []);
      } catch (error) {
        if (isActive) {
          setErrorMessage(error instanceof Error ? error.message : t("couldNotLoadReport"));
        }
      }
    }

    void loadColumnOrder();
    return () => {
      isActive = false;
    };
  }, [t]);

  const normalizedSearch = deferredSearchTerm.trim().toLowerCase();
  const filteredRows = useMemo(() => editableRows.filter((row) => (
    normalizedSearch.length === 0
    || row.itemNumber.toLowerCase().includes(normalizedSearch)
    || row.sku.toLowerCase().includes(normalizedSearch)
    || displayDescription(row).toLowerCase().includes(normalizedSearch)
    || row.category.toLowerCase().includes(normalizedSearch)
  )), [editableRows, normalizedSearch]);
  const hasActiveFilters = normalizedSearch.length > 0;
  const mainGridSlots = buildWorkspaceGridSlots({
    emptyTitle: t("noResults"),
    emptyDescription: hasActiveFilters ? t("filteredStateHint") : t("emptyStateHint"),
    loadingTitle: t("loadingRecords"),
    loadingDescription: pageDescription
  });

  const baseColumns = useMemo<GridColDef<SKUMaster>[]>(() => [
    {
      field: "itemNumber",
      headerName: t("itemNumber"),
      minWidth: 130,
      flex: 0.8,
      editable: canManage,
      disableReorder: !canManage,
      renderCell: (params) => <span className="cell--mono">{params.value || "-"}</span>
    },
    {
      field: "sku",
      headerName: t("sku"),
      minWidth: 130,
      flex: 0.8,
      editable: canManage,
      disableReorder: !canManage,
      renderCell: (params) => <span className="cell--mono">{params.value}</span>
    },
    {
      field: "description",
      headerName: t("description"),
      minWidth: 260,
      flex: 1.6,
      editable: canManage,
      disableReorder: !canManage,
      valueGetter: (_, row) => displayDescription(row),
      valueSetter: (value, row) => ({
        ...row,
        description: String(value ?? ""),
        name: String(value ?? "")
      })
    },
    { field: "category", headerName: t("category"), minWidth: 140, flex: 0.8, editable: canManage, disableReorder: !canManage },
    {
      field: "unit",
      headerName: t("unit"),
      minWidth: 100,
      flex: 0.6,
      editable: canManage,
      disableReorder: !canManage,
      renderCell: (params) => <span>{String(params.value ?? "").toUpperCase()}</span>
    },
    { field: "reorderLevel", headerName: t("reorderLevel"), minWidth: 130, type: "number", editable: canManage, disableReorder: !canManage },
    { field: "defaultUnitsPerPallet", headerName: t("defaultUnitsPerPallet"), minWidth: 170, type: "number", editable: canManage, disableReorder: !canManage },
    { field: "updatedAt", headerName: t("updated"), minWidth: 180, flex: 0.9, disableReorder: !canManage, valueFormatter: (value) => formatDateValue(value, dateFormatter) },
    {
      field: "actions",
      headerName: t("actions"),
      minWidth: 90,
      sortable: false,
      filterable: false,
      disableReorder: true,
      renderCell: (params) => canManage ? (
        <RowActionsMenu
          ariaLabel={t("actions")}
          actions={[
            { key: "edit", label: t("edit"), icon: <EditOutlinedIcon fontSize="small" />, onClick: () => openEditModal(params.row) },
            { key: "delete", label: t("delete"), icon: <DeleteOutlineOutlinedIcon fontSize="small" />, danger: true, onClick: () => handleDelete(params.row) }
          ]}
        />
      ) : null
    }
  ], [canManage, t]);

  const orderableFields = useMemo(
    () => baseColumns.filter((column) => column.field !== "actions").map((column) => column.field),
    [baseColumns]
  );

  const resolvedColumnOrder = useMemo(() => {
    if (columnOrder.length === 0) {
      return orderableFields;
    }

    const orderedFields = columnOrder.filter((field) => orderableFields.includes(field));
    const remainingFields = orderableFields.filter((field) => !orderedFields.includes(field));
    return [...orderedFields, ...remainingFields];
  }, [columnOrder, orderableFields]);

  const columns = useMemo<GridColDef<SKUMaster>[]>(() => {
    const baseColumnsByField = new Map(baseColumns.map((column) => [column.field, column] as const));
    const orderedColumns = resolvedColumnOrder
      .map((field) => baseColumnsByField.get(field))
      .filter((column): column is GridColDef<SKUMaster> => Boolean(column));
    const actionsColumn = baseColumnsByField.get("actions");
    return actionsColumn ? [...orderedColumns, actionsColumn] : orderedColumns;
  }, [baseColumns, resolvedColumnOrder]);

  function openCreateModal() {
    if (!canManage) return;
    setEditingId(null);
    setForm(createEmptyForm());
    setErrorMessage("");
    setIsModalOpen(true);
  }

  function openEditModal(row: SKUMaster) {
    if (!canManage) return;
    setEditingId(row.id);
    setForm({
      itemNumber: row.itemNumber || "",
      sku: row.sku,
      description: displayDescription(row),
      category: row.category || "General",
      unit: row.unit || "pcs",
      reorderLevel: row.reorderLevel,
      defaultUnitsPerPallet: row.defaultUnitsPerPallet || 0
    });
    setErrorMessage("");
    setIsModalOpen(true);
  }

  function buildPayload(row: SKUMaster): SKUMasterPayload {
    return {
      itemNumber: row.itemNumber?.trim() ?? "",
      sku: row.sku.trim(),
      name: displayDescription(row).trim(),
      category: row.category.trim() || "General",
      description: displayDescription(row).trim(),
      unit: row.unit.trim() || "pcs",
      reorderLevel: Math.max(0, Number(row.reorderLevel || 0)),
      defaultUnitsPerPallet: Math.max(0, Number(row.defaultUnitsPerPallet || 0))
    };
  }

  async function handleInlineUpdate(updatedRow: SKUMaster, originalRow: SKUMaster) {
    if (!canManage) return originalRow;

    const payload = buildPayload(updatedRow);
    if (!payload.sku || !payload.description) {
      throw new Error(t("couldNotSaveSkuMaster"));
    }

    setErrorMessage("");
    const savedRow = await api.updateSKUMaster(updatedRow.id, payload);
    setEditableRows((current) => current.map((row) => (row.id === savedRow.id ? savedRow : row)));
    void onRefresh();
    showSuccess(t("skuMasterSavedSuccess"));
    return savedRow;
  }

  async function persistColumnOrder(nextOrder: string[], previousOrder: string[]) {
    if (!canManage) return;
    try {
      await api.updateUIPreference<string[]>(SKU_MASTER_COLUMN_ORDER_PREFERENCE_KEY, nextOrder);
      showSuccess(t("columnOrderSavedSuccess"));
    } catch (error) {
      setColumnOrder(previousOrder);
      const message = error instanceof Error ? error.message : t("couldNotSaveSkuMaster");
      setErrorMessage(message);
      showError(message);
    }
  }

  function openColumnOrderModal() {
    if (!canManage) return;
    setDraftColumnOrder(resolvedColumnOrder);
    setIsColumnOrderModalOpen(true);
  }

  function closeColumnOrderModal() {
    setIsColumnOrderModalOpen(false);
    setDraftColumnOrder([]);
    setIsSavingColumnOrder(false);
    setDraggingColumnField(null);
  }

  function moveDraftColumn(field: string, targetField: string) {
    if (field === targetField) return;

    setDraftColumnOrder((current) => {
      const next = [...current];
      const currentIndex = next.indexOf(field);
      const targetIndex = next.indexOf(targetField);
      if (currentIndex === -1 || targetIndex === -1) {
        return current;
      }

      const [movedField] = next.splice(currentIndex, 1);
      next.splice(targetIndex, 0, movedField);
      return next;
    });
  }

  async function saveColumnOrder() {
    if (!canManage) return;
    const nextOrder = [...draftColumnOrder];
    const previousOrder = [...columnOrder];
    setIsSavingColumnOrder(true);
    setColumnOrder(nextOrder);
    await persistColumnOrder(nextOrder, previousOrder);
    setIsSavingColumnOrder(false);
    setIsColumnOrderModalOpen(false);
  }

  function closeModal() {
    setEditingId(null);
    setForm(createEmptyForm());
    setErrorMessage("");
    setIsModalOpen(false);
  }

  function showActionError(error: unknown, fallbackMessage: string) {
    const message = error instanceof Error ? error.message : fallbackMessage;
    setErrorMessage(message);
    showError(message);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage) return;
    setIsSubmitting(true);
    setErrorMessage("");

    const payload: SKUMasterPayload = {
      itemNumber: form.itemNumber,
      sku: form.sku,
      name: form.description,
      category: form.category,
      description: form.description,
      unit: form.unit,
      reorderLevel: form.reorderLevel,
      defaultUnitsPerPallet: form.defaultUnitsPerPallet
    };

    try {
      if (editingId) {
        await api.updateSKUMaster(editingId, payload);
      } else {
        await api.createSKUMaster(payload);
      }
      closeModal();
      await onRefresh();
      showSuccess(t("skuMasterSavedSuccess"));
    } catch (error) {
      showActionError(error, t("couldNotSaveSkuMaster"));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete(row: SKUMaster) {
    if (!canManage) return;
    if (!(await confirm({
      title: t("delete"),
      message: t("deleteSkuMasterConfirm", { sku: row.sku }),
      confirmLabel: t("delete"),
      cancelLabel: t("cancel"),
      confirmColor: "error",
      severity: "warning"
    }))) {
      return;
    }

    setErrorMessage("");
    try {
      await api.deleteSKUMaster(row.id);
      await onRefresh();
      showSuccess(t("skuMasterDeletedSuccess"));
    } catch (error) {
      showActionError(error, t("couldNotDeleteSkuMaster"));
    }
  }

  return (
    <main className="workspace-main">
      <section className="workbook-panel workbook-panel--full">
        <div className="tab-strip">
          <WorkspacePanelHeader
            title={t("skuMaster")}
            actions={canManage ? (
              <div className="sheet-actions">
                <Button variant="outlined" startIcon={<TuneOutlinedIcon />} onClick={openColumnOrderModal}>{t("columnOrder")}</Button>
                <Button variant="contained" startIcon={<AddCircleOutlineOutlinedIcon />} onClick={openCreateModal}>{t("addNew")}</Button>
              </div>
            ) : undefined}
            notices={[permissionNotice]}
            errorMessage={errorMessage && !isModalOpen ? errorMessage : ""}
          />
          <div className="filter-bar">
            <label>{t("search")}<input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder={t("skuMasterSearchPlaceholder")} /></label>
          </div>
        </div>

        <div className="sheet-table-wrap">
          <Box sx={{ minWidth: 0 }}>
            <DataGrid
              rows={filteredRows}
              columns={columns}
              loading={isLoading}
              editMode="cell"
              pagination
              pageSizeOptions={[10, 20, 50]}
              disableRowSelectionOnClick
              initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
              getRowHeight={() => 64}
              processRowUpdate={handleInlineUpdate}
              onProcessRowUpdateError={(error) => showActionError(error, t("couldNotSaveSkuMaster"))}
              slots={mainGridSlots}
              sx={{ border: 0 }}
            />
          </Box>
        </div>
      </section>

      <Dialog
        open={isModalOpen}
        onClose={(_, reason) => {
          if (reason === "backdropClick") return;
          closeModal();
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle sx={{ pb: 1 }}>
          {editingId ? t("editSkuMaster") : t("addSkuMaster")}
          <IconButton aria-label={t("close")} onClick={closeModal} sx={{ position: "absolute", right: 16, top: 16 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {errorMessage ? <InlineAlert>{errorMessage}</InlineAlert> : null}
          <form className="sheet-form" onSubmit={handleSubmit}>
            <label>{t("itemNumber")}<input value={form.itemNumber} onChange={(event) => setForm((current) => ({ ...current, itemNumber: event.target.value }))} placeholder="VB22GC" /></label>
            <label>{t("sku")}<input value={form.sku} onChange={(event) => setForm((current) => ({ ...current, sku: event.target.value }))} placeholder="ABC123" required /></label>
            <label className="sheet-form__wide">{t("description")}<input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder={t("descriptionPlaceholder")} required /></label>
            <label>{t("category")}<input value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} placeholder="General" /></label>
            <label>{t("unit")}<input value={form.unit} onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value }))} placeholder="pcs" /></label>
            <label>{t("reorderLevel")}<input type="number" min="0" value={form.reorderLevel} onChange={(event) => setForm((current) => ({ ...current, reorderLevel: Math.max(0, Number(event.target.value || 0)) }))} /></label>
            <label>{t("defaultUnitsPerPallet")}<input type="number" min="0" value={form.defaultUnitsPerPallet} onChange={(event) => setForm((current) => ({ ...current, defaultUnitsPerPallet: Math.max(0, Number(event.target.value || 0)) }))} placeholder="200" /></label>
            <div className="sheet-form__actions sheet-form__wide">
              <button className="button button--primary" type="submit" disabled={isSubmitting}>{isSubmitting ? t("saving") : editingId ? t("updateRow") : t("addRow")}</button>
              <button className="button button--ghost" type="button" onClick={closeModal}>{t("cancel")}</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {feedbackToast}

      <Dialog
        open={isColumnOrderModalOpen}
        onClose={(_, reason) => {
          if (reason === "backdropClick" || isSavingColumnOrder) return;
          closeColumnOrderModal();
        }}
        fullWidth
        maxWidth={false}
        PaperProps={{
          sx: {
            width: "min(1360px, 96vw)"
          }
        }}
      >
        <DialogTitle sx={{ pb: 1 }}>
          {t("columnOrder")}
          <IconButton aria-label={t("close")} onClick={closeColumnOrderModal} disabled={isSavingColumnOrder} sx={{ position: "absolute", right: 16, top: 16 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <div className="sheet-note sheet-note--readonly">{t("columnOrderSharedNotice")}</div>
          <div className="column-order-board">
            {draftColumnOrder.map((field, index) => {
              const column = baseColumns.find((candidate) => candidate.field === field);
              if (!column) return null;

              return (
                <div
                  className={`column-order-card ${draggingColumnField === field ? "column-order-card--dragging" : ""}`}
                  key={field}
                  draggable={!isSavingColumnOrder}
                  onDragStart={() => setDraggingColumnField(field)}
                  onDragEnd={() => setDraggingColumnField(null)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (!draggingColumnField) return;
                    moveDraftColumn(draggingColumnField, field);
                    setDraggingColumnField(null);
                  }}
                >
                  <DragIndicatorOutlinedIcon fontSize="small" />
                  <div className="column-order-card__copy">
                    <strong>{column.headerName}</strong>
                    <span>{t("positionLabel", { position: index + 1 })}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="sheet-form__actions" style={{ marginTop: "1rem" }}>
            <button className="button button--primary" type="button" disabled={isSavingColumnOrder} onClick={() => void saveColumnOrder()}>
              {isSavingColumnOrder ? t("saving") : t("saveChanges")}
            </button>
            <button className="button button--ghost" type="button" disabled={isSavingColumnOrder} onClick={() => setDraftColumnOrder(orderableFields)}>
              {t("resetDefault")}
            </button>
            <button className="button button--ghost" type="button" disabled={isSavingColumnOrder} onClick={closeColumnOrderModal}>
              {t("cancel")}
            </button>
          </div>
        </DialogContent>
      </Dialog>
      {confirmationDialog}
    </main>
  );
}

function displayDescription(row: Pick<SKUMaster, "description" | "name">) {
  return row.description || row.name;
}
