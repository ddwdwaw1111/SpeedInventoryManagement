import CloseIcon from "@mui/icons-material/Close";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import MoveToInboxOutlinedIcon from "@mui/icons-material/MoveToInboxOutlined";
import OutboxOutlinedIcon from "@mui/icons-material/OutboxOutlined";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";
import CompareArrowsOutlinedIcon from "@mui/icons-material/CompareArrowsOutlined";
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Box, Button, Chip, Drawer, IconButton } from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";

import { consumePendingAllActivityContext } from "../lib/allActivityContext";
import { formatDateTimeValue, formatDateValue, parseDateValue } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import type { PageKey } from "../lib/routes";
import { useSettings } from "../lib/settings";
import { normalizeStorageSection, type Customer, type Location, type Movement, type UserRole } from "../lib/types";
import { buildWorkspaceGridSlots, InventoryViewSwitcher, WorkspacePanelHeader } from "./WorkspacePanelChrome";
import { useSharedColumnOrder } from "./useSharedColumnOrder";

type AllActivityPageProps = {
  movements: Movement[];
  customers: Customer[];
  locations: Location[];
  currentUserRole: UserRole;
  isLoading: boolean;
  onNavigate: (page: PageKey) => void;
};

type MovementTypeFilter = "ALL" | Movement["movementType"];

const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
const ALL_ACTIVITY_COLUMN_ORDER_PREFERENCE_KEY = "all-activity.column-order";

export function AllActivityPage({ movements, customers, locations, currentUserRole, isLoading, onNavigate }: AllActivityPageProps) {
  const { t } = useI18n();
  const { resolvedTimeZone } = useSettings();
  const canConfigureColumns = currentUserRole === "admin";
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("all");
  const [selectedLocationId, setSelectedLocationId] = useState("all");
  const [movementTypeFilter, setMovementTypeFilter] = useState<MovementTypeFilter>("ALL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedMovementId, setSelectedMovementId] = useState<number | null>(null);
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const selectedLocationName = selectedLocationId === "all"
    ? null
    : (locations.find((location) => location.id === Number(selectedLocationId))?.name ?? null);

  const normalizedSearch = deferredSearchTerm.trim().toLowerCase();
  const filteredRows = useMemo(() => movements
    .filter((movement) => {
      const searchBlob = [
        movement.sku,
        movement.description,
        movement.customerName,
        movement.locationName,
        movement.storageSection,
        movement.containerNo,
        movement.packingListNo,
        movement.orderRef,
        movement.itemNumber,
        movement.referenceCode,
        movement.documentNote,
        movement.reason
      ].join(" ").toLowerCase();

      const matchesSearch = normalizedSearch.length === 0 || searchBlob.includes(normalizedSearch);
      const matchesCustomer = selectedCustomerId === "all" || movement.customerId === Number(selectedCustomerId);
      const matchesLocation = selectedLocationName === null || movement.locationName === selectedLocationName;
      const matchesType = movementTypeFilter === "ALL" || movement.movementType === movementTypeFilter;
      const matchesDate = isWithinDateRange(getMovementActivityDateValue(movement), startDate, endDate);

      return matchesSearch && matchesCustomer && matchesLocation && matchesType && matchesDate;
    })
    .sort((left, right) => getMovementSortTimestamp(right) - getMovementSortTimestamp(left)), [
    deferredSearchTerm,
    endDate,
    movementTypeFilter,
    movements,
    normalizedSearch,
    selectedCustomerId,
    selectedLocationId,
    selectedLocationName,
    startDate
  ]);
  const selectedMovement = useMemo(
    () => filteredRows.find((movement) => movement.id === selectedMovementId) ?? null,
    [filteredRows, selectedMovementId]
  );
  const hasActiveFilters = normalizedSearch.length > 0 || selectedCustomerId !== "all" || selectedLocationId !== "all" || movementTypeFilter !== "ALL" || startDate.length > 0 || endDate.length > 0;
  const mainGridSlots = buildWorkspaceGridSlots({
    emptyTitle: t("noResults"),
    emptyDescription: hasActiveFilters ? t("filteredStateHint") : t("emptyStateHint"),
    loadingTitle: t("loadingRecords"),
    loadingDescription: t("allActivityDesc")
  });

  useEffect(() => {
    const context = consumePendingAllActivityContext();
    if (!context) {
      return;
    }

    setSearchTerm(context.searchTerm ?? "");
    setSelectedCustomerId(context.customerId ? String(context.customerId) : "all");
    setSelectedLocationId(context.locationId ? String(context.locationId) : "all");
    setMovementTypeFilter(context.movementType ?? "ALL");
    setSelectedMovementId(null);
  }, []);

  useEffect(() => {
    if (selectedMovementId !== null && !selectedMovement) {
      setSelectedMovementId(null);
    }
  }, [selectedMovement, selectedMovementId]);

  const baseColumns = useMemo<GridColDef<Movement>[]>(() => [
    {
      field: "activityDate",
      headerName: t("activityDate"),
      minWidth: 170,
      flex: 0.9,
      sortable: false,
      renderCell: (params) => formatMovementActivityDate(params.row, resolvedTimeZone)
    },
    {
      field: "movementType",
      headerName: t("movementType"),
      minWidth: 140,
      flex: 0.8,
      renderCell: (params) => renderMovementType(params.row.movementType, t)
    },
    { field: "sku", headerName: t("sku"), minWidth: 120, flex: 0.8, renderCell: (params) => <span className="cell--mono">{params.row.sku}</span> },
    { field: "description", headerName: t("description"), minWidth: 240, flex: 1.5, renderCell: (params) => params.row.description },
    { field: "customerName", headerName: t("customer"), minWidth: 170, flex: 1 },
    { field: "locationName", headerName: t("currentStorage"), minWidth: 170, flex: 1 },
    { field: "storageSection", headerName: t("storageSection"), minWidth: 110, flex: 0.7, renderCell: (params) => normalizeStorageSection(params.row.storageSection) },
    {
      field: "quantityChange",
      headerName: t("qtyChange"),
      minWidth: 120,
      type: "number",
      flex: 0.8,
      renderCell: (params) => (
        <span style={{
          color: params.row.quantityChange >= 0 ? "#3c6e71" : "#b76857",
          fontWeight: 700
        }}
        >
          {formatSignedNumber(params.row.quantityChange)}
        </span>
      )
    },
    { field: "containerNo", headerName: t("containerNo"), minWidth: 170, flex: 1, renderCell: (params) => <span className="cell--mono">{params.row.containerNo || "-"}</span> },
    { field: "packingListNo", headerName: t("packingListNo"), minWidth: 170, flex: 1, renderCell: (params) => <span className="cell--mono">{params.row.packingListNo || "-"}</span> },
    { field: "orderRef", headerName: t("orderRef"), minWidth: 150, flex: 0.9, renderCell: (params) => <span className="cell--mono">{params.row.orderRef || "-"}</span> },
    { field: "referenceCode", headerName: t("reference"), minWidth: 150, flex: 0.9, renderCell: (params) => <span className="cell--mono">{params.row.referenceCode || "-"}</span> },
    { field: "reason", headerName: t("notes"), minWidth: 260, flex: 1.4, renderCell: (params) => params.row.reason || "-" },
    {
      field: "createdAt",
      headerName: t("created"),
      minWidth: 190,
      flex: 1,
      renderCell: (params) => formatDateTimeValue(params.row.createdAt, resolvedTimeZone)
    }
  ], [resolvedTimeZone, t]);
  const {
    columns,
    columnOrderAction,
    columnOrderDialog
  } = useSharedColumnOrder({
    preferenceKey: ALL_ACTIVITY_COLUMN_ORDER_PREFERENCE_KEY,
    baseColumns,
    canManage: canConfigureColumns
  });

  return (
      <main className="workspace-main">
        <section className="workbook-panel workbook-panel--full">
          <div className="tab-strip">
            <WorkspacePanelHeader title={t("allActivity")} actions={columnOrderAction} />
            <div className="filter-bar">
              <label>{t("search")}<input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder={t("allActivitySearchPlaceholder")} /></label>
            <label>{t("customer")}<select value={selectedCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)}><option value="all">{t("allCustomers")}</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
            <label>{t("currentStorage")}<select value={selectedLocationId} onChange={(event) => setSelectedLocationId(event.target.value)}><option value="all">{t("allStorage")}</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
            <label>{t("movementType")}<select value={movementTypeFilter} onChange={(event) => setMovementTypeFilter(event.target.value as MovementTypeFilter)}><option value="ALL">{t("allRows")}</option><option value="IN">{t("inbound")}</option><option value="OUT">{t("outbound")}</option><option value="ADJUST">{t("adjustment")}</option><option value="COUNT">{t("cycleCount")}</option><option value="REVERSAL">{t("reversal")}</option><option value="TRANSFER_IN">{t("transferIn")}</option><option value="TRANSFER_OUT">{t("transferOut")}</option></select></label>
            <label>{t("fromDate")}<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
            <label>{t("toDate")}<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
          </div>
        </div>
        <InventoryViewSwitcher activeView="all-activity" onNavigate={onNavigate} />

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
              onRowClick={(params) => setSelectedMovementId(params.row.id)}
              getRowClassName={(params) => (params.row.id === selectedMovementId ? "document-row--selected" : "")}
              slots={mainGridSlots}
              sx={{ border: 0 }}
            />
          </Box>
        </div>
      </section>
      {columnOrderDialog}

      <Drawer
        anchor="right"
        open={Boolean(selectedMovement)}
        onClose={() => setSelectedMovementId(null)}
        PaperProps={{ className: "document-drawer" }}
      >
        {selectedMovement ? (
          <div className="document-drawer__content">
            <div className="document-drawer__header">
              <div>
                <div className="document-drawer__eyebrow">{t("allActivity")}</div>
                <h3>{selectedMovement.sku}</h3>
                <p>{selectedMovement.description} | {selectedMovement.customerName} | {selectedMovement.locationName} / {normalizeStorageSection(selectedMovement.storageSection)}</p>
              </div>
              <IconButton aria-label={t("close")} onClick={() => setSelectedMovementId(null)}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </div>

            <div className="document-drawer__actions">
              {renderMovementSourceAction(selectedMovement, t, onNavigate)}
              <Button variant="outlined" startIcon={<HistoryOutlinedIcon fontSize="small" />} onClick={() => onNavigate("all-activity")}>
                {t("allActivity")}
              </Button>
            </div>

            <div className="document-drawer__status-bar">
              <div className="document-drawer__status-main">
                {renderMovementType(selectedMovement.movementType, t)}
              </div>
              <div className="document-drawer__status-stat">
                <strong>{formatSignedNumber(selectedMovement.quantityChange)}</strong>
                <span>{t("qtyChange")}</span>
              </div>
              <div className="document-drawer__status-stat">
                <strong>{selectedMovement.customerName || "-"}</strong>
                <span>{t("customer")}</span>
              </div>
              <div className="document-drawer__status-stat">
                <strong>{selectedMovement.locationName}</strong>
                <span>{t("currentStorage")}</span>
              </div>
            </div>

            <div className="document-drawer__audit-strip">
              <div className="document-drawer__audit-item">
                <strong>{t("created")}</strong>
                <span>{formatDateTimeValue(selectedMovement.createdAt, resolvedTimeZone)}</span>
              </div>
              <div className="document-drawer__audit-item">
                <strong>{t("activityDate")}</strong>
                <span>{formatMovementActivityDate(selectedMovement, resolvedTimeZone)}</span>
              </div>
              <div className="document-drawer__audit-item">
                <strong>{t("status")}</strong>
                <span>{selectedMovement.movementType}</span>
              </div>
            </div>

            <div className="document-drawer__meta">
              <div className="sheet-note">
                <strong>{t("movementType")}</strong><br />
                {selectedMovement.movementType}
              </div>
              <div className="sheet-note">
                <strong>{t("activityDate")}</strong><br />
                {formatMovementActivityDate(selectedMovement, resolvedTimeZone)}
              </div>
              <div className="sheet-note">
                <strong>{t("containerNo")}</strong><br />
                <span className="cell--mono">{selectedMovement.containerNo || "-"}</span>
              </div>
              <div className="sheet-note">
                <strong>{t("packingListNo")}</strong><br />
                <span className="cell--mono">{selectedMovement.packingListNo || "-"}</span>
              </div>
              <div className="sheet-note">
                <strong>{t("reference")}</strong><br />
                <span className="cell--mono">{selectedMovement.referenceCode || "-"}</span>
              </div>
              <div className="sheet-note">
                <strong>{t("orderRef")}</strong><br />
                <span className="cell--mono">{selectedMovement.orderRef || "-"}</span>
              </div>
              <div className="sheet-note document-drawer__meta-note">
                <strong>{t("notes")}</strong><br />
                {selectedMovement.reason || selectedMovement.documentNote || "-"}
              </div>
            </div>
          </div>
        ) : null}
      </Drawer>
    </main>
  );
}

function renderMovementSourceAction(
  movement: Movement,
  t: (key: string) => string,
  onNavigate: (page: PageKey) => void
) {
  if (movement.inboundDocumentId > 0) {
    return (
      <Button variant="outlined" startIcon={<MoveToInboxOutlinedIcon fontSize="small" />} onClick={() => onNavigate("inbound-management")}>
        {t("inbound")}
      </Button>
    );
  }

  if (movement.outboundDocumentId > 0) {
    return (
      <Button variant="outlined" startIcon={<OutboxOutlinedIcon fontSize="small" />} onClick={() => onNavigate("outbound-management")}>
        {t("outbound")}
      </Button>
    );
  }

  if (movement.movementType === "ADJUST") {
    return (
      <Button variant="outlined" startIcon={<TuneOutlinedIcon fontSize="small" />} onClick={() => onNavigate("adjustments")}>
        {t("adjustments")}
      </Button>
    );
  }

  if (movement.movementType === "COUNT") {
    return (
      <Button variant="outlined" startIcon={<FactCheckOutlinedIcon fontSize="small" />} onClick={() => onNavigate("cycle-counts")}>
        {t("cycleCounts")}
      </Button>
    );
  }

  if (movement.movementType === "TRANSFER_IN" || movement.movementType === "TRANSFER_OUT") {
    return (
      <Button variant="outlined" startIcon={<CompareArrowsOutlinedIcon fontSize="small" />} onClick={() => onNavigate("transfers")}>
        {t("transfers")}
      </Button>
    );
  }

  return null;
}

function renderMovementType(movementType: Movement["movementType"], t: (key: string) => string) {
  if (movementType === "IN") {
    return <Chip label={t("inbound")} color="success" size="small" />;
  }

  if (movementType === "OUT") {
    return <Chip label={t("outbound")} color="error" size="small" />;
  }

  if (movementType === "REVERSAL") {
    return <Chip label={t("reversal")} color="info" size="small" />;
  }

  if (movementType === "COUNT") {
    return <Chip label={t("cycleCount")} color="warning" size="small" />;
  }

  if (movementType === "TRANSFER_IN") {
    return <Chip label={t("transferIn")} color="success" size="small" />;
  }

  if (movementType === "TRANSFER_OUT") {
    return <Chip label={t("transferOut")} color="default" size="small" />;
  }

  return <Chip label={t("adjustment")} color="warning" size="small" />;
}

function getMovementActivityDateValue(movement: Movement) {
  return movement.outDate || movement.deliveryDate || movement.createdAt;
}

function getMovementSortTimestamp(movement: Movement) {
  const value = getMovementActivityDateValue(movement);
  if (!value) {
    return 0;
  }

  const parsed = parseDateValue(value);
  const timestamp = parsed.getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function formatMovementActivityDate(movement: Movement, resolvedTimeZone: string) {
  if (movement.outDate) {
    return formatDateValue(movement.outDate, dateFormatter);
  }

  if (movement.deliveryDate) {
    return formatDateValue(movement.deliveryDate, dateFormatter);
  }

  return formatDateTimeValue(movement.createdAt, resolvedTimeZone);
}

function isWithinDateRange(value: string | null | undefined, startDate: string, endDate: string) {
  if (!value) {
    return false;
  }

  const timestamp = parseDateValue(value).getTime();
  if (Number.isNaN(timestamp)) {
    return false;
  }

  const start = startDate ? parseDateValue(startDate).getTime() : null;
  const end = endDate ? endOfDay(parseDateValue(endDate)).getTime() : null;

  if (start !== null && timestamp < start) {
    return false;
  }

  if (end !== null && timestamp > end) {
    return false;
  }

  return true;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function formatSignedNumber(value: number) {
  return `${value >= 0 ? "+" : ""}${new Intl.NumberFormat("en-US").format(value)}`;
}
