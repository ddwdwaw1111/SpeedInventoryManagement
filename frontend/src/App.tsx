import {
  AssessmentOutlined,
  ArrowBackOutlined,
  BadgeOutlined,
  CategoryOutlined,
  ChevronLeftOutlined,
  ExpandMoreOutlined,
  ChevronRightOutlined,
  CompareArrowsOutlined,
  FactCheckOutlined,
  FileDownloadOutlined,
  GroupsOutlined,
  HomeOutlined,
  HistoryOutlined,
  ManageAccountsOutlined,
  MoveToInboxOutlined,
  OutboxOutlined,
  SettingsOutlined,
  TuneOutlined,
  WarehouseOutlined
} from "@mui/icons-material";
import { Suspense, lazy, type ReactNode, useEffect, useMemo, useState } from "react";

import { ActivityManagementPage } from "./components/ActivityManagementPage";
import { AdjustmentManagementPage } from "./components/AdjustmentManagementPage";
import { AllActivityPage } from "./components/AllActivityPage";
import { AuditLogPage } from "./components/AuditLogPage";
import { AppHeaderUser, AuthPage } from "./components/AuthPage";
import { ContainerContentsPage } from "./components/ContainerContentsPage";
import { CustomerManagementPage } from "./components/CustomerManagementPage";
import { CycleCountManagementPage } from "./components/CycleCountManagementPage";
import { HomeDashboardPage } from "./components/HomeDashboardPage";
import { ExportCenterPage } from "./components/ExportCenterPage";
import { InventorySummaryPage } from "./components/InventorySummaryPage";
import { MasterInventoryPage } from "./components/MasterInventoryPage";
import { ReportsPage } from "./components/ReportsPage";
import { ReceiptLotTracePage } from "./components/ReceiptLotTracePage";
import { SKUMasterPage } from "./components/SKUMasterPage";
import { SettingsPage } from "./components/SettingsPage";
import { StorageLocationEditorPage } from "./components/StorageLocationEditorPage";
import { StorageManagementPage } from "./components/StorageManagementPage";
import { TransferManagementPage } from "./components/TransferManagementPage";
import { UserManagementPage } from "./components/UserManagementPage";
import { ApiError, api } from "./lib/api";
import { useI18n } from "./lib/i18n";
import { getPageFromPath, getStorageLocationEditorIdFromPath, navigateToPage, navigateToStorageLocationEditor, type PageKey } from "./lib/routes";
import type { AuditLog, Customer, CycleCount, InboundDocument, InventoryAdjustment, InventoryTransfer, Item, Location, LoginPayload, Movement, OutboundDocument, SKUMaster, SignUpPayload, User } from "./lib/types";

const WarehouseMapPage = lazy(async () => {
  const module = await import("./components/WarehouseMapPage");
  return { default: module.WarehouseMapPage };
});

export default function App() {
  const { t } = useI18n();
  const navLabels = {
    inventory: t("navInventory"),
    masterData: t("masterData"),
    reports: t("reportsSection"),
    administration: t("navAdmin")
  };
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.localStorage.getItem("sim-sidebar-collapsed") === "true");
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => {
    try {
      const saved = window.localStorage.getItem("sim-sidebar-sections");
      if (!saved) return {};
      const parsed = JSON.parse(saved);
      return typeof parsed === "object" && parsed ? parsed as Record<string, boolean> : {};
    } catch {
      return {};
    }
  });
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
  const activeInboundDocuments = useMemo(
    () => inboundDocuments.filter((document) => !document.archivedAt),
    [inboundDocuments]
  );
  const activeOutboundDocuments = useMemo(
    () => outboundDocuments.filter((document) => !document.archivedAt),
    [outboundDocuments]
  );

  useEffect(() => { void bootstrapApp(); }, []);
  useEffect(() => {
    const handlePopState = () => {
      setActivePage(getPageFromPath(window.location.pathname));
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);
  useEffect(() => {
    window.localStorage.setItem("sim-sidebar-collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);
  useEffect(() => {
    window.localStorage.setItem("sim-sidebar-sections", JSON.stringify(collapsedSections));
  }, [collapsedSections]);

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
      const results = await Promise.allSettled([
        api.getLocations(),
        api.getCustomers(),
        api.getSKUMasters(),
        api.getItems(),
        api.getMovements(20000),
        api.getInboundDocuments(300, "all"),
        api.getOutboundDocuments(300, "all"),
        api.getInventoryAdjustments(300),
        api.getInventoryTransfers(300),
        api.getCycleCounts(300),
        currentRole === "admin" ? api.getAuditLogs(500) : Promise.resolve([]),
        currentRole === "admin" ? api.getUsers() : Promise.resolve([])
      ]);

      const [
        locationsResult,
        customersResult,
        skuMastersResult,
        itemsResult,
        movementsResult,
        inboundDocumentsResult,
        outboundDocumentsResult,
        adjustmentsResult,
        transfersResult,
        cycleCountsResult,
        auditLogsResult,
        usersResult
      ] = results;

      const firstRejectedResult = results.find((result) => result.status === "rejected");
      if (locationsResult.status === "fulfilled") setLocations(locationsResult.value);
      if (customersResult.status === "fulfilled") setCustomers(customersResult.value);
      if (usersResult.status === "fulfilled") setUsers(usersResult.value);
      if (auditLogsResult.status === "fulfilled") setAuditLogs(auditLogsResult.value);
      if (skuMastersResult.status === "fulfilled") setSkuMasters(skuMastersResult.value);
      if (itemsResult.status === "fulfilled") setItems(itemsResult.value);
      if (movementsResult.status === "fulfilled") setMovements(movementsResult.value);
      if (inboundDocumentsResult.status === "fulfilled") setInboundDocuments(inboundDocumentsResult.value);
      if (outboundDocumentsResult.status === "fulfilled") setOutboundDocuments(outboundDocumentsResult.value);
      if (adjustmentsResult.status === "fulfilled") setAdjustments(adjustmentsResult.value);
      if (transfersResult.status === "fulfilled") setTransfers(transfersResult.value);
      if (cycleCountsResult.status === "fulfilled") setCycleCounts(cycleCountsResult.value);

      if (firstRejectedResult?.status === "rejected") {
        setErrorMessage(getErrorMessage(firstRejectedResult.reason, t("couldNotLoadReport")));
      }
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
  const canViewReceiptLots = currentUser?.role === "admin";
  const canManageUsers = currentUser?.role === "admin";

  useEffect(() => {
    if (
      (activePage === "audit-logs" && !canViewAuditLogs) ||
      (activePage === "receipt-lots" && !canViewReceiptLots) ||
      (activePage === "user-management" && !canManageUsers)
    ) {
      navigateToPage("dashboard", setActivePage);
    }
  }, [activePage, canManageUsers, canViewAuditLogs, canViewReceiptLots]);

  const pageItems: Array<{ key: PageKey; label: string; description: string; icon: ReactNode }> = [
    { key: "dashboard", label: t("navDashboard"), description: t("dashboardDesc"), icon: <HomeOutlined fontSize="small" /> },
    { key: "reports", label: t("report"), description: t("reportDesc"), icon: <AssessmentOutlined fontSize="small" /> },
    { key: "export-center", label: t("exportCenter"), description: t("exportCenterDesc"), icon: <FileDownloadOutlined fontSize="small" /> },
    { key: "inbound-management", label: t("navReceiving"), description: t("inboundDesc"), icon: <MoveToInboxOutlined fontSize="small" /> },
    { key: "outbound-management", label: t("navShipping"), description: t("outboundDesc"), icon: <OutboxOutlined fontSize="small" /> },
    { key: "inventory-summary", label: t("inventorySummary"), description: t("inventorySummaryDesc"), icon: <WarehouseOutlined fontSize="small" /> },
    { key: "warehouse-map", label: t("warehouseMap"), description: t("warehouseMapDesc"), icon: <WarehouseOutlined fontSize="small" /> },
    { key: "container-contents", label: t("containerContents"), description: t("containerContentsDesc"), icon: <WarehouseOutlined fontSize="small" /> },
    { key: "adjustments", label: t("adjustments"), description: t("adjustmentsDesc"), icon: <TuneOutlined fontSize="small" /> },
    { key: "transfers", label: t("transfers"), description: t("transfersDesc"), icon: <CompareArrowsOutlined fontSize="small" /> },
    { key: "cycle-counts", label: t("cycleCounts"), description: t("cycleCountsDesc"), icon: <FactCheckOutlined fontSize="small" /> },
    { key: "all-activity", label: t("allActivity"), description: t("allActivityDesc"), icon: <HistoryOutlined fontSize="small" /> },
    { key: "customers", label: t("customers"), description: t("customersDesc"), icon: <GroupsOutlined fontSize="small" /> },
    ...(canViewAuditLogs ? [{ key: "audit-logs" as PageKey, label: t("auditLogs"), description: t("auditLogsDesc"), icon: <BadgeOutlined fontSize="small" /> }] : []),
    ...(canViewReceiptLots ? [{ key: "receipt-lots" as PageKey, label: t("receiptLotTrace"), description: t("receiptLotTraceDesc"), icon: <HistoryOutlined fontSize="small" /> }] : []),
    ...(canManageUsers ? [{ key: "user-management" as PageKey, label: t("userManagement"), description: t("userManagementDesc"), icon: <ManageAccountsOutlined fontSize="small" /> }] : []),
    { key: "sku-master", label: t("skuMaster"), description: t("skuMasterDesc"), icon: <CategoryOutlined fontSize="small" /> },
    { key: "stock-by-location", label: t("stockByLocation"), description: t("stockByLocationDesc"), icon: <WarehouseOutlined fontSize="small" /> },
    { key: "storage-management", label: t("storageManagement"), description: t("storageManagementDesc"), icon: <WarehouseOutlined fontSize="small" /> },
    { key: "storage-location-editor", label: t("editStorageLocation"), description: t("warehouseLayoutDesc"), icon: <WarehouseOutlined fontSize="small" /> },
    { key: "settings", label: t("settings"), description: t("settingsDesc"), icon: <SettingsOutlined fontSize="small" /> }
  ];
  const pageItemMap = new Map(pageItems.map((item) => [item.key, item] as const));
  const primaryNavItems = (["dashboard", "inbound-management", "outbound-management"] as PageKey[])
    .map((pageKey) => pageItemMap.get(pageKey))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const navSections = [
    { key: "inventory", label: navLabels.inventory, items: ["inventory-summary", "warehouse-map", "container-contents", "all-activity"] as PageKey[] },
    { key: "master-data", label: navLabels.masterData, items: ["customers", "sku-master", "storage-management"] as PageKey[] },
    { key: "reports", label: navLabels.reports, items: ["reports", "export-center"] as PageKey[] },
    { key: "administration", label: navLabels.administration, items: ["audit-logs", "receipt-lots", "user-management", "settings"] as PageKey[] }
  ].map((section) => ({
    ...section,
    items: section.items
      .map((pageKey) => pageItemMap.get(pageKey))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
  })).filter((section) => section.items.length > 0);
  const activePageItem = pageItemMap.get(activePage) ?? pageItems[0];
  const parentPageByPage: Partial<Record<PageKey, PageKey>> = {
    "stock-by-location": "inventory-summary",
    adjustments: "inventory-summary",
    transfers: "inventory-summary",
    "cycle-counts": "inventory-summary",
    "storage-location-editor": "storage-management"
  };
  const sectionKeyByPage: Partial<Record<PageKey, string>> = {
    "inventory-summary": "inventory",
    "warehouse-map": "inventory",
    "container-contents": "inventory",
    "stock-by-location": "inventory",
    "adjustments": "inventory",
    "transfers": "inventory",
    "cycle-counts": "inventory",
    "all-activity": "inventory",
    customers: "master-data",
    "sku-master": "master-data",
    "storage-management": "master-data",
    "storage-location-editor": "master-data",
    reports: "reports",
    "export-center": "reports",
    "audit-logs": "administration",
    "receipt-lots": "administration",
    "user-management": "administration",
    settings: "administration"
  };
  const parentPage = parentPageByPage[activePage] ? pageItemMap.get(parentPageByPage[activePage] as PageKey) : null;
  const activeNavSection = navSections.find((section) => section.key === sectionKeyByPage[activePage]);
  const showPageContext = activePage !== "dashboard";
  const editingStorageLocationId = getStorageLocationEditorIdFromPath(window.location.pathname);
  const editingStorageLocation = editingStorageLocationId
    ? locations.find((location) => location.id === editingStorageLocationId) ?? null
    : null;
  useEffect(() => {
    if (!activeNavSection) return;
    setCollapsedSections((current) => current[activeNavSection.key] ? { ...current, [activeNavSection.key]: false } : current);
  }, [activeNavSection]);

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
      <header className="app-toolbar">
        <button className="app-toolbar__brand" type="button" onClick={() => navigateToPage("dashboard", setActivePage)}>
          <div className="app-toolbar__brand-mark" aria-hidden="true">SI</div>
          <div className="app-toolbar__brand-copy">
            <span>{t("inventorySystem")}</span>
            <strong>{t("speedInventory")}</strong>
          </div>
        </button>

        <div className="app-toolbar__controls">
          <button
            className="app-toolbar__action"
            type="button"
            onClick={() => navigateToPage("settings", setActivePage)}
            title={t("settings")}
            aria-label={t("settings")}
          >
            <SettingsOutlined fontSize="small" />
          </button>
          <AppHeaderUser user={currentUser} onLogout={handleLogout} isSubmitting={isAuthSubmitting} />
        </div>
      </header>

      <div className={`app-workspace ${sidebarCollapsed ? "app-workspace--sidebar-collapsed" : ""}`}>
        <aside className={`app-sidebar ${sidebarCollapsed ? "app-sidebar--collapsed" : ""}`}>
        <div className="app-sidebar__home">
          {primaryNavItems.map((item) => (
            <button
              key={item.key}
              className={`app-sidebar__link app-sidebar__link--home ${activePage === item.key ? "app-sidebar__link--active" : ""}`}
              type="button"
              onClick={() => navigateToPage(item.key, setActivePage)}
              title={sidebarCollapsed ? item.label : undefined}
            >
              <span className="app-sidebar__link-icon" aria-hidden="true">{item.icon}</span>
              {!sidebarCollapsed ? <span className="app-sidebar__link-label">{item.label}</span> : null}
            </button>
          ))}
        </div>
        <nav className="app-sidebar__nav" aria-label={t("pages")}>
          {navSections.map((section) => (
            <section className="app-sidebar__section" key={section.key}>
              {!sidebarCollapsed ? (
                <button
                  className={`app-sidebar__section-toggle ${activeNavSection?.key === section.key ? "app-sidebar__section-toggle--active" : ""}`}
                  type="button"
                  onClick={() => setCollapsedSections((current) => ({ ...current, [section.key]: !current[section.key] }))}
                  aria-expanded={!collapsedSections[section.key]}
                >
                  <span className="app-sidebar__section-label">{section.label}</span>
                  <ExpandMoreOutlined
                    fontSize="small"
                    className={`app-sidebar__section-chevron ${collapsedSections[section.key] ? "app-sidebar__section-chevron--collapsed" : ""}`}
                  />
                </button>
              ) : null}
              <div className={`app-sidebar__section-items ${!sidebarCollapsed && collapsedSections[section.key] ? "app-sidebar__section-items--collapsed" : ""}`}>
                {section.items.map((item) => (
                  <button
                    key={item.key}
                    className={`app-sidebar__link ${activePage === item.key ? "app-sidebar__link--active" : ""}`}
                    type="button"
                    onClick={() => navigateToPage(item.key, setActivePage)}
                    title={sidebarCollapsed ? item.label : undefined}
                  >
                    <span className="app-sidebar__link-icon" aria-hidden="true">{item.icon}</span>
                    {!sidebarCollapsed ? <span className="app-sidebar__link-label">{item.label}</span> : null}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </nav>
        <button
          className="app-sidebar__rail-toggle"
          type="button"
          onClick={() => setSidebarCollapsed((value) => !value)}
          aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
          title={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
        >
          {sidebarCollapsed ? <ChevronRightOutlined fontSize="small" /> : <ChevronLeftOutlined fontSize="small" />}
        </button>
        </aside>

        <div className="app-main">
        <div className="workspace-shell">
          {showPageContext ? (
            <div className="app-page-context">
              <div className="app-page-context__leading">
                {parentPage ? (
                  <button
                    className="app-page-context__back-button"
                    type="button"
                    onClick={() => navigateToPage(parentPage.key, setActivePage)}
                  >
                    <ArrowBackOutlined fontSize="small" />
                    <span>{t("back")}</span>
                  </button>
                ) : null}
                <div className="app-page-context__breadcrumb">
                  {activeNavSection ? <span>{activeNavSection.label}</span> : null}
                  {activeNavSection ? <span aria-hidden="true">/</span> : null}
                  <span>{activePageItem.label}</span>
                </div>
              </div>
            </div>
          ) : null}
          {activePage === "inbound-management" ? <ActivityManagementPage mode="IN" items={items} skuMasters={skuMasters} locations={locations} customers={customers} movements={movements} inboundDocuments={inboundDocuments} outboundDocuments={outboundDocuments} currentUserRole={currentUser.role} isLoading={isLoading} onRefresh={() => loadAppData(false)} /> : null}
          {activePage === "outbound-management" ? <ActivityManagementPage mode="OUT" items={items} skuMasters={skuMasters} locations={locations} customers={customers} movements={movements} inboundDocuments={inboundDocuments} outboundDocuments={outboundDocuments} currentUserRole={currentUser.role} isLoading={isLoading} onRefresh={() => loadAppData(false)} /> : null}
          {activePage === "adjustments" ? <AdjustmentManagementPage adjustments={adjustments} items={items} currentUserRole={currentUser.role} isLoading={isLoading} onRefresh={() => loadAppData(false)} onNavigate={(page) => navigateToPage(page, setActivePage)} /> : null}
          {activePage === "transfers" ? <TransferManagementPage transfers={transfers} items={items} locations={locations} currentUserRole={currentUser.role} isLoading={isLoading} onRefresh={() => loadAppData(false)} onNavigate={(page) => navigateToPage(page, setActivePage)} /> : null}
          {activePage === "cycle-counts" ? <CycleCountManagementPage cycleCounts={cycleCounts} items={items} currentUserRole={currentUser.role} isLoading={isLoading} onRefresh={() => loadAppData(false)} onNavigate={(page) => navigateToPage(page, setActivePage)} /> : null}
          {activePage === "inventory-summary" ? <InventorySummaryPage items={items} movements={movements} customers={customers} locations={locations} currentUserRole={currentUser.role} isLoading={isLoading} onNavigate={(page) => navigateToPage(page, setActivePage)} /> : null}
          {activePage === "warehouse-map" ? (
            <Suspense fallback={<section className="workbook-panel"><div className="empty-state">{t("loadingRecords")}</div></section>}>
              <WarehouseMapPage items={items} isLoading={isLoading} onNavigate={(page) => navigateToPage(page, setActivePage)} />
            </Suspense>
          ) : null}
          {activePage === "container-contents" ? <ContainerContentsPage items={items} customers={customers} locations={locations} currentUserRole={currentUser.role} isLoading={isLoading} onNavigate={(page) => navigateToPage(page, setActivePage)} /> : null}
          {activePage === "all-activity" ? <AllActivityPage movements={movements} locations={locations} customers={customers} currentUserRole={currentUser.role} isLoading={isLoading} onNavigate={(page) => navigateToPage(page, setActivePage)} /> : null}
          {activePage === "customers" ? <CustomerManagementPage customers={customers} items={items} inboundDocuments={activeInboundDocuments} outboundDocuments={activeOutboundDocuments} movements={movements} currentUserRole={currentUser.role} isLoading={isLoading} onRefresh={() => loadAppData(false)} onNavigate={(page) => navigateToPage(page, setActivePage)} /> : null}
          {activePage === "audit-logs" && canViewAuditLogs ? <AuditLogPage auditLogs={auditLogs} currentUserRole={currentUser.role} isLoading={isLoading} /> : null}
          {activePage === "receipt-lots" && canViewReceiptLots ? <ReceiptLotTracePage /> : null}
          {activePage === "user-management" && canManageUsers ? <UserManagementPage users={users} currentUser={currentUser} isLoading={isLoading} onRefresh={() => loadAppData(false)} /> : null}
          {activePage === "sku-master" ? <SKUMasterPage skuMasters={skuMasters} currentUserRole={currentUser.role} isLoading={isLoading} onRefresh={() => loadAppData(false)} /> : null}
          {activePage === "stock-by-location" ? <MasterInventoryPage items={items} locations={locations} customers={customers} currentUserRole={currentUser.role} isLoading={isLoading} onRefresh={() => loadAppData(false)} onNavigate={(page) => navigateToPage(page, setActivePage)} /> : null}
          {activePage === "storage-management" ? (
            <StorageManagementPage
              locations={locations}
              items={items}
              currentUserRole={currentUser.role}
              isLoading={isLoading}
              onRefresh={() => loadAppData(false)}
              onCreateLocation={() => navigateToStorageLocationEditor(setActivePage)}
              onEditLocation={(locationId) => navigateToStorageLocationEditor(setActivePage, locationId)}
            />
          ) : null}
          {activePage === "storage-location-editor" ? (
            <StorageLocationEditorPage
              location={editingStorageLocation}
              locationId={editingStorageLocationId}
              currentUserRole={currentUser.role}
              isLoading={isLoading}
              onRefresh={() => loadAppData(false)}
              onBack={() => navigateToPage("storage-management", setActivePage)}
            />
          ) : null}
          {activePage === "settings" ? <SettingsPage /> : null}
          {activePage === "dashboard" ? (
            <HomeDashboardPage
              currentUserRole={currentUser.role}
              items={items}
              inboundDocuments={activeInboundDocuments}
              outboundDocuments={activeOutboundDocuments}
              adjustments={adjustments}
              transfers={transfers}
              cycleCounts={cycleCounts}
              isLoading={isLoading}
              errorMessage={errorMessage}
              onNavigate={(page) => navigateToPage(page, setActivePage)}
            />
          ) : null}
          {activePage === "reports" ? (
            <ReportsPage
              items={items}
              movements={movements}
              locations={locations}
              customers={customers}
              isLoading={isLoading}
              errorMessage={errorMessage}
            />
          ) : null}
          {activePage === "export-center" ? (
            <ExportCenterPage
              items={items}
              inboundDocuments={activeInboundDocuments}
              outboundDocuments={activeOutboundDocuments}
              onNavigate={(page) => navigateToPage(page, setActivePage)}
            />
          ) : null}
        </div>
        </div>
      </div>
    </div>
  );
}
function getErrorMessage(error: unknown, fallbackMessage: string) { return error instanceof Error && error.message ? error.message : fallbackMessage; }
