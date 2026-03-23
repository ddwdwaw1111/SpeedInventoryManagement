import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import { type FormEvent, useMemo, useState } from "react";
import { Box, Button, Chip, Dialog, DialogContent, DialogTitle, IconButton } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";

import { api } from "../lib/api";
import { RowActionsMenu } from "./RowActionsMenu";
import { formatDateTimeValue } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import type { Item, Location, LocationPayload, UserRole } from "../lib/types";
import { buildWorkspaceGridSlots, WorkspacePanelHeader } from "./WorkspacePanelChrome";

type StorageManagementPageProps = {
  locations: Location[];
  items: Item[];
  currentUserRole: UserRole;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
};

type LocationFormState = {
  name: string;
  address: string;
  zone: string;
  description: string;
  capacity: number;
  sectionNames: string[];
};

const emptyLocationForm: LocationFormState = {
  name: "",
  address: "",
  zone: "",
  description: "",
  capacity: 0,
  sectionNames: ["A"]
};

export function StorageManagementPage({ locations, items, currentUserRole, isLoading, onRefresh }: StorageManagementPageProps) {
  const { t } = useI18n();
  const { resolvedTimeZone } = useSettings();
  const canManage = currentUserRole === "admin";
  const pageDescription = t("storageManagementDesc");
  const permissionNotice = canManage ? "" : t("adminOnlyManageNotice");
  const [form, setForm] = useState<LocationFormState>(emptyLocationForm);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingLocationId, setEditingLocationId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const locationUsage = useMemo(() => {
    const usageMap = new Map<number, number>();
    items.forEach((item) => {
      usageMap.set(item.locationId, (usageMap.get(item.locationId) ?? 0) + 1);
    });
    return usageMap;
  }, [items]);
  const mainGridSlots = buildWorkspaceGridSlots({
    emptyTitle: t("noResults"),
    emptyDescription: t("emptyStateHint"),
    loadingTitle: t("loadingRecords"),
    loadingDescription: pageDescription
  });

  const columns = useMemo<GridColDef<Location>[]>(() => [
    { field: "name", headerName: t("storageName"), minWidth: 180, flex: 1 },
    { field: "address", headerName: t("address"), minWidth: 260, flex: 1.5, renderCell: (params) => params.value || "-" },
    { field: "zone", headerName: t("zone"), minWidth: 140, flex: 0.9 },
    { field: "capacity", headerName: t("capacity"), minWidth: 110, type: "number" },
    {
      field: "sectionNames",
      headerName: t("storageSections"),
      minWidth: 220,
      flex: 1.2,
      valueGetter: (_, row) => row.sectionNames.join(", ")
    },
    {
      field: "assignedSkuRows",
      headerName: t("assignedSkuRows"),
      minWidth: 150,
      type: "number",
      valueGetter: (_, row) => locationUsage.get(row.id) ?? 0
    },
    { field: "description", headerName: t("notes"), minWidth: 240, flex: 1.3, renderCell: (params) => params.value || "-" },
    { field: "createdAt", headerName: t("created"), minWidth: 220, valueFormatter: (value) => formatDateTimeValue(String(value), resolvedTimeZone) },
    {
      field: "status",
      headerName: t("status"),
      minWidth: 120,
      sortable: false,
      filterable: false,
      renderCell: (params) => (locationUsage.get(params.row.id) ?? 0) > 0 ? <Chip label={t("active")} color="info" size="small" /> : <Chip label={t("empty")} size="small" />
    },
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
            { key: "edit", label: t("edit"), icon: <EditOutlinedIcon fontSize="small" />, onClick: () => startEdit(params.row) },
            { key: "delete", label: t("delete"), icon: <DeleteOutlineOutlinedIcon fontSize="small" />, danger: true, onClick: () => handleDelete(params.row) }
          ]}
        />
      ) : null
    }
  ], [canManage, locationUsage, resolvedTimeZone, t]);

  function resetForm() {
    setForm(emptyLocationForm);
    setEditingLocationId(null);
    setIsModalOpen(false);
    setErrorMessage("");
  }

  function openCreateModal() {
    if (!canManage) return;
    setForm(emptyLocationForm);
    setEditingLocationId(null);
    setErrorMessage("");
    setIsModalOpen(true);
  }

  function startEdit(location: Location) {
    if (!canManage) return;
    setEditingLocationId(location.id);
    setForm({
      name: location.name,
      address: location.address,
      zone: location.zone,
      description: location.description,
      capacity: location.capacity,
      sectionNames: location.sectionNames.length > 0 ? [...location.sectionNames] : ["A"]
    });
    setErrorMessage("");
    setIsModalOpen(true);
  }

  function closeModal() {
    setForm(emptyLocationForm);
    setEditingLocationId(null);
    setErrorMessage("");
    setIsModalOpen(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage) return;
    setSubmitting(true);
    setErrorMessage("");

    const payload: LocationPayload = {
      name: form.name,
      address: form.address,
      zone: form.zone,
      description: form.description,
      capacity: form.capacity,
      sectionNames: form.sectionNames
    };

    try {
      if (editingLocationId) {
        await api.updateLocation(editingLocationId, payload);
      } else {
        await api.createLocation(payload);
      }
      closeModal();
      await onRefresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("couldNotSaveLocation"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(location: Location) {
    if (!canManage) return;
    if (!window.confirm(t("deleteStorageConfirm", { name: location.name }))) return;

    setErrorMessage("");
    try {
      await api.deleteLocation(location.id);
      if (editingLocationId === location.id) closeModal();
      await onRefresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("couldNotDeleteLocation"));
    }
  }

  function updateSectionName(index: number, value: string) {
    setForm((current) => ({
      ...current,
      sectionNames: current.sectionNames.map((sectionName, sectionIndex) => sectionIndex === index ? value : sectionName)
    }));
  }

  function addSectionName() {
    setForm((current) => ({
      ...current,
      sectionNames: [...current.sectionNames, ""]
    }));
  }

  function removeSectionName(index: number) {
    setForm((current) => ({
      ...current,
      sectionNames: current.sectionNames.length === 1 ? current.sectionNames : current.sectionNames.filter((_, sectionIndex) => sectionIndex !== index)
    }));
  }

  return (
    <main className="workspace-main">
      <section className="workbook-panel workbook-panel--full">
        <div className="tab-strip">
          <WorkspacePanelHeader
            title={t("storageManagement")}
            actions={canManage ? (
              <Button variant="contained" startIcon={<AddCircleOutlineOutlinedIcon />} onClick={openCreateModal}>{t("addLocation")}</Button>
            ) : undefined}
            notices={[permissionNotice]}
            errorMessage={errorMessage && !isModalOpen ? errorMessage : ""}
          />
        </div>
        <div className="sheet-table-wrap">
          <Box sx={{ minWidth: 0 }}>
            <DataGrid
              rows={locations}
              columns={columns}
              loading={isLoading}
              pagination
              pageSizeOptions={[8, 16, 32]}
              disableRowSelectionOnClick
              initialState={{ pagination: { paginationModel: { pageSize: 8, page: 0 } } }}
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
        maxWidth="md"
      >
        <DialogTitle sx={{ pb: 1 }}>
          {editingLocationId ? t("editStorageLocation") : t("addStorageLocation")}
          <IconButton aria-label={t("close")} onClick={closeModal} sx={{ position: "absolute", right: 16, top: 16 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {errorMessage ? <div className="alert-banner">{errorMessage}</div> : null}
          <form className="sheet-form" onSubmit={handleSubmit}>
            <label>{t("storageName")}<input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="NJ Warehouse A" required /></label>
            <label>{t("zone")}<input value={form.zone} onChange={(event) => setForm((current) => ({ ...current, zone: event.target.value }))} placeholder="North Wing" required /></label>
            <label className="sheet-form__wide">{t("address")}<input value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} placeholder="1200 Harbor Blvd, North Bergen, NJ" required /></label>
            <label>{t("capacity")}<input type="number" min="0" value={form.capacity} onChange={(event) => setForm((current) => ({ ...current, capacity: Math.max(0, Number(event.target.value || 0)) }))} /></label>
            <div className="sheet-form__wide">
              <div className="batch-lines__toolbar">
                <strong>{t("storageSections")}</strong>
                <Button size="small" variant="outlined" type="button" startIcon={<AddOutlinedIcon />} onClick={addSectionName}>{t("addSection")}</Button>
              </div>
              <div className="batch-lines">
                {form.sectionNames.map((sectionName, index) => (
                  <div className="batch-line-card" key={`${editingLocationId ?? "new"}-${index}`}>
                    <div className="batch-line-card__header">
                      <strong>{t("sectionName")} #{index + 1}</strong>
                      <button className="button button--danger button--small" type="button" onClick={() => removeSectionName(index)} disabled={form.sectionNames.length === 1}>{t("removeLine")}</button>
                    </div>
                    <input value={sectionName} onChange={(event) => updateSectionName(index, event.target.value)} placeholder="A / B / Cold / Overflow" />
                  </div>
                ))}
              </div>
            </div>
            <label className="sheet-form__wide">{t("notes")}<textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder={t("storageNotesPlaceholder")} rows={4} /></label>
            <div className="sheet-form__actions sheet-form__wide">
              <button className="button button--primary" type="submit" disabled={submitting}>{submitting ? t("saving") : editingLocationId ? t("updateLocation") : t("addLocation")}</button>
              <button className="button button--ghost" type="button" onClick={closeModal}>{editingLocationId ? t("cancelEdit") : t("cancel")}</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
