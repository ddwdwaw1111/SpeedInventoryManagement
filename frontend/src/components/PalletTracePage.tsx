import CloseIcon from "@mui/icons-material/Close";
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { Box, Button, Chip, Dialog, DialogContent, DialogTitle, IconButton } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { useEffect, useMemo, useState } from "react";

import { api } from "../lib/api";
import { formatDateTimeValue, formatDateValue } from "../lib/dates";
import { getErrorMessage } from "../lib/errors";
import { setPendingInventoryActionContext } from "../lib/inventoryActionContext";
import { buildInventoryActionSourceKey } from "../lib/inventoryActionSources";
import { useI18n } from "../lib/i18n";
import { consumePendingPalletTraceLaunchContext } from "../lib/palletTraceLaunchContext";
import { useSettings } from "../lib/settings";
import type { Customer, Location, PalletTrace, UserRole } from "../lib/types";
import { SearchSubmitField } from "./SearchSubmitField";
import { buildWorkspaceGridSlots, InventoryViewSwitcher, WorkspacePanelHeader } from "./WorkspacePanelChrome";

const PALLET_TRACE_LOAD_LIMIT = 50000;
type PalletStatusFilter = "ALL" | "OPEN" | "PARTIAL" | "SHIPPED" | "CANCELLED";

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
  const [submittedSearchTerm, setSubmittedSearchTerm] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("all");
  const [selectedLocationId, setSelectedLocationId] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState<PalletStatusFilter>("ALL");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [sourceInboundDocumentIdFilter, setSourceInboundDocumentIdFilter] = useState<number | null>(null);
  const [selectedPallet, setSelectedPallet] = useState<PalletTrace | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const normalizedSearch = submittedSearchTerm.trim().toLowerCase();
  const canManageInventory = currentUserRole === "admin" || currentUserRole === "operator";

  useEffect(() => {
    const pendingContext = consumePendingPalletTraceLaunchContext();
    if (pendingContext?.sourceInboundDocumentId && pendingContext.sourceInboundDocumentId > 0) {
      setSourceInboundDocumentIdFilter(pendingContext.sourceInboundDocumentId);
    }
    if (pendingContext?.searchTerm?.trim()) {
      const nextSearchTerm = pendingContext.searchTerm.trim();
      setSearchTerm(nextSearchTerm);
      setSubmittedSearchTerm(nextSearchTerm);
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function loadFilterOptions() {
      try {
        const [nextCustomers, nextLocations] = await Promise.all([
          api.getCustomers(),
          api.getLocations()
        ]);
        if (!active) return;
        setCustomers(nextCustomers);
        setLocations(nextLocations);
      } catch {
        if (!active) return;
        setCustomers([]);
        setLocations([]);
      }
    }

    void loadFilterOptions();
    return () => {
      active = false;
    };
  }, []);

  const palletQuery = useMemo(() => ({
    search: normalizedSearch,
    sourceInboundDocumentId: sourceInboundDocumentIdFilter ?? undefined,
    customerId: selectedCustomerId === "all" ? undefined : Number(selectedCustomerId),
    locationId: selectedLocationId === "all" ? undefined : Number(selectedLocationId),
    status: selectedStatus === "ALL" ? undefined : selectedStatus
  }), [normalizedSearch, selectedCustomerId, selectedLocationId, selectedStatus, sourceInboundDocumentIdFilter]);

  useEffect(() => {
    let active = true;

    async function loadPallets() {
      setIsLoading(true);
      setErrorMessage("");
      try {
        const nextPallets = await api.getPallets(PALLET_TRACE_LOAD_LIMIT, palletQuery);
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
  }, [palletQuery, reloadToken, t]);

  const customerOptions = useMemo(() => {
    if (customers.length > 0) {
      return customers
        .map((customer) => ({ id: customer.id, name: customer.name || String(customer.id) }))
        .sort((left, right) => left.name.localeCompare(right.name));
    }

    const options = new Map<number, string>();
    for (const pallet of pallets) {
      options.set(pallet.customerId, pallet.customerName || String(pallet.customerId));
    }
    return [...options.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [customers, pallets]);

  const locationOptions = useMemo(() => {
    if (locations.length > 0) {
      return locations
        .map((location) => ({ id: location.id, name: location.name || String(location.id) }))
        .sort((left, right) => left.name.localeCompare(right.name));
    }

    const options = new Map<number, string>();
    for (const pallet of pallets) {
      options.set(pallet.currentLocationId, pallet.currentLocationName || String(pallet.currentLocationId));
    }
    return [...options.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [locations, pallets]);

  const filteredPallets = useMemo(() => pallets.filter((pallet) => (
    palletMatchesSearch(pallet, normalizedSearch)
    && (selectedCustomerId === "all" || pallet.customerId === Number(selectedCustomerId))
    && (selectedLocationId === "all" || pallet.currentLocationId === Number(selectedLocationId))
    && (selectedStatus === "ALL" || pallet.status === selectedStatus)
  )), [normalizedSearch, pallets, selectedCustomerId, selectedLocationId, selectedStatus]);

  const openPallets = useMemo(
    () => filteredPallets.filter((pallet) => pallet.status === "OPEN" || pallet.status === "PARTIAL").length,
    [filteredPallets]
  );
  const shippedPallets = useMemo(
    () => filteredPallets.filter((pallet) => pallet.status === "SHIPPED").length,
    [filteredPallets]
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

  function submitSearchTerm() {
    const nextSearchTerm = searchTerm.trim();
    setSearchTerm(nextSearchTerm);
    setSubmittedSearchTerm(nextSearchTerm);
  }

  function refreshPallets() {
    submitSearchTerm();
    setReloadToken((current) => current + 1);
  }

  const hasActiveFilters = normalizedSearch.length > 0
    || selectedCustomerId !== "all"
    || selectedLocationId !== "all"
    || selectedStatus !== "ALL"
    || Boolean(sourceInboundDocumentIdFilter);

  const mainGridSlots = buildWorkspaceGridSlots({
    emptyTitle: t("noPallets"),
    emptyDescription: hasActiveFilters ? t("filteredStateHint") : t("palletTraceDesc"),
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
                onClick={refreshPallets}
              >
                {t("refresh")}
              </Button>
            </div>
          )}
        />

        {onNavigate ? <InventoryViewSwitcher activeView="pallet-trace" onNavigate={onNavigate} /> : null}

        <div className="pallet-trace-summary-strip">
          <article className="pallet-trace-summary-card">
            <strong>{filteredPallets.length}</strong>
            <span>{t("recordCount")}</span>
          </article>
          <article className="pallet-trace-summary-card">
            <strong>{openPallets}</strong>
            <span>{t("palletOpenCount")}</span>
          </article>
          <article className="pallet-trace-summary-card">
            <strong>{shippedPallets}</strong>
            <span>{t("palletShippedCount")}</span>
          </article>
        </div>

        <div className="filter-bar">
          <SearchSubmitField
            label={t("search")}
            value={searchTerm}
            onChange={setSearchTerm}
            onSubmit={submitSearchTerm}
            placeholder={t("palletSearchPlaceholder")}
            submitTitle={`${t("search")} (Enter)`}
          />
          <label>
            {t("customer")}
            <select value={selectedCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)}>
              <option value="all">{t("allCustomers")}</option>
              {customerOptions.map((customer) => (
                <option key={customer.id} value={customer.id}>{customer.name}</option>
              ))}
            </select>
          </label>
          <label>
            {t("currentStorage")}
            <select value={selectedLocationId} onChange={(event) => setSelectedLocationId(event.target.value)}>
              <option value="all">{t("allStorage")}</option>
              {locationOptions.map((location) => (
                <option key={location.id} value={location.id}>{location.name}</option>
              ))}
            </select>
          </label>
          <label>
            {t("status")}
            <select value={selectedStatus} onChange={(event) => setSelectedStatus(event.target.value as PalletStatusFilter)}>
              <option value="ALL">{t("allRows")}</option>
              <option value="OPEN">{t("palletOpen")}</option>
              <option value="PARTIAL">{t("palletPartial")}</option>
              <option value="SHIPPED">{t("palletShipped")}</option>
              <option value="CANCELLED">{t("palletCancelled")}</option>
            </select>
          </label>
        </div>

        <div className="sheet-table-wrap">
          <Box sx={{ minWidth: 0 }}>
            <DataGrid
              rows={filteredPallets}
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

function palletMatchesSearch(pallet: PalletTrace, normalizedSearch: string) {
  if (!normalizedSearch) {
    return true;
  }

  const searchableText = [
    pallet.palletCode,
    pallet.customerName,
    pallet.sku,
    pallet.description,
    pallet.currentLocationName,
    pallet.currentStorageSection,
    pallet.currentContainerNo,
    String(pallet.sourceInboundDocumentId),
    String(pallet.sourceInboundLineId),
    ...pallet.contents.flatMap((content) => [
      content.itemNumber,
      content.sku,
      content.description
    ])
  ].join(" ").toLowerCase();

  return searchableText.includes(normalizedSearch);
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
