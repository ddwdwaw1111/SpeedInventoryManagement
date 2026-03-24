import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import { type FormEvent, useDeferredValue, useMemo, useState } from "react";
import { Box, Button, Dialog, DialogContent, DialogTitle, IconButton } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";

import { api } from "../lib/api";
import { RowActionsMenu } from "./RowActionsMenu";
import { formatDateValue } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import type { SKUMaster, SKUMasterPayload, UserRole } from "../lib/types";
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
};

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

function createEmptyForm(): SKUMasterFormState {
  return {
    itemNumber: "",
    sku: "",
    description: "",
    category: "General",
    unit: "pcs",
    reorderLevel: 0
  };
}

export function SKUMasterPage({ skuMasters, currentUserRole, isLoading, onRefresh }: SKUMasterPageProps) {
  const { t } = useI18n();
  const canManage = currentUserRole === "admin";
  const pageDescription = t("skuMasterDesc");
  const permissionNotice = canManage ? "" : t("adminOnlyManageNotice");
  const [searchTerm, setSearchTerm] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<SKUMasterFormState>(() => createEmptyForm());
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const deferredSearchTerm = useDeferredValue(searchTerm);

  const normalizedSearch = deferredSearchTerm.trim().toLowerCase();
  const filteredRows = useMemo(() => skuMasters.filter((row) => (
    normalizedSearch.length === 0
    || row.itemNumber.toLowerCase().includes(normalizedSearch)
    || row.sku.toLowerCase().includes(normalizedSearch)
    || displayDescription(row).toLowerCase().includes(normalizedSearch)
    || row.category.toLowerCase().includes(normalizedSearch)
  )), [normalizedSearch, skuMasters]);
  const hasActiveFilters = normalizedSearch.length > 0;
  const mainGridSlots = buildWorkspaceGridSlots({
    emptyTitle: t("noResults"),
    emptyDescription: hasActiveFilters ? t("filteredStateHint") : t("emptyStateHint"),
    loadingTitle: t("loadingRecords"),
    loadingDescription: pageDescription
  });

  const columns = useMemo<GridColDef<SKUMaster>[]>(() => [
    { field: "itemNumber", headerName: t("itemNumber"), minWidth: 130, flex: 0.8, renderCell: (params) => <span className="cell--mono">{params.value || "-"}</span> },
    { field: "sku", headerName: t("sku"), minWidth: 130, flex: 0.8, renderCell: (params) => <span className="cell--mono">{params.value}</span> },
    { field: "description", headerName: t("description"), minWidth: 260, flex: 1.6, valueGetter: (_, row) => displayDescription(row) },
    { field: "category", headerName: t("category"), minWidth: 140, flex: 0.8 },
    { field: "unit", headerName: t("unit"), minWidth: 100, flex: 0.6, valueGetter: (_, row) => row.unit.toUpperCase() },
    { field: "reorderLevel", headerName: t("reorderLevel"), minWidth: 130, type: "number" },
    { field: "updatedAt", headerName: t("updated"), minWidth: 180, flex: 0.9, valueFormatter: (value) => formatDateValue(value, dateFormatter) },
    {
      field: "actions",
      headerName: t("actions"),
      minWidth: 90,
      sortable: false,
      filterable: false,
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
      reorderLevel: row.reorderLevel
    });
    setErrorMessage("");
    setIsModalOpen(true);
  }

  function closeModal() {
    setEditingId(null);
    setForm(createEmptyForm());
    setErrorMessage("");
    setIsModalOpen(false);
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
      reorderLevel: form.reorderLevel
    };

    try {
      if (editingId) {
        await api.updateSKUMaster(editingId, payload);
      } else {
        await api.createSKUMaster(payload);
      }
      closeModal();
      await onRefresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("couldNotSaveSkuMaster"));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete(row: SKUMaster) {
    if (!canManage) return;
    if (!window.confirm(t("deleteSkuMasterConfirm", { sku: row.sku }))) {
      return;
    }

    setErrorMessage("");
    try {
      await api.deleteSKUMaster(row.id);
      await onRefresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("couldNotDeleteSkuMaster"));
    }
  }

  return (
    <main className="workspace-main">
      <section className="workbook-panel workbook-panel--full">
        <div className="tab-strip">
          <WorkspacePanelHeader
            title={t("skuMaster")}
            actions={canManage ? (
              <Button variant="contained" startIcon={<AddCircleOutlineOutlinedIcon />} onClick={openCreateModal}>{t("addNew")}</Button>
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
              pagination
              pageSizeOptions={[10, 20, 50]}
              disableRowSelectionOnClick
              initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
              getRowHeight={() => 64}
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
          {errorMessage ? <div className="alert-banner">{errorMessage}</div> : null}
          <form className="sheet-form" onSubmit={handleSubmit}>
            <label>{t("itemNumber")}<input value={form.itemNumber} onChange={(event) => setForm((current) => ({ ...current, itemNumber: event.target.value }))} placeholder="VB22GC" /></label>
            <label>{t("sku")}<input value={form.sku} onChange={(event) => setForm((current) => ({ ...current, sku: event.target.value }))} placeholder="023042" required /></label>
            <label className="sheet-form__wide">{t("description")}<input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder={t("descriptionPlaceholder")} required /></label>
            <label>{t("category")}<input value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} placeholder="General" /></label>
            <label>{t("unit")}<input value={form.unit} onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value }))} placeholder="pcs" /></label>
            <label>{t("reorderLevel")}<input type="number" min="0" value={form.reorderLevel} onChange={(event) => setForm((current) => ({ ...current, reorderLevel: Math.max(0, Number(event.target.value || 0)) }))} /></label>
            <div className="sheet-form__actions sheet-form__wide">
              <button className="button button--primary" type="submit" disabled={isSubmitting}>{isSubmitting ? t("saving") : editingId ? t("updateRow") : t("addRow")}</button>
              <button className="button button--ghost" type="button" onClick={closeModal}>{t("cancel")}</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function displayDescription(row: Pick<SKUMaster, "description" | "name">) {
  return row.description || row.name;
}
