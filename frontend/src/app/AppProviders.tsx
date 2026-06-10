import type { ReactNode } from "react";

import { I18nProvider } from "../lib/i18n";
import { SettingsProvider } from "../lib/settings";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <I18nProvider>
        {children}
      </I18nProvider>
    </SettingsProvider>
  );
}
