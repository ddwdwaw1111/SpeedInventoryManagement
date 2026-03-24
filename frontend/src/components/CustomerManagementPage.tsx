import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import MoveToInboxOutlinedIcon from "@mui/icons-material/MoveToInboxOutlined";
import OutboxOutlinedIcon from "@mui/icons-material/OutboxOutlined";
import WarehouseOutlinedIcon from "@mui/icons-material/WarehouseOutlined";
import { type FormEvent, useDeferredValue, useEffect, useMemo, useState } from "react";
import { Box, Button, Chip, Dialog, DialogContent, DialogTitle, Drawer, IconButton } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";

import { api } from "../lib/api";
import { setPendingAllActivityContext } from "../lib/allActivityContext";
import { formatDateValue } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import type { PageKey } from "../lib/routes";
import type { Customer, CustomerPayload, InboundDocument, Item, Movement, OutboundDocument, UserRole } from "../lib/types";
import { RowActionsMenu } from "./RowActionsMenu";
import { buildWorkspaceGridSlots, WorkspacePanelHeader } from "./WorkspacePanelChrome";

type CustomerManagementPageProps = {
  customers: Customer[];
  items: Item[];
  inboundDocuments: InboundDocument[];
  outboundDocuments: OutboundDocument[];
  movements: Movement[];
  currentUserRole: UserRole;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
  onNavigate: (page: PageKey) => void;
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

export function CustomerManagementPage({
  customers,
  items,
  inboundDocuments,
  outboundDocuments,
  movements,
  currentUserRole,
  isLoading,
  onRefresh,
  onNavigate
}: CustomerManagementPageProps) {
  const { t } = useI18n();
  const canManage = currentUserRole === "admin";
  const pageDescription = t("customersDesc");
  const permissionNotice = canManage ? "" : t("adminOnlyManageNotice");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
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
    const summary = new Map<number, { stockRows: number; onHand: number; available: number; allocated: number; warehouses: Set<number>; lowStockRows: number }>();

    for (const item of items) {
      const current = summary.get(item.customerId) ?? {
        stockRows: 0,
        onHand: 0,
        available: 0,
        allocated: 0,
        warehouses: new Set<number>(),
        lowStockRows: 0
      };
      current.stockRows += 1;
      current.onHand += item.quantity;
      current.available += item.availableQty;
      current.allocated += item.allocatedQty;
      current.warehouses.add(item.locationId);
      if (item.reorderLevel > 0 && item.availableQty <= item.reorderLevel) {
        current.lowStockRows += 1;
      }
      summary.set(item.customerId, current);
    }

    return summary;
  }, [items]);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === selectedCustomerId) ?? null,
    [customers, selectedCustomerId]
  );
  const hasActiveFilters = normalizedSearch.length > 0;
  const mainGridSlots = buildWorkspaceGridSlots({
    emptyTitle: t("noResults"),
    emptyDescription: hasActiveFilters ? t("filteredStateHint") : t("emptyStateHint"),
    loadingTitle: t("loadingRecords"),
    loadingDescription: pageDescription
  });

  useEffect(() => {
    if (selectedCustomerId !== null && !selectedCustomer) {
      setSelectedCustomerId(null);
    }
  }, [selectedCustomer, selectedCustomerId]);

  const selectedCustomerItems = useMemo(
    () => items
      .filter((item) => item.customerId === selectedCustomerId)
      .sort((left, right) => right.availableQty - left.availableQty)
      .slice(0, 8),
    [items, selectedCustomerId]
  );

  const selectedInboundDocuments = useMemo(
    () => inboundDocuments
      .filter((document) => document.customerId === selectedCustomerId)
      .sort((left, right) => getDocumentTimestamp(right.updatedAt || right.createdAt) - getDocumentTimestamp(left.updatedAt || left.createdAt))
      .slice(0, 6),
    [inboundDocuments, selectedCustomerId]
  );

  const selectedOutboundDocuments = useMemo(
    () => outboundDocuments
      .filter((document) => document.customerId === selectedCustomerId)
      .sort((left, right) => getDocumentTimestamp(right.updatedAt || right.createdAt) - getDocumentTimestamp(left.updatedAt || left.createdAt))
      .slice(0, 6),
    [outboundDocuments, selectedCustomerId]
  );

  const selectedCustomerMovements = useMemo(
    () => movements
      .filter((movement) => movement.customerId === selectedCustomerId)
      .sort((left, right) => getMovementTimestamp(right) - getMovementTimestamp(left))
      .slice(0, 8),
    [movements, selectedCustomerId]
  );

  const selectedCustomerSummary = selectedCustomer
    ? inventorySummaryByCustomer.get(selectedCustomer.id) ?? { stockRows: 0, onHand: 0, available: 0, allocated: 0, warehouses: new Set<number>(), lowStockRows: 0 }
    : null;
  const selectedOpenDocumentsCount = selectedInboundDocuments.filter((document) => isOpenStatus(document.status)).length
    + selectedOutboundDocuments.filter((document) => isOpenStatus(document.status)).length;

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
    setSelectedCustomerId(row.id);
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

  function openWorkspace(page: PageKey) {
    if (page === "all-activity" && selectedCustomer) {
      setPendingAllActivityContext({
        customerId: selectedCustomer.id
      });
    }
    onNavigate(page);
  }

  return (
    <main className="workspace-main">
      <section className="workbook-panel workbook-panel--full">
        <div className="tab-strip">
          <WorkspacePanelHeader
            title={t("customers")}
            actions={canManage ? (
              <Button variant="contained" startIcon={<AddCircleOutlineOutlinedIcon />} onClick={openCreateModal}>{t("addNew")}</Button>
            ) : undefined}
            notices={[permissionNotice]}
            errorMessage={errorMessage && !isModalOpen ? errorMessage : ""}
          />
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
              onRowClick={(params) => setSelectedCustomerId(params.row.id)}
              getRowClassName={(params) => (params.row.id === selectedCustomerId ? "document-row--selected" : "")}
              slots={mainGridSlots}
              sx={{ border: 0 }}
            />
          </Box>
        </div>
      </section>

      <Drawer
        anchor="right"
        open={Boolean(selectedCustomer)}
        onClose={() => setSelectedCustomerId(null)}
        PaperProps={{ className: "document-drawer" }}
      >
        {selectedCustomer ? (
          <div className="document-drawer__content">
            <div className="document-drawer__header">
              <div>
                <div className="document-drawer__eyebrow">{t("customers")}</div>
                <h3>{selectedCustomer.name}</h3>
                <p>{selectedCustomer.contactName || "-"} | {selectedCustomer.email || "-"} | {selectedCustomer.phone || "-"}</p>
              </div>
              <IconButton aria-label={t("close")} onClick={() => setSelectedCustomerId(null)}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </div>

            <div className="document-drawer__actions">
              {canManage ? (
                <Button variant="contained" startIcon={<EditOutlinedIcon fontSize="small" />} onClick={() => openEditModal(selectedCustomer)}>
                  {t("editCustomer")}
                </Button>
              ) : null}
              <Button variant="outlined" startIcon={<WarehouseOutlinedIcon fontSize="small" />} onClick={() => openWorkspace("stock-by-location")}>
                {t("stockByLocation")}
              </Button>
              <Button variant="outlined" startIcon={<MoveToInboxOutlinedIcon fontSize="small" />} onClick={() => openWorkspace("inbound-management")}>
                {t("inbound")}
              </Button>
              <Button variant="outlined" startIcon={<OutboxOutlinedIcon fontSize="small" />} onClick={() => openWorkspace("outbound-management")}>
                {t("outbound")}
              </Button>
              <Button variant="outlined" startIcon={<HistoryOutlinedIcon fontSize="small" />} onClick={() => openWorkspace("all-activity")}>
                {t("allActivity")}
              </Button>
            </div>

            <div className="document-drawer__status-bar">
                <div className="document-drawer__status-main">
                  <div className="sheet-note">
                    <strong>{selectedCustomer.notes || "-"}</strong>
                    <div>{t("notes")}</div>
                  </div>
                </div>
              <div className="document-drawer__status-stat">
                <strong>{selectedCustomerSummary?.stockRows ?? 0}</strong>
                <span>{t("assignedSkuRows")}</span>
              </div>
              <div className="document-drawer__status-stat">
                <strong>{selectedCustomerSummary?.onHand ?? 0}</strong>
                <span>{t("onHand")}</span>
              </div>
              <div className="document-drawer__status-stat">
                <strong>{selectedCustomerSummary?.available ?? 0}</strong>
                <span>{t("availableQty")}</span>
              </div>
            </div>

            <div className="document-drawer__meta">
              <div className="sheet-note">
                <strong>{t("contactName")}</strong><br />
                {selectedCustomer.contactName || "-"}
              </div>
              <div className="sheet-note">
                <strong>{t("updated")}</strong><br />
                {formatDateValue(selectedCustomer.updatedAt, dateFormatter)}
              </div>
            </div>

            <div className="document-drawer__meta">
              <div className="sheet-note">
                <strong>{t("allocatedQty")}</strong><br />
                {selectedCustomerSummary?.allocated ?? 0}
              </div>
              <div className="sheet-note">
                <strong>{t("customerWarehouseFootprint")}</strong><br />
                {selectedCustomerSummary?.warehouses.size ?? 0}
              </div>
              <div className="sheet-note">
                <strong>{t("customerLowStockRows")}</strong><br />
                {selectedCustomerSummary?.lowStockRows ?? 0}
              </div>
              <div className="sheet-note">
                <strong>{t("openDocuments")}</strong><br />
                {selectedOpenDocumentsCount}
              </div>
            </div>

            <div>
              <div className="document-drawer__section-title">{t("currentInventoryRows")}</div>
              <div className="document-drawer__list">
                {selectedCustomerItems.length > 0 ? selectedCustomerItems.map((item) => (
                  <div className="document-drawer__list-row" key={item.id}>
                    <div>
                      <strong>{item.sku}</strong>
                      <span>{item.description || item.name}</span>
                    </div>
                    <div>
                      <strong>{item.quantity} / {item.availableQty}</strong>
                      <span>{item.locationName} / {item.storageSection || "A"} · {t("onHand")} / {t("availableQty")}</span>
                    </div>
                  </div>
                )) : <div className="sheet-note">{t("noCustomerInventory")}</div>}
              </div>
            </div>

            <div>
              <div className="document-drawer__section-title">{t("recentInboundDocuments")}</div>
              <div className="document-drawer__list">
                {selectedInboundDocuments.length > 0 ? selectedInboundDocuments.map((document) => (
                  <div className="document-drawer__list-row" key={document.id}>
                    <div>
                      <strong>{document.containerNo || `#${document.id}`}</strong>
                      <span>{document.locationName}</span>
                    </div>
                    <div>
                      <strong>{document.totalReceivedQty}</strong>
                      <span>{formatDateValue(document.deliveryDate, dateFormatter)}</span>
                    </div>
                    <div>{renderDocumentStatusChip(document.status, t)}</div>
                  </div>
                )) : <div className="sheet-note">{t("noCustomerDocuments")}</div>}
              </div>
            </div>

            <div>
              <div className="document-drawer__section-title">{t("recentOutboundDocuments")}</div>
              <div className="document-drawer__list">
                {selectedOutboundDocuments.length > 0 ? selectedOutboundDocuments.map((document) => (
                  <div className="document-drawer__list-row" key={document.id}>
                    <div>
                      <strong>{document.packingListNo || `#${document.id}`}</strong>
                      <span>{document.storages || "-"}</span>
                    </div>
                    <div>
                      <strong>{document.totalQty}</strong>
                      <span>{formatDateValue(document.outDate, dateFormatter)}</span>
                    </div>
                    <div>{renderDocumentStatusChip(document.status, t)}</div>
                  </div>
                )) : <div className="sheet-note">{t("noCustomerDocuments")}</div>}
              </div>
            </div>

            <div>
              <div className="document-drawer__section-title">{t("recentActivity")}</div>
              <div className="document-drawer__list">
                {selectedCustomerMovements.length > 0 ? selectedCustomerMovements.map((movement) => (
                  <div className="document-drawer__list-row" key={movement.id}>
                    <div>
                      <strong>{renderMovementTypeLabel(movement.movementType, t)}</strong>
                      <span>{movement.sku} | {movement.locationName} / {movement.storageSection || "A"}</span>
                    </div>
                    <div>
                      <strong>{formatSignedQuantity(movement.quantityChange)}</strong>
                      <span>{formatDateValue(movement.createdAt, dateFormatter)}</span>
                    </div>
                  </div>
                )) : <div className="sheet-note">{t("noCustomerActivity")}</div>}
              </div>
            </div>
          </div>
        ) : null}
      </Drawer>

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

function getDocumentTimestamp(value: string | null | undefined) {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getMovementTimestamp(movement: Movement) {
  return getDocumentTimestamp(movement.outDate || movement.deliveryDate || movement.createdAt);
}

function isOpenStatus(status: string) {
  const normalized = status.trim().toUpperCase();
  return normalized === "DRAFT" || normalized === "CONFIRMED";
}

function renderDocumentStatusChip(status: string, t: (key: string) => string) {
  const normalized = status.trim().toUpperCase();
  if (normalized === "CANCELLED") {
    return <Chip label={t("cancelled")} color="error" size="small" />;
  }
  if (normalized === "CONFIRMED") {
    return <Chip label={t("confirmed")} color="success" size="small" />;
  }
  if (normalized === "DRAFT") {
    return <Chip label={t("draft")} color="default" size="small" />;
  }
  return <Chip label={t("confirmed")} color="success" size="small" />;
}

function renderMovementTypeLabel(movementType: Movement["movementType"], t: (key: string) => string) {
  switch (movementType) {
    case "IN":
      return t("inbound");
    case "OUT":
      return t("outbound");
    case "ADJUST":
      return t("adjustments");
    case "REVERSAL":
      return t("reversal");
    case "TRANSFER_IN":
    case "TRANSFER_OUT":
      return t("transfers");
    case "COUNT":
      return t("cycleCounts");
    default:
      return movementType;
  }
}

function formatSignedQuantity(quantity: number) {
  return quantity > 0 ? `+${quantity}` : String(quantity);
}
