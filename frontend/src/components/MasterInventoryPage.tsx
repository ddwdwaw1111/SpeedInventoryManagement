import { type FormEvent, useDeferredValue, useEffect, useMemo, useState } from "react";
import { Box, Button, Chip, Dialog, DialogContent, DialogTitle, IconButton } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";

import { api } from "../lib/api";
import { formatDateValue } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import type { Item, ItemPayload, Location } from "../lib/types";

type MasterInventoryPageProps = {
  items: Item[];
  locations: Location[];
  isLoading: boolean;
  onRefresh: () => Promise<void>;
};

type InventoryHealthFilter = "ALL" | "IN_STOCK" | "LOW_STOCK" | "MISMATCH";

type ItemFormState = {
  sku: string;
  description: string;
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

function createEmptyItemForm(defaultLocationId = ""): ItemFormState {
  return {
    sku: "",
    description: "",
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

export function MasterInventoryPage({ items, locations, isLoading, onRefresh }: MasterInventoryPageProps) {
  const { t } = useI18n();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedLocationId, setSelectedLocationId] = useState("all");
  const [healthFilter, setHealthFilter] = useState<InventoryHealthFilter>("ALL");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [form, setForm] = useState<ItemFormState>(() => createEmptyItemForm(""));
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const suggestedPalletsDetail = getSuggestedPalletsDetail(form.receivedQty || form.expectedQty || form.quantity, form.pallets);

  useEffect(() => {
    if (!form.locationId && locations[0]) {
      setForm((current) => ({ ...current, locationId: String(locations[0].id) }));
    }
  }, [form.locationId, locations]);

  const normalizedSearch = deferredSearchTerm.trim().toLowerCase();
  const filteredItems = items.filter((item) => {
    const matchesSearch = normalizedSearch.length === 0
      || item.sku.toLowerCase().includes(normalizedSearch)
      || displayDescription(item).toLowerCase().includes(normalizedSearch)
      || item.containerNo.toLowerCase().includes(normalizedSearch);
    const matchesLocation = selectedLocationId === "all" || item.locationId === Number(selectedLocationId);
    const matchesHealth = healthFilter === "ALL"
      || (healthFilter === "IN_STOCK" && item.quantity > item.reorderLevel)
      || (healthFilter === "LOW_STOCK" && item.quantity <= item.reorderLevel)
      || (healthFilter === "MISMATCH" && hasQtyMismatch(item.expectedQty, item.receivedQty));
    return matchesSearch && matchesLocation && matchesHealth;
  });

  const columns = useMemo<GridColDef<Item>[]>(() => [
    { field: "sku", headerName: t("sku"), minWidth: 120, flex: 0.8, renderCell: (params) => <span className="cell--mono">{params.value}</span> },
    { field: "description", headerName: t("description"), minWidth: 240, flex: 1.5, valueGetter: (_, row) => displayDescription(row) },
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
      minWidth: 170,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <div className="table-actions">
          <Button size="small" variant="outlined" onClick={() => openEditModal(params.row)}>{t("edit")}</Button>
          <Button size="small" color="error" variant="outlined" onClick={() => void handleDeleteItem(params.row)}>{t("delete")}</Button>
        </div>
      )
    }
  ], [t]);

  function openCreateModal() {
    setEditingItemId(null);
    setForm(createEmptyItemForm(locations[0] ? String(locations[0].id) : ""));
    setErrorMessage("");
    setIsModalOpen(true);
  }

  function openEditModal(item: Item) {
    setEditingItemId(item.id);
    setForm({
      sku: item.sku,
      description: displayDescription(item),
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
    setForm((current) => createEmptyItemForm(current.locationId || (locations[0] ? String(locations[0].id) : "")));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage("");

    const locationId = Number(form.locationId);
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
      setErrorMessage(error instanceof Error ? error.message : t("couldNotSaveInventory"));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteItem(item: Item) {
    if (!window.confirm(t("deleteSkuConfirm", { sku: item.sku }))) {
      return;
    }

    setErrorMessage("");
    try {
      await api.deleteItem(item.id);
      await onRefresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("couldNotDeleteSku"));
    }
  }

  return (
    <main className="workspace-main">
      {errorMessage && !isModalOpen ? <div className="alert-banner">{errorMessage}</div> : null}

      <section className="workbook-panel workbook-panel--full">
        <div className="tab-strip">
          <div className="tab-strip__toolbar">
            <div className="tab-strip__actions">
              <Button variant="contained" onClick={openCreateModal}>{t("addNew")}</Button>
            </div>
          </div>
          <div className="filter-bar">
            <label>{t("search")}<input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder={t("masterTableSearchPlaceholder")} /></label>
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
        maxWidth="md"
      >
        <DialogTitle sx={{ pb: 1 }}>
          {editingItemId ? t("masterDialogEdit") : t("masterDialogAdd")}
          <IconButton aria-label={t("close")} onClick={closeModal} sx={{ position: "absolute", right: 16, top: 16 }}>
            <span aria-hidden="true">x</span>
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {errorMessage ? <div className="alert-banner">{errorMessage}</div> : null}
          <form className="sheet-form" onSubmit={handleSubmit}>
            <label>{t("sku")}<input value={form.sku} onChange={(event) => setForm((current) => ({ ...current, sku: event.target.value }))} placeholder="023042" required /></label>
            <label className="sheet-form__wide">{t("description")}<input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder={t("descriptionPlaceholder")} required /></label>
            <label>{t("currentStorage")}<select value={form.locationId} onChange={(event) => setForm((current) => ({ ...current, locationId: event.target.value }))} required>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
            <div className="sheet-note sheet-form__wide"><strong>{t("storageSection")}</strong> {form.storageSection || "A"}</div>
            <label>{t("onHand")}<input type="number" min="0" value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: Math.max(0, Number(event.target.value || 0)) }))} /></label>
            <label>{t("deliveryDate")}<input type="date" value={form.deliveryDate} onChange={(event) => setForm((current) => ({ ...current, deliveryDate: event.target.value }))} /></label>
            <label>{t("containerNo")}<input value={form.containerNo} onChange={(event) => setForm((current) => ({ ...current, containerNo: event.target.value }))} placeholder="KKFU7963968" /></label>
            <label>{t("expectedQty")}<input type="number" min="0" value={form.expectedQty} onChange={(event) => setForm((current) => ({ ...current, expectedQty: Math.max(0, Number(event.target.value || 0)) }))} /></label>
            <label>{t("received")}<input type="number" min="0" value={form.receivedQty} onChange={(event) => setForm((current) => ({ ...current, receivedQty: Math.max(0, Number(event.target.value || 0)) }))} /></label>
            <label>{t("pallets")}<input type="number" min="0" value={form.pallets} onChange={(event) => setForm((current) => ({ ...current, pallets: Math.max(0, Number(event.target.value || 0)) }))} /></label>
            <label className="sheet-form__wide">{t("palletsDetail")}<input value={form.palletsDetailCtns} onChange={(event) => setForm((current) => ({ ...current, palletsDetailCtns: event.target.value }))} placeholder={suggestedPalletsDetail || "29*66+44"} /></label>
            {suggestedPalletsDetail ? <div className="sheet-note sheet-form__wide"><strong>{t("suggested")}</strong> {suggestedPalletsDetail}<button className="button button--ghost button--small" type="button" onClick={() => setForm((current) => ({ ...current, palletsDetailCtns: suggestedPalletsDetail }))}>{t("useSuggestion")}</button></div> : null}
            <label>{t("heightIn")}<input type="number" min="0" value={form.heightIn} onChange={(event) => setForm((current) => ({ ...current, heightIn: Math.max(0, Number(event.target.value || 0)) }))} /></label>
            <label>{t("outDate")}<input type="date" value={form.outDate} onChange={(event) => setForm((current) => ({ ...current, outDate: event.target.value }))} /></label>
            <label>{t("reorderLevel")}<input type="number" min="0" value={form.reorderLevel} onChange={(event) => setForm((current) => ({ ...current, reorderLevel: Math.max(0, Number(event.target.value || 0)) }))} /></label>
            <div className="sheet-form__actions sheet-form__wide">
              <button className="button button--primary" type="submit" disabled={isSubmitting}>{isSubmitting ? t("saving") : editingItemId ? t("updateRow") : t("addRow")}</button>
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
