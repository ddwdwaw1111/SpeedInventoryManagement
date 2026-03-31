import CloseIcon from "@mui/icons-material/Close";
import CompareArrowsOutlinedIcon from "@mui/icons-material/CompareArrowsOutlined";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";
import { type FormEvent, useDeferredValue, useEffect, useMemo, useState } from "react";
import { Box, Button, Chip, Dialog, DialogContent, DialogTitle, Drawer, IconButton } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";

import { api } from "../lib/api";
import { setPendingAllActivityContext } from "../lib/allActivityContext";
import { downloadExcelWorkbook, type ExcelExportColumn } from "../lib/excelExport";
import { setPendingInventoryActionContext } from "../lib/inventoryActionContext";
import { buildInventoryActionSourceKey } from "../lib/inventoryActionSources";
import { consumePendingInventoryByLocationContext } from "../lib/inventoryByLocationContext";
import { RowActionsMenu } from "./RowActionsMenu";
import { formatDateValue } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import type { PageKey } from "../lib/routes";
import { DEFAULT_STORAGE_SECTION, normalizeStorageSection, type Customer, type Item, type ItemPayload, type Location, type UserRole } from "../lib/types";
import { InlineAlert, useConfirmDialog, useFeedbackToast } from "./Feedback";
import { ExportExcelDialog } from "./ExportExcelDialog";
import { buildWorkspaceGridSlots, WorkspacePanelHeader } from "./WorkspacePanelChrome";
import { useSharedColumnOrder } from "./useSharedColumnOrder";

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
  itemNumber: string;
  sku: string;
  description: string;
  customerId: string;
  locationId: string;
  storageSection: string;
  quantity: number;
  allocatedQty: number;
  damagedQty: number;
  holdQty: number;
  reorderLevel: number;
  deliveryDate: string;
  containerNo: string;
  expectedQty: number;
  receivedQty: number;
  heightIn: number;
  outDate: string;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
const INVENTORY_BY_LOCATION_COLUMN_ORDER_PREFERENCE_KEY = "inventory-by-location.column-order";
const INVENTORY_DETAIL_EXPORT_TITLE = "Inventory Detail";
const INVENTORY_DETAIL_EXPORT_COLUMNS = [
  { key: "itemNumber", label: "Item #" },
  { key: "sku", label: "SKU" },
  { key: "description", label: "Description" },
  { key: "customerName", label: "Customer" },
  { key: "locationName", label: "Warehouse" },
  { key: "storageSection", label: "Pick Location" },
  { key: "quantity", label: "On Hand" },
  { key: "availableQty", label: "Available Qty" },
  { key: "damagedQty", label: "Damaged Qty" },
  { key: "reorderLevel", label: "Reorder Level" },
  { key: "deliveryDate", label: "Receipt Date" },
  { key: "containerNo", label: "Container No." },
  { key: "expectedQty", label: "Expected Qty" },
  { key: "receivedQty", label: "Received Qty" },
  { key: "heightIn", label: "Height (in)" },
  { key: "outDate", label: "Out Date" }
] as const;

function createEmptyItemForm(defaultCustomerId = "", defaultLocationId = ""): ItemFormState {
  return {
    itemNumber: "",
    sku: "",
    description: "",
    customerId: defaultCustomerId,
    locationId: defaultLocationId,
    storageSection: DEFAULT_STORAGE_SECTION,
    quantity: 0,
    allocatedQty: 0,
    damagedQty: 0,
    holdQty: 0,
    reorderLevel: 0,
    deliveryDate: "",
    containerNo: "",
    expectedQty: 0,
    receivedQty: 0,
    heightIn: 87,
    outDate: ""
  };
}

export function MasterInventoryPage({ items, locations, customers, currentUserRole, isLoading, onRefresh, onNavigate }: MasterInventoryPageProps) {
  const { t } = useI18n();
  const { confirm, confirmationDialog } = useConfirmDialog();
  const { showSuccess, showError, feedbackToast } = useFeedbackToast();
  const canManage = currentUserRole === "admin" || currentUserRole === "operator";
  const canDelete = currentUserRole === "admin";
  const canConfigureColumns = currentUserRole === "admin";
  const pageDescription = t("stockByLocationDesc");
  const permissionNote = currentUserRole === "viewer"
    ? t("readOnlyModeNotice")
    : currentUserRole === "operator"
      ? t("operatorCanEditStockNotice")
      : "";
  const [searchTerm, setSearchTerm] = useState("");
  const [focusedSku, setFocusedSku] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState("all");
  const [selectedCustomerId, setSelectedCustomerId] = useState("all");
  const [healthFilter, setHealthFilter] = useState<InventoryHealthFilter>("ALL");
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [form, setForm] = useState<ItemFormState>(() => createEmptyItemForm("", ""));
  const deferredSearchTerm = useDeferredValue(searchTerm);
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

  useEffect(() => {
    const context = consumePendingInventoryByLocationContext();
    if (!context) {
      return;
    }

    const nextSku = context.sku?.trim() ?? "";
    const nextContainerNo = context.containerNo?.trim() ?? "";
    const nextSearchTerm = nextSku || nextContainerNo;
    setFocusedSku(nextSku || null);
    setSearchTerm(nextSearchTerm);
    setSelectedCustomerId(context.customerId ? String(context.customerId) : "all");
    setSelectedLocationId(context.locationId ? String(context.locationId) : "all");
    setSelectedItemId(null);
  }, []);

  const normalizedSearch = deferredSearchTerm.trim().toLowerCase();
  const filteredItems = items.filter((item) => {
    const matchesFocusedSku = !focusedSku || item.sku.toLowerCase() === focusedSku.toLowerCase();
    const matchesSearch = normalizedSearch.length === 0
      || item.sku.toLowerCase().includes(normalizedSearch)
      || item.itemNumber.toLowerCase().includes(normalizedSearch)
      || item.customerName.toLowerCase().includes(normalizedSearch)
      || displayDescription(item).toLowerCase().includes(normalizedSearch)
      || item.containerNo.toLowerCase().includes(normalizedSearch);
    const matchesLocation = selectedLocationId === "all" || item.locationId === Number(selectedLocationId);
    const matchesCustomer = selectedCustomerId === "all" || item.customerId === Number(selectedCustomerId);
    const matchesHealth = healthFilter === "ALL"
      || (healthFilter === "IN_STOCK" && item.availableQty > item.reorderLevel)
      || (healthFilter === "LOW_STOCK" && item.availableQty <= item.reorderLevel)
      || (healthFilter === "MISMATCH" && hasQtyMismatch(item.expectedQty, item.receivedQty));
    return matchesFocusedSku && matchesSearch && matchesLocation && matchesCustomer && matchesHealth;
  });
  const selectedItem = useMemo(
    () => filteredItems.find((item) => item.id === selectedItemId) ?? null,
    [filteredItems, selectedItemId]
  );
  const hasActiveFilters = normalizedSearch.length > 0 || selectedLocationId !== "all" || selectedCustomerId !== "all" || healthFilter !== "ALL" || focusedSku !== null;
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

  const baseColumns = useMemo<GridColDef<Item>[]>(() => [
    { field: "itemNumber", headerName: t("itemNumber"), minWidth: 130, flex: 0.8, renderCell: (params) => <span className="cell--mono">{params.value || "-"}</span> },
    { field: "sku", headerName: t("sku"), minWidth: 120, flex: 0.8, renderCell: (params) => <span className="cell--mono">{params.value}</span> },
    { field: "description", headerName: t("description"), minWidth: 240, flex: 1.5, valueGetter: (_, row) => displayDescription(row) },
    { field: "customerName", headerName: t("customer"), minWidth: 180, flex: 1 },
    { field: "locationName", headerName: t("currentStorage"), minWidth: 170, flex: 1 },
    { field: "storageSection", headerName: t("storageSection"), minWidth: 110, renderCell: (params) => normalizeStorageSection(params.row.storageSection) },
    { field: "quantity", headerName: t("onHand"), minWidth: 110, type: "number" },
    { field: "availableQty", headerName: t("availableQty"), minWidth: 120, type: "number" },
    { field: "damagedQty", headerName: t("damagedQty"), minWidth: 110, type: "number" },
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
          {params.row.availableQty <= params.row.reorderLevel ? <Chip label={t("lowStock")} color="warning" size="small" /> : <Chip label={t("healthy")} color="success" size="small" />}
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
  const {
    columns,
    columnOrderAction,
    columnOrderDialog
  } = useSharedColumnOrder({
    preferenceKey: INVENTORY_BY_LOCATION_COLUMN_ORDER_PREFERENCE_KEY,
    baseColumns,
    canManage: canConfigureColumns,
    onError: setErrorMessage
  });

  function openEditModal(item: Item) {
    if (!canManage) return;
    setSelectedItemId(item.id);
    setEditingItemId(item.id);
    setForm({
      itemNumber: item.itemNumber || "",
      sku: item.sku,
      description: displayDescription(item),
      customerId: String(item.customerId),
      locationId: String(item.locationId),
      storageSection: normalizeStorageSection(item.storageSection),
      quantity: item.quantity,
      allocatedQty: item.allocatedQty,
      damagedQty: item.damagedQty,
      holdQty: item.holdQty,
      reorderLevel: item.reorderLevel,
      deliveryDate: toDateInputValue(item.deliveryDate),
      containerNo: item.containerNo,
      expectedQty: item.expectedQty,
      receivedQty: item.receivedQty,
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
      itemNumber: form.itemNumber,
      sku: form.sku,
      name: form.description,
      category: "General",
      description: form.description,
      unit: "pcs",
      quantity: form.quantity,
      allocatedQty: form.allocatedQty,
      damagedQty: form.damagedQty,
      holdQty: form.holdQty,
      reorderLevel: form.reorderLevel,
      customerId,
      locationId,
      storageSection: normalizeStorageSection(form.storageSection),
      deliveryDate: form.deliveryDate || undefined,
      containerNo: form.containerNo || undefined,
      expectedQty: form.expectedQty,
      receivedQty: form.receivedQty,
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
      showSuccess(t("stockRowSavedSuccess"));
    } catch (error) {
      showActionError(error, t("couldNotSaveStockRow"));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteItem(item: Item) {
    if (!canDelete) return;
    if (!(await confirm({
      title: t("delete"),
      message: t("deleteStockRowConfirm", { sku: item.sku, storage: item.locationName, section: normalizeStorageSection(item.storageSection) }),
      confirmLabel: t("delete"),
      cancelLabel: t("cancel"),
      confirmColor: "error",
      severity: "warning"
    }))) {
      return;
    }

    setErrorMessage("");
    try {
      await api.deleteItem(item.id);
      await onRefresh();
      showSuccess(t("stockRowDeletedSuccess"));
    } catch (error) {
      showActionError(error, t("couldNotDeleteStockRow"));
    }
  }

  function openWorkspace(page: PageKey) {
    if (!selectedItem) return;
    if (page === "adjustments" || page === "transfers") {
      setPendingInventoryActionContext(page, {
        sourceKey: buildInventoryActionSourceKey(selectedItem.customerId, selectedItem.sku),
        sku: selectedItem.sku,
        customerId: selectedItem.customerId
      });
    }
    if (page === "all-activity") {
      setPendingAllActivityContext({
        searchTerm: selectedItem.sku,
        customerId: selectedItem.customerId,
        locationId: selectedItem.locationId
      });
    }
    onNavigate(page);
  }

  function handleExport({ title, columns }: { title: string; columns: ExcelExportColumn[] }) {
    downloadExcelWorkbook({
      title,
      sheetName: INVENTORY_DETAIL_EXPORT_TITLE,
      fileName: title,
      columns,
      rows: filteredItems.map((item) => ({
        itemNumber: item.itemNumber || "-",
        sku: item.sku,
        description: displayDescription(item),
        customerName: item.customerName,
        locationName: item.locationName,
        storageSection: normalizeStorageSection(item.storageSection),
        quantity: item.quantity,
        availableQty: item.availableQty,
        damagedQty: item.damagedQty,
        reorderLevel: item.reorderLevel,
        deliveryDate: formatDate(item.deliveryDate),
        containerNo: item.containerNo || "-",
        expectedQty: item.expectedQty || 0,
        receivedQty: item.receivedQty || 0,
        heightIn: item.heightIn || "-",
        outDate: formatDate(item.outDate)
      }))
    });
    setIsExportDialogOpen(false);
  }

  return (
    <main className="workspace-main">
      <section className="workbook-panel workbook-panel--full">
        <div className="tab-strip">
          <WorkspacePanelHeader
            title={t("stockByLocation")}
            actions={(
              <div className="sheet-actions">
                <Button
                  variant="outlined"
                  startIcon={<FileDownloadOutlinedIcon fontSize="small" />}
                  onClick={() => setIsExportDialogOpen(true)}
                  disabled={filteredItems.length === 0}
                >
                  {t("exportExcel")}
                </Button>
                {columnOrderAction}
              </div>
            )}
            notices={[permissionNote]}
            errorMessage={errorMessage && !isModalOpen ? errorMessage : ""}
          />
          <div className="filter-bar">
            <label>{t("search")}<input value={searchTerm} onChange={(event) => {
              const nextValue = event.target.value;
              setSearchTerm(nextValue);
              if (focusedSku && nextValue.trim().toLowerCase() !== focusedSku.toLowerCase()) {
                setFocusedSku(null);
              }
            }} placeholder={t("stockByLocationSearchPlaceholder")} /></label>
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
      {columnOrderDialog}
      <ExportExcelDialog
        open={isExportDialogOpen}
        defaultTitle={INVENTORY_DETAIL_EXPORT_TITLE}
        defaultColumns={[...INVENTORY_DETAIL_EXPORT_COLUMNS]}
        onClose={() => setIsExportDialogOpen(false)}
        onExport={handleExport}
      />
      {feedbackToast}

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
                <p>
                  {displayDescription(selectedItem)} | {selectedItem.customerName} | {selectedItem.locationName} / {normalizeStorageSection(selectedItem.storageSection)}
                  {" "} | {t("containerNo")}: {selectedItem.containerNo || "-"}
                </p>
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
                  {selectedItem.availableQty <= selectedItem.reorderLevel ? <Chip label={t("lowStock")} color="warning" size="small" /> : <Chip label={t("healthy")} color="success" size="small" />}
                  {hasQtyMismatch(selectedItem.expectedQty, selectedItem.receivedQty) ? <Chip label={t("qtyMismatch")} color="error" size="small" /> : null}
                </div>
              </div>
              <div className="document-drawer__status-stat">
                <strong>{selectedItem.quantity}</strong>
                <span>{t("onHand")}</span>
              </div>
              <div className="document-drawer__status-stat">
                <strong>{selectedItem.availableQty}</strong>
                <span>{t("availableQty")}</span>
              </div>
              <div className="document-drawer__status-stat">
                <strong>{selectedItem.damagedQty}</strong>
                <span>{t("damagedQty")}</span>
              </div>
            </div>

            <div className="document-drawer__meta">
              <div className="sheet-note">
                <strong>{t("customer")}</strong><br />
                {selectedItem.customerName}
              </div>
              <div className="sheet-note">
                <strong>{t("currentStorage")}</strong><br />
                {selectedItem.locationName} / {normalizeStorageSection(selectedItem.storageSection)}
              </div>
              <div className="sheet-note">
                <strong>{t("itemNumber")}</strong><br />
                <span className="cell--mono">{selectedItem.itemNumber || "-"}</span>
              </div>
              <div className="sheet-note">
                <strong>{t("receiptSource")}</strong><br />
                <span className="cell--mono">{selectedItem.containerNo || "-"}</span><br />
                <span>{t("deliveryDate")}: {formatDate(selectedItem.deliveryDate)}</span>
              </div>
              <div className="sheet-note">
                <strong>{t("receiptSummary")}</strong><br />
                {t("expectedQty")}: {selectedItem.expectedQty || "-"}<br />
                {t("received")}: {selectedItem.receivedQty || "-"}
              </div>
              <div className="sheet-note">
                <strong>{t("reorderLevel")}</strong><br />
                {selectedItem.reorderLevel}
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
          {errorMessage ? <InlineAlert>{errorMessage}</InlineAlert> : null}
          <form className="sheet-form" onSubmit={handleSubmit}>
            <label>{t("itemNumber")}<input value={form.itemNumber} onChange={(event) => setForm((current) => ({ ...current, itemNumber: event.target.value }))} placeholder="VB22GC" /></label>
            <label>{t("sku")}<input value={form.sku} onChange={(event) => setForm((current) => ({ ...current, sku: event.target.value }))} placeholder="023042" required /></label>
            <label className="sheet-form__wide">{t("description")}<input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder={t("descriptionPlaceholder")} required /></label>
            <label>{t("customer")}<select value={form.customerId} onChange={(event) => setForm((current) => ({ ...current, customerId: event.target.value }))} required>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
            <label>{t("currentStorage")}<select value={form.locationId} onChange={(event) => setForm((current) => ({ ...current, locationId: event.target.value }))} required>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
            <div className="sheet-note sheet-form__wide"><strong>{t("storageSection")}</strong> {normalizeStorageSection(form.storageSection)}</div>
            <label>{t("onHand")}<input type="number" min="0" value={numberInputValue(form.quantity)} onChange={(event) => setForm((current) => ({ ...current, quantity: Math.max(0, Number(event.target.value || 0)) }))} /></label>
            <label>{t("damagedQty")}<input type="number" min="0" value={numberInputValue(form.damagedQty)} onChange={(event) => setForm((current) => ({ ...current, damagedQty: Math.max(0, Number(event.target.value || 0)) }))} /></label>
            <label>{t("deliveryDate")}<input type="date" value={form.deliveryDate} onChange={(event) => setForm((current) => ({ ...current, deliveryDate: event.target.value }))} /></label>
            <label>{t("containerNo")}<input value={form.containerNo} onChange={(event) => setForm((current) => ({ ...current, containerNo: event.target.value }))} placeholder="KKFU7963968" /></label>
            <label>{t("expectedQty")}<input type="number" min="0" value={numberInputValue(form.expectedQty)} onChange={(event) => setForm((current) => ({ ...current, expectedQty: Math.max(0, Number(event.target.value || 0)) }))} /></label>
            <label>{t("received")}<input type="number" min="0" value={numberInputValue(form.receivedQty)} onChange={(event) => setForm((current) => ({ ...current, receivedQty: Math.max(0, Number(event.target.value || 0)) }))} /></label>
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
      {confirmationDialog}
    </main>
  );
}

function displayDescription(item: Pick<Item, "description" | "name">) { return item.description || item.name; }
function formatDate(value: string | null) { return formatDateValue(value, dateFormatter); }
function hasQtyMismatch(expectedQty: number, receivedQty: number) { return expectedQty > 0 && receivedQty > 0 && expectedQty !== receivedQty; }
function toDateInputValue(value: string | null) { return value ? value.slice(0, 10) : ""; }
function numberInputValue(value: number) { return value === 0 ? "" : String(value); }
