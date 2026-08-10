import { type ReactNode, useEffect, useMemo, useState } from "react";
import { BarChart, LineChart } from "@mui/x-charts";

import { InlineAlert } from "./Feedback";
import { SearchSubmitField } from "./SearchSubmitField";
import { api } from "../lib/api";
import { readBillingWorkspaceContext, type BillingWorkspaceContext } from "../lib/billingWorkspaceContext";
import { DEFAULT_BILLING_RATES } from "../lib/billingPreview";
import { parseDateValue, startOfLocalDay, toIsoDateString } from "../lib/dates";
import { getErrorMessage } from "../lib/errors";
import { formatMoney } from "../lib/formatters";
import { useI18n } from "../lib/i18n";
import type {
  Customer,
  Location,
  OperationsReport,
  OperationsReportGranularity,
  OperationsReportMovementTrendRow,
  OperationsReportPalletFlowRow,
  SKUMaster,
  SKUFlowReport,
  SKUFlowReportRow
} from "../lib/types";

type ReportGranularity = OperationsReportGranularity;
type ReportsTab = "overview" | "sku-flow";
type ChartTone = "blue" | "green" | "amber" | "red";
type BarRow = { label: string; value: number; meta?: string; tone?: ChartTone };
type TrendRow = { key: string; label: string; inbound: number; outbound: number };
type PalletFlowRow = OperationsReportPalletFlowRow & { label: string };
type SKUFlowTrendRow = { key: string; label: string; inboundQty: number; outboundQty: number };
export type DailyStorageRow = PalletFlowRow & {
  openingBalance: number;
  storageAmount: number;
};

const shortDateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const mediumDateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });
const yearFormatter = new Intl.DateTimeFormat("en-US", { year: "numeric" });
const numberFormatter = new Intl.NumberFormat("en-US");
const decimalFormatter = new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
const DEFAULT_REPORT_DAILY_STORAGE_RATE = DEFAULT_BILLING_RATES.storageFeePerPalletPerWeekNormal / 7;

type ReportsPageProps = {
  locations: Location[];
  customers: Customer[];
  skuMasters: SKUMaster[];
  isLoading: boolean;
  errorMessage: string;
};

export function ReportsPage({ locations, customers, skuMasters, isLoading, errorMessage }: ReportsPageProps) {
  const { t } = useI18n();
  const currentMonth = useMemo(() => getCurrentMonthDateRange(), []);
  const [activeReportTab, setActiveReportTab] = useState<ReportsTab>("overview");
  const [selectedLocationId, setSelectedLocationId] = useState("all");
  const [selectedCustomerId, setSelectedCustomerId] = useState("all");
  const [reportStartDate, setReportStartDate] = useState(currentMonth.start);
  const [reportEndDate, setReportEndDate] = useState(currentMonth.end);
  const [searchTerm, setSearchTerm] = useState("");
  const [submittedSearchTerm, setSubmittedSearchTerm] = useState("");
  const [reportGranularity, setReportGranularity] = useState<ReportGranularity>("day");
  const [dailyStorageRate, setDailyStorageRate] = useState<number | null>(() => (
    resolveReportDailyStorageRate(readBillingWorkspaceContext())
  ));
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [report, setReport] = useState<OperationsReport | null>(null);
  const [isReportLoading, setIsReportLoading] = useState(false);
  const [reportErrorMessage, setReportErrorMessage] = useState("");
  const [selectedSKUMasterId, setSelectedSKUMasterId] = useState("");
  const [selectedSKUFlowCustomerId, setSelectedSKUFlowCustomerId] = useState("all");
  const [selectedSKUFlowLocationId, setSelectedSKUFlowLocationId] = useState("all");
  const [skuFlowStartDate, setSKUFlowStartDate] = useState(currentMonth.start);
  const [skuFlowEndDate, setSKUFlowEndDate] = useState(currentMonth.end);
  const [skuFlowReport, setSKUFlowReport] = useState<SKUFlowReport | null>(null);
  const [isSKUFlowLoading, setIsSKUFlowLoading] = useState(false);
  const [skuFlowErrorMessage, setSKUFlowErrorMessage] = useState("");
  const normalizedSearch = submittedSearchTerm.trim();

  const normalizedDateRange = useMemo(
    () => normalizeDateRange(reportStartDate || currentMonth.start, reportEndDate || currentMonth.end),
    [currentMonth.end, currentMonth.start, reportEndDate, reportStartDate]
  );
  const normalizedSKUFlowDateRange = useMemo(
    () => normalizeDateRange(skuFlowStartDate || currentMonth.start, skuFlowEndDate || currentMonth.end),
    [currentMonth.end, currentMonth.start, skuFlowEndDate, skuFlowStartDate]
  );
  const selectedLocationName = useMemo(() => {
    if (selectedLocationId === "all") {
      return null;
    }

    return locations.find((location) => location.id === Number(selectedLocationId))?.name ?? null;
  }, [locations, selectedLocationId]);
  const selectedCustomerName = useMemo(() => {
    if (selectedCustomerId === "all") {
      return null;
    }

    return customers.find((customer) => customer.id === Number(selectedCustomerId))?.name ?? null;
  }, [customers, selectedCustomerId]);
  const selectedSKUMaster = useMemo(
    () => skuMasters.find((skuMaster) => skuMaster.id === Number(selectedSKUMasterId)) ?? null,
    [selectedSKUMasterId, skuMasters]
  );
  const selectedSKUFlowCustomerName = useMemo(() => {
    if (selectedSKUFlowCustomerId === "all") {
      return null;
    }

    return customers.find((customer) => customer.id === Number(selectedSKUFlowCustomerId))?.name ?? null;
  }, [customers, selectedSKUFlowCustomerId]);
  const selectedSKUFlowLocationName = useMemo(() => {
    if (selectedSKUFlowLocationId === "all") {
      return null;
    }

    return locations.find((location) => location.id === Number(selectedSKUFlowLocationId))?.name ?? null;
  }, [locations, selectedSKUFlowLocationId]);

  useEffect(() => {
    if (!selectedSKUMasterId && skuMasters.length > 0) {
      setSelectedSKUMasterId(String(skuMasters[0].id));
    }
  }, [selectedSKUMasterId, skuMasters]);

  useEffect(() => {
    if (activeReportTab !== "overview") {
      return;
    }

    let isActive = true;

    async function loadReport() {
      setIsReportLoading(true);
      setReportErrorMessage("");
      try {
        const nextReport = await api.getOperationsReport({
          startDate: normalizedDateRange.start,
          endDate: normalizedDateRange.end,
          locationId: selectedLocationId === "all" ? "all" : Number(selectedLocationId),
          customerId: selectedCustomerId === "all" ? "all" : Number(selectedCustomerId),
          search: normalizedSearch,
          granularity: reportGranularity
        });
        if (isActive) {
          setReport(nextReport);
        }
      } catch (error) {
        if (isActive) {
          setReport(null);
          setReportErrorMessage(getErrorMessage(error, t("couldNotLoadReport")));
        }
      } finally {
        if (isActive) {
          setIsReportLoading(false);
        }
      }
    }

    void loadReport();

    return () => {
      isActive = false;
    };
  }, [
    normalizedDateRange.end,
    normalizedDateRange.start,
    normalizedSearch,
    reportGranularity,
    selectedCustomerId,
    selectedLocationId,
    t,
    activeReportTab
  ]);

  useEffect(() => {
    if (activeReportTab !== "sku-flow") {
      return;
    }

    const skuMasterId = Number(selectedSKUMasterId);
    if (!skuMasterId) {
      setSKUFlowReport(null);
      return;
    }

    let isActive = true;

    async function loadSKUFlowReport() {
      setIsSKUFlowLoading(true);
      setSKUFlowErrorMessage("");
      try {
        const nextReport = await api.getSKUFlowReport({
          skuMasterId,
          startDate: normalizedSKUFlowDateRange.start,
          endDate: normalizedSKUFlowDateRange.end,
          customerId: selectedSKUFlowCustomerId === "all" ? "all" : Number(selectedSKUFlowCustomerId),
          locationId: selectedSKUFlowLocationId === "all" ? "all" : Number(selectedSKUFlowLocationId)
        });
        if (isActive) {
          setSKUFlowReport(nextReport);
        }
      } catch (error) {
        if (isActive) {
          setSKUFlowReport(null);
          setSKUFlowErrorMessage(getErrorMessage(error, t("couldNotLoadReport")));
        }
      } finally {
        if (isActive) {
          setIsSKUFlowLoading(false);
        }
      }
    }

    void loadSKUFlowReport();

    return () => {
      isActive = false;
    };
  }, [
    activeReportTab,
    normalizedSKUFlowDateRange.end,
    normalizedSKUFlowDateRange.start,
    selectedSKUFlowCustomerId,
    selectedSKUFlowLocationId,
    selectedSKUMasterId,
    t
  ]);

  const locationRows = useMemo(
    () => (report?.locationInventoryRows ?? []).map((row) => ({
      label: row.label,
      value: row.value,
      meta: `${formatNumber(row.skuCount)} ${t("reportSkuPositions")}`,
      tone: "blue" as const
    })),
    [report?.locationInventoryRows, t]
  );
  const topSkuRows = useMemo(
    () => (report?.topSkuRows ?? []).map((row) => ({
      label: row.label,
      value: row.value,
      meta: row.description,
      tone: "green" as const
    })),
    [report?.topSkuRows]
  );
  const palletFlowRows = useMemo(
    () => mapPalletFlowRows(report?.palletFlowRows ?? []),
    [report?.palletFlowRows]
  );
  const movementTrendGranularity = report?.granularity ?? reportGranularity;
  const movementTrendRows = useMemo(
    () => mapMovementTrendRows(report?.movementTrendRows ?? [], movementTrendGranularity),
    [movementTrendGranularity, report?.movementTrendRows]
  );
  const dailyStorageRows = useMemo(
    () => mapDailyStorageRows(palletFlowRows, dailyStorageRate ?? 0),
    [dailyStorageRate, palletFlowRows]
  );

  const summary = report?.summary;
  const onHandUnits = summary?.onHandUnits ?? 0;
  const activeContainers = summary?.activeContainers ?? 0;
  const receivedPallets = summary?.palletsIn ?? 0;
  const shippedPallets = summary?.palletsOut ?? 0;
  const transferInPallets = summary?.transferInPallets ?? 0;
  const transferOutPallets = summary?.transferOutPallets ?? 0;
  const netPalletFlow = summary?.netPalletFlow ?? 0;
  const activeSkuCount = summary?.activeSkuCount ?? 0;
  const activeWarehouseCount = summary?.activeWarehouseCount ?? 0;
  const topWarehouse = locationRows[0] ?? null;
  const endingBalance = summary?.endingBalance ?? 0;
  const peakBalance = summary?.peakBalance ?? 0;
  const averageBalance = summary?.averageBalance ?? 0;
  const hasDailyStorageRate = dailyStorageRate !== null;
  const latestDailyStorageAmount = hasDailyStorageRate
    ? dailyStorageRows[dailyStorageRows.length - 1]?.storageAmount ?? 0
    : null;
  const periodStorageAmount = hasDailyStorageRate
    ? dailyStorageRows.reduce((total, row) => total + row.storageAmount, 0)
    : null;
  const peakDailyStorageAmount = hasDailyStorageRate
    ? dailyStorageRows.reduce((highest, row) => Math.max(highest, row.storageAmount), 0)
    : null;
  const advancedFilterCount = Number(normalizedSearch.length > 0)
    + Number(reportGranularity !== "day");
  const emptyLabel = isLoading || isReportLoading ? t("loadingRecords") : t("noResults");
  const scopeRangeLabel = formatDateRangeSummary(normalizedDateRange.start, normalizedDateRange.end);
  const skuFlowRangeLabel = formatDateRangeSummary(normalizedSKUFlowDateRange.start, normalizedSKUFlowDateRange.end);
  const skuFlowSummary = skuFlowReport?.summary;
  const skuFlowRows = skuFlowReport?.rows ?? [];
  const skuFlowTrendRows = useMemo(
    () => mapSKUFlowTrendRows(skuFlowReport?.rows ?? []),
    [skuFlowReport?.rows]
  );
  const skuFlowEmptyLabel = skuMasters.length === 0
    ? t("skuFlowNoSku")
    : isSKUFlowLoading
      ? t("loadingRecords")
      : t("skuFlowNoData");
  const selectedSKULabel = selectedSKUMaster
    ? [selectedSKUMaster.sku, selectedSKUMaster.description || selectedSKUMaster.name].filter(Boolean).join(" - ")
    : t("selectSku");

  function submitSearchTerm() {
    const nextSearchTerm = searchTerm.trim();
    setSearchTerm(nextSearchTerm);
    setSubmittedSearchTerm(nextSearchTerm);
  }

  return (
    <main className="workspace-main">
      {errorMessage ? <InlineAlert>{errorMessage}</InlineAlert> : null}
      {reportErrorMessage ? <InlineAlert>{reportErrorMessage}</InlineAlert> : null}
      {skuFlowErrorMessage ? <InlineAlert>{skuFlowErrorMessage}</InlineAlert> : null}

      <section className="workbook-panel workbook-panel--full reports-exec reports-exec--pallet-ledger">
        <ReportTabNav activeTab={activeReportTab} onChange={setActiveReportTab} />

        {activeReportTab === "overview" ? (
          <>
        <header className="reports-exec__hero reports-exec__hero--ledger">
          <div className="reports-exec__hero-copy">
            <span className="reports-exec__eyebrow">{t("reportsPalletStorageBadge")}</span>
            <h2>{t("reportOverviewTitle")}</h2>
            <p>{t("reportsPalletStorageSubtitle")}</p>
          </div>
          <div className="reports-exec__hero-brief reports-exec__hero-brief--cost">
            <span className="reports-exec__hero-metric-label">{t("reportsLatestDailyStorage")}</span>
            <strong>{formatOptionalMoney(latestDailyStorageAmount)}</strong>
            <p>{hasDailyStorageRate
              ? t("reportsDailyStorageRateMeta", { rate: formatMoney(dailyStorageRate) })
              : t("reportsStorageRateRequired")}
            </p>
            <div className="reports-exec__hero-pills">
              <span>{t("reportsSelectedPeriod")}: {scopeRangeLabel}</span>
              <span>{t("customer")}: {selectedCustomerName ?? t("allCustomers")}</span>
              <span>{t("warehouseMapWarehouseFilter")}: {selectedLocationName ?? t("allWarehouses")}</span>
            </div>
          </div>
        </header>

        <section className="reports-exec__filters">
          <div className="filter-bar reports-exec__filters-main">
            <label>
              {t("fromDate")}
              <input type="date" value={reportStartDate} onChange={(event) => setReportStartDate(event.target.value)} />
            </label>
            <label>
              {t("toDate")}
              <input type="date" value={reportEndDate} onChange={(event) => setReportEndDate(event.target.value)} />
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
              {t("warehouseMapWarehouseFilter")}
              <select value={selectedLocationId} onChange={(event) => setSelectedLocationId(event.target.value)}>
                <option value="all">{t("allWarehouses")}</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>{location.name}</option>
                ))}
              </select>
            </label>
            <label>
              {t("reportsDailyStorageRate")}
              <input
                type="number"
                min="0"
                step="0.01"
                value={dailyStorageRate ?? ""}
                placeholder={t("reportsStorageRateRequiredShort")}
                onChange={(event) => setDailyStorageRate(parseOptionalNonNegativeNumber(event.target.value))}
              />
            </label>
          </div>

          <div className="reports-exec__filters-actions">
            <button
              type="button"
              className="button button--ghost button--small"
              onClick={() => setShowAdvancedFilters((current) => !current)}
            >
              {showAdvancedFilters ? t("hideAdvancedFilters") : t("showAdvancedFilters")}
              {advancedFilterCount > 0 ? ` (${advancedFilterCount})` : ""}
            </button>
          </div>

          {showAdvancedFilters ? (
            <div className="filter-bar reports-exec__filters-advanced">
              <SearchSubmitField
                label={t("search")}
                value={searchTerm}
                onChange={setSearchTerm}
                onSubmit={submitSearchTerm}
                placeholder={t("searchSkuPlaceholder")}
                submitTitle={`${t("search")} (Enter)`}
              />
              <label>
                {t("groupBy")}
                <select
                  value={reportGranularity}
                  onChange={(event) => setReportGranularity(event.target.value as ReportGranularity)}
                >
                  <option value="day">{t("daily")}</option>
                  <option value="month">{t("monthly")}</option>
                  <option value="year">{t("yearly")}</option>
                </select>
              </label>
            </div>
          ) : null}
        </section>

        <div className="reports-exec__scope-strip">
          <ScopeChip label={t("reportsScopeDate")} value={scopeRangeLabel} />
          <ScopeChip label={t("customer")} value={selectedCustomerName ?? t("allCustomers")} />
          <ScopeChip label={t("warehouseMapWarehouseFilter")} value={selectedLocationName ?? t("allWarehouses")} />
        </div>

        <section className="reports-exec__summary">
          <SectionHeading
            title={t("reportsPalletStoragePulse")}
            subtitle={t("reportsPalletStoragePulseDesc")}
          />

          <div className="reports-exec__priority-kpis">
            <PriorityMetricCard
              label={t("reportsEndingPallets")}
              value={formatNumber(endingBalance)}
              unit={t("pallets")}
              meta={t("reportsEndingPalletsMeta")}
              tone="navy"
            />
            <PriorityMetricCard
              label={t("reportsLatestDailyStorage")}
              value={formatOptionalMoney(latestDailyStorageAmount)}
              unit={t("reportsPerDay")}
              meta={t("reportsLatestDailyStorageMeta")}
              tone="amber"
            />
            <PriorityMetricCard
              label={t("reportsPeriodStorageEstimate")}
              value={formatOptionalMoney(periodStorageAmount)}
              unit={t("reportsSelectedPeriod")}
              meta={t("reportsPeriodStorageEstimateMeta")}
              tone="green"
            />
            <PriorityMetricCard
              label={t("reportsInsightNetPalletFlow")}
              value={formatSignedNumber(netPalletFlow)}
              unit={t("pallets")}
              meta={t("reportsPalletMovementMeta", {
                received: formatNumber(receivedPallets),
                shipped: formatNumber(shippedPallets),
                transferIn: formatNumber(transferInPallets),
                transferOut: formatNumber(transferOutPallets)
              })}
              tone={netPalletFlow >= 0 ? "green" : "red"}
            />
          </div>

          <ReportCard
            title={t("endOfDayPallets")}
            subtitle={t("endOfDayPalletsDesc")}
            variant="primary"
            className="report-card--pallet-balance"
          >
            <DailyPalletBalanceChart
              rows={palletFlowRows}
              emptyLabel={emptyLabel}
              label={t("endOfDayPallets")}
              unitLabel={t("pallets")}
            />
            <StatStrip
              stats={[
                { label: t("reportsEndingPallets"), value: `${formatNumber(endingBalance)} ${t("pallets")}` },
                { label: t("reportsPeakBalance"), value: `${formatNumber(peakBalance)} ${t("pallets")}` },
                { label: t("reportsAverageBalance"), value: `${formatDecimalNumber(averageBalance)} ${t("pallets")}` }
              ]}
            />
          </ReportCard>

          <div className="reports-exec__priority-grid">
            <ReportCard
              title={t("dailyPalletFlow")}
              subtitle={t("dailyPalletFlowDesc")}
              variant="primary"
              className="report-card--pallet-flow"
            >
              <PalletFlowChart
                rows={palletFlowRows}
                emptyLabel={emptyLabel}
                receivedLabel={t("reportsKpiPalletsIn")}
                shippedLabel={t("reportsKpiPalletsOut")}
                transferInLabel={t("reportsTransferInPallets")}
                transferOutLabel={t("reportsTransferOutPallets")}
              />
              <StatStrip
                stats={[
                  { label: t("reportsKpiPalletsIn"), value: `${formatNumber(receivedPallets)} ${t("pallets")}` },
                  { label: t("reportsKpiPalletsOut"), value: `${formatNumber(shippedPallets)} ${t("pallets")}` },
                  { label: t("reportsTransferInPallets"), value: `${formatNumber(transferInPallets)} ${t("pallets")}` },
                  { label: t("reportsTransferOutPallets"), value: `${formatNumber(transferOutPallets)} ${t("pallets")}` },
                  { label: t("reportsNetFlow"), value: `${formatSignedNumber(netPalletFlow)} ${t("pallets")}` }
                ]}
              />
            </ReportCard>

            <ReportCard
              title={t("reportsDailyStorageCost")}
              subtitle={hasDailyStorageRate
                ? t("reportsDailyStorageCostDesc", { rate: formatMoney(dailyStorageRate) })
                : t("reportsStorageRateRequired")}
              variant="primary"
              className="report-card--storage-cost"
            >
              <DailyStorageCostChart
                rows={dailyStorageRows}
                emptyLabel={emptyLabel}
                label={t("reportsDailyStorageCost")}
                isRateConfigured={hasDailyStorageRate}
                unavailableLabel={t("reportsStorageRateRequired")}
              />
              <StatStrip
                stats={[
                  { label: t("reportsPeriodStorageEstimate"), value: formatOptionalMoney(periodStorageAmount) },
                  { label: t("reportsPeakDailyStorage"), value: formatOptionalMoney(peakDailyStorageAmount) },
                  { label: t("reportsDailyStorageRateShort"), value: formatOptionalMoney(dailyStorageRate) }
                ]}
              />
            </ReportCard>
          </div>

          <ReportCard
            title={t("reportsDailyPalletLedger")}
            subtitle={t("reportsDailyPalletLedgerDesc")}
            variant="secondary"
            className="report-card--daily-ledger"
          >
            <DailyPalletLedger
              rows={dailyStorageRows}
              emptyLabel={emptyLabel}
              isRateConfigured={hasDailyStorageRate}
            />
            <p className="reports-exec__estimate-note">{t("reportsStorageEstimateDisclaimer")}</p>
          </ReportCard>
        </section>

        <section className="reports-exec__detail">
          <SectionHeading
            title={t("reportsInventoryContextTitle")}
            subtitle={t("reportsInventoryContextDesc")}
          />

          <div className="reports-exec__context-strip">
            <ExecutiveInsightCard
              label={t("reportsKpiOnHandUnits")}
              value={`${formatNumber(onHandUnits)} ${t("units")}`}
              meta={t("reportsKpiOnHandUnitsMeta", {
                skus: formatNumber(activeSkuCount),
                warehouses: formatNumber(activeWarehouseCount)
              })}
              tone="blue"
            />
            <ExecutiveInsightCard
              label={t("reportsKpiActiveContainers")}
              value={formatNumber(activeContainers)}
              meta={t("reportsKpiActiveContainersMeta")}
              tone="green"
            />
            <ExecutiveInsightCard
              label={t("reportsPeakBalance")}
              value={`${formatNumber(peakBalance)} ${t("pallets")}`}
              meta={`${t("reportsAverageBalance")}: ${formatDecimalNumber(averageBalance)}`}
              tone="amber"
            />
            <ExecutiveInsightCard
              label={t("reportsInsightLargestWarehouse")}
              value={topWarehouse?.label ?? t("reportsInsightLargestWarehouseEmpty")}
              meta={topWarehouse
                ? `${formatNumber(topWarehouse.value)} ${t("units")}`
                : t("reportsInsightLargestWarehouseEmpty")}
              tone="blue"
            />
          </div>

          <div className="reports-exec__detail-grid reports-exec__detail-grid--supporting">
            <ReportCard title={t("inventoryByStorage")} variant="secondary">
              <HorizontalBarList rows={locationRows} emptyLabel={emptyLabel} valueSuffix={t("units")} />
            </ReportCard>
            <ReportCard title={t("topSkuOnHand")} variant="secondary">
              <HorizontalBarList rows={topSkuRows} emptyLabel={emptyLabel} valueSuffix={t("units")} />
            </ReportCard>

            <ReportCard title={t("movementTrend")} variant="secondary">
              <MovementTrendChart
                rows={movementTrendRows}
                emptyLabel={emptyLabel}
                inboundLabel={t("reportsKpiPalletsIn")}
                outboundLabel={t("reportsKpiPalletsOut")}
              />
            </ReportCard>
          </div>
        </section>
          </>
        ) : (
          <section className="sku-flow-report">
            <header className="reports-exec__hero sku-flow-report__hero">
              <div className="reports-exec__hero-copy">
                <span className="reports-exec__eyebrow">{t("skuFlowBadge")}</span>
                <h2>{t("skuFlowTitle")}</h2>
                <p>{t("skuFlowSubtitle")}</p>
              </div>
              <div className="reports-exec__hero-brief">
                <strong>{selectedSKULabel}</strong>
                <p>{t("skuFlowBrief")}</p>
                <div className="reports-exec__hero-pills">
                  <span>{t("reportsSelectedPeriod")}: {skuFlowRangeLabel}</span>
                  <span>{t("sku")}: {skuFlowReport?.sku || selectedSKUMaster?.sku || "-"}</span>
                  <span>{t("customer")}: {selectedSKUFlowCustomerName ?? t("allCustomers")}</span>
                  <span>{t("warehouseMapWarehouseFilter")}: {selectedSKUFlowLocationName ?? t("allWarehouses")}</span>
                </div>
              </div>
            </header>

            <section className="reports-exec__filters sku-flow-report__filters">
              <div className="filter-bar reports-exec__filters-main">
                <label>
                  {t("sku")}
                  <select
                    value={selectedSKUMasterId}
                    onChange={(event) => setSelectedSKUMasterId(event.target.value)}
                    disabled={skuMasters.length === 0}
                  >
                    {skuMasters.length === 0 ? <option value="">{t("skuFlowNoSku")}</option> : null}
                    {skuMasters.map((skuMaster) => (
                      <option key={skuMaster.id} value={skuMaster.id}>
                        {[skuMaster.sku, skuMaster.description || skuMaster.name].filter(Boolean).join(" - ")}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("customer")}
                  <select value={selectedSKUFlowCustomerId} onChange={(event) => setSelectedSKUFlowCustomerId(event.target.value)}>
                    <option value="all">{t("allCustomers")}</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>{customer.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("warehouseMapWarehouseFilter")}
                  <select value={selectedSKUFlowLocationId} onChange={(event) => setSelectedSKUFlowLocationId(event.target.value)}>
                    <option value="all">{t("allWarehouses")}</option>
                    {locations.map((location) => (
                      <option key={location.id} value={location.id}>{location.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("fromDate")}
                  <input type="date" value={skuFlowStartDate} onChange={(event) => setSKUFlowStartDate(event.target.value)} />
                </label>
                <label>
                  {t("toDate")}
                  <input type="date" value={skuFlowEndDate} onChange={(event) => setSKUFlowEndDate(event.target.value)} />
                </label>
              </div>
            </section>

            <div className="reports-exec__scope-strip">
              <ScopeChip label={t("sku")} value={skuFlowReport?.sku || selectedSKUMaster?.sku || "-"} />
              <ScopeChip label={t("reportsScopeDate")} value={skuFlowRangeLabel} />
              <ScopeChip label={t("itemNumber")} value={skuFlowReport?.itemNumber || selectedSKUMaster?.itemNumber || "-"} />
              <ScopeChip label={t("customer")} value={selectedSKUFlowCustomerName ?? t("allCustomers")} />
              <ScopeChip label={t("warehouseMapWarehouseFilter")} value={selectedSKUFlowLocationName ?? t("allWarehouses")} />
            </div>

            <section className="reports-exec__summary">
              <SectionHeading title={t("skuFlowSummaryTitle")} subtitle={t("skuFlowSummaryDesc")} />

              <div className="reports-exec__kpi-grid sku-flow-report__kpi-grid">
                <ExecutiveMetricCard
                  label={t("skuFlowCurrentInventory")}
                  value={`${formatNumber(skuFlowSummary?.currentQty ?? 0)} ${t("units")}`}
                  meta={`${formatNumber(skuFlowSummary?.currentPallets ?? 0)} ${t("pallets")}`}
                  tone="blue"
                />
                <ExecutiveMetricCard
                  label={t("skuFlowInboundQty")}
                  value={`${formatNumber(skuFlowSummary?.inboundQty ?? 0)} ${t("units")}`}
                  meta={`${formatNumber(skuFlowSummary?.inboundPallets ?? 0)} ${t("pallets")}`}
                  tone="green"
                />
                <ExecutiveMetricCard
                  label={t("skuFlowOutboundQty")}
                  value={`${formatNumber(skuFlowSummary?.outboundQty ?? 0)} ${t("units")}`}
                  meta={`${formatNumber(skuFlowSummary?.outboundPallets ?? 0)} ${t("pallets")}`}
                  tone="amber"
                />
                <ExecutiveMetricCard
                  label={t("skuFlowNetQty")}
                  value={`${formatSignedNumber(skuFlowSummary?.netQty ?? 0)} ${t("units")}`}
                  meta={t("reportsSelectedPeriod")}
                  tone={(skuFlowSummary?.netQty ?? 0) >= 0 ? "green" : "red"}
                />
                <ExecutiveMetricCard
                  label={t("skuFlowLastShipment")}
                  value={formatOptionalReportDate(skuFlowSummary?.lastOutboundDate ?? "")}
                  meta={t("skuFlowShipmentTiming")}
                  tone="blue"
                />
              </div>

              <ReportCard
                title={t("skuFlowQuantityTrend")}
                subtitle={t("skuFlowQuantityTrendDesc")}
                variant="primary"
                className="report-card--sku-quantity-trend"
              >
                <SKUFlowQuantityTrendChart
                  rows={skuFlowTrendRows}
                  emptyLabel={skuFlowEmptyLabel}
                  inboundLabel={t("skuFlowInboundQty")}
                  outboundLabel={t("skuFlowOutboundQty")}
                  unitLabel={t("units")}
                />
              </ReportCard>

              <ReportCard
                title={t("skuFlowMovementDetail")}
                subtitle={t("skuFlowMovementDetailDesc")}
                variant="primary"
              >
                <SKUFlowReportTable rows={skuFlowRows} emptyLabel={skuFlowEmptyLabel} />
              </ReportCard>
            </section>
          </section>
        )}
      </section>
    </main>
  );
}

function SectionHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="reports-exec__section-heading">
      <h3>{title}</h3>
      {subtitle ? <p>{subtitle}</p> : null}
    </div>
  );
}

function ScopeChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="reports-exec__scope-chip">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ExecutiveMetricCard({
  label,
  value,
  meta,
  tone
}: {
  label: string;
  value: string;
  meta: string;
  tone: ChartTone;
}) {
  return (
    <article className={`reports-exec__metric-card reports-exec__metric-card--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{meta}</small>
    </article>
  );
}

function PriorityMetricCard({
  label,
  value,
  unit,
  meta,
  tone
}: {
  label: string;
  value: string;
  unit: string;
  meta: string;
  tone: "navy" | "amber" | "green" | "red";
}) {
  return (
    <article className={`reports-priority-card reports-priority-card--${tone}`}>
      <span className="reports-priority-card__label">{label}</span>
      <div className="reports-priority-card__value">
        <strong>{value}</strong>
        <span>{unit}</span>
      </div>
      <small>{meta}</small>
    </article>
  );
}

function ExecutiveInsightCard({
  label,
  value,
  meta,
  tone
}: {
  label: string;
  value: string;
  meta: string;
  tone: ChartTone;
}) {
  return (
    <article className={`reports-exec__insight-card reports-exec__insight-card--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{meta}</small>
    </article>
  );
}

function ReportCard({
  title,
  subtitle,
  variant,
  className = "",
  children
}: {
  title: string;
  subtitle?: string;
  variant: "primary" | "secondary";
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`report-card report-card--${variant} ${className}`.trim()}>
      <div className="report-card__header">
        <h3>{title}</h3>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

function ReportTabNav({ activeTab, onChange }: { activeTab: ReportsTab; onChange: (tab: ReportsTab) => void }) {
  const { t } = useI18n();
  const tabs: Array<{ key: ReportsTab; label: string }> = [
    { key: "overview", label: t("reportsTabOverview") },
    { key: "sku-flow", label: t("reportsTabSKUFlow") }
  ];

  return (
    <div className="reports-tab-nav" role="tablist" aria-label={t("reportTabs")}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.key}
          className={`reports-tab-nav__item ${activeTab === tab.key ? "reports-tab-nav__item--active" : ""}`}
          onClick={() => onChange(tab.key)}
        >
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}

function SKUFlowReportTable({ rows, emptyLabel }: { rows: SKUFlowReportRow[]; emptyLabel: string }) {
  const { t } = useI18n();

  if (rows.length === 0) {
    return <div className="empty-state">{emptyLabel}</div>;
  }

  return (
    <div className="sku-flow-table-wrap">
      <table className="sheet-table sku-flow-table">
        <thead>
          <tr>
            <th>{t("skuFlowDate")}</th>
            <th>{t("skuFlowType")}</th>
            <th>{t("quantity")}</th>
            <th>{t("pallets")}</th>
            <th>{t("customer")}</th>
            <th>{t("warehouseMapWarehouseFilter")}</th>
            <th>{t("containerNo")}</th>
            <th>{t("skuFlowReference")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.direction}-${row.date}-${row.sourceDocumentType}-${row.sourceDocumentId}-${row.sourceLineId}-${row.containerNo}`}>
              <td>{formatOptionalReportDate(row.date)}</td>
              <td><SKUFlowDirectionBadge direction={row.direction} /></td>
              <td>{formatNumber(row.quantity)}</td>
              <td>{formatNumber(row.pallets)}</td>
              <td>{row.customerName || "-"}</td>
              <td>
                <strong>{row.locationName || "-"}</strong>
                <span className="sheet-table__subtle">{row.storageSection || "-"}</span>
              </td>
              <td>{row.containerNo || "-"}</td>
              <td>
                <strong>{firstNonEmptyText(row.packingListNo, row.orderRef, "-")}</strong>
                <span className="sheet-table__subtle">
                  {row.sourceDocumentType ? `${row.sourceDocumentType} #${row.sourceDocumentId || "-"}` : "-"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SKUFlowDirectionBadge({ direction }: { direction: SKUFlowReportRow["direction"] }) {
  const { t } = useI18n();
  return (
    <span className={`sku-flow-badge sku-flow-badge--${direction.toLowerCase()}`}>
      {direction === "INBOUND" ? t("skuFlowInbound") : t("skuFlowOutbound")}
    </span>
  );
}

function HorizontalBarList({
  rows,
  emptyLabel,
  valueSuffix
}: {
  rows: BarRow[];
  emptyLabel: string;
  valueSuffix: string;
}) {
  if (rows.length === 0) {
    return <div className="empty-state">{emptyLabel}</div>;
  }

  const maxValue = Math.max(...rows.map((row) => row.value), 1);

  return (
    <div className="report-bars report-bars--executive">
      {rows.map((row) => (
        <div className="report-bars__row" key={`${row.label}-${row.meta ?? ""}`}>
          <div className="report-bars__labels">
            <strong>{row.label}</strong>
            {row.meta ? <span>{row.meta}</span> : null}
          </div>
          <div className="report-bars__track">
            <div
              className={`report-bars__fill report-bars__fill--${row.tone ?? "blue"}`}
              style={{ width: `${Math.max((row.value / maxValue) * 100, row.value > 0 ? 8 : 0)}%` }}
            />
          </div>
          <div className="report-bars__value">{formatNumber(row.value)} {valueSuffix}</div>
        </div>
      ))}
    </div>
  );
}

function PalletFlowChart({
  rows,
  emptyLabel,
  receivedLabel,
  shippedLabel,
  transferInLabel,
  transferOutLabel
}: {
  rows: PalletFlowRow[];
  emptyLabel: string;
  receivedLabel: string;
  shippedLabel: string;
  transferInLabel: string;
  transferOutLabel: string;
}) {
  if (rows.length === 0) {
    return <div className="empty-state">{emptyLabel}</div>;
  }

  return (
    <div className="report-chart-wrap">
      <BarChart
        dataset={rows}
        height={320}
        margin={{ top: 20, bottom: 20, left: 38, right: 18 }}
        xAxis={[{ scaleType: "band", dataKey: "label" }]}
        series={[
          { dataKey: "inbound", label: receivedLabel, color: "#3c6e71" },
          { dataKey: "outbound", label: shippedLabel, color: "#b76857" },
          { dataKey: "transferIn", label: transferInLabel, color: "#4e83b5" },
          { dataKey: "transferOut", label: transferOutLabel, color: "#9a6b4c" }
        ]}
        grid={{ horizontal: true }}
      />
    </div>
  );
}

function SKUFlowQuantityTrendChart({
  rows,
  emptyLabel,
  inboundLabel,
  outboundLabel,
  unitLabel
}: {
  rows: SKUFlowTrendRow[];
  emptyLabel: string;
  inboundLabel: string;
  outboundLabel: string;
  unitLabel: string;
}) {
  if (rows.length === 0) {
    return <div className="empty-state">{emptyLabel}</div>;
  }

  return (
    <div className="report-chart-wrap report-chart-wrap--sku-quantity">
      <BarChart
        dataset={rows}
        height={330}
        margin={{ top: 24, bottom: 20, left: 52, right: 24 }}
        xAxis={[{ scaleType: "band", dataKey: "label" }]}
        yAxis={[{ min: 0, valueFormatter: (value: number) => formatNumber(value) }]}
        series={[
          {
            dataKey: "inboundQty",
            label: inboundLabel,
            color: "#2f6f5f",
            valueFormatter: (value) => `${formatNumber(Number(value ?? 0))} ${unitLabel}`
          },
          {
            dataKey: "outboundQty",
            label: outboundLabel,
            color: "#b76857",
            valueFormatter: (value) => `${formatNumber(Number(value ?? 0))} ${unitLabel}`
          }
        ]}
        grid={{ horizontal: true }}
      />
    </div>
  );
}

function DailyPalletBalanceChart({
  rows,
  emptyLabel,
  label,
  unitLabel
}: {
  rows: PalletFlowRow[];
  emptyLabel: string;
  label: string;
  unitLabel: string;
}) {
  if (rows.length === 0) {
    return <div className="empty-state">{emptyLabel}</div>;
  }

  return (
    <div className="report-chart-wrap report-chart-wrap--pallet-balance">
      <LineChart
        dataset={rows}
        height={320}
        margin={{ top: 24, bottom: 20, left: 48, right: 24 }}
        xAxis={[{ scaleType: "band", dataKey: "label" }]}
        yAxis={[{
          min: 0,
          valueFormatter: (value: number) => formatNumber(value)
        }]}
        series={[{
          dataKey: "endOfDay",
          label,
          color: "#274c77",
          area: true,
          curve: "monotoneX",
          showMark: rows.length <= 31,
          valueFormatter: (value) => `${formatNumber(Number(value ?? 0))} ${unitLabel}`
        }]}
        grid={{ horizontal: true }}
      />
    </div>
  );
}

function DailyStorageCostChart({
  rows,
  emptyLabel,
  label,
  isRateConfigured,
  unavailableLabel
}: {
  rows: DailyStorageRow[];
  emptyLabel: string;
  label: string;
  isRateConfigured: boolean;
  unavailableLabel: string;
}) {
  if (!isRateConfigured) {
    return <div className="empty-state">{unavailableLabel}</div>;
  }

  if (rows.length === 0) {
    return <div className="empty-state">{emptyLabel}</div>;
  }

  return (
    <div className="report-chart-wrap">
      <BarChart
        dataset={rows}
        height={300}
        margin={{ top: 20, bottom: 20, left: 38, right: 18 }}
        xAxis={[{ scaleType: "band", dataKey: "label" }]}
        yAxis={[{ valueFormatter: (value: number) => `$${formatNumber(value)}` }]}
        series={[
          {
            dataKey: "storageAmount",
            label,
            color: "#d39335",
            valueFormatter: (value) => formatMoney(Number(value ?? 0))
          }
        ]}
        grid={{ horizontal: true }}
      />
    </div>
  );
}

function DailyPalletLedger({
  rows,
  emptyLabel,
  isRateConfigured
}: {
  rows: DailyStorageRow[];
  emptyLabel: string;
  isRateConfigured: boolean;
}) {
  const { t } = useI18n();
  if (rows.length === 0) {
    return <div className="empty-state">{emptyLabel}</div>;
  }

  return (
    <div className="reports-ledger-wrap">
      <table className="reports-ledger">
        <thead>
          <tr>
            <th>{t("date")}</th>
            <th>{t("reportsOpeningPallets")}</th>
            <th>{t("reportsKpiPalletsIn")}</th>
            <th>{t("reportsKpiPalletsOut")}</th>
            <th>{t("reportsTransferInPallets")}</th>
            <th>{t("reportsTransferOutPallets")}</th>
            <th>{t("reportsPalletAdjustments")}</th>
            <th>{t("reportsEndingPallets")}</th>
            <th>{t("reportsDailyStorageCost")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.dateKey}>
              <td><strong>{row.label}</strong></td>
              <td>{formatNumber(row.openingBalance)}</td>
              <td className="reports-ledger__positive">+{formatNumber(row.inbound)}</td>
              <td className="reports-ledger__negative">-{formatNumber(row.outbound)}</td>
              <td className="reports-ledger__transfer-in">+{formatNumber(row.transferIn)}</td>
              <td className="reports-ledger__transfer-out">-{formatNumber(row.transferOut)}</td>
              <td>{formatSignedNumber(row.adjustmentDelta)}</td>
              <td><strong>{formatNumber(row.endOfDay)}</strong></td>
              <td className="reports-ledger__money"><strong>{isRateConfigured ? formatMoney(row.storageAmount) : "-"}</strong></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MovementTrendChart({
  rows,
  emptyLabel,
  inboundLabel,
  outboundLabel
}: {
  rows: TrendRow[];
  emptyLabel: string;
  inboundLabel: string;
  outboundLabel: string;
}) {
  if (rows.length === 0) {
    return <div className="empty-state">{emptyLabel}</div>;
  }

  const maxValue = Math.max(...rows.flatMap((row) => [row.inbound, row.outbound]), 1);

  return (
    <>
      <div className="report-chart-wrap">
        <BarChart
          dataset={rows}
          height={300}
          margin={{ top: 20, bottom: 20, left: 38, right: 18 }}
          xAxis={[{ scaleType: "band", dataKey: "label" }]}
          series={[
            { dataKey: "inbound", label: inboundLabel, color: "#3c6e71" },
            { dataKey: "outbound", label: outboundLabel, color: "#b76857" }
          ]}
          grid={{ horizontal: true }}
        />
      </div>
      <div className="trend-chart__grid">
        {rows.map((row) => (
          <div className="trend-chart__group" key={row.key}>
            <div className="trend-chart__mini-meter">
              <div
                className="trend-chart__mini-bar trend-chart__mini-bar--in"
                style={{ width: `${Math.max((row.inbound / maxValue) * 100, row.inbound > 0 ? 10 : 0)}%` }}
              />
              <div
                className="trend-chart__mini-bar trend-chart__mini-bar--out"
                style={{ width: `${Math.max((row.outbound / maxValue) * 100, row.outbound > 0 ? 10 : 0)}%` }}
              />
            </div>
            <div className="trend-chart__totals">{formatNumber(row.inbound)} / {formatNumber(row.outbound)}</div>
            <div className="trend-chart__label">{row.label}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function StatStrip({ stats }: { stats: Array<{ label: string; value: string }> }) {
  return (
    <div className="reports-stat-strip">
      {stats.map((stat) => (
        <div className="reports-stat" key={stat.label}>
          <span>{stat.label}</span>
          <strong>{stat.value}</strong>
        </div>
      ))}
    </div>
  );
}

function getCurrentMonthDateRange() {
  const today = startOfLocalDay(new Date());
  return {
    start: toIsoDateString(new Date(today.getFullYear(), today.getMonth(), 1)),
    end: toIsoDateString(today)
  };
}

function normalizeDateRange(startDate: string, endDate: string) {
  if (!startDate || !endDate) {
    return { start: startDate, end: endDate };
  }

  return startDate <= endDate ? { start: startDate, end: endDate } : { start: endDate, end: startDate };
}

function parseOptionalNonNegativeNumber(value: string) {
  if (value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function resolveReportDailyStorageRate(context: BillingWorkspaceContext | null) {
  const normalDailyRate = (context?.rates.storageFeePerPalletPerWeekNormal
    ?? DEFAULT_BILLING_RATES.storageFeePerPalletPerWeekNormal) / 7;
  const transferDailyRate = (context?.rates.storageFeePerPalletPerWeekWestCoastTransfer
    ?? DEFAULT_BILLING_RATES.storageFeePerPalletPerWeekWestCoastTransfer) / 7;

  // Reports aggregates all container types and has no matching type filter.
  // A rate selected in Billing for one type must not be applied to the other.
  return normalDailyRate === transferDailyRate ? normalDailyRate : null;
}

function mapPalletFlowRows(rows: OperationsReportPalletFlowRow[]): PalletFlowRow[] {
  return rows.map((row) => ({
    ...row,
    label: shortDateFormatter.format(parseDateValue(row.dateKey))
  }));
}

export function mapDailyStorageRows(rows: PalletFlowRow[], dailyStorageRate: number): DailyStorageRow[] {
  const normalizedRate = Number.isFinite(dailyStorageRate) && dailyStorageRate >= 0 ? dailyStorageRate : 0;
  let previousEndBalance: number | null = null;

  return rows.map((row) => {
    const calculatedOpeningBalance = Math.max(
      row.endOfDay - row.inbound + row.outbound - row.transferIn + row.transferOut - row.adjustmentDelta,
      0
    );
    const openingBalance = previousEndBalance ?? calculatedOpeningBalance;
    previousEndBalance = row.endOfDay;

    return {
      ...row,
      openingBalance,
      storageAmount: row.endOfDay * normalizedRate
    };
  });
}

function mapMovementTrendRows(rows: OperationsReportMovementTrendRow[], granularity: ReportGranularity): TrendRow[] {
  return rows.map((row) => ({
    ...row,
    label: formatTrendLabel(row.key, granularity)
  }));
}

export function formatTrendLabel(key: string, granularity: ReportGranularity) {
  const normalizedKey = key.trim();
  const trendDate = parseTrendDate(normalizedKey, granularity) ?? inferTrendDate(normalizedKey);
  if (!trendDate) {
    return normalizedKey || "-";
  }

  return trendDate.formatter.format(trendDate.date);
}

export function mapSKUFlowTrendRows(rows: SKUFlowReportRow[]): SKUFlowTrendRow[] {
  const totalsByDate = new Map<string, SKUFlowTrendRow>();

  for (const row of rows) {
    const key = row.date.trim();
    if (!key) {
      continue;
    }
    const trend = totalsByDate.get(key) ?? {
      key,
      label: formatTrendLabel(key, "day"),
      inboundQty: 0,
      outboundQty: 0
    };
    const quantity = Number.isFinite(row.quantity) ? Math.max(0, row.quantity) : 0;
    if (row.direction === "INBOUND") {
      trend.inboundQty += quantity;
    } else if (row.direction === "OUTBOUND") {
      trend.outboundQty += quantity;
    }
    totalsByDate.set(key, trend);
  }

  return [...totalsByDate.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function parseTrendDate(key: string, granularity: ReportGranularity) {
  if (granularity === "year" && /^\d{4}$/.test(key)) {
    return createTrendDate(`${key}-01-01`, yearFormatter);
  }
  if (granularity === "month" && /^\d{4}-\d{2}$/.test(key)) {
    return createTrendDate(`${key}-01`, monthFormatter);
  }
  if (granularity === "day" && /^\d{4}-\d{2}-\d{2}$/.test(key)) {
    return createTrendDate(key, shortDateFormatter);
  }
  return null;
}

function inferTrendDate(key: string) {
  if (/^\d{4}$/.test(key)) {
    return createTrendDate(`${key}-01-01`, yearFormatter);
  }
  if (/^\d{4}-\d{2}$/.test(key)) {
    return createTrendDate(`${key}-01`, monthFormatter);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    return createTrendDate(key, shortDateFormatter);
  }
  return null;
}

function createTrendDate(value: string, formatter: Intl.DateTimeFormat) {
  const date = parseDateValue(value);
  if (Number.isNaN(date.getTime()) || toIsoDateString(date) !== value) {
    return null;
  }
  return { date, formatter };
}

function formatDateRangeSummary(startDate: string, endDate: string) {
  return `${mediumDateFormatter.format(parseDateValue(startDate))} - ${mediumDateFormatter.format(parseDateValue(endDate))}`;
}

function formatOptionalReportDate(value: string) {
  return value ? mediumDateFormatter.format(parseDateValue(value)) : "-";
}

function formatNumber(value: number) {
  return numberFormatter.format(value);
}

function formatDecimalNumber(value: number) {
  return decimalFormatter.format(value);
}

function formatOptionalMoney(value: number | null) {
  return value === null ? "-" : formatMoney(value);
}

function formatSignedNumber(value: number) {
  const absolute = formatNumber(Math.abs(value));
  if (value > 0) {
    return `+${absolute}`;
  }

  if (value < 0) {
    return `-${absolute}`;
  }

  return absolute;
}


function firstNonEmptyText(...values: string[]) {
  return values.find((value) => value.trim() !== "") ?? "";
}
