import type { ReactNode } from "react";
import { CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";

import { I18nProvider } from "../lib/i18n";
import { SettingsProvider } from "../lib/settings";
import { appTheme } from "./theme";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={appTheme}>
      <CssBaseline />
      <SettingsProvider>
        <I18nProvider>
          {children}
        </I18nProvider>
      </SettingsProvider>
    </ThemeProvider>
  );
}
