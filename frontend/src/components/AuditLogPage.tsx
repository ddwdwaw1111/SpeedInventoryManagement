import { useDeferredValue, useMemo, useState } from "react";
import { Box, Chip } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";

import { formatDateTimeValue } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import type { AuditLog } from "../lib/types";

type AuditLogPageProps = {
  auditLogs: AuditLog[];
  isLoading: boolean;
};

export function AuditLogPage({ auditLogs, isLoading }: AuditLogPageProps) {
  const { t } = useI18n();
  const { resolvedTimeZone } = useSettings();
  const [searchTerm, setSearchTerm] = useState("");
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const normalizedSearch = deferredSearchTerm.trim().toLowerCase();

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

    return normalizedSearch.length === 0 || searchBlob.includes(normalizedSearch);
  }), [auditLogs, normalizedSearch]);

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
    { field: "requestMethod", headerName: t("method"), minWidth: 110, flex: 0.6, renderCell: (params) => <span className="cell--mono">{params.row.requestMethod || "-"}</span> },
    { field: "requestPath", headerName: t("path"), minWidth: 220, flex: 1.2, renderCell: (params) => <span className="cell--mono">{params.row.requestPath || "-"}</span> },
    { field: "detailsJson", headerName: t("details"), minWidth: 300, flex: 1.5, renderCell: (params) => params.row.detailsJson || "-" }
  ], [resolvedTimeZone, t]);

  return (
    <main className="workspace-main">
      <section className="workbook-panel workbook-panel--full">
        <div className="tab-strip">
          <div className="tab-strip__heading">
            <h2>{t("auditLogs")}</h2>
            <p>{t("auditLogsDesc")}</p>
          </div>
          <div className="filter-bar">
            <label>{t("search")}<input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder={t("auditLogSearchPlaceholder")} /></label>
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
              sx={{ border: 0 }}
            />
          </Box>
        </div>
      </section>
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
