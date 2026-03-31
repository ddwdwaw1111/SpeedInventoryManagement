import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";
import CloseIcon from "@mui/icons-material/Close";
import { Box, Button, Chip, Dialog, DialogContent, DialogTitle, IconButton } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { ApiError, api } from "../lib/api";
import { formatDateTimeValue } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import type { ReceiptLotTrace } from "../lib/types";
import { buildWorkspaceGridSlots, WorkspacePanelHeader } from "./WorkspacePanelChrome";

export function ReceiptLotTracePage() {
  const { t } = useI18n();
  const { resolvedTimeZone } = useSettings();
  const [receiptLots, setReceiptLots] = useState<ReceiptLotTrace[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedLot, setSelectedLot] = useState<ReceiptLotTrace | null>(null);
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const normalizedSearch = deferredSearchTerm.trim();

  useEffect(() => {
    let active = true;

    async function loadReceiptLots() {
      setIsLoading(true);
      setErrorMessage("");
      try {
        const nextLots = await api.getReceiptLots(500, normalizedSearch);
        if (!active) return;
        setReceiptLots(nextLots);
      } catch (error) {
        if (!active) return;
        setErrorMessage(getErrorMessage(error, t("couldNotLoadReport")));
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void loadReceiptLots();
    return () => {
      active = false;
    };
  }, [normalizedSearch, t]);

  const openLots = useMemo(() => receiptLots.filter((lot) => lot.remainingQty > 0).length, [receiptLots]);
  const closedLots = receiptLots.length - openLots;
  const linkedMovements = useMemo(
    () => receiptLots.reduce((total, lot) => total + lot.links.length, 0),
    [receiptLots]
  );

  const mainGridSlots = buildWorkspaceGridSlots({
    emptyTitle: t("noReceiptLots"),
    emptyDescription: normalizedSearch ? t("filteredStateHint") : t("receiptLotTraceDesc"),
    loadingTitle: t("loadingRecords"),
    loadingDescription: t("receiptLotTraceDesc")
  });

  const columns = useMemo<GridColDef<ReceiptLotTrace>[]>(() => [
    {
      field: "id",
      headerName: t("receiptLotId"),
      minWidth: 110,
      renderCell: (params) => <span className="cell--mono">{params.row.id}</span>
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
      field: "itemNumber",
      headerName: t("itemNumber"),
      minWidth: 140,
      renderCell: (params) => params.row.itemNumber || "-"
    },
    {
      field: "sku",
      headerName: t("sku"),
      minWidth: 140,
      renderCell: (params) => <span className="cell--mono">{params.row.sku || "-"}</span>
    },
    {
      field: "description",
      headerName: t("description"),
      minWidth: 260,
      flex: 1.2
    },
    {
      field: "customerName",
      headerName: t("customer"),
      minWidth: 180,
      flex: 0.9
    },
    {
      field: "locationName",
      headerName: t("currentStorage"),
      minWidth: 170,
      flex: 0.9
    },
    {
      field: "storageSection",
      headerName: t("storageSection"),
      minWidth: 120,
      renderCell: (params) => <span className="cell--mono">{params.row.storageSection}</span>
    },
    {
      field: "containerNo",
      headerName: t("containerNo"),
      minWidth: 150,
      renderCell: (params) => <span className="cell--mono">{params.row.containerNo || "-"}</span>
    },
    {
      field: "originalQty",
      headerName: t("receivedQty"),
      minWidth: 110,
      type: "number"
    },
    {
      field: "remainingQty",
      headerName: t("remainingQty"),
      minWidth: 120,
      type: "number"
    },
    {
      field: "state",
      headerName: t("status"),
      minWidth: 120,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <Chip
          size="small"
          label={params.row.remainingQty > 0 ? t("receiptLotOpen") : t("receiptLotClosed")}
          color={params.row.remainingQty > 0 ? "success" : "default"}
          variant={params.row.remainingQty > 0 ? "filled" : "outlined"}
        />
      )
    },
    {
      field: "links",
      headerName: t("lotLinks"),
      minWidth: 100,
      sortable: false,
      filterable: false,
      renderCell: (params) => params.row.links.length
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
      minWidth: 140,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <Button
          size="small"
          variant="text"
          startIcon={<VisibilityOutlinedIcon fontSize="small" />}
          onClick={() => setSelectedLot(params.row)}
        >
          {t("viewTrace")}
        </Button>
      )
    }
  ], [resolvedTimeZone, t]);

  return (
    <main className="workspace-main">
      <section className="workbook-panel workbook-panel--full">
        <WorkspacePanelHeader
          title={t("receiptLotTrace")}
          description={t("receiptLotTraceDesc")}
          errorMessage={errorMessage}
          actions={(
            <Button
              size="small"
              variant="outlined"
              startIcon={<RefreshOutlinedIcon fontSize="small" />}
              onClick={() => {
                setSearchTerm((current) => current.trim());
                setIsLoading(true);
                void api.getReceiptLots(500, normalizedSearch).then((nextLots) => {
                  setReceiptLots(nextLots);
                  setErrorMessage("");
                }).catch((error) => {
                  setErrorMessage(getErrorMessage(error, t("couldNotLoadReport")));
                }).finally(() => setIsLoading(false));
              }}
            >
              {t("refresh")}
            </Button>
          )}
        />

        <div className="report-card-grid" style={{ marginBottom: "1rem" }}>
          <article className="metric-card">
            <span>{t("recordCount")}</span>
            <strong>{receiptLots.length}</strong>
          </article>
          <article className="metric-card">
            <span>{t("receiptLotOpenLots")}</span>
            <strong>{openLots}</strong>
          </article>
          <article className="metric-card">
            <span>{t("receiptLotClosedLots")}</span>
            <strong>{closedLots}</strong>
          </article>
          <article className="metric-card">
            <span>{t("receiptLotLinkedMovements")}</span>
            <strong>{linkedMovements}</strong>
          </article>
        </div>

        <div className="filter-bar">
          <label>
            {t("search")}
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder={t("receiptLotSearchPlaceholder")}
            />
          </label>
        </div>

        <div className="sheet-table-wrap">
          <Box sx={{ minWidth: 0 }}>
            <DataGrid
              rows={receiptLots}
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
        open={Boolean(selectedLot)}
        onClose={(_, reason) => {
          if (reason === "backdropClick") return;
          setSelectedLot(null);
        }}
        fullWidth
        maxWidth="lg"
      >
        <DialogTitle sx={{ pb: 1 }}>
          {selectedLot ? `${t("receiptLotTrace")} #${selectedLot.id}` : t("receiptLotTrace")}
          <IconButton aria-label={t("close")} onClick={() => setSelectedLot(null)} sx={{ position: "absolute", right: 16, top: 16 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {selectedLot ? (
            <>
              <div className="sheet-form">
                <div className="sheet-note"><strong>{t("parentReceiptLot")}</strong><br />{selectedLot.parentReceiptLotId || "-"}</div>
                <div className="sheet-note"><strong>{t("sourceInboundDocument")}</strong><br />{selectedLot.sourceInboundDocumentId}</div>
                <div className="sheet-note"><strong>{t("sourceInboundLine")}</strong><br />{selectedLot.sourceInboundLineId}</div>
                <div className="sheet-note"><strong>{t("itemNumber")}</strong><br />{selectedLot.itemNumber || "-"}</div>
                <div className="sheet-note"><strong>{t("sku")}</strong><br />{selectedLot.sku || "-"}</div>
                <div className="sheet-note"><strong>{t("customer")}</strong><br />{selectedLot.customerName || "-"}</div>
                <div className="sheet-note"><strong>{t("currentStorage")}</strong><br />{selectedLot.locationName || "-"}</div>
                <div className="sheet-note"><strong>{t("storageSection")}</strong><br />{selectedLot.storageSection || "-"}</div>
                <div className="sheet-note"><strong>{t("containerNo")}</strong><br />{selectedLot.containerNo || "-"}</div>
                <div className="sheet-note"><strong>{t("receivedQty")}</strong><br />{selectedLot.originalQty}</div>
                <div className="sheet-note"><strong>{t("remainingQty")}</strong><br />{selectedLot.remainingQty}</div>
                <div className="sheet-note"><strong>{t("updated")}</strong><br />{formatDateTimeValue(selectedLot.updatedAt, resolvedTimeZone)}</div>
              </div>

              <div className="sheet-note" style={{ marginTop: "1rem" }}>
                <strong>{t("lotLinks")}</strong>
                {selectedLot.links.length === 0 ? (
                  <div style={{ marginTop: "0.75rem" }}>{t("receiptLotNoLinks")}</div>
                ) : (
                  <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.75rem" }}>
                    {selectedLot.links.map((link) => (
                      <div key={link.id} className="sheet-note" style={{ margin: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                          <strong>{link.movementType} #{link.movementId}</strong>
                          <span className="cell--mono">{t("linkType")}: {link.linkType}</span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.75rem", marginTop: "0.75rem" }}>
                          <div><strong>{t("linkedQty")}</strong><br />{link.linkedQty}</div>
                          <div><strong>{t("qtyChange")}</strong><br />{link.quantityChange}</div>
                          <div><strong>{t("storageSection")}</strong><br />{link.storageSection || "-"}</div>
                          <div><strong>{t("containerNo")}</strong><br />{link.containerNo || "-"}</div>
                          <div><strong>{t("created")}</strong><br />{formatDateTimeValue(link.createdAt, resolvedTimeZone)}</div>
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

function getErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof ApiError || error instanceof Error) {
    return error.message || fallbackMessage;
  }
  return fallbackMessage;
}
