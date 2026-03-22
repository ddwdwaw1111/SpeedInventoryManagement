import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import { type FormEvent, useDeferredValue, useMemo, useState } from "react";
import { Box, Button, Dialog, DialogContent, DialogTitle, IconButton } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";

import { api } from "../lib/api";
import { formatDateValue } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import type { Customer, CustomerPayload, Item, UserRole } from "../lib/types";
import { RowActionsMenu } from "./RowActionsMenu";

type CustomerManagementPageProps = {
  customers: Customer[];
  items: Item[];
  currentUserRole: UserRole;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
};

type CustomerFormState = {
  name: string;
  contactName: string;
  email: string;
  phone: string;
  notes: string;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

function createEmptyForm(): CustomerFormState {
  return {
    name: "",
    contactName: "",
    email: "",
    phone: "",
    notes: ""
  };
}

export function CustomerManagementPage({ customers, items, currentUserRole, isLoading, onRefresh }: CustomerManagementPageProps) {
  const { t } = useI18n();
  const canManage = currentUserRole === "admin";
  const [searchTerm, setSearchTerm] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<CustomerFormState>(() => createEmptyForm());
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const deferredSearchTerm = useDeferredValue(searchTerm);

  const normalizedSearch = deferredSearchTerm.trim().toLowerCase();
  const filteredRows = useMemo(() => customers.filter((row) => (
    normalizedSearch.length === 0
    || row.name.toLowerCase().includes(normalizedSearch)
    || row.contactName.toLowerCase().includes(normalizedSearch)
    || row.email.toLowerCase().includes(normalizedSearch)
    || row.phone.toLowerCase().includes(normalizedSearch)
  )), [customers, normalizedSearch]);

  const inventorySummaryByCustomer = useMemo(() => {
    const summary = new Map<number, { stockRows: number; onHand: number }>();

    for (const item of items) {
      const current = summary.get(item.customerId) ?? { stockRows: 0, onHand: 0 };
      current.stockRows += 1;
      current.onHand += item.quantity;
      summary.set(item.customerId, current);
    }

    return summary;
  }, [items]);

  const columns = useMemo<GridColDef<Customer>[]>(() => [
    { field: "name", headerName: t("customer"), minWidth: 180, flex: 1 },
    { field: "contactName", headerName: t("contactName"), minWidth: 160, flex: 0.9, valueGetter: (_, row) => row.contactName || "-" },
    { field: "email", headerName: t("email"), minWidth: 200, flex: 1.1, valueGetter: (_, row) => row.email || "-" },
    { field: "phone", headerName: t("phone"), minWidth: 150, flex: 0.8, valueGetter: (_, row) => row.phone || "-" },
    {
      field: "stockRows",
      headerName: t("assignedSkuRows"),
      minWidth: 130,
      type: "number",
      valueGetter: (_, row) => inventorySummaryByCustomer.get(row.id)?.stockRows ?? 0
    },
    {
      field: "onHand",
      headerName: t("onHand"),
      minWidth: 110,
      type: "number",
      valueGetter: (_, row) => inventorySummaryByCustomer.get(row.id)?.onHand ?? 0
    },
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
  ], [canManage, inventorySummaryByCustomer, t]);

  function openCreateModal() {
    if (!canManage) return;
    setEditingId(null);
    setForm(createEmptyForm());
    setErrorMessage("");
    setIsModalOpen(true);
  }

  function openEditModal(row: Customer) {
    if (!canManage) return;
    setEditingId(row.id);
    setForm({
      name: row.name,
      contactName: row.contactName,
      email: row.email,
      phone: row.phone,
      notes: row.notes
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

    const payload: CustomerPayload = {
      name: form.name,
      contactName: form.contactName,
      email: form.email,
      phone: form.phone,
      notes: form.notes
    };

    try {
      if (editingId) {
        await api.updateCustomer(editingId, payload);
      } else {
        await api.createCustomer(payload);
      }
      closeModal();
      await onRefresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("couldNotSaveCustomer"));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete(row: Customer) {
    if (!canManage) return;
    if (!window.confirm(t("deleteCustomerConfirm", { name: row.name }))) {
      return;
    }

    setErrorMessage("");
    try {
      await api.deleteCustomer(row.id);
      await onRefresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("couldNotDeleteCustomer"));
    }
  }

  return (
    <main className="workspace-main">
      {errorMessage && !isModalOpen ? <div className="alert-banner">{errorMessage}</div> : null}

      <section className="workbook-panel workbook-panel--full">
        <div className="tab-strip">
          <div className="tab-strip__toolbar">
            {canManage ? (
              <div className="tab-strip__actions">
                <Button variant="contained" startIcon={<AddCircleOutlineOutlinedIcon />} onClick={openCreateModal}>{t("addNew")}</Button>
              </div>
            ) : null}
          </div>
          {!canManage ? <div className="sheet-note sheet-note--readonly">{t("adminOnlyManageNotice")}</div> : null}
          <div className="filter-bar">
            <label>{t("search")}<input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder={t("customerSearchPlaceholder")} /></label>
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
          {editingId ? t("editCustomer") : t("addCustomer")}
          <IconButton aria-label={t("close")} onClick={closeModal} sx={{ position: "absolute", right: 16, top: 16 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {errorMessage ? <div className="alert-banner">{errorMessage}</div> : null}
          <form className="sheet-form" onSubmit={handleSubmit}>
            <label>{t("customer")}<input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder={t("customerNamePlaceholder")} required /></label>
            <label>{t("contactName")}<input value={form.contactName} onChange={(event) => setForm((current) => ({ ...current, contactName: event.target.value }))} placeholder={t("contactNamePlaceholder")} /></label>
            <label>{t("email")}<input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} placeholder="ops@example.com" /></label>
            <label>{t("phone")}<input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="201-555-0100" /></label>
            <label className="sheet-form__wide">{t("notes")}<input value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder={t("customerNotesPlaceholder")} /></label>
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
