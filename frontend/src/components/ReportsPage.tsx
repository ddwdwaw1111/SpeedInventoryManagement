import { type ReactNode, useDeferredValue, useEffect, useMemo, useState } from "react";
import { BarChart } from "@mui/x-charts";

import { InlineAlert } from "./Feedback";
import { api } from "../lib/api";
import { parseDateValue, startOfLocalDay, toIsoDateString } from "../lib/dates";
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

const shortDateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const mediumDateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });
const yearFormatter = new Intl.DateTimeFormat("en-US", { year: "numeric" });
const numberFormatter = new Intl.NumberFormat("en-US");
const decimalFormatter = new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 1 });

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
  const [reportGranularity, setReportGranularity] = useState<ReportGranularity>("day");
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
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const normalizedSearch = deferredSearchTerm.trim();

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
  const lowStockRows = useMemo(
    () => (report?.lowStockRows ?? []).map((row) => ({
      label: row.label,
      value: row.value,
      meta: t("reportOnHandReorder", {
        onHand: formatNumber(row.available),
        reorder: formatNumber(row.reorder)
      }),
      tone: row.available === 0 ? "red" as const : "amber" as const
    })),
    [report?.lowStockRows, t]
  );
  const palletFlowRows = useMemo(
    () => mapPalletFlowRows(report?.palletFlowRows ?? []),
    [report?.palletFlowRows]
  );
  const movementTrendRows = useMemo(
    () => mapMovementTrendRows(report?.movementTrendRows ?? [], reportGranularity),
    [report?.movementTrendRows, reportGranularity]
  );

  const summary = report?.summary;
  const onHandUnits = summary?.onHandUnits ?? 0;
  const activeContainers = summary?.activeContainers ?? 0;
  const palletsIn = summary?.palletsIn ?? 0;
  const palletsOut = summary?.palletsOut ?? 0;
  const netPalletFlow = summary?.netPalletFlow ?? 0;
  const activeSkuCount = summary?.activeSkuCount ?? 0;
  const activeWarehouseCount = summary?.activeWarehouseCount ?? 0;
  const totalLowStockCount = summary?.lowStockCount ?? lowStockRows.length;
  const topWarehouse = locationRows[0] ?? null;
  const endingBalance = summary?.endingBalance ?? 0;
  const peakBalance = summary?.peakBalance ?? 0;
  const averageBalance = summary?.averageBalance ?? 0;
  const advancedFilterCount = Number(normalizedSearch.length > 0) + Number(reportGranularity !== "day");
  const emptyLabel = isLoading || isReportLoading ? t("loadingRecords") : t("noResults");
  const scopeRangeLabel = formatDateRangeSummary(normalizedDateRange.start, normalizedDateRange.end);
  const skuFlowRangeLabel = formatDateRangeSummary(normalizedSKUFlowDateRange.start, normalizedSKUFlowDateRange.end);
  const skuFlowSummary = skuFlowReport?.summary;
  const skuFlowRows = skuFlowReport?.rows ?? [];
  const skuFlowEmptyLabel = skuMasters.length === 0
    ? t("skuFlowNoSku")
    : isSKUFlowLoading
      ? t("loadingRecords")
      : t("skuFlowNoData");
  const selectedSKULabel = selectedSKUMaster
    ? [selectedSKUMaster.sku, selectedSKUMaster.description || selectedSKUMaster.name].filter(Boolean).join(" - ")
    : t("selectSku");

  return (
    <main className="workspace-main">
      {errorMessage ? <InlineAlert>{errorMessage}</InlineAlert> : null}
      {reportErrorMessage ? <InlineAlert>{reportErrorMessage}</InlineAlert> : null}
      {skuFlowErrorMessage ? <InlineAlert>{skuFlowErrorMessage}</InlineAlert> : null}

      <section className="workbook-panel workbook-panel--full reports-exec">
        <ReportTabNav activeTab={activeReportTab} onChange={setActiveReportTab} />

        {activeReportTab === "overview" ? (
          <>
        <header className="reports-exec__hero">
          <div className="reports-exec__hero-copy">
            <span className="reports-exec__eyebrow">{t("reportsExecutiveBadge")}</span>
            <h2>{t("reportOverviewTitle")}</h2>
          </div>
          <div className="reports-exec__hero-brief">
            <strong>{t("reportsExecutiveSummaryTitle")}</strong>
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
              <label>
                {t("search")}
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder={t("searchSkuPlaceholder")}
                />
              </label>
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
          <SectionHeading title={t("reportsExecutiveSummaryTitle")} />

          <div className="reports-exec__kpi-grid">
            <ExecutiveMetricCard
              label={t("reportsKpiOnHandUnits")}
              value={`${formatNumber(onHandUnits)} ${t("units")}`}
              meta={t("reportsKpiOnHandUnitsMeta", {
                skus: formatNumber(activeSkuCount),
                warehouses: formatNumber(activeWarehouseCount)
              })}
              tone="blue"
            />
            <ExecutiveMetricCard
              label={t("reportsKpiActiveContainers")}
              value={formatNumber(activeContainers)}
              meta={t("reportsKpiActiveContainersMeta")}
              tone="green"
            />
            <ExecutiveMetricCard
              label={t("reportsKpiPalletsIn")}
              value={formatNumber(palletsIn)}
              meta={t("reportsKpiPalletsInMeta")}
              tone="green"
            />
            <ExecutiveMetricCard
              label={t("reportsKpiPalletsOut")}
              value={formatNumber(palletsOut)}
              meta={t("reportsKpiPalletsOutMeta")}
              tone="amber"
            />
          </div>

          <div className="reports-exec__insight-grid">
            <ExecutiveInsightCard
              label={t("reportsInsightNetPalletFlow")}
              value={`${formatSignedNumber(netPalletFlow)} ${t("pallets")}`}
              meta={t("reportsSelectedPeriod")}
              tone={netPalletFlow >= 0 ? "green" : "amber"}
            />
            <ExecutiveInsightCard
              label={t("reportsInsightLargestWarehouse")}
              value={topWarehouse?.label ?? t("reportsInsightLargestWarehouseEmpty")}
              meta={topWarehouse
                ? `${formatNumber(topWarehouse.value)} ${t("units")}`
                : t("reportsInsightLargestWarehouseEmpty")}
              tone="blue"
            />
            <ExecutiveInsightCard
              label={t("reportsInsightLowStockAlerts")}
              value={formatNumber(totalLowStockCount)}
              meta={t("reportsInsightLowStockMeta", { count: formatNumber(totalLowStockCount) })}
              tone={totalLowStockCount > 0 ? "red" : "green"}
            />
          </div>

          <div className="reports-exec__primary-grid">
            <ReportCard title={t("dailyPalletFlow")} variant="primary">
              <PalletFlowChart
                rows={palletFlowRows}
                emptyLabel={emptyLabel}
                inboundLabel={t("inbound")}
                outboundLabel={t("outbound")}
              />
              <StatStrip
                stats={[
                  { label: t("reportsNetFlow"), value: `${formatSignedNumber(netPalletFlow)} ${t("pallets")}` },
                  { label: t("reportsPeriods"), value: formatNumber(palletFlowRows.length) },
                  { label: t("reportsEndingBalance"), value: `${formatNumber(endingBalance)} ${t("pallets")}` }
                ]}
              />
            </ReportCard>

            <ReportCard title={t("inventoryByStorage")} variant="primary">
              <HorizontalBarList rows={locationRows} emptyLabel={emptyLabel} valueSuffix={t("units")} />
            </ReportCard>
          </div>
        </section>

        <section className="reports-exec__detail">
          <SectionHeading title={t("reportsDetailedAnalysisTitle")} />

          <div className="reports-exec__detail-grid">
            <ReportCard title={t("endOfDayPallets")} variant="secondary">
              <PalletBalanceChart rows={palletFlowRows} emptyLabel={emptyLabel} balanceLabel={t("dailyPalletBalance")} />
              <StatStrip
                stats={[
                  { label: t("reportsEndingBalance"), value: `${formatNumber(endingBalance)} ${t("pallets")}` },
                  { label: t("reportsPeakBalance"), value: `${formatNumber(peakBalance)} ${t("pallets")}` },
                  { label: t("reportsAverageBalance"), value: `${formatDecimalNumber(averageBalance)} ${t("pallets")}` }
                ]}
              />
            </ReportCard>

            <ReportCard title={t("topSkuOnHand")} variant="secondary">
              <HorizontalBarList rows={topSkuRows} emptyLabel={emptyLabel} valueSuffix={t("units")} />
            </ReportCard>

            <ReportCard title={t("lowStockAttention")} variant="secondary">
              <HorizontalBarList rows={lowStockRows.slice(0, 8)} emptyLabel={emptyLabel} valueSuffix={t("unitsShort")} />
            </ReportCard>

            <ReportCard title={t("movementTrend")} variant="secondary">
              <MovementTrendChart
                rows={movementTrendRows}
                emptyLabel={emptyLabel}
                inboundLabel={t("inbound")}
                outboundLabel={t("outbound")}
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
              </div>
              <div className="reports-exec__hero-brief">
                <strong>{selectedSKULabel}</strong>
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
              <SectionHeading title={t("skuFlowSummaryTitle")} />

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

              <ReportCard title={t("skuFlowMovementDetail")} variant="primary">
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
  children
}: {
  title: string;
  subtitle?: string;
  variant: "primary" | "secondary";
  children: ReactNode;
}) {
  return (
    <section className={`report-card report-card--${variant}`}>
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
  inboundLabel,
  outboundLabel
}: {
  rows: PalletFlowRow[];
  emptyLabel: string;
  inboundLabel: string;
  outboundLabel: string;
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
          { dataKey: "inbound", label: inboundLabel, color: "#3c6e71" },
          { dataKey: "outbound", label: outboundLabel, color: "#b76857" }
        ]}
        grid={{ horizontal: true }}
      />
    </div>
  );
}

function PalletBalanceChart({
  rows,
  emptyLabel,
  balanceLabel
}: {
  rows: PalletFlowRow[];
  emptyLabel: string;
  balanceLabel: string;
}) {
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
        series={[{ dataKey: "endOfDay", label: balanceLabel, color: "#274c77" }]}
        grid={{ horizontal: true }}
      />
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

function mapPalletFlowRows(rows: OperationsReportPalletFlowRow[]): PalletFlowRow[] {
  return rows.map((row) => ({
    ...row,
    label: shortDateFormatter.format(parseDateValue(row.dateKey))
  }));
}

function mapMovementTrendRows(rows: OperationsReportMovementTrendRow[], granularity: ReportGranularity): TrendRow[] {
  return rows.map((row) => ({
    ...row,
    label: formatTrendLabel(row.key, granularity)
  }));
}

function formatTrendLabel(key: string, granularity: ReportGranularity) {
  if (granularity === "year") {
    return yearFormatter.format(parseDateValue(`${key}-01-01`));
  }

  if (granularity === "month") {
    return monthFormatter.format(parseDateValue(`${key}-01`));
  }

  return shortDateFormatter.format(parseDateValue(key));
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

function getErrorMessage(error: unknown, fallbackMessage: string) {
  return error instanceof Error && error.message ? error.message : fallbackMessage;
}

function firstNonEmptyText(...values: string[]) {
  return values.find((value) => value.trim() !== "") ?? "";
}
