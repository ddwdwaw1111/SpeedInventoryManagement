import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import CloseIcon from "@mui/icons-material/Close";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import { type FormEvent, useDeferredValue, useMemo, useState } from "react";
import { Box, Button, Chip, Dialog, DialogContent, DialogTitle, IconButton } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";

import { api } from "../lib/api";
import { formatDateTimeValue } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import type { CreateUserPayload, UpdateUserAccessPayload, User, UserRole } from "../lib/types";
import { RowActionsMenu } from "./RowActionsMenu";
import { buildWorkspaceGridSlots, WorkspacePanelHeader } from "./WorkspacePanelChrome";

type UserManagementPageProps = {
  users: User[];
  currentUser: User;
  isLoading: boolean;
  onRefresh: () => Promise<void>;
};

type UserFormState = {
  email: string;
  fullName: string;
  password: string;
  role: UserRole;
  isActive: boolean;
};

const roleOptions: UserRole[] = ["admin", "operator", "viewer"];

const emptyUserForm: UserFormState = {
  email: "",
  fullName: "",
  password: "",
  role: "operator",
  isActive: true
};

export function UserManagementPage({ users, currentUser, isLoading, onRefresh }: UserManagementPageProps) {
  const { t } = useI18n();
  const { resolvedTimeZone } = useSettings();
  const pageDescription = t("userManagementDesc");
  const [searchTerm, setSearchTerm] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form, setForm] = useState<UserFormState>(emptyUserForm);
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const deferredSearchTerm = useDeferredValue(searchTerm);

  const normalizedSearch = deferredSearchTerm.trim().toLowerCase();
  const filteredRows = useMemo(() => users.filter((user) => {
    const searchBlob = [user.fullName, user.email, user.role, user.isActive ? t("active") : t("inactive")].join(" ").toLowerCase();
    return normalizedSearch.length === 0 || searchBlob.includes(normalizedSearch);
  }), [normalizedSearch, t, users]);
  const hasActiveFilters = normalizedSearch.length > 0;
  const mainGridSlots = buildWorkspaceGridSlots({
    emptyTitle: t("noResults"),
    emptyDescription: hasActiveFilters ? t("filteredStateHint") : t("emptyStateHint"),
    loadingTitle: t("loadingRecords"),
    loadingDescription: pageDescription
  });

  const columns = useMemo<GridColDef<User>[]>(() => [
    { field: "fullName", headerName: t("fullName"), minWidth: 180, flex: 1 },
    { field: "email", headerName: t("email"), minWidth: 220, flex: 1.2 },
    {
      field: "role",
      headerName: t("role"),
      minWidth: 130,
      renderCell: (params) => <Chip size="small" label={t(params.row.role)} color={roleChipColor(params.row.role)} />
    },
    {
      field: "isActive",
      headerName: t("status"),
      minWidth: 120,
      renderCell: (params) => <Chip size="small" label={params.row.isActive ? t("active") : t("inactive")} color={params.row.isActive ? "success" : "default"} />
    },
    { field: "createdAt", headerName: t("created"), minWidth: 210, flex: 1, renderCell: (params) => formatDateTimeValue(params.row.createdAt, resolvedTimeZone) },
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
            { key: "edit", label: t("edit"), icon: <EditOutlinedIcon fontSize="small" />, onClick: () => openEditModal(params.row) }
          ]}
        />
      )
    }
  ], [resolvedTimeZone, t]);

  function openCreateModal() {
    setEditingUser(null);
    setForm(emptyUserForm);
    setErrorMessage("");
    setIsModalOpen(true);
  }

  function openEditModal(user: User) {
    setEditingUser(user);
    setForm({
      email: user.email,
      fullName: user.fullName,
      password: "",
      role: user.role,
      isActive: user.isActive
    });
    setErrorMessage("");
    setIsModalOpen(true);
  }

  function closeModal() {
    setEditingUser(null);
    setForm(emptyUserForm);
    setErrorMessage("");
    setIsModalOpen(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage("");

    try {
      if (editingUser) {
        const payload: UpdateUserAccessPayload = {
          role: form.role,
          isActive: form.isActive
        };
        await api.updateUserAccess(editingUser.id, payload);
      } else {
        const payload: CreateUserPayload = {
          email: form.email,
          fullName: form.fullName,
          password: form.password,
          role: form.role,
          isActive: form.isActive
        };
        await api.createUser(payload);
      }

      closeModal();
      await onRefresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t("couldNotSaveUser"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="workspace-main">
      <section className="workbook-panel workbook-panel--full">
        <div className="tab-strip">
          <WorkspacePanelHeader
            title={t("userManagement")}
            actions={<Button variant="contained" startIcon={<AddCircleOutlineOutlinedIcon />} onClick={openCreateModal}>{t("addUser")}</Button>}
            errorMessage={errorMessage && !isModalOpen ? errorMessage : ""}
          />
          <div className="filter-bar">
            <label>{t("search")}<input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder={t("userSearchPlaceholder")} /></label>
          </div>
        </div>

        <div className="sheet-table-wrap">
          <Box sx={{ minWidth: 0 }}>
            <DataGrid
              rows={filteredRows}
              columns={columns}
              loading={isLoading}
              pagination
              pageSizeOptions={[10, 25, 50]}
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
          {editingUser ? t("editUserAccess") : t("addUser")}
          <IconButton aria-label={t("close")} onClick={closeModal} sx={{ position: "absolute", right: 16, top: 16 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {errorMessage ? <div className="alert-banner">{errorMessage}</div> : null}
          <form className="sheet-form" onSubmit={handleSubmit}>
            <label>
              {t("fullName")}
              <input
                value={form.fullName}
                onChange={(event) => setForm((current) => ({ ...current, fullName: event.target.value }))}
                placeholder="Jane Doe"
                required
                disabled={Boolean(editingUser)}
              />
            </label>
            <label>
              {t("email")}
              <input
                type="email"
                value={form.email}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                placeholder="you@company.com"
                required
                disabled={Boolean(editingUser)}
              />
            </label>
            {!editingUser ? (
              <label>
                {t("password")}
                <input
                  type="password"
                  value={form.password}
                  onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                  placeholder={t("userPasswordPlaceholder")}
                  required
                />
              </label>
            ) : null}
            <label>
              {t("role")}
              <select value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as UserRole }))}>
                {roleOptions.map((role) => <option key={role} value={role}>{t(role)}</option>)}
              </select>
            </label>
            <label>
              {t("status")}
              <select value={form.isActive ? "active" : "inactive"} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.value === "active" }))}>
                <option value="active">{t("active")}</option>
                <option value="inactive" disabled={editingUser?.id === currentUser.id}>{t("inactive")}</option>
              </select>
            </label>
            {editingUser ? (
              <div className="sheet-note sheet-form__wide">
                <strong>{t("currentUser")}</strong> {editingUser.id === currentUser.id ? t("yes") : t("no")}
              </div>
            ) : null}
            <div className="sheet-form__actions sheet-form__wide">
              <button className="button button--primary" type="submit" disabled={isSubmitting}>{isSubmitting ? t("saving") : editingUser ? t("updateUserAccess") : t("createUser")}</button>
              <button className="button button--ghost" type="button" onClick={closeModal}>{t("cancel")}</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function roleChipColor(role: UserRole): "default" | "primary" | "info" | "warning" {
  if (role === "admin") return "primary";
  if (role === "operator") return "info";
  return "warning";
}
