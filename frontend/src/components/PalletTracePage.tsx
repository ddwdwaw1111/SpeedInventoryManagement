import CloseIcon from "@mui/icons-material/Close";
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { Box, Button, Chip, Dialog, DialogContent, DialogTitle, IconButton } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { ApiError, api } from "../lib/api";
import { formatDateTimeValue, formatDateValue } from "../lib/dates";
import { setPendingInventoryActionContext } from "../lib/inventoryActionContext";
import { buildInventoryActionSourceKey } from "../lib/inventoryActionSources";
import { useI18n } from "../lib/i18n";
import { consumePendingPalletTraceLaunchContext } from "../lib/palletTraceLaunchContext";
import { useSettings } from "../lib/settings";
import type { PalletTrace, UserRole } from "../lib/types";
import { buildWorkspaceGridSlots, InventoryViewSwitcher, WorkspacePanelHeader } from "./WorkspacePanelChrome";

const PALLET_TRACE_LOAD_LIMIT = 50000;

export function PalletTracePage({
  onNavigate,
  currentUserRole = "viewer"
}: {
  onNavigate?: (page: import("../lib/routes").PageKey) => void;
  currentUserRole?: UserRole;
}) {
  const { t } = useI18n();
  const { resolvedTimeZone } = useSettings();
  const activityDateFormatter = useMemo(
    () => new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }),
    []
  );
  const [pallets, setPallets] = useState<PalletTrace[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [sourceInboundDocumentIdFilter, setSourceInboundDocumentIdFilter] = useState<number | null>(null);
  const [selectedPallet, setSelectedPallet] = useState<PalletTrace | null>(null);
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const normalizedSearch = deferredSearchTerm.trim();
  const canManageInventory = currentUserRole === "admin" || currentUserRole === "operator";

  useEffect(() => {
    const pendingContext = consumePendingPalletTraceLaunchContext();
    if (pendingContext?.sourceInboundDocumentId && pendingContext.sourceInboundDocumentId > 0) {
      setSourceInboundDocumentIdFilter(pendingContext.sourceInboundDocumentId);
    }
    if (pendingContext?.searchTerm?.trim()) {
      setSearchTerm(pendingContext.searchTerm.trim());
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function loadPallets() {
      setIsLoading(true);
      setErrorMessage("");
      try {
        const nextPallets = await api.getPallets(PALLET_TRACE_LOAD_LIMIT, normalizedSearch, sourceInboundDocumentIdFilter ?? undefined);
        if (!active) return;
        setPallets(nextPallets);
      } catch (error) {
        if (!active) return;
        setErrorMessage(getErrorMessage(error, t("couldNotLoadReport")));
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void loadPallets();
    return () => {
      active = false;
    };
  }, [normalizedSearch, sourceInboundDocumentIdFilter, t]);

  const openPallets = useMemo(
    () => pallets.filter((pallet) => pallet.status === "OPEN" || pallet.status === "PARTIAL").length,
    [pallets]
  );
  const shippedPallets = useMemo(
    () => pallets.filter((pallet) => pallet.status === "SHIPPED").length,
    [pallets]
  );
  const contentRows = useMemo(
    () => pallets.reduce((total, pallet) => total + pallet.contents.length, 0),
    [pallets]
  );

  function launchAdjustmentForPallet(pallet: PalletTrace) {
    if (!onNavigate) {
      return;
    }

    setPendingInventoryActionContext("adjustments", {
      sourceKey: buildInventoryActionSourceKey(pallet.customerId, pallet.sku),
      sku: pallet.sku,
      customerId: pallet.customerId,
      containerNo: pallet.currentContainerNo,
      palletId: pallet.id
    });
    onNavigate("adjustments");
  }

  const mainGridSlots = buildWorkspaceGridSlots({
    emptyTitle: t("noPallets"),
    emptyDescription: normalizedSearch || sourceInboundDocumentIdFilter ? t("filteredStateHint") : t("palletTraceDesc"),
    loadingTitle: t("loadingRecords"),
    loadingDescription: t("palletTraceDesc")
  });

  const columns = useMemo<GridColDef<PalletTrace>[]>(() => [
    {
      field: "palletCode",
      headerName: t("palletCode"),
      minWidth: 170,
      renderCell: (params) => <span className="cell--mono">{params.row.palletCode}</span>
    },
    {
      field: "sourceInboundDocumentId",
      headerName: t("sourceInboundDocument"),
      minWidth: 130,
      renderCell: (params) => <span className="cell--mono">{params.row.sourceInboundDocumentId}</span>
    },
    {
      field: "sourceInboundLineId",
      headerName: t("sourceInboundLine"),
      minWidth: 120,
      renderCell: (params) => <span className="cell--mono">{params.row.sourceInboundLineId}</span>
    },
    {
      field: "customerName",
      headerName: t("customer"),
      minWidth: 180,
      flex: 0.9
    },
    {
      field: "sku",
      headerName: t("sku"),
      minWidth: 150,
      renderCell: (params) => <span className="cell--mono">{params.row.sku || "-"}</span>
    },
    {
      field: "description",
      headerName: t("description"),
      minWidth: 260,
      flex: 1.2
    },
    {
      field: "currentLocationName",
      headerName: t("currentStorage"),
      minWidth: 180,
      flex: 0.9
    },
    {
      field: "currentStorageSection",
      headerName: t("storageSection"),
      minWidth: 120,
      renderCell: (params) => <span className="cell--mono">{params.row.currentStorageSection || "-"}</span>
    },
    {
      field: "currentContainerNo",
      headerName: t("containerNo"),
      minWidth: 150,
      renderCell: (params) => <span className="cell--mono">{params.row.currentContainerNo || "-"}</span>
    },
    {
      field: "status",
      headerName: t("status"),
      minWidth: 120,
      renderCell: (params) => (
        <Chip
          size="small"
          label={getPalletStatusLabel(t, params.row.status)}
          color={getPalletStatusColor(params.row.status)}
          variant={params.row.status === "SHIPPED" || params.row.status === "CANCELLED" ? "outlined" : "filled"}
        />
      )
    },
    {
      field: "quantity",
      headerName: t("quantity"),
      minWidth: 110,
      renderCell: (params) => getPalletTotalQty(params.row)
    },
    {
      field: "actualArrivalDate",
      headerName: t("actualArrivalDate"),
      minWidth: 150,
      renderCell: (params) => params.row.actualArrivalDate
        ? formatDateValue(params.row.actualArrivalDate, activityDateFormatter)
        : "-"
    },
    {
      field: "createdAt",
      headerName: t("created"),
      minWidth: 180,
      renderCell: (params) => formatDateTimeValue(params.row.createdAt, resolvedTimeZone)
    },
    {
      field: "actions",
      headerName: t("actions"),
      minWidth: canManageInventory ? 240 : 140,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <div className="flex flex-wrap items-center gap-1">
          <Button
            size="small"
            variant="text"
            startIcon={<VisibilityOutlinedIcon fontSize="small" />}
            onClick={() => setSelectedPallet(params.row)}
          >
            {t("viewTrace")}
          </Button>
          {canManageInventory ? (
            <Button
              size="small"
              variant="text"
              onClick={() => launchAdjustmentForPallet(params.row)}
              disabled={!canAdjustPallet(params.row)}
            >
              {t("adjustPallet")}
            </Button>
          ) : null}
        </div>
      )
    }
  ], [canManageInventory, resolvedTimeZone, t]);

  return (
    <main className="workspace-main">
      <section className="workbook-panel workbook-panel--full">
        <WorkspacePanelHeader
          title={t("palletTrace")}
          description={sourceInboundDocumentIdFilter
            ? t("palletTraceFilteredDesc", { documentId: sourceInboundDocumentIdFilter })
            : t("palletTraceDesc")}
          errorMessage={errorMessage}
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              {sourceInboundDocumentIdFilter ? (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setSourceInboundDocumentIdFilter(null)}
                >
                  {t("showAllPallets")}
                </Button>
              ) : null}
              <Button
                size="small"
                variant="outlined"
                startIcon={<RefreshOutlinedIcon fontSize="small" />}
                onClick={() => {
                  setSearchTerm((current) => current.trim());
                  setIsLoading(true);
                  void api.getPallets(PALLET_TRACE_LOAD_LIMIT, normalizedSearch, sourceInboundDocumentIdFilter ?? undefined).then((nextPallets) => {
                    setPallets(nextPallets);
                    setErrorMessage("");
                  }).catch((error) => {
                    setErrorMessage(getErrorMessage(error, t("couldNotLoadReport")));
                  }).finally(() => setIsLoading(false));
                }}
              >
                {t("refresh")}
              </Button>
            </div>
          )}
        />

        {onNavigate ? <InventoryViewSwitcher activeView="pallet-trace" onNavigate={onNavigate} /> : null}

        <div className="report-card-grid" style={{ marginBottom: "1rem" }}>
          <article className="metric-card">
            <span>{t("recordCount")}</span>
            <strong>{pallets.length}</strong>
          </article>
          <article className="metric-card">
            <span>{t("palletOpenCount")}</span>
            <strong>{openPallets}</strong>
          </article>
          <article className="metric-card">
            <span>{t("palletShippedCount")}</span>
            <strong>{shippedPallets}</strong>
          </article>
          <article className="metric-card">
            <span>{t("palletContentRows")}</span>
            <strong>{contentRows}</strong>
          </article>
        </div>

        <div className="filter-bar">
          <label>
            {t("search")}
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder={t("palletSearchPlaceholder")}
            />
          </label>
        </div>

        <div className="sheet-table-wrap">
          <Box sx={{ minWidth: 0 }}>
            <DataGrid
              rows={pallets}
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
        open={Boolean(selectedPallet)}
        onClose={(_, reason) => {
          if (reason === "backdropClick") return;
          setSelectedPallet(null);
        }}
        fullWidth
        maxWidth="lg"
      >
        <DialogTitle sx={{ pb: 1 }}>
          {selectedPallet ? `${t("palletTrace")} ${selectedPallet.palletCode}` : t("palletTrace")}
          <IconButton aria-label={t("close")} onClick={() => setSelectedPallet(null)} sx={{ position: "absolute", right: 16, top: 16 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {selectedPallet ? (
            <>
              <div className="sheet-form">
                <div className="sheet-note"><strong>{t("palletCode")}</strong><br />{selectedPallet.palletCode}</div>
                <div className="sheet-note"><strong>{t("parentPallet")}</strong><br />{selectedPallet.parentPalletId || "-"}</div>
                <div className="sheet-note"><strong>{t("sourceInboundDocument")}</strong><br />{selectedPallet.sourceInboundDocumentId}</div>
                <div className="sheet-note"><strong>{t("sourceInboundLine")}</strong><br />{selectedPallet.sourceInboundLineId}</div>
                <div className="sheet-note"><strong>{t("customer")}</strong><br />{selectedPallet.customerName || "-"}</div>
                <div className="sheet-note"><strong>{t("currentStorage")}</strong><br />{selectedPallet.currentLocationName || "-"}</div>
                <div className="sheet-note"><strong>{t("storageSection")}</strong><br />{selectedPallet.currentStorageSection || "-"}</div>
                <div className="sheet-note"><strong>{t("containerNo")}</strong><br />{selectedPallet.currentContainerNo || "-"}</div>
                <div className="sheet-note"><strong>{t("status")}</strong><br />{getPalletStatusLabel(t, selectedPallet.status)}</div>
                <div className="sheet-note"><strong>{t("actualArrivalDate")}</strong><br />{selectedPallet.actualArrivalDate ? formatDateValue(selectedPallet.actualArrivalDate, activityDateFormatter) : "-"}</div>
                <div className="sheet-note"><strong>{t("created")}</strong><br />{formatDateTimeValue(selectedPallet.createdAt, resolvedTimeZone)}</div>
                <div className="sheet-note"><strong>{t("updated")}</strong><br />{formatDateTimeValue(selectedPallet.updatedAt, resolvedTimeZone)}</div>
              </div>

              <div className="sheet-note" style={{ marginTop: "1rem" }}>
                {canManageInventory ? (
                  <div className="sheet-form__actions" style={{ marginBottom: "1rem" }}>
                    <Button
                      size="small"
                      variant="contained"
                      onClick={() => launchAdjustmentForPallet(selectedPallet)}
                      disabled={!canAdjustPallet(selectedPallet)}
                    >
                      {t("adjustPallet")}
                    </Button>
                  </div>
                ) : null}
                <strong>{t("palletContents")}</strong>
                {selectedPallet.contents.length === 0 ? (
                  <div style={{ marginTop: "0.75rem" }}>{t("palletNoContents")}</div>
                ) : (
                  <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.75rem" }}>
                    {selectedPallet.contents.map((content) => (
                      <div key={content.id} className="sheet-note" style={{ margin: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                          <strong>{content.itemNumber || content.sku || "-"}</strong>
                          <span className="cell--mono">{content.sku || "-"}</span>
                        </div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.75rem", marginTop: "0.75rem" }}>
                          <div><strong>{t("description")}</strong><br />{content.description || "-"}</div>
                          <div><strong>{t("quantity")}</strong><br />{content.quantity}</div>
                          <div><strong>{t("updated")}</strong><br />{formatDateTimeValue(content.updatedAt, resolvedTimeZone)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </main>
  );
}

function getPalletStatusLabel(t: (key: string) => string, status: string) {
  switch (status) {
    case "OPEN":
      return t("palletOpen");
    case "PARTIAL":
      return t("palletPartial");
    case "SHIPPED":
      return t("palletShipped");
    case "CANCELLED":
      return t("palletCancelled");
    default:
      return status || t("pending");
  }
}

function getPalletStatusColor(status: string): "success" | "warning" | "default" {
  switch (status) {
    case "OPEN":
      return "success";
    case "PARTIAL":
      return "warning";
    default:
      return "default";
  }
}

function getPalletTotalQty(pallet: PalletTrace) {
  return pallet.contents.reduce((sum, content) => sum + content.quantity, 0);
}

function getPalletAvailableQty(pallet: PalletTrace) {
  return pallet.contents.reduce(
    (sum, content) => sum + Math.max(0, content.quantity - (content.allocatedQty ?? 0) - (content.damagedQty ?? 0) - (content.holdQty ?? 0)),
    0
  );
}

function canAdjustPallet(pallet: PalletTrace | null) {
  return Boolean(pallet && (pallet.status === "OPEN" || pallet.status === "PARTIAL") && getPalletAvailableQty(pallet) > 0);
}

function getErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof ApiError || error instanceof Error) {
    return error.message || fallbackMessage;
  }
  return fallbackMessage;
}
