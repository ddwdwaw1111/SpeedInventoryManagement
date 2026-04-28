import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import CalendarMonthOutlinedIcon from "@mui/icons-material/CalendarMonthOutlined";
import ClearOutlinedIcon from "@mui/icons-material/ClearOutlined";
import ExpandMoreOutlinedIcon from "@mui/icons-material/ExpandMoreOutlined";
import ExpandLessOutlinedIcon from "@mui/icons-material/ExpandLessOutlined";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import LocalShippingOutlinedIcon from "@mui/icons-material/LocalShippingOutlined";
import PaidOutlinedIcon from "@mui/icons-material/PaidOutlined";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";
import SearchOutlinedIcon from "@mui/icons-material/SearchOutlined";
import TrendingDownOutlinedIcon from "@mui/icons-material/TrendingDownOutlined";
import TrendingFlatOutlinedIcon from "@mui/icons-material/TrendingFlatOutlined";
import TrendingUpOutlinedIcon from "@mui/icons-material/TrendingUpOutlined";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";
import WarehouseOutlinedIcon from "@mui/icons-material/WarehouseOutlined";
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  InputAdornment,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Menu,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography
} from "@mui/material";
import { BarChart } from "@mui/x-charts";
import { useEffect, useMemo, useState } from "react";

import { ApiError, api } from "../lib/api";
import { waitForNextPaint } from "../lib/asyncUi";
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
import { InlineLoadingIndicator } from "./InlineLoadingIndicator";
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
type BillingPageTab = "CREATE" | "HISTORY";

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
  const [activeTab, setActiveTab] = useState<BillingPageTab>("CREATE");
  const [isRateDrawerOpen, setIsRateDrawerOpen] = useState(false);
  const [busyActionKey, setBusyActionKey] = useState<string | null>(null);

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

  const isRefreshing = busyActionKey === "refresh";
  const isPreviewPdfBusy = busyActionKey?.startsWith("preview-pdf-") ?? false;
  const disableHeaderActions = isCreatingInvoice || busyActionKey !== null;

  async function runBusyAction<T>(actionKey: string, action: () => Promise<T> | T) {
    if (busyActionKey || isCreatingInvoice) {
      return null;
    }

    setBusyActionKey(actionKey);
    try {
      await waitForNextPaint();
      return await action();
    } finally {
      setBusyActionKey((current) => current === actionKey ? null : current);
    }
  }

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
      await waitForNextPaint();
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
          transferInboundFeePerPallet: rates.transferInboundFeePerPallet,
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

  const previousPeriodRange = useMemo(
    () => computePreviousPeriodRange(selectedStartDate, selectedEndDate),
    [selectedEndDate, selectedStartDate]
  );
  const previousPeriodPreview = useMemo(() => {
    if (!previousPeriodRange) return null;
    return buildBillingPreview({
      startDate: previousPeriodRange.startDate,
      endDate: previousPeriodRange.endDate,
      customerId,
      customers,
      pallets,
      palletLocationEvents,
      inboundDocuments,
      outboundDocuments,
      locationId: warehouseLocationId,
      containerType: selectedContainerType,
      rates
    });
  }, [customerId, customers, inboundDocuments, outboundDocuments, palletLocationEvents, pallets, previousPeriodRange, rates, selectedContainerType, warehouseLocationId]);
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
  const storageSettlementDiscountTotal = useMemo(
    () => storageSettlementRows.reduce((sum, row) => sum + row.discountAmount, 0),
    [storageSettlementRows]
  );
  const storageSettlementPalletDays = useMemo(
    () => storageSettlementRows.reduce((sum, row) => sum + row.palletDays, 0),
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
      warehouseLocationId === "all" ? undefined : selectedWarehouse?.name ?? t("billingAllWarehouses"),
      selectedContainerType !== "all" ? containerTypeLabel(selectedContainerType, t) : undefined
    ),
    [billingPreview.customerName, billingPreview.endDate, billingPreview.startDate, selectedContainerType, selectedWarehouse?.name, t, workspaceMode]
  );
  const exportColumns = useMemo<ExcelExportColumn[]>(
    () => buildBillingPageExportColumns(workspaceMode, t),
    [t, workspaceMode]
  );
  const exportRows = useMemo<Array<Record<string, ExcelExportCell>>>(
    () => buildBillingPageExportRows({
      workspaceMode,
      invoiceLines: activeInvoiceLines,
      storageRows: storageSettlementRows,
      timeZone: resolvedTimeZone,
      t
    }),
    [activeInvoiceLines, resolvedTimeZone, storageSettlementRows, t, workspaceMode]
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
            { label: t("palletDays"), value: storageSettlementPalletDays, numberFormat: "number" },
            ...(storageSettlementDiscountTotal > 0
              ? [{ label: t("billingDiscount"), value: -storageSettlementDiscountTotal, numberFormat: "currency" as const }]
              : []),
            { label: t("billingStorageCharges"), value: storageSettlementTotal, numberFormat: "currency", bold: true }
          ]
        : [
            { label: t("billingInboundCharges"), value: billingPreview.summary.inboundAmount, numberFormat: "currency" },
            { label: t("billingWrappingCharges"), value: billingPreview.summary.wrappingAmount, numberFormat: "currency" },
            ...(billingPreview.summary.storageDiscountAmount > 0
              ? [{ label: t("billingDiscount"), value: -billingPreview.summary.storageDiscountAmount, numberFormat: "currency" as const }]
              : []),
            { label: t("billingStorageCharges"), value: billingPreview.summary.storageAmount, numberFormat: "currency" },
            { label: t("billingOutboundCharges"), value: billingPreview.summary.outboundAmount, numberFormat: "currency" },
            { label: t("billingGrandTotal"), value: billingPreview.summary.grandTotal, numberFormat: "currency", bold: true }
          ]
    });
    setIsExportDialogOpen(false);
  }

  function handleDownloadPdf() {
    return downloadBillingPreviewPdf({
      preview: billingPreview,
      rates,
      timeZone: resolvedTimeZone,
      workspaceMode,
      storageRows: storageSettlementRows
    });
  }

  async function handleRefreshBillingData() {
    await runBusyAction("refresh", async () => {
      const [nextPallets, nextEvents] = await Promise.all([api.getPallets(50000), api.getPalletLocationEvents(50000)]);
      setPallets(nextPallets);
      setPalletLocationEvents(nextEvents);
      setErrorMessage("");
    }).catch((error) => {
      setErrorMessage(getErrorMessage(error, t("couldNotLoadReport")));
    });
  }

  async function handleDownloadPdfWithFeedback() {
    setExportMenuAnchor(null);
    await runBusyAction("preview-pdf", () => {
      return handleDownloadPdf();
    });
  }

  const rateActions = activeTab !== "CREATE" ? null : (
    <div className="sheet-actions">
      <Button
        size="small"
        variant="outlined"
        startIcon={isPreviewPdfBusy ? <InlineLoadingIndicator /> : <FileDownloadOutlinedIcon fontSize="small" />}
        endIcon={<ExpandMoreOutlinedIcon fontSize="small" />}
        onClick={(event) => setExportMenuAnchor(event.currentTarget)}
        disabled={!hasBillablePreview || disableHeaderActions}
        aria-busy={isPreviewPdfBusy}
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
          disabled={disableHeaderActions}
          onClick={() => {
            setExportMenuAnchor(null);
            setIsExportDialogOpen(true);
          }}
        >
          <ListItemIcon><FileDownloadOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={t("exportExcel")} secondary={t("exportExcelDesc")} />
        </MenuItem>
        <MenuItem
          disabled={disableHeaderActions}
          onClick={() => void handleDownloadPdfWithFeedback()}
        >
          <ListItemIcon><PictureAsPdfOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={t("downloadPdf")} secondary={t("downloadPdfDesc")} />
        </MenuItem>
      </Menu>
      <Divider orientation="vertical" flexItem />
      <Button
        size="small"
        variant="outlined"
        startIcon={isRefreshing ? <InlineLoadingIndicator /> : <RefreshOutlinedIcon fontSize="small" />}
        onClick={() => void handleRefreshBillingData()}
        disabled={disableHeaderActions}
        aria-busy={isRefreshing}
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
      <Button
        size="small"
        variant="outlined"
        startIcon={<TuneOutlinedIcon fontSize="small" />}
        onClick={() => setIsRateDrawerOpen(true)}
        disabled={disableHeaderActions}
      >
        {t("billingRateCard")}
      </Button>
    </div>
  );

  const isCreateTab = activeTab === "CREATE";
  const isHistoryTab = activeTab === "HISTORY";

  const tabTitle = isHistoryTab
    ? t("billingTabHistory")
    : workspaceMode === "STORAGE_SETTLEMENT"
      ? t("billingStorageSettlementTitle")
      : t("billingPage");
  const tabDescription = isHistoryTab
    ? t("billingTabHistoryDesc")
    : workspaceMode === "STORAGE_SETTLEMENT"
      ? t("billingStorageSettlementDesc")
      : t("billingPageDesc");

  return (
    <main className="workspace-main">
      <section className="workbook-panel workbook-panel--full">
        <div className="tab-strip">
          <WorkspacePanelHeader
            title={tabTitle}
            description={tabDescription}
            errorMessage={errorMessage}
            notices={isCreateTab ? [<span key="assumption">{t("billingDayEndNotice")}</span>] : []}
            actions={rateActions}
          />
        </div>

        <Tabs
          value={activeTab}
          onChange={(_, value) => setActiveTab(value as BillingPageTab)}
          aria-label={t("billingPage")}
          sx={{ px: "1rem", borderBottom: 1, borderColor: "divider", mb: "0.75rem" }}
        >
          <Tab value="CREATE" label={t("billingTabCreate")} />
          <Tab
            value="HISTORY"
            label={`${t("billingTabHistory")}${invoices.length > 0 ? ` (${invoices.length})` : ""}`}
          />
        </Tabs>

        {isCreateTab && (
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
        )}

        {/* ── Date presets ── */}
        <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ px: "1rem", pb: "0.75rem", rowGap: 1 }}>
          {getDateRangePresets().map((preset) => {
            const active = selectedStartDate === preset.startDate && selectedEndDate === preset.endDate;
            return (
              <Chip
                key={preset.key}
                size="small"
                icon={<CalendarMonthOutlinedIcon fontSize="small" />}
                label={t(preset.labelKey)}
                color={active ? "primary" : "default"}
                variant={active ? "filled" : "outlined"}
                onClick={() => {
                  setSelectedStartDate(preset.startDate);
                  setSelectedEndDate(preset.endDate);
                }}
              />
            );
          })}
        </Stack>

        {/* ── Filter bar ── */}
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", md: "repeat(3, minmax(0, 1fr))", lg: "repeat(6, minmax(0, 1fr))" },
            gap: 1.5,
            px: "1rem",
            pb: "1rem"
          }}
        >
          <TextField
            size="small"
            type="date"
            label={t("fromDate")}
            value={selectedStartDate}
            onChange={(event) => setSelectedStartDate(event.target.value)}
            InputLabelProps={{ shrink: true }}
            fullWidth
          />
          <TextField
            size="small"
            type="date"
            label={t("toDate")}
            value={selectedEndDate}
            onChange={(event) => setSelectedEndDate(event.target.value)}
            InputLabelProps={{ shrink: true }}
            fullWidth
          />
          <Autocomplete
            size="small"
            options={[{ id: "all", name: t("allCustomers") } as { id: number | "all"; name: string }, ...customers.map((c) => ({ id: c.id, name: c.name }))]}
            value={
              selectedCustomerId === "all"
                ? { id: "all" as const, name: t("allCustomers") }
                : customers.find((c) => String(c.id) === selectedCustomerId)
                  ? { id: Number(selectedCustomerId), name: customers.find((c) => String(c.id) === selectedCustomerId)!.name }
                  : { id: "all" as const, name: t("allCustomers") }
            }
            getOptionLabel={(option) => option.name}
            isOptionEqualToValue={(option, value) => String(option.id) === String(value.id)}
            onChange={(_, value) => setSelectedCustomerId(value ? String(value.id) : "all")}
            disableClearable
            renderInput={(params) => <TextField {...params} label={t("customer")} />}
          />
          {isCreateTab && (
            <>
              <Autocomplete
                size="small"
                options={[{ id: "all", name: t("billingAllWarehouses") } as { id: number | "all"; name: string }, ...locations.map((l) => ({ id: l.id, name: l.name }))]}
                value={
                  selectedWarehouseLocationId === "all"
                    ? { id: "all" as const, name: t("billingAllWarehouses") }
                    : locations.find((l) => String(l.id) === selectedWarehouseLocationId)
                      ? { id: Number(selectedWarehouseLocationId), name: locations.find((l) => String(l.id) === selectedWarehouseLocationId)!.name }
                      : { id: "all" as const, name: t("billingAllWarehouses") }
                }
                getOptionLabel={(option) => option.name}
                isOptionEqualToValue={(option, value) => String(option.id) === String(value.id)}
                onChange={(_, value) => setSelectedWarehouseLocationId(value ? String(value.id) : "all")}
                disableClearable
                renderInput={(params) => <TextField {...params} label={t("billingWarehouseScope")} />}
              />
              <TextField
                size="small"
                select
                label={t("billingContainerType")}
                value={selectedContainerType}
                onChange={(event) => setSelectedContainerType(event.target.value as ContainerType | "all")}
                fullWidth
                SelectProps={{ native: false }}
              >
                <MenuItem value="all">{t("billingAllContainerTypes")}</MenuItem>
                <MenuItem value="NORMAL">{containerTypeLabel("NORMAL", t)}</MenuItem>
                <MenuItem value="WEST_COAST_TRANSFER">{containerTypeLabel("WEST_COAST_TRANSFER", t)}</MenuItem>
              </TextField>
              <TextField
                size="small"
                label={t("containerNo")}
                placeholder={t("billingContainerSearchPlaceholder")}
                value={containerNoFilter}
                onChange={(event) => setContainerNoFilter(event.target.value)}
                fullWidth
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchOutlinedIcon fontSize="small" />
                    </InputAdornment>
                  ),
                  endAdornment: containerNoFilter ? (
                    <InputAdornment position="end">
                      <IconButton size="small" aria-label="Clear" onClick={() => setContainerNoFilter("")}>
                        <ClearOutlinedIcon fontSize="small" />
                      </IconButton>
                    </InputAdornment>
                  ) : null
                }}
              />
            </>
          )}
        </Box>

        {isCreateTab && (<>
        {/* ── Quick metrics ── */}
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(4, minmax(0, 1fr))" },
            gap: 1.5,
            px: "1rem",
            pb: "1rem"
          }}
        >
          {(workspaceMode === "STORAGE_SETTLEMENT"
            ? [
                {
                  key: "containers",
                  label: t("billingStorageContainers"),
                  value: storageSettlementRows.length,
                  previousValue: previousPeriodPreview?.storageRows.length ?? null,
                  format: "number" as const,
                  icon: <Inventory2OutlinedIcon fontSize="small" />,
                  accent: "#274c77"
                },
                {
                  key: "pallets",
                  label: t("billingTrackedPallets"),
                  value: storageSettlementTrackedPallets,
                  previousValue: previousPeriodPreview?.storageRows.reduce((sum, r) => sum + r.palletsTracked, 0) ?? null,
                  format: "number" as const,
                  icon: <LocalShippingOutlinedIcon fontSize="small" />,
                  accent: "#1b998b"
                },
                {
                  key: "palletDays",
                  label: t("palletDays"),
                  value: storageSettlementPalletDays,
                  previousValue: previousPeriodPreview?.summary.palletDays ?? null,
                  format: "number" as const,
                  icon: <CalendarMonthOutlinedIcon fontSize="small" />,
                  accent: "#7b5ea7"
                },
                {
                  key: "total",
                  label: t("billingStorageCharges"),
                  value: storageSettlementTotal,
                  previousValue: previousPeriodPreview?.storageRows.reduce((sum, r) => sum + r.amount, 0) ?? null,
                  format: "currency" as const,
                  icon: <PaidOutlinedIcon fontSize="small" />,
                  accent: "#2e7d32",
                  emphasize: true
                }
              ]
            : [
                {
                  key: "containers",
                  label: t("billingReceivedContainers"),
                  value: billingPreview.summary.receivedContainers,
                  previousValue: previousPeriodPreview?.summary.receivedContainers ?? null,
                  format: "number" as const,
                  icon: <Inventory2OutlinedIcon fontSize="small" />,
                  accent: "#274c77"
                },
                {
                  key: "pallets",
                  label: t("billingReceivedPallets"),
                  value: billingPreview.summary.receivedPallets,
                  previousValue: previousPeriodPreview?.summary.receivedPallets ?? null,
                  format: "number" as const,
                  icon: <LocalShippingOutlinedIcon fontSize="small" />,
                  accent: "#1b998b"
                },
                {
                  key: "palletDays",
                  label: t("palletDays"),
                  value: billingPreview.summary.palletDays,
                  previousValue: previousPeriodPreview?.summary.palletDays ?? null,
                  format: "number" as const,
                  icon: <CalendarMonthOutlinedIcon fontSize="small" />,
                  accent: "#7b5ea7"
                },
                {
                  key: "total",
                  label: t("billingGrandTotal"),
                  value: billingPreview.summary.grandTotal,
                  previousValue: previousPeriodPreview?.summary.grandTotal ?? null,
                  format: "currency" as const,
                  icon: <PaidOutlinedIcon fontSize="small" />,
                  accent: "#2e7d32",
                  emphasize: true
                }
              ]
          ).map((metric) => renderMetricCard(metric, t))}
        </Box>

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
                  ...(billingPreview.summary.storageDiscountAmount > 0
                    ? [{ label: t("billingDiscount"), value: -billingPreview.summary.storageDiscountAmount }]
                    : []),
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
                disabled={isCreatingInvoice || busyActionKey !== null}
                startIcon={isCreatingInvoice ? <InlineLoadingIndicator /> : <AddCircleOutlineOutlinedIcon fontSize="small" />}
                aria-busy={isCreatingInvoice}
                onClick={handleCreateInvoice}
              >
                {workspaceMode === "STORAGE_SETTLEMENT" ? t("billingCreateStorageInvoice") : t("billingCreateMixedInvoice")}
              </Button>
            )}
          </div>
        )}

        {customerId === "all" && !hasBillablePreview && (
          <div style={{ margin: "0 1rem 1rem", padding: "1rem 1.25rem", background: "rgba(0,0,0,0.02)", borderRadius: "var(--radius-md)", border: "1px dashed var(--gray-4)", textAlign: "center", color: "var(--ink-soft)", fontSize: "0.875rem" }}>
            {workspaceMode === "STORAGE_SETTLEMENT" ? t("billingStorageSettlementCustomerRequired") : t("billingWorkflowHint")}
          </div>
        )}

        </>)}

        {isHistoryTab && (
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

        )}

        {isCreateTab && (<>
        {/* ── Container billing breakdown ── */}
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
                      <th>{t("billingDiscount")}</th>
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
                        <td className="cell--mono">{formatDiscountMoney(row.discountAmount)}</td>
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

        {/* ── Collapsible detail sections ── */}
        {showDetailSections && (
          <>
            {/* Daily pallet balance */}
            <div className="report-grid">
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
        </>)}
      </section>
      <ExportExcelDialog
        open={isExportDialogOpen}
        defaultTitle={exportTitle}
        defaultColumns={exportColumns}
        onClose={() => setIsExportDialogOpen(false)}
        onExport={handleExportExcel}
      />
      <Drawer
        anchor="right"
        open={isRateDrawerOpen}
        onClose={() => setIsRateDrawerOpen(false)}
        PaperProps={{ sx: { width: { xs: "100%", sm: 420 } } }}
      >
        <Box sx={{ p: 3, display: "flex", flexDirection: "column", gap: 2, height: "100%" }}>
          <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                {t("billingRateCard")}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("billingRateCardDesc")}
              </Typography>
            </Box>
            <IconButton size="small" aria-label={t("close") ?? "Close"} onClick={() => setIsRateDrawerOpen(false)}>
              <ClearOutlinedIcon fontSize="small" />
            </IconButton>
          </Box>
          <Divider />
          <Stack spacing={2} sx={{ overflowY: "auto", pb: 2 }}>
            {[
              { key: "inboundContainerFee", label: t("billingInboundContainerFee"), value: rates.inboundContainerFee, set: (n: number) => setRates((c) => ({ ...c, inboundContainerFee: n })) },
              { key: "transferInboundFeePerPallet", label: t("billingTransferInboundFee"), value: rates.transferInboundFeePerPallet, set: (n: number) => setRates((c) => ({ ...c, transferInboundFeePerPallet: n })) },
              { key: "wrappingFeePerPallet", label: t("billingWrappingFee"), value: rates.wrappingFeePerPallet, set: (n: number) => setRates((c) => ({ ...c, wrappingFeePerPallet: n })) },
              { key: "storageFeePerPalletPerWeekNormal", label: t("billingStorageRateNormal"), value: rates.storageFeePerPalletPerWeekNormal, set: (n: number) => setRates((c) => ({ ...c, storageFeePerPalletPerWeek: n, storageFeePerPalletPerWeekNormal: n })) },
              { key: "storageFeePerPalletPerWeekWestCoastTransfer", label: t("billingStorageRateWestCoast"), value: rates.storageFeePerPalletPerWeekWestCoastTransfer, set: (n: number) => setRates((c) => ({ ...c, storageFeePerPalletPerWeekWestCoastTransfer: n })) },
              { key: "outboundFeePerPallet", label: t("billingOutboundFee"), value: rates.outboundFeePerPallet, set: (n: number) => setRates((c) => ({ ...c, outboundFeePerPallet: n })) }
            ].map((field) => (
              <TextField
                key={field.key}
                size="small"
                type="number"
                label={field.label}
                value={field.value}
                onChange={(event) => field.set(toNumber(event.target.value))}
                inputProps={{ min: 0, step: 0.01 }}
                InputProps={{
                  startAdornment: <InputAdornment position="start">$</InputAdornment>
                }}
                fullWidth
              />
            ))}
          </Stack>
          <Box sx={{ mt: "auto" }}>
            <Divider sx={{ mb: 2 }} />
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "text.secondary" }}>
              <WarehouseOutlinedIcon fontSize="small" />
              <Typography variant="caption">
                <strong>{t("billingCustomerScope")}:</strong> {billingPreview.customerName}
              </Typography>
            </Box>
          </Box>
        </Box>
      </Drawer>
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

function formatDiscountMoney(value: number) {
  return value === 0 ? formatMoney(0) : formatMoney(-Math.abs(value));
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
    notes: buildStorageSettlementNotes(row),
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
      { key: "discountAmount", label: t("billingDiscount"), numberFormat: "currency" },
      { key: "amount", label: t("amount"), numberFormat: "currency" }
    ];
    return [
      ...base,
      { key: "segmentStart", label: t("billingSegmentStart") },
      { key: "segmentEnd", label: t("billingSegmentEnd") },
      { key: "dayEndPallets", label: t("billingDayEndPallets"), numberFormat: "number" },
      { key: "billedDays", label: t("billingBilledDays"), numberFormat: "number" },
      { key: "segmentPalletDays", label: t("palletDays"), numberFormat: "number" },
      { key: "segmentDiscountAmount", label: t("billingDiscount"), numberFormat: "currency" },
      { key: "segmentAmount", label: t("billingStorageCharges"), numberFormat: "currency" }
    ];
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
  return [
    ...base,
    { key: "segmentStart", label: t("billingSegmentStart") },
    { key: "segmentEnd", label: t("billingSegmentEnd") },
    { key: "dayEndPallets", label: t("billingDayEndPallets"), numberFormat: "number" },
    { key: "billedDays", label: t("billingBilledDays"), numberFormat: "number" },
    { key: "segmentPalletDays", label: t("palletDays"), numberFormat: "number" },
    { key: "segmentDiscountAmount", label: t("billingDiscount"), numberFormat: "currency" },
    { key: "segmentAmount", label: t("billingStorageCharges"), numberFormat: "currency" }
  ];
}

function buildBillingPageExportRows({
  workspaceMode,
  invoiceLines,
  storageRows,
  timeZone,
  t
}: {
  workspaceMode: BillingWorkspaceMode;
  invoiceLines: BillingInvoiceLine[];
  storageRows: BillingStorageRow[];
  timeZone: string;
  t: (key: string) => string;
}): Array<Record<string, ExcelExportCell>> {
  if (workspaceMode === "STORAGE_SETTLEMENT") {
    return flattenStorageSettlementRows(storageRows, t);
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

  rows.push(...flattenOverviewStorageSegments(storageRows, t));

  return rows;
}

function flattenStorageSettlementRows(
  storageRows: BillingStorageRow[],
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
        discountAmount: -row.discountAmount,
        amount: row.amount
    });
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
        segmentDiscountAmount: -segment.discountAmount,
        segmentAmount: segment.amount
      });
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
        segmentDiscountAmount: -segment.discountAmount,
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
  warehouseName?: string,
  containerTypeLabelValue?: string
) {
  const normalizedCustomer = customerName.trim() || "all-customers";
  const normalizedWarehouse = warehouseName?.trim();
  const normalizedContainerType = containerTypeLabelValue?.trim();
  return `${baseTitle} ${normalizedCustomer}${normalizedWarehouse ? ` ${normalizedWarehouse}` : ""}${normalizedContainerType ? ` ${normalizedContainerType}` : ""} ${startDate} to ${endDate}`;
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
  return containerType === "WEST_COAST_TRANSFER" ? "Transfer" : "Normal";
}

function buildStorageSettlementNotes(row: BillingStorageRow) {
  const parts = [
    containerTypeExportLabel(row.containerType),
    `${row.palletsTracked} pallets tracked across ${row.warehousesTouched.length} warehouse(s)`
  ];

  if (row.freePalletDays > 0) {
    parts.push(`${row.freePalletDays} free pallet-days`);
  }
  if (row.discountAmount > 0) {
    parts.push(`grace discount -${formatMoney(row.discountAmount)}`);
  }

  return parts.join(" | ");
}

function toLocalDate(value: string): Date | null {
  const parts = value.split("-").map((p) => Number(p));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [year, month, day] = parts;
  return new Date(year, month - 1, day);
}

function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function computePreviousPeriodRange(startDate: string, endDate: string): { startDate: string; endDate: string } | null {
  const start = toLocalDate(startDate);
  const end = toLocalDate(endDate);
  if (!start || !end || end < start) return null;
  const msPerDay = 24 * 60 * 60 * 1000;
  const durationDays = Math.round((end.getTime() - start.getTime()) / msPerDay);
  const prevEnd = new Date(start.getTime() - msPerDay);
  const prevStart = new Date(prevEnd.getTime() - durationDays * msPerDay);
  return { startDate: toIsoDate(prevStart), endDate: toIsoDate(prevEnd) };
}

type BillingDatePreset = {
  key: string;
  labelKey: string;
  startDate: string;
  endDate: string;
};

function getDateRangePresets(now = new Date()): BillingDatePreset[] {
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  const ytdStart = new Date(now.getFullYear(), 0, 1);
  const ytdEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const last30Start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
  const last30End = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return [
    { key: "thisMonth", labelKey: "billingPresetThisMonth", startDate: toIsoDate(currentMonthStart), endDate: toIsoDate(currentMonthEnd) },
    { key: "lastMonth", labelKey: "billingPresetLastMonth", startDate: toIsoDate(lastMonthStart), endDate: toIsoDate(lastMonthEnd) },
    { key: "last30", labelKey: "billingPresetLast30", startDate: toIsoDate(last30Start), endDate: toIsoDate(last30End) },
    { key: "ytd", labelKey: "billingPresetYTD", startDate: toIsoDate(ytdStart), endDate: toIsoDate(ytdEnd) }
  ];
}

type MetricCardSpec = {
  key: string;
  label: string;
  value: number;
  previousValue: number | null;
  format: "number" | "currency";
  icon: React.ReactNode;
  accent: string;
  emphasize?: boolean;
};

function renderMetricCard(metric: MetricCardSpec, t: (key: string) => string) {
  const formatted = metric.format === "currency" ? formatMoney(metric.value) : formatNumber(metric.value);
  const delta = computeDelta(metric.value, metric.previousValue);
  return (
    <Box
      key={metric.key}
      sx={{
        position: "relative",
        p: 2,
        borderRadius: 2,
        border: "1px solid",
        borderColor: "divider",
        background: metric.emphasize
          ? `linear-gradient(135deg, ${hexToRgba(metric.accent, 0.1)} 0%, ${hexToRgba(metric.accent, 0.02)} 100%)`
          : "background.paper",
        display: "flex",
        flexDirection: "column",
        gap: 1,
        overflow: "hidden"
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
        <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          {metric.label}
        </Typography>
        <Box
          sx={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: hexToRgba(metric.accent, 0.12),
            color: metric.accent
          }}
        >
          {metric.icon}
        </Box>
      </Box>
      <Typography
        variant={metric.emphasize ? "h4" : "h5"}
        sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "text.primary" }}
      >
        {formatted}
      </Typography>
      {delta ? (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, color: delta.color }}>
          {delta.direction === "up" ? (
            <TrendingUpOutlinedIcon sx={{ fontSize: 16 }} />
          ) : delta.direction === "down" ? (
            <TrendingDownOutlinedIcon sx={{ fontSize: 16 }} />
          ) : (
            <TrendingFlatOutlinedIcon sx={{ fontSize: 16 }} />
          )}
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            {delta.text}
          </Typography>
          <Typography variant="caption" sx={{ color: "text.secondary", ml: 0.25 }}>
            {t("billingVsPrevPeriod")}
          </Typography>
        </Box>
      ) : (
        <Typography variant="caption" sx={{ color: "text.disabled" }}>
          {t("billingNoPrevComparison")}
        </Typography>
      )}
    </Box>
  );
}

function computeDelta(current: number, previous: number | null): { text: string; direction: "up" | "down" | "flat"; color: string } | null {
  if (previous === null) return null;
  if (previous === 0 && current === 0) {
    return { text: "0%", direction: "flat", color: "var(--ink-soft, #64748b)" };
  }
  if (previous === 0) {
    return { text: "New", direction: "up", color: "#2e7d32" };
  }
  const diff = current - previous;
  const pct = (diff / Math.abs(previous)) * 100;
  const rounded = Math.abs(pct) >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10;
  if (Math.abs(pct) < 0.5) {
    return { text: "0%", direction: "flat", color: "#64748b" };
  }
  const direction: "up" | "down" = pct >= 0 ? "up" : "down";
  const color = direction === "up" ? "#2e7d32" : "#c62828";
  const sign = pct >= 0 ? "+" : "";
  return { text: `${sign}${rounded}%`, direction, color };
}

function hexToRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace("#", "");
  const bigint = parseInt(cleaned.length === 3 ? cleaned.split("").map((c) => c + c).join("") : cleaned, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
