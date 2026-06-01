import AddCircleOutlineOutlinedIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import AssignmentTurnedInOutlinedIcon from "@mui/icons-material/AssignmentTurnedInOutlined";
import AttachFileOutlinedIcon from "@mui/icons-material/AttachFileOutlined";
import DashboardOutlinedIcon from "@mui/icons-material/DashboardOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import { Suspense, lazy, useEffect, useState } from "react";

import { getErrorMessage } from "../lib/errors";
import { useI18n } from "../lib/i18n";
import { NavigationSidebar, type NavigationSidebarItem } from "../shared/NavigationSidebar";
import { ApiError, customerPortalApi } from "./api";
import { CustomerPortalAuthPage } from "./CustomerPortalAuthPage";
import type { CustomerPortalSection } from "./navigation";
import { getCustomerPortalCustomerIdFromPath, getCustomerPortalPath } from "./routes";
import { InlineAlert } from "./sharedUi";
import type { LoginPayload, SignUpPayload, User } from "./types";

const CustomerPortalPage = lazy(async () => {
  const module = await import("./CustomerPortalPage");
  return { default: module.CustomerPortalPage };
});

type CustomerPortalAppProps = {
  onExitToAdmin: () => void;
};

type PortalAccess = {
  customerId?: number;
  customerName: string;
};

export function CustomerPortalApp({ onExitToAdmin }: CustomerPortalAppProps) {
  const { t } = useI18n();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [portalAccess, setPortalAccess] = useState<PortalAccess | null>(null);
  const [isAuthResolved, setIsAuthResolved] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [authErrorMessage, setAuthErrorMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [activeSection, setActiveSection] = useState<CustomerPortalSection>("overview");

  useEffect(() => { void bootstrapPortal(); }, []);

  async function resolvePortalAccess(user: User) {
    const adminCustomerId = getCustomerPortalCustomerIdFromPath(window.location.pathname);

    if (user.role === "customer") {
      if (adminCustomerId !== null) {
        window.history.replaceState({ page: "customer-portal" }, "", getCustomerPortalPath());
      }
      setPortalAccess({ customerName: user.customerName });
      return true;
    }

    if (user.role === "admin" && adminCustomerId !== null) {
      const customer = await customerPortalApi.getProfile(adminCustomerId);
      setPortalAccess({ customerId: customer.id, customerName: customer.name });
      return true;
    }

    onExitToAdmin();
    return false;
  }

  async function bootstrapPortal() {
    setIsLoading(true);
    setErrorMessage("");
    setAuthErrorMessage("");

    try {
      const session = await customerPortalApi.getCurrentSession();
      setCurrentUser(session.user);
      const canUsePortal = await resolvePortalAccess(session.user);
      if (!canUsePortal) {
        setCurrentUser(null);
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setCurrentUser(null);
        setPortalAccess(null);
      } else {
        setErrorMessage(getErrorMessage(error, t("customerPortalLoadFailed")));
      }
    } finally {
      setIsAuthResolved(true);
      setIsLoading(false);
    }
  }

  async function handleLogin(payload: LoginPayload) {
    setIsAuthSubmitting(true);
    setAuthErrorMessage("");
    setErrorMessage("");
    try {
      const session = await customerPortalApi.login(payload);
      setCurrentUser(session.user);
      const canUsePortal = await resolvePortalAccess(session.user);
      if (!canUsePortal) {
        setCurrentUser(null);
      }
    } catch (error) {
      const message = getErrorMessage(error, "Could not sign in.");
      setAuthErrorMessage(message);
      setErrorMessage(message);
    } finally {
      setIsAuthSubmitting(false);
      setIsAuthResolved(true);
    }
  }

  async function handleSignUp(payload: SignUpPayload) {
    setIsAuthSubmitting(true);
    setAuthErrorMessage("");
    setErrorMessage("");
    try {
      const session = await customerPortalApi.signUp(payload);
      setCurrentUser(session.user);
      const canUsePortal = await resolvePortalAccess(session.user);
      if (!canUsePortal) {
        setCurrentUser(null);
      }
    } catch (error) {
      const message = getErrorMessage(error, "Could not create your account.");
      setAuthErrorMessage(message);
      setErrorMessage(message);
    } finally {
      setIsAuthSubmitting(false);
      setIsAuthResolved(true);
    }
  }

  async function handleLogout() {
    setIsAuthSubmitting(true);
    setAuthErrorMessage("");
    try {
      await customerPortalApi.logout();
      setCurrentUser(null);
      setPortalAccess(null);
    } catch (error) {
      setAuthErrorMessage(getErrorMessage(error, "Could not sign out."));
    } finally {
      setIsAuthSubmitting(false);
    }
  }

  if (!isAuthResolved || (isLoading && !currentUser)) {
    return (
      <main className="customer-portal-auth-shell customer-portal-auth-shell--loading">
        <section className="auth-card">
          <p className="eyebrow">Loading</p>
          <h2>Checking your session...</h2>
        </section>
      </main>
    );
  }

  if (!currentUser) {
    return (
      <CustomerPortalAuthPage
        onLogin={handleLogin}
        onSignUp={handleSignUp}
        isSubmitting={isAuthSubmitting}
        errorMessage={authErrorMessage || errorMessage}
      />
    );
  }

  return (
    <div className="customer-portal-app">
      <header className="customer-portal-topbar">
        <div className="customer-portal-brand">
          <div className="app-toolbar__brand-mark" aria-hidden="true">SI</div>
          <div className="app-toolbar__brand-copy">
            <span>{t("inventorySystem")}</span>
            <strong>{t("customerPortal")}</strong>
          </div>
        </div>

        <div className="customer-portal-topbar__controls">
          {currentUser.role === "admin" ? (
            <button className="button button--ghost" type="button" onClick={onExitToAdmin}>
              {t("adminEntrance")}
            </button>
          ) : null}
          <CustomerPortalUserMenu user={currentUser} onLogout={handleLogout} isSubmitting={isAuthSubmitting} />
        </div>
      </header>

      <div className="customer-portal-layout">
        <CustomerPortalSidebar
          activeSection={activeSection}
          portalAccess={portalAccess}
          onChangeSection={setActiveSection}
        />

        <div className="customer-portal-content">
          {errorMessage ? (
            <main className="customer-portal-main">
              <InlineAlert>{errorMessage}</InlineAlert>
            </main>
          ) : null}

          {!errorMessage && portalAccess ? (
            <Suspense fallback={<main className="customer-portal-main"><div className="empty-state">{t("loadingRecords")}</div></main>}>
              <CustomerPortalPage
                activeSection={activeSection}
                currentUser={currentUser}
                portalCustomerId={portalAccess.customerId}
                portalCustomerName={portalAccess.customerName}
                onSectionChange={setActiveSection}
              />
            </Suspense>
          ) : null}
        </div>
      </div>
    </div>
  );
}


function CustomerPortalUserMenu({
  user,
  onLogout,
  isSubmitting
}: {
  user: User;
  onLogout: () => Promise<void>;
  isSubmitting: boolean;
}) {
  const { t } = useI18n();
  const initials = user.fullName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "U";

  return (
    <div className="app-user customer-portal-user">
      <button className="app-user__trigger" type="button" aria-haspopup="menu">
        <div className="app-user__avatar" aria-hidden="true">{initials}</div>
        <span className="app-user__trigger-name">{user.fullName}</span>
        <span className="app-user__trigger-caret" aria-hidden="true" />
      </button>
      <div className="app-user__menu" role="menu">
        <div className="app-user__menu-header">
          <strong>{user.fullName}</strong>
          <span className="app-user__menu-role">{t(user.role)}</span>
        </div>
        <div className="app-user__menu-details">
          <span>{user.email}</span>
        </div>
        <button className="app-user__menu-action" type="button" onClick={() => { void onLogout(); }} disabled={isSubmitting}>
          {isSubmitting ? "Signing out..." : "Sign out"}
        </button>
      </div>
    </div>
  );
}

function CustomerPortalSidebar({
  activeSection,
  portalAccess,
  onChangeSection
}: {
  activeSection: CustomerPortalSection;
  portalAccess: PortalAccess | null;
  onChangeSection: (section: CustomerPortalSection) => void;
}) {
  const { t } = useI18n();
  const navItems: NavigationSidebarItem<CustomerPortalSection>[] = [
    { key: "overview", label: t("customerPortalOverview"), icon: <DashboardOutlinedIcon fontSize="small" /> },
    { key: "inventory", label: t("customerPortalInventory"), icon: <Inventory2OutlinedIcon fontSize="small" /> },
    { key: "new-packing-list", label: t("newPackingList"), icon: <AddCircleOutlineOutlinedIcon fontSize="small" /> },
    { key: "packing-lists", label: t("customerPortalPackingLists"), icon: <AssignmentTurnedInOutlinedIcon fontSize="small" /> },
    { key: "attachments", label: t("packingListDocuments"), icon: <AttachFileOutlinedIcon fontSize="small" /> }
  ];

  return (
    <NavigationSidebar
      activeKey={activeSection}
      ariaLabel={t("customerPortal")}
      classNames={{
        root: "customer-portal-sidebar",
        header: "customer-portal-sidebar__account",
        nav: "customer-portal-sidebar__nav",
        item: "customer-portal-sidebar__item",
        itemActive: "customer-portal-sidebar__item--active",
        itemIcon: "customer-portal-sidebar__item-icon",
        itemLabel: "customer-portal-sidebar__item-label"
      }}
      header={(
        <>
          <span className="customer-portal-sidebar__eyebrow">{t("customerPortal")}</span>
          <strong className="customer-portal-sidebar__account-name">{portalAccess?.customerName || t("customerPortal")}</strong>
        </>
      )}
      items={navItems}
      navLabel={t("customerPortal")}
      onSelect={onChangeSection}
      useAriaCurrent
    />
  );
}
