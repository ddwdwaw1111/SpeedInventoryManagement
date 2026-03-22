import {
  AssessmentOutlined,
  BadgeOutlined,
  CategoryOutlined,
  CompareArrowsOutlined,
  FactCheckOutlined,
  GroupsOutlined,
  HistoryOutlined,
  ManageAccountsOutlined,
  MoveToInboxOutlined,
  OutboxOutlined,
  SettingsOutlined,
  TuneOutlined,
  WarehouseOutlined
} from "@mui/icons-material";
import {
  type ReactNode,
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useState
} from "react";
import { BarChart, PieChart } from "@mui/x-charts";

import { ActivityManagementPage } from "./components/ActivityManagementPage";
import { AdjustmentManagementPage } from "./components/AdjustmentManagementPage";
import { AllActivityPage } from "./components/AllActivityPage";
import { AuditLogPage } from "./components/AuditLogPage";
import { AppHeaderUser, AuthPage } from "./components/AuthPage";
import { CustomerManagementPage } from "./components/CustomerManagementPage";
import { CycleCountManagementPage } from "./components/CycleCountManagementPage";
import { MasterInventoryPage } from "./components/MasterInventoryPage";
import { SKUMasterPage } from "./components/SKUMasterPage";
import { SettingsPage } from "./components/SettingsPage";
import { StorageManagementPage } from "./components/StorageManagementPage";
import { TransferManagementPage } from "./components/TransferManagementPage";
import { UserManagementPage } from "./components/UserManagementPage";
import { ApiError, api } from "./lib/api";
import { parseDateValue } from "./lib/dates";
import { useI18n } from "./lib/i18n";
import { getPageFromPath, navigateToPage, type PageKey } from "./lib/routes";
import type { AuditLog, Customer, CycleCount, InboundDocument, InventoryAdjustment, InventoryTransfer, Item, Location, LoginPayload, Movement, OutboundDocument, SKUMaster, SignUpPayload, User } from "./lib/types";

type ReportGranularity = "day" | "month" | "year";
type ChartTone = "blue" | "green" | "amber" | "red";
type BarRow = { label: string; value: number; meta?: string; tone?: ChartTone };
type TrendRow = { label: string; inbound: number; outbound: number };

const shortDateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const monthFormatter = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });
const yearFormatter = new Intl.DateTimeFormat("en-US", { year: "numeric" });

export default function App() {
  const { language, setLanguage, t } = useI18n();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthResolved, setIsAuthResolved] = useState(false);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [authErrorMessage, setAuthErrorMessage] = useState("");
  const [activePage, setActivePage] = useState<PageKey>(() => getPageFromPath(window.location.pathname));
  const [locations, setLocations] = useState<Location[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [skuMasters, setSkuMasters] = useState<SKUMaster[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [inboundDocuments, setInboundDocuments] = useState<InboundDocument[]>([]);
  const [outboundDocuments, setOutboundDocuments] = useState<OutboundDocument[]>([]);
  const [adjustments, setAdjustments] = useState<InventoryAdjustment[]>([]);
  const [transfers, setTransfers] = useState<InventoryTransfer[]>([]);
  const [cycleCounts, setCycleCounts] = useState<CycleCount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedLocationId, setSelectedLocationId] = useState("all");
  const [selectedCustomerId, setSelectedCustomerId] = useState("all");
  const [reportGranularity, setReportGranularity] = useState<ReportGranularity>("day");
  const [reportStartDate, setReportStartDate] = useState(() => toDateInputString(daysAgo(30)));
  const [reportEndDate, setReportEndDate] = useState(() => toDateInputString(new Date()));
  const deferredSearchTerm = useDeferredValue(searchTerm);

  useEffect(() => { void bootstrapApp(); }, []);
  useEffect(() => {
    const handlePopState = () => {
      setActivePage(getPageFromPath(window.location.pathname));
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  async function bootstrapApp() {
    setIsLoading(true);
    setErrorMessage("");
    setAuthErrorMessage("");

    try {
      const session = await api.getCurrentSession();
      setCurrentUser(session.user);
      await loadAppData(false, session.user.role);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setCurrentUser(null);
      } else {
        setErrorMessage(getErrorMessage(error, t("couldNotLoadReport")));
      }
    } finally {
      setIsAuthResolved(true);
      setIsLoading(false);
    }
  }

  async function loadAppData(showSpinner: boolean, currentRole = currentUser?.role) {
    if (showSpinner) setIsLoading(true);
    setErrorMessage("");
    try {
      const [locationsResponse, customersResponse, skuMastersResponse, itemsResponse, movementsResponse, inboundDocumentsResponse, outboundDocumentsResponse, adjustmentsResponse, transfersResponse, cycleCountsResponse, auditLogsResponse, usersResponse] = await Promise.all([
        api.getLocations(),
        api.getCustomers(),
        api.getSKUMasters(),
        api.getItems(),
        api.getMovements(1000),
        api.getInboundDocuments(300),
        api.getOutboundDocuments(300),
        api.getInventoryAdjustments(300),
        api.getInventoryTransfers(300),
        api.getCycleCounts(300),
        currentRole === "admin" ? api.getAuditLogs(500) : Promise.resolve([]),
        currentRole === "admin" ? api.getUsers() : Promise.resolve([])
      ]);
      startTransition(() => {
        setLocations(locationsResponse);
        setCustomers(customersResponse);
        setUsers(usersResponse);
        setAuditLogs(auditLogsResponse);
        setSkuMasters(skuMastersResponse);
        setItems(itemsResponse);
        setMovements(movementsResponse);
        setInboundDocuments(inboundDocumentsResponse);
        setOutboundDocuments(outboundDocumentsResponse);
        setAdjustments(adjustmentsResponse);
        setTransfers(transfersResponse);
        setCycleCounts(cycleCountsResponse);
      });
    } catch (error) {
      setErrorMessage(getErrorMessage(error, t("couldNotLoadReport")));
    } finally {
      if (showSpinner) setIsLoading(false);
    }
  }

  async function handleLogin(payload: LoginPayload) {
    setIsAuthSubmitting(true);
    setAuthErrorMessage("");
    try {
      const session = await api.login(payload);
      setCurrentUser(session.user);
      await loadAppData(true, session.user.role);
    } catch (error) {
      setAuthErrorMessage(getErrorMessage(error, "Could not sign in."));
    } finally {
      setIsAuthSubmitting(false);
      setIsAuthResolved(true);
    }
  }

  async function handleSignUp(payload: SignUpPayload) {
    setIsAuthSubmitting(true);
    setAuthErrorMessage("");
    try {
      const session = await api.signUp(payload);
      setCurrentUser(session.user);
      await loadAppData(true, session.user.role);
    } catch (error) {
      setAuthErrorMessage(getErrorMessage(error, "Could not create your account."));
    } finally {
      setIsAuthSubmitting(false);
      setIsAuthResolved(true);
    }
  }

  async function handleLogout() {
    setIsAuthSubmitting(true);
    setAuthErrorMessage("");
    try {
      await api.logout();
      setCurrentUser(null);
      setCustomers([]);
      setUsers([]);
      setAuditLogs([]);
      setLocations([]);
      setItems([]);
      setMovements([]);
      setInboundDocuments([]);
      setOutboundDocuments([]);
      setAdjustments([]);
      setTransfers([]);
      setCycleCounts([]);
    } catch (error) {
      setAuthErrorMessage(getErrorMessage(error, "Could not sign out."));
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  const canViewAuditLogs = currentUser?.role === "admin";
  const canManageUsers = currentUser?.role === "admin";

  useEffect(() => {
    if ((activePage === "audit-logs" && !canViewAuditLogs) || (activePage === "user-management" && !canManageUsers)) {
      navigateToPage("dashboard", setActivePage);
    }
  }, [activePage, canManageUsers, canViewAuditLogs]);
  const normalizedSearch = deferredSearchTerm.trim().toLowerCase();
  const filteredItems = useMemo(() => items.filter((item) => {
    const matchesSearch = normalizedSearch.length === 0
      || item.sku.toLowerCase().includes(normalizedSearch)
      || item.customerName.toLowerCase().includes(normalizedSearch)
      || displayDescription(item).toLowerCase().includes(normalizedSearch)
      || item.containerNo.toLowerCase().includes(normalizedSearch)
      || item.locationName.toLowerCase().includes(normalizedSearch);
    const matchesLocation = selectedLocationId === "all" || item.locationId === Number(selectedLocationId);
    const matchesCustomer = selectedCustomerId === "all" || item.customerId === Number(selectedCustomerId);
    const matchesRange = matchesItemDateRange(item, reportStartDate, reportEndDate);
    return matchesSearch && matchesLocation && matchesCustomer && matchesRange;
  }), [items, normalizedSearch, reportEndDate, reportStartDate, selectedCustomerId, selectedLocationId]);

  const filteredMovements = useMemo(() => movements.filter((movement) => {
    const searchBlob = [
      movement.sku,
      movement.description,
      movement.customerName,
      movement.containerNo,
      movement.referenceCode,
      movement.packingListNo,
      movement.orderRef,
      movement.locationName
    ].join(" ").toLowerCase();
    const matchesSearch = normalizedSearch.length === 0 || searchBlob.includes(normalizedSearch);
    const matchesLocation = selectedLocationId === "all"
      || locations.find((location) => location.id === Number(selectedLocationId))?.name === movement.locationName;
    const matchesCustomer = selectedCustomerId === "all" || movement.customerId === Number(selectedCustomerId);
    const matchesRange = matchesMovementDateRange(movement, reportStartDate, reportEndDate);
    return matchesSearch && matchesLocation && matchesCustomer && matchesRange;
  }), [locations, movements, normalizedSearch, reportEndDate, reportStartDate, selectedCustomerId, selectedLocationId]);

  const reportLocationRows = useMemo(() => buildLocationInventoryRows(filteredItems, locations), [filteredItems, locations]);
  const reportTopSkuRows = useMemo(() => buildTopSkuRows(filteredItems), [filteredItems]);
  const reportLowStockRows = useMemo(() => buildLowStockRows(filteredItems), [filteredItems]);
  const reportTrendRows = useMemo(() => buildMovementTrendRows(filteredMovements, reportGranularity), [filteredMovements, reportGranularity]);

  const pageItems: Array<{ key: PageKey; label: string; description: string; icon: ReactNode }> = [
    { key: "dashboard", label: t("report"), description: t("reportDesc"), icon: <AssessmentOutlined fontSize="small" /> },
    { key: "inbound-management", label: t("inbound"), description: t("inboundDesc"), icon: <MoveToInboxOutlined fontSize="small" /> },
    { key: "outbound-management", label: t("outbound"), description: t("outboundDesc"), icon: <OutboxOutlined fontSize="small" /> },
    { key: "adjustments", label: t("adjustments"), description: t("adjustmentsDesc"), icon: <TuneOutlined fontSize="small" /> },
    { key: "transfers", label: t("transfers"), description: t("transfersDesc"), icon: <CompareArrowsOutlined fontSize="small" /> },
    { key: "cycle-counts", label: t("cycleCounts"), description: t("cycleCountsDesc"), icon: <FactCheckOutlined fontSize="small" /> },
    { key: "all-activity", label: t("allActivity"), description: t("allActivityDesc"), icon: <HistoryOutlined fontSize="small" /> },
    { key: "customers", label: t("customers"), description: t("customersDesc"), icon: <GroupsOutlined fontSize="small" /> },
    ...(canViewAuditLogs ? [{ key: "audit-logs" as PageKey, label: t("auditLogs"), description: t("auditLogsDesc"), icon: <BadgeOutlined fontSize="small" /> }] : []),
    ...(canManageUsers ? [{ key: "user-management" as PageKey, label: t("userManagement"), description: t("userManagementDesc"), icon: <ManageAccountsOutlined fontSize="small" /> }] : []),
    { key: "sku-master", label: t("skuMaster"), description: t("skuMasterDesc"), icon: <CategoryOutlined fontSize="small" /> },
    { key: "stock-by-location", label: t("stockByLocation"), description: t("stockByLocationDesc"), icon: <WarehouseOutlined fontSize="small" /> },
    { key: "storage-management", label: t("storageManagement"), description: t("storageManagementDesc"), icon: <WarehouseOutlined fontSize="small" /> },
    { key: "settings", label: t("settings"), description: t("settingsDesc"), icon: <SettingsOutlined fontSize="small" /> }
  ];

  if (!isAuthResolved || (isLoading && !currentUser)) {
    return (
      <main className="auth-shell auth-shell--loading">
        <section className="auth-card">
          <p className="eyebrow">Loading</p>
          <h2>Checking your session...</h2>
        </section>
      </main>
    );
  }

  if (!currentUser) {
    return (
      <AuthPage
        onLogin={handleLogin}
        onSignUp={handleSignUp}
        isSubmitting={isAuthSubmitting}
        errorMessage={authErrorMessage}
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <div className="app-topbar__brand">
          <p className="eyebrow">{t("inventorySystem")}</p>
          <h2>{t("speedInventory")}</h2>
          <div className="language-switch" aria-label={t("language")}>
            <button className={`language-switch__button ${language === "en" ? "language-switch__button--active" : ""}`} type="button" onClick={() => setLanguage("en")}>{t("english")}</button>
            <button className={`language-switch__button ${language === "zh" ? "language-switch__button--active" : ""}`} type="button" onClick={() => setLanguage("zh")}>{t("chinese")}</button>
          </div>
          <AppHeaderUser user={currentUser} onLogout={handleLogout} isSubmitting={isAuthSubmitting} />
        </div>
        <nav className="app-topbar__nav" aria-label={t("pages")}>
          {pageItems.map((item) => (
            <button
              key={item.key}
              className={`app-topbar__link ${activePage === item.key ? "app-topbar__link--active" : ""}`}
              type="button"
              onClick={() => navigateToPage(item.key, setActivePage)}
            >
              <span className="app-topbar__link-icon" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
              <small>{item.description}</small>
            </button>
          ))}
        </nav>
      </header>

      <div className="workspace-shell">
        {activePage === "inbound-management" ? <ActivityManagementPage mode="IN" items={items} locations={locations} customers={customers} movements={movements} inboundDocuments={inboundDocuments} outboundDocuments={outboundDocuments} currentUserRole={currentUser.role} isLoading={isLoading} onRefresh={() => loadAppData(false)} /> : null}
        {activePage === "outbound-management" ? <ActivityManagementPage mode="OUT" items={items} locations={locations} customers={customers} movements={movements} inboundDocuments={inboundDocuments} outboundDocuments={outboundDocuments} currentUserRole={currentUser.role} isLoading={isLoading} onRefresh={() => loadAppData(false)} /> : null}
        {activePage === "adjustments" ? <AdjustmentManagementPage adjustments={adjustments} items={items} currentUserRole={currentUser.role} isLoading={isLoading} onRefresh={() => loadAppData(false)} /> : null}
        {activePage === "transfers" ? <TransferManagementPage transfers={transfers} items={items} locations={locations} currentUserRole={currentUser.role} isLoading={isLoading} onRefresh={() => loadAppData(false)} /> : null}
        {activePage === "cycle-counts" ? <CycleCountManagementPage cycleCounts={cycleCounts} items={items} currentUserRole={currentUser.role} isLoading={isLoading} onRefresh={() => loadAppData(false)} /> : null}
        {activePage === "all-activity" ? <AllActivityPage movements={movements} locations={locations} customers={customers} isLoading={isLoading} /> : null}
        {activePage === "customers" ? <CustomerManagementPage customers={customers} items={items} currentUserRole={currentUser.role} isLoading={isLoading} onRefresh={() => loadAppData(false)} /> : null}
        {activePage === "audit-logs" && canViewAuditLogs ? <AuditLogPage auditLogs={auditLogs} isLoading={isLoading} /> : null}
        {activePage === "user-management" && canManageUsers ? <UserManagementPage users={users} currentUser={currentUser} isLoading={isLoading} onRefresh={() => loadAppData(false)} /> : null}
        {activePage === "sku-master" ? <SKUMasterPage skuMasters={skuMasters} currentUserRole={currentUser.role} isLoading={isLoading} onRefresh={() => loadAppData(false)} /> : null}
        {activePage === "stock-by-location" ? <MasterInventoryPage items={items} locations={locations} customers={customers} currentUserRole={currentUser.role} isLoading={isLoading} onRefresh={() => loadAppData(false)} /> : null}
        {activePage === "storage-management" ? <StorageManagementPage locations={locations} items={items} currentUserRole={currentUser.role} onRefresh={() => loadAppData(false)} /> : null}
        {activePage === "settings" ? <SettingsPage /> : null}

        {activePage === "dashboard" ? (
          <main className="workspace-main">
            {errorMessage ? <div className="alert-banner">{errorMessage}</div> : null}

            <section className="workbook-panel workbook-panel--full">
              <div className="tab-strip">
                <div className="tab-strip__heading">
                  <h2>{t("reportOverviewTitle")}</h2>
                  <p>{t("reportOverviewSubtitle")}</p>
                </div>
                <div className="filter-bar">
                  <label>{t("search")}<input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder={t("searchSkuPlaceholder")} /></label>
                  <label>{t("customer")}<select value={selectedCustomerId} onChange={(event) => setSelectedCustomerId(event.target.value)}><option value="all">{t("allCustomers")}</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
                  <label>{t("currentStorage")}<select value={selectedLocationId} onChange={(event) => setSelectedLocationId(event.target.value)}><option value="all">{t("allStorage")}</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
                  <label>{t("groupBy")}<select value={reportGranularity} onChange={(event) => setReportGranularity(event.target.value as ReportGranularity)}><option value="day">{t("daily")}</option><option value="month">{t("monthly")}</option><option value="year">{t("yearly")}</option></select></label>
                  <label>{t("fromDate")}<input type="date" value={reportStartDate} onChange={(event) => setReportStartDate(event.target.value)} /></label>
                  <label>{t("toDate")}<input type="date" value={reportEndDate} onChange={(event) => setReportEndDate(event.target.value)} /></label>
                </div>
              </div>

              <div className="report-grid">
                <ReportCard title={t("inventoryByStorage")} subtitle={t("inventoryByStorageDesc")}>
                  <StorageDistributionChart rows={reportLocationRows} emptyLabel={t("noResults")} valueSuffix={t("units")} />
                </ReportCard>

                <ReportCard title={t("movementTrend")} subtitle={t("movementTrendDesc")}>
                  <MovementTrendChart rows={reportTrendRows} emptyLabel={t("noResults")} inboundLabel={t("inbound")} outboundLabel={t("outbound")} />
                </ReportCard>

                <ReportCard title={t("topSkuOnHand")} subtitle={t("topSkuOnHandDesc")}>
                  <InventoryBarChart rows={reportTopSkuRows} emptyLabel={t("noResults")} valueSuffix={t("units")} seriesLabel={t("onHand")} color="#274c77" />
                </ReportCard>

                <ReportCard title={t("lowStockAttention")} subtitle={t("lowStockAttentionDesc")}>
                  <InventoryBarChart rows={reportLowStockRows} emptyLabel={t("noResults")} valueSuffix={t("unitsShort")} seriesLabel={t("lowStock")} color="#c79b5d" />
                </ReportCard>
              </div>
            </section>
          </main>
        ) : null}
      </div>
    </div>
  );
}

function ReportCard({
  title,
  subtitle,
  children
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="report-card">
      <div className="report-card__header">
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function StorageDistributionChart({
  rows,
  emptyLabel,
  valueSuffix
}: {
  rows: BarRow[];
  emptyLabel: string;
  valueSuffix: string;
}) {
  const maxValue = Math.max(...rows.map((row) => row.value), 1);

  if (rows.length === 0) {
    return <div className="empty-state">{emptyLabel}</div>;
  }

  return (
    <>
      <div className="report-chart-wrap">
        <PieChart
          height={320}
          margin={{ top: 20, bottom: 20, left: 20, right: 20 }}
          series={[
            {
              data: rows.map((row, index) => ({
                id: index,
                value: row.value,
                label: row.label
              })),
              innerRadius: 48,
              outerRadius: 108,
              paddingAngle: 2,
              cornerRadius: 6,
              cx: 160
            }
          ]}
          colors={rows.map((row) => getChartColor(row.tone ?? "blue"))}
          slotProps={{ legend: { direction: "vertical", position: { vertical: "middle", horizontal: "end" } } }}
        />
      </div>
      <div className="report-bars report-bars--summary">
        {rows.map((row) => (
          <div className="report-bars__row" key={row.label}>
            <div className="report-bars__labels">
              <strong>{row.label}</strong>
              {row.meta ? <span>{row.meta}</span> : null}
            </div>
            <div className="report-bars__value">{formatNumber(row.value)} {valueSuffix}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function InventoryBarChart({
  rows,
  emptyLabel,
  valueSuffix,
  seriesLabel,
  color
}: {
  rows: BarRow[];
  emptyLabel: string;
  valueSuffix: string;
  seriesLabel: string;
  color: string;
}) {
  if (rows.length === 0) {
    return <div className="empty-state">{emptyLabel}</div>;
  }

  return (
    <>
      <div className="report-chart-wrap">
        <BarChart
          dataset={rows}
          height={320}
          layout="horizontal"
          margin={{ top: 20, bottom: 20, left: 110, right: 20 }}
          yAxis={[{ scaleType: "band", dataKey: "label" }]}
          series={[{ dataKey: "value", label: seriesLabel, color }]}
          hideLegend
          grid={{ vertical: true }}
        />
      </div>
      <div className="report-bars report-bars--summary">
        {rows.map((row) => (
          <div className="report-bars__row" key={row.label}>
            <div className="report-bars__labels">
              <strong>{row.label}</strong>
              {row.meta ? <span>{row.meta}</span> : null}
            </div>
            <div className="report-bars__value">{formatNumber(row.value)} {valueSuffix}</div>
          </div>
        ))}
      </div>
    </>
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
  const maxValue = Math.max(...rows.flatMap((row) => [row.inbound, row.outbound]), 1);

  if (rows.length === 0) {
    return <div className="empty-state">{emptyLabel}</div>;
  }

  return (
    <>
      <div className="report-chart-wrap">
        <BarChart
          dataset={rows}
          height={320}
          margin={{ top: 20, bottom: 20, left: 40, right: 20 }}
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
          <div className="trend-chart__group" key={row.label}>
            <div className="trend-chart__mini-meter">
              <div className="trend-chart__mini-bar trend-chart__mini-bar--in" style={{ width: `${Math.max((row.inbound / maxValue) * 100, row.inbound > 0 ? 10 : 0)}%` }} />
              <div className="trend-chart__mini-bar trend-chart__mini-bar--out" style={{ width: `${Math.max((row.outbound / maxValue) * 100, row.outbound > 0 ? 10 : 0)}%` }} />
            </div>
            <div className="trend-chart__totals">{formatNumber(row.inbound)} / {formatNumber(row.outbound)}</div>
            <div className="trend-chart__label">{row.label}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function buildLocationInventoryRows(items: Item[], locations: Location[]): BarRow[] {
  const totals = new Map<number, { label: string; quantity: number; skuCount: number }>();

  for (const location of locations) {
    totals.set(location.id, { label: location.name, quantity: 0, skuCount: 0 });
  }

  for (const item of items) {
    const existing = totals.get(item.locationId) ?? { label: item.locationName || `#${item.locationId}`, quantity: 0, skuCount: 0 };
    existing.quantity += item.quantity;
    existing.skuCount += 1;
    totals.set(item.locationId, existing);
  }

  return Array.from(totals.values())
    .filter((row) => row.quantity > 0 || row.skuCount > 0)
    .sort((left, right) => right.quantity - left.quantity)
    .slice(0, 8)
    .map((row) => ({
      label: row.label,
      value: row.quantity,
      meta: `${formatNumber(row.skuCount)} SKU`,
      tone: "blue"
    }));
}

function buildTopSkuRows(items: Item[]): BarRow[] {
  return [...items]
    .sort((left, right) => right.quantity - left.quantity)
    .slice(0, 8)
    .map((item) => ({
      label: item.sku,
      value: item.quantity,
      meta: displayDescription(item),
      tone: "green"
    }));
}

function buildLowStockRows(items: Item[]): BarRow[] {
  return items
    .filter((item) => item.reorderLevel > 0 && item.quantity <= item.reorderLevel)
    .sort((left, right) => (right.reorderLevel - right.quantity) - (left.reorderLevel - left.quantity))
    .slice(0, 8)
    .map((item) => ({
      label: item.sku,
      value: Math.max(item.reorderLevel - item.quantity, 0),
      meta: `On hand ${formatNumber(item.quantity)} / Reorder ${formatNumber(item.reorderLevel)}`,
      tone: item.quantity === 0 ? "red" : "amber"
    }));
}

function buildMovementTrendRows(movements: Movement[], granularity: ReportGranularity): TrendRow[] {
  const recentRows = movements
    .map((movement) => ({ movement, timestamp: getMovementTimestamp(movement) }))
    .filter((row) => row.timestamp !== null)
    .sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0));

  const trendMap = new Map<string, TrendRow>();

  for (const row of recentRows) {
    if (row.timestamp === null) continue;
    const label = formatTrendLabel(new Date(row.timestamp), granularity);
    const trend = trendMap.get(label) ?? { label, inbound: 0, outbound: 0 };
    if (row.movement.movementType === "IN" || row.movement.movementType === "REVERSAL") {
      trend.inbound += Math.abs(row.movement.quantityChange);
    }
    if (row.movement.movementType === "OUT") {
      trend.outbound += Math.abs(row.movement.quantityChange);
    }
    trendMap.set(label, trend);
  }

  return Array.from(trendMap.values());
}

function getMovementTimestamp(movement: Movement) {
  const value = movement.outDate || movement.deliveryDate || movement.createdAt;
  if (!value) return null;
  const timestamp = parseDateValue(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function matchesItemDateRange(item: Item, startDate: string, endDate: string) {
  return [item.deliveryDate, item.outDate, item.lastRestockedAt, item.createdAt, item.updatedAt]
    .some((candidate) => isWithinDateRange(candidate, startDate, endDate));
}

function matchesMovementDateRange(movement: Movement, startDate: string, endDate: string) {
  return [movement.deliveryDate, movement.outDate, movement.createdAt]
    .some((candidate) => isWithinDateRange(candidate, startDate, endDate));
}

function isWithinDateRange(value: string | null | undefined, startDate: string, endDate: string) {
  if (!value) return false;
  const timestamp = parseDateValue(value).getTime();
  if (Number.isNaN(timestamp)) return false;

  const start = startDate ? parseDateValue(startDate).getTime() : null;
  const end = endDate ? endOfDay(parseDateValue(endDate)).getTime() : null;

  if (start !== null && timestamp < start) return false;
  if (end !== null && timestamp > end) return false;
  return true;
}

function formatTrendLabel(date: Date, granularity: ReportGranularity) {
  if (granularity === "year") {
    return yearFormatter.format(date);
  }
  if (granularity === "month") {
    return monthFormatter.format(date);
  }
  return shortDateFormatter.format(date);
}

function daysAgo(days: number) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date;
}

function toDateInputString(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function endOfDay(date: Date) {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

function displayDescription(item: Pick<Item, "description" | "name">) { return item.description || item.name; }
function getErrorMessage(error: unknown, fallbackMessage: string) { return error instanceof Error && error.message ? error.message : fallbackMessage; }
function formatNumber(value: number) { return new Intl.NumberFormat("en-US").format(value); }
function getChartColor(tone: ChartTone) {
  if (tone === "green") return "#3c6e71";
  if (tone === "amber") return "#c79b5d";
  if (tone === "red") return "#b76857";
  return "#274c77";
}
