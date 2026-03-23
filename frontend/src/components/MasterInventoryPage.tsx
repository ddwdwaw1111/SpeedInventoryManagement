import CloseIcon from "@mui/icons-material/Close";
import CompareArrowsOutlinedIcon from "@mui/icons-material/CompareArrowsOutlined";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";
import { type FormEvent, useDeferredValue, useEffect, useMemo, useState } from "react";
import { Box, Button, Chip, Dialog, DialogContent, DialogTitle, Drawer, IconButton } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";

import { api } from "../lib/api";
import { setPendingAllActivityContext } from "../lib/allActivityContext";
import { RowActionsMenu } from "./RowActionsMenu";
import { formatDateValue } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import type { PageKey } from "../lib/routes";
import type { Customer, Item, ItemPayload, Location, UserRole } from "../lib/types";
import { buildWorkspaceGridSlots, WorkspacePanelHeader } from "./WorkspacePanelChrome";

type MasterInventoryPageProps = {
  items: Item[];
  locations: Location[];
  customers: Customer[];
  currentUserRole: UserRole;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
  onNavigate: (page: PageKey) => void;
};

type InventoryHealthFilter = "ALL" | "IN_STOCK" | "LOW_STOCK" | "MISMATCH";

type ItemFormState = {
  sku: string;
  description: string;
  customerId: string;
  locationId: string;
  storageSection: string;
  quantity: number;
  reorderLevel: number;
  deliveryDate: string;
  containerNo: string;
  expectedQty: number;
  receivedQty: number;
  pallets: number;
  palletsDetailCtns: string;
  heightIn: number;
  outDate: string;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

function createEmptyItemForm(defaultCustomerId = "", defaultLocationId = ""): ItemFormState {
  return {
    sku: "",
    description: "",
    customerId: defaultCustomerId,
    locationId: defaultLocationId,
    storageSection: "A",
    quantity: 0,
    reorderLevel: 0,
    deliveryDate: "",
    containerNo: "",
    expectedQty: 0,
    receivedQty: 0,
    pallets: 0,
    palletsDetailCtns: "",
    heightIn: 87,
    outDate: ""
  };
}

function getSuggestedPalletsDetail(totalQty: number, pallets: number) {
  if (totalQty <= 0 || pallets <= 0) return "";
  if (pallets === 1) return String(totalQty);

  const cartonsPerFullPallet = Math.ceil(totalQty / pallets);
  const remainingCartons = totalQty - (pallets - 1) * cartonsPerFullPallet;
  if (remainingCartons <= 0) return `${pallets}*${Math.floor(totalQty / pallets)}`;

  return `${pallets - 1}*${cartonsPerFullPallet}+${remainingCartons}`;
}

export function MasterInventoryPage({ items, locations, customers, currentUserRole, isLoading, onRefresh, onNavigate }: MasterInventoryPageProps) {
  const { t } = useI18n();
  const canManage = currentUserRole === "admin" || currentUserRole === "operator";
  const canDelete = currentUserRole === "admin";
  const pageDescription = t("stockByLocationDesc");
  const permissionNote = currentUserRole === "viewer"
    ? t("readOnlyModeNotice")
    : currentUserRole === "operator"
      ? t("operatorCanEditStockNotice")
      : "";
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedLocationId, setSelectedLocationId] = useState("all");
  const [selectedCustomerId, setSelectedCustomerId] = useState("all");
  const [healthFilter, setHealthFilter] = useState<InventoryHealthFilter>("ALL");
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [form, setForm] = useState<ItemFormState>(() => createEmptyItemForm("", ""));
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const suggestedPalletsDetail = getSuggestedPalletsDetail(form.receivedQty || form.expectedQty || form.quantity, form.pallets);

  useEffect(() => {
    if (!form.locationId && locations[0]) {
      setForm((current) => ({ ...current, locationId: String(locations[0].id) }));
    }
  }, [form.locationId, locations]);

  useEffect(() => {
    if (!form.customerId && customers[0]) {
      setForm((current) => ({ ...current, customerId: String(customers[0].id) }));
    }
  }, [customers, form.customerId]);

  const normalizedSearch = deferredSearchTerm.trim().toLowerCase();
  const filteredItems = items.filter((item) => {
    const matchesSearch = normalizedSearch.length === 0
      || item.sku.toLowerCase().includes(normalizedSearch)
      || item.customerName.toLowerCase().includes(normalizedSearch)
      || displayDescription(item).toLowerCase().includes(normalizedSearch)
      || item.containerNo.toLowerCase().includes(normalizedSearch);
    const matchesLocation = selectedLocationId === "all" || item.locationId === Number(selectedLocationId);
    const matchesCustomer = selectedCustomerId === "all" || item.customerId === Number(selectedCustomerId);
    const matchesHealth = healthFilter === "ALL"
      || (healthFilter === "IN_STOCK" && item.quantity > item.reorderLevel)
      || (healthFilter === "LOW_STOCK" && item.quantity <= item.reorderLevel)
      || (healthFilter === "MISMATCH" && hasQtyMismatch(item.expectedQty, item.receivedQty));
    return matchesSearch && matchesLocation && matchesCustomer && matchesHealth;
  });
  const selectedItem = useMemo(
    () => filteredItems.find((item) => item.id === selectedItemId) ?? null,
    [filteredItems, selectedItemId]
  );
  const hasActiveFilters = normalizedSearch.length > 0 || selectedLocationId !== "all" || selectedCustomerId !== "all" || healthFilter !== "ALL";
  const mainGridSlots = buildWorkspaceGridSlots({
    emptyTitle: t("noResults"),
    emptyDescription: hasActiveFilters ? t("filteredStateHint") : t("emptyStateHint"),
    loadingTitle: t("loadingRecords"),
    loadingDescription: pageDescription
  });

  useEffect(() => {
    if (selectedItemId !== null && !selectedItem) {
      setSelectedItemId(null);
    }
  }, [selectedItem, selectedItemId]);

  const columns = useMemo<GridColDef<Item>[]>(() => [
    { field: "sku", headerName: t("sku"), minWidth: 120, flex: 0.8, renderCell: (params) => <span className="cell--mono">{params.value}</span> },
    { field: "description", headerName: t("description"), minWidth: 240, flex: 1.5, valueGetter: (_, row) => displayDescription(row) },
    { field: "customerName", headerName: t("customer"), minWidth: 180, flex: 1 },
    { field: "locationName", headerName: t("currentStorage"), minWidth: 170, flex: 1 },
    { field: "storageSection", headerName: t("storageSection"), minWidth: 110, renderCell: (params) => params.row.storageSection || "A" },
    { field: "quantity", headerName: t("onHand"), minWidth: 110, type: "number" },
    { field: "reorderLevel", headerName: t("reorderLevel"), minWidth: 130, type: "number" },
    { field: "deliveryDate", headerName: t("deliveryDate"), minWidth: 140, valueFormatter: (_, row) => formatDate(row.deliveryDate) },
    { field: "containerNo", headerName: t("containerNo"), minWidth: 170, flex: 1, renderCell: (params) => <span className="cell--mono">{params.value || "-"}</span> },
    { field: "expectedQty", headerName: t("expectedQty"), minWidth: 130, type: "number", valueFormatter: (value) => value || "-" },
    {
      field: "receivedQty",
      headerName: t("received"),
      minWidth: 110,
      type: "number",
      renderCell: (params) => <span className={hasQtyMismatch(params.row.expectedQty, params.row.receivedQty) ? "cell--mismatch" : ""}>{params.row.receivedQty || "-"}</span>
    },
    { field: "pallets", headerName: t("pallets"), minWidth: 100, type: "number", valueFormatter: (value) => value || "-" },
    { field: "palletsDetailCtns", headerName: t("palletsDetail"), minWidth: 180, flex: 1, renderCell: (params) => <span className="cell--mono">{params.value || "-"}</span> },
    { field: "heightIn", headerName: t("heightIn"), minWidth: 110, type: "number", valueFormatter: (value) => value || "-" },
    { field: "outDate", headerName: t("outDate"), minWidth: 140, valueFormatter: (_, row) => formatDate(row.outDate) },
    {
      field: "status",
      headerName: t("status"),
      minWidth: 170,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <div className="status-stack">
          {params.row.quantity <= params.row.reorderLevel ? <Chip label={t("lowStock")} color="warning" size="small" /> : <Chip label={t("healthy")} color="success" size="small" />}
          {hasQtyMismatch(params.row.expectedQty, params.row.receivedQty) ? <Chip label={t("qtyMismatch")} color="error" size="small" /> : null}
        </div>
      )
    },
    {
      field: "actions",
      headerName: t("actions"),
      minWidth: 90,
      sortable: false,
      filterable: false,
      renderCell: (params) => {
        const actions = [];
        if (canManage) {
          actions.push({ key: "edit", label: t("edit"), icon: <EditOutlinedIcon fontSize="small" />, onClick: () => openEditModal(params.row) });
        }
        if (canDelete) {
          actions.push({ key: "delete", label: t("delete"), icon: <DeleteOutlineOutlinedIcon fontSize="small" />, danger: true, onClick: () => handleDeleteItem(params.row) });
        }
        return <RowActionsMenu ariaLabel={t("actions")} actions={actions} />;
      }
    }
  ], [canDelete, canManage, t]);

  function openEditModal(item: Item) {
    if (!canManage) return;
    setSelectedItemId(item.id);
    setEditingItemId(item.id);
    setForm({
      sku: item.sku,
      description: displayDescription(item),
      customerId: String(item.customerId),
      locationId: String(item.locationId),
      storageSection: item.storageSection || "A",
      quantity: item.quantity,
      reorderLevel: item.reorderLevel,
      deliveryDate: toDateInputValue(item.deliveryDate),
      containerNo: item.containerNo,
      expectedQty: item.expectedQty,
      receivedQty: item.receivedQty,
      pallets: item.pallets,
      palletsDetailCtns: item.palletsDetailCtns,
      heightIn: item.heightIn || 87,
      outDate: toDateInputValue(item.outDate)
    });
    setErrorMessage("");
    setIsModalOpen(true);
  }

  function closeModal() {
    setEditingItemId(null);
    setIsModalOpen(false);
    setErrorMessage("");
    setForm((current) => createEmptyItemForm(current.customerId || (customers[0] ? String(customers[0].id) : ""), current.locationId || (locations[0] ? String(locations[0].id) : "")));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage) return;
    setIsSubmitting(true);
    setErrorMessage("");

    const locationId = Number(form.locationId);
    const customerId = Number(form.customerId);
    if (!customerId) {
      setErrorMessage(t("chooseCustomerBeforeSave"));
      setIsSubmitting(false);
      return;
    }

    if (!locationId) {
      setErrorMessage(t("chooseStorageBeforeSave"));
      setIsSubmitting(false);
      return;
    }

    const payload: ItemPayload = {
      sku: form.sku,
      name: form.description,
      category: "General",
      description: form.description,
      unit: "pcs",
      quantity: form.quantity,
      reorderLevel: form.reorderLevel,
      customerId,
      locationId,
      storageSection: form.storageSection || "A",
      deliveryDate: form.deliveryDate || undefined,
      containerNo: form.containerNo || undefined,
      expectedQty: form.expectedQty,
      receivedQty: form.receivedQty,
      pallets: form.pallets,
      palletsDetailCtns: form.palletsDetailCtns || undefined,
      heightIn: form.heightIn,
      outDate: form.outDate || undefined
    };

    try {
      if (editingItemId) {
        await api.updateItem(editingItemId, payload);
      } else {
        await api.createItem(payload);
      }
      closeModal();
      await onRefresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("couldNotSaveStockRow"));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteItem(item: Item) {
    if (!canDelete) return;
    if (!window.confirm(t("deleteStockRowConfirm", { sku: item.sku, storage: item.locationName, section: item.storageSection || "A" }))) {
      return;
    }

    setErrorMessage("");
    try {
      await api.deleteItem(item.id);
      await onRefresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("couldNotDeleteStockRow"));
    }
  }

  function openWorkspace(page: PageKey) {
    if (!selectedItem) return;
    if (page === "all-activity") {
      setPendingAllActivityContext({
        searchTerm: selectedItem.sku,
        customerId: selectedItem.customerId,
        locationId: selectedItem.locationId
      });
    }
    onNavigate(page);
  }

  return (
    <main className="workspace-main">
      <section className="workbook-panel workbook-panel--full">
        <div className="tab-strip">
          <WorkspacePanelHeader
            title={t("stockByLocation")}
            notices={[permissionNote]}
            errorMessage={errorMessage && !isModalOpen ? errorMessage : ""}
          />
          <div className="filter-bar">
            <label>{t("search")}<input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder={t("stockByLocationSearchPlaceholder")} /></label>
            <label>{t("customer")}<select value={selectedCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)}><option value="all">{t("allCustomers")}</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
            <label>{t("currentStorage")}<select value={selectedLocationId} onChange={(event) => setSelectedLocationId(event.target.value)}><option value="all">{t("allStorage")}</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
            <label>{t("stockHealth")}<select value={healthFilter} onChange={(event) => setHealthFilter(event.target.value as InventoryHealthFilter)}><option value="ALL">{t("allRows")}</option><option value="IN_STOCK">{t("healthyStock")}</option><option value="LOW_STOCK">{t("lowStock")}</option><option value="MISMATCH">{t("mismatch")}</option></select></label>
          </div>
        </div>

        <div className="sheet-table-wrap">
          <Box sx={{ minWidth: 0 }}>
            <DataGrid
              rows={filteredItems}
              columns={columns}
              loading={isLoading}
              pagination
              pageSizeOptions={[10, 20, 50]}
              disableRowSelectionOnClick
              initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
              getRowHeight={() => 72}
              onRowClick={(params) => setSelectedItemId(params.row.id)}
              getRowClassName={(params) => (params.row.id === selectedItemId ? "document-row--selected" : "")}
              slots={mainGridSlots}
              sx={{ border: 0 }}
            />
          </Box>
        </div>
      </section>

      <Drawer
        anchor="right"
        open={Boolean(selectedItem)}
        onClose={() => setSelectedItemId(null)}
        PaperProps={{ className: "document-drawer" }}
      >
        {selectedItem ? (
          <div className="document-drawer__content">
            <div className="document-drawer__header">
              <div>
                <div className="document-drawer__eyebrow">{t("stockByLocation")}</div>
                <h3>{selectedItem.sku}</h3>
                <p>{displayDescription(selectedItem)} | {selectedItem.customerName} | {selectedItem.locationName} / {selectedItem.storageSection || "A"}</p>
              </div>
              <IconButton aria-label={t("close")} onClick={() => setSelectedItemId(null)}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </div>

            <div className="document-drawer__actions">
              {canManage ? (
                <Button variant="contained" startIcon={<EditOutlinedIcon fontSize="small" />} onClick={() => openEditModal(selectedItem)}>
                  {t("editStockRow")}
                </Button>
              ) : null}
              {canManage ? (
                <Button variant="outlined" startIcon={<TuneOutlinedIcon fontSize="small" />} onClick={() => openWorkspace("adjustments")}>
                  {t("adjustments")}
                </Button>
              ) : null}
              {canManage ? (
                <Button variant="outlined" startIcon={<CompareArrowsOutlinedIcon fontSize="small" />} onClick={() => openWorkspace("transfers")}>
                  {t("transfers")}
                </Button>
              ) : null}
              {canManage ? (
                <Button variant="outlined" startIcon={<FactCheckOutlinedIcon fontSize="small" />} onClick={() => openWorkspace("cycle-counts")}>
                  {t("cycleCounts")}
                </Button>
              ) : null}
              <Button variant="outlined" startIcon={<HistoryOutlinedIcon fontSize="small" />} onClick={() => openWorkspace("all-activity")}>
                {t("allActivity")}
              </Button>
            </div>

            <div className="document-drawer__status-bar">
              <div className="document-drawer__status-main">
                <div className="status-stack">
                  {selectedItem.quantity <= selectedItem.reorderLevel ? <Chip label={t("lowStock")} color="warning" size="small" /> : <Chip label={t("healthy")} color="success" size="small" />}
                  {hasQtyMismatch(selectedItem.expectedQty, selectedItem.receivedQty) ? <Chip label={t("qtyMismatch")} color="error" size="small" /> : null}
                </div>
              </div>
              <div className="document-drawer__status-stat">
                <strong>{selectedItem.quantity}</strong>
                <span>{t("onHand")}</span>
              </div>
              <div className="document-drawer__status-stat">
                <strong>{selectedItem.reorderLevel}</strong>
                <span>{t("reorderLevel")}</span>
              </div>
              <div className="document-drawer__status-stat">
                <strong>{selectedItem.expectedQty || 0} / {selectedItem.receivedQty || 0}</strong>
                <span>{t("expectedQty")} / {t("received")}</span>
              </div>
            </div>

            <div className="document-drawer__meta">
              <div className="sheet-note">
                <strong>{t("customer")}</strong><br />
                {selectedItem.customerName}
              </div>
              <div className="sheet-note">
                <strong>{t("currentStorage")}</strong><br />
                {selectedItem.locationName} / {selectedItem.storageSection || "A"}
              </div>
              <div className="sheet-note">
                <strong>{t("deliveryDate")}</strong><br />
                {formatDate(selectedItem.deliveryDate)}
              </div>
              <div className="sheet-note">
                <strong>{t("containerNo")}</strong><br />
                <span className="cell--mono">{selectedItem.containerNo || "-"}</span>
              </div>
              <div className="sheet-note">
                <strong>{t("pallets")}</strong><br />
                {selectedItem.pallets || "-"}
              </div>
              <div className="sheet-note">
                <strong>{t("palletsDetail")}</strong><br />
                <span className="cell--mono">{selectedItem.palletsDetailCtns || "-"}</span>
              </div>
              <div className="sheet-note">
                <strong>{t("heightIn")}</strong><br />
                {selectedItem.heightIn || "-"}
              </div>
              <div className="sheet-note">
                <strong>{t("outDate")}</strong><br />
                {formatDate(selectedItem.outDate)}
              </div>
              {permissionNote ? <div className="sheet-note document-drawer__meta-note">{permissionNote}</div> : null}
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
        maxWidth="md"
      >
        <DialogTitle sx={{ pb: 1 }}>
          {t("editStockRow")}
          <IconButton aria-label={t("close")} onClick={closeModal} sx={{ position: "absolute", right: 16, top: 16 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {errorMessage ? <div className="alert-banner">{errorMessage}</div> : null}
          <form className="sheet-form" onSubmit={handleSubmit}>
            <label>{t("sku")}<input value={form.sku} onChange={(event) => setForm((current) => ({ ...current, sku: event.target.value }))} placeholder="023042" required /></label>
            <label className="sheet-form__wide">{t("description")}<input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder={t("descriptionPlaceholder")} required /></label>
            <label>{t("customer")}<select value={form.customerId} onChange={(event) => setForm((current) => ({ ...current, customerId: event.target.value }))} required>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
            <label>{t("currentStorage")}<select value={form.locationId} onChange={(event) => setForm((current) => ({ ...current, locationId: event.target.value }))} required>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
            <div className="sheet-note sheet-form__wide"><strong>{t("storageSection")}</strong> {form.storageSection || "A"}</div>
            <label>{t("onHand")}<input type="number" min="0" value={numberInputValue(form.quantity)} onChange={(event) => setForm((current) => ({ ...current, quantity: Math.max(0, Number(event.target.value || 0)) }))} /></label>
            <label>{t("deliveryDate")}<input type="date" value={form.deliveryDate} onChange={(event) => setForm((current) => ({ ...current, deliveryDate: event.target.value }))} /></label>
            <label>{t("containerNo")}<input value={form.containerNo} onChange={(event) => setForm((current) => ({ ...current, containerNo: event.target.value }))} placeholder="KKFU7963968" /></label>
            <label>{t("expectedQty")}<input type="number" min="0" value={numberInputValue(form.expectedQty)} onChange={(event) => setForm((current) => ({ ...current, expectedQty: Math.max(0, Number(event.target.value || 0)) }))} /></label>
            <label>{t("received")}<input type="number" min="0" value={numberInputValue(form.receivedQty)} onChange={(event) => setForm((current) => ({ ...current, receivedQty: Math.max(0, Number(event.target.value || 0)) }))} /></label>
            <label>{t("pallets")}<input type="number" min="0" value={numberInputValue(form.pallets)} onChange={(event) => setForm((current) => ({ ...current, pallets: Math.max(0, Number(event.target.value || 0)) }))} /></label>
            <label className="sheet-form__wide">{t("palletsDetail")}<input value={form.palletsDetailCtns} onChange={(event) => setForm((current) => ({ ...current, palletsDetailCtns: event.target.value }))} placeholder={suggestedPalletsDetail || "29*66+44"} /></label>
            {suggestedPalletsDetail ? <div className="sheet-note sheet-form__wide"><strong>{t("suggested")}</strong> {suggestedPalletsDetail}<button className="button button--ghost button--small" type="button" onClick={() => setForm((current) => ({ ...current, palletsDetailCtns: suggestedPalletsDetail }))}>{t("useSuggestion")}</button></div> : null}
            <label>{t("heightIn")}<input type="number" min="0" value={form.heightIn} onChange={(event) => setForm((current) => ({ ...current, heightIn: Math.max(0, Number(event.target.value || 0)) }))} /></label>
            <label>{t("outDate")}<input type="date" value={form.outDate} onChange={(event) => setForm((current) => ({ ...current, outDate: event.target.value }))} /></label>
            <label>{t("reorderLevel")}<input type="number" min="0" value={numberInputValue(form.reorderLevel)} onChange={(event) => setForm((current) => ({ ...current, reorderLevel: Math.max(0, Number(event.target.value || 0)) }))} /></label>
            <div className="sheet-form__actions sheet-form__wide">
              <button className="button button--primary" type="submit" disabled={isSubmitting}>{isSubmitting ? t("saving") : t("updateRow")}</button>
              <button className="button button--ghost" type="button" onClick={closeModal}>{t("cancel")}</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function displayDescription(item: Pick<Item, "description" | "name">) { return item.description || item.name; }
function formatDate(value: string | null) { return formatDateValue(value, dateFormatter); }
function hasQtyMismatch(expectedQty: number, receivedQty: number) { return expectedQty > 0 && receivedQty > 0 && expectedQty !== receivedQty; }
function toDateInputValue(value: string | null) { return value ? value.slice(0, 10) : ""; }
function numberInputValue(value: number) { return value === 0 ? "" : String(value); }
