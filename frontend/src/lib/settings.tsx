import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { BillingInvoiceHeader } from "./types";

export type TimeZoneSetting = "local" | string;

type TimeZoneOption = {
  value: TimeZoneSetting;
  label: string;
};

export type BillingTermOption = {
  label: string;
  terms: string;
  paymentDueDays: number;
};

type SettingsContextValue = {
  timeZone: TimeZoneSetting;
  resolvedTimeZone: string;
  setTimeZone: (timeZone: TimeZoneSetting) => void;
  timeZoneOptions: TimeZoneOption[];
  billingInvoiceHeaderDefaults: BillingInvoiceHeader;
  setBillingInvoiceHeaderDefaults: (header: BillingInvoiceHeader) => Promise<void>;
  refreshBillingInvoiceHeaderDefaults: () => Promise<void>;
  isBillingInvoiceHeaderDefaultsLoading: boolean;
  billingTermOptions: BillingTermOption[];
};

const DEFAULT_OPTIONS: TimeZoneOption[] = [
  { value: "local", label: "Browser / Local" },
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "America/New_York" },
  { value: "America/Chicago", label: "America/Chicago" },
  { value: "America/Denver", label: "America/Denver" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles" },
  { value: "Europe/London", label: "Europe/London" },
  { value: "Asia/Shanghai", label: "Asia/Shanghai" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo" }
];

export const DEFAULT_BILLING_INVOICE_HEADER: BillingInvoiceHeader = {
  sellerName: "Speed Inventory Management",
  subtitle: "Business services invoice",
  remitTo: "Speed Inventory Management",
  terms: "Net 30",
  paymentDueDays: 30,
  paymentInstructions: "Payment due within 30 days of invoice date. Please reference the invoice number with payment. Amounts are in USD."
};

export const BILLING_TERM_OPTIONS: BillingTermOption[] = [
  { label: "Blank", terms: "", paymentDueDays: 0 },
  { label: "Due on receipt", terms: "Due on receipt", paymentDueDays: 0 },
  { label: "Net 7", terms: "Net 7", paymentDueDays: 7 },
  { label: "Net 10", terms: "Net 10", paymentDueDays: 10 },
  { label: "Net 15", terms: "Net 15", paymentDueDays: 15 },
  { label: "Net 30", terms: "Net 30", paymentDueDays: 30 },
  { label: "Net 45", terms: "Net 45", paymentDueDays: 45 },
  { label: "Net 60", terms: "Net 60", paymentDueDays: 60 }
];

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [timeZone, setTimeZone] = useState<TimeZoneSetting>(() => window.localStorage.getItem("sim-timezone") || "local");
  const [billingInvoiceHeaderDefaults, setBillingInvoiceHeaderDefaultsState] = useState<BillingInvoiceHeader>(DEFAULT_BILLING_INVOICE_HEADER);
  const [isBillingInvoiceHeaderDefaultsLoading, setIsBillingInvoiceHeaderDefaultsLoading] = useState(false);

  useEffect(() => {
    window.localStorage.setItem("sim-timezone", timeZone);
  }, [timeZone]);

  const refreshBillingInvoiceHeaderDefaults = useCallback(async () => {
    setIsBillingInvoiceHeaderDefaultsLoading(true);
    try {
      const settings = await api.getBillingInvoiceSettings();
      setBillingInvoiceHeaderDefaultsState(normalizeBillingInvoiceHeaderDefaults(settings.header));
    } finally {
      setIsBillingInvoiceHeaderDefaultsLoading(false);
    }
  }, []);

  const setBillingInvoiceHeaderDefaults = useCallback(async (header: BillingInvoiceHeader) => {
    const settings = await api.updateBillingInvoiceSettings({
      header: normalizeBillingInvoiceHeaderDefaults(header)
    });
    setBillingInvoiceHeaderDefaultsState(normalizeBillingInvoiceHeaderDefaults(settings.header));
  }, []);

  const value = useMemo<SettingsContextValue>(() => {
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    return {
      timeZone,
      resolvedTimeZone: timeZone === "local" ? browserZone : timeZone,
      setTimeZone,
      timeZoneOptions: DEFAULT_OPTIONS,
      billingInvoiceHeaderDefaults,
      setBillingInvoiceHeaderDefaults,
      refreshBillingInvoiceHeaderDefaults,
      isBillingInvoiceHeaderDefaultsLoading,
      billingTermOptions: BILLING_TERM_OPTIONS
    };
  }, [
    billingInvoiceHeaderDefaults,
    isBillingInvoiceHeaderDefaultsLoading,
    refreshBillingInvoiceHeaderDefaults,
    setBillingInvoiceHeaderDefaults,
    timeZone
  ]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within SettingsProvider");
  }
  return context;
}

function normalizeBillingInvoiceHeaderDefaults(header: Partial<BillingInvoiceHeader> | null | undefined): BillingInvoiceHeader {
  return {
    sellerName: typeof header?.sellerName === "string" ? header.sellerName.trim() : DEFAULT_BILLING_INVOICE_HEADER.sellerName,
    subtitle: typeof header?.subtitle === "string" ? header.subtitle.trim() : DEFAULT_BILLING_INVOICE_HEADER.subtitle,
    remitTo: typeof header?.remitTo === "string" ? header.remitTo.trim() : DEFAULT_BILLING_INVOICE_HEADER.remitTo,
    terms: typeof header?.terms === "string" ? header.terms.trim() : DEFAULT_BILLING_INVOICE_HEADER.terms,
    paymentDueDays: typeof header?.paymentDueDays === "number" && Number.isFinite(header.paymentDueDays) && header.paymentDueDays >= 0
      ? Math.round(header.paymentDueDays)
      : DEFAULT_BILLING_INVOICE_HEADER.paymentDueDays,
    paymentInstructions: typeof header?.paymentInstructions === "string"
      ? header.paymentInstructions.trim()
      : DEFAULT_BILLING_INVOICE_HEADER.paymentInstructions
  };
}
