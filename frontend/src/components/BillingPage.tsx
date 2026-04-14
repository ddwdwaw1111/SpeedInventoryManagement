import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import ExpandMoreOutlinedIcon from "@mui/icons-material/ExpandMoreOutlined";
import ExpandLessOutlinedIcon from "@mui/icons-material/ExpandLessOutlined";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";
import { Button, Chip, Divider, ListItemIcon, ListItemText, Menu, MenuItem } from "@mui/material";
import { BarChart } from "@mui/x-charts";
import { useEffect, useMemo, useState } from "react";

import { ApiError, api } from "../lib/api";
import { setBillingWorkspaceContext } from "../lib/billingWorkspaceContext";
import {
  buildBillingPreview,
  DEFAULT_BILLING_RATES,
  getCurrentBillingDateRange,
  type BillingInvoiceLine,
  type BillingRates,
  type BillingStorageRow
} from "../lib/billingPreview";
import { downloadBillingPreviewPdf } from "../lib/billingPreviewPdf";
import { formatDateTimeValue } from "../lib/dates";
import { downloadExcelWorkbook, type ExcelExportCell, type ExcelExportColumn } from "../lib/excelExport";
import { useI18n } from "../lib/i18n";
import { useSettings } from "../lib/settings";
import type {
  BillingExportMode,
  BillingInvoice,
  BillingInvoiceStatus,
  BillingInvoiceType,
  ContainerType,
  CreateBillingInvoicePayload,
  Customer,
  InboundDocument,
  Location,
  OutboundDocument,
  PalletLocationEvent,
  PalletTrace,
  UserRole
} from "../lib/types";
import { ExportExcelDialog } from "./ExportExcelDialog";
import { WorkspacePanelHeader, WorkspaceTableEmptyState } from "./WorkspacePanelChrome";

type BillingPageProps = {
  customers: Customer[];
  locations: Location[];
  inboundDocuments: InboundDocument[];
  outboundDocuments: OutboundDocument[];
  currentUserRole: UserRole;
  onOpenBillingContainerDetail: (
    startDate: string,
    endDate: string,
    customerId: number | "all",
    containerNo: string,
    warehouseLocationId?: number | "all"
  ) => void;
  onOpenBillingInvoice: (invoiceId: number) => void;
};

type BillingContainerSummaryRow = {
  customerId: number;
  customerName: string;
  containerNo: string;
  references: string[];
  warehousesTouched: string[];
  inboundAmount: number;
  wrappingAmount: number;
  storageAmount: number;
  outboundAmount: number;
  totalAmount: number;
};

type BillingWorkspaceMode = "OVERVIEW" | "STORAGE_SETTLEMENT";

const BILLING_EXPORT_SHEET_NAME = "Billing Preview";

export function BillingPage({
  customers,
  locations,
  inboundDocuments,
  outboundDocuments,
  currentUserRole,
  onOpenBillingContainerDetail,
  onOpenBillingInvoice
}: BillingPageProps) {
  const { t } = useI18n();
  const { resolvedTimeZone } = useSettings();
  const [selectedStartDate, setSelectedStartDate] = useState(() => getCurrentBillingDateRange().startDate);
  const [selectedEndDate, setSelectedEndDate] = useState(() => getCurrentBillingDateRange().endDate);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("all");
  const [selectedWarehouseLocationId, setSelectedWarehouseLocationId] = useState<string>("all");
  const [selectedContainerType, setSelectedContainerType] = useState<ContainerType | "all">("all");
  const [workspaceMode, setWorkspaceMode] = useState<BillingWorkspaceMode>("OVERVIEW");
  const [rates, setRates] = useState<BillingRates>(DEFAULT_BILLING_RATES);
  const [pallets, setPallets] = useState<PalletTrace[]>([]);
  const [palletLocationEvents, setPalletLocationEvents] = useState<PalletLocationEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [invoices, setInvoices] = useState<BillingInvoice[]>([]);
  const [isCreatingInvoice, setIsCreatingInvoice] = useState(false);
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<BillingInvoiceStatus | "ALL">("ALL");
  const [showDetailSections, setShowDetailSections] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [exportMenuAnchor, setExportMenuAnchor] = useState<HTMLElement | null>(null);
  const [containerNoFilter, setContainerNoFilter] = useState("");
  const [pendingExportMode, setPendingExportMode] = useState<BillingExportMode>("SUMMARY");

  useEffect(() => {
    let active = true;

    async function loadBillingData() {
      setIsLoading(true);
      setErrorMessage("");
      try {
        const [nextPallets, nextEvents] = await Promise.all([
          api.getPallets(50000),
          api.getPalletLocationEvents(50000)
        ]);
        if (!active) {
          return;
        }
        setPallets(nextPallets);
        setPalletLocationEvents(nextEvents);
      } catch (error) {
        if (!active) {
          return;
        }
        setErrorMessage(getErrorMessage(error, t("couldNotLoadReport")));
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void loadBillingData();
    return () => {
      active = false;
    };
  }, [t]);

  const customerId = selectedCustomerId === "all" ? "all" : Number(selectedCustomerId);
  const warehouseLocationId = selectedWarehouseLocationId === "all" ? "all" : Number(selectedWarehouseLocationId);
  const selectedWarehouse = warehouseLocationId === "all"
    ? null
    : locations.find((location) => location.id === warehouseLocationId) ?? null;
  const selectedStorageRatePerWeek = selectedContainerType === "WEST_COAST_TRANSFER"
    ? rates.storageFeePerPalletPerWeekWestCoastTransfer
    : rates.storageFeePerPalletPerWeekNormal;
  useEffect(() => {
    setBillingWorkspaceContext({
      startDate: selectedStartDate,
      endDate: selectedEndDate,
      customerId,
      warehouseLocationId,
      containerType: selectedContainerType,
      rates
    });
  }, [customerId, rates, selectedContainerType, selectedEndDate, selectedStartDate, warehouseLocationId]);

  // Load invoice history
  useEffect(() => {
    let active = true;
    async function loadInvoices() {
      try {
        const cid = customerId === "all" ? undefined : customerId;
        const data = await api.getBillingInvoices(cid);
        if (active) setInvoices(data);
      } catch {
        // silent — invoice history is secondary
      }
    }
    void loadInvoices();
    return () => { active = false; };
  }, [customerId]);

  async function handleCreateInvoice() {
    if (customerId === "all") {
      return;
    }

    const selectedCustomer = customers.find((c) => c.id === customerId);
    const customerName = selectedCustomer?.name ?? billingPreview.customerName;
    const invoiceType: BillingInvoiceType = workspaceMode === "STORAGE_SETTLEMENT" ? "STORAGE_SETTLEMENT" : "MIXED";
    const lines = invoiceType === "STORAGE_SETTLEMENT"
      ? buildStorageSettlementInvoiceLines(storageSettlementRows)
      : activeInvoiceLines.map((line) => ({
          chargeType: line.chargeType,
          description: line.meta || chargeTypeDescription(line.chargeType),
          reference: line.reference,
          containerNo: line.containerNo,
          warehouse: line.warehouseSummary,
          occurredOn: line.occurredOn ?? undefined,
          quantity: line.quantity,
          unitRate: line.unitRate,
          amount: line.amount,
          sourceType: "AUTO"
        }));

    if (lines.length === 0) {
      return;
    }

    if (invoiceType === "STORAGE_SETTLEMENT" && existingStorageSettlementInvoice) {
      setErrorMessage(t("billingStorageSettlementDuplicateError"));
      return;
    }

    setIsCreatingInvoice(true);
    setErrorMessage("");
    try {
      const payload: CreateBillingInvoicePayload = {
        invoiceType,
        customerId,
        customerName,
        warehouseLocationId: invoiceType === "STORAGE_SETTLEMENT" && warehouseLocationId !== "all" ? warehouseLocationId : null,
        warehouseName: invoiceType === "STORAGE_SETTLEMENT" ? selectedWarehouse?.name ?? "" : "",
        containerType: invoiceType === "STORAGE_SETTLEMENT" && selectedContainerType !== "all" ? selectedContainerType : null,
        periodStart: selectedStartDate,
        periodEnd: selectedEndDate,
        rates: {
          inboundContainerFee: rates.inboundContainerFee,
          wrappingFeePerPallet: rates.wrappingFeePerPallet,
          storageFeePerPalletPerWeek: rates.storageFeePerPalletPerWeek,
          storageFeePerPalletPerWeekNormal: rates.storageFeePerPalletPerWeekNormal,
          storageFeePerPalletPerWeekWestCoastTransfer: rates.storageFeePerPalletPerWeekWestCoastTransfer,
          outboundFeePerPallet: rates.outboundFeePerPallet,
        },
        lines
      };
      const created = await api.createBillingInvoice(payload);
      onOpenBillingInvoice(created.id);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, "Could not create invoice."));
    } finally {
      setIsCreatingInvoice(false);
    }
  }

  const billingPreview = useMemo(() => buildBillingPreview({
    startDate: selectedStartDate,
    endDate: selectedEndDate,
    customerId,
    customers,
    pallets,
    palletLocationEvents,
    inboundDocuments,
    outboundDocuments,
    locationId: warehouseLocationId,
    containerType: selectedContainerType,
    rates
  }), [customerId, customers, inboundDocuments, outboundDocuments, palletLocationEvents, pallets, rates, selectedContainerType, selectedEndDate, selectedStartDate, warehouseLocationId, workspaceMode]);
  const containerSummaryRows = useMemo(
    () => buildBillingContainerSummaryRows(billingPreview.invoiceLines, billingPreview.storageRows),
    [billingPreview.invoiceLines, billingPreview.storageRows]
  );
  const storageSettlementRows = useMemo(() => {
    const filter = containerNoFilter.trim().toUpperCase();
    if (!filter) {
      return billingPreview.storageRows;
    }
    return billingPreview.storageRows.filter((row) => row.containerNo.toUpperCase().includes(filter));
  }, [billingPreview.storageRows, containerNoFilter]);

  const activeInvoiceLines = useMemo(() => {
    const filter = containerNoFilter.trim().toUpperCase();
    if (!filter) return billingPreview.invoiceLines;
    return billingPreview.invoiceLines.filter((line) => line.containerNo.toUpperCase().includes(filter));
  }, [billingPreview.invoiceLines, containerNoFilter]);

  const activeContainerRows = useMemo(() => {
    const filter = containerNoFilter.trim().toUpperCase();
    if (!filter) return containerSummaryRows;
    return containerSummaryRows.filter((row) => row.containerNo.toUpperCase().includes(filter));
  }, [containerSummaryRows, containerNoFilter]);

  const activeGrandTotal = useMemo(
    () => activeInvoiceLines.reduce((sum, line) => sum + line.amount, 0),
    [activeInvoiceLines]
  );
  const storageSettlementTotal = useMemo(
    () => storageSettlementRows.reduce((sum, row) => sum + row.amount, 0),
    [storageSettlementRows]
  );
  const storageSettlementTrackedPallets = useMemo(
    () => storageSettlementRows.reduce((sum, row) => sum + row.palletsTracked, 0),
    [storageSettlementRows]
  );

  const dailyBalanceDataset = useMemo(
    () => billingPreview.dailyBalanceRows.map((row) => ({
      label: row.date.slice(-2),
      palletCount: row.palletCount
    })),
    [billingPreview.dailyBalanceRows]
  );

  const filteredInvoices = useMemo(() => {
    if (invoiceStatusFilter === "ALL") return invoices;
    return invoices.filter((inv) => inv.status === invoiceStatusFilter);
  }, [invoices, invoiceStatusFilter]);

  const invoiceStatusCounts = useMemo(() => {
    const counts = { DRAFT: 0, FINALIZED: 0, PAID: 0, VOID: 0 };
    for (const inv of invoices) {
      if (inv.status in counts) counts[inv.status as keyof typeof counts]++;
    }
    return counts;
  }, [invoices]);

  const existingStorageSettlementInvoice = useMemo(
    () => customerId === "all"
      ? null
      : invoices.find((invoice) =>
          invoice.invoiceType === "STORAGE_SETTLEMENT" &&
          invoice.customerId === customerId &&
          (invoice.warehouseLocationId ?? null) === (warehouseLocationId === "all" ? null : warehouseLocationId) &&
          (invoice.containerType || "") === (selectedContainerType === "all" ? "" : selectedContainerType) &&
          invoice.periodStart === selectedStartDate &&
          invoice.periodEnd === selectedEndDate &&
          invoice.status !== "VOID"
        ) ?? null,
    [customerId, invoices, selectedContainerType, selectedEndDate, selectedStartDate, warehouseLocationId]
  );
  const canCreateMixedInvoice = customerId !== "all" && activeInvoiceLines.length > 0;
  const canCreateStorageInvoice =
    customerId !== "all" &&
    selectedContainerType !== "all" &&
    storageSettlementRows.length > 0 &&
    existingStorageSettlementInvoice === null;
  const canCreateInvoice = workspaceMode === "STORAGE_SETTLEMENT" ? canCreateStorageInvoice : canCreateMixedInvoice;
  const hasBillablePreview = workspaceMode === "STORAGE_SETTLEMENT"
    ? storageSettlementRows.length > 0
    : activeInvoiceLines.length > 0;
  const exportTitle = useMemo(
    () => buildBillingExportTitle(
      workspaceMode === "STORAGE_SETTLEMENT" ? t("billingStorageSettlementTitle") : t("billingPage"),
      billingPreview.customerName,
      billingPreview.startDate,
      billingPreview.endDate,
      pendingExportMode,
      warehouseLocationId === "all" ? undefined : selectedWarehouse?.name ?? t("billingAllWarehouses"),
      selectedContainerType !== "all" ? containerTypeLabel(selectedContainerType, t) : undefined
    ),
    [billingPreview.customerName, billingPreview.endDate, billingPreview.startDate, pendingExportMode, selectedContainerType, selectedWarehouse?.name, t, workspaceMode]
  );
  const exportColumns = useMemo<ExcelExportColumn[]>(
    () => buildBillingPageExportColumns(workspaceMode, pendingExportMode, t),
    [pendingExportMode, t, workspaceMode]
  );
  const exportRows = useMemo<Array<Record<string, ExcelExportCell>>>(
    () => buildBillingPageExportRows({
      workspaceMode,
      exportMode: pendingExportMode,
      invoiceLines: activeInvoiceLines,
      storageRows: storageSettlementRows,
      timeZone: resolvedTimeZone,
      t
    }),
    [activeInvoiceLines, pendingExportMode, resolvedTimeZone, storageSettlementRows, t, workspaceMode]
  );

  function handleExportExcel({ title, columns }: { title: string; columns: ExcelExportColumn[] }) {
    downloadExcelWorkbook({
      title,
      sheetName: BILLING_EXPORT_SHEET_NAME,
      fileName: title,
      columns,
      rows: exportRows,
      summaryRows: workspaceMode === "STORAGE_SETTLEMENT"
        ? [
            { label: t("billingStorageContainers"), value: storageSettlementRows.length, numberFormat: "number" },
            { label: t("billingTrackedPallets"), value: storageSettlementTrackedPallets, numberFormat: "number" },
            { label: t("palletDays"), value: billingPreview.summary.palletDays, numberFormat: "number" },
            { label: t("billingStorageCharges"), value: billingPreview.summary.storageAmount, numberFormat: "currency", bold: true }
          ]
        : [
            { label: t("billingInboundCharges"), value: billingPreview.summary.inboundAmount, numberFormat: "currency" },
            { label: t("billingWrappingCharges"), value: billingPreview.summary.wrappingAmount, numberFormat: "currency" },
            { label: t("billingStorageCharges"), value: billingPreview.summary.storageAmount, numberFormat: "currency" },
            { label: t("billingOutboundCharges"), value: billingPreview.summary.outboundAmount, numberFormat: "currency" },
            { label: t("billingGrandTotal"), value: billingPreview.summary.grandTotal, numberFormat: "currency", bold: true }
          ]
    });
    setIsExportDialogOpen(false);
  }

  function handleDownloadPdf(exportMode: BillingExportMode = pendingExportMode) {
    downloadBillingPreviewPdf({
      preview: billingPreview,
      rates,
      timeZone: resolvedTimeZone,
      exportMode,
      workspaceMode,
      storageRows: storageSettlementRows
    });
  }

  const rateActions = (
    <div className="sheet-actions">
      <Button
        size="small"
        variant="outlined"
        startIcon={<FileDownloadOutlinedIcon fontSize="small" />}
        endIcon={<ExpandMoreOutlinedIcon fontSize="small" />}
        onClick={(event) => setExportMenuAnchor(event.currentTarget)}
        disabled={!hasBillablePreview}
      >
        {t("export")}
      </Button>
      <Menu
        anchorEl={exportMenuAnchor}
        open={Boolean(exportMenuAnchor)}
        onClose={() => setExportMenuAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuItem
          onClick={() => {
            setExportMenuAnchor(null);
            setPendingExportMode("SUMMARY");
            setIsExportDialogOpen(true);
          }}
        >
          <ListItemIcon><FileDownloadOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={t("billingExportExcelSummary")} secondary={t("billingExportSummaryDesc")} />
        </MenuItem>
        <MenuItem
          onClick={() => {
            setExportMenuAnchor(null);
            setPendingExportMode("DETAILED");
            setIsExportDialogOpen(true);
          }}
        >
          <ListItemIcon><FileDownloadOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={t("billingExportExcelDetailed")} secondary={t("billingExportDetailedDesc")} />
        </MenuItem>
        <MenuItem
          onClick={() => {
            setExportMenuAnchor(null);
            setPendingExportMode("SUMMARY");
            handleDownloadPdf("SUMMARY");
          }}
        >
          <ListItemIcon><PictureAsPdfOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={t("billingDownloadPdfSummary")} secondary={t("billingExportSummaryDesc")} />
        </MenuItem>
        <MenuItem
          onClick={() => {
            setExportMenuAnchor(null);
            setPendingExportMode("DETAILED");
            handleDownloadPdf("DETAILED");
          }}
        >
          <ListItemIcon><PictureAsPdfOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={t("billingDownloadPdfDetailed")} secondary={t("billingExportDetailedDesc")} />
        </MenuItem>
      </Menu>
      <Divider orientation="vertical" flexItem />
      <Button
        size="small"
        variant="outlined"
        startIcon={<RefreshOutlinedIcon fontSize="small" />}
        onClick={() => {
          setIsLoading(true);
          void Promise.all([api.getPallets(50000), api.getPalletLocationEvents(50000)])
            .then(([nextPallets, nextEvents]) => {
              setPallets(nextPallets);
              setPalletLocationEvents(nextEvents);
              setErrorMessage("");
            })
            .catch((error) => setErrorMessage(getErrorMessage(error, t("couldNotLoadReport"))))
            .finally(() => setIsLoading(false));
        }}
      >
        {t("refresh")}
      </Button>
      {workspaceMode === "OVERVIEW" && (
        <Button
          size="small"
          variant={showDetailSections ? "contained" : "outlined"}
          startIcon={showDetailSections ? <ExpandLessOutlinedIcon fontSize="small" /> : <ExpandMoreOutlinedIcon fontSize="small" />}
          onClick={() => setShowDetailSections((prev) => !prev)}
        >
          {showDetailSections ? t("billingHideDetails") : t("billingShowDetails")}
        </Button>
      )}
    </div>
  );

  return (
    <main className="workspace-main">
      <section className="workbook-panel workbook-panel--full">
        <div className="tab-strip">
          <WorkspacePanelHeader
            title={workspaceMode === "STORAGE_SETTLEMENT" ? t("billingStorageSettlementTitle") : t("billingPage")}
            description={workspaceMode === "STORAGE_SETTLEMENT" ? t("billingStorageSettlementDesc") : t("billingPageDesc")}
            errorMessage={errorMessage}
            notices={[
              <span key="assumption">{t("billingDayEndNotice")}</span>
            ]}
            actions={rateActions}
          />
        </div>

        <div style={{ display: "flex", gap: "0.5rem", padding: "0 1rem 1rem", flexWrap: "wrap" }}>
          <Chip
            size="small"
            label={t("billingModeOverview")}
            color="primary"
            variant={workspaceMode === "OVERVIEW" ? "filled" : "outlined"}
            onClick={() => setWorkspaceMode("OVERVIEW")}
            style={{ cursor: "pointer" }}
          />
          <Chip
            size="small"
            label={t("billingModeStorageSettlement")}
            color="primary"
            variant={workspaceMode === "STORAGE_SETTLEMENT" ? "filled" : "outlined"}
            onClick={() => setWorkspaceMode("STORAGE_SETTLEMENT")}
            style={{ cursor: "pointer" }}
          />
        </div>

        {/* ── Filter bar ── */}
        <div className="filter-bar">
          <label>
            {t("fromDate")}
            <input type="date" value={selectedStartDate} onChange={(event) => setSelectedStartDate(event.target.value)} />
          </label>
          <label>
            {t("toDate")}
            <input type="date" value={selectedEndDate} onChange={(event) => setSelectedEndDate(event.target.value)} />
          </label>
          <label>
            {t("customer")}
            <select value={selectedCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)}>
              <option value="all">{t("allCustomers")}</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>{customer.name}</option>
              ))}
            </select>
          </label>
          <label>
            {t("billingWarehouseScope")}
            <select value={selectedWarehouseLocationId} onChange={(event) => setSelectedWarehouseLocationId(event.target.value)}>
              <option value="all">{t("billingAllWarehouses")}</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>{location.name}</option>
              ))}
            </select>
          </label>
          <label>
            {t("billingContainerType")}
            <select value={selectedContainerType} onChange={(event) => setSelectedContainerType(event.target.value as ContainerType | "all")}>
              <option value="all">{t("billingAllContainerTypes")}</option>
              <option value="NORMAL">{containerTypeLabel("NORMAL", t)}</option>
              <option value="WEST_COAST_TRANSFER">{containerTypeLabel("WEST_COAST_TRANSFER", t)}</option>
            </select>
          </label>
          <label>
            {t("containerNo")}
            <input
              type="search"
              placeholder={t("billingContainerSearchPlaceholder")}
              value={containerNoFilter}
              onChange={(event) => setContainerNoFilter(event.target.value)}
            />
          </label>
        </div>

        {/* ── Quick metrics ── */}
        <div className="metric-ribbon" style={{ padding: "0 1rem 1rem" }}>
          {workspaceMode === "STORAGE_SETTLEMENT" ? (
            <>
              <article className="metric-card">
                <span>{t("billingStorageContainers")}</span>
                <strong>{formatNumber(storageSettlementRows.length)}</strong>
              </article>
              <article className="metric-card">
                <span>{t("billingTrackedPallets")}</span>
                <strong>{formatNumber(storageSettlementTrackedPallets)}</strong>
              </article>
              <article className="metric-card">
                <span>{t("palletDays")}</span>
                <strong>{formatNumber(billingPreview.summary.palletDays)}</strong>
              </article>
              <article className="metric-card">
                <span>{t("billingStorageCharges")}</span>
                <strong>{formatMoney(storageSettlementTotal)}</strong>
              </article>
            </>
          ) : (
            <>
              <article className="metric-card">
                <span>{t("billingReceivedContainers")}</span>
                <strong>{formatNumber(billingPreview.summary.receivedContainers)}</strong>
              </article>
              <article className="metric-card">
                <span>{t("billingReceivedPallets")}</span>
                <strong>{formatNumber(billingPreview.summary.receivedPallets)}</strong>
              </article>
              <article className="metric-card">
                <span>{t("palletDays")}</span>
                <strong>{formatNumber(billingPreview.summary.palletDays)}</strong>
              </article>
              <article className="metric-card">
                <span>{t("billingGrandTotal")}</span>
                <strong>{formatMoney(billingPreview.summary.grandTotal)}</strong>
              </article>
            </>
          )}
        </div>

        {/* ── Charge summary bars ── */}
        {workspaceMode === "OVERVIEW" && (
          <div className="report-grid" style={{ paddingTop: 0 }}>
            <article className="report-card">
              <div className="report-card__header">
                <h3>{t("billingChargeSummary")}</h3>
                <p>{t("billingChargeSummaryDesc")}</p>
              </div>
              <div className="report-bars report-bars--summary">
                {[
                  { label: t("billingInboundCharges"), value: billingPreview.summary.inboundAmount },
                  { label: t("billingWrappingCharges"), value: billingPreview.summary.wrappingAmount },
                  { label: t("billingStorageCharges"), value: billingPreview.summary.storageAmount },
                  { label: t("billingOutboundCharges"), value: billingPreview.summary.outboundAmount }
                ].map((row) => (
                  <div className="report-bars__row" key={row.label}>
                    <div className="report-bars__labels">
                      <strong>{row.label}</strong>
                    </div>
                    <div className="report-bars__value">{formatMoney(row.value)}</div>
                  </div>
                ))}
              </div>
            </article>
          </div>
        )}

        {/* ── Create Invoice CTA ── */}
        {workspaceMode === "STORAGE_SETTLEMENT" && existingStorageSettlementInvoice && customerId !== "all" && (
          <div className="billing-cta-banner" style={{ margin: "0 1rem 1rem", padding: "1rem 1.25rem", background: "rgba(211,47,47,0.06)", borderRadius: "var(--radius-md)", border: "1px solid rgba(211,47,47,0.16)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
            <div>
              <strong style={{ fontSize: "0.938rem" }}>{t("billingStorageSettlementDuplicateTitle")}</strong>
              <div style={{ fontSize: "0.813rem", color: "var(--ink-soft)", marginTop: "0.25rem" }}>
                {t("billingStorageSettlementDuplicateDesc", {
                  invoiceNo: existingStorageSettlementInvoice.invoiceNo,
                  startDate: selectedStartDate,
                  endDate: selectedEndDate
                })}
              </div>
            </div>
            <Button size="small" variant="outlined" onClick={() => onOpenBillingInvoice(existingStorageSettlementInvoice.id)}>
              {t("billingOpenExistingInvoice")}
            </Button>
          </div>
        )}

        {customerId !== "all" && (
          <div className="billing-cta-banner" style={{ margin: "0 1rem 1rem", padding: "1rem 1.25rem", background: canCreateInvoice ? "rgba(39, 76, 119, 0.06)" : "rgba(0,0,0,0.02)", borderRadius: "var(--radius-md)", border: canCreateInvoice ? "1px solid rgba(39, 76, 119, 0.15)" : "1px dashed var(--gray-4)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
            <div>
              <strong style={{ fontSize: "0.938rem" }}>
                {workspaceMode === "STORAGE_SETTLEMENT"
                  ? (canCreateInvoice ? `${t("billingCreateStorageInvoice")} - ${billingPreview.customerName}` : t("billingStorageSettlementCustomerRequired"))
                  : (canCreateInvoice ? `${t("billingCreateMixedInvoice")} - ${billingPreview.customerName}` : t("billingSelectCustomerHint"))}
              </strong>
              {canCreateInvoice && (
                <div style={{ fontSize: "0.813rem", color: "var(--ink-soft)", marginTop: "0.25rem", display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.375rem" }}>
                  {workspaceMode === "STORAGE_SETTLEMENT"
                    ? `${billingPreview.storageRows.length} ${t("billingStorageContainers").toLowerCase()} · ${formatNumber(storageSettlementTrackedPallets)} ${t("billingTrackedPallets").toLowerCase()} · ${formatMoney(storageSettlementTotal)}`
                    : `${activeInvoiceLines.length} ${t("billingLineCount").toLowerCase()} · ${formatMoney(activeGrandTotal)}`}
                  {warehouseLocationId !== "all" && (
                    <span style={{ background: "rgba(39,76,119,0.08)", borderRadius: "var(--radius-sm)", padding: "0 0.4rem", fontSize: "0.75rem" }}>
                      {selectedWarehouse?.name ?? t("billingAllWarehouses")}
                    </span>
                  )}
                  {selectedContainerType !== "all" && (
                    <span style={{ background: "rgba(39,76,119,0.08)", borderRadius: "var(--radius-sm)", padding: "0 0.4rem", fontSize: "0.75rem" }}>
                      {containerTypeLabel(selectedContainerType, t)}
                    </span>
                  )}
                  {containerNoFilter.trim() && (
                    <span style={{ background: "rgba(39,76,119,0.12)", borderRadius: "var(--radius-sm)", padding: "0 0.4rem", fontSize: "0.75rem", fontFamily: "monospace", letterSpacing: "0.03em" }}>
                      {containerNoFilter.trim().toUpperCase()}
                    </span>
                  )}
                </div>
              )}
            </div>
            {canCreateInvoice && (
              <Button
                variant="contained"
                color="primary"
                disabled={isCreatingInvoice}
                startIcon={<AddCircleOutlineOutlinedIcon fontSize="small" />}
                onClick={handleCreateInvoice}
              >
                {isCreatingInvoice ? "..." : workspaceMode === "STORAGE_SETTLEMENT" ? t("billingCreateStorageInvoice") : t("billingCreateMixedInvoice")}
              </Button>
            )}
          </div>
        )}

        {customerId === "all" && !hasBillablePreview && (
          <div style={{ margin: "0 1rem 1rem", padding: "1rem 1.25rem", background: "rgba(0,0,0,0.02)", borderRadius: "var(--radius-md)", border: "1px dashed var(--gray-4)", textAlign: "center", color: "var(--ink-soft)", fontSize: "0.875rem" }}>
            {workspaceMode === "STORAGE_SETTLEMENT" ? t("billingStorageSettlementCustomerRequired") : t("billingWorkflowHint")}
          </div>
        )}

        {false && customerId !== "all" && (
          <div className="billing-cta-banner" style={{ margin: "0 1rem 1rem", padding: "1rem 1.25rem", background: canCreateInvoice ? "rgba(39, 76, 119, 0.06)" : "rgba(0,0,0,0.02)", borderRadius: "var(--radius-md)", border: canCreateInvoice ? "1px solid rgba(39, 76, 119, 0.15)" : "1px dashed var(--gray-4)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
            <div>
              <strong style={{ fontSize: "0.938rem" }}>
                {workspaceMode === "STORAGE_SETTLEMENT"
                  ? (canCreateInvoice ? `${t("billingCreateStorageInvoice")} - ${billingPreview.customerName}` : t("billingStorageSettlementCustomerRequired"))
                  : (canCreateInvoice ? `${t("billingCreateMixedInvoice")} - ${billingPreview.customerName}` : t("billingSelectCustomerHint"))
                }
              </strong>
              {canCreateInvoice && (
                <div style={{ fontSize: "0.813rem", color: "var(--ink-soft)", marginTop: "0.25rem", display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.375rem" }}>
                  {activeInvoiceLines.length} {t("billingLineCount").toLowerCase()} · {formatMoney(activeGrandTotal)}
                  {containerNoFilter.trim() && (
                    <span style={{ background: "rgba(39,76,119,0.12)", borderRadius: "var(--radius-sm)", padding: "0 0.4rem", fontSize: "0.75rem", fontFamily: "monospace", letterSpacing: "0.03em" }}>
                      {containerNoFilter.trim().toUpperCase()}
                    </span>
                  )}
                </div>
              )}
            </div>
            {canCreateInvoice && (
              <Button
                variant="contained"
                color="primary"
                disabled={isCreatingInvoice}
                startIcon={<AddCircleOutlineOutlinedIcon fontSize="small" />}
                onClick={handleCreateInvoice}
              >
                {isCreatingInvoice ? "..." : t("billingCreateInvoice")}
              </Button>
            )}
          </div>
        )}

        {false && customerId === "all" && billingPreview.invoiceLines.length === 0 && (
          <div style={{ margin: "0 1rem 1rem", padding: "1rem 1.25rem", background: "rgba(0,0,0,0.02)", borderRadius: "var(--radius-md)", border: "1px dashed var(--gray-4)", textAlign: "center", color: "var(--ink-soft)", fontSize: "0.875rem" }}>
            {t("billingWorkflowHint")}
          </div>
        )}

        {/* ── Settlement overview / Invoice history (always visible) ── */}
        <section className="workbook-panel" style={{ margin: "0 1rem 1rem" }}>
          <WorkspacePanelHeader
            title={t("billingSettlementOverview")}
            description={t("billingSettlementOverviewDesc")}
          />
          {/* Status filter chips */}
          {invoices.length > 0 && (
            <div style={{ display: "flex", gap: "0.5rem", padding: "0 1rem 0.75rem", flexWrap: "wrap" }}>
              {([
                { key: "ALL" as const, label: t("billingAllStatuses"), count: invoices.length, color: "default" as const },
                { key: "DRAFT" as const, label: t("billingDraftCount"), count: invoiceStatusCounts.DRAFT, color: "default" as const },
                { key: "FINALIZED" as const, label: t("billingFinalizedCount"), count: invoiceStatusCounts.FINALIZED, color: "primary" as const },
                { key: "PAID" as const, label: t("billingPaidCount"), count: invoiceStatusCounts.PAID, color: "success" as const },
                { key: "VOID" as const, label: t("billingVoidCount"), count: invoiceStatusCounts.VOID, color: "error" as const },
              ]).filter((chip) => chip.key === "ALL" || chip.count > 0).map((chip) => (
                <Chip
                  key={chip.key}
                  size="small"
                  label={`${chip.label} (${chip.count})`}
                  color={chip.color}
                  variant={invoiceStatusFilter === chip.key ? "filled" : "outlined"}
                  onClick={() => setInvoiceStatusFilter(chip.key)}
                  style={{ cursor: "pointer" }}
                />
              ))}
            </div>
          )}
          {invoices.length === 0 ? (
            <WorkspaceTableEmptyState title={t("billingNoInvoicesTitle")} description={t("billingNoInvoicesDesc")} />
          ) : filteredInvoices.length === 0 ? (
            <WorkspaceTableEmptyState title={t("billingNoInvoicesTitle")} description={t("billingNoInvoicesDesc")} />
          ) : (
            <div className="sheet-table-wrap">
              <table className="sheet-table">
                <thead>
                  <tr>
                    <th>{t("billingInvoiceNo")}</th>
                    <th>{t("customer")}</th>
                    <th>{t("billingWarehouseScope")}</th>
                    <th>{t("billingContainerType")}</th>
                    <th>{t("billingPeriod")}</th>
                    <th>{t("billingInvoiceType")}</th>
                    <th>{t("billingLineCount")}</th>
                    <th>{t("billingGrandTotal")}</th>
                    <th>{t("status")}</th>
                    <th>{t("created")}</th>
                    <th>{t("actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvoices.map((inv) => (
                    <tr key={inv.id}>
                      <td className="cell--mono">{inv.invoiceNo}</td>
                      <td>{inv.customerNameSnapshot}</td>
                      <td>{inv.warehouseNameSnapshot || t("billingAllWarehouses")}</td>
                      <td>{inv.containerType ? containerTypeLabel(inv.containerType as ContainerType, t) : "-"}</td>
                      <td>{inv.periodStart} to {inv.periodEnd}</td>
                      <td>{invoiceTypeLabel(inv.invoiceType, t)}</td>
                      <td className="cell--mono">{formatNumber(inv.lineCount || inv.lines.length)}</td>
                      <td className="cell--mono">{formatMoney(inv.grandTotal)}</td>
                      <td>
                        <Chip
                          size="small"
                          label={invoiceStatusLabel(inv.status, t)}
                          color={invoiceStatusColor(inv.status)}
                          variant="outlined"
                        />
                      </td>
                      <td>{formatDateTimeValue(inv.createdAt, resolvedTimeZone)}</td>
                      <td>
                        <Button size="small" variant="text" onClick={() => onOpenBillingInvoice(inv.id)}>
                          {t("billingOpenInvoice")}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Container billing breakdown (always visible) ── */}
        <section className="workbook-panel" style={{ margin: "0 1rem 1rem" }}>
          <WorkspacePanelHeader
            title={workspaceMode === "STORAGE_SETTLEMENT" ? t("billingStorageSettlementTable") : t("billingContainerTrace")}
            description={workspaceMode === "STORAGE_SETTLEMENT" ? t("billingStorageSettlementTableDesc") : t("billingContainerTraceDesc")}
          />
          {(workspaceMode === "STORAGE_SETTLEMENT" ? storageSettlementRows.length === 0 : activeContainerRows.length === 0) ? (
            <WorkspaceTableEmptyState
              title={containerNoFilter.trim() ? `${t("noBillingData")} - ${containerNoFilter.trim().toUpperCase()}` : t("noBillingData")}
              description={workspaceMode === "STORAGE_SETTLEMENT" ? t("billingStorageSettlementTableDesc") : t("billingContainerTraceDesc")}
            />
          ) : (
            <div className="sheet-table-wrap">
              {workspaceMode === "STORAGE_SETTLEMENT" ? (
                <table className="sheet-table" aria-label={t("billingStorageSettlementTable")}>
                  <thead>
                    <tr>
                      <th>{t("containerNo")}</th>
                      <th>{t("customer")}</th>
                      <th>{t("billingContainerType")}</th>
                      <th>{t("billingWarehousesTouched")}</th>
                      <th>{t("billingTrackedPallets")}</th>
                      <th>{t("palletDays")}</th>
                      <th>{t("billingStorageCharges")}</th>
                      <th>{t("actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {storageSettlementRows.map((row) => (
                      <tr key={`${row.customerId}-${row.containerNo}`}>
                        <td className="cell--mono">{row.containerNo}</td>
                        <td>{row.customerName}</td>
                        <td>{containerTypeLabel(row.containerType, t)}</td>
                        <td>{row.locationName || row.warehousesTouched.join(", ") || "-"}</td>
                        <td className="cell--mono">{formatNumber(row.palletsTracked)}</td>
                        <td className="cell--mono">{formatNumber(row.palletDays)}</td>
                        <td className="cell--mono">{formatMoney(row.amount)}</td>
                        <td>
                          {isNavigableContainerNo(row.containerNo) ? (
                            <Button
                              size="small"
                              variant="text"
                              onClick={() => {
                                setContainerNoFilter(row.containerNo);
                                onOpenBillingContainerDetail(
                                  billingPreview.startDate,
                                  billingPreview.endDate,
                                  customerId,
                                  row.containerNo,
                                  warehouseLocationId
                                );
                              }}
                            >
                              {t("billingViewContainerInvoice")}
                            </Button>
                          ) : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="sheet-table" aria-label={t("billingContainerTrace")}>
                  <thead>
                    <tr>
                      <th>{t("containerNo")}</th>
                      <th>{t("customer")}</th>
                      <th>{t("reference")}</th>
                      <th>{t("currentStorage")}</th>
                      <th>{t("billingInboundCharges")}</th>
                      <th>{t("billingWrappingCharges")}</th>
                      <th>{t("billingStorageCharges")}</th>
                      <th>{t("billingOutboundCharges")}</th>
                      <th>{t("amount")}</th>
                      <th>{t("actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeContainerRows.map((row) => (
                      <tr key={`${row.customerId}-${row.containerNo}`}>
                        <td className="cell--mono">{row.containerNo}</td>
                        <td>{row.customerName}</td>
                        <td>{renderReferencePreview(row.references)}</td>
                        <td>{row.warehousesTouched.join(", ") || "-"}</td>
                        <td className="cell--mono">{formatMoney(row.inboundAmount)}</td>
                        <td className="cell--mono">{formatMoney(row.wrappingAmount)}</td>
                        <td className="cell--mono">{formatMoney(row.storageAmount)}</td>
                        <td className="cell--mono">{formatMoney(row.outboundAmount)}</td>
                        <td className="cell--mono">{formatMoney(row.totalAmount)}</td>
                        <td>
                          {isNavigableContainerNo(row.containerNo) ? (
                            <Button
                              size="small"
                              variant="text"
                              onClick={() => {
                                setContainerNoFilter(row.containerNo);
                                onOpenBillingContainerDetail(
                                  billingPreview.startDate,
                                  billingPreview.endDate,
                                  customerId,
                                  row.containerNo,
                                  warehouseLocationId
                                );
                              }}
                            >
                              {t("billingViewContainerInvoice")}
                            </Button>
                          ) : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </section>

        {false && !isLoading && (
          <section className="workbook-panel" style={{ margin: "0 1rem 1rem" }}>
            <WorkspacePanelHeader
              title={t("billingContainerTrace")}
              description={t("billingContainerTraceDesc")}
            />
            {activeContainerRows.length === 0 ? (
              <WorkspaceTableEmptyState
                title={containerNoFilter.trim() ? `${t("noBillingData")} — ${containerNoFilter.trim().toUpperCase()}` : t("noBillingData")}
                description={t("billingContainerTraceDesc")}
              />
            ) : (
              <div className="sheet-table-wrap">
                <table className="sheet-table" aria-label={t("billingContainerTrace")}>
                  <thead>
                    <tr>
                      <th>{t("containerNo")}</th>
                      <th>{t("customer")}</th>
                      <th>{t("reference")}</th>
                      <th>{t("currentStorage")}</th>
                      <th>{t("billingInboundCharges")}</th>
                      <th>{t("billingWrappingCharges")}</th>
                      <th>{t("billingStorageCharges")}</th>
                      <th>{t("billingOutboundCharges")}</th>
                      <th>{t("amount")}</th>
                      <th>{t("actions")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeContainerRows.map((row) => (
                      <tr key={`${row.customerId}-${row.containerNo}`}>
                        <td className="cell--mono">{row.containerNo}</td>
                        <td>{row.customerName}</td>
                        <td>{renderReferencePreview(row.references)}</td>
                        <td>{row.warehousesTouched.join(", ") || "-"}</td>
                        <td className="cell--mono">{formatMoney(row.inboundAmount)}</td>
                        <td className="cell--mono">{formatMoney(row.wrappingAmount)}</td>
                        <td className="cell--mono">{formatMoney(row.storageAmount)}</td>
                        <td className="cell--mono">{formatMoney(row.outboundAmount)}</td>
                        <td className="cell--mono">{formatMoney(row.totalAmount)}</td>
                        <td>
                          {isNavigableContainerNo(row.containerNo) ? (
                            <Button
                              size="small"
                              variant="text"
                              onClick={() => {
                                setContainerNoFilter(row.containerNo);
                                onOpenBillingContainerDetail(billingPreview.startDate, billingPreview.endDate, customerId, row.containerNo, warehouseLocationId);
                              }}
                            >
                              {t("billingViewContainerInvoice")}
                            </Button>
                          ) : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* ── Collapsible detail sections ── */}
        {showDetailSections && (
          <>
            {/* Rate card + Daily pallet balance */}
            <div className="report-grid">
              <article className="report-card">
                <div className="report-card__header">
                  <h3>{t("billingRateCard")}</h3>
                  <p>{t("billingRateCardDesc")}</p>
                </div>
                <div className="sheet-form">
                  <label>
                    {t("billingInboundContainerFee")}
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={rates.inboundContainerFee}
                      onChange={(event) => setRates((current) => ({ ...current, inboundContainerFee: toNumber(event.target.value) }))}
                    />
                  </label>
                  <label>
                    {t("billingWrappingFee")}
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={rates.wrappingFeePerPallet}
                      onChange={(event) => setRates((current) => ({ ...current, wrappingFeePerPallet: toNumber(event.target.value) }))}
                    />
                  </label>
                  <label>
                    {t("billingStorageRateNormal")}
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={rates.storageFeePerPalletPerWeekNormal}
                      onChange={(event) => setRates((current) => ({
                        ...current,
                        storageFeePerPalletPerWeek: toNumber(event.target.value),
                        storageFeePerPalletPerWeekNormal: toNumber(event.target.value)
                      }))}
                    />
                  </label>
                  <label>
                    {t("billingStorageRateWestCoast")}
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={rates.storageFeePerPalletPerWeekWestCoastTransfer}
                      onChange={(event) => setRates((current) => ({
                        ...current,
                        storageFeePerPalletPerWeekWestCoastTransfer: toNumber(event.target.value)
                      }))}
                    />
                  </label>
                  <label>
                    {t("billingOutboundFee")}
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={rates.outboundFeePerPallet}
                      onChange={(event) => setRates((current) => ({ ...current, outboundFeePerPallet: toNumber(event.target.value) }))}
                    />
                  </label>
                </div>
                <div className="sheet-note" style={{ marginTop: "1rem" }}>
                  <strong>{t("billingCustomerScope")}</strong>
                  <br />
                  {billingPreview.customerName}
                </div>
              </article>

              <article className="report-card">
                <div className="report-card__header">
                  <h3>{t("dailyPalletBalance")}</h3>
                  <p>{t("dailyPalletBalanceDesc")}</p>
                </div>
                {isLoading ? (
                  <div className="empty-state">{t("loadingRecords")}</div>
                ) : billingPreview.dailyBalanceRows.some((row) => row.palletCount > 0) ? (
                  <div className="report-chart-wrap">
                    <BarChart
                      dataset={dailyBalanceDataset}
                      height={300}
                      margin={{ top: 20, bottom: 20, left: 36, right: 12 }}
                      xAxis={[{ scaleType: "band", dataKey: "label" }]}
                      series={[{ dataKey: "palletCount", label: t("billingDayEndPallets"), color: "#274c77" }]}
                      hideLegend
                      grid={{ horizontal: true }}
                    />
                  </div>
                ) : (
                  <WorkspaceTableEmptyState title={t("noBillingData")} description={t("dailyPalletBalanceDesc")} />
                )}
                <div className="sheet-note sheet-note--readonly" style={{ marginTop: "1rem" }}>
                  <strong>{t("billingCalculationFormula")}</strong>
                  <br />
                  {t("billingStorageFormulaHint", {
                    palletDays: formatNumber(billingPreview.summary.palletDays),
                    dailyRate: formatMoney(selectedStorageRatePerWeek / 7)
                  })}
                </div>
              </article>
            </div>

            {/* Invoice preview lines */}
            <section className="workbook-panel" style={{ margin: "0 1rem 1rem" }}>
              <WorkspacePanelHeader
                title={t("billingInvoicePreview")}
                description={t("billingInvoicePreviewDesc")}
              />
              {billingPreview.invoiceLines.length === 0 ? (
                <WorkspaceTableEmptyState title={t("noBillingData")} description={t("billingInvoicePreviewDesc")} />
              ) : (
                <div className="sheet-table-wrap">
                  <table className="sheet-table">
                    <thead>
                      <tr>
                        <th>{t("customer")}</th>
                        <th>{t("chargeType")}</th>
                        <th>{t("reference")}</th>
                        <th>{t("containerNo")}</th>
                        <th>{t("currentStorage")}</th>
                        <th>{t("quantity")}</th>
                        <th>{t("unitRate")}</th>
                        <th>{t("amount")}</th>
                        <th>{t("notes")}</th>
                        <th>{t("created")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {billingPreview.invoiceLines.map((line) => (
                        <tr key={line.id}>
                          <td>{line.customerName}</td>
                          <td>{renderChargeTypeLabel(line.chargeType, t)}</td>
                          <td className="cell--mono">{line.reference}</td>
                          <td className="cell--mono">{line.containerNo}</td>
                          <td>{line.warehouseSummary}</td>
                          <td className="cell--mono">{formatNumber(line.quantity)}</td>
                          <td className="cell--mono">{formatMoney(line.unitRate)}</td>
                          <td className="cell--mono">{formatMoney(line.amount)}</td>
                          <td>{line.meta}</td>
                          <td>{line.occurredOn ? formatDateTimeValue(line.occurredOn, resolvedTimeZone, { dateStyle: "medium" }) : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </section>
      <ExportExcelDialog
        open={isExportDialogOpen}
        defaultTitle={exportTitle}
        defaultColumns={exportColumns}
        onClose={() => setIsExportDialogOpen(false)}
        onExport={handleExportExcel}
      />
    </main>
  );
}

function renderChargeTypeLabel(chargeType: "INBOUND" | "WRAPPING" | "STORAGE" | "OUTBOUND", t: (key: string) => string) {
  switch (chargeType) {
    case "INBOUND":
      return t("billingInboundCharges");
    case "WRAPPING":
      return t("billingWrappingCharges");
    case "STORAGE":
      return t("billingStorageCharges");
    case "OUTBOUND":
      return t("billingOutboundCharges");
    default:
      return chargeType;
  }
}

function toNumber(value: string) {
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2
  }).format(value);
}

function getErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof ApiError || error instanceof Error) {
    return error.message || fallbackMessage;
  }
  return fallbackMessage;
}

function buildBillingContainerSummaryRows(invoiceLines: BillingInvoiceLine[], storageRows: BillingStorageRow[]) {
  const rowMap = new Map<string, BillingContainerSummaryRow & { referenceSet: Set<string>; warehouseSet: Set<string> }>();

  for (const line of invoiceLines) {
    const containerNo = normalizeContainerNo(line.containerNo);
    if (!isNavigableContainerNo(containerNo)) {
      continue;
    }
    const rowKey = `${line.customerId}|${containerNo}`;
    const row = rowMap.get(rowKey) ?? {
      customerId: line.customerId,
      customerName: line.customerName,
      containerNo,
      references: [],
      warehousesTouched: [],
      inboundAmount: 0,
      wrappingAmount: 0,
      storageAmount: 0,
      outboundAmount: 0,
      totalAmount: 0,
      referenceSet: new Set<string>(),
      warehouseSet: new Set<string>()
    };

    if (line.reference.trim()) {
      row.referenceSet.add(line.reference.trim());
    }
    if (line.warehouseSummary.trim() && line.warehouseSummary.trim() !== "-") {
      row.warehouseSet.add(line.warehouseSummary.trim());
    }

    switch (line.chargeType) {
      case "INBOUND":
        row.inboundAmount += line.amount;
        break;
      case "WRAPPING":
        row.wrappingAmount += line.amount;
        break;
      case "STORAGE":
        row.storageAmount += line.amount;
        break;
      case "OUTBOUND":
        row.outboundAmount += line.amount;
        break;
    }
    row.totalAmount += line.amount;
    rowMap.set(rowKey, row);
  }

  for (const storageRow of storageRows) {
    const containerNo = normalizeContainerNo(storageRow.containerNo);
    if (!isNavigableContainerNo(containerNo)) {
      continue;
    }
    const rowKey = `${storageRow.customerId}|${containerNo}`;
    const row = rowMap.get(rowKey) ?? {
      customerId: storageRow.customerId,
      customerName: storageRow.customerName,
      containerNo,
      references: [],
      warehousesTouched: [],
      inboundAmount: 0,
      wrappingAmount: 0,
      storageAmount: 0,
      outboundAmount: 0,
      totalAmount: 0,
      referenceSet: new Set<string>(),
      warehouseSet: new Set<string>()
    };
    for (const warehouse of storageRow.warehousesTouched) {
      if (warehouse.trim()) {
        row.warehouseSet.add(warehouse.trim());
      }
    }
    row.storageAmount = Math.max(row.storageAmount, storageRow.amount);
    row.totalAmount = row.inboundAmount + row.wrappingAmount + row.storageAmount + row.outboundAmount;
    rowMap.set(rowKey, row);
  }

  return [...rowMap.values()]
    .map((row) => ({
      customerId: row.customerId,
      customerName: row.customerName,
      containerNo: row.containerNo,
      references: [...row.referenceSet].sort((left, right) => left.localeCompare(right)),
      warehousesTouched: [...row.warehouseSet].sort((left, right) => left.localeCompare(right)),
      inboundAmount: row.inboundAmount,
      wrappingAmount: row.wrappingAmount,
      storageAmount: row.storageAmount,
      outboundAmount: row.outboundAmount,
      totalAmount: row.totalAmount
    }))
    .sort((left, right) => {
      if (left.customerName !== right.customerName) {
        return left.customerName.localeCompare(right.customerName);
      }
      if (left.totalAmount !== right.totalAmount) {
        return right.totalAmount - left.totalAmount;
      }
      return left.containerNo.localeCompare(right.containerNo);
    });
}

function renderReferencePreview(references: string[]) {
  if (references.length === 0) {
    return "-";
  }
  if (references.length <= 2) {
    return references.join(", ");
  }
  return `${references.slice(0, 2).join(", ")} +${references.length - 2}`;
}

function normalizeContainerNo(value: string | null | undefined) {
  return (value ?? "").trim().toUpperCase();
}

function trimDateValue(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized ? normalized.slice(0, 10) : undefined;
}

function isNavigableContainerNo(containerNo: string) {
  return containerNo.trim() !== "" && containerNo.trim() !== "-" && containerNo.trim().toUpperCase() !== "UNASSIGNED";
}

function invoiceStatusLabel(status: BillingInvoiceStatus, t: (key: string) => string) {
  switch (status) {
    case "DRAFT": return t("billingInvoiceStatusDraft");
    case "FINALIZED": return t("billingInvoiceStatusFinalized");
    case "PAID": return t("billingInvoiceStatusPaid");
    case "VOID": return t("billingInvoiceStatusVoid");
    default: return status;
  }
}

function invoiceStatusColor(status: BillingInvoiceStatus): "default" | "primary" | "success" | "error" {
  switch (status) {
    case "DRAFT": return "default";
    case "FINALIZED": return "primary";
    case "PAID": return "success";
    case "VOID": return "error";
    default: return "default";
  }
}

function chargeTypeDescription(chargeType: string): string {
  switch (chargeType) {
    case "INBOUND": return "Inbound container fee";
    case "WRAPPING": return "Wrapping fee";
    case "STORAGE": return "Storage charges";
    case "OUTBOUND": return "Outbound fee";
    default: return chargeType;
  }
}

function invoiceTypeLabel(invoiceType: BillingInvoiceType, t: (key: string) => string) {
  switch (invoiceType) {
    case "STORAGE_SETTLEMENT":
      return t("billingInvoiceTypeStorageSettlement");
    case "MIXED":
    default:
      return t("billingInvoiceTypeMixed");
  }
}

function buildStorageSettlementInvoiceLines(storageRows: BillingStorageRow[]): CreateBillingInvoicePayload["lines"] {
  return storageRows.map((row) => ({
    chargeType: "STORAGE",
    description: `Storage settlement for ${row.containerNo}`,
    reference: `Storage | ${row.containerNo}`,
    containerNo: row.containerNo,
    warehouse: row.locationName || row.warehousesTouched.join(", "),
    occurredOn: trimDateValue(row.lastActivityAt ?? row.firstActivityAt),
    quantity: row.billablePalletDays,
    unitRate: row.billablePalletDays > 0 ? row.amount / row.billablePalletDays : 0,
    amount: row.amount,
    notes: `${containerTypeExportLabel(row.containerType)} | ${row.palletsTracked} pallets tracked across ${row.warehousesTouched.length} warehouse(s) | grace discount -${formatMoney(row.discountAmount)}`,
    sourceType: "AUTO",
    details: {
      kind: "STORAGE_CONTAINER_SUMMARY",
      warehouseLocationId: row.locationId,
      warehouseName: row.locationName || undefined,
      warehousesTouched: row.warehousesTouched,
      palletsTracked: row.palletsTracked,
      palletDays: row.palletDays,
      freePalletDays: row.freePalletDays,
      billablePalletDays: row.billablePalletDays,
      grossAmount: row.grossAmount,
      discountAmount: row.discountAmount,
      segments: row.segments.map((segment) => ({
        startDate: segment.startDate,
        endDate: segment.endDate,
        dayEndPallets: segment.dayEndPallets,
        billedDays: segment.billedDays,
        palletDays: segment.palletDays,
        freePalletDays: segment.freePalletDays,
        billablePalletDays: segment.billablePalletDays,
        grossAmount: segment.grossAmount,
        discountAmount: segment.discountAmount,
        amount: segment.amount
      }))
    }
  }));
}

function buildBillingPageExportColumns(
  workspaceMode: BillingWorkspaceMode,
  exportMode: BillingExportMode,
  t: (key: string) => string
): ExcelExportColumn[] {
  if (workspaceMode === "STORAGE_SETTLEMENT") {
    const base: ExcelExportColumn[] = [
      { key: "rowType", label: t("billingRowType") },
      { key: "customer", label: t("customer") },
      { key: "containerType", label: t("billingContainerType") },
      { key: "containerNo", label: t("containerNo") },
      { key: "warehouses", label: t("billingWarehousesTouched") },
      { key: "palletsTracked", label: t("billingTrackedPallets"), numberFormat: "number" },
      { key: "palletDays", label: t("palletDays"), numberFormat: "number" },
      { key: "amount", label: t("amount"), numberFormat: "currency" }
    ];
    if (exportMode === "DETAILED") {
      return [
        ...base,
        { key: "segmentStart", label: t("billingSegmentStart") },
        { key: "segmentEnd", label: t("billingSegmentEnd") },
        { key: "dayEndPallets", label: t("billingDayEndPallets"), numberFormat: "number" },
        { key: "billedDays", label: t("billingBilledDays"), numberFormat: "number" },
        { key: "segmentPalletDays", label: t("palletDays"), numberFormat: "number" },
        { key: "segmentAmount", label: t("billingStorageCharges"), numberFormat: "currency" }
      ];
    }
    return base.filter((column) => column.key !== "rowType");
  }

  const base: ExcelExportColumn[] = [
    { key: "rowType", label: t("billingRowType") },
    { key: "customer", label: t("customer") },
    { key: "chargeType", label: t("billingChargeType") },
    { key: "reference", label: t("reference") },
    { key: "containerNo", label: t("containerNo") },
    { key: "warehouse", label: t("currentStorage") },
    { key: "occurredOn", label: t("billingOccurredAt") },
    { key: "quantity", label: t("quantity"), numberFormat: "number" },
    { key: "unitRate", label: t("unitRate"), numberFormat: "currency" },
    { key: "amount", label: t("amount"), numberFormat: "currency" },
    { key: "notes", label: t("notes") }
  ];
  if (exportMode === "DETAILED") {
    return [
      ...base,
      { key: "segmentStart", label: t("billingSegmentStart") },
      { key: "segmentEnd", label: t("billingSegmentEnd") },
      { key: "dayEndPallets", label: t("billingDayEndPallets"), numberFormat: "number" },
      { key: "billedDays", label: t("billingBilledDays"), numberFormat: "number" },
      { key: "segmentPalletDays", label: t("palletDays"), numberFormat: "number" },
      { key: "segmentAmount", label: t("billingStorageCharges"), numberFormat: "currency" }
    ];
  }
  return base.filter((column) => column.key !== "rowType");
}

function buildBillingPageExportRows({
  workspaceMode,
  exportMode,
  invoiceLines,
  storageRows,
  timeZone,
  t
}: {
  workspaceMode: BillingWorkspaceMode;
  exportMode: BillingExportMode;
  invoiceLines: BillingInvoiceLine[];
  storageRows: BillingStorageRow[];
  timeZone: string;
  t: (key: string) => string;
}): Array<Record<string, ExcelExportCell>> {
  if (workspaceMode === "STORAGE_SETTLEMENT") {
    return flattenStorageSettlementRows(storageRows, exportMode, t);
  }

  const rows: Array<Record<string, ExcelExportCell>> = invoiceLines.map((line) => ({
    rowType: t("billingRowTypeInvoiceLine"),
    customer: line.customerName,
    containerType: "-",
    chargeType: renderChargeTypeLabel(line.chargeType, t),
    reference: line.reference || "-",
    containerNo: line.containerNo || "-",
    warehouse: line.warehouseSummary || "-",
    occurredOn: line.occurredOn ? formatDateTimeValue(line.occurredOn, timeZone, { dateStyle: "medium" }) : "-",
    quantity: line.quantity,
    unitRate: line.unitRate,
    amount: line.amount,
    notes: line.meta || "-"
  }));

  if (exportMode === "DETAILED") {
    rows.push(...flattenOverviewStorageSegments(storageRows, t));
  }

  return rows;
}

function flattenStorageSettlementRows(
  storageRows: BillingStorageRow[],
  exportMode: BillingExportMode,
  t: (key: string) => string
): Array<Record<string, ExcelExportCell>> {
  const rows: Array<Record<string, ExcelExportCell>> = [];
  for (const row of storageRows) {
      rows.push({
        rowType: t("billingRowTypeContainerSummary"),
        customer: row.customerName,
        containerType: containerTypeExportLabel(row.containerType),
        containerNo: row.containerNo,
        warehouses: row.locationName || row.warehousesTouched.join(", ") || "-",
        palletsTracked: row.palletsTracked,
        palletDays: row.palletDays,
        amount: row.amount
    });
    if (exportMode === "DETAILED") {
      for (const segment of row.segments) {
        rows.push({
          rowType: t("billingRowTypeStorageSegment"),
          customer: row.customerName,
          containerType: containerTypeExportLabel(row.containerType),
          containerNo: row.containerNo,
          warehouses: row.locationName || row.warehousesTouched.join(", ") || "-",
          palletsTracked: row.palletsTracked,
          palletDays: row.palletDays,
          amount: row.amount,
          segmentStart: segment.startDate,
          segmentEnd: segment.endDate,
          dayEndPallets: segment.dayEndPallets,
          billedDays: segment.billedDays,
          segmentPalletDays: segment.palletDays,
          segmentAmount: segment.amount
        });
      }
    }
  }
  return rows;
}

function flattenOverviewStorageSegments(
  storageRows: BillingStorageRow[],
  t: (key: string) => string
): Array<Record<string, ExcelExportCell>> {
  const rows: Array<Record<string, ExcelExportCell>> = [];
  for (const row of storageRows) {
    rows.push({
      rowType: t("billingRowTypeContainerSummary"),
      customer: row.customerName,
      chargeType: t("billingStorageCharges"),
      reference: `Storage | ${row.containerNo}`,
      containerNo: row.containerNo,
      warehouse: row.warehousesTouched.join(", ") || "-",
      occurredOn: row.lastActivityAt || row.firstActivityAt || "-",
      quantity: row.palletDays,
      unitRate: row.palletDays > 0 ? row.amount / row.palletDays : 0,
      amount: row.amount,
      notes: `${row.palletsTracked} pallets tracked`
    });
    for (const segment of row.segments) {
      rows.push({
        rowType: t("billingRowTypeStorageSegment"),
        customer: row.customerName,
        chargeType: t("billingStorageCharges"),
        reference: row.containerNo,
        containerNo: row.containerNo,
        warehouse: row.warehousesTouched.join(", ") || "-",
        occurredOn: segment.endDate,
        quantity: segment.palletDays,
        unitRate: segment.palletDays > 0 ? segment.amount / segment.palletDays : 0,
        amount: segment.amount,
        notes: `${segment.dayEndPallets} ${t("billingDayEndPallets").toLowerCase()}`,
        segmentStart: segment.startDate,
        segmentEnd: segment.endDate,
        dayEndPallets: segment.dayEndPallets,
        billedDays: segment.billedDays,
        segmentPalletDays: segment.palletDays,
        segmentAmount: segment.amount
      });
    }
  }
  return rows;
}

function buildBillingExportTitle(
  baseTitle: string,
  customerName: string,
  startDate: string,
  endDate: string,
  exportMode: BillingExportMode,
  warehouseName?: string,
  containerTypeLabelValue?: string
) {
  const normalizedCustomer = customerName.trim() || "all-customers";
  const normalizedWarehouse = warehouseName?.trim();
  const normalizedContainerType = containerTypeLabelValue?.trim();
  return `${baseTitle} ${exportMode.toLowerCase()} ${normalizedCustomer}${normalizedWarehouse ? ` ${normalizedWarehouse}` : ""}${normalizedContainerType ? ` ${normalizedContainerType}` : ""} ${startDate} to ${endDate}`;
}

function containerTypeLabel(containerType: ContainerType, t: (key: string) => string) {
  switch (containerType) {
    case "WEST_COAST_TRANSFER":
      return t("billingContainerTypeWestCoastTransfer");
    case "NORMAL":
    default:
      return t("billingContainerTypeNormal");
  }
}

function containerTypeExportLabel(containerType: ContainerType) {
  return containerType === "WEST_COAST_TRANSFER" ? "West Coast Transfer" : "Normal";
}
