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
  RequestQuoteOutlined,
  SettingsOutlined,
  TuneOutlined,
  WarehouseOutlined
} from "@mui/icons-material";
import { Suspense, lazy, type ReactNode, useEffect, useMemo, useState } from "react";

import { AppHeaderUser, AuthPage } from "./components/AuthPage";
import { ApiError, api } from "./lib/api";
import { setPendingActivityManagementLaunchContext } from "./lib/activityManagementLaunchContext";
import { setPendingInboundReceiptEditorLaunchContext, type InboundReceiptEditorLaunchContext } from "./lib/inboundReceiptEditorLaunchContext";
import { setPendingOutboundShipmentEditorLaunchContext, type OutboundShipmentEditorLaunchContext } from "./lib/outboundShipmentEditorLaunchContext";
import { useI18n } from "./lib/i18n";
import { setPendingPalletTraceLaunchContext } from "./lib/palletTraceLaunchContext";
import {
  getContainerDetailContainerNoFromPath,
  getDailyOperationsDateFromPath,
  getInboundDetailIdFromPath,
  getPageFromPath,
  getReceiptEditorIdFromPath,
  getShipmentEditorIdFromPath,
  getStorageLocationEditorIdFromPath,
  navigateToContainerDetail,
  navigateToDailyOperations,
  navigateToInboundDetail,
  navigateToPage,
  navigateToReceiptEditor,
  navigateToShipmentEditor,
  navigateToStorageLocationEditor,
  type PageKey
} from "./lib/routes";
import type { AuditLog, Customer, CycleCount, InboundDocument, InventoryAdjustment, InventoryTransfer, Item, Location, LoginPayload, Movement, OutboundDocument, SKUMaster, SignUpPayload, User } from "./lib/types";

const ActivityManagementPage = lazy(async () => {
  const module = await import("./components/ActivityManagementPage");
  return { default: module.ActivityManagementPage };
});
const AdjustmentManagementPage = lazy(async () => {
  const module = await import("./components/AdjustmentManagementPage");
  return { default: module.AdjustmentManagementPage };
});
const AllActivityPage = lazy(async () => {
  const module = await import("./components/AllActivityPage");
  return { default: module.AllActivityPage };
});
const AuditLogPage = lazy(async () => {
  const module = await import("./components/AuditLogPage");
  return { default: module.AuditLogPage };
});
const BillingPage = lazy(async () => {
  const module = await import("./components/BillingPage");
  return { default: module.BillingPage };
});
const ContainerContentsPage = lazy(async () => {
  const module = await import("./components/ContainerContentsPage");
  return { default: module.ContainerContentsPage };
});
const ContainerDetailPage = lazy(async () => {
  const module = await import("./components/ContainerDetailPage");
  return { default: module.ContainerDetailPage };
});
const DailyOperationsPage = lazy(async () => {
  const module = await import("./components/DailyOperationsPage");
  return { default: module.DailyOperationsPage };
});
const CustomerManagementPage = lazy(async () => {
  const module = await import("./components/CustomerManagementPage");
  return { default: module.CustomerManagementPage };
});
const CycleCountManagementPage = lazy(async () => {
  const module = await import("./components/CycleCountManagementPage");
  return { default: module.CycleCountManagementPage };
});
const ExportCenterPage = lazy(async () => {
  const module = await import("./components/ExportCenterPage");
  return { default: module.ExportCenterPage };
});
const HomeDashboardPage = lazy(async () => {
  const module = await import("./components/HomeDashboardPage");
  return { default: module.HomeDashboardPage };
});
const InventorySummaryPage = lazy(async () => {
  const module = await import("./components/InventorySummaryPage");
  return { default: module.InventorySummaryPage };
});
const InboundDetailPage = lazy(async () => {
  const module = await import("./components/InboundDetailPage");
  return { default: module.InboundDetailPage };
});
const InboundReceiptEditorPage = lazy(async () => {
  const module = await import("./components/InboundReceiptEditorPage");
  return { default: module.InboundReceiptEditorPage };
});
const OutboundShipmentEditorPage = lazy(async () => {
  const module = await import("./components/OutboundShipmentEditorPage");
  return { default: module.OutboundShipmentEditorPage };
});
const PalletTracePage = lazy(async () => {
  const module = await import("./components/PalletTracePage");
  return { default: module.PalletTracePage };
});
const ReportsPage = lazy(async () => {
  const module = await import("./components/ReportsPage");
  return { default: module.ReportsPage };
});
const SettingsPage = lazy(async () => {
  const module = await import("./components/SettingsPage");
  return { default: module.SettingsPage };
});
const SKUMasterPage = lazy(async () => {
  const module = await import("./components/SKUMasterPage");
  return { default: module.SKUMasterPage };
});
const StorageLocationEditorPage = lazy(async () => {
  const module = await import("./components/StorageLocationEditorPage");
  return { default: module.StorageLocationEditorPage };
});
const StorageManagementPage = lazy(async () => {
  const module = await import("./components/StorageManagementPage");
  return { default: module.StorageManagementPage };
});
const TransferManagementPage = lazy(async () => {
  const module = await import("./components/TransferManagementPage");
  return { default: module.TransferManagementPage };
});
const UserManagementPage = lazy(async () => {
  const module = await import("./components/UserManagementPage");
  return { default: module.UserManagementPage };
});
const WarehouseMapPage = lazy(async () => {
  const module = await import("./components/WarehouseMapPage");
  return { default: module.WarehouseMapPage };
});

export default function App() {
  const { t } = useI18n();
  const navLabels = {
    inventory: t("navInventory"),
    finance: t("navFinance"),
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
  const [currentPathname, setCurrentPathname] = useState(() => window.location.pathname);
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
  const [embeddedComposer, setEmbeddedComposer] = useState<{ mode: "IN" | "OUT"; date: string } | null>(null);
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
      setCurrentPathname(window.location.pathname);
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

  function handleNavigateToPage(page: PageKey) {
    navigateToPage(page, setActivePage);
    setCurrentPathname(window.location.pathname);
  }

  function handleNavigateToDailyOperations(date?: string) {
    navigateToDailyOperations(setActivePage, date);
    setCurrentPathname(window.location.pathname);
  }

  function handleNavigateToStorageLocationEditor(locationId?: number) {
    navigateToStorageLocationEditor(setActivePage, locationId);
    setCurrentPathname(window.location.pathname);
  }

  function handleNavigateToInboundDetail(documentId: number) {
    navigateToInboundDetail(setActivePage, documentId);
    setCurrentPathname(window.location.pathname);
  }

  function handleNavigateToReceiptEditor(documentId?: number | null, context?: InboundReceiptEditorLaunchContext) {
    if (context) {
      setPendingInboundReceiptEditorLaunchContext(context);
    }
    navigateToReceiptEditor(setActivePage, documentId);
    setCurrentPathname(window.location.pathname);
  }

  function handleNavigateToShipmentEditor(documentId?: number | null, context?: OutboundShipmentEditorLaunchContext) {
    if (context) {
      setPendingOutboundShipmentEditorLaunchContext(context);
    }
    navigateToShipmentEditor(setActivePage, documentId);
    setCurrentPathname(window.location.pathname);
  }

  function handleNavigateToOutboundDocument(documentId: number) {
    setPendingActivityManagementLaunchContext("OUT", { documentId });
    navigateToPage("outbound-management", setActivePage);
    setCurrentPathname(window.location.pathname);
  }

  function handleNavigateToPalletTrace(sourceInboundDocumentId?: number) {
    if (sourceInboundDocumentId && sourceInboundDocumentId > 0) {
      setPendingPalletTraceLaunchContext({ sourceInboundDocumentId });
    } else {
      setPendingPalletTraceLaunchContext({});
    }
    navigateToPage("pallet-trace", setActivePage);
    setCurrentPathname(window.location.pathname);
  }

  function handleNavigateToContainerDetail(containerNo: string) {
    navigateToContainerDetail(setActivePage, containerNo);
    setCurrentPathname(window.location.pathname);
  }

  function handleOpenEmbeddedComposer(mode: "IN" | "OUT", date: string) {
    setEmbeddedComposer({ mode, date });
  }

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
  const canViewPallets = Boolean(currentUser);
  const canManageUsers = currentUser?.role === "admin";

  useEffect(() => {
    if (
      (activePage === "audit-logs" && !canViewAuditLogs) ||
      (activePage === "pallet-trace" && !canViewPallets) ||
      (activePage === "user-management" && !canManageUsers)
    ) {
      handleNavigateToPage("dashboard");
    }
  }, [activePage, canManageUsers, canViewAuditLogs, canViewPallets]);

  const pageItems: Array<{ key: PageKey; label: string; description: string; icon: ReactNode }> = [
    { key: "dashboard", label: t("navDashboard"), description: t("dashboardDesc"), icon: <HomeOutlined fontSize="small" /> },
    { key: "daily-operations", label: t("dailyOperations"), description: t("dailyOperationsDesc"), icon: <HomeOutlined fontSize="small" /> },
    { key: "billing", label: t("billingPage"), description: t("billingPageDesc"), icon: <RequestQuoteOutlined fontSize="small" /> },
    { key: "reports", label: t("report"), description: t("reportDesc"), icon: <AssessmentOutlined fontSize="small" /> },
    { key: "export-center", label: t("exportCenter"), description: t("exportCenterDesc"), icon: <FileDownloadOutlined fontSize="small" /> },
    { key: "inbound-management", label: t("navReceiving"), description: t("inboundDesc"), icon: <MoveToInboxOutlined fontSize="small" /> },
    { key: "inbound-detail", label: t("inboundDetailPage"), description: t("inboundDetailPageDesc"), icon: <MoveToInboxOutlined fontSize="small" /> },
    { key: "receipt-editor", label: t("receiptEditorPage"), description: t("receiptEditorPageDesc"), icon: <MoveToInboxOutlined fontSize="small" /> },
    { key: "outbound-management", label: t("navShipping"), description: t("outboundDesc"), icon: <OutboxOutlined fontSize="small" /> },
    { key: "shipment-editor", label: t("shipmentEditorPage"), description: t("shipmentEditorPageDesc"), icon: <OutboxOutlined fontSize="small" /> },
    { key: "inventory-summary", label: t("inventorySummary"), description: t("inventorySummaryDesc"), icon: <WarehouseOutlined fontSize="small" /> },
    { key: "warehouse-map", label: t("warehouseMap"), description: t("warehouseMapDesc"), icon: <WarehouseOutlined fontSize="small" /> },
    { key: "container-contents", label: t("containerContents"), description: t("containerContentsDesc"), icon: <WarehouseOutlined fontSize="small" /> },
    { key: "container-detail", label: t("containerDetailPage"), description: t("containerDetailPageDesc"), icon: <WarehouseOutlined fontSize="small" /> },
    { key: "adjustments", label: t("adjustments"), description: t("adjustmentsDesc"), icon: <TuneOutlined fontSize="small" /> },
    { key: "transfers", label: t("transfers"), description: t("transfersDesc"), icon: <CompareArrowsOutlined fontSize="small" /> },
    { key: "cycle-counts", label: t("cycleCounts"), description: t("cycleCountsDesc"), icon: <FactCheckOutlined fontSize="small" /> },
    { key: "all-activity", label: t("allActivity"), description: t("allActivityDesc"), icon: <HistoryOutlined fontSize="small" /> },
    { key: "customers", label: t("customers"), description: t("customersDesc"), icon: <GroupsOutlined fontSize="small" /> },
    ...(canViewAuditLogs ? [{ key: "audit-logs" as PageKey, label: t("auditLogs"), description: t("auditLogsDesc"), icon: <BadgeOutlined fontSize="small" /> }] : []),
    ...(canViewPallets ? [{ key: "pallet-trace" as PageKey, label: t("palletTrace"), description: t("palletTraceDesc"), icon: <WarehouseOutlined fontSize="small" /> }] : []),
    ...(canManageUsers ? [{ key: "user-management" as PageKey, label: t("userManagement"), description: t("userManagementDesc"), icon: <ManageAccountsOutlined fontSize="small" /> }] : []),
    { key: "sku-master", label: t("skuMaster"), description: t("skuMasterDesc"), icon: <CategoryOutlined fontSize="small" /> },
    { key: "storage-management", label: t("storageManagement"), description: t("storageManagementDesc"), icon: <WarehouseOutlined fontSize="small" /> },
    { key: "storage-location-editor", label: t("editStorageLocation"), description: t("warehouseLayoutDesc"), icon: <WarehouseOutlined fontSize="small" /> },
    { key: "settings", label: t("settings"), description: t("settingsDesc"), icon: <SettingsOutlined fontSize="small" /> }
  ];
  const pageItemMap = new Map(pageItems.map((item) => [item.key, item] as const));
  const primaryNavItems = (["dashboard", "inbound-management", "outbound-management"] as PageKey[])
    .map((pageKey) => pageItemMap.get(pageKey))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const navSections = [
    { key: "inventory", label: navLabels.inventory, items: ["inventory-summary", "warehouse-map", "container-contents", "pallet-trace", "all-activity"] as PageKey[] },
    { key: "finance", label: navLabels.finance, items: ["billing"] as PageKey[] },
    { key: "master-data", label: navLabels.masterData, items: ["customers", "sku-master", "storage-management"] as PageKey[] },
    { key: "reports", label: navLabels.reports, items: ["reports", "export-center"] as PageKey[] },
    { key: "administration", label: navLabels.administration, items: ["audit-logs", "user-management", "settings"] as PageKey[] }
  ].map((section) => ({
    ...section,
    items: section.items
      .map((pageKey) => pageItemMap.get(pageKey))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
  })).filter((section) => section.items.length > 0);
  const activePageItem = pageItemMap.get(activePage) ?? pageItems[0];
  const pageLoadingFallback = (
    <section className="workbook-panel">
      <div className="empty-state">{t("loadingRecords")}</div>
    </section>
  );
  const parentPageByPage: Partial<Record<PageKey, PageKey>> = {
    "daily-operations": "dashboard",
    "inbound-detail": "inbound-management",
    "receipt-editor": "inbound-management",
    "shipment-editor": "outbound-management",
    "container-detail": "container-contents",
    adjustments: "inventory-summary",
    transfers: "inventory-summary",
    "cycle-counts": "inventory-summary",
    "storage-location-editor": "storage-management"
  };
  const sectionKeyByPage: Partial<Record<PageKey, string>> = {
    "inventory-summary": "inventory",
    "warehouse-map": "inventory",
    "container-contents": "inventory",
    "container-detail": "inventory",
    "adjustments": "inventory",
    "transfers": "inventory",
    "cycle-counts": "inventory",
    "all-activity": "inventory",
    "pallet-trace": "inventory",
    billing: "finance",
    customers: "master-data",
    "sku-master": "master-data",
    "storage-management": "master-data",
    "storage-location-editor": "master-data",
    reports: "reports",
    "export-center": "reports",
    "audit-logs": "administration",
    "user-management": "administration",
    settings: "administration"
  };
  const parentPage = parentPageByPage[activePage] ? pageItemMap.get(parentPageByPage[activePage] as PageKey) : null;
  const activeNavSection = navSections.find((section) => section.key === sectionKeyByPage[activePage]);
  const pageContextLeadLabel = activeNavSection?.label ?? parentPage?.label ?? null;
  const showPageContext = activePage !== "dashboard";
  const editingStorageLocationId = getStorageLocationEditorIdFromPath(currentPathname);
  const selectedInboundDetailId = getInboundDetailIdFromPath(currentPathname);
  const selectedReceiptEditorId = getReceiptEditorIdFromPath(currentPathname);
  const selectedShipmentEditorId = getShipmentEditorIdFromPath(currentPathname);
  const selectedContainerDetailNo = getContainerDetailContainerNoFromPath(currentPathname);
  const selectedDailyOperationsDate = getDailyOperationsDateFromPath(currentPathname);
  const editingStorageLocation = editingStorageLocationId
    ? locations.find((location) => location.id === editingStorageLocationId) ?? null
    : null;
  const selectedInboundDetailDocument = selectedInboundDetailId
    ? inboundDocuments.find((document) => document.id === selectedInboundDetailId) ?? null
    : null;
  const selectedReceiptEditorDocument = selectedReceiptEditorId
    ? inboundDocuments.find((document) => document.id === selectedReceiptEditorId) ?? null
    : null;
  const selectedShipmentEditorDocument = selectedShipmentEditorId
    ? outboundDocuments.find((document) => document.id === selectedShipmentEditorId) ?? null
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

  function renderWithSuspense(node: ReactNode) {
    return <Suspense fallback={pageLoadingFallback}>{node}</Suspense>;
  }

  return (
    <div className="app-shell">
      <header className="app-toolbar">
        <button className="app-toolbar__brand" type="button" onClick={() => handleNavigateToPage("dashboard")}>
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
            onClick={() => handleNavigateToPage("settings")}
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
              onClick={() => handleNavigateToPage(item.key)}
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
                    onClick={() => handleNavigateToPage(item.key)}
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
                    onClick={() => handleNavigateToPage(parentPage.key)}
                  >
                    <ArrowBackOutlined fontSize="small" />
                    <span>{t("back")}</span>
                  </button>
                ) : null}
                <div className="app-page-context__breadcrumb">
                  {pageContextLeadLabel ? <span>{pageContextLeadLabel}</span> : null}
                  {pageContextLeadLabel ? <span aria-hidden="true">/</span> : null}
                  <span>{activePageItem.label}</span>
                </div>
              </div>
            </div>
          ) : null}
          <div key={activePage} className="workspace-shell__page">
            {activePage === "inbound-management" ? renderWithSuspense(<ActivityManagementPage mode="IN" items={items} skuMasters={skuMasters} locations={locations} customers={customers} movements={movements} inboundDocuments={inboundDocuments} outboundDocuments={outboundDocuments} currentUserRole={currentUser.role} isLoading={isLoading} onRefresh={() => loadAppData(false)} onOpenInboundDetail={handleNavigateToInboundDetail} onOpenPalletTrace={handleNavigateToPalletTrace} onOpenInboundReceiptEditor={handleNavigateToReceiptEditor} />) : null}
            {activePage === "inbound-detail" ? (
              renderWithSuspense(<InboundDetailPage
                document={selectedInboundDetailDocument}
                currentUserRole={currentUser.role}
                isLoading={isLoading}
                onNavigate={handleNavigateToPage}
                onOpenReceiptEditor={handleNavigateToReceiptEditor}
              />)
            ) : null}
            {activePage === "receipt-editor" ? (
              renderWithSuspense(<InboundReceiptEditorPage
                routeKey={currentPathname}
                documentId={selectedReceiptEditorId}
                document={selectedReceiptEditorDocument}
                items={items}
                skuMasters={skuMasters}
                locations={locations}
                customers={customers}
                inboundDocuments={inboundDocuments}
                currentUserRole={currentUser.role}
                isLoading={isLoading}
                onRefresh={() => loadAppData(false)}
                onBackToList={() => handleNavigateToPage("inbound-management")}
                onOpenInboundDetail={handleNavigateToInboundDetail}
                onOpenReceiptEditor={handleNavigateToReceiptEditor}
              />)
            ) : null}
            {activePage === "outbound-management" ? renderWithSuspense(<ActivityManagementPage mode="OUT" items={items} skuMasters={skuMasters} locations={locations} customers={customers} movements={movements} inboundDocuments={inboundDocuments} outboundDocuments={outboundDocuments} currentUserRole={currentUser.role} isLoading={isLoading} onRefresh={() => loadAppData(false)} onOpenPalletTrace={handleNavigateToPalletTrace} onOpenOutboundShipmentEditor={handleNavigateToShipmentEditor} />) : null}
            {activePage === "shipment-editor" ? (
              renderWithSuspense(<OutboundShipmentEditorPage
                routeKey={currentPathname}
                documentId={selectedShipmentEditorId}
                document={selectedShipmentEditorDocument}
                items={items}
                skuMasters={skuMasters}
                movements={movements}
                currentUserRole={currentUser.role}
                isLoading={isLoading}
                onRefresh={() => loadAppData(false)}
                onBackToList={() => handleNavigateToPage("outbound-management")}
                onOpenOutboundDocument={handleNavigateToOutboundDocument}
                onOpenShipmentEditor={handleNavigateToShipmentEditor}
              />)
            ) : null}
            {activePage === "adjustments" ? renderWithSuspense(<AdjustmentManagementPage adjustments={adjustments} items={items} currentUserRole={currentUser.role} isLoading={isLoading} onRefresh={() => loadAppData(false)} onNavigate={handleNavigateToPage} />) : null}
            {activePage === "transfers" ? renderWithSuspense(<TransferManagementPage transfers={transfers} items={items} locations={locations} currentUserRole={currentUser.role} isLoading={isLoading} onRefresh={() => loadAppData(false)} onNavigate={handleNavigateToPage} />) : null}
            {activePage === "cycle-counts" ? renderWithSuspense(<CycleCountManagementPage cycleCounts={cycleCounts} items={items} currentUserRole={currentUser.role} isLoading={isLoading} onRefresh={() => loadAppData(false)} onNavigate={handleNavigateToPage} />) : null}
            {activePage === "inventory-summary" ? renderWithSuspense(<InventorySummaryPage items={items} movements={movements} customers={customers} locations={locations} currentUserRole={currentUser.role} isLoading={isLoading} onNavigate={handleNavigateToPage} />) : null}
            {activePage === "warehouse-map" ? (
              <Suspense fallback={pageLoadingFallback}>
                <WarehouseMapPage items={items} isLoading={isLoading} onNavigate={handleNavigateToPage} onOpenContainerDetail={handleNavigateToContainerDetail} />
              </Suspense>
            ) : null}
            {activePage === "container-contents" ? renderWithSuspense(<ContainerContentsPage items={items} movements={movements} customers={customers} locations={locations} currentUserRole={currentUser.role} isLoading={isLoading} onOpenContainerDetail={handleNavigateToContainerDetail} />) : null}
            {activePage === "container-detail" ? renderWithSuspense(<ContainerDetailPage routeKey={currentPathname} containerNo={selectedContainerDetailNo} items={items} movements={movements} locations={locations} currentUserRole={currentUser.role} isLoading={isLoading} onRefresh={() => loadAppData(false)} onNavigate={handleNavigateToPage} onBackToList={() => handleNavigateToPage("container-contents")} />) : null}
            {activePage === "all-activity" ? renderWithSuspense(<AllActivityPage movements={movements} locations={locations} customers={customers} currentUserRole={currentUser.role} isLoading={isLoading} onNavigate={handleNavigateToPage} />) : null}
            {activePage === "customers" ? renderWithSuspense(<CustomerManagementPage customers={customers} items={items} inboundDocuments={activeInboundDocuments} outboundDocuments={activeOutboundDocuments} movements={movements} currentUserRole={currentUser.role} isLoading={isLoading} onRefresh={() => loadAppData(false)} onNavigate={handleNavigateToPage} />) : null}
            {activePage === "audit-logs" && canViewAuditLogs ? renderWithSuspense(<AuditLogPage auditLogs={auditLogs} currentUserRole={currentUser.role} isLoading={isLoading} />) : null}
            {activePage === "pallet-trace" && canViewPallets ? renderWithSuspense(<PalletTracePage />) : null}
            {activePage === "user-management" && canManageUsers ? renderWithSuspense(<UserManagementPage users={users} currentUser={currentUser} isLoading={isLoading} onRefresh={() => loadAppData(false)} />) : null}
            {activePage === "sku-master" ? renderWithSuspense(<SKUMasterPage skuMasters={skuMasters} currentUserRole={currentUser.role} isLoading={isLoading} onRefresh={() => loadAppData(false)} />) : null}
            {activePage === "storage-management" ? (
              renderWithSuspense(<StorageManagementPage
                locations={locations}
                items={items}
                currentUserRole={currentUser.role}
                isLoading={isLoading}
                onRefresh={() => loadAppData(false)}
                onCreateLocation={() => handleNavigateToStorageLocationEditor()}
                onEditLocation={(locationId) => handleNavigateToStorageLocationEditor(locationId)}
              />)
            ) : null}
            {activePage === "storage-location-editor" ? (
              renderWithSuspense(<StorageLocationEditorPage
                location={editingStorageLocation}
                locationId={editingStorageLocationId}
                currentUserRole={currentUser.role}
                isLoading={isLoading}
                onRefresh={() => loadAppData(false)}
                onBack={() => handleNavigateToPage("storage-management")}
              />)
            ) : null}
            {activePage === "settings" ? renderWithSuspense(<SettingsPage />) : null}
            {activePage === "daily-operations" ? (
              renderWithSuspense(<DailyOperationsPage
                selectedDate={selectedDailyOperationsDate ?? getCurrentLocalIsoDate()}
                inboundDocuments={activeInboundDocuments}
                outboundDocuments={activeOutboundDocuments}
                currentUserRole={currentUser.role}
                isLoading={isLoading}
                onRefresh={() => loadAppData(false)}
                onNavigate={handleNavigateToPage}
                onOpenDate={handleNavigateToDailyOperations}
                onOpenInboundDetail={handleNavigateToInboundDetail}
                onOpenCreateInboundReceipt={(date) => handleNavigateToReceiptEditor(null, { scheduledDate: date })}
                onOpenCreateOutboundShipment={(date) => handleNavigateToShipmentEditor(null, { scheduledDate: date })}
                onOpenInboundReceiptEditor={handleNavigateToReceiptEditor}
                onOpenOutboundShipmentEditor={handleNavigateToShipmentEditor}
              />)
            ) : null}
            {activePage === "billing" ? (
              renderWithSuspense(<BillingPage
                customers={customers}
                inboundDocuments={inboundDocuments}
                outboundDocuments={outboundDocuments}
              />)
            ) : null}
            {activePage === "dashboard" ? (
              renderWithSuspense(<HomeDashboardPage
                currentUserRole={currentUser.role}
                items={items}
                inboundDocuments={activeInboundDocuments}
                outboundDocuments={activeOutboundDocuments}
                adjustments={adjustments}
                transfers={transfers}
                cycleCounts={cycleCounts}
                isLoading={isLoading}
                errorMessage={errorMessage}
                onNavigate={handleNavigateToPage}
                onOpenDailyOperations={handleNavigateToDailyOperations}
              />)
            ) : null}
            {activePage === "reports" ? (
              renderWithSuspense(<ReportsPage
                items={items}
                movements={movements}
                locations={locations}
                customers={customers}
                isLoading={isLoading}
                errorMessage={errorMessage}
              />)
            ) : null}
            {activePage === "export-center" ? (
              renderWithSuspense(<ExportCenterPage
                items={items}
                inboundDocuments={activeInboundDocuments}
                outboundDocuments={activeOutboundDocuments}
                onNavigate={handleNavigateToPage}
              />)
            ) : null}
          </div>
          {embeddedComposer ? renderWithSuspense(
            <ActivityManagementPage
              mode={embeddedComposer.mode}
              items={items}
              skuMasters={skuMasters}
              locations={locations}
              customers={customers}
              movements={movements}
              inboundDocuments={inboundDocuments}
              outboundDocuments={outboundDocuments}
              currentUserRole={currentUser.role}
              isLoading={isLoading}
              onRefresh={() => loadAppData(false)}
              onOpenInboundDetail={handleNavigateToInboundDetail}
              onOpenPalletTrace={handleNavigateToPalletTrace}
              embeddedComposer={{
                initialDate: embeddedComposer.date,
                onClose: () => setEmbeddedComposer(null)
              }}
            />
          ) : null}
        </div>
        </div>
      </div>
    </div>
  );
}

function getCurrentLocalIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getErrorMessage(error: unknown, fallbackMessage: string) { return error instanceof Error && error.message ? error.message : fallbackMessage; }
