import ChevronLeftRoundedIcon from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import LocalShippingOutlinedIcon from "@mui/icons-material/LocalShippingOutlined";
import MoveToInboxOutlinedIcon from "@mui/icons-material/MoveToInboxOutlined";
import ReportProblemOutlinedIcon from "@mui/icons-material/ReportProblemOutlined";
import TimelineOutlinedIcon from "@mui/icons-material/TimelineOutlined";
import WarehouseOutlinedIcon from "@mui/icons-material/WarehouseOutlined";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";

import { setPendingActivityManagementLaunchContext } from "../lib/activityManagementLaunchContext";
import {
  getLocalDayBucketKey,
  getLocalMonthBucketKey,
  parseDateLikeValue,
  shiftLocalDay,
  startOfLocalDay,
  startOfLocalWeek,
  toIsoDateString
} from "../lib/dates";
import { setPendingInventoryByLocationContext } from "../lib/inventoryByLocationContext";
import { InlineAlert } from "./Feedback";
import { useI18n } from "../lib/i18n";
import type {
  CycleCount,
  InboundDocument,
  InventoryAdjustment,
  InventoryTransfer,
  Item,
  OutboundDocument,
  UserRole
} from "../lib/types";
import type { PageKey } from "../lib/routes";

type HomeDashboardPageProps = {
  currentUserRole: UserRole;
  items: Item[];
  inboundDocuments: InboundDocument[];
  outboundDocuments: OutboundDocument[];
  adjustments: InventoryAdjustment[];
  transfers: InventoryTransfer[];
  cycleCounts: CycleCount[];
  isLoading: boolean;
  errorMessage: string;
  onNavigate: (page: PageKey) => void;
  onOpenDailyOperations: (date: string) => void;
};

type SummaryCard = {
  key: string;
  label: string;
  value: string;
  meta: string;
  tone: "blue" | "emerald" | "amber" | "red";
  icon: ReactNode;
  onOpen: () => void;
};

type TrendPeriod = "week" | "month" | "year";

type TrendPoint = {
  key: string;
  label: string;
  shortLabel: string;
  total: number;
  inbound: number;
  outbound: number;
};

type ActivityEntry = {
  id: string;
  title: string;
  description: string;
  timeLabel: string;
  tone: "emerald" | "blue" | "amber" | "red" | "slate";
};

type TrackerRow = {
  id: string;
  code: string;
  counterpart: string;
  warehouse: string;
  dateLabel: string;
  trackingLabel: string;
  progress: number;
  badgeTone: "emerald" | "blue" | "amber" | "red" | "slate";
};

type CalendarDay = {
  key: string;
  date: Date;
  dayNumber: number;
  inCurrentMonth: boolean;
  isToday: boolean;
  inboundCount: number;
  outboundCount: number;
};

const numberFormatter = new Intl.NumberFormat("en-US");

export function HomeDashboardPage({
  currentUserRole,
  items,
  inboundDocuments,
  outboundDocuments,
  adjustments,
  transfers,
  cycleCounts,
  isLoading,
  errorMessage,
  onNavigate,
  onOpenDailyOperations
}: HomeDashboardPageProps) {
  const { t } = useI18n();
  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>("month");
  const [calendarWeek, setCalendarWeek] = useState(() => startOfLocalWeek(new Date()));

  const summaryCards = useMemo<SummaryCard[]>(() => {
    const onHandUnits = items.reduce((sum, item) => sum + item.quantity, 0);
    const activePositions = items.filter((item) => item.quantity > 0).length;
    const scheduledReceipts = inboundDocuments.filter((document) => normalizeDocumentStatus(document.status) === "DRAFT").length;
    const arrivedReceipts = inboundDocuments.filter((document) => normalizeInboundTrackingStatus(document.trackingStatus, document.status) === "ARRIVED").length;
    const receivingReceipts = inboundDocuments.filter((document) => normalizeInboundTrackingStatus(document.trackingStatus, document.status) === "RECEIVING").length;
    const pendingShipments = outboundDocuments.filter((document) => normalizeDocumentStatus(document.status) === "DRAFT").length;
    const pickingShipments = outboundDocuments.filter((document) => normalizeOutboundTrackingStatus(document.trackingStatus, document.status) === "PICKING").length;
    const packedShipments = outboundDocuments.filter((document) => normalizeOutboundTrackingStatus(document.trackingStatus, document.status) === "PACKED").length;
    const lowStockSkus = items.filter((item) => item.reorderLevel > 0 && item.availableQty <= item.reorderLevel).length;
    const atRiskWarehouses = new Set(
      items
        .filter((item) => item.reorderLevel > 0 && item.availableQty <= item.reorderLevel)
        .map((item) => item.locationId)
    ).size;

    return [
      {
        key: "on-hand",
        label: t("dashboardKpiOnHand"),
        value: numberFormatter.format(onHandUnits),
        meta: t("dashboardKpiOnHandMeta", { count: activePositions }),
        tone: "blue",
        icon: <Inventory2OutlinedIcon fontSize="small" />,
        onOpen: () => {
          setPendingInventoryByLocationContext({ healthFilter: "ALL" });
          onNavigate("stock-by-location");
        }
      },
      {
        key: "receipts",
        label: t("dashboardKpiScheduledReceipts"),
        value: numberFormatter.format(scheduledReceipts),
        meta: t("dashboardKpiScheduledReceiptsMeta", { arrived: arrivedReceipts, receiving: receivingReceipts }),
        tone: "emerald",
        icon: <MoveToInboxOutlinedIcon fontSize="small" />,
        onOpen: () => {
          setPendingActivityManagementLaunchContext("IN", { selectedStatus: "DRAFT" });
          onNavigate("inbound-management");
        }
      },
      {
        key: "shipments",
        label: t("dashboardKpiPendingShipments"),
        value: numberFormatter.format(pendingShipments),
        meta: t("dashboardKpiPendingShipmentsMeta", { picking: pickingShipments, packed: packedShipments }),
        tone: "amber",
        icon: <LocalShippingOutlinedIcon fontSize="small" />,
        onOpen: () => {
          setPendingActivityManagementLaunchContext("OUT", { selectedStatus: "DRAFT" });
          onNavigate("outbound-management");
        }
      },
      {
        key: "low-stock",
        label: t("dashboardKpiLowStock"),
        value: numberFormatter.format(lowStockSkus),
        meta: t("dashboardKpiLowStockMeta", { warehouses: atRiskWarehouses }),
        tone: "red",
        icon: <ReportProblemOutlinedIcon fontSize="small" />,
        onOpen: () => {
          setPendingInventoryByLocationContext({ healthFilter: "LOW_STOCK" });
          onNavigate("stock-by-location");
        }
      }
    ];
  }, [inboundDocuments, items, onNavigate, outboundDocuments, t]);

  const throughputPoints = useMemo(
    () => buildThroughputPoints(inboundDocuments, outboundDocuments, trendPeriod),
    [inboundDocuments, outboundDocuments, trendPeriod]
  );

  const throughputTotals = useMemo(
    () => ({
      inbound: throughputPoints.reduce((sum, point) => sum + point.inbound, 0),
      outbound: throughputPoints.reduce((sum, point) => sum + point.outbound, 0)
    }),
    [throughputPoints]
  );

  const trendPeriodOptions = useMemo(
    () => ([
      { key: "week" as const, label: t("week") },
      { key: "month" as const, label: t("month") },
      { key: "year" as const, label: t("year") }
    ]),
    [t]
  );

  const recentActivity = useMemo<ActivityEntry[]>(
    () => buildRecentActivityEntries(inboundDocuments, outboundDocuments, adjustments, transfers, cycleCounts, t),
    [adjustments, cycleCounts, inboundDocuments, outboundDocuments, t, transfers]
  );

  const calendarDays = useMemo(
    () => buildProcessingCalendarDays(inboundDocuments, outboundDocuments, calendarWeek),
    [calendarWeek, inboundDocuments, outboundDocuments]
  );

  const inboundTrackerRows = useMemo<TrackerRow[]>(
    () => inboundDocuments
      .filter((document) => normalizeDocumentStatus(document.status) !== "CANCELLED")
      .slice()
      .sort((left, right) => getDocumentTime(right.updatedAt || right.createdAt) - getDocumentTime(left.updatedAt || left.createdAt))
      .slice(0, 6)
      .map((document) => ({
        id: `inbound-${document.id}`,
        code: document.containerNo || `RCV-${document.id}`,
        counterpart: document.customerName || "-",
        warehouse: `${document.locationName}${document.storageSection ? ` / ${document.storageSection}` : ""}`,
        dateLabel: formatDashboardDate(document.deliveryDate || document.createdAt),
        trackingLabel: formatInboundTrackingStatusLabel(document.trackingStatus, document.status, t),
        progress: inboundTrackingProgress(document.trackingStatus, document.status),
        badgeTone: trackingTone(inboundTrackingProgress(document.trackingStatus, document.status))
      })),
    [inboundDocuments, t]
  );

  const outboundTrackerRows = useMemo<TrackerRow[]>(
    () => outboundDocuments
      .filter((document) => normalizeDocumentStatus(document.status) !== "CANCELLED")
      .slice()
      .sort((left, right) => getDocumentTime(right.updatedAt || right.createdAt) - getDocumentTime(left.updatedAt || left.createdAt))
      .slice(0, 6)
      .map((document) => ({
        id: `outbound-${document.id}`,
        code: document.packingListNo || `SHP-${document.id}`,
        counterpart: document.shipToName || document.customerName || "-",
        warehouse: document.storages || "-",
        dateLabel: formatDashboardDate(document.outDate || document.createdAt),
        trackingLabel: formatOutboundTrackingStatusLabel(document.trackingStatus, document.status, t),
        progress: outboundTrackingProgress(document.trackingStatus, document.status),
        badgeTone: trackingTone(outboundTrackingProgress(document.trackingStatus, document.status))
      })),
    [outboundDocuments, t]
  );

  return (
    <main className="workspace-main">
      {errorMessage ? <InlineAlert>{errorMessage}</InlineAlert> : null}

      <div className="space-y-6 pb-6">
        <section className="rounded-[24px] border border-slate-200/80 bg-[linear-gradient(180deg,#f3f8ff_0%,#eef4fb_100%)] px-5 py-5 shadow-[0_18px_48px_rgba(10,31,68,0.06)]">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-2.5">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 ring-1 ring-slate-200/70">
                <WarehouseOutlinedIcon sx={{ fontSize: 14 }} />
                {t("navDashboard")}
              </div>
              <div>
                <h1 className="font-headline text-3xl font-extrabold tracking-tight text-[#0d2d63]">
                  {t("dashboardOperationalTitle")}
                </h1>
                <p className="mt-1.5 max-w-3xl text-sm text-slate-600">
                  {t("dashboardOperationalSubtitle")}
                </p>
              </div>
            </div>

          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {isLoading
              ? Array.from({ length: 4 }, (_, index) => <DashboardSummaryCardSkeleton key={index} />)
              : summaryCards.map((card) => (
                <DashboardSummaryCard key={card.key} card={card} />
              ))}
          </div>
        </section>

        <ProcessingCalendarCard
          weekStart={calendarWeek}
          days={calendarDays}
          isLoading={isLoading}
          onPreviousWeek={() => setCalendarWeek((current) => shiftLocalDay(current, -7))}
          onNextWeek={() => setCalendarWeek((current) => shiftLocalDay(current, 7))}
          onToday={() => setCalendarWeek(startOfLocalWeek(new Date()))}
          onOpenDay={onOpenDailyOperations}
        />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(280px,0.82fr)]">
          <section className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-[0_16px_34px_rgba(15,23,42,0.05)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="font-headline text-lg font-extrabold tracking-tight text-[#0d2d63]">
                  {t("dashboardFlowTitle")}
                </h2>
                <p className="mt-1 text-xs text-slate-500">{t("dashboardFlowSubtitle")}</p>
              </div>
              <div className="inline-flex items-center gap-1 rounded-xl bg-slate-100 p-1">
                {trendPeriodOptions.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setTrendPeriod(option.key)}
                    className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
                      option.key === trendPeriod
                        ? "bg-white text-[#143569] shadow-[0_8px_18px_rgba(15,23,42,0.08)]"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <TrendLegend
                  colorClass="bg-emerald-500"
                  label={t("inbound")}
                  value={numberFormatter.format(throughputTotals.inbound)}
                />
                <TrendLegend
                  colorClass="bg-[#143569]"
                  label={t("outbound")}
                  value={numberFormatter.format(throughputTotals.outbound)}
                />
                <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                  <TimelineOutlinedIcon sx={{ fontSize: 15 }} />
                  {t("dashboardFlowLineMeta")}
                </div>
              </div>

              <ThroughputLineChart points={throughputPoints} emptyLabel={t("dashboardFlowEmpty")} />
            </div>
          </section>

          <section className="rounded-[24px] border border-slate-200/80 bg-[#eef3fb] p-4 shadow-[0_16px_34px_rgba(15,23,42,0.04)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-headline text-lg font-extrabold tracking-tight text-[#0d2d63]">
                  {t("recentActivity")}
                </h2>
                <p className="mt-1 text-xs text-slate-500">{t("dashboardRecentActivityDesc")}</p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {isLoading ? (
                <RecentActivitySkeleton />
              ) : recentActivity.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-5 py-8 text-center text-sm text-slate-500">
                  {t("dashboardNoRecentActivity")}
                </div>
              ) : recentActivity.map((entry) => (
                <div key={entry.id} className="flex gap-3">
                  <div className="flex w-4 flex-col items-center">
                    <span className={`mt-1 h-2 w-2 rounded-full ${toneDotClass(entry.tone)}`} />
                    <span className="mt-1 h-full w-px bg-slate-200" />
                  </div>
                  <div className="space-y-1 pb-1">
                    <p className="text-sm font-bold text-[#0d2d63]">{entry.title}</p>
                    <p className="text-xs leading-5 text-slate-600">{entry.description}</p>
                    <p className="text-[11px] font-medium text-slate-400">{entry.timeLabel}</p>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => onNavigate("all-activity")}
              className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-white px-4 py-2.5 text-xs font-semibold text-[#143569] ring-1 ring-slate-200 transition hover:bg-slate-50"
            >
              {t("dashboardViewFullLogs")}
            </button>
          </section>
        </div>

        <div className="grid gap-5 2xl:grid-cols-2">
          <TrackerTableCard
            title={t("dashboardInboundTrackerTitle")}
            description={t("dashboardInboundTrackerDesc")}
            rows={inboundTrackerRows}
            emptyLabel={t("dashboardTrackerEmpty")}
            isLoading={isLoading}
            onOpen={() => onNavigate("inbound-management")}
          />
          <TrackerTableCard
            title={t("dashboardOutboundTrackerTitle")}
            description={t("dashboardOutboundTrackerDesc")}
            rows={outboundTrackerRows}
            emptyLabel={t("dashboardTrackerEmpty")}
            isLoading={isLoading}
            onOpen={() => onNavigate("outbound-management")}
          />
        </div>
      </div>
    </main>
  );
}

function DashboardSummaryCard({ card }: { card: SummaryCard }) {
  return (
    <button
      type="button"
      onClick={card.onOpen}
      className="interactive-block interactive-block--soft w-full rounded-[18px] border border-slate-200/80 bg-white p-3 text-left shadow-[0_10px_22px_rgba(15,23,42,0.04)]"
      aria-label={card.label}
    >
      <div className="flex items-start justify-between gap-4">
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${summaryToneIconClass(card.tone)}`}>
          <span className="text-[#143569]">{card.icon}</span>
        </div>
        <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${summaryToneBadgeClass(card.tone)}`}>
          {card.label}
        </span>
      </div>
      <div className="mt-3.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">{card.label}</p>
        <h3 className="mt-1.5 font-headline text-2xl font-extrabold tracking-tight text-[#0d2d63]">{card.value}</h3>
        <p className="mt-1 text-xs text-slate-500">{card.meta}</p>
      </div>
    </button>
  );
}

function DashboardSummaryCardSkeleton() {
  return (
    <article className="rounded-[18px] border border-slate-200/80 bg-white p-3 shadow-[0_10px_22px_rgba(15,23,42,0.04)] animate-pulse">
      <div className="flex items-start justify-between gap-4">
        <div className="h-9 w-9 rounded-lg bg-slate-100" />
        <div className="h-5 w-24 rounded-md bg-slate-100" />
      </div>
      <div className="mt-3.5 space-y-2">
        <div className="h-2.5 w-24 rounded-full bg-slate-100" />
        <div className="h-9 w-32 rounded-lg bg-slate-100" />
        <div className="h-2.5 w-40 rounded-full bg-slate-100" />
      </div>
    </article>
  );
}

function TrendLegend({
  colorClass,
  label,
  value
}: {
  colorClass: string;
  label: string;
  value: string;
}) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
      <span className={`h-2 w-2 rounded-full ${colorClass}`} />
      <span>{label}</span>
      <span className="text-slate-400">/</span>
      <span className="font-bold text-[#143569]">{value}</span>
    </div>
  );
}

function ThroughputLineChart({
  points,
  emptyLabel
}: {
  points: TrendPoint[];
  emptyLabel: string;
}) {
  const chartWidth = 760;
  const chartHeight = 156;
  const topPadding = 10;
  const bottomPadding = 24;
  const leftPadding = 8;
  const rightPadding = 8;
  const availableWidth = chartWidth - leftPadding - rightPadding;
  const availableHeight = chartHeight - topPadding - bottomPadding;
  const maxValue = Math.max(...points.map((point) => Math.max(point.inbound, point.outbound)), 0);
  const labelStep = points.length > 14 ? Math.ceil(points.length / 6) : 1;

  if (!points.length || maxValue === 0) {
    return (
      <div className="flex h-[188px] items-center justify-center rounded-[20px] border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
        {emptyLabel}
      </div>
    );
  }

  const toCoordinates = (selector: (point: TrendPoint) => number) => points.map((point, index) => {
    const x = points.length === 1 ? chartWidth / 2 : leftPadding + (availableWidth / (points.length - 1)) * index;
    const y = topPadding + availableHeight - (selector(point) / maxValue) * availableHeight;
    return { x, y, point, index };
  });

  const inboundCoordinates = toCoordinates((point) => point.inbound);
  const outboundCoordinates = toCoordinates((point) => point.outbound);

  const toPath = (coordinates: Array<{ x: number; y: number }>) => coordinates
    .map((coordinate, index) => `${index === 0 ? "M" : "L"} ${coordinate.x} ${coordinate.y}`)
    .join(" ");

  return (
    <div className="rounded-[20px] bg-slate-50/80 px-3 py-3">
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        className="h-[188px] w-full overflow-visible"
        role="img"
        aria-label="Warehouse throughput trend"
      >
        {[0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = topPadding + availableHeight - availableHeight * ratio;
          return (
            <line
              key={ratio}
              x1={leftPadding}
              x2={chartWidth - rightPadding}
              y1={y}
              y2={y}
              stroke="#d8e0ec"
              strokeDasharray="4 6"
            />
          );
        })}

        <path d={toPath(inboundCoordinates)} fill="none" stroke="#10b981" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3.5" />
        <path d={toPath(outboundCoordinates)} fill="none" stroke="#143569" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3.5" />

        {inboundCoordinates.map(({ x, y, point }) => (
          <g key={`inbound-${point.key}`}>
            <circle cx={x} cy={y} r="4" fill="#10b981" stroke="#ffffff" strokeWidth="2" />
            <title>{`${point.label} / Inbound: ${point.inbound}`}</title>
          </g>
        ))}

        {outboundCoordinates.map(({ x, y, point }) => (
          <g key={`outbound-${point.key}`}>
            <circle cx={x} cy={y} r="4" fill="#143569" stroke="#ffffff" strokeWidth="2" />
            <title>{`${point.label} / Outbound: ${point.outbound}`}</title>
          </g>
        ))}

        {points.map((point, index) => {
          const x = points.length === 1 ? chartWidth / 2 : leftPadding + (availableWidth / (points.length - 1)) * index;
          const showLabel = index === 0 || index === points.length - 1 || index % labelStep === 0;
          if (!showLabel) {
            return null;
          }

          return (
            <text
              key={`label-${point.key}`}
              x={x}
              y={chartHeight - 4}
              textAnchor="middle"
              fill="#64748b"
              fontSize="10"
              fontWeight="600"
            >
              {point.shortLabel}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function ProcessingCalendarCard({
  weekStart,
  days,
  isLoading,
  onPreviousWeek,
  onNextWeek,
  onToday,
  onOpenDay
}: {
  weekStart: Date;
  days: CalendarDay[];
  isLoading: boolean;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
  onOpenDay: (date: string) => void;
}) {
  const { t } = useI18n();
  const weekEnd = shiftLocalDay(weekStart, 6);
  const rangeFormatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric"
  });
  const weekLabel = `${rangeFormatter.format(weekStart)} - ${rangeFormatter.format(weekEnd)}`;
  const weekdayLabels = useMemo(() => {
    const start = new Date(2026, 2, 29);
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
      return date.toLocaleString(undefined, { weekday: "short" }).toUpperCase();
    });
  }, []);
  const inboundTotal = days
    .filter((day) => day.inCurrentMonth)
    .reduce((sum, day) => sum + day.inboundCount, 0);
  const outboundTotal = days
    .filter((day) => day.inCurrentMonth)
    .reduce((sum, day) => sum + day.outboundCount, 0);

  return (
    <section className="rounded-[24px] border border-slate-200/80 bg-white p-6 shadow-[0_16px_34px_rgba(15,23,42,0.05)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="font-headline text-xl font-extrabold tracking-tight text-[#0d2d63]">
            {t("dashboardCalendarTitle")}
          </h2>
          <p className="mt-1 text-sm text-slate-500">{t("dashboardCalendarDesc")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TrendLegend colorClass="bg-emerald-500" label={t("inbound")} value={numberFormatter.format(inboundTotal)} />
          <TrendLegend colorClass="bg-[#143569]" label={t("outbound")} value={numberFormatter.format(outboundTotal)} />
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onPreviousWeek}
            className="interactive-button-lift inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition hover:bg-slate-200"
            aria-label={t("previousWeek")}
          >
            <ChevronLeftRoundedIcon fontSize="small" />
          </button>
          <div className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-[#143569]">
            {weekLabel}
          </div>
          <button
            type="button"
            onClick={onNextWeek}
            className="interactive-button-lift inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition hover:bg-slate-200"
            aria-label={t("nextWeek")}
          >
            <ChevronRightRoundedIcon fontSize="small" />
          </button>
        </div>

        <button
          type="button"
          onClick={onToday}
          className="interactive-button-lift inline-flex items-center justify-center rounded-xl bg-white px-4 py-2 text-sm font-semibold text-[#143569] ring-1 ring-slate-200 transition hover:bg-slate-50"
        >
          {t("today")}
        </button>
      </div>

      <div className="mt-5 grid grid-cols-7 gap-2">
        {weekdayLabels.map((label) => (
          <div key={label} className="px-2 py-1 text-center text-[11px] font-bold uppercase tracking-[0.24em] text-slate-400">
            {label}
          </div>
        ))}

        {isLoading
          ? Array.from({ length: 7 }, (_, index) => (
            <div key={`loading-${index}`} className="min-h-[112px] rounded-[18px] border border-slate-200/80 bg-slate-50/80 px-3 py-3 animate-pulse">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-slate-400">{index + 1}</span>
                <span className="h-4 w-10 rounded-full bg-slate-200" />
              </div>
              <div className="mt-4 space-y-2">
                <div className="rounded-xl bg-white/80 px-2.5 py-2 ring-1 ring-slate-100">
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-300">{t("inbound")}</div>
                  <div className="mt-1 h-5 w-12 rounded-full bg-slate-200" />
                </div>
                <div className="rounded-xl bg-white/80 px-2.5 py-2 ring-1 ring-slate-100">
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-300">{t("outbound")}</div>
                  <div className="mt-1 h-5 w-12 rounded-full bg-slate-200" />
                </div>
              </div>
            </div>
          ))
          : days.map((day) => (
            <button
              type="button"
              key={day.key}
              onClick={() => onOpenDay(formatLocalDateString(day.date))}
              className={`interactive-block interactive-block--slate min-h-[112px] rounded-[18px] border px-3 py-3 transition ${
                day.isToday
                  ? "border-[#143569]/30 bg-[#143569]/[0.03] shadow-[0_8px_18px_rgba(20,53,105,0.06)]"
                  : "border-slate-200/80 bg-slate-50/80"
              }`}
              aria-label={t("dashboardOpenDayBoard", { date: formatLocalDateString(day.date) })}
            >
              <div className="flex items-center justify-between">
                <span className={`text-sm font-bold ${day.isToday ? "text-[#143569]" : "text-slate-500"}`}>{day.dayNumber}</span>
                {day.isToday ? (
                  <span className="rounded-full bg-[#143569] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white">
                    {t("today")}
                  </span>
                ) : null}
              </div>

              <div className="mt-4 space-y-2">
                <div className={`rounded-xl px-2.5 py-2 ${day.inboundCount > 0 ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100" : "bg-white/80 text-slate-400 ring-1 ring-slate-100"}`}>
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em]">{t("inbound")}</div>
                  <div className="mt-1 text-base font-extrabold">{numberFormatter.format(day.inboundCount)}</div>
                </div>
                <div className={`rounded-xl px-2.5 py-2 ${day.outboundCount > 0 ? "bg-blue-50 text-[#143569] ring-1 ring-blue-100" : "bg-white/80 text-slate-400 ring-1 ring-slate-100"}`}>
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em]">{t("outbound")}</div>
                  <div className="mt-1 text-base font-extrabold">{numberFormatter.format(day.outboundCount)}</div>
                </div>
              </div>
            </button>
          ))}
      </div>
    </section>
  );
}

function TrackerTableCard({
  title,
  description,
  rows,
  emptyLabel,
  isLoading,
  onOpen
}: {
  title: string;
  description: string;
  rows: TrackerRow[];
  emptyLabel: string;
  isLoading: boolean;
  onOpen: () => void;
}) {
  const { t } = useI18n();

  return (
    <section className="overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-[0_16px_34px_rgba(15,23,42,0.05)]">
      <div className="flex items-start justify-between gap-4 border-b border-slate-200/80 px-6 py-5">
        <div>
          <h2 className="font-headline text-xl font-extrabold tracking-tight text-[#0d2d63]">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="interactive-button-lift rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-[#143569] transition hover:bg-slate-200"
        >
          {t("dashboardOpenWorkspace")}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse">
          <thead className="bg-slate-100/80">
            <tr>
              <th className="px-6 py-3.5 text-left text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">{t("dashboardTrackerCode")}</th>
              <th className="px-6 py-3.5 text-left text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">{t("dashboardTrackerCustomer")}</th>
              <th className="px-6 py-3.5 text-left text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">{t("dashboardTrackerWarehouse")}</th>
              <th className="px-6 py-3.5 text-left text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">{t("trackingStatus")}</th>
              <th className="px-6 py-3.5 text-left text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">{t("dashboardTrackerProgress")}</th>
              <th className="px-6 py-3.5 text-left text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">{t("dashboardTrackerDate")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/80 bg-white">
            {isLoading ? (
              <TrackerTableSkeletonRows />
            ) : rows.length === 0 ? (
              <tr>
                <td className="px-6 py-8 text-sm text-slate-500" colSpan={6}>{emptyLabel}</td>
              </tr>
            ) : rows.map((row) => (
              <tr key={row.id} className="transition hover:bg-slate-50/80">
                <td className="px-6 py-4 text-sm font-bold text-[#143569]">{row.code}</td>
                <td className="px-6 py-4 text-sm font-medium text-slate-700">{row.counterpart}</td>
                <td className="px-6 py-4 text-sm text-slate-500">{row.warehouse}</td>
                <td className="px-6 py-4">
                  <span className={`inline-flex rounded-full px-3 py-1 text-[11px] font-semibold ${badgeToneClass(row.badgeTone)}`}>
                    {row.trackingLabel}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="space-y-2">
                    <div className="h-2.5 w-32 overflow-hidden rounded-full bg-slate-200">
                      <div
                        className={`h-full rounded-full ${progressToneClass(row.badgeTone)}`}
                        style={{ width: `${row.progress}%` }}
                      />
                    </div>
                    <div className="text-xs font-semibold text-slate-500">{row.progress}%</div>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-slate-500">{row.dateLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RecentActivitySkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="flex gap-3 animate-pulse">
          <div className="flex w-4 flex-col items-center">
            <span className="mt-1 h-2 w-2 rounded-full bg-slate-200" />
            <span className="mt-1 h-full w-px bg-slate-200" />
          </div>
          <div className="flex-1 space-y-2 pb-1">
            <div className="h-3.5 w-40 rounded-full bg-slate-200" />
            <div className="h-3 w-full max-w-[220px] rounded-full bg-slate-100" />
            <div className="h-3 w-24 rounded-full bg-slate-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

function TrackerTableSkeletonRows() {
  return (
    <>
      {Array.from({ length: 4 }, (_, index) => (
        <tr key={index} className="animate-pulse">
          <td className="px-6 py-4"><div className="h-4 w-24 rounded-full bg-slate-200" /></td>
          <td className="px-6 py-4"><div className="h-4 w-36 rounded-full bg-slate-100" /></td>
          <td className="px-6 py-4"><div className="h-4 w-28 rounded-full bg-slate-100" /></td>
          <td className="px-6 py-4"><div className="h-6 w-24 rounded-full bg-slate-100" /></td>
          <td className="px-6 py-4">
            <div className="space-y-2">
              <div className="h-2.5 w-32 rounded-full bg-slate-100" />
              <div className="h-3 w-10 rounded-full bg-slate-100" />
            </div>
          </td>
          <td className="px-6 py-4"><div className="h-4 w-20 rounded-full bg-slate-100" /></td>
        </tr>
      ))}
    </>
  );
}

function buildThroughputPoints(
  inboundDocuments: InboundDocument[],
  outboundDocuments: OutboundDocument[],
  period: TrendPeriod
): TrendPoint[] {
  const today = startOfLocalDay(new Date());
  const buckets = new Map<string, TrendPoint>();

  if (period === "year") {
    for (let index = 11; index >= 0; index -= 1) {
      const date = new Date(today.getFullYear(), today.getMonth() - index, 1);
      const key = getLocalMonthBucketKey(date);
      buckets.set(key, {
        key,
        label: date.toLocaleString("en-US", { month: "long", year: "numeric" }),
        shortLabel: date.toLocaleString("en-US", { month: "short" }).toUpperCase(),
        total: 0,
        inbound: 0,
        outbound: 0
      });
    }
  } else {
    const dayCount = period === "week" ? 7 : 30;
    for (let index = dayCount - 1; index >= 0; index -= 1) {
      const date = shiftLocalDay(today, -index);
      const key = getLocalDayBucketKey(date);
      buckets.set(key, {
        key,
        label: date.toLocaleString("en-US", {
          weekday: period === "week" ? "long" : undefined,
          month: "short",
          day: "numeric"
        }),
        shortLabel: period === "week"
          ? date.toLocaleString("en-US", { weekday: "short" }).toUpperCase()
          : date.toLocaleString("en-US", { month: "short", day: "numeric" }).toUpperCase(),
        total: 0,
        inbound: 0,
        outbound: 0
      });
    }
  }

  for (const document of inboundDocuments) {
    const date = parseDateLikeValue(document.deliveryDate || document.createdAt);
    if (!date) {
      continue;
    }
    const bucket = buckets.get(period === "year" ? getLocalMonthBucketKey(date) : getLocalDayBucketKey(date));
    if (!bucket) {
      continue;
    }
    const quantity = Math.max(document.totalReceivedQty, document.totalExpectedQty, 0);
    bucket.inbound += quantity;
    bucket.total += quantity;
  }

  for (const document of outboundDocuments) {
    const date = parseDateLikeValue(document.outDate || document.createdAt);
    if (!date) {
      continue;
    }
    const bucket = buckets.get(period === "year" ? getLocalMonthBucketKey(date) : getLocalDayBucketKey(date));
    if (!bucket) {
      continue;
    }
    const quantity = Math.max(document.totalQty, 0);
    bucket.outbound += quantity;
    bucket.total += quantity;
  }

  return Array.from(buckets.values());
}
function buildProcessingCalendarDays(
  inboundDocuments: InboundDocument[],
  outboundDocuments: OutboundDocument[],
  anchorWeek: Date
): CalendarDay[] {
  const weekStart = startOfLocalWeek(anchorWeek);
  const inboundCounts = new Map<string, number>();
  const outboundCounts = new Map<string, number>();
  const todayKey = getLocalDayBucketKey(startOfLocalDay(new Date()));

  for (const document of inboundDocuments) {
    if (!isDocumentPending(document.status)) {
      continue;
    }
    const date = parseDateLikeValue(document.deliveryDate || document.createdAt);
    if (!date) {
      continue;
    }
    const key = getLocalDayBucketKey(date);
    inboundCounts.set(key, (inboundCounts.get(key) ?? 0) + 1);
  }

  for (const document of outboundDocuments) {
    if (!isDocumentPending(document.status)) {
      continue;
    }
    const date = parseDateLikeValue(document.outDate || document.createdAt);
    if (!date) {
      continue;
    }
    const key = getLocalDayBucketKey(date);
    outboundCounts.set(key, (outboundCounts.get(key) ?? 0) + 1);
  }

  return Array.from({ length: 7 }, (_, index) => {
    const date = shiftLocalDay(weekStart, index);
    const key = getLocalDayBucketKey(date);
    return {
      key,
      date,
      dayNumber: date.getDate(),
      inCurrentMonth: true,
      isToday: key === todayKey,
      inboundCount: inboundCounts.get(key) ?? 0,
      outboundCount: outboundCounts.get(key) ?? 0
    };
  });
}

function formatLocalDateString(date: Date) {
  return toIsoDateString(date);
}

function isDocumentPending(status: string) {
  const normalizedStatus = normalizeDocumentStatus(status);
  return normalizedStatus !== "CONFIRMED" && normalizedStatus !== "CANCELLED" && normalizedStatus !== "ARCHIVED";
}

function buildRecentActivityEntries(
  inboundDocuments: InboundDocument[],
  outboundDocuments: OutboundDocument[],
  adjustments: InventoryAdjustment[],
  transfers: InventoryTransfer[],
  cycleCounts: CycleCount[],
  t: (key: string, params?: Record<string, string | number>) => string
) {
  const entries: Array<ActivityEntry & { timestamp: number }> = [];

  for (const document of inboundDocuments) {
    const timestamp = getDocumentTime(document.updatedAt || document.createdAt);
    entries.push({
      id: `inbound-${document.id}`,
      title: `${t("inbound")} · ${formatInboundTrackingStatusLabel(document.trackingStatus, document.status, t)}`,
      description: [document.containerNo || `RCV-${document.id}`, document.customerName || "-", document.locationName || "-"].filter(Boolean).join(" / "),
      timeLabel: formatRelativeTime(timestamp),
      tone: toneFromProgress(inboundTrackingProgress(document.trackingStatus, document.status)),
      timestamp
    });
  }

  for (const document of outboundDocuments) {
    const timestamp = getDocumentTime(document.updatedAt || document.createdAt);
    entries.push({
      id: `outbound-${document.id}`,
      title: `${t("outbound")} · ${formatOutboundTrackingStatusLabel(document.trackingStatus, document.status, t)}`,
      description: [document.packingListNo || `SHP-${document.id}`, document.shipToName || document.customerName || "-", document.storages || "-"].filter(Boolean).join(" / "),
      timeLabel: formatRelativeTime(timestamp),
      tone: toneFromProgress(outboundTrackingProgress(document.trackingStatus, document.status)),
      timestamp
    });
  }

  for (const adjustment of adjustments) {
    const timestamp = getDocumentTime(adjustment.updatedAt || adjustment.createdAt);
    entries.push({
      id: `adjustment-${adjustment.id}`,
      title: t("adjustments"),
      description: `${adjustment.adjustmentNo || `ADJ-${adjustment.id}`} / ${adjustment.reasonCode || "-"}`,
      timeLabel: formatRelativeTime(timestamp),
      tone: "amber",
      timestamp
    });
  }

  for (const transfer of transfers) {
    const timestamp = getDocumentTime(transfer.updatedAt || transfer.createdAt);
    entries.push({
      id: `transfer-${transfer.id}`,
      title: t("transfers"),
      description: `${transfer.transferNo || `TRF-${transfer.id}`} / ${transfer.notes || t("dashboardRecentTransferFallback")}`,
      timeLabel: formatRelativeTime(timestamp),
      tone: "blue",
      timestamp
    });
  }

  for (const cycleCount of cycleCounts) {
    const timestamp = getDocumentTime(cycleCount.updatedAt || cycleCount.createdAt);
    entries.push({
      id: `cycle-${cycleCount.id}`,
      title: t("cycleCounts"),
      description: `${cycleCount.countNo || `CNT-${cycleCount.id}`} / ${cycleCount.notes || t("dashboardRecentCountFallback")}`,
      timeLabel: formatRelativeTime(timestamp),
      tone: "slate",
      timestamp
    });
  }

  return entries
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, 5)
    .map(({ timestamp: _timestamp, ...entry }) => entry);
}

function normalizeDocumentStatus(status: string) {
  return (status || "").trim().toUpperCase();
}

function normalizeInboundTrackingStatus(trackingStatus: string, documentStatus: string) {
  if (normalizeDocumentStatus(documentStatus) === "CONFIRMED") {
    return "RECEIVED";
  }
  const normalizedTrackingStatus = (trackingStatus || "").trim().toUpperCase();
  if (normalizedTrackingStatus === "ARRIVED" || normalizedTrackingStatus === "RECEIVING" || normalizedTrackingStatus === "RECEIVED") {
    return normalizedTrackingStatus;
  }
  return "SCHEDULED";
}

function normalizeOutboundTrackingStatus(trackingStatus: string, documentStatus: string) {
  if (normalizeDocumentStatus(documentStatus) === "CONFIRMED") {
    return "SHIPPED";
  }
  const normalizedTrackingStatus = (trackingStatus || "").trim().toUpperCase();
  if (normalizedTrackingStatus === "PICKING" || normalizedTrackingStatus === "PACKED" || normalizedTrackingStatus === "SHIPPED") {
    return normalizedTrackingStatus;
  }
  return "SCHEDULED";
}

function inboundTrackingProgress(trackingStatus: string, documentStatus: string) {
  switch (normalizeInboundTrackingStatus(trackingStatus, documentStatus)) {
    case "ARRIVED":
      return 50;
    case "RECEIVING":
      return 75;
    case "RECEIVED":
      return 100;
    default:
      return 25;
  }
}

function outboundTrackingProgress(trackingStatus: string, documentStatus: string) {
  switch (normalizeOutboundTrackingStatus(trackingStatus, documentStatus)) {
    case "PICKING":
      return 55;
    case "PACKED":
      return 80;
    case "SHIPPED":
      return 100;
    default:
      return 25;
  }
}

function formatInboundTrackingStatusLabel(trackingStatus: string, documentStatus: string, t: (key: string) => string) {
  switch (normalizeInboundTrackingStatus(trackingStatus, documentStatus)) {
    case "ARRIVED":
      return t("arrived");
    case "RECEIVING":
      return t("receiving");
    case "RECEIVED":
      return t("receivedTracking");
    default:
      return t("scheduled");
  }
}

function formatOutboundTrackingStatusLabel(trackingStatus: string, documentStatus: string, t: (key: string) => string) {
  switch (normalizeOutboundTrackingStatus(trackingStatus, documentStatus)) {
    case "PICKING":
      return t("picking");
    case "PACKED":
      return t("packed");
    case "SHIPPED":
      return t("shipped");
    default:
      return t("scheduled");
  }
}

function getDocumentTime(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function formatDashboardDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(parsed);
}

function formatRelativeTime(timestamp: number) {
  if (!timestamp) {
    return "-";
  }

  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.max(1, Math.round(diffMs / 60000));
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

function summaryToneIconClass(tone: SummaryCard["tone"]) {
  switch (tone) {
    case "emerald":
      return "bg-emerald-100 text-emerald-700";
    case "amber":
      return "bg-amber-100 text-amber-700";
    case "red":
      return "bg-rose-100 text-rose-700";
    default:
      return "bg-blue-100 text-[#143569]";
  }
}

function summaryToneBadgeClass(tone: SummaryCard["tone"]) {
  switch (tone) {
    case "emerald":
      return "bg-emerald-100 text-emerald-700";
    case "amber":
      return "bg-amber-100 text-amber-700";
    case "red":
      return "bg-rose-100 text-rose-700";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

function badgeToneClass(tone: ActivityEntry["tone"]) {
  switch (tone) {
    case "emerald":
      return "bg-emerald-100 text-emerald-700";
    case "amber":
      return "bg-amber-100 text-amber-700";
    case "red":
      return "bg-rose-100 text-rose-700";
    case "blue":
      return "bg-blue-100 text-[#143569]";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

function progressToneClass(tone: ActivityEntry["tone"]) {
  switch (tone) {
    case "emerald":
      return "bg-emerald-500";
    case "amber":
      return "bg-amber-500";
    case "red":
      return "bg-rose-500";
    case "blue":
      return "bg-[#143569]";
    default:
      return "bg-slate-500";
  }
}

function toneDotClass(tone: ActivityEntry["tone"]) {
  switch (tone) {
    case "emerald":
      return "bg-emerald-600";
    case "amber":
      return "bg-amber-500";
    case "red":
      return "bg-rose-500";
    case "blue":
      return "bg-[#143569]";
    default:
      return "bg-slate-400";
  }
}

function toneFromProgress(progress: number): ActivityEntry["tone"] {
  if (progress >= 100) {
    return "emerald";
  }
  if (progress >= 80) {
    return "blue";
  }
  if (progress >= 50) {
    return "amber";
  }
  return "slate";
}

function trackingTone(progress: number): ActivityEntry["tone"] {
  if (progress >= 100) {
    return "emerald";
  }
  if (progress >= 75) {
    return "blue";
  }
  if (progress >= 50) {
    return "amber";
  }
  return "slate";
}
