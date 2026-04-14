import { type ReactNode, useDeferredValue, useMemo, useState } from "react";
import { BarChart } from "@mui/x-charts";

import { InlineAlert } from "./Feedback";
import { parseDateLikeValue, parseDateValue, shiftLocalDay, startOfLocalDay, toIsoDateString } from "../lib/dates";
import { useI18n } from "../lib/i18n";
import type { Customer, Item, Location, Movement } from "../lib/types";

type ReportGranularity = "day" | "month" | "year";
type ChartTone = "blue" | "green" | "amber" | "red";
type BarRow = { label: string; value: number; meta?: string; tone?: ChartTone };
type TrendRow = { key: string; label: string; inbound: number; outbound: number };
type PalletFlowRow = {
  dateKey: string;
  label: string;
  inbound: number;
  outbound: number;
  adjustmentDelta: number;
  endOfDay: number;
};

const PALLET_INBOUND_TYPES = new Set<Movement["movementType"]>(["IN", "REVERSAL", "TRANSFER_IN"]);
const PALLET_OUTBOUND_TYPES = new Set<Movement["movementType"]>(["OUT", "TRANSFER_OUT"]);

const shortDateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const mediumDateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });
const yearFormatter = new Intl.DateTimeFormat("en-US", { year: "numeric" });
const numberFormatter = new Intl.NumberFormat("en-US");
const decimalFormatter = new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 1 });

type ReportsPageProps = {
  items: Item[];
  movements: Movement[];
  locations: Location[];
  customers: Customer[];
  isLoading: boolean;
  errorMessage: string;
};

export function ReportsPage({ items, movements, locations, customers, isLoading, errorMessage }: ReportsPageProps) {
  const { t } = useI18n();
  const currentMonth = useMemo(() => getCurrentMonthDateRange(), []);
  const [selectedLocationId, setSelectedLocationId] = useState("all");
  const [selectedCustomerId, setSelectedCustomerId] = useState("all");
  const [reportStartDate, setReportStartDate] = useState(currentMonth.start);
  const [reportEndDate, setReportEndDate] = useState(currentMonth.end);
  const [searchTerm, setSearchTerm] = useState("");
  const [reportGranularity, setReportGranularity] = useState<ReportGranularity>("day");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const normalizedSearch = deferredSearchTerm.trim().toLowerCase();

  const normalizedDateRange = useMemo(
    () => normalizeDateRange(reportStartDate || currentMonth.start, reportEndDate || currentMonth.end),
    [currentMonth.end, currentMonth.start, reportEndDate, reportStartDate]
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

  const scopedItems = useMemo(
    () => items.filter((item) => matchesItemScope(item, normalizedSearch, selectedLocationId, selectedCustomerId)),
    [items, normalizedSearch, selectedCustomerId, selectedLocationId]
  );
  const scopedMovements = useMemo(
    () => movements.filter((movement) => matchesMovementScope(
      movement,
      normalizedSearch,
      selectedLocationId,
      selectedCustomerId,
      selectedLocationName
    )),
    [movements, normalizedSearch, selectedCustomerId, selectedLocationId, selectedLocationName]
  );
  const rangedMovements = useMemo(
    () => scopedMovements.filter((movement) => matchesMovementDateRange(
      movement,
      normalizedDateRange.start,
      normalizedDateRange.end
    )),
    [normalizedDateRange.end, normalizedDateRange.start, scopedMovements]
  );

  const locationRows = useMemo(
    () => buildLocationInventoryRows(scopedItems, t("reportSkuPositions")),
    [scopedItems, t]
  );
  const topSkuRows = useMemo(() => buildTopSkuRows(scopedItems), [scopedItems]);
  const lowStockRows = useMemo(
    () => buildLowStockRows(scopedItems, (onHand, reorder) => t("reportOnHandReorder", { onHand, reorder })),
    [scopedItems, t]
  );
  const movementTrendRows = useMemo(
    () => buildMovementTrendRows(rangedMovements, reportGranularity),
    [rangedMovements, reportGranularity]
  );
  const palletFlowRows = useMemo(
    () => buildDailyPalletFlowRows(scopedMovements, normalizedDateRange.start, normalizedDateRange.end),
    [normalizedDateRange.end, normalizedDateRange.start, scopedMovements]
  );

  const onHandUnits = useMemo(() => scopedItems.reduce((sum, item) => sum + item.quantity, 0), [scopedItems]);
  const activeContainers = useMemo(() => countActiveContainers(scopedItems), [scopedItems]);
  const palletsIn = useMemo(() => sumMovementPallets(rangedMovements, PALLET_INBOUND_TYPES), [rangedMovements]);
  const palletsOut = useMemo(() => sumMovementPallets(rangedMovements, PALLET_OUTBOUND_TYPES), [rangedMovements]);
  const netPalletFlow = palletsIn - palletsOut;
  const activeSkuCount = useMemo(() => countActiveSkus(scopedItems), [scopedItems]);
  const activeWarehouseCount = useMemo(() => countActiveWarehouses(scopedItems), [scopedItems]);
  const totalLowStockCount = lowStockRows.length;
  const topWarehouse = locationRows[0] ?? null;
  const endingBalance = palletFlowRows[palletFlowRows.length - 1]?.endOfDay ?? 0;
  const peakBalance = palletFlowRows.reduce((max, row) => Math.max(max, row.endOfDay), 0);
  const averageBalance = palletFlowRows.length > 0
    ? palletFlowRows.reduce((sum, row) => sum + row.endOfDay, 0) / palletFlowRows.length
    : 0;
  const advancedFilterCount = Number(normalizedSearch.length > 0) + Number(reportGranularity !== "day");
  const emptyLabel = isLoading ? t("loadingRecords") : t("noResults");
  const scopeRangeLabel = formatDateRangeSummary(normalizedDateRange.start, normalizedDateRange.end);

  return (
    <main className="workspace-main">
      {errorMessage ? <InlineAlert>{errorMessage}</InlineAlert> : null}

      <section className="workbook-panel workbook-panel--full reports-exec">
        <header className="reports-exec__hero">
          <div className="reports-exec__hero-copy">
            <span className="reports-exec__eyebrow">{t("reportsExecutiveBadge")}</span>
            <h2>{t("reportOverviewTitle")}</h2>
            <p>{t("reportOverviewSubtitle")}</p>
          </div>
          <div className="reports-exec__hero-brief">
            <strong>{t("reportsExecutiveSummaryTitle")}</strong>
            <p>{t("reportsExecutiveSummaryDesc")}</p>
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
          <SectionHeading title={t("reportsExecutiveSummaryTitle")} subtitle={t("reportsExecutiveSummaryDesc")} />

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
            <ReportCard title={t("dailyPalletFlow")} subtitle={t("dailyPalletFlowDesc")} variant="primary">
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

            <ReportCard title={t("inventoryByStorage")} subtitle={t("inventoryByStorageDesc")} variant="primary">
              <HorizontalBarList rows={locationRows} emptyLabel={emptyLabel} valueSuffix={t("units")} />
            </ReportCard>
          </div>
        </section>

        <section className="reports-exec__detail">
          <SectionHeading title={t("reportsDetailedAnalysisTitle")} subtitle={t("reportsDetailedAnalysisDesc")} />

          <div className="reports-exec__detail-grid">
            <ReportCard title={t("endOfDayPallets")} subtitle={t("endOfDayPalletsDesc")} variant="secondary">
              <PalletBalanceChart rows={palletFlowRows} emptyLabel={emptyLabel} balanceLabel={t("dailyPalletBalance")} />
              <StatStrip
                stats={[
                  { label: t("reportsEndingBalance"), value: `${formatNumber(endingBalance)} ${t("pallets")}` },
                  { label: t("reportsPeakBalance"), value: `${formatNumber(peakBalance)} ${t("pallets")}` },
                  { label: t("reportsAverageBalance"), value: `${formatDecimalNumber(averageBalance)} ${t("pallets")}` }
                ]}
              />
            </ReportCard>

            <ReportCard title={t("topSkuOnHand")} subtitle={t("topSkuOnHandDesc")} variant="secondary">
              <HorizontalBarList rows={topSkuRows} emptyLabel={emptyLabel} valueSuffix={t("units")} />
            </ReportCard>

            <ReportCard title={t("lowStockAttention")} subtitle={t("lowStockAttentionDesc")} variant="secondary">
              <HorizontalBarList rows={lowStockRows.slice(0, 8)} emptyLabel={emptyLabel} valueSuffix={t("unitsShort")} />
            </ReportCard>

            <ReportCard title={t("movementTrend")} subtitle={t("movementTrendDesc")} variant="secondary">
              <MovementTrendChart
                rows={movementTrendRows}
                emptyLabel={emptyLabel}
                inboundLabel={t("inbound")}
                outboundLabel={t("outbound")}
              />
            </ReportCard>
          </div>
        </section>
      </section>
    </main>
  );
}

function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="reports-exec__section-heading">
      <h3>{title}</h3>
      <p>{subtitle}</p>
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
  subtitle: string;
  variant: "primary" | "secondary";
  children: ReactNode;
}) {
  return (
    <section className={`report-card report-card--${variant}`}>
      <div className="report-card__header">
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
      {children}
    </section>
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

function matchesItemScope(
  item: Item,
  normalizedSearch: string,
  selectedLocationId: string,
  selectedCustomerId: string
) {
  const matchesSearch = normalizedSearch.length === 0 || [
    item.itemNumber,
    item.sku,
    item.name,
    item.description,
    item.customerName,
    item.containerNo,
    item.locationName,
    item.storageSection
  ].join(" ").toLowerCase().includes(normalizedSearch);
  const matchesLocation = selectedLocationId === "all" || item.locationId === Number(selectedLocationId);
  const matchesCustomer = selectedCustomerId === "all" || item.customerId === Number(selectedCustomerId);
  return matchesSearch && matchesLocation && matchesCustomer;
}

function matchesMovementScope(
  movement: Movement,
  normalizedSearch: string,
  selectedLocationId: string,
  selectedCustomerId: string,
  selectedLocationName: string | null
) {
  const matchesSearch = normalizedSearch.length === 0 || [
    movement.itemNumber,
    movement.sku,
    movement.itemName,
    movement.description,
    movement.customerName,
    movement.containerNo,
    movement.referenceCode,
    movement.packingListNo,
    movement.orderRef,
    movement.locationName,
    movement.storageSection
  ].join(" ").toLowerCase().includes(normalizedSearch);
  const matchesLocation = selectedLocationId === "all"
    || normalizeText(movement.locationName) === normalizeText(selectedLocationName ?? "");
  const matchesCustomer = selectedCustomerId === "all" || movement.customerId === Number(selectedCustomerId);
  return matchesSearch && matchesLocation && matchesCustomer;
}

function matchesMovementDateRange(movement: Movement, startDate: string, endDate: string) {
  const dateKey = resolveMovementReportDateKey(movement);
  if (!dateKey) {
    return false;
  }

  if (startDate && dateKey < startDate) {
    return false;
  }

  if (endDate && dateKey > endDate) {
    return false;
  }

  return true;
}

function buildLocationInventoryRows(items: Item[], skuPositionsLabel: string): BarRow[] {
  const rows = new Map<number, { label: string; value: number; skuIds: Set<number> }>();

  for (const item of items) {
    if (item.quantity <= 0) {
      continue;
    }

    const row = rows.get(item.locationId) ?? {
      label: item.locationName || `#${item.locationId}`,
      value: 0,
      skuIds: new Set<number>()
    };
    row.value += item.quantity;
    row.skuIds.add(item.skuMasterId);
    rows.set(item.locationId, row);
  }

  return Array.from(rows.values())
    .sort((left, right) => right.value - left.value)
    .slice(0, 8)
    .map((row) => ({
      label: row.label,
      value: row.value,
      meta: `${formatNumber(row.skuIds.size)} ${skuPositionsLabel}`,
      tone: "blue"
    }));
}

function buildTopSkuRows(items: Item[]): BarRow[] {
  const rows = new Map<number, { label: string; value: number; description: string }>();

  for (const item of items) {
    if (item.quantity <= 0) {
      continue;
    }

    const row = rows.get(item.skuMasterId) ?? {
      label: item.sku,
      value: 0,
      description: displayDescription(item)
    };
    row.value += item.quantity;
    rows.set(item.skuMasterId, row);
  }

  return Array.from(rows.values())
    .sort((left, right) => right.value - left.value)
    .slice(0, 8)
    .map((row) => ({
      label: row.label,
      value: row.value,
      meta: row.description,
      tone: "green"
    }));
}

function buildLowStockRows(items: Item[], formatReorderMeta: (onHand: string, reorder: string) => string): BarRow[] {
  const rows = new Map<number, { label: string; available: number; reorder: number }>();

  for (const item of items) {
    const row = rows.get(item.skuMasterId) ?? {
      label: item.sku,
      available: 0,
      reorder: 0
    };
    row.available += item.availableQty;
    row.reorder = Math.max(row.reorder, item.reorderLevel);
    rows.set(item.skuMasterId, row);
  }

  return Array.from(rows.values())
    .filter((row) => row.reorder > 0 && row.available <= row.reorder)
    .sort((left, right) => (right.reorder - right.available) - (left.reorder - left.available))
    .map((row) => ({
      label: row.label,
      value: Math.max(row.reorder - row.available, 0),
      meta: formatReorderMeta(formatNumber(row.available), formatNumber(row.reorder)),
      tone: row.available === 0 ? "red" : "amber"
    }));
}

function buildMovementTrendRows(movements: Movement[], granularity: ReportGranularity): TrendRow[] {
  const trendMap = new Map<string, TrendRow>();

  for (const movement of movements) {
    const dateKey = resolveMovementReportDateKey(movement);
    if (!dateKey) {
      continue;
    }

    const bucket = resolveTrendBucket(parseDateValue(dateKey), granularity);
    const row = trendMap.get(bucket.key) ?? { key: bucket.key, label: bucket.label, inbound: 0, outbound: 0 };
    const quantity = Math.abs(movement.quantityChange);

    if (PALLET_INBOUND_TYPES.has(movement.movementType)) {
      row.inbound += quantity;
    } else if (PALLET_OUTBOUND_TYPES.has(movement.movementType)) {
      row.outbound += quantity;
    }

    trendMap.set(bucket.key, row);
  }

  return Array.from(trendMap.values()).sort((left, right) => left.key.localeCompare(right.key));
}

function buildDailyPalletFlowRows(movements: Movement[], startDate: string, endDate: string): PalletFlowRow[] {
  if (!startDate || !endDate) {
    return [];
  }

  const dayKeys = buildIsoDateRange(startDate, endDate);
  const bucketMap = new Map<string, { inbound: number; outbound: number; adjustmentDelta: number }>(
    dayKeys.map((dayKey) => [dayKey, { inbound: 0, outbound: 0, adjustmentDelta: 0 }])
  );
  let openingBalance = 0;

  for (const movement of movements) {
    const dateKey = resolveMovementReportDateKey(movement);
    if (!dateKey) {
      continue;
    }

    const delta = resolveMovementPalletDelta(movement);
    if (delta === 0) {
      continue;
    }

    if (dateKey < startDate) {
      openingBalance += delta;
      continue;
    }

    if (dateKey > endDate) {
      continue;
    }

    const bucket = bucketMap.get(dateKey);
    if (!bucket) {
      continue;
    }

    if (PALLET_INBOUND_TYPES.has(movement.movementType)) {
      bucket.inbound += Math.abs(delta);
    } else if (PALLET_OUTBOUND_TYPES.has(movement.movementType)) {
      bucket.outbound += Math.abs(delta);
    } else {
      bucket.adjustmentDelta += delta;
    }
  }

  let runningBalance = openingBalance;

  return dayKeys.map((dayKey) => {
    const bucket = bucketMap.get(dayKey) ?? { inbound: 0, outbound: 0, adjustmentDelta: 0 };
    runningBalance += bucket.inbound - bucket.outbound + bucket.adjustmentDelta;

    return {
      dateKey: dayKey,
      label: shortDateFormatter.format(parseDateValue(dayKey)),
      inbound: bucket.inbound,
      outbound: bucket.outbound,
      adjustmentDelta: bucket.adjustmentDelta,
      endOfDay: runningBalance
    };
  });
}

function buildIsoDateRange(startDate: string, endDate: string) {
  const result: string[] = [];
  let cursor = startOfLocalDay(parseDateValue(startDate));
  const end = startOfLocalDay(parseDateValue(endDate));

  while (cursor.getTime() <= end.getTime()) {
    result.push(toIsoDateString(cursor));
    cursor = shiftLocalDay(cursor, 1);
  }

  return result;
}

function resolveMovementPalletDelta(movement: Movement) {
  const pallets = Math.abs(movement.pallets || 0);
  if (pallets === 0) {
    return 0;
  }

  if (PALLET_INBOUND_TYPES.has(movement.movementType)) {
    return pallets;
  }

  if (PALLET_OUTBOUND_TYPES.has(movement.movementType)) {
    return -pallets;
  }

  if (movement.movementType === "ADJUST" || movement.movementType === "COUNT") {
    if (movement.quantityChange === 0) {
      return 0;
    }

    return movement.quantityChange > 0 ? pallets : -pallets;
  }

  return 0;
}

function sumMovementPallets(movements: Movement[], allowedTypes: Set<Movement["movementType"]>) {
  return movements.reduce((sum, movement) => {
    if (!allowedTypes.has(movement.movementType)) {
      return sum;
    }

    return sum + Math.abs(movement.pallets || 0);
  }, 0);
}

function countActiveContainers(items: Item[]) {
  return new Set(
    items
      .filter((item) => item.quantity > 0 && item.containerNo.trim().length > 0)
      .map((item) => item.containerNo.trim().toUpperCase())
  ).size;
}

function countActiveSkus(items: Item[]) {
  return new Set(items.filter((item) => item.quantity > 0).map((item) => item.skuMasterId)).size;
}

function countActiveWarehouses(items: Item[]) {
  return new Set(items.filter((item) => item.quantity > 0).map((item) => item.locationId)).size;
}

function resolveMovementReportDateKey(movement: Movement) {
  const primaryCandidates = PALLET_OUTBOUND_TYPES.has(movement.movementType)
    ? [movement.outDate, movement.deliveryDate, movement.createdAt]
    : [movement.deliveryDate, movement.outDate, movement.createdAt];

  for (const candidate of primaryCandidates) {
    const normalized = normalizeDateKey(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function normalizeDateKey(value: string | null | undefined) {
  const parsed = parseDateLikeValue(value);
  return parsed ? toIsoDateString(parsed) : null;
}

function resolveTrendBucket(date: Date, granularity: ReportGranularity) {
  if (granularity === "year") {
    return {
      key: `${date.getFullYear()}`,
      label: yearFormatter.format(date)
    };
  }

  if (granularity === "month") {
    return {
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      label: monthFormatter.format(date)
    };
  }

  return {
    key: toIsoDateString(date),
    label: shortDateFormatter.format(date)
  };
}

function formatDateRangeSummary(startDate: string, endDate: string) {
  return `${mediumDateFormatter.format(parseDateValue(startDate))} - ${mediumDateFormatter.format(parseDateValue(endDate))}`;
}

function displayDescription(item: Pick<Item, "description" | "name">) {
  return item.description || item.name;
}

function normalizeText(value: string) {
  return value.trim().toLowerCase();
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
