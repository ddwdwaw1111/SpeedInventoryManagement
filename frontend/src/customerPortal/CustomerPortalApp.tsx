import { ChevronDown, LogOut, PackageSearch, RefreshCw } from "lucide-react";
import { Suspense, lazy, type ReactNode, useEffect, useState } from "react";

import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import { getErrorMessage } from "../lib/errors";
import { useI18n } from "../lib/i18n";
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

const sidebarParents: Record<CustomerPortalSection, CustomerPortalSection> = {
  inventory: "inventory",
  "inbound-shipments": "inbound-shipments",
  "inbound-shipment-detail": "inbound-shipments",
  "outbound-orders": "outbound-orders",
  "outbound-order-detail": "outbound-orders",
  "new-outbound-order": "outbound-orders"
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
  const [activeSection, setActiveSection] = useState<CustomerPortalSection>("inventory");

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
      <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Loading</p>
          <h2 className="mt-2 text-xl font-semibold text-slate-950">Checking your session...</h2>
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
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex min-h-16 items-center justify-between gap-4 px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-950 text-xs font-black tracking-wider text-white">
              SI
            </div>
            <div className="min-w-0">
              <span className="block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t("customerPortal")}</span>
              <strong className="block truncate text-sm font-semibold text-slate-950">{portalAccess?.customerName || t("customerPortal")}</strong>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            {currentUser.role === "admin" ? (
              <Button variant="outline" type="button" onClick={onExitToAdmin}>
                {t("adminEntrance")}
              </Button>
            ) : null}
            <CustomerPortalUserMenu user={currentUser} onLogout={handleLogout} isSubmitting={isAuthSubmitting} />
          </div>
        </div>
      </header>

      <div className="grid min-h-[calc(100vh-4rem)] grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)]">
        <CustomerPortalSidebar
          activeSection={activeSection}
          portalAccess={portalAccess}
          onChangeSection={setActiveSection}
        />

        <div className="min-w-0">
          {errorMessage ? (
            <main className="mx-auto max-w-7xl p-4 lg:p-6">
              <InlineAlert>{errorMessage}</InlineAlert>
            </main>
          ) : null}

          {!errorMessage && portalAccess ? (
            <Suspense fallback={<main className="mx-auto max-w-7xl p-4 lg:p-6"><div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500">{t("loadingRecords")}</div></main>}>
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
    <div className="group relative">
      <button className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50" type="button" aria-haspopup="menu">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700" aria-hidden="true">{initials}</span>
        <span className="hidden max-w-40 truncate sm:inline">{user.fullName}</span>
        <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden="true" />
      </button>
      <div className="pointer-events-none absolute right-0 top-[calc(100%+0.5rem)] z-40 grid min-w-64 gap-3 rounded-lg border border-slate-200 bg-white p-3 opacity-0 shadow-lg transition group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100" role="menu">
        <div className="border-b border-slate-100 pb-3">
          <strong className="block text-sm text-slate-950">{user.fullName}</strong>
          <span className="mt-1 block text-xs text-slate-500">{user.email}</span>
          <span className="mt-2 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-600">{t(user.role)}</span>
        </div>
        <Button variant="ghost" type="button" onClick={() => { void onLogout(); }} disabled={isSubmitting}>
          <LogOut className="h-4 w-4" />
          {isSubmitting ? "Signing out..." : "Sign out"}
        </Button>
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
  const sidebarActiveSection = sidebarParents[activeSection];
  const navItems: Array<{ key: CustomerPortalSection; label: string; description: string; icon: ReactNode }> = [
    { key: "inventory", label: t("customerPortalInventory"), description: t("customerPortalInventoryNavDesc"), icon: <PackageSearch className="h-5 w-5" /> }
  ];

  return (
    <aside className="border-b border-slate-200 bg-white p-4 lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)] lg:border-b-0 lg:border-r">
      <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t("customerPortal")}</span>
        <strong className="mt-1 block truncate text-sm text-slate-950">{portalAccess?.customerName || t("customerPortal")}</strong>
      </div>
      <nav className="grid gap-2" aria-label={t("customerPortal")}>
        {navItems.map((item) => (
          <button
            key={item.key}
            type="button"
            className={cn(
              "flex min-h-16 w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition",
              sidebarActiveSection === item.key
                ? "bg-slate-950 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
            )}
            aria-current={sidebarActiveSection === item.key ? "page" : undefined}
            onClick={() => onChangeSection(item.key)}
          >
            <span className={cn("mt-0.5", sidebarActiveSection === item.key ? "text-white" : "text-slate-500")}>{item.icon}</span>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                {item.label}
              </span>
              <span className={cn("mt-0.5 block text-xs leading-5", sidebarActiveSection === item.key ? "text-slate-300" : "text-slate-500")}>{item.description}</span>
            </span>
          </button>
        ))}
      </nav>
      <div className="mt-6 hidden rounded-lg border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-500 lg:block">
        <RefreshCw className="mb-2 h-4 w-4 text-slate-400" />
        {t("customerPortalDesc")}
      </div>
    </aside>
  );
}
