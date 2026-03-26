import {
  CompareArrowsOutlined,
  FactCheckOutlined,
  MoveToInboxOutlined,
  OutboxOutlined,
  SearchOutlined,
  TuneOutlined,
  WarehouseOutlined
} from "@mui/icons-material";
import { type ReactNode, useDeferredValue, useMemo, useState } from "react";

import { InlineAlert } from "./Feedback";
import { WorkspacePanelHeader, WorkspaceTableEmptyState, WorkspaceTableLoadingState } from "./WorkspacePanelChrome";
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
};

type DashboardAction = {
  key: string;
  page: PageKey;
  label: string;
  description: string;
  icon: ReactNode;
};

type DashboardStat = {
  label: string;
  value: string;
  meta: string;
};

type QueueMetric = {
  key: string;
  label: string;
  count: number;
  page: PageKey;
};

type ExceptionMetric = QueueMetric;

type InventoryLookupRow = {
  id: number;
  sku: string;
  description: string;
  customerName: string;
  locationName: string;
  storageSection: string;
  availableQty: number;
  containerNo: string;
};

type RecentDocument = {
  id: number;
  code: string;
  customerName: string;
  dateLabel: string;
  status: string;
};

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
  onNavigate
}: HomeDashboardPageProps) {
  const { t } = useI18n();
  const [lookupQuery, setLookupQuery] = useState("");
  const deferredLookupQuery = useDeferredValue(lookupQuery);
  const normalizedLookupQuery = deferredLookupQuery.trim().toLowerCase();
  const isViewer = currentUserRole === "viewer";

  const summaryStats = useMemo<DashboardStat[]>(() => {
    const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0);
    const lowStockCount = items.filter((item) => item.reorderLevel > 0 && item.availableQty <= item.reorderLevel).length;
    const activeWarehouseCount = new Set(items.filter((item) => item.quantity > 0).map((item) => item.locationId)).size;

    return [
      {
        label: t("dashboardOnHandUnits"),
        value: formatNumber(totalUnits),
        meta: t("dashboardOnHandUnitsMeta")
      },
      {
        label: t("dashboardInventoryPositions"),
        value: formatNumber(items.length),
        meta: t("dashboardInventoryPositionsMeta")
      },
      {
        label: t("dashboardLowStockSkus"),
        value: formatNumber(lowStockCount),
        meta: t("dashboardLowStockSkusMeta")
      },
      {
        label: t("dashboardWarehousesActive"),
        value: formatNumber(activeWarehouseCount),
        meta: t("dashboardWarehousesActiveMeta")
      }
    ];
  }, [items, t]);

  const quickActions = useMemo<DashboardAction[]>(() => [
    {
      key: "receipts",
      page: "inbound-management",
      label: t("newInbound"),
      description: t("dashboardQuickActionReceipts"),
      icon: <MoveToInboxOutlined fontSize="small" />
    },
    {
      key: "shipments",
      page: "outbound-management",
      label: t("newOutbound"),
      description: t("dashboardQuickActionShipments"),
      icon: <OutboxOutlined fontSize="small" />
    },
    {
      key: "adjustments",
      page: "adjustments",
      label: t("addAdjustment"),
      description: t("dashboardQuickActionAdjustments"),
      icon: <TuneOutlined fontSize="small" />
    },
    {
      key: "transfers",
      page: "transfers",
      label: t("addTransfer"),
      description: t("dashboardQuickActionTransfers"),
      icon: <CompareArrowsOutlined fontSize="small" />
    },
    {
      key: "counts",
      page: "cycle-counts",
      label: t("addCycleCount"),
      description: t("dashboardQuickActionCounts"),
      icon: <FactCheckOutlined fontSize="small" />
    }
  ], [t]);

  const queueMetrics = useMemo<QueueMetric[]>(() => [
    { key: "receipts", label: t("dashboardOpenReceipts"), count: countOpenStatuses(inboundDocuments.map((document) => document.status)), page: "inbound-management" },
    { key: "shipments", label: t("dashboardOpenShipments"), count: countOpenStatuses(outboundDocuments.map((document) => document.status)), page: "outbound-management" },
    { key: "adjustments", label: t("dashboardOpenAdjustments"), count: countOpenStatuses(adjustments.map((document) => document.status)), page: "adjustments" },
    { key: "transfers", label: t("dashboardOpenTransfers"), count: countOpenStatuses(transfers.map((document) => document.status)), page: "transfers" },
    { key: "counts", label: t("dashboardOpenCounts"), count: countOpenStatuses(cycleCounts.map((document) => document.status)), page: "cycle-counts" }
  ], [adjustments, cycleCounts, inboundDocuments, outboundDocuments, t, transfers]);

  const exceptionMetrics = useMemo<ExceptionMetric[]>(() => [
    {
      key: "low-stock",
      label: t("dashboardExceptionLowStock"),
      count: items.filter((item) => item.reorderLevel > 0 && item.availableQty <= item.reorderLevel).length,
      page: "stock-by-location"
    },
    {
      key: "receipt-variance",
      label: t("dashboardExceptionReceiptVariance"),
      count: inboundDocuments.filter((document) => document.lines.some((line) => line.expectedQty !== line.receivedQty)).length,
      page: "inbound-management"
    },
    {
      key: "cancelled-shipments",
      label: t("dashboardExceptionCancelledShipments"),
      count: outboundDocuments.filter((document) => normalizeStatus(document.status) === "cancelled").length,
      page: "outbound-management"
    },
    {
      key: "count-variance",
      label: t("dashboardExceptionCountVariance"),
      count: cycleCounts.filter((document) => document.totalVariance !== 0).length,
      page: "cycle-counts"
    }
  ], [cycleCounts, inboundDocuments, items, outboundDocuments, t]);

  const inventoryLookupResults = useMemo<InventoryLookupRow[]>(() => {
    if (!normalizedLookupQuery) return [];

    return items
      .filter((item) => {
        const searchable = [
          item.sku,
          item.description,
          item.customerName,
          item.locationName,
          item.storageSection,
          item.containerNo
        ].join(" ").toLowerCase();
        return searchable.includes(normalizedLookupQuery);
      })
      .sort((left, right) => {
        const leftStartsWithSku = left.sku.toLowerCase().startsWith(normalizedLookupQuery);
        const rightStartsWithSku = right.sku.toLowerCase().startsWith(normalizedLookupQuery);
        if (leftStartsWithSku !== rightStartsWithSku) return leftStartsWithSku ? -1 : 1;
        return right.availableQty - left.availableQty;
      })
      .slice(0, 6)
      .map((item) => ({
        id: item.id,
        sku: item.sku,
        description: displayDescription(item),
        customerName: item.customerName,
        locationName: item.locationName,
        storageSection: item.storageSection,
        availableQty: item.availableQty,
        containerNo: item.containerNo
      }));
  }, [items, normalizedLookupQuery]);

  const recentInboundRows = useMemo(
    () => inboundDocuments
      .slice()
      .sort((left, right) => getDocumentTimestamp(right.updatedAt || right.createdAt) - getDocumentTimestamp(left.updatedAt || left.createdAt))
      .slice(0, 5)
      .map((document) => ({
        id: document.id,
        code: document.containerNo || `RCV-${document.id}`,
        customerName: document.customerName,
        dateLabel: formatDate(document.deliveryDate || document.createdAt),
        status: document.status
      })),
    [inboundDocuments]
  );

  const recentOutboundRows = useMemo(
    () => outboundDocuments
      .slice()
      .sort((left, right) => getDocumentTimestamp(right.updatedAt || right.createdAt) - getDocumentTimestamp(left.updatedAt || left.createdAt))
      .slice(0, 5)
      .map((document) => ({
        id: document.id,
        code: document.packingListNo || `SHP-${document.id}`,
        customerName: document.customerName,
        dateLabel: formatDate(document.outDate || document.createdAt),
        status: document.status
      })),
    [outboundDocuments]
  );

  return (
    <main className="workspace-main dashboard-home">
      {errorMessage ? <InlineAlert>{errorMessage}</InlineAlert> : null}

      <section className="workbook-panel dashboard-home__hero">
        <div className="dashboard-home__hero-copy">
          <p className="sheet-kicker">{t("navDashboard")}</p>
        </div>
        <div className="dashboard-home__summary-grid">
          {summaryStats.map((stat) => (
            <article className="dashboard-home__summary-card" key={stat.label}>
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
              <small>{stat.meta}</small>
            </article>
          ))}
        </div>
      </section>

      <div className="dashboard-home__grid">
        <section className="workbook-panel dashboard-home__panel dashboard-home__panel--lookup">
          <WorkspacePanelHeader
            title={t("dashboardLookupTitle")}
            description={t("dashboardLookupDesc")}
            actions={
              <button className="button button--ghost button--small" type="button" onClick={() => onNavigate("stock-by-location")}>
                {t("dashboardOpenInventory")}
              </button>
            }
          />
          <div className="dashboard-home__lookup">
            <label>
              {t("search")}
              <div className="dashboard-home__lookup-input">
                <SearchOutlined fontSize="small" />
                <input
                  value={lookupQuery}
                  onChange={(event) => setLookupQuery(event.target.value)}
                  placeholder={t("dashboardLookupPlaceholder")}
                />
              </div>
            </label>

            {isLoading ? <WorkspaceTableLoadingState title={t("loadingRecords")} description={t("dashboardLookupLoading")} /> : null}
            {!isLoading && normalizedLookupQuery.length === 0 ? (
              <WorkspaceTableEmptyState title={t("dashboardLookupPromptTitle")} description={t("dashboardLookupPromptDesc")} />
            ) : null}
            {!isLoading && normalizedLookupQuery.length > 0 && inventoryLookupResults.length === 0 ? (
              <WorkspaceTableEmptyState title={t("dashboardLookupNoResultsTitle")} description={t("dashboardLookupNoResultsDesc")} />
            ) : null}
            {!isLoading && inventoryLookupResults.length > 0 ? (
              <div className="dashboard-home__lookup-results">
                {inventoryLookupResults.map((row) => (
                  <button
                    className="dashboard-home__lookup-result"
                    key={row.id}
                    type="button"
                    onClick={() => onNavigate("stock-by-location")}
                  >
                    <div className="dashboard-home__lookup-result-copy">
                      <strong>{row.sku}</strong>
                      <span>{row.description}</span>
                      <small>{row.customerName} · {row.locationName}{row.storageSection ? ` / ${row.storageSection}` : ""}</small>
                    </div>
                    <div className="dashboard-home__lookup-result-metric">
                      <strong>{formatNumber(row.availableQty)}</strong>
                      <span>{t("availableQty")}</span>
                      {row.containerNo ? <small>{row.containerNo}</small> : null}
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </section>

        <section className="workbook-panel dashboard-home__panel">
          <WorkspacePanelHeader
            title={t("dashboardQuickActionsTitle")}
            description={t("dashboardQuickActionsDesc")}
            notices={isViewer ? [t("readOnlyModeNotice")] : []}
          />
          <div className="dashboard-home__action-grid">
            {quickActions.map((action) => (
              <button
                className="dashboard-home__action-card"
                key={action.key}
                type="button"
                onClick={() => onNavigate(action.page)}
                disabled={isViewer}
              >
                <span className="dashboard-home__action-icon" aria-hidden="true">{action.icon}</span>
                <strong>{action.label}</strong>
                <span>{action.description}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="workbook-panel dashboard-home__panel">
          <WorkspacePanelHeader
            title={t("dashboardQueuesTitle")}
            description={t("dashboardQueuesDesc")}
          />
          <div className="dashboard-home__metric-grid">
            {queueMetrics.map((metric) => (
              <button className="dashboard-home__metric-card" key={metric.key} type="button" onClick={() => onNavigate(metric.page)}>
                <div>
                  <strong>{formatNumber(metric.count)}</strong>
                  <span>{metric.label}</span>
                </div>
                <small>{t("dashboardOpenWorkspace")}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="workbook-panel dashboard-home__panel">
          <WorkspacePanelHeader
            title={t("dashboardExceptionsTitle")}
            description={t("dashboardExceptionsDesc")}
          />
          <div className="dashboard-home__metric-grid">
            {exceptionMetrics.map((metric) => (
              <button className="dashboard-home__metric-card dashboard-home__metric-card--alert" key={metric.key} type="button" onClick={() => onNavigate(metric.page)}>
                <div>
                  <strong>{formatNumber(metric.count)}</strong>
                  <span>{metric.label}</span>
                </div>
                <small>{t("dashboardReviewQueue")}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="workbook-panel dashboard-home__panel">
          <WorkspacePanelHeader
            title={t("dashboardRecentReceiptsTitle")}
            description={t("dashboardRecentReceiptsDesc")}
            actions={
              <button className="button button--ghost button--small" type="button" onClick={() => onNavigate("inbound-management")}>
                {t("dashboardOpenWorkspace")}
              </button>
            }
          />
          <RecentDocumentList
            rows={recentInboundRows}
            emptyTitle={t("dashboardNoRecentReceiptsTitle")}
            emptyDescription={t("dashboardNoRecentReceiptsDesc")}
            isLoading={isLoading}
            onOpen={() => onNavigate("inbound-management")}
          />
        </section>

        <section className="workbook-panel dashboard-home__panel">
          <WorkspacePanelHeader
            title={t("dashboardRecentShipmentsTitle")}
            description={t("dashboardRecentShipmentsDesc")}
            actions={
              <button className="button button--ghost button--small" type="button" onClick={() => onNavigate("outbound-management")}>
                {t("dashboardOpenWorkspace")}
              </button>
            }
          />
          <RecentDocumentList
            rows={recentOutboundRows}
            emptyTitle={t("dashboardNoRecentShipmentsTitle")}
            emptyDescription={t("dashboardNoRecentShipmentsDesc")}
            isLoading={isLoading}
            onOpen={() => onNavigate("outbound-management")}
          />
        </section>
      </div>
    </main>
  );
}

function RecentDocumentList({
  rows,
  emptyTitle,
  emptyDescription,
  isLoading,
  onOpen
}: {
  rows: RecentDocument[];
  emptyTitle: string;
  emptyDescription: string;
  isLoading: boolean;
  onOpen: () => void;
}) {
  const { t } = useI18n();

  if (isLoading) {
    return <WorkspaceTableLoadingState title={t("loadingRecords")} description={t("dashboardRecentDocumentsLoading")} />;
  }

  if (rows.length === 0) {
    return <WorkspaceTableEmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="dashboard-home__document-list">
      {rows.map((row) => (
        <button className="dashboard-home__document-row" key={row.id} type="button" onClick={onOpen}>
          <div className="dashboard-home__document-copy">
            <strong>{row.code}</strong>
            <span>{row.customerName}</span>
          </div>
          <div className="dashboard-home__document-meta">
            <span>{row.dateLabel}</span>
            <small>{row.status}</small>
          </div>
        </button>
      ))}
    </div>
  );
}

function countOpenStatuses(statuses: string[]) {
  return statuses.filter((status) => {
    const normalized = normalizeStatus(status);
    return normalized !== "confirmed" && normalized !== "cancelled" && normalized !== "closed";
  }).length;
}

function normalizeStatus(status: string) {
  return status.trim().toLowerCase();
}

function getDocumentTimestamp(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(parsed);
}

function displayDescription(item: Pick<Item, "description" | "name">) {
  return item.description || item.name;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}
