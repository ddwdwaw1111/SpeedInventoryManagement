import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";

export type TimeZoneSetting = "local" | string;

type TimeZoneOption = {
  value: TimeZoneSetting;
  label: string;
};

type SettingsContextValue = {
  timeZone: TimeZoneSetting;
  resolvedTimeZone: string;
  setTimeZone: (timeZone: TimeZoneSetting) => void;
  timeZoneOptions: TimeZoneOption[];
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

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [timeZone, setTimeZone] = useState<TimeZoneSetting>(() => window.localStorage.getItem("sim-timezone") || "local");

  useEffect(() => {
    window.localStorage.setItem("sim-timezone", timeZone);
  }, [timeZone]);

  const value = useMemo<SettingsContextValue>(() => {
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    return {
      timeZone,
      resolvedTimeZone: timeZone === "local" ? browserZone : timeZone,
      setTimeZone,
      timeZoneOptions: DEFAULT_OPTIONS
    };
  }, [timeZone]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within SettingsProvider");
  }
  return context;
}
