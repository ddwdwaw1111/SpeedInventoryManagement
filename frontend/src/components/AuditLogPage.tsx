import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { useDeferredValue, useMemo, useState } from "react";
import { Box, Button, Dialog, DialogContent, DialogTitle, IconButton, Chip } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";

import { formatDateTimeValue } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import type { AuditLog } from "../lib/types";
import { buildWorkspaceGridSlots, WorkspacePanelHeader } from "./WorkspacePanelChrome";

type AuditLogPageProps = {
  auditLogs: AuditLog[];
  isLoading: boolean;
};

export function AuditLogPage({ auditLogs, isLoading }: AuditLogPageProps) {
  const { t } = useI18n();
  const { resolvedTimeZone } = useSettings();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedAction, setSelectedAction] = useState("all");
  const [selectedEntityType, setSelectedEntityType] = useState("all");
  const [selectedActorRole, setSelectedActorRole] = useState("all");
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const normalizedSearch = deferredSearchTerm.trim().toLowerCase();

  const actionOptions = useMemo(() => buildFilterOptions(auditLogs.map((log) => log.action)), [auditLogs]);
  const entityTypeOptions = useMemo(() => buildFilterOptions(auditLogs.map((log) => log.entityType)), [auditLogs]);
  const actorRoleOptions = useMemo(() => buildFilterOptions(auditLogs.map((log) => log.actorRole)), [auditLogs]);

  const filteredRows = useMemo(() => auditLogs.filter((log) => {
    const searchBlob = [
      log.actorName,
      log.actorEmail,
      log.actorRole,
      log.action,
      log.entityType,
      log.targetLabel,
      log.summary,
      log.requestMethod,
      log.requestPath,
      log.detailsJson
    ].join(" ").toLowerCase();

    const matchesSearch = normalizedSearch.length === 0 || searchBlob.includes(normalizedSearch);
    const matchesAction = selectedAction === "all" || log.action === selectedAction;
    const matchesEntityType = selectedEntityType === "all" || log.entityType === selectedEntityType;
    const matchesActorRole = selectedActorRole === "all" || log.actorRole === selectedActorRole;

    return matchesSearch && matchesAction && matchesEntityType && matchesActorRole;
  }), [auditLogs, normalizedSearch, selectedAction, selectedEntityType, selectedActorRole]);
  const hasActiveFilters = normalizedSearch.length > 0 || selectedAction !== "all" || selectedEntityType !== "all" || selectedActorRole !== "all";
  const mainGridSlots = buildWorkspaceGridSlots({
    emptyTitle: t("noResults"),
    emptyDescription: hasActiveFilters ? t("filteredStateHint") : t("emptyStateHint"),
    loadingTitle: t("loadingRecords"),
    loadingDescription: t("auditLogsDesc")
  });

  const columns = useMemo<GridColDef<AuditLog>[]>(() => [
    {
      field: "createdAt",
      headerName: t("created"),
      minWidth: 200,
      flex: 1,
      renderCell: (params) => formatDateTimeValue(params.row.createdAt, resolvedTimeZone)
    },
    {
      field: "action",
      headerName: t("action"),
      minWidth: 120,
      renderCell: (params) => <Chip size="small" label={params.row.action} color={renderActionColor(params.row.action)} />
    },
    { field: "entityType", headerName: t("entityType"), minWidth: 150, flex: 0.8, renderCell: (params) => <span className="cell--mono">{params.row.entityType}</span> },
    { field: "targetLabel", headerName: t("target"), minWidth: 190, flex: 1 },
    { field: "summary", headerName: t("summary"), minWidth: 260, flex: 1.3, renderCell: (params) => params.row.summary || "-" },
    { field: "actorName", headerName: t("actor"), minWidth: 180, flex: 1, renderCell: (params) => params.row.actorName || params.row.actorEmail || "-" },
    { field: "actorRole", headerName: t("role"), minWidth: 120, flex: 0.7, renderCell: (params) => <span className="cell--mono">{params.row.actorRole || "-"}</span> },
    {
      field: "requestPath",
      headerName: t("path"),
      minWidth: 260,
      flex: 1.2,
      renderCell: (params) => (
        <div>
          <div className="cell--mono">{params.row.requestPath || "-"}</div>
          <div className="sheet-table__subtle">{params.row.requestMethod || "-"}</div>
        </div>
      )
    },
    {
      field: "detailsPreview",
      headerName: t("details"),
      minWidth: 280,
      flex: 1.2,
      sortable: false,
      filterable: false,
      renderCell: (params) => summarizeAuditDetails(params.row.detailsJson)
    },
    {
      field: "actions",
      headerName: t("actions"),
      minWidth: 140,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <Button
          size="small"
          variant="text"
          startIcon={<VisibilityOutlinedIcon fontSize="small" />}
          onClick={() => setSelectedLog(params.row)}
        >
          {t("viewDetails")}
        </Button>
      )
    }
  ], [resolvedTimeZone, t]);

  const selectedLogDetails = useMemo(() => formatAuditDetails(selectedLog?.detailsJson ?? ""), [selectedLog?.detailsJson]);

  return (
      <main className="workspace-main">
        <section className="workbook-panel workbook-panel--full">
          <div className="tab-strip">
            <WorkspacePanelHeader title={t("auditLogs")} />
            <div className="filter-bar">
              <label>{t("search")}<input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder={t("auditLogSearchPlaceholder")} /></label>
            <label>{t("filterByAction")}<select value={selectedAction} onChange={(event) => setSelectedAction(event.target.value)}><option value="all">{t("allActions")}</option>{actionOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label>{t("filterByEntity")}<select value={selectedEntityType} onChange={(event) => setSelectedEntityType(event.target.value)}><option value="all">{t("allEntities")}</option>{entityTypeOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label>{t("filterByRole")}<select value={selectedActorRole} onChange={(event) => setSelectedActorRole(event.target.value)}><option value="all">{t("allRoles")}</option>{actorRoleOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          </div>
        </div>

        <div className="sheet-table-wrap">
          <Box sx={{ minWidth: 0 }}>
            <DataGrid
              rows={filteredRows}
              columns={columns}
              loading={isLoading}
              pagination
              pageSizeOptions={[10, 25, 50, 100]}
              disableRowSelectionOnClick
              initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
              getRowHeight={() => 72}
              slots={mainGridSlots}
              sx={{ border: 0 }}
            />
          </Box>
        </div>
      </section>

      <Dialog
        open={Boolean(selectedLog)}
        onClose={(_, reason) => {
          if (reason === "backdropClick") return;
          setSelectedLog(null);
        }}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle sx={{ pb: 1 }}>
          {selectedLog?.targetLabel || t("auditLogDetails")}
          <IconButton aria-label={t("close")} onClick={() => setSelectedLog(null)} sx={{ position: "absolute", right: 16, top: 16 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {selectedLog ? (
            <>
              <div className="sheet-note" style={{ marginBottom: "1rem" }}>
                <strong>{t("action")}:</strong> {selectedLog.action}{" "}
                <strong style={{ marginLeft: "1rem" }}>{t("entityType")}:</strong> {selectedLog.entityType}{" "}
                <strong style={{ marginLeft: "1rem" }}>{t("actor")}:</strong> {selectedLog.actorName || selectedLog.actorEmail || "-"}{" "}
                <strong style={{ marginLeft: "1rem" }}>{t("created")}:</strong> {formatDateTimeValue(selectedLog.createdAt, resolvedTimeZone)}
              </div>
              <div className="sheet-form">
                <div className="sheet-note"><strong>{t("summary")}</strong><br />{selectedLog.summary || "-"}</div>
                <div className="sheet-note"><strong>{t("path")}</strong><br /><span className="cell--mono">{selectedLog.requestMethod || "-"} {selectedLog.requestPath || "-"}</span></div>
                <div className="sheet-note"><strong>{t("target")}</strong><br />{selectedLog.targetLabel || "-"}</div>
                <div className="sheet-note"><strong>{t("role")}</strong><br />{selectedLog.actorRole || "-"}</div>
              </div>
              <div className="sheet-note" style={{ marginTop: "1rem" }}>
                <strong>{t("auditLogDetails")}</strong>
                <pre className="audit-log-json">{selectedLogDetails || t("noAuditDetails")}</pre>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </main>
  );
}

function renderActionColor(action: string): "default" | "success" | "warning" | "error" | "info" {
  if (action === "CREATE") return "success";
  if (action === "UPDATE") return "info";
  if (action === "DELETE") return "error";
  if (action === "CANCEL") return "warning";
  return "default";
}

function buildFilterOptions(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

function summarizeAuditDetails(detailsJson: string) {
  if (!detailsJson.trim()) return "-";

  const formatted = formatAuditDetails(detailsJson);
  return formatted.length > 160 ? `${formatted.slice(0, 157)}...` : formatted;
}

function formatAuditDetails(detailsJson: string) {
  if (!detailsJson.trim()) return "";

  try {
    return JSON.stringify(JSON.parse(detailsJson), null, 2);
  } catch {
    return detailsJson;
  }
}
